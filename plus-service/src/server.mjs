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
  allowDevExchange,
  allowDogfoodCheckout,
  assertProductionReady,
  isProduction,
} from "./prodGate.mjs";
import { sendMagicLinkEmail } from "./email.mjs";
import { INCIDENT_KIND } from "./store/shared.mjs";
import { alertStripeIncident } from "./alert.mjs";
import { checkRateLimit, clientIp } from "./ratelimit.mjs";
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

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    ...CORS_HEADERS,
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

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Browser landing after magic-link email (or dogfood dev-exchange). */
function renderExchangeHtml(res, out) {
  if (!out) {
    res.writeHead(400, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>Link expired</h1>
<p>Request a new sign-in link from Atoms Settings.</p>
</body>`);
    return;
  }
  const email = escHtml(out.account.email);
  const status = escHtml(out.account.status);
  const remaining = escHtml(String(out.account.remaining));
  const session = escHtml(out.session);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>Signed in</h1>
<p>Email: <strong>${email}</strong></p>
<p>Status: <strong>${status}</strong> · remaining ${remaining}</p>
<p><strong>Switch back to Obsidian</strong> → Settings → Atoms Plus → <strong>Refresh status</strong>.</p>
<p style="color:#666;font-size:0.9rem">If Refresh does not pick up this device, advanced: paste session below once.</p>
<details style="margin-top:1rem"><summary style="cursor:pointer;color:#666">Advanced: session token</summary>
<pre style="background:#f4f4f5;padding:12px;border-radius:8px;word-break:break-all">${session}</pre>
</details>
</body>`);
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
        // on. The empty id collapses the flood to one row per kind per day —
        // this route has no rate limit (KTD2).
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
      const token = await store.createMagicToken(email);
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

    // GET /v1/auth/dev-exchange — dogfood alias (disabled in prod)
    if (req.method === "GET" && path === "/v1/auth/dev-exchange") {
      if (!allowDevExchange()) {
        return json(res, 404, { message: "Not found" });
      }
      const out = await store.exchangeMagic(
        url.searchParams.get("token") || "",
      );
      const pending = url.searchParams.get("pending") || "";
      if (await maybeFinishOauthAfterExchange(res, store, out, pending)) {
        return;
      }
      return renderExchangeHtml(res, out);
    }

    // GET /v1/auth/exchange?token= — email magic-link landing (browser)
    if (req.method === "GET" && path === "/v1/auth/exchange") {
      const out = await store.exchangeMagic(
        url.searchParams.get("token") || "",
      );
      const pending = url.searchParams.get("pending") || "";
      if (await maybeFinishOauthAfterExchange(res, store, out, pending)) {
        return;
      }
      return renderExchangeHtml(res, out);
    }

    // POST /v1/auth/exchange — plugin in-app exchange
    if (req.method === "POST" && path === "/v1/auth/exchange") {
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      const out = await store.exchangeMagic(token);
      if (!out) {
        return json(res, 401, { message: "Invalid or expired magic link" });
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
