/**
 * In-memory store for dogfood. Swap for Durable Object / Postgres later.
 * No rollover: remaining resets only when a new period is granted.
 */

import { randomBytes } from "node:crypto";
import { config } from "./config.mjs";

function id(prefix) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function periodEndFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** @typedef {'active'|'trialing'|'exhausted'|'inactive'|'unknown'} Status */

/**
 * @typedef {{
 *   email: string,
 *   status: Status,
 *   remaining: number,
 *   periodEnd: string,
 *   plan: 'monthly'|'yearly'|'trial'|'promo',
 *   promoRedemptions: number,
 *   stripeCustomerId?: string,
 *   stripeSubscriptionId?: string,
 * }} Account
 */

export function createStore() {
  /** @type {Map<string, Account>} */
  const accounts = new Map();
  /** magic token → email */
  const magicTokens = new Map();
  /** session → email */
  const sessions = new Map();
  /** promo code → redemption count */
  const promoUses = new Map();
  /** Stripe event id → true (webhook idempotency) */
  const processedEvents = new Set();
  /** stripe customer id → email */
  const stripeCustomers = new Map();
  /** email → stripe subscription id */
  const stripeSubs = new Map();

  function getAccount(email) {
    const key = email.trim().toLowerCase();
    return accounts.get(key) ?? null;
  }

  function ensureAccount(email) {
    const key = email.trim().toLowerCase();
    let a = accounts.get(key);
    if (!a) {
      a = {
        email: key,
        status: "inactive",
        remaining: 0,
        periodEnd: new Date().toISOString(),
        plan: "trial",
        promoRedemptions: 0,
      };
      accounts.set(key, a);
    }
    return a;
  }

  function grantPeriod(email, opts = {}) {
    const a = ensureAccount(email);
    const days = opts.days ?? 30;
    const status = opts.status ?? "active";
    const plan = opts.plan ?? "monthly";
    const remaining = opts.remaining ?? config.includedFilings;
    a.status = status;
    a.plan = plan;
    a.remaining = remaining;
    a.periodEnd = periodEndFromNow(days);
    // No rollover: always set remaining explicitly (do not add old remaining)
    return a;
  }

  function createMagicToken(email) {
    const token = id("mt");
    const key = email.trim().toLowerCase();
    magicTokens.set(token, {
      email: key,
      exp: Date.now() + 15 * 60 * 1000,
    });
    return token;
  }

  function exchangeMagic(token) {
    const row = magicTokens.get(token);
    if (!row) return null;
    if (Date.now() > row.exp) {
      magicTokens.delete(token);
      return null;
    }
    magicTokens.delete(token);
    const a = ensureAccount(row.email);

    if (
      config.dogfoodAutoGrant &&
      (a.status === "inactive" || a.remaining <= 0)
    ) {
      const st =
        config.dogfoodGrantStatus === "active" ? "active" : "trialing";
      grantPeriod(row.email, {
        status: st,
        plan: st === "trialing" ? "trial" : "monthly",
        days: st === "trialing" ? config.trialDays : 30,
        remaining: config.includedFilings,
      });
    }

    // Expire period → exhausted
    if (a.status !== "inactive" && new Date(a.periodEnd) < new Date()) {
      a.status = "exhausted";
      a.remaining = 0;
    } else if (a.remaining <= 0 && a.status !== "inactive") {
      a.status = "exhausted";
    }

    const session = id("sess");
    sessions.set(session, row.email);
    return { session, account: a };
  }

  function accountFromSession(sessionToken) {
    const email = sessions.get(sessionToken);
    if (!email) return null;
    const a = getAccount(email);
    if (!a) return null;
    if (a.status !== "inactive" && new Date(a.periodEnd) < new Date()) {
      a.status = "exhausted";
      a.remaining = 0;
    } else if (a.remaining <= 0 && a.status !== "inactive") {
      a.status = "exhausted";
    }
    return a;
  }

  /**
   * Consume one filing if allowed. Returns { ok, account } or { ok:false, code }.
   */
  function tryConsumeFiling(sessionToken) {
    const a = accountFromSession(sessionToken);
    if (!a) return { ok: false, code: "auth" };
    if (a.status === "inactive") return { ok: false, code: "auth" };
    if (a.status === "exhausted" || a.remaining <= 0) {
      a.status = "exhausted";
      a.remaining = 0;
      return { ok: false, code: "exhausted", account: a };
    }
    a.remaining -= 1;
    if (a.remaining <= 0) {
      a.status = "exhausted";
      a.remaining = 0;
    }
    return { ok: true, account: a };
  }

  /** Refund one filing after transport failure (KTD-P6). */
  function refundFiling(sessionToken) {
    const a = accountFromSession(sessionToken);
    if (!a) return;
    a.remaining += 1;
    if (a.status === "exhausted" && a.remaining > 0) {
      a.status = a.plan === "trial" ? "trialing" : "active";
    }
  }

  function addTopUp(email, n = config.topUpFilings) {
    const a = ensureAccount(email);
    a.remaining += n;
    if (a.status === "exhausted" || a.status === "inactive") {
      a.status = "active";
    }
    return a;
  }

  function redeemPromo(email, code) {
    const upper = code.trim().toUpperCase();
    const months = config.promoCodes.get(upper);
    if (!months) return { ok: false, message: "Invalid promo code" };
    const used = promoUses.get(upper) ?? 0;
    if (used >= config.promoMaxRedemptions) {
      return { ok: false, message: "Promo code fully redeemed" };
    }
    promoUses.set(upper, used + 1);
    const a = grantPeriod(email, {
      status: "active",
      plan: "promo",
      days: months * 30,
      remaining: config.includedFilings,
    });
    a.promoRedemptions += 1;
    return { ok: true, account: a, months };
  }

  function publicAccount(a) {
    return {
      email: a.email,
      status: a.status,
      remaining: a.remaining,
      periodEnd: a.periodEnd,
      plan: a.plan,
    };
  }

  function hasProcessedEvent(eventId) {
    return processedEvents.has(eventId);
  }

  function markEventProcessed(eventId) {
    if (eventId) processedEvents.add(eventId);
  }

  function setStripeCustomer(email, customerId) {
    const a = ensureAccount(email);
    a.stripeCustomerId = customerId;
    stripeCustomers.set(customerId, a.email);
    return a;
  }

  function setStripeSubscription(email, subId) {
    const a = ensureAccount(email);
    a.stripeSubscriptionId = subId;
    stripeSubs.set(a.email, subId);
    return a;
  }

  function emailFromStripeCustomer(customerId) {
    return stripeCustomers.get(customerId) ?? null;
  }

  /** Cancel / end paid access — keep remaining top-up filings until used. */
  function revokeSubscription(email) {
    const a = ensureAccount(email);
    a.stripeSubscriptionId = undefined;
    if (a.remaining > 0) {
      a.status = "active";
    } else {
      a.status = "inactive";
      a.remaining = 0;
    }
    return a;
  }

  return {
    createMagicToken,
    exchangeMagic,
    accountFromSession,
    tryConsumeFiling,
    refundFiling,
    grantPeriod,
    addTopUp,
    redeemPromo,
    publicAccount,
    ensureAccount,
    getAccount,
    hasProcessedEvent,
    markEventProcessed,
    setStripeCustomer,
    setStripeSubscription,
    emailFromStripeCustomer,
    revokeSubscription,
    /** test helpers */
    _sessions: sessions,
    _accounts: accounts,
    _processedEvents: processedEvents,
  };
}
