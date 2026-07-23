/**
 * In-memory store (tests + explicit ATOMS_PLUS_STORE=memory).
 */
import { config } from "../config.mjs";
import {
  applyStatusRules,
  hashToken,
  id,
  periodEndFromNow,
  publicAccount,
} from "./shared.mjs";

export function createMemoryStore() {
  const accounts = new Map();
  const magicTokens = new Map();
  /** tokenHash → { email, exp, revoked } */
  const sessions = new Map();
  const promoUses = new Map();
  /** email+code → true */
  const promoByEmail = new Set();
  const processedEvents = new Set();
  const stripeCustomers = new Map();
  /** idempotency_key → { responseJson, remaining, status } */
  const usageByKey = new Map();

  const sessionTtlMs = () => config.sessionTtlDays * 24 * 60 * 60 * 1000;

  function getAccount(email) {
    return accounts.get(email.trim().toLowerCase()) ?? null;
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

  function refreshAccountStatus(a) {
    applyStatusRules(a);
    return a;
  }

  function grantPeriod(email, opts = {}) {
    const a = ensureAccount(email);
    a.status = opts.status ?? "active";
    a.plan = opts.plan ?? "monthly";
    a.remaining = opts.remaining ?? config.includedFilings;
    a.periodEnd = periodEndFromNow(opts.days ?? 30);
    return a;
  }

  function createMagicToken(email) {
    const token = id("mt");
    magicTokens.set(token, {
      email: email.trim().toLowerCase(),
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
    refreshAccountStatus(a);
    const session = id("sess");
    sessions.set(hashToken(session), {
      email: row.email,
      exp: Date.now() + sessionTtlMs(),
      revoked: false,
    });
    return { session, account: a };
  }

  function accountFromSession(sessionToken) {
    if (!sessionToken) return null;
    const row = sessions.get(hashToken(sessionToken));
    if (!row || row.revoked || Date.now() > row.exp) return null;
    return refreshAccountStatus(getAccount(row.email));
  }

  function revokeSession(sessionToken) {
    const h = hashToken(sessionToken);
    const row = sessions.get(h);
    if (row) row.revoked = true;
  }

  function tryConsumeFiling(sessionToken, idempotencyKey) {
    if (idempotencyKey && usageByKey.has(idempotencyKey)) {
      const prev = usageByKey.get(idempotencyKey);
      if (prev?.status === "ok" && prev.responseJson) {
        return {
          ok: true,
          replay: true,
          account: accountFromSession(sessionToken),
          cached: prev,
        };
      }
      if (prev?.status === "refunded") {
        usageByKey.delete(idempotencyKey);
      } else if (prev?.status === "reserved") {
        return {
          ok: false,
          code: "in_flight",
          account: accountFromSession(sessionToken),
        };
      }
    }
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
    if (idempotencyKey) {
      usageByKey.set(idempotencyKey, { status: "reserved" });
    }
    return { ok: true, account: a, replay: false };
  }

  function completeUsage(idempotencyKey, payload) {
    if (!idempotencyKey) return;
    usageByKey.set(idempotencyKey, payload);
  }

  function refundFiling(sessionToken, idempotencyKey) {
    const a = accountFromSession(sessionToken);
    if (!a) return;
    a.remaining += 1;
    if (a.status === "exhausted" && a.remaining > 0) {
      a.status = a.plan === "trial" ? "trialing" : "active";
    }
    if (idempotencyKey && usageByKey.has(idempotencyKey)) {
      const prev = usageByKey.get(idempotencyKey);
      if (prev?.status !== "ok") {
        usageByKey.set(idempotencyKey, { status: "refunded" });
      }
    }
  }

  function addTopUp(email, n = config.topUpFilings) {
    const a = ensureAccount(email);
    a.remaining += n;
    if (a.status === "exhausted" || a.status === "inactive") a.status = "active";
    return a;
  }

  function redeemPromo(email, code) {
    const upper = code.trim().toUpperCase();
    const months = config.promoCodes.get(upper);
    if (!months) return { ok: false, message: "Invalid promo code" };
    const ek = `${email.trim().toLowerCase()}::${upper}`;
    if (promoByEmail.has(ek)) {
      return { ok: false, message: "Promo already redeemed on this account" };
    }
    const used = promoUses.get(upper) ?? 0;
    if (used >= config.promoMaxRedemptions) {
      return { ok: false, message: "Promo code fully redeemed" };
    }
    promoUses.set(upper, used + 1);
    promoByEmail.add(ek);
    const a = grantPeriod(email, {
      status: "active",
      plan: "promo",
      days: months * 30,
      remaining: config.includedFilings,
    });
    a.promoRedemptions += 1;
    return { ok: true, account: a, months };
  }

  return {
    kind: "memory",
    createMagicToken,
    exchangeMagic,
    accountFromSession,
    revokeSession,
    tryConsumeFiling,
    completeUsage,
    refundFiling,
    grantPeriod,
    addTopUp,
    redeemPromo,
    publicAccount,
    ensureAccount,
    getAccount,
    hasProcessedEvent: (id) => processedEvents.has(id),
    claimEvent(id) {
      if (!id || processedEvents.has(id)) return false;
      processedEvents.add(id);
      return true;
    },
    markEventProcessed: (id) => id && processedEvents.add(id),
    setStripeCustomer(email, customerId) {
      const a = ensureAccount(email);
      a.stripeCustomerId = customerId;
      stripeCustomers.set(customerId, a.email);
      return a;
    },
    setStripeSubscription(email, subId) {
      const a = ensureAccount(email);
      a.stripeSubscriptionId = subId;
      return a;
    },
    emailFromStripeCustomer: (id) => stripeCustomers.get(id) ?? null,
    revokeSubscription(email) {
      const a = ensureAccount(email);
      a.stripeSubscriptionId = undefined;
      if (a.remaining > 0) a.status = "active";
      else {
        a.status = "inactive";
        a.remaining = 0;
      }
      return a;
    },
    _sessions: sessions,
    _accounts: accounts,
    _processedEvents: processedEvents,
  };
}
