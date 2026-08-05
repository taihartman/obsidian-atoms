/**
 * POST /api/subscribe — Atoms Notes list signup (same-origin).
 * Env (Pages secrets): RESEND_API_KEY, ATOMS_NOTES_FROM, RESEND_MARKETING_SEGMENT_ID,
 *   ATOMS_NOTES_POSTAL_ADDRESS, optional ATOMS_NOTES_REPLY_TO, ATOMS_NOTES_KILL_SWITCH,
 *   ATOMS_NOTES_UNSUB_SECRET (HMAC for unsubscribe links).
 */
import {
  CODES,
  checkRateLimit,
  clientIpFromHeaders,
  parseSubscribeBody,
} from "../_lib/subscribeCore.mjs";
import {
  sendWelcomeEmail,
  upsertMarketingContact,
} from "../_lib/resendMarketing.mjs";

/** @type {Map<string, number[]>} */
const rateStore = new Map();

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function b64url(buf) {
  const b =
    typeof Buffer !== "undefined"
      ? Buffer.from(buf).toString("base64")
      : btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(sig);
}

async function unsubUrlFor(env, email, origin) {
  const secret = env.ATOMS_NOTES_UNSUB_SECRET || env.RESEND_API_KEY || "dev";
  const t = await hmacSign(secret, `unsub:${email}`);
  const u = new URL("/api/unsubscribe", origin);
  u.searchParams.set("e", email);
  u.searchParams.set("t", t);
  return u.toString();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (env.ATOMS_NOTES_KILL_SWITCH === "1" || env.ATOMS_NOTES_KILL_SWITCH === "true") {
    return json(503, { ok: false, code: CODES.killed });
  }

  const apiKey = env.RESEND_API_KEY;
  const from = env.ATOMS_NOTES_FROM;
  const segmentId = env.RESEND_MARKETING_SEGMENT_ID;
  const postal = env.ATOMS_NOTES_POSTAL_ADDRESS;

  if (!apiKey || !from || !segmentId || !postal) {
    console.error("[atoms-notes] missing env");
    return json(503, { ok: false, code: CODES.upstream_error });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, code: CODES.invalid_email });
  }

  const parsed = parseSubscribeBody(body);
  if (!parsed.ok) {
    if (parsed.code === CODES.honeypot) {
      return json(200, { ok: true, code: CODES.ok_new });
    }
    return json(400, { ok: false, code: parsed.code });
  }

  const ip = clientIpFromHeaders(request.headers);
  const rlIp = checkRateLimit(rateStore, `ip:${ip}`, { limit: 10 });
  if (!rlIp.ok) {
    return json(429, { ok: false, code: CODES.rate_limited }, {
      "retry-after": String(rlIp.retryAfterSec),
    });
  }
  const rlEmail = checkRateLimit(rateStore, `email:${parsed.email}`, { limit: 5 });
  if (!rlEmail.ok) {
    return json(429, { ok: false, code: CODES.rate_limited }, {
      "retry-after": String(rlEmail.retryAfterSec),
    });
  }

  const contact = await upsertMarketingContact({
    apiKey,
    email: parsed.email,
    segmentId,
  });
  if (!contact.ok) {
    console.error("[atoms-notes] contact", contact.status, contact.detail);
    return json(502, { ok: false, code: CODES.upstream_error });
  }

  const origin = new URL(request.url).origin;
  const unsubUrl = await unsubUrlFor(env, parsed.email, origin);
  const welcome = await sendWelcomeEmail({
    apiKey,
    email: parsed.email,
    from,
    replyTo: env.ATOMS_NOTES_REPLY_TO || undefined,
    postalAddress: postal,
    unsubUrl,
  });
  if (!welcome.ok) {
    console.error("[atoms-notes] welcome", welcome.status, welcome.detail);
    // On-list still success (R10b)
  }

  return json(200, {
    ok: true,
    code: contact.created ? CODES.ok_new : CODES.ok_existing,
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json(405, { ok: false, code: "method_not_allowed" });
}
