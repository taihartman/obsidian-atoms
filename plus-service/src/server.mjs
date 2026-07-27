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
import { checkRateLimit, clientIp } from "./ratelimit.mjs";
import { handleMirrorRoutes } from "./mirror/http.mjs";

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
    "content-type, authorization, idempotency-key, x-idempotency-key, accept",
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
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

/** Browser landing after magic-link email (or dogfood dev-exchange). */
function renderExchangeHtml(res, out) {
  if (!out) {
    res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>Link expired</h1>
<p>Request a new sign-in link from Atoms Settings.</p>
</body>`);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>Signed in</h1>
<p>Email: <strong>${out.account.email}</strong></p>
<p>Status: <strong>${out.account.status}</strong> · remaining ${out.account.remaining}</p>
<p>Paste this session into <strong>Obsidian → Settings → Atoms Plus</strong>:</p>
<pre style="background:#f4f4f5;padding:12px;border-radius:8px;word-break:break-all">${out.session}</pre>
<p style="color:#666;font-size:0.9rem">You can close this tab after pasting.</p>
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
<h1>${ok ? "Payment received" : "Checkout canceled"}</h1>
<p>${ok ? "Return to Obsidian — Plus updates after the webhook lands (usually seconds)." : "No charge. You can try again from Atoms Settings."}</p>
</body>`);
      return;
    }

    // POST /v1/billing/webhook — raw body + Stripe-Signature
    if (req.method === "POST" && path === "/v1/billing/webhook") {
      const raw = await readRawBody(req);
      try {
        const event = constructEvent(raw, req.headers["stripe-signature"]);
        const result = await applyStripeEvent(store, event);
        console.log(
          `[plus] stripe webhook ${event.type} → ${result.action || "ok"}${result.email ? ` ${result.email}` : ""}`,
        );
        return json(res, 200, { received: true, ...result });
      } catch (err) {
        const status = err?.status && err.status >= 400 ? err.status : 400;
        const msg = err instanceof Error ? err.message : "webhook error";
        console.error("[plus] webhook reject", msg);
        return json(res, status, { message: msg });
      }
    }

    // POST /v1/auth/magic-link
    if (req.method === "POST" && path === "/v1/auth/magic-link") {
      const rl = checkRateLimit(`ml:${clientIp(req)}`);
      if (!rl.ok) {
        return json(res, 429, {
          message: "Too many requests",
          retryAfterSec: rl.retryAfterSec,
        });
      }
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return json(res, 400, { message: "Valid email required" });
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
      return renderExchangeHtml(
        res,
        await store.exchangeMagic(url.searchParams.get("token") || ""),
      );
    }

    // GET /v1/auth/exchange?token= — email magic-link landing (browser)
    if (req.method === "GET" && path === "/v1/auth/exchange") {
      return renderExchangeHtml(
        res,
        await store.exchangeMagic(url.searchParams.get("token") || ""),
      );
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

    // POST /v1/promo
    if (req.method === "POST" && path === "/v1/promo") {
      const session = bearer(req);
      const a = await store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
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
    if (req.method === "POST" && path === "/v1/billing/checkout") {
      const session = bearer(req);
      const a = await store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
      const body = await readBody(req);
      const kind = String(body.kind || "");

      // Real Stripe when configured and dogfood instant-grants are not allowed
      if (stripeConfigured() && !allowDogfoodCheckout()) {
        try {
          const cs = await createCheckoutSession({
            email: a.email,
            kind: /** @type {import('./stripe.mjs').CheckoutKind} */ (kind),
          });
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
        return json(res, 200, {
          url: `${config.publicBaseUrl}/v1/billing/return?ok=1&dogfood=subscribe`,
          message: "Dogfood: subscription granted without Stripe",
        });
      }

      return json(res, 400, { message: `Unknown checkout kind: ${kind}` });
    }

    // POST /v1/billing/portal
    if (req.method === "POST" && path === "/v1/billing/portal") {
      const session = bearer(req);
      const a = await store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
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
          return json(res, 401, { message: "Invalid session" });
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
