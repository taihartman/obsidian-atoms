import { COOKIE_NAME } from "./constants.mjs";
import { isProduction } from "../prodGate.mjs";

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  const raw = req.headers.cookie || "";
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} browserSessionId
 * @param {number} maxAgeSec
 */
export function setBrowserSessionCookie(res, browserSessionId, maxAgeSec = 900) {
  const secure = isProduction() ? "; Secure" : "";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(browserSessionId)}`,
    "Path=/oauth",
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "SameSite=Lax",
    secure,
  ];
  // Also set path=/ so exchange can set cookie before redirect to /oauth
  const partsRoot = [
    `${COOKIE_NAME}=${encodeURIComponent(browserSessionId)}`,
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "SameSite=Lax",
    secure,
  ];
  res.setHeader("set-cookie", [
    parts.filter(Boolean).join("; "),
    partsRoot.filter(Boolean).join("; "),
  ]);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function getBrowserSessionId(req) {
  return parseCookies(req)[COOKIE_NAME] || "";
}
