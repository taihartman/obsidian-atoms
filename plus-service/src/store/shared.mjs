/**
 * Shared store helpers (memory / sqlite / postgres).
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { pkceChallengeS256 } from "./askHelpers.mjs";

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
 * #240 U2 — what `peekMagic` reports. Uniform across the three backends: the
 * same keys are present whatever the verdict, so a caller never has to tell an
 * absent field from a null one, and the parity suite compares like with like.
 *
 * @typedef {object} MagicPeek
 * @property {boolean} ok             usable, and only usable
 * @property {"usable"|"expired"|"invalid"} status
 * @property {string|null} email      the account the token signs in
 * @property {string|null} vault      the vault that requested the link (R3, R18)
 * @property {boolean} verifierBound  whether the row carries a verifier hash
 * @property {string|null} verifierHash  the stored hash, for U4's factored
 *   hash-compare — one comparison, two callers (U4's exchange and U13's peek
 *   route). `verifierBound` stays alongside it so U5's anchor gate reads a
 *   boolean rather than reasoning about null. This is an internal store value,
 *   never an HTTP response field; U13 owns keeping it off the wire.
 */

/**
 * The two ways a peek finds nothing to report. Frozen because every backend
 * hands the same object back and a caller must not be able to edit the answer
 * the next caller gets.
 *
 * `expired` deliberately carries no email or vault: the row is dead either way,
 * so there is nothing a caller can do with them, and R7 only needs "say so and
 * point at requesting a new link".
 *
 * There is no `refused` here on purpose. A refusal is decided by the route, not
 * the store: the store reports `usable` with the hash, and U13 downgrades that
 * to refused after the shared compare fails, attaching the vault it already has.
 *
 * @type {{ invalid: MagicPeek, expired: MagicPeek }}
 */
export const MAGIC_PEEK_MISS = Object.freeze({
  invalid: Object.freeze({
    ok: false,
    status: "invalid",
    email: null,
    vault: null,
    verifierBound: false,
    verifierHash: null,
  }),
  expired: Object.freeze({
    ok: false,
    status: "expired",
    email: null,
    vault: null,
    verifierBound: false,
    verifierHash: null,
  }),
});

/**
 * #240 U4 — how a caller of `exchangeMagic` states its relationship to the
 * verifier. The two fields are not two spellings of one idea, and an absent
 * `verifier` must never be read as `skipVerifierCheck`:
 *
 * - `verifier` — the plugin's `POST /v1/auth/exchange` presents what the
 *   requesting device holds. Absent (or empty) against a **bound** row is a
 *   refusal, which is exactly R5's "you are not the device that asked".
 * - `skipVerifierCheck` — the web routes say no check applies at all. U6's
 *   HTML fallback redeems **bound** tokens this way on purpose (KD9): every
 *   link a current build mints is bound, so a fallback that honoured the check
 *   would recover nothing, and KD3's cross-device recovery would be gone.
 *
 * @typedef {object} MagicExchangeOpts
 * @property {string|null} [verifier] raw verifier presented by the caller
 * @property {boolean} [skipVerifierCheck] this route is not verifier-bound
 */

/**
 * #240 U4 step 6 — **the** verifier comparison. One comparison, two callers:
 * this unit's `POST /v1/auth/exchange` abort and U13's peek route. They must
 * never disagree, because a peek that says "usable" where the exchange would
 * refuse sends the user through a tap that cannot succeed.
 *
 * A row with no stored hash matches anything, including nothing presented:
 * that is KD9's older-plugin-build path, where no check applies because no
 * device ever registered a verifier. It is **not** the mechanism that keeps
 * U6's fallback route working — that route skips the check outright, for bound
 * rows too, which is what lets it redeem the bound tokens every current build
 * mints. Two independent rules; collapsing them deletes cross-device recovery.
 *
 * A bound row with nothing presented is a mismatch, not a pass.
 *
 * @param {string|null|undefined} storedHash  the row's `verifier_hash`
 * @param {string|null|undefined} presentedVerifier  the raw verifier, if any
 * @returns {boolean} whether the exchange/peek may proceed
 */
export function verifierMatches(storedHash, presentedVerifier) {
  // U3's `optionalBoundedString` trims before storing, so the stored hash has
  // no surrounding whitespace and an empty one was normalized to null at mint —
  // null reads as unbound, never as "bound to the empty string".
  const stored = String(storedHash ?? "").trim();
  if (!stored) return true;
  const presented = String(presentedVerifier ?? "").trim();
  if (!presented) return false;
  // KTD6 — `base64url(SHA-256(verifier))`, the value the plugin sends at mint
  // time. The encoding is the contract, not an implementation detail:
  // `src/platform/pkce.ts` emits base64url, and a server that hashed to hex
  // would refuse every device without either side being individually wrong.
  // Hence the shared digest (#309) rather than a second one derived here.
  // Borrow `pkceChallengeS256` only — never `verifyPkce`, whose non-S256
  // branch is a plaintext compare this control must never accept.
  const a = Buffer.from(pkceChallengeS256(presented));
  const b = Buffer.from(stored);
  // timingSafeEqual throws on unequal lengths, and a length difference is
  // already public (the digest length is fixed), so guard rather than compare.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * #240 U4 — what a verifier-bound exchange hands back when it refuses. Frozen,
 * and deliberately carries no session, account, email, or token: a refusal must
 * be spendable by nobody and quotable into no log (R11).
 *
 * Distinguishable from the `null` an invalid or expired token returns, because
 * the plugin renders R5's "open the vault that requested this link" for one and
 * R7's "the link expired, request a new one" for the other.
 */
export const MAGIC_EXCHANGE_REFUSED = Object.freeze({
  refused: true,
  reason: "verifier_mismatch",
});

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
  /**
   * Class B — a cancellation we could not attribute to an account. We revoke
   * nothing and Stripe never retries, so the account silently keeps
   * entitlement. Own kind: this one is a *stuck grant*, not a lost one, so it
   * throttles apart from the grant-path kinds and reads differently on call.
   */
  REVOKE_MISSING_EMAIL: "revoke_missing_email",
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
 * Durable free-trial gate. Reads only `trialUsed` — never `plan === "trial"`
 * (`ensureAccount` defaults inactive rows to that plan).
 * @param {{ trialUsed?: boolean } | null | undefined} a
 */
export function accountHasUsedTrial(a) {
  return Boolean(a?.trialUsed);
}

/**
 * Map a DB row (snake_case) or in-memory account to the store account shape.
 * @param {Record<string, unknown> | null | undefined} r
 */
export function rowToAccount(r) {
  if (!r) return null;
  const periodEnd = r.periodEnd ?? r.period_end;
  const rawUsed = r.trialUsed ?? r.trial_used;
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
    trialUsed: Boolean(rawUsed === true || rawUsed === 1 || rawUsed === "1"),
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

/**
 * Has this account's billing/trial period ended?
 *
 * The period boundary is the only thing that tells the two meanings of
 * `exhausted` apart — see `subscriptionLive`.
 *
 * @param {{ periodEnd?: unknown } | null | undefined} a
 * @param {number} [now]
 */
export function periodEnded(a, now = Date.now()) {
  if (!a) return true;
  const end = new Date(a.periodEnd).getTime();
  if (!Number.isFinite(end)) return true; // unreadable period → fail closed
  return end < now;
}

/**
 * Is the subscription still live — i.e. may this account use Ask/MCP?
 *
 * `exhausted` covers two unrelated situations, and only one of them revokes
 * anything:
 *
 * - the period **ended** (`applyStatusRules` above) — revokes; the user has to
 *   renew, and #442/#443 built the client story around telling them so
 * - this period's filing allotment is **spent** (the meter's UPDATE, e.g.
 *   `postgres.mjs`) — revokes nothing. Reading a brain that is already mirrored
 *   and already paid for has nothing to do with the filing meter.
 *
 * The period check comes first on purpose, mirroring `applyStatusRules`' own
 * precedence: a past `periodEnd` is not live whatever `status` still says. That
 * matters because callers reach this both after `refreshAccountStatus` (the MCP
 * token path) and straight off `getAccount` (the OAuth connect path), and only
 * the former has normalized `status` first.
 *
 * `unknown` and `inactive` stay out — this widens `exhausted` only.
 *
 * @param {{ status?: unknown, periodEnd?: unknown } | null | undefined} a
 * @param {number} [now]
 */
export function subscriptionLive(a, now = Date.now()) {
  if (!a) return false;
  const st = String(a.status || "");
  if (st !== "active" && st !== "trialing" && st !== "exhausted") return false;
  return !periodEnded(a, now);
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
