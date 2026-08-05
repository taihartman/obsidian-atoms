/**
 * Simple sliding-window rate limit (in-process).
 */
import { config } from "./config.mjs";

/** @type {Map<string, number[]>} */
const hits = new Map();

/**
 * @param {string} key
 * @param {number} [limit]
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function checkRateLimit(key, limit = config.rateLimitPerMinute) {
  const now = Date.now();
  const windowMs = 60_000;
  let arr = hits.get(key) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    const oldest = arr[0] || now;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }
  arr.push(now);
  hits.set(key, arr);
  return { ok: true };
}

/**
 * #240 KTD10 — every unauthenticated magic-token surface, its key prefix, and
 * its ceiling. Declared in one table because a control claimed by several units
 * and owned by none ships as nothing.
 *
 * **Distinct prefixes are the load-bearing part.** A non-consuming check is an
 * unauthenticated oracle on token validity, and the landing page is the surface
 * mail scanners, link previewers and repeat page loads hit without anyone
 * asking. Sharing a key with the deliberate POSTs would let that undirected
 * noise 429 the human's "Sign in here" button and the plugin's peek — the
 * outage the limit exists to prevent, caused by the limit.
 *
 * **Why these numbers, given what the mechanism actually is.** Two properties
 * of the machinery above bound how much any ceiling can be worth:
 *
 * - `clientIp` returns the first element of a **client-supplied**
 *   `x-forwarded-for`. The key is forgeable in both directions: an attacker can
 *   rotate to evade a ceiling entirely, and can aim requests at a *victim's*
 *   bucket to exhaust it. So this is not an authorization control and nothing
 *   may depend on it for correctness. What protects a token is that it is
 *   unguessable; this is a brake on undirected volume.
 * - The window is a module-level in-process `Map`, so a ceiling is
 *   per-instance. Across N instances the effective ceiling is N×limit — another
 *   reason to pick numbers whose exact value does not matter.
 *
 * So the ceilings sit well above any plausible human or plugin sequence. The
 * dominant realistic failure here is not an attacker walking past a ceiling —
 * they can rotate the header — it is a legitimate user throttled by *someone
 * else's* traffic on an address they share: office NAT, carrier CGNAT, or a
 * forged header aimed at them on purpose. Tightening the numbers buys nothing
 * against the first and costs directly against the second, and a magic token is
 * 32 bytes of entropy, so no ceiling is what stands between it and a guess.
 * A bot looping one link still meets a wall, which is all these are for.
 *
 * The landing page sits highest because it is the only surface that receives
 * traffic nobody asked for — prefetches, previews, scanners, reloads — and is
 * non-consuming, so nothing is lost by being generous with it.
 */
export const MAGIC_LINK_RATE_LIMITS = Object.freeze({
  /** U5's landing GET: non-consuming, and the surface bots actually touch. */
  landing: Object.freeze({ key: "mlweb", limit: 60 }),
  /** U13's peek: one per tap, plus retries and a multi-vault device. */
  peek: Object.freeze({ key: "mlpeek", limit: 30 }),
  /** U4's plugin exchange: spends the link; several vaults may share an IP. */
  exchange: Object.freeze({ key: "mlx", limit: 30 }),
  /** U6's fallback form: a deliberate button press, on a shared address. */
  fallback: Object.freeze({ key: "mlfb", limit: 30 }),
});

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
