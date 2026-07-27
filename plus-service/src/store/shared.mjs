/**
 * Shared store helpers (memory / sqlite / postgres).
 */
import { randomBytes, createHash } from "node:crypto";

export function id(prefix) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function periodEndFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/** Public entitlement shape returned by /v1/me and auth exchange. */
export function publicAccount(a) {
  return {
    email: a.email,
    status: a.status,
    remaining: a.remaining,
    periodEnd: a.periodEnd,
    plan: a.plan,
  };
}

/**
 * Map a DB row (snake_case) or in-memory account to the store account shape.
 * @param {Record<string, unknown> | null | undefined} r
 */
export function rowToAccount(r) {
  if (!r) return null;
  const periodEnd = r.periodEnd ?? r.period_end;
  return {
    email: r.email,
    status: r.status,
    remaining: r.remaining,
    periodEnd:
      periodEnd instanceof Date ? periodEnd.toISOString() : String(periodEnd),
    plan: r.plan,
    promoRedemptions: r.promoRedemptions ?? r.promo_redemptions ?? 0,
    stripeCustomerId:
      (r.stripeCustomerId ?? r.stripe_customer_id) || undefined,
    stripeSubscriptionId:
      (r.stripeSubscriptionId ?? r.stripe_subscription_id) || undefined,
  };
}

/**
 * Apply period-expiry / zero-remaining status rules on a mutable account object.
 * @returns {{ dirty: boolean }}
 */
export function applyStatusRules(a) {
  if (!a) return { dirty: false };
  let dirty = false;
  if (a.status !== "inactive" && new Date(a.periodEnd) < new Date()) {
    a.status = "exhausted";
    a.remaining = 0;
    dirty = true;
  } else if (a.remaining <= 0 && a.status !== "inactive") {
    a.status = "exhausted";
    dirty = true;
  }
  return { dirty };
}

/** Entitled accounts must not receive sess_ from unauthenticated auth/start. */
export function isEntitledAccount(a) {
  if (!a) return false;
  if (a.stripeCustomerId) return true;
  const st = String(a.status || "");
  return st === "active" || st === "trialing" || st === "exhausted";
}

/**
 * Resolve Checkout grant email.
 * Prefer server-set metadata.email / client_reference_id (plugin Checkout).
 * If free-form customer email disagrees with that target → fail closed.
 * Payment Links without metadata fall back to customer_details / customer_email.
 * @returns {{ email: string } | { mismatch: true, email?: string } | { missing: true }}
 */
export function resolveCheckoutGrantEmail(obj) {
  const norm = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();
  const meta = norm(obj?.metadata?.email);
  const cref = norm(obj?.client_reference_id);
  const cust = norm(obj?.customer_email);
  const details = norm(obj?.customer_details?.email);
  const target = meta || cref;
  if (target) {
    for (const free of [cust, details]) {
      if (free && free !== target) {
        return { mismatch: true, email: target };
      }
    }
    return { email: target };
  }
  const fallback = cust || details;
  if (!fallback) return { missing: true };
  return { email: fallback };
}
