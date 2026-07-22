/**
 * Stripe Checkout + webhook helpers (test or live via env keys).
 * No SDK — fetch + HMAC verify so dogfood stays dependency-light.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.mjs";

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

export function stripeConfigured() {
  return Boolean(
    config.stripeSecretKey &&
      config.stripePriceMonthly &&
      config.stripePriceYearly &&
      config.stripePriceTopup,
  );
}

/**
 * @param {string} path
 * @param {Record<string, string | number | undefined>} params
 */
async function stripeForm(path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    body.set(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
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
 * @param {import('./store.mjs').createStore extends Function ? any : never} store
 * @param {object} event
 * @returns {{ handled: boolean, action?: string, email?: string }}
 */
export function applyStripeEvent(store, event) {
  if (store.hasProcessedEvent(event.id)) {
    return { handled: true, action: "duplicate" };
  }

  const type = event.type;
  const obj = event.data?.object ?? {};

  if (type === "checkout.session.completed") {
    const email = (
      obj.metadata?.email ||
      obj.customer_email ||
      obj.client_reference_id ||
      ""
    )
      .toString()
      .trim()
      .toLowerCase();
    const kind = String(obj.metadata?.kind || "");
    if (!email) {
      store.markEventProcessed(event.id);
      return { handled: false, action: "missing_email" };
    }

    if (kind === "topup_50" || obj.mode === "payment") {
      store.addTopUp(email, config.topUpFilings);
      if (obj.customer) store.setStripeCustomer(email, String(obj.customer));
      store.markEventProcessed(event.id);
      return { handled: true, action: "topup", email };
    }

    const planMeta = String(obj.metadata?.plan || "");
    const isTrial = kind === "start_trial" || planMeta === "trial";
    const isYearly = kind === "subscribe_yearly" || planMeta === "yearly";
    store.grantPeriod(email, {
      status: isTrial ? "trialing" : "active",
      plan: isTrial ? "trial" : isYearly ? "yearly" : "monthly",
      days: isTrial ? config.trialDays : isYearly ? 365 : 30,
      remaining: config.includedFilings,
    });
    if (obj.customer) store.setStripeCustomer(email, String(obj.customer));
    if (obj.subscription) {
      store.setStripeSubscription(email, String(obj.subscription));
    }
    store.markEventProcessed(event.id);
    return {
      handled: true,
      action: isTrial ? "trial" : "subscribe",
      email,
    };
  }

  if (type === "invoice.paid") {
    const reason = String(obj.billing_reason || "");
    // subscription_create is covered by checkout.session.completed
    if (reason !== "subscription_cycle" && reason !== "subscription_update") {
      store.markEventProcessed(event.id);
      return { handled: true, action: "invoice_skip", email: undefined };
    }
    const email = resolveInvoiceEmail(store, obj);
    if (!email) {
      store.markEventProcessed(event.id);
      return { handled: false, action: "missing_email" };
    }
    const plan = store.getAccount(email)?.plan;
    const isYearly = plan === "yearly";
    store.grantPeriod(email, {
      status: "active",
      plan: isYearly ? "yearly" : "monthly",
      days: isYearly ? 365 : 30,
      remaining: config.includedFilings,
    });
    store.markEventProcessed(event.id);
    return { handled: true, action: "renew", email };
  }

  if (
    type === "customer.subscription.deleted" ||
    (type === "customer.subscription.updated" &&
      obj.status === "canceled")
  ) {
    const email = resolveSubEmail(store, obj);
    if (email) {
      store.revokeSubscription(email);
      store.markEventProcessed(event.id);
      return { handled: true, action: "revoke", email };
    }
    store.markEventProcessed(event.id);
    return { handled: false, action: "missing_email" };
  }

  // Acknowledge unknown types so Stripe stops retrying
  store.markEventProcessed(event.id);
  return { handled: true, action: "ignored" };
}

function resolveInvoiceEmail(store, inv) {
  const meta = inv.subscription_details?.metadata?.email || inv.metadata?.email;
  if (meta) return String(meta).trim().toLowerCase();
  const cust = inv.customer ? String(inv.customer) : "";
  if (cust) {
    const byCust = store.emailFromStripeCustomer(cust);
    if (byCust) return byCust;
  }
  if (typeof inv.customer_email === "string" && inv.customer_email) {
    return inv.customer_email.trim().toLowerCase();
  }
  return "";
}

function resolveSubEmail(store, sub) {
  const meta = sub.metadata?.email;
  if (meta) return String(meta).trim().toLowerCase();
  const cust = sub.customer ? String(sub.customer) : "";
  if (cust) return store.emailFromStripeCustomer(cust) || "";
  return "";
}
