/**
 * OAuth AS + MCP end-to-end against spawned plus-service.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_CALLBACK,
  CHATGPT_LEGACY_CALLBACK,
} from "../src/oauth/constants.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 19200 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const RESOURCE = `${BASE}/mcp`;

let child;

function pkce() {
  const verifier = "v" + "a".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function waitHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* */
    }
    await sleep(80);
  }
  throw new Error("unhealthy");
}

before(async () => {
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      PUBLIC_BASE_URL: BASE,
      DOGFOOD_AUTO_GRANT: "1",
      ATOMS_PLUS_STORE: "memory",
      ANTHROPIC_API_KEY: "",
      STRIPE_SECRET_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => {
    log += d.toString();
  });
  child.stderr.on("data", (d) => {
    log += d.toString();
  });
  child._log = () => log;
  await waitHealth();
});

after(() => {
  if (child && !child.killed) child.kill("SIGTERM");
});

describe("OAuth Ask AS", () => {
  it("well-known PRM and AS metadata", async () => {
    const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
    assert.equal(prm.resource, RESOURCE);
    assert.ok(prm.authorization_servers?.length);
    const as = await (
      await fetch(`${BASE}/.well-known/oauth-authorization-server`)
    ).json();
    assert.equal(as.issuer, BASE);
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
    assert.ok(as.token_endpoint_auth_methods_supported.includes("none"));
    assert.equal(as.client_id_metadata_document_supported, true);
    assert.equal(as.authorization_response_iss_parameter_supported, true);
  });

  it("full code+PKCE → MCP tools/call", async () => {
    const { verifier, challenge } = pkce();
    const state = "st_test_1";
    const clientId = "cli_oauth_test";

    const authUrl = new URL(`${BASE}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", CLAUDE_CALLBACK);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", RESOURCE);

    const authPage = await fetch(authUrl);
    assert.equal(authPage.status, 200);
    const html = await authPage.text();
    const pm = html.match(/name="pending_id" value="([^"]+)"/);
    assert.ok(pm, "pending_id in form");
    const pendingId = pm[1];

    // email form → magic link
    const email = "oauth-ask@atoms.test";
    await fetch(`${BASE}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        pending_id: pendingId,
        email,
      }).toString(),
      redirect: "manual",
    });
    await sleep(80);
    const tm = child._log().match(/token=(mt_[a-f0-9]+)/g);
    assert.ok(tm?.length, "magic token logged");
    const token = tm[tm.length - 1].replace("token=", "");

    // exchange with pending → 302 consent + cookie
    const ex = await fetch(
      `${BASE}/v1/auth/exchange?token=${encodeURIComponent(token)}&pending=${encodeURIComponent(pendingId)}`,
      { redirect: "manual" },
    );
    assert.ok([302, 303].includes(ex.status), `expected redirect got ${ex.status}`);
    const setCookie = ex.headers.getSetCookie?.() || [];
    const cookieHeader =
      setCookie.map((c) => c.split(";")[0]).join("; ") ||
      (ex.headers.get("set-cookie") || "").split(",")[0]?.split(";")[0] ||
      "";
    assert.match(cookieHeader, /atoms_oauth_bs=/);

    // consent allow
    const consent = await fetch(`${BASE}/oauth/consent`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader,
      },
      body: new URLSearchParams({
        pending_id: pendingId,
        decision: "allow",
      }).toString(),
      redirect: "manual",
    });
    assert.ok([302, 303].includes(consent.status));
    const loc = consent.headers.get("location") || "";
    assert.match(loc, new RegExp(`^${CLAUDE_CALLBACK.replace(/\./g, "\\.")}`));
    const redir = new URL(loc);
    assert.equal(redir.searchParams.get("state"), state);
    assert.equal(redir.searchParams.get("iss"), BASE, "RFC 9207 iss on success");
    const code = redir.searchParams.get("code");
    assert.ok(code);

    // token
    const tokRes = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CLAUDE_CALLBACK,
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE,
      }).toString(),
    });
    assert.equal(tokRes.status, 200, await tokRes.clone().text());
    const tokens = await tokRes.json();
    assert.ok(tokens.access_token?.startsWith("mcp_"));
    assert.ok(tokens.refresh_token);

    // seed mirror via Plus session from same email
    const ml = await fetch(`${BASE}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    assert.equal(ml.status, 200);
    await sleep(50);
    const tm2 = child._log().match(/token=(mt_[a-f0-9]+)/g);
    const mt2 = tm2[tm2.length - 1].replace("token=", "");
    const sess = await (
      await fetch(`${BASE}/v1/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: mt2 }),
      })
    ).json();
    await fetch(`${BASE}/v1/ask/mirror/upsert`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sess.session}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        atoms: [
          {
            path: "Atoms/OAuth.md",
            title: "OAuth proof",
            body: "unique oauth fixture body zebra-xyz",
          },
        ],
      }),
    });

    // MCP initialize + tools/call
    const init = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    assert.equal(init.status, 200, await init.clone().text());

    const call = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "search_atoms",
          arguments: { query: "zebra-xyz" },
        },
      }),
    });
    assert.equal(call.status, 200, await call.clone().text());
    const callBody = await call.text();
    assert.match(callBody, /OAuth proof|zebra-xyz/);

    // tools/list includes ChatGPT-facing securitySchemes
    const listed = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(listed.status, 200, await listed.clone().text());
    const listText = await listed.text();
    assert.match(listText, /securitySchemes/);
    assert.match(listText, /atoms:read/);
    assert.match(listText, /search_atoms/);
  });

  it("bad redirect_uri rejected", async () => {
    const { challenge } = pkce();
    const authUrl = new URL(`${BASE}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", "x");
    authUrl.searchParams.set("redirect_uri", "https://evil.example/cb");
    authUrl.searchParams.set("state", "s");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", RESOURCE);
    const r = await fetch(authUrl);
    assert.equal(r.status, 400);
  });

  it("ChatGPT redirect_uri accepted on authorize page", async () => {
    const { challenge } = pkce();
    for (const redirect of [
      CHATGPT_LEGACY_CALLBACK,
      "https://chatgpt.com/connector/oauth/testcb1",
    ]) {
      const authUrl = new URL(`${BASE}/oauth/authorize`);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", "https://chatgpt.com/oauth/test/client.json");
      authUrl.searchParams.set("redirect_uri", redirect);
      authUrl.searchParams.set("state", "st_cgpt");
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("resource", RESOURCE);
      const r = await fetch(authUrl);
      assert.equal(r.status, 200, redirect);
      const html = await r.text();
      assert.match(html, /pending_id/);
      assert.match(html, /Claude or ChatGPT|mirrored atoms/i);
    }
  });

  it("consent deny redirect includes iss (RFC 9207)", async () => {
    const { challenge } = pkce();
    const state = "st_deny_iss";
    const authUrl = new URL(`${BASE}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", "cli_deny_iss");
    authUrl.searchParams.set("redirect_uri", CLAUDE_CALLBACK);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", RESOURCE);
    const authPage = await fetch(authUrl);
    const html = await authPage.text();
    const pm = html.match(/name="pending_id" value="([^"]+)"/);
    assert.ok(pm);
    const pendingId = pm[1];
    const email = "deny-iss@atoms.test";
    await fetch(`${BASE}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ pending_id: pendingId, email }).toString(),
      redirect: "manual",
    });
    await sleep(80);
    const tm = child._log().match(/token=(mt_[a-f0-9]+)/g);
    const token = tm[tm.length - 1].replace("token=", "");
    const ex = await fetch(
      `${BASE}/v1/auth/exchange?token=${encodeURIComponent(token)}&pending=${encodeURIComponent(pendingId)}`,
      { redirect: "manual" },
    );
    const setCookie = ex.headers.getSetCookie?.() || [];
    const cookieHeader =
      setCookie.map((c) => c.split(";")[0]).join("; ") ||
      (ex.headers.get("set-cookie") || "").split(",")[0]?.split(";")[0] ||
      "";
    const deny = await fetch(`${BASE}/oauth/consent`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader,
      },
      body: new URLSearchParams({
        pending_id: pendingId,
        decision: "deny",
      }).toString(),
      redirect: "manual",
    });
    assert.ok([302, 303].includes(deny.status));
    const loc = new URL(deny.headers.get("location") || "");
    assert.equal(loc.searchParams.get("error"), "access_denied");
    assert.equal(loc.searchParams.get("state"), state);
    assert.equal(loc.searchParams.get("iss"), BASE);
  });

  it("DCR accepts application_type without widening redirects", async () => {
    const ok = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [CLAUDE_CALLBACK],
        client_name: "app-type-test",
        application_type: "native",
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(ok.status, 201, await ok.clone().text());
    const bad = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://evil.example/cb"],
        application_type: "web",
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(bad.status, 400);
  });

  it("DCR register flood returns 429", async () => {
    const ip = "203.0.113.88";
    let saw429 = false;
    for (let i = 0; i < 35; i++) {
      const r = await fetch(`${BASE}/oauth/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({
          redirect_uris: [CLAUDE_CALLBACK],
          client_name: `flood-${i}`,
          token_endpoint_auth_method: "none",
        }),
      });
      if (r.status === 429) {
        saw429 = true;
        break;
      }
    }
    assert.equal(saw429, true);
  });

});
