/**
 * Atoms Plus HTTP API — matches plugin plusClient paths.
 *
 * Env: ANTHROPIC_API_KEY (required for classify), PORT, DOGFOOD_AUTO_GRANT,
 *      STRIPE_* (optional — real Checkout when set). Loads ../.env if present.
 * Start: npm start (from plus-service/)
 */

import "./loadEnv.mjs";
import { createServer } from "node:http";
import { config } from "./config.mjs";
import { createStore } from "./store.mjs";
import { proxyClassify } from "./anthropic.mjs";
import {
  applyStripeEvent,
  constructEvent,
  createCheckoutSession,
  createPortalSession,
  stripeConfigured,
} from "./stripe.mjs";
import {
  allowDogfoodCheckout,
  assertProductionReady,
  isProduction,
} from "./prodGate.mjs";
import { sendMagicLinkEmail } from "./email.mjs";
import {
  accountFingerprint,
  INCIDENT_KIND,
  verifierMatches,
} from "./store/shared.mjs";
import { alertStripeIncident } from "./alert.mjs";
import {
  MAGIC_LINK_RATE_LIMITS,
  checkRateLimit,
  clientIp,
} from "./ratelimit.mjs";
import { handleMirrorRoutes } from "./mirror/http.mjs";
import { handleMcpRequest } from "./mcp/handler.mjs";
import {
  handleOauthRoutes,
  maybeFinishOauthAfterExchange,
} from "./oauth/routes.mjs";

try {
  assertProductionReady();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const store = await createStore();

/** Browser (Obsidian fetch) CORS — must allow Idempotency-Key or POST preflight fails. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "content-type, authorization, idempotency-key, x-idempotency-key, accept, mcp-protocol-version, mcp-method, mcp-name",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extraHeaders] per-route headers, e.g. #240
 *   U13's `cache-control: no-store` on a response that names an account.
 */
function json(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(data);
}

/** Default JSON/API body cap (H2). Stripe webhooks stay under this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 */
function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
      req.destroy();
    };
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        const err = new Error("body_too_large");
        err.status = 413;
        fail(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (e) => fail(e));
  });
}

function readBody(req) {
  return readRawBody(req).then((raw) => {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("invalid json");
    }
  });
}

function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : "";
}

/**
 * #240 U6 — the fallback's own route. Named once so the form's `action` and the
 * route that answers it cannot drift apart.
 */
const FALLBACK_EXCHANGE_PATH = "/v1/auth/exchange/fallback";

/**
 * #240 U13 — every `POST /v1/auth/peek` response carries this, not only the
 * `usable` one that names an account. A caching rule that depends on the
 * verdict is a rule no intermediary — and no reviewer — can check at a glance.
 */
const NO_STORE = Object.freeze({ "cache-control": "no-store" });

/**
 * #240 U13 / KTD10 — the throttle for one magic-token surface. `surface` is a
 * key of `MAGIC_LINK_RATE_LIMITS`, so the prefixes stay distinct by
 * construction and a typo is `undefined` at boot rather than a fifth anonymous
 * bucket silently shared with nothing.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {keyof typeof MAGIC_LINK_RATE_LIMITS} surface
 */
function magicRateLimit(req, surface) {
  const { key, limit } = MAGIC_LINK_RATE_LIMITS[surface];
  return checkRateLimit(`${key}:${clientIp(req)}`, limit);
}

/** #240 U3 — base64url sha256 of the device verifier (43 chars); slack over it. */
const MAX_VERIFIER_HASH_CHARS = 128;
/** #240 U4 — 32 random bytes base64url is 43 chars; the ceiling is generous. */
const MAX_VERIFIER_CHARS = 256;
/** #240 U3 — an Obsidian vault name is a folder name, not prose. */
const MAX_VAULT_NAME_CHARS = 256;

/**
 * #240 U3 — an optional bounded string from a request body. Absent is fine: an
 * older plugin build sends neither field and must keep working. Anything that
 * is present but not a bounded string is a 400 rather than something we store,
 * since both values sit beside the magic token until it dies (KD7).
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {{ ok: true, value: string | null } | { ok: false }}
 */
function optionalBoundedString(value, max) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false };
  return { ok: true, value: trimmed };
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * #240 — the twin of the plugin's `sanitizeVaultLabel`, for the one surface the
 * plugin never sees. `escHtml` stops markup, but a vault name is *prose chosen
 * by whoever minted the link*, and the two things markup-escaping does not
 * touch are length and invisible reordering: the zero-width ranges and the bidi
 * overrides render as nothing while rearranging the text around them. That is
 * how "requested by X" gets to read as a vault the visitor trusts. Stripped and
 * capped at render rather than rejected at mint, so no legitimate non-Latin
 * vault name is ever turned away.
 */
const VAULT_LABEL_CONTROL_CHARS =
  /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]+/g;

export function vaultLabel(raw) {
  const flat = String(raw ?? "")
    .replace(VAULT_LABEL_CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/**
 * #240 U5 — headers every magic-link landing render carries.
 *
 * The CSP keeps `default-src 'none'` with inline styles, and no script is ever
 * added (KTD4). `form-action 'self'` is stated explicitly for U6's fallback
 * form: `default-src` is not a fallback for `form-action`, so the submit was
 * already permitted — naming it pins the only destination the form may ever
 * post to rather than leaving that to a directive that does not govern it.
 * `no-store` is load-bearing — R14 makes this page deliberately re-loadable and
 * its body carries a live `obsidian://…token=` anchor and, after a submit, a
 * session token, so a cached copy is a cached credential sitting in a shared or
 * in-app browser cache.
 */
const LANDING_HEADERS = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

function writeLanding(res, status, bodyHtml) {
  res.writeHead(status, { ...LANDING_HEADERS });
  res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
${bodyHtml}
</body>`);
}

/**
 * R7 — the link is expired, already spent, or never existed. All three collapse
 * to one message on purpose: the page cannot tell a stranger's guess from the
 * user's own stale link, and the remedy is the same either way.
 */
function renderDeadLink(
  res,
  {
    title = "Link expired",
    detail = "Request a new sign-in link from Atoms Settings.",
    // #240 U13 — the same two-line page serves the throttle, which is not a
    // verdict about the link and must not answer 400.
    status = 400,
  } = {},
) {
  writeLanding(res, status, `<h1>${escHtml(title)}</h1>
<p>${escHtml(detail)}</p>`);
}

/**
 * #240 U5/U6 seam — the fallback that signs in without the handoff.
 *
 * U5 owns the block's identity (`id="fallback"`), its copy, and its position:
 * demoted below the troubleshooting details when a handoff was offered (R10),
 * promoted to primary when the token is unbound and no handoff exists. U6 fills
 * it with the `<form method="post">` that mints a pasteable session on an
 * explicit submit (R17) — a form, not a link, because mail scanners and
 * prefetchers issue GETs and a POST requires the human (KTD5).
 *
 * @param {{ promoted: boolean, token: string }} opts
 */
function fallbackBlockHtml({ promoted, token }) {
  const lead = promoted
    ? "This link was requested by an older version of Atoms, which cannot hand the sign-in to Obsidian. Update Atoms and request a new link, or sign in here instead."
    : "On a different device from the one running Obsidian? Sign in here and paste the result into Atoms Settings.";
  return `<section id="fallback" style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #e4e4e7">
<h2 style="font-size:1rem;margin:0 0 .5rem">Sign in without the handoff</h2>
<p style="color:#666;font-size:0.9rem">${escHtml(lead)}</p>
<form method="post" action="${FALLBACK_EXCHANGE_PATH}">
<input type="hidden" name="token" value="${escHtml(token)}">
<button type="submit" style="display:block;box-sizing:border-box;width:100%;min-height:44px;padding:14px 16px;border-radius:10px;border:1px solid #7c3aed;background:#fff;color:#7c3aed;font-weight:600;font-size:1rem">Sign in here</button>
</form>
</section>`;
}

/**
 * #240 U6 — the session the fallback just minted, for pasting into Settings.
 *
 * R15 — the copy this replaces ended by telling the user to switch back to
 * Obsidian and tap **Refresh status**, which is the no-op by construction this
 * whole issue exists because of. U11 removes that sentence from the plugin;
 * nothing else removes it from here.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {{ session: string, account: any }} out
 */
function renderFallbackSession(res, out) {
  const pub = store.publicAccount(out.account);
  writeLanding(
    res,
    200,
    `<h1>Signed in</h1>
<p>Email: <strong>${escHtml(pub.email)}</strong></p>
<p>Status: <strong>${escHtml(pub.status)}</strong> · remaining ${escHtml(String(pub.remaining))}</p>
<p>Copy the session below, then in Obsidian open <strong>Settings → Atoms Plus → Advanced: paste session</strong> and paste it there.</p>
<p style="word-break:break-all;font-family:ui-monospace,monospace;background:#f4f4f5;border-radius:8px;padding:12px">${escHtml(out.session)}</p>
<p style="color:#666;font-size:0.9rem">This session signs in the vault you paste it into. Treat it like a password, and close this page when you are done.</p>`,
  );
}

/**
 * R8 — both remedies, distinctly, for the user who tapped and saw nothing. The
 * page renders once and cannot observe the outcome (R14), so this is a native
 * `<details>` present in the initial HTML rather than any kind of transition.
 */
const TROUBLESHOOTING_HTML = `<details style="margin-top:1.5rem">
<summary style="cursor:pointer;color:#666">Tapped it and nothing came forward?</summary>
<ul style="color:#444;font-size:0.95rem;line-height:1.5">
<li><strong>Obsidian is on another device.</strong> Open this email again on the device running Obsidian, and tap there.</li>
<li><strong>Obsidian is on this device.</strong> Your mail app's built-in browser blocks links that open other apps. Open this page in your system browser and tap again, or use the sign-in option further down this page.</li>
</ul>
</details>`;

/**
 * #240 U5 — the pre-tap landing page for a token that can actually complete the
 * handoff. Nothing here asserts an outcome: it states what is true at render
 * time and stops (R14). No session is minted or printed (R11, R17).
 *
 * @param {import("node:http").ServerResponse} res
 * @param {{ token: string, vault: string | null }} link
 */
function renderHandoffPage(res, { token, vault }) {
  // KD7 — the vault rides along so a multi-vault device signs the right one in.
  // Absent for a link minted before U3, which must render without it rather
  // than printing an empty parameter or the word "undefined".
  const href = `obsidian://atoms-signin?token=${encodeURIComponent(token)}${
    vault ? `&vault=${encodeURIComponent(vault)}` : ""
  }`;
  const who = vault
    ? `<p>This link was requested by <strong>${escHtml(vaultLabel(vault))}</strong>.</p>`
    : `<p>This link was requested from Atoms in Obsidian.</p>`;
  writeLanding(
    res,
    200,
    `<h1>Finish signing in</h1>
${who}
<a href="${escHtml(href)}" style="display:block;box-sizing:border-box;min-height:44px;padding:14px 16px;margin:1.25rem 0;border-radius:10px;background:#7c3aed;color:#fff;font-weight:600;text-align:center;text-decoration:none">Open Obsidian</a>
<p style="color:#666;font-size:0.9rem">Obsidian will ask you to confirm first.</p>
${TROUBLESHOOTING_HTML}
${fallbackBlockHtml({ promoted: false, token })}`,
  );
}

/**
 * KD9 — the token carries no verifier hash, so it was minted by a plugin build
 * that cannot complete U4's bound exchange. Offering the handoff here would be
 * a dead end, so the fallback takes the primary position and the troubleshooting
 * block is omitted: there is no button whose silence needs explaining.
 */
function renderUnboundPage(res, { token }) {
  writeLanding(
    res,
    200,
    `<h1>Finish signing in</h1>
${fallbackBlockHtml({ promoted: true, token })}`,
  );
}

async function handler(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...CORS_HEADERS,
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }

  try {
    // Health — minimal in production (less recon)
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      if (isProduction()) {
        return json(res, 200, { ok: true, service: "atoms-plus" });
      }
      return json(res, 200, {
        ok: true,
        service: "atoms-plus",
        dogfoodAutoGrant: config.dogfoodAutoGrant,
        includedFilings: config.includedFilings,
        hasAnthropicKey: Boolean(config.anthropicApiKey),
        stripe: stripeConfigured(),
        store: store.kind || "unknown",
      });
    }

    // GET /v1/billing/return — browser land after Checkout
    if (req.method === "GET" && path === "/v1/billing/return") {
      const ok = url.searchParams.get("ok") !== "0";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>${ok ? "You're set" : "Checkout canceled"}</h1>
<p>${
        ok
          ? "Switch back to <strong>Obsidian</strong> — Atoms Plus updates automatically (or tap Refresh status). Checkout email must match the email you entered in the plugin."
          : "No charge. Open Atoms → Finish trial setup to try again."
      }</p>
${
  ok
    ? `<p style="color:#666;font-size:0.9rem">Lost your session on this device? Request a sign-in link from Atoms Settings (same email).</p>`
    : ""
}
</body>`);
      return;
    }

    // POST /v1/auth/start — soft account + sess_ (inactive only)
    if (req.method === "POST" && path === "/v1/auth/start") {
      const body = await readBody(req);
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!email || !email.includes("@")) {
        return json(res, 400, { message: "Valid email required" });
      }
      const rlIp = checkRateLimit(`start:${clientIp(req)}`);
      if (!rlIp.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rlIp.retryAfterSec,
        });
      }
      const rlEm = checkRateLimit(`start:${email}`);
      if (!rlEm.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rlEm.retryAfterSec,
        });
      }
      if (typeof store.startWithEmail !== "function") {
        return json(res, 503, { message: "Start not available" });
      }
      const out = await store.startWithEmail(email);
      if (!out.ok) {
        return json(res, 409, {
          needsMagicLink: true,
          email: out.account.email,
          status: out.account.status,
          message: "Sign in with a magic link for this email",
        });
      }
      const pub = store.publicAccount(out.account);
      return json(res, 200, {
        session: out.session,
        sessionToken: out.session,
        email: pub.email,
        status: pub.status,
        remaining: pub.remaining,
        periodEnd: pub.periodEnd,
        plan: pub.plan,
      });
    }

    // POST /v1/billing/webhook — raw body + Stripe-Signature
    if (req.method === "POST" && path === "/v1/billing/webhook") {
      const raw = await readRawBody(req);
      /** #238 — the row this delivery produced, if any (class A or class B). */
      let incident = null;
      try {
        const event = constructEvent(raw, req.headers["stripe-signature"]);
        const result = await applyStripeEvent(store, event);
        // Keep the incident row out of the wire response.
        const { incident: recorded, ...payload } = result;
        incident = recorded || null;
        console.log(
          `[plus] stripe webhook ${event.type} → ${result.action || "ok"}${result.email ? ` ${result.email}` : ""}`,
        );
        json(res, 200, { received: true, ...payload });
      } catch (err) {
        const status = err?.status && err.status >= 400 ? err.status : 400;
        const msg = err instanceof Error ? err.message : "webhook error";
        console.error("[plus] webhook reject", msg);
        // Class A: signature never verified, so there is no Stripe id to key
        // on. The empty id collapses the flood to one row per kind per day
        // (KTD2) — but collapsing *rows* is not collapsing *writes*: every
        // anonymous reject still UPSERTs the same `(webhook_reject, today, "")`
        // row, so a flood serializes on one Postgres row lock and can drain the
        // pool. Rate-limit the reject path only. A verified Stripe delivery
        // never reaches here, so a real webhook can never be throttled, and the
        // response the caller gets is identical either way.
        const rlReject = checkRateLimit(`webhook_reject:${clientIp(req)}`);
        if (rlReject.ok) {
          try {
            incident = await store.recordStripeIncident(
              INCIDENT_KIND.WEBHOOK_REJECT,
              {
                stripeId: "",
                detail: msg,
              },
            );
          } catch (recErr) {
            console.error(
              "[plus] incident record failed webhook_reject",
              recErr instanceof Error ? recErr.message : "err",
            );
          }
        }
        json(res, status, { message: msg });
      }
      // Alert after the response is written, and never fire-and-forget: an
      // unhandled Resend rejection would take the process down (#238 U3).
      try {
        await alertStripeIncident(store, incident);
      } catch (alertErr) {
        console.error(
          "[plus] stripe alert failed",
          alertErr instanceof Error ? alertErr.message : "err",
        );
      }
      return;
    }

    // POST /v1/auth/magic-link
    if (req.method === "POST" && path === "/v1/auth/magic-link") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return json(res, 400, { message: "Valid email required" });
      }
      // #240 U3 — the requesting device's verifier hash (R12) and the vault
      // that asked for the link (R3). Optional, and never logged.
      const verifierHash = optionalBoundedString(
        body.verifierHash,
        MAX_VERIFIER_HASH_CHARS,
      );
      if (!verifierHash.ok) {
        return json(res, 400, { message: "Invalid verifierHash" });
      }
      // The only producer is the plugin's `s256Challenge`, which emits an
      // unpadded base64url SHA-256 — always 43 characters. Anything else cannot
      // be matched by `verifierMatches` at exchange time, so storing it would
      // only mint a link that is guaranteed to refuse. Fail at the door instead.
      if (
        verifierHash.value &&
        !/^[A-Za-z0-9_-]{43}$/.test(verifierHash.value)
      ) {
        return json(res, 400, { message: "Invalid verifierHash" });
      }
      const vault = optionalBoundedString(body.vault, MAX_VAULT_NAME_CHARS);
      if (!vault.ok) {
        return json(res, 400, { message: "Invalid vault" });
      }
      const rl = checkRateLimit(`ml:${clientIp(req)}`);
      if (!rl.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rl.retryAfterSec,
        });
      }
      const rlEm = checkRateLimit(`ml:${email}`);
      if (!rlEm.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rlEm.retryAfterSec,
        });
      }
      const token = await store.createMagicToken(email, {
        verifierHash: verifierHash.value,
        vault: vault.value,
      });
      // Browser-openable GET exchange (email click). Dev alias still works.
      const link = `${config.publicBaseUrl}/v1/auth/exchange?token=${encodeURIComponent(token)}`;
      const sent = await sendMagicLinkEmail({ to: email, link });
      if (!sent.ok) {
        return json(res, 503, {
          message: sent.message || "Could not send sign-in email",
        });
      }
      return json(res, 200, { ok: true });
    }

    // POST /v1/auth/sign-out
    if (req.method === "POST" && path === "/v1/auth/sign-out") {
      const session = bearer(req);
      if (session && store.revokeSession) await store.revokeSession(session);
      return json(res, 200, { ok: true });
    }

    // POST /v1/auth/sign-out-all — #320 R3/R4/R10. Path matching is `===`, so
    // the sibling above never claims this one.
    if (req.method === "POST" && path === "/v1/auth/sign-out-all") {
      // KTD5 — deliberately stricter than that sibling, which answers 200 to
      // anything, including no header at all. Per-device sign-out is idempotent
      // cleanup and a wrong token costs nothing. This revokes an entire
      // account's access including its connected apps, so a caller who is not
      // who they say they are has to be told no, rather than told "ok" about
      // something that did not happen to them.
      const a = await store.accountFromSession(bearer(req), {
        requireVerified: true,
      });
      if (!a) {
        return json(res, 401, {
          message: "Sign in with a magic link to sign out all devices",
        });
      }
      // KTD6 — keyed on the authenticated account rather than the IP. What is
      // worth bounding is session farming against one account, and the caller's
      // own session dies on the first success, so a repeat call 401s above
      // before it ever reaches this line.
      const rl = checkRateLimit(`signout_all:${a.email}`);
      if (!rl.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rl.retryAfterSec,
        });
      }
      // R10 — all three, or "sign out all devices" is a claim the product does
      // not honour. Connected apps authenticate off their own MCP grants and
      // not off the sessions table, and a live checkout binding can resurrect
      // one session hours later.
      const revoked = await store.revokeAllSessionsForEmail(a.email);
      if (store.mcpRevokeForEmail) await store.mcpRevokeForEmail(a.email);
      if (store.clearCheckoutBindingsForEmail) {
        await store.clearCheckoutBindingsForEmail(a.email);
      }
      console.log(
        `[plus] sign-out-all ${accountFingerprint(a.email)} sessions=${revoked}`,
      );
      return json(res, 200, { ok: true }, NO_STORE);
    }

    // #240 U5 — `GET /v1/auth/dev-exchange` is gone. It was a zero-caller
    // duplicate of the body below that 404'd in production anyway, and a
    // diverged duplicate of this exact logic is what #230 was. `allowDevExchange`
    // stays exported from prodGate.mjs — the production-posture tests assert it.

    // GET /v1/auth/exchange?token= — email magic-link landing (browser)
    if (req.method === "GET" && path === "/v1/auth/exchange") {
      // KTD10 — the scanner-facing surface, on its own key. HTML rather than
      // JSON: whoever is here is a browser, and the throttle must not be the
      // one response on this route that renders as a blob of text.
      const rlLanding = magicRateLimit(req, "landing");
      if (!rlLanding.ok) {
        return renderDeadLink(res, {
          status: 429,
          title: "Too many requests",
          detail: `Wait ${rlLanding.retryAfterSec} seconds and reload this page. Your sign-in link was not used.`,
        });
      }
      const token = url.searchParams.get("token") || "";
      const pendingId = url.searchParams.get("pending") || "";

      // KTD12 — branch on `pending` *before* deciding whether to consume. The
      // Ask OAuth authorize flow emails this same URL with `&pending=…` and
      // needs the GET to spend the token and 302 to consent; the plain sign-in
      // link must not be spent by a page load (R6). Resolving the pending
      // record first is what closes the old hole where a stale `pending` burned
      // the token and then printed the session as HTML.
      if (pendingId) {
        const pending = await store.mcpGetPending(pendingId);
        if (!pending) {
          return renderDeadLink(res, {
            title: "Authorization expired",
            detail:
              "This Atoms Ask authorization request is no longer active. Start connecting again from your MCP client. Your sign-in link was not used.",
          });
        }
        const out = await store.exchangeMagic(token, {
          skipVerifierCheck: true,
        });
        if (await maybeFinishOauthAfterExchange(res, store, out, pendingId)) {
          return;
        }
        // The pending record was live but the token was not: nothing to hand
        // off, and never a session on the page.
        return renderDeadLink(res);
      }

      // R6/KD8 — the plugin sign-in link. Read the verdict without spending
      // anything; the tap is what consumes, not the page load.
      const peek = await store.peekMagic(token);
      if (!peek.ok) return renderDeadLink(res);
      // KD9 — the handoff is offered only to a token that can complete one.
      if (!peek.verifierBound) return renderUnboundPage(res, { token });
      return renderHandoffPage(res, { token, vault: peek.vault });
    }

    // POST /v1/auth/exchange/fallback — the landing page's own form (KTD5)
    if (req.method === "POST" && path === FALLBACK_EXCHANGE_PATH) {
      // KTD10 — its own key, so a bot looping the landing page above cannot
      // take away the human's only remaining way in.
      const rlFallback = magicRateLimit(req, "fallback");
      if (!rlFallback.ok) {
        return renderDeadLink(res, {
          status: 429,
          title: "Too many requests",
          detail: `Wait ${rlFallback.retryAfterSec} seconds and try again. Your sign-in link was not used.`,
        });
      }
      // A scriptless form sends `application/x-www-form-urlencoded`, and
      // `readBody` is JSON-only and throws on anything else — which is why this
      // is a separate HTML-rendering route rather than a branch inside the
      // plugin's JSON exchange above.
      const form = new URLSearchParams(await readRawBody(req));
      const token = (form.get("token") || "").trim();

      // KD9 — this route skips the verifier check entirely, for bound and
      // unbound tokens alike, by design. It presents no verifier because the
      // browser holding this page is not the device that requested the link.
      // Every link a current build mints is bound, so a fallback that honored
      // the check would recover nothing and KD3's cross-device path would be
      // dead on arrival. This is not a loophole to tighten later: it closes
      // with #286, which deletes this route and the paste field together.
      const out = await store.exchangeMagic(token, { skipVerifierCheck: true });
      // Expired, already spent, and never-existed all collapse to R7's one
      // message here — a browser is not the plugin and has no use for the
      // distinction. Nothing was consumed on the way in either way.
      if (!out) return renderDeadLink(res);
      return renderFallbackSession(res, out);
    }

    // POST /v1/auth/peek — the plugin's non-consuming, verifier-bound check
    if (req.method === "POST" && path === "/v1/auth/peek") {
      // KTD15 — the plugin must name the account before it may ask R4's
      // question, and the only other way to learn it is to have already spent
      // the token and revoked the account's other sessions. So: read-only.
      // This route deletes nothing and mints nothing, and there is deliberately
      // no path from here to `exchangeMagic` or to session issuance.
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      if (!token) return json(res, 400, { message: "Token required" }, NO_STORE);
      const verifier = optionalBoundedString(body.verifier, MAX_VERIFIER_CHARS);
      if (!verifier.ok) {
        return json(res, 400, { message: "Invalid verifier" }, NO_STORE);
      }
      const rlPeek = magicRateLimit(req, "peek");
      if (!rlPeek.ok) {
        // No `result` here on purpose: U8 lets a stated verdict beat the status
        // code, so a throttle labelled `invalid` would read as a decision about
        // the link and send the user to request a new one for no reason.
        return json(
          res,
          429,
          { message: "Too many requests", retryAfterSec: rlPeek.retryAfterSec },
          NO_STORE,
        );
      }

      const peek = await store.peekMagic(token);
      if (!peek.ok) {
        // R7 apart from R5: expired routes "request a new link", invalid routes
        // "this link is already spent or was never real".
        return json(
          res,
          401,
          {
            result: peek.status === "expired" ? "expired" : "invalid",
            message: "Invalid or expired magic link",
          },
          NO_STORE,
        );
      }

      // KD9 / step 3 — an **unbound** row is refused here, even though
      // `verifierMatches` passes it. That pass is right for the exchange, where
      // an older build's token legitimately redeems; it is wrong here, because
      // answering `usable` would hand an account email to any caller holding
      // the link. So the binding is checked first, and the shared compare is
      // still what decides every bound row — one comparison, two callers, so a
      // peek can never say usable where the exchange would refuse.
      const allowed =
        peek.verifierBound && verifierMatches(peek.verifierHash, verifier.value);
      if (!allowed) {
        return json(
          res,
          403,
          {
            result: "refused",
            reason: "verifier_mismatch",
            // The requesting vault travels on a refusal too: it is the only
            // server-attested vault name a refusing plugin will ever hold, and
            // without it U9's refusal has nothing to name but the deep link's
            // attacker-controlled `vault=` param. The **email** stays behind —
            // naming the vault that asked is not naming the account.
            ...(peek.vault ? { vault: peek.vault } : {}),
            message:
              "This sign-in link belongs to a different vault. Open the vault that requested it and tap the link again.",
          },
          NO_STORE,
        );
      }
      return json(
        res,
        200,
        {
          result: "usable",
          email: peek.email,
          ...(peek.vault ? { vault: peek.vault } : {}),
        },
        NO_STORE,
      );
    }

    // POST /v1/auth/exchange — plugin in-app exchange
    if (req.method === "POST" && path === "/v1/auth/exchange") {
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      // KTD10 — the consuming plugin route, on its own key, so an exhausted
      // peek or landing page never blocks the exchange the user just approved.
      const rlExchange = magicRateLimit(req, "exchange");
      if (!rlExchange.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rlExchange.retryAfterSec,
        });
      }
      // #240 U4 / KD9 — this route, and only this route, is bound to the
      // verifier the requesting device registered at mint time (R12). The web
      // routes above skip the check by design; see MagicExchangeOpts.
      const verifier = optionalBoundedString(
        body.verifier,
        MAX_VERIFIER_CHARS,
      );
      if (!verifier.ok) {
        return json(res, 400, { message: "Invalid verifier" });
      }
      // Read the verdict before spending anything: a token that fails below is
      // either expired or unknown, and the exchange collapses both to null. The
      // plugin needs them apart — R7's "request a new link" reads nothing like
      // a link that never existed. Non-consuming by construction (KTD1).
      const before = await store.peekMagic(token);
      const out = await store.exchangeMagic(token, { verifier: verifier.value });
      if (out?.refused) {
        // R5 — a refusal the plugin can name: open the vault that asked for
        // this link and tap again. Nothing spendable travels with it, and the
        // link is still there to tap (R16).
        return json(res, 403, {
          result: "refused",
          reason: out.reason,
          message:
            "This sign-in link belongs to a different vault. Open the vault that requested it and tap the link again.",
        });
      }
      if (!out) {
        return json(res, 401, {
          result: before.status === "expired" ? "expired" : "invalid",
          message: "Invalid or expired magic link",
        });
      }
      const pub = store.publicAccount(out.account);
      return json(res, 200, {
        session: out.session,
        sessionToken: out.session,
        email: pub.email,
        status: pub.status,
        remaining: pub.remaining,
        periodEnd: pub.periodEnd,
        plan: pub.plan,
      });
    }

    // GET /v1/me
    if (req.method === "GET" && path === "/v1/me") {
      const session = bearer(req);
      const a = await store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
      return json(res, 200, store.publicAccount(a));
    }

    // POST /v1/promo — email-proof required (no soft-start promo theft)
    if (req.method === "POST" && path === "/v1/promo") {
      const session = bearer(req);
      const a = await store.accountFromSession(session, {
        requireVerified: true,
      });
      if (!a) {
        return json(res, 401, {
          message: "Sign in with a magic link to redeem a promo",
        });
      }
      const body = await readBody(req);
      const result = await store.redeemPromo(a.email, String(body.code || ""));
      if (!result.ok) return json(res, 400, { message: result.message });
      return json(res, 200, {
        ok: true,
        months: result.months,
        ...store.publicAccount(result.account),
      });
    }

    // POST /v1/billing/checkout — Stripe when configured; dogfood grants only off-prod
    // Soft (unverified) sessions allowed so stripe-first onboarding works.
    if (req.method === "POST" && path === "/v1/billing/checkout") {
      const session = bearer(req);
      const a = await store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
      const body = await readBody(req);
      const kind = String(body.kind || "");

      const rlCk = checkRateLimit(`checkout:${clientIp(req)}`);
      if (!rlCk.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rlCk.retryAfterSec,
        });
      }
      const rlCs = checkRateLimit(
        `checkout:${a.email}:${String(session).slice(0, 12)}`,
      );
      if (!rlCs.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rlCs.retryAfterSec,
        });
      }

      if (
        kind === "start_trial" &&
        (a.status === "active" || a.status === "trialing")
      ) {
        return json(res, 409, {
          message: "Already subscribed — use Manage billing or magic link",
        });
      }

      // Real Stripe when configured and dogfood instant-grants are not allowed
      if (stripeConfigured() && !allowDogfoodCheckout()) {
        try {
          const cs = await createCheckoutSession({
            email: a.email,
            kind: /** @type {import('./stripe.mjs').CheckoutKind} */ (kind),
          });
          // The webhook that grants this trial revokes soft sessions and has no
          // session context of its own. Bind this caller's session to the
          // checkout so the webhook can re-verify exactly it (#230). Inside the
          // try on purpose: if we cannot bind, failing here — before any card is
          // charged — beats stranding the user after they pay.
          if (typeof store.bindCheckoutSession === "function") {
            await store.bindCheckoutSession(cs.id, a.email, session);
          }
          return json(res, 200, { url: cs.url, id: cs.id });
        } catch (err) {
          const status = err?.status && err.status >= 400 ? err.status : 502;
          const msg = err instanceof Error ? err.message : "Checkout failed";
          return json(res, status, { message: msg });
        }
      }

      // Production (or non-dogfood) without usable Stripe → fail closed
      if (!allowDogfoodCheckout()) {
        return json(res, 503, {
          message:
            "Billing is not configured. Stripe Checkout required in this environment.",
        });
      }

      if (kind === "topup_50") {
        await store.addTopUp(a.email, config.topUpFilings);
        if (typeof store.markSessionVerified === "function") {
          await store.markSessionVerified(session);
        }
        return json(res, 200, {
          url: `${config.publicBaseUrl}/v1/billing/return?ok=1&dogfood=topup`,
          message: "Dogfood: top-up applied without Stripe",
        });
      }

      if (
        kind === "subscribe_monthly" ||
        kind === "subscribe_yearly" ||
        kind === "start_trial"
      ) {
        await store.grantPeriod(a.email, {
          status: kind === "start_trial" ? "trialing" : "active",
          plan:
            kind === "subscribe_yearly"
              ? "yearly"
              : kind === "start_trial"
                ? "trial"
                : "monthly",
          days:
            kind === "start_trial"
              ? config.trialDays
              : kind === "subscribe_yearly"
                ? 365
                : 30,
          remaining: config.includedFilings,
        });
        // grantPeriod revokes soft sessions; re-verify the checkout caller.
        if (typeof store.markSessionVerified === "function") {
          await store.markSessionVerified(session);
        }
        return json(res, 200, {
          url: `${config.publicBaseUrl}/v1/billing/return?ok=1&dogfood=subscribe`,
          message: "Dogfood: subscription granted without Stripe",
        });
      }

      return json(res, 400, { message: `Unknown checkout kind: ${kind}` });
    }

    // POST /v1/billing/portal — verified session only
    if (req.method === "POST" && path === "/v1/billing/portal") {
      const session = bearer(req);
      const a = await store.accountFromSession(session, {
        requireVerified: true,
      });
      if (!a) {
        return json(res, 401, {
          message: "Sign in with a magic link to manage billing",
        });
      }
      const cust = a.stripeCustomerId;
      if (!cust || !stripeConfigured()) {
        return json(res, 400, {
          message: "No Stripe customer on this account yet",
        });
      }
      try {
        const portal = await createPortalSession({ customerId: cust });
        return json(res, 200, { url: portal.url });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Portal failed";
        return json(res, 502, { message: msg });
      }
    }

    // OAuth AS + well-known (Ask / Claude connectors)
    if (
      await handleOauthRoutes({
        req,
        res,
        path,
        url,
        store,
        readRawBody,
        readBody,
      })
    ) {
      return;
    }

    // Remote MCP (Streamable HTTP)
    if (path === "/mcp") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      await handleMcpRequest(req, res, {
        store,
        publicBaseUrl: config.publicBaseUrl,
        readRawBody,
      });
      return;
    }

    // Ask mirror (Plus session) — before classify
    if (
      await handleMirrorRoutes({
        req,
        res,
        path,
        store,
        bearer,
        json,
        readBody,
      })
    ) {
      return;
    }

    // POST /v1/classify
    if (req.method === "POST" && path === "/v1/classify") {
      const session = bearer(req);
      const ip = clientIp(req);
      const rl = checkRateLimit(`cl:${ip}:${session.slice(0, 12)}`);
      if (!rl.ok) {
        return json(res, 429, {
          message: "Too many classify requests",
          retryAfterSec: rl.retryAfterSec,
        });
      }

      const idem =
        String(req.headers["idempotency-key"] || "").trim() ||
        String(req.headers["x-idempotency-key"] || "").trim() ||
        "";

      // U9-12: require Idempotency-Key in production (retry-safe meter)
      if (isProduction() && !idem) {
        return json(res, 400, {
          message: "Idempotency-Key header required",
        });
      }

      const consume = await store.tryConsumeFiling(session, idem || undefined);
      if (!consume.ok) {
        if (consume.code === "auth") {
          return json(res, 401, {
            message:
              "Invalid session — sign in with a magic link after checkout if status shows active",
          });
        }
        if (consume.code === "idempotency_conflict") {
          return json(res, 409, {
            message: "Idempotency-Key already used by another account",
          });
        }
        if (consume.code === "in_flight") {
          return json(res, 409, {
            message: "Classify already in progress for this Idempotency-Key",
          });
        }
        return json(res, 402, {
          message:
            "Included filings used up this period. Wait for reset or buy a top-up.",
          status: "exhausted",
          remaining: 0,
        });
      }

      if (consume.replay && consume.cached?.responseJson) {
        const me = await store.accountFromSession(session);
        return json(res, 200, {
          ...consume.cached.responseJson,
          remaining: consume.cached.remaining ?? me?.remaining,
          replay: true,
        });
      }

      const body = await readBody(req);
      const upstream = await proxyClassify(body);
      if (!upstream.ok) {
        await store.refundFiling(session, idem || undefined);
        const status =
          upstream.status && upstream.status >= 400 ? upstream.status : 502;
        const me = await store.accountFromSession(session);
        return json(res, status, {
          message: upstream.message,
          remaining: me?.remaining,
        });
      }

      const a = await store.accountFromSession(session);
      const out = {
        result: upstream.json,
        remaining: a?.remaining ?? 0,
        status: a?.status ?? "unknown",
        usageId: idem || `u_${Date.now()}`,
      };
      if (idem && store.completeUsage) {
        await store.completeUsage(idem, {
          email: a?.email,
          status: "ok",
          responseJson: out,
          remaining: out.remaining,
        });
      }
      return json(res, 200, out);
    }

    return json(res, 404, { message: "Not found" });
  } catch (err) {
    if (err && err.status === 413) {
      return json(res, 413, { message: "Request body too large" });
    }
    const msg = err instanceof Error ? err.message : "error";
    console.error("[plus] error", msg);
    return json(res, 500, { message: "Internal error" });
  }
}

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(config.port, () => {
  console.log(
    `[plus] listening on http://127.0.0.1:${config.port} publicBase=${config.publicBaseUrl} env=${isProduction() ? "production" : "dev"} dogfoodAutoGrant=${config.dogfoodAutoGrant} stripe=${stripeConfigured()} anthropic=${Boolean(config.anthropicApiKey)}`,
  );
});
