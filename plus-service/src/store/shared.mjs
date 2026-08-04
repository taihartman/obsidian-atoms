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

/**
 * How long a checkout→session binding stays claimable. Stripe Checkout
 * Sessions expire after 24h, so a binding outliving that is only replay surface.
 */
export const CHECKOUT_BINDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Epoch ms from a number / Date / ISO string, else `fallback`. */
export function toMs(v, fallback = 0) {
  if (v == null) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isNaN(ms) ? fallback : ms;
}

/** Longest incident detail we keep — it is an ops hint, not a payload (KTD7). */
export const INCIDENT_DETAIL_MAX = 300;

/**
 * Every `stripe_incidents` kind, in one place. The kind is the alert throttle
 * key *and* part of the unique key `(kind, day_bucket, stripe_id)`, so a typo
 * at a call site does not error — it silently opens a fresh undeduped bucket.
 * These strings are persisted; never change a value, only add a key.
 */
export const INCIDENT_KIND = Object.freeze({
  /** Class A — signature never verified, so there is no Stripe id to key on. */
  WEBHOOK_REJECT: "webhook_reject",
  /** Class B — checkout session carried no usable email. */
  MISSING_EMAIL: "missing_email",
  /** Class B — free-form customer email disagrees with plugin metadata. */
  EMAIL_MISMATCH: "email_mismatch",
  /** Class B — line item price is not in the allowlist. */
  UNKNOWN_PRICE: "unknown_price",
  /** Class B — paid renewal invoice with no resolvable email (throttles apart). */
  INVOICE_MISSING_EMAIL: "invoice_missing_email",
  /** Class C — Stripe delivered the event; we never processed it (#238 sweep). */
  MISSING_WEBHOOK: "missing_webhook",
});

/**
 * Normalize a `recordStripeIncident` call into its stored shape.
 * KTD2: the UTC `dayBucket` is derived at write time and is part of the unique
 * key, so a class-A flood (no parseable Stripe id → empty string) collapses to
 * one row per kind per day instead of one row per anonymous request.
 * `opts.now` is the injectable clock (tests); production omits it.
 */
export function normalizeStripeIncident(kind, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  return {
    kind: String(kind),
    stripeId: String(opts.stripeId ?? ""),
    email: opts.email ? String(opts.email).trim().toLowerCase() : null,
    detail: opts.detail ? String(opts.detail).slice(0, INCIDENT_DETAIL_MAX) : null,
    dayBucket: new Date(now).toISOString().slice(0, 10),
    now,
  };
}

/**
 * Map a `stripe_incidents` row (snake_case, or an in-memory row) to the public
 * incident shape. Timestamps come back as ISO strings on every backend.
 * @param {Record<string, unknown> | null | undefined} r
 */
export function rowToIncident(r) {
  if (!r) return null;
  const iso = (v) =>
    v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  return {
    id: r.id,
    kind: r.kind,
    dayBucket: r.dayBucket ?? r.day_bucket,
    stripeId: r.stripeId ?? r.stripe_id ?? "",
    email: (r.email ?? null) || null,
    detail: (r.detail ?? null) || null,
    occurrences: Number(r.occurrences ?? 0),
    firstSeenAt: iso(r.firstSeenAt ?? r.first_seen_at),
    lastSeenAt: iso(r.lastSeenAt ?? r.last_seen_at),
    alertedAt: iso(r.alertedAt ?? r.alerted_at ?? null),
  };
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
