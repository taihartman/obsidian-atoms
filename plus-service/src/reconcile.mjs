/**
 * #238 U4 — class-C reconciliation: the webhook never arrived at all.
 *
 * Nothing in-process can see class C, so this is a report a human pulls
 * (KTD4, weekly). The logic lives here rather than in `scripts/` so
 * `node --test` can reach it; the script is argv parsing only.
 *
 * KTD5 — the oracle is `hasProcessedEvent`, never account entitlement.
 * Comparing against `getAccount` is wrong in both directions: a paid
 * `topup_50` for a subscriber looks entitled (a lost top-up is never
 * reported), and any granted session whose period has since expired reads
 * `status: exhausted` and would be reported as unentitled — which `--repair`
 * would then "fix" with a fresh period for a months-old payment.
 *
 * KTD6 — repair restores entitlement only. `promoteCheckoutSession` needs a
 * live `checkout_bindings` row and that TTL is 24h, so a sweep run days after
 * Stripe exhausted its retries can never restore the customer's session. Every
 * repaired customer must sign in again with a magic link, and the report says
 * so rather than implying otherwise.
 *
 * KTD9 — repair only *claims to have repaired* what actually granted, and never
 * repairs a checkout whose subscription Stripe now reports as canceled. Both
 * halves matter because repair claims the event id either way: a no-grant
 * outcome filed under `repaired` would never resurface in a later sweep.
 */

import { config } from "./config.mjs";
import {
  applyCheckoutCompleted,
  classifyCheckoutGrant,
  stripeGet,
} from "./stripe.mjs";
import { INCIDENT_KIND } from "./store/shared.mjs";

export const DAY_MS = 86400000;
/** Stripe's events API retains 30 days — a wider window returns nothing. */
export const MAX_WINDOW_DAYS = 30;
export const DEFAULT_WINDOW_DAYS = 7;
/** Belt-and-braces stop so a misbehaving `has_more` cannot loop forever. */
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

/**
 * Payment statuses that do NOT buy entitlement. Deliberately a denylist of one,
 * mirroring `applyCheckoutCompleted` (`payStatus === "unpaid"` → no grant): an
 * allowlist here would be one-way lossy, because a payment status Stripe adds
 * later would be *granted* by the webhook and silently *dropped* by the sweep —
 * the sweep would then never flag the lost grant it exists to find. The two
 * filters have to agree by construction, so both are "skip unpaid, take the rest".
 */
const UNGRANTABLE_PAYMENT_STATUS = new Set(["unpaid"]);

/** Repair outcomes that actually granted something. Everything else is a failure. */
const GRANTING_ACTIONS = new Set(["topup", "trial", "subscribe"]);

/**
 * Stripe subscription statuses that mean "this customer is gone". Repairing a
 * lost checkout for one of these resurrects a canceled account.
 */
const DEAD_SUBSCRIPTION_STATUS = new Set([
  "canceled",
  "incomplete_expired",
  "unpaid",
]);

/**
 * @param {{
 *   store: object,
 *   fetchImpl?: typeof fetch,
 *   since?: number,
 *   repair?: boolean,
 *   force?: boolean,
 *   now?: number,
 * }} opts
 */
export async function reconcileStripe(opts) {
  const store = opts.store;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const floor = now - MAX_WINDOW_DAYS * DAY_MS;
  const requested = Number.isFinite(opts.since)
    ? opts.since
    : now - DEFAULT_WINDOW_DAYS * DAY_MS;
  const since = Math.max(requested, floor);
  const repair = Boolean(opts.repair);
  const force = Boolean(opts.force);

  const report = {
    since,
    now,
    repair,
    force,
    clamped: requested < floor,
    /** What `createStore` actually handed us — a memory store sweeps nothing real. */
    storeKind: String(store?.kind || "unknown"),
    pages: 0,
    scanned: 0,
    skippedUnpaid: 0,
    processed: 0,
    /** True when MAX_PAGES ran out with Stripe still reporting `has_more`. */
    truncated: false,
    flagged: [],
    repaired: [],
    failed: [],
    skipped: [],
    refused: [],
  };

  let startingAfter;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // `payment_status` is NOT a valid list filter on the events API — the
    // paid/unpaid split has to happen in code below, not in the query.
    const list = await stripeGet(
      "/events",
      {
        type: "checkout.session.completed",
        "created[gte]": Math.floor(since / 1000),
        limit: PAGE_SIZE,
        starting_after: startingAfter,
      },
      { fetchImpl: opts.fetchImpl },
    );
    report.pages += 1;
    const data = Array.isArray(list?.data) ? list.data : [];
    for (const event of data) {
      await sweepEvent({
        store,
        event,
        report,
        repair,
        force,
        now,
        fetchImpl: opts.fetchImpl,
      });
    }
    if (!list?.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
    // A silent cap reads as "swept everything" when it did not — say so.
    if (page === MAX_PAGES - 1) report.truncated = true;
  }

  return report;
}

async function sweepEvent({ store, event, report, repair, force, now, fetchImpl }) {
  report.scanned += 1;
  const session = event.data?.object ?? {};

  // Match `applyCheckoutCompleted` exactly: an absent payment_status reads as
  // paid, only the literal "unpaid" is skipped. Trial starts settle as
  // `no_payment_required` and the webhook grants on them, so a sweep blind to
  // that would miss the whole signup path #230 broke — and so would a sweep
  // that allowlisted today's known statuses and dropped tomorrow's.
  if (UNGRANTABLE_PAYMENT_STATUS.has(String(session.payment_status || "paid"))) {
    report.skippedUnpaid += 1;
    return;
  }

  if (await store.hasProcessedEvent(event.id)) {
    report.processed += 1;
    return;
  }

  const sessionId = String(session.id || "");
  const email = grantEmail(session);
  const createdMs = eventCreatedMs(event, session);
  const flagged = {
    eventId: event.id,
    sessionId,
    email,
    createdAt: createdMs ? new Date(createdMs).toISOString() : null,
    ageDays: createdMs ? Math.floor((now - createdMs) / DAY_MS) : null,
  };
  report.flagged.push(flagged);

  // KTD3 — every incident is recorded, sweep findings included.
  try {
    await store.recordStripeIncident(INCIDENT_KIND.MISSING_WEBHOOK, {
      stripeId: sessionId,
      email,
      detail: "Stripe delivered checkout.session.completed; we never processed it",
      now,
    });
  } catch (err) {
    console.error(
      "[plus] incident record failed missing_webhook",
      err instanceof Error ? err.message : "err",
    );
  }

  if (!repair) return;

  const maxAgeDays = grantWindowDays(session);
  if (
    !force &&
    maxAgeDays !== null &&
    flagged.ageDays !== null &&
    flagged.ageDays > maxAgeDays
  ) {
    report.refused.push({
      eventId: event.id,
      sessionId,
      email,
      ageDays: flagged.ageDays,
      maxAgeDays,
      reason: `session is older than the ${maxAgeDays}-day entitlement it would grant — re-run with --force to grant anyway`,
    });
    return;
  }

  // KTD9 — never resurrect a canceled account. `grantPeriod` runs from `now`,
  // not the session date, so repairing a checkout whose subscription has since
  // been canceled hands a departed customer a fresh full period. `--force`
  // deliberately does NOT override this: it exists to widen the age window, not
  // to re-entitle someone Stripe says is gone.
  const dead = await deadSubscription({ session, fetchImpl });
  if (dead) {
    report.skipped.push({
      eventId: event.id,
      sessionId,
      email,
      subscriptionId: dead.subscriptionId,
      subscriptionStatus: dead.status,
      reason: `subscription ${dead.subscriptionId} is ${dead.status} at Stripe — repairing would resurrect a canceled account`,
    });
    return;
  }

  const result = await applyCheckoutCompleted(store, event);
  const entry = {
    eventId: event.id,
    sessionId,
    email: result.email || email,
    action: result.action,
  };
  if (!GRANTING_ACTIONS.has(String(result.action))) {
    // The event id is claimed either way, so this will not resurface in a
    // later sweep. Reporting it as "repaired" would have buried it forever.
    report.failed.push({
      ...entry,
      claimed: true,
      reason: `repair granted nothing (${result.action}); the event id is now claimed, so this will not resurface in a later sweep`,
    });
    return;
  }
  report.repaired.push({
    ...entry,
    // KTD6 — the checkout binding is long gone; entitlement is all we restored.
    sessionRestored: false,
    note: "entitlement restored; this customer must sign in again with a magic link",
  });
}

/**
 * Ask Stripe whether this checkout's subscription is still alive. Only the
 * repair path calls it, and only for subscription sessions, so a report-only
 * sweep stays one list call. A lookup failure is not evidence of cancellation —
 * it logs and lets the repair proceed under the age gate.
 * @returns {Promise<{ subscriptionId: string, status: string } | null>}
 */
async function deadSubscription({ session, fetchImpl }) {
  const subscriptionId = String(session.subscription || "");
  if (!subscriptionId) return null;
  try {
    const sub = await stripeGet(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {},
      { fetchImpl },
    );
    const status = String(sub?.status || "");
    return DEAD_SUBSCRIPTION_STATUS.has(status)
      ? { subscriptionId, status }
      : null;
  } catch (err) {
    console.error(
      "[plus] subscription lookup failed",
      subscriptionId,
      err instanceof Error ? err.message : "err",
    );
    return null;
  }
}

/** Email we would grant to, for the report only — never a session token (KTD7). */
function grantEmail(session) {
  const raw =
    session.metadata?.email ||
    session.client_reference_id ||
    session.customer_details?.email ||
    session.customer_email ||
    "";
  return raw ? String(raw).trim().toLowerCase() : "";
}

function eventCreatedMs(event, session) {
  const sec = Number(event.created ?? session.created);
  return Number.isFinite(sec) ? sec * 1000 : 0;
}

/**
 * How old a session may be and still be worth repairing: the length of the
 * entitlement it would grant. Top-ups buy filings that never expire, so age
 * does not invalidate them — `null` means no age limit.
 */
function grantWindowDays(session) {
  switch (classifyCheckoutGrant(session, { planTopup: true })) {
    case "topup":
      return null;
    case "trial":
      return config.trialDays;
    case "yearly":
      return 365;
    default:
      return 30;
  }
}
