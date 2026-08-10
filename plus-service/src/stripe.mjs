/**
 * Stripe Checkout + webhook helpers (test or live via env keys).
 * No SDK — fetch + HMAC verify so dogfood stays dependency-light.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.mjs";
import { INCIDENT_KIND, resolveCheckoutGrantEmail } from "./store/shared.mjs";

/** @typedef {'start_trial'|'subscribe_monthly'|'subscribe_yearly'|'topup_50'} CheckoutKind */

/**
 * @param {CheckoutKind} kind
 * @returns {{ mode: 'subscription'|'payment', priceId: string, trialDays?: number, plan: string } | null}
 */
export function resolveCheckoutKind(kind) {
  const monthly = config.stripePriceMonthly;
  const yearly = config.stripePriceYearly;
  const topup = config.stripePriceTopup;

  switch (kind) {
    case "start_trial":
      if (!monthly) return null;
      return {
        mode: "subscription",
        priceId: monthly,
        trialDays: config.trialDays,
        plan: "trial",
      };
    case "subscribe_monthly":
      if (!monthly) return null;
      return { mode: "subscription", priceId: monthly, plan: "monthly" };
    case "subscribe_yearly":
      if (!yearly) return null;
      return { mode: "subscription", priceId: yearly, plan: "yearly" };
    case "topup_50":
      if (!topup) return null;
      return { mode: "payment", priceId: topup, plan: "topup" };
    default:
      return null;
  }
}

/**
 * The grant a completed checkout session buys. One taxonomy, two readers: the
 * webhook (`applyCheckoutCompleted`) and the #238 sweep's age gate
 * (`grantWindowDays` in `reconcile.mjs`) — add a plan tier here and both move.
 *
 * The two see different evidence, so the extra top-up signals stay explicit
 * options rather than silently unioned:
 * - `fromPrice` — only the webhook expands `line_items`, so only it can map a
 *   price id back to a grant.
 * - `planTopup` — only the sweep has ever read `metadata.plan === "topup"`.
 *
 * @param {object} session Stripe checkout session
 * @param {{ fromPrice?: 'monthly'|'yearly'|'topup'|null, planTopup?: boolean }} [opts]
 * @returns {'topup'|'trial'|'yearly'|'monthly'}
 */
export function classifyCheckoutGrant(session, opts = {}) {
  const kind = String(session?.metadata?.kind || "");
  const plan = String(session?.metadata?.plan || "");
  const fromPrice = opts.fromPrice ?? null;
  if (
    kind === "topup_50" ||
    fromPrice === "topup" ||
    (opts.planTopup === true && plan === "topup") ||
    session?.mode === "payment"
  ) {
    return "topup";
  }
  if (kind === "start_trial" || plan === "trial") return "trial";
  if (
    kind === "subscribe_yearly" ||
    plan === "yearly" ||
    fromPrice === "yearly"
  ) {
    return "yearly";
  }
  return "monthly";
}

export function stripeConfigured() {
  return Boolean(
    config.stripeSecretKey &&
      config.stripePriceMonthly &&
      config.stripePriceYearly &&
      config.stripePriceTopup,
  );
}

/**
 * Stripe params → `URLSearchParams`, dropping the keys we never send.
 * `skipNull` is explicit rather than shared: the POST path has always passed a
 * literal `null` straight through to Stripe, and only the GET path (whose
 * `starting_after` is absent on the first page) drops it.
 * @param {Record<string, string | number | undefined | null>} params
 * @param {{ skipNull?: boolean }} [opts]
 */
function buildStripeParams(params, opts = {}) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    if (opts.skipNull && v === null) continue;
    out.set(k, String(v));
  }
  return out;
}

/**
 * @param {string} path
 * @param {Record<string, string | number | undefined>} params
 */
async function stripeForm(path, params) {
  const body = buildStripeParams(params);
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return readStripeJson(res);
}

/**
 * GET a Stripe list/resource. Same auth and base as `stripeForm`, but a query
 * string — needed by the #238 reconciliation sweep, which only reads.
 * `fetchImpl` is injectable so tests never touch the network (KTD4/U5); params
 * may be bracketed (`created[gte]`) and support `starting_after` pagination.
 * @param {string} path
 * @param {Record<string, string | number | undefined>} params
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function stripeGet(path, params = {}, opts = {}) {
  const query = buildStripeParams(params, { skipNull: true }).toString();
  const doFetch = opts.fetchImpl || fetch;
  const res = await doFetch(
    `https://api.stripe.com/v1${path}${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${config.stripeSecretKey}` },
    },
  );
  return readStripeJson(res);
}

async function readStripeJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof json?.error?.message === "string"
        ? json.error.message
        : `Stripe ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.stripe = json;
    throw err;
  }
  return json;
}

/**
 * @param {{ email: string, kind: CheckoutKind, successUrl?: string, cancelUrl?: string }} opts
 */
export async function createCheckoutSession(opts) {
  const resolved = resolveCheckoutKind(opts.kind);
  if (!resolved) {
    const err = new Error(`Checkout kind not configured: ${opts.kind}`);
    err.status = 400;
    throw err;
  }
  if (!config.stripeSecretKey) {
    const err = new Error("STRIPE_SECRET_KEY not set");
    err.status = 503;
    throw err;
  }

  const successUrl =
    opts.successUrl ||
    `${config.publicBaseUrl}/v1/billing/return?ok=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    opts.cancelUrl || `${config.publicBaseUrl}/v1/billing/return?ok=0`;

  /** @type {Record<string, string | number | undefined>} */
  const params = {
    mode: resolved.mode,
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: opts.email,
    client_reference_id: opts.email,
    "line_items[0][price]": resolved.priceId,
    "line_items[0][quantity]": 1,
    "metadata[email]": opts.email,
    "metadata[kind]": opts.kind,
    "metadata[plan]": resolved.plan,
  };

  if (resolved.mode === "subscription") {
    params["subscription_data[metadata][email]"] = opts.email;
    params["subscription_data[metadata][kind]"] = opts.kind;
    params["subscription_data[metadata][plan]"] = resolved.plan;
    if (resolved.trialDays && resolved.trialDays > 0) {
      params["subscription_data[trial_period_days]"] = resolved.trialDays;
    }
  } else {
    params["payment_intent_data[metadata][email]"] = opts.email;
    params["payment_intent_data[metadata][kind]"] = opts.kind;
  }

  const session = await stripeForm("/checkout/sessions", params);
  if (typeof session.url !== "string" || !session.url) {
    throw new Error("Stripe Checkout missing url");
  }
  return session;
}

/**
 * User-safe copy when reconnect checkout cannot be opened (#408).
 * Prefer returning a Checkout URL from createPortalSessionForAccount instead.
 */
export const PORTAL_STALE_CUSTOMER_MESSAGE =
  "Your billing link is out of date. Start checkout again from Atoms to reconnect — remaining filings stay as they are.";

/**
 * Stripe refused the stored customer id because it belongs to the other mode
 * (test vs live) or was deleted. Portal must self-heal, not echo the raw error.
 * @param {unknown} err
 */
export function isStaleStripeCustomerError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/similar object exists in (test|live) mode/i.test(msg)) return true;
  if (/No such customer/i.test(msg)) return true;
  const stripeErr =
    err && typeof err === "object" && "stripe" in err
      ? /** @type {{ stripe?: { error?: { code?: string, param?: string, message?: string } } }} */ (
          err
        ).stripe?.error
      : undefined;
  if (stripeErr?.code === "resource_missing") {
    const param = String(stripeErr.param || "");
    const detail = String(stripeErr.message || msg);
    if (param === "customer" || /customer/i.test(detail)) return true;
  }
  return false;
}

/**
 * Checkout kind used to attach a live Stripe customer after a missing/stale link.
 * Trialing accounts reopen trial Checkout; everyone else gets monthly subscribe.
 * @param {{ status?: string }} account
 * @returns {CheckoutKind}
 */
export function reconnectCheckoutKind(account) {
  const st = String(account?.status || "");
  if (st === "trialing" || st === "inactive") return "start_trial";
  return "subscribe_monthly";
}

/**
 * @param {{ customerId: string, returnUrl?: string }} opts
 */
export async function createPortalSession(opts) {
  if (!config.stripeSecretKey) {
    const err = new Error("STRIPE_SECRET_KEY not set");
    err.status = 503;
    throw err;
  }
  const session = await stripeForm("/billing_portal/sessions", {
    customer: opts.customerId,
    return_url:
      opts.returnUrl || `${config.publicBaseUrl}/v1/billing/return?ok=1&portal=1`,
  });
  if (typeof session.url !== "string" || !session.url) {
    throw new Error("Stripe portal missing url");
  }
  return session;
}

/**
 * Open the billing portal, or live Checkout when the account has no usable
 * Stripe customer (missing, deleted, or wrong mode after test→live).
 *
 * Returns `{ url, reconnect?: true }`. The plugin always opens `url`.
 *
 * @param {{
 *   clearStripeBillingLink?: (email: string) => unknown,
 *   bindCheckoutSession?: (id: string, email: string, sessionToken: string) => unknown,
 * }} store
 * @param {{ email: string, status?: string, stripeCustomerId?: string }} account
 * @param {{
 *   returnUrl?: string,
 *   sessionToken?: string,
 *   createSession?: typeof createPortalSession,
 *   createCheckout?: typeof createCheckoutSession,
 * }} [opts]
 */
export async function createPortalSessionForAccount(store, account, opts = {}) {
  const createPortal = opts.createSession || createPortalSession;
  const createCheckout = opts.createCheckout || createCheckoutSession;

  const openReconnect = async () => {
    const kind = reconnectCheckoutKind(account);
    const cs = await createCheckout({ email: account.email, kind });
    if (
      opts.sessionToken &&
      typeof store.bindCheckoutSession === "function" &&
      cs?.id
    ) {
      await store.bindCheckoutSession(cs.id, account.email, opts.sessionToken);
    }
    if (typeof cs?.url !== "string" || !cs.url) {
      const err = new Error(PORTAL_STALE_CUSTOMER_MESSAGE);
      err.status = 409;
      err.staleCustomer = true;
      throw err;
    }
    return { url: cs.url, reconnect: true, id: cs.id };
  };

  const customerId = account?.stripeCustomerId;
  if (!customerId) {
    return openReconnect();
  }
  try {
    const portal = await createPortal({
      customerId,
      returnUrl: opts.returnUrl,
    });
    return { url: portal.url, reconnect: false };
  } catch (err) {
    if (!isStaleStripeCustomerError(err)) throw err;
    if (typeof store.clearStripeBillingLink === "function") {
      await store.clearStripeBillingLink(account.email);
    }
    return openReconnect();
  }
}

function allowedPriceIds() {
  return new Set(
    [
      config.stripePriceMonthly,
      config.stripePriceYearly,
      config.stripePriceTopup,
    ].filter(Boolean),
  );
}

/** @returns {'monthly'|'yearly'|'topup'|null} */
function grantFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === config.stripePriceTopup) return "topup";
  if (priceId === config.stripePriceYearly) return "yearly";
  if (priceId === config.stripePriceMonthly) return "monthly";
  return null;
}

/**
 * Verify Stripe-Signature header. Returns event object or throws.
 * @param {string} rawBody
 * @param {string | undefined} signatureHeader
 */
export function constructEvent(rawBody, signatureHeader) {
  const secret = config.stripeWebhookSecret;
  if (!secret) {
    const err = new Error("STRIPE_WEBHOOK_SECRET not set");
    err.status = 503;
    throw err;
  }
  if (!signatureHeader) {
    const err = new Error("Missing Stripe-Signature");
    err.status = 400;
    throw err;
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=").trim()];
    }),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) {
    const err = new Error("Invalid Stripe-Signature");
    err.status = 400;
    throw err;
  }

  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(Number(t)) || ageSec > 300) {
    const err = new Error("Stripe signature timestamp outside tolerance");
    err.status = 400;
    throw err;
  }

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const err = new Error("Stripe signature mismatch");
    err.status = 400;
    throw err;
  }

  const event = JSON.parse(rawBody);
  if (!event || typeof event !== "object" || typeof event.id !== "string") {
    const err = new Error("Invalid event payload");
    err.status = 400;
    throw err;
  }
  return event;
}

/**
 * Map a verified Stripe event into store mutations.
 * Store methods may be sync (memory/sqlite) or async (postgres) — always awaited.
 * @param {object} store
 * @param {object} event
 * @returns {Promise<{ handled: boolean, action?: string, email?: string }>}
 */
/**
 * Claim event id before mutating entitlements. Returns "duplicate" if already claimed.
 * Do not claim unpaid/skip paths that must remain retriable.
 */
/**
 * #238 class B — record a no-grant outcome. Recording must never change what
 * the webhook answers, so a store failure is logged and swallowed. The row is
 * handed back on the result for the single alert call site in `server.mjs`.
 * @returns {Promise<object | null>}
 */
async function recordIncident(store, kind, opts) {
  if (typeof store.recordStripeIncident !== "function") return null;
  try {
    return await store.recordStripeIncident(kind, opts);
  } catch (err) {
    console.error(
      "[plus] incident record failed",
      kind,
      err instanceof Error ? err.message : "err",
    );
    return null;
  }
}

async function claimOrDuplicate(store, eventId) {
  if (typeof store.claimEvent === "function") {
    const claimed = await store.claimEvent(eventId);
    return claimed ? "claimed" : "duplicate";
  }
  if (await store.hasProcessedEvent(eventId)) return "duplicate";
  await store.markEventProcessed(eventId);
  return "claimed";
}

/**
 * `checkout.session.completed` → grant. Shared by the webhook and by the #238
 * `--repair` sweep so both claim the event id before granting — a late Stripe
 * redelivery must not double-mint — and both honor `metadata.kind` / `mode`.
 * @param {object} store
 * @param {object} event
 */
export async function applyCheckoutCompleted(store, event) {
  const obj = event.data?.object ?? {};
  // Plugin Checkout: grant only metadata.email / client_reference_id.
  // Free-form customer email that disagrees → fail closed (claim, no grant).
  const resolved = resolveCheckoutGrantEmail(obj);
  if (resolved.missing) {
    await claimOrDuplicate(store, event.id);
    const incident = await recordIncident(store, INCIDENT_KIND.MISSING_EMAIL, {
      stripeId: String(obj.id || ""),
      detail: "checkout session carried no usable email",
    });
    return { handled: false, action: "missing_email", incident };
  }
  if (resolved.mismatch) {
    await claimOrDuplicate(store, event.id);
    console.error(
      "[plus] checkout email mismatch — no grant",
      resolved.email,
    );
    const incident = await recordIncident(store, INCIDENT_KIND.EMAIL_MISMATCH, {
      stripeId: String(obj.id || ""),
      email: resolved.email,
      detail: "customer email disagrees with plugin metadata",
    });
    return {
      handled: true,
      action: "email_mismatch",
      email: resolved.email,
      incident,
    };
  }
  const email = resolved.email;

  // Prefer paid/complete; unpaid async methods should not grant yet — do NOT claim
  const payStatus = String(obj.payment_status || "paid");
  if (payStatus === "unpaid") {
    return { handled: true, action: "unpaid_skip", email };
  }

  // Price allowlist when line_items present (expanded sessions)
  const linePrice =
    obj.line_items?.data?.[0]?.price?.id ||
    obj.metadata?.price_id ||
    "";
  if (linePrice && allowedPriceIds().size && !allowedPriceIds().has(linePrice)) {
    await claimOrDuplicate(store, event.id);
    const incident = await recordIncident(store, INCIDENT_KIND.UNKNOWN_PRICE, {
      stripeId: String(obj.id || ""),
      email,
      detail: `price ${linePrice} is not in the allowlist`,
    });
    return { handled: true, action: "unknown_price", email, incident };
  }
  const grant = classifyCheckoutGrant(obj, {
    fromPrice: grantFromPriceId(linePrice),
  });

  // Claim before grant — crash after claim + before grant is preferred to double-mint
  const claim = await claimOrDuplicate(store, event.id);
  if (claim === "duplicate") {
    return { handled: true, action: "duplicate" };
  }

  if (grant === "topup") {
    await store.addTopUp(email, config.topUpFilings);
    if (obj.customer) await store.setStripeCustomer(email, String(obj.customer));
    return { handled: true, action: "topup", email };
  }

  const isTrial = grant === "trial";
  await store.grantPeriod(email, {
    status: isTrial ? "trialing" : "active",
    plan: grant,
    days: isTrial ? config.trialDays : grant === "yearly" ? 365 : 30,
    remaining: config.includedFilings,
  });
  // grantPeriod just revoked every unverified session for this email. Undo it
  // for the one session that opened this checkout — without this, the user who
  // just paid is locked out with "Invalid session" forever (#230). A soft
  // session with no binding stays revoked, which is the C1 case (#163).
  if (typeof store.promoteCheckoutSession === "function") {
    await store.promoteCheckoutSession(obj.id, email);
  }
  if (obj.customer) await store.setStripeCustomer(email, String(obj.customer));
  if (obj.subscription) {
    await store.setStripeSubscription(email, String(obj.subscription));
  }
  return {
    handled: true,
    action: isTrial ? "trial" : "subscribe",
    email,
  };
}

export async function applyStripeEvent(store, event) {
  if (await store.hasProcessedEvent(event.id)) {
    return { handled: true, action: "duplicate" };
  }

  const type = event.type;
  const obj = event.data?.object ?? {};

  if (type === "checkout.session.completed") {
    return applyCheckoutCompleted(store, event);
  }

  if (type === "invoice.paid") {
    const reason = String(obj.billing_reason || "");
    // subscription_create is covered by checkout.session.completed
    if (reason !== "subscription_cycle" && reason !== "subscription_update") {
      await claimOrDuplicate(store, event.id);
      return { handled: true, action: "invoice_skip", email: undefined };
    }
    const email = await resolveInvoiceEmail(store, obj);
    if (!email) {
      await claimOrDuplicate(store, event.id);
      // Own kind: a renewal that granted nothing throttles apart from a
      // checkout that granted nothing, and the two read differently on call.
      const incident = await recordIncident(
        store,
        INCIDENT_KIND.INVOICE_MISSING_EMAIL,
        {
          stripeId: String(obj.id || ""),
          detail: "paid renewal invoice carried no resolvable email",
        },
      );
      return { handled: false, action: "missing_email", incident };
    }
    const claim = await claimOrDuplicate(store, event.id);
    if (claim === "duplicate") {
      return { handled: true, action: "duplicate" };
    }
    const acct = await store.getAccount(email);
    const plan = acct?.plan;
    const isYearly = plan === "yearly";
    await store.grantPeriod(email, {
      status: "active",
      plan: isYearly ? "yearly" : "monthly",
      days: isYearly ? 365 : 30,
      remaining: config.includedFilings,
    });
    return { handled: true, action: "renew", email };
  }

  if (
    type === "customer.subscription.deleted" ||
    (type === "customer.subscription.updated" &&
      obj.status === "canceled")
  ) {
    const email = await resolveSubEmail(store, obj);
    if (email) {
      const claim = await claimOrDuplicate(store, event.id);
      if (claim === "duplicate") {
        return { handled: true, action: "duplicate" };
      }
      await store.revokeSubscription(email);
      return { handled: true, action: "revoke", email };
    }
    await claimOrDuplicate(store, event.id);
    // The fifth no-grant branch. We revoke nothing and Stripe never retries, so
    // without a row this account keeps entitlement invisibly — the exact class
    // #238 exists to kill. Recording only: repairing revokes stays out of scope.
    const incident = await recordIncident(
      store,
      INCIDENT_KIND.REVOKE_MISSING_EMAIL,
      {
        stripeId: String(obj.id || ""),
        detail: "subscription cancellation carried no resolvable email — entitlement not revoked",
      },
    );
    return { handled: false, action: "missing_email", incident };
  }

  // Acknowledge unknown types so Stripe stops retrying
  await claimOrDuplicate(store, event.id);
  return { handled: true, action: "ignored" };
}

async function resolveInvoiceEmail(store, inv) {
  const meta = inv.subscription_details?.metadata?.email || inv.metadata?.email;
  if (meta) return String(meta).trim().toLowerCase();
  const cust = inv.customer ? String(inv.customer) : "";
  if (cust) {
    const byCust = await store.emailFromStripeCustomer(cust);
    if (byCust) return byCust;
  }
  if (typeof inv.customer_email === "string" && inv.customer_email) {
    return inv.customer_email.trim().toLowerCase();
  }
  return "";
}

async function resolveSubEmail(store, sub) {
  const meta = sub.metadata?.email;
  if (meta) return String(meta).trim().toLowerCase();
  const cust = sub.customer ? String(sub.customer) : "";
  if (cust) return (await store.emailFromStripeCustomer(cust)) || "";
  return "";
}
