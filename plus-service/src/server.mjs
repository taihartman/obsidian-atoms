/**
 * Atoms Plus HTTP API — matches plugin plusClient paths.
 *
 * Env: ANTHROPIC_API_KEY (required for classify), PORT, DOGFOOD_AUTO_GRANT, …
 * Start: npm start (from plus-service/)
 */

import { createServer } from "node:http";
import { config } from "./config.mjs";
import { createStore } from "./store.mjs";
import { proxyClassify } from "./anthropic.mjs";

const store = createStore();

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : "";
}

async function handler(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  try {
    // Health
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      return json(res, 200, {
        ok: true,
        service: "atoms-plus",
        dogfoodAutoGrant: config.dogfoodAutoGrant,
        includedFilings: config.includedFilings,
        hasAnthropicKey: Boolean(config.anthropicApiKey),
      });
    }

    // POST /v1/auth/magic-link
    if (req.method === "POST" && path === "/v1/auth/magic-link") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return json(res, 400, { message: "Valid email required" });
      }
      const token = store.createMagicToken(email);
      const link = `${config.publicBaseUrl}/v1/auth/dev-exchange?token=${token}`;
      // Dev: print link (no email provider in dogfood)
      console.log(`[plus] magic link for ${email}: ${link}`);
      return json(res, 200, { ok: true });
    }

    // GET /v1/auth/dev-exchange?token= — browser-friendly dogfood
    if (req.method === "GET" && path === "/v1/auth/dev-exchange") {
      const token = url.searchParams.get("token") || "";
      const out = store.exchangeMagic(token);
      if (!out) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Invalid or expired link. Request a new magic link from Atoms Settings.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset=utf-8><title>Atoms Plus</title>
<body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>Signed in</h1>
<p>Email: <strong>${out.account.email}</strong></p>
<p>Status: <strong>${out.account.status}</strong> · remaining ${out.account.remaining}</p>
<p>Paste this session into the plugin dogfood (or use the app exchange flow):</p>
<pre style="background:#f4f4f5;padding:12px;border-radius:8px;word-break:break-all">${out.session}</pre>
<p style="color:#666;font-size:0.9rem">Dev helper only. Production uses in-app exchange.</p>
</body>`);
      return;
    }

    // POST /v1/auth/exchange
    if (req.method === "POST" && path === "/v1/auth/exchange") {
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      const out = store.exchangeMagic(token);
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
      const a = store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
      return json(res, 200, store.publicAccount(a));
    }

    // POST /v1/promo
    if (req.method === "POST" && path === "/v1/promo") {
      const session = bearer(req);
      const a = store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
      const body = await readBody(req);
      const result = store.redeemPromo(a.email, String(body.code || ""));
      if (!result.ok) return json(res, 400, { message: result.message });
      return json(res, 200, {
        ok: true,
        months: result.months,
        ...store.publicAccount(result.account),
      });
    }

    // POST /v1/billing/checkout — dogfood stub (Stripe optional later)
    if (req.method === "POST" && path === "/v1/billing/checkout") {
      const session = bearer(req);
      const a = store.accountFromSession(session);
      if (!a) return json(res, 401, { message: "Invalid session" });
      const body = await readBody(req);
      const kind = String(body.kind || "");

      if (kind === "topup_50") {
        store.addTopUp(a.email, config.topUpFilings);
        return json(res, 200, {
          url: `${config.publicBaseUrl}/health?topup=ok`,
          message: "Dogfood: top-up applied without Stripe",
        });
      }

      if (
        kind === "subscribe_monthly" ||
        kind === "subscribe_yearly" ||
        kind === "start_trial"
      ) {
        store.grantPeriod(a.email, {
          status: kind === "start_trial" ? "trialing" : "active",
          plan: kind === "subscribe_yearly" ? "yearly" : kind === "start_trial" ? "trial" : "monthly",
          days: kind === "start_trial" ? config.trialDays : kind === "subscribe_yearly" ? 365 : 30,
          remaining: config.includedFilings,
        });
        return json(res, 200, {
          url: `${config.publicBaseUrl}/health?subscribe=ok`,
          message: "Dogfood: subscription granted without Stripe",
        });
      }

      return json(res, 400, { message: `Unknown checkout kind: ${kind}` });
    }

    // POST /v1/classify
    if (req.method === "POST" && path === "/v1/classify") {
      const session = bearer(req);
      const consume = store.tryConsumeFiling(session);
      if (!consume.ok) {
        if (consume.code === "auth") {
          return json(res, 401, { message: "Invalid session" });
        }
        return json(res, 402, {
          message:
            "Included filings used up this period. Wait for reset or buy a top-up.",
          status: "exhausted",
          remaining: 0,
        });
      }

      const body = await readBody(req);
      const upstream = await proxyClassify(body);
      if (!upstream.ok) {
        // Transport / upstream failure before usable result — refund (KTD-P6)
        store.refundFiling(session);
        const status =
          upstream.status && upstream.status >= 400 ? upstream.status : 502;
        return json(res, status, {
          message: upstream.message,
          remaining: store.accountFromSession(session)?.remaining,
        });
      }

      const a = store.accountFromSession(session);
      return json(res, 200, {
        result: upstream.json,
        remaining: a?.remaining ?? 0,
        status: a?.status ?? "unknown",
        usageId: `u_${Date.now()}`,
      });
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
    `[plus] listening on http://127.0.0.1:${config.port} dogfoodAutoGrant=${config.dogfoodAutoGrant} anthropic=${Boolean(config.anthropicApiKey)}`,
  );
});
