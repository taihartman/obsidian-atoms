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

/** Statuses we owe entitlement for — "paid" in the product sense, not "money moved". */
const GRANTABLE_PAYMENT_STATUS = new Set(["paid", "no_payment_required"]);

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
    pages: 0,
    scanned: 0,
    skippedUnpaid: 0,
    processed: 0,
    flagged: [],
    repaired: [],
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
      await sweepEvent({ store, event, report, repair, force, now });
    }
    if (!list?.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }

  return report;
}

async function sweepEvent({ store, event, report, repair, force, now }) {
  report.scanned += 1;
  const session = event.data?.object ?? {};

  // Match `applyStripeEvent`: an absent payment_status reads as paid. Trial
  // starts settle as `no_payment_required` and `applyStripeEvent` grants on
  // them, so a sweep blind to that would miss the whole signup path #230 broke.
  if (!GRANTABLE_PAYMENT_STATUS.has(String(session.payment_status || "paid"))) {
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

  const result = await applyCheckoutCompleted(store, event);
  report.repaired.push({
    eventId: event.id,
    sessionId,
    email: result.email || email,
    action: result.action,
    // KTD6 — the checkout binding is long gone; entitlement is all we restored.
    sessionRestored: false,
    note: "entitlement restored; this customer must sign in again with a magic link",
  });
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
