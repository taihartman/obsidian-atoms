/**
 * Pure helpers for Atoms Notes signup (no network).
 * Used by Pages Function and unit tests.
 */

/** @param {string} raw */
export function normalizeEmail(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Practical validation — not full RFC.
 * @param {string} email
 */
export function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  if (email.includes("..")) return false;
  const m = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.exec(email);
  if (!m) return false;
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length > 64) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

/**
 * Sliding-window rate limit (injectable store + clock for tests).
 * @param {Map<string, number[]>} store
 * @param {string} key
 * @param {{ limit?: number, windowMs?: number, now?: number }} [opts]
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function checkRateLimit(store, key, opts = {}) {
  const limit = opts.limit ?? 8;
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now();
  let arr = store.get(key) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    store.set(key, arr);
    const oldest = arr[0] || now;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }
  arr.push(now);
  store.set(key, arr);
  return { ok: true };
}

/**
 * @param {Headers | Record<string, string | undefined>} headers
 */
export function clientIpFromHeaders(headers) {
  const get =
    typeof headers.get === "function"
      ? (k) => headers.get(k)
      : (k) => headers[k] ?? headers[k.toLowerCase()];
  const xf = get("cf-connecting-ip") || get("x-forwarded-for") || get("x-real-ip");
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return "unknown";
}

export const CODES = {
  ok_new: "ok_new",
  ok_existing: "ok_existing",
  invalid_email: "invalid_email",
  rate_limited: "rate_limited",
  upstream_error: "upstream_error",
  killed: "killed",
  honeypot: "honeypot",
};

/**
 * @param {{ email?: string, website?: string }} body honeypot field `website`
 * @returns {{ ok: true, email: string } | { ok: false, code: string }}
 */
export function parseSubscribeBody(body) {
  if (body && typeof body.website === "string" && body.website.trim()) {
    return { ok: false, code: CODES.honeypot };
  }
  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email)) {
    return { ok: false, code: CODES.invalid_email };
  }
  return { ok: true, email };
}
