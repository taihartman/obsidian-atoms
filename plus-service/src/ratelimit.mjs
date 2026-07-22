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

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
