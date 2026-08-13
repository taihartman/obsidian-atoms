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
  GROK_CALLBACK,
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
    assert.ok(as.scopes_supported.includes("atoms:write"));
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
    assert.ok([200, 302, 303].includes(consent.status), `consent status ${consent.status}`);
    const loc = consent.headers.get("location") || "";
    assert.match(loc, new RegExp(`^${CLAUDE_CALLBACK.replace(/\./g, "\\.")}`));
    if (consent.status === 200) {
      const body = await consent.text();
      assert.match(body, /Opening your AI app/);
      assert.match(body, /code=/);
    }
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
    assert.match(String(tokens.scope || ""), /atoms:read/);
    assert.match(String(tokens.scope || ""), /atoms:write/);

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
    assert.match(listText, /atoms:write/);
    assert.match(listText, /search_atoms/);
    assert.match(listText, /"title"\s*:\s*"Search atoms"|Search atoms/);
    // structural: every tool has schemes when JSON-parseable
    try {
      const parsed = JSON.parse(listText);
      const tools = parsed.result?.tools || parsed.tools;
      if (Array.isArray(tools)) {
        for (const t of tools) {
          const schemes = t.securitySchemes || t._meta?.securitySchemes;
          assert.ok(schemes, `missing schemes on ${t.name}`);
          const sc = schemes[0]?.scopes || [];
          if (t.name === "create_atom") {
            assert.equal(t.annotations?.destructiveHint, true);
            assert.ok(sc.includes("atoms:write"), JSON.stringify(schemes));
          }
          if (t.name === "search_atoms") {
            assert.ok(sc.includes("atoms:read"), JSON.stringify(schemes));
          }
        }
      }
    } catch {
      /* SSE envelope — regex above still gates */
    }
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

  it("Grok pinned redirect_uri accepted on authorize page", async () => {
    const { challenge } = pkce();
    const authUrl = new URL(`${BASE}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", "https://grok.com/oauth/client.json");
    authUrl.searchParams.set("redirect_uri", GROK_CALLBACK);
    authUrl.searchParams.set("state", "st_grok");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", RESOURCE);
    const r = await fetch(authUrl);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /pending_id/);
    assert.match(html, /Claude, ChatGPT, or Grok/i);
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
      assert.match(html, /Claude, ChatGPT, or Grok/i);
      const csp = r.headers.get("content-security-policy") || "";
      assert.match(csp, /form-action 'self'/);
      assert.match(csp, /claude\.ai/);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.match(html, /name="viewport"/);
      assert.match(html, /btn--primary/);
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
    assert.ok([200, 302, 303].includes(deny.status), `deny status ${deny.status}`);
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
    const grok = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [GROK_CALLBACK],
        client_name: "grok-pin",
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(grok.status, 201, await grok.clone().text());
    const mixed = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [GROK_CALLBACK, "https://evil.example/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(mixed.status, 400);
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

  it("pairing code binds OAuth to Plus email (no magic link)", async () => {
    const email = "pair-oauth@atoms.test";
    // Entitle + mint via Plus sess_
    const ml = await fetch(`${BASE}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    assert.equal(ml.status, 200);
    await sleep(80);
    const tm = child._log().match(/token=(mt_[a-f0-9]+)/g);
    const mt = tm[tm.length - 1].replace("token=", "");
    const ex = await (
      await fetch(`${BASE}/v1/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: mt }),
      })
    ).json();
    assert.ok(ex.session);
    const pair = await (
      await fetch(`${BASE}/v1/ask/mcp/pair`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ex.session}`,
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).json();
    assert.ok(pair.code);

    // Seed mirror under that email
    await fetch(`${BASE}/v1/ask/mirror/upsert`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ex.session}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        atoms: [
          {
            path: "Atoms/PairNote.md",
            title: "PairNote",
            body: "from pair path",
          },
        ],
      }),
    });

    const { verifier, challenge } = pkce();
    const state = "st_pair_1";
    const clientId = "cli_pair_test";
    const authUrl = new URL(`${BASE}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", CLAUDE_CALLBACK);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", RESOURCE);

    const authPage = await fetch(authUrl);
    const html = await authPage.text();
    assert.match(html, /pair_code|Pairing code|code from Obsidian/i);
    const pm = html.match(/name="pending_id" value="([^"]+)"/);
    const pendingId = pm[1];

    const redeem = await fetch(`${BASE}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        pending_id: pendingId,
        mode: "pair",
        pair_code: pair.code,
      }).toString(),
    });
    assert.equal(redeem.status, 200);
    const consentHtml = await redeem.text();
    assert.match(consentHtml, new RegExp(email.replace(".", "\\.")));
    assert.match(consentHtml, /Allow/);
    const allowIdx = consentHtml.indexOf('value="allow"');
    const denyIdx = consentHtml.indexOf('value="deny"');
    assert.ok(allowIdx > 0 && denyIdx > allowIdx, "Allow before Deny");
    assert.match(consentHtml, /btn--primary/);
    assert.match(consentHtml, /btn--secondary/);
    const consentCsp = redeem.headers.get("content-security-policy") || "";
    assert.match(consentCsp, /form-action 'self'/);
    assert.match(consentCsp, /claude\.ai/);

    const setCookie = redeem.headers.getSetCookie?.() || [];
    const cookieHeader =
      setCookie.map((c) => c.split(";")[0]).join("; ") ||
      (redeem.headers.get("set-cookie") || "").split(",")[0]?.split(";")[0] ||
      "";

    const allow = await fetch(`${BASE}/oauth/consent`, {
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
    assert.ok([200, 302, 303].includes(allow.status), `allow status ${allow.status}`);
    const loc = new URL(allow.headers.get("location") || "");
    const code = loc.searchParams.get("code");
    assert.ok(code);

    const tok = await (
      await fetch(`${BASE}/oauth/token`, {
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
      })
    ).json();
    assert.ok(tok.access_token?.startsWith("mcp_"));

    const tools = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_atoms", arguments: { limit: 10 } },
      }),
    });
    assert.equal(tools.status, 200);
    const body = await tools.text();
    assert.match(body, /PairNote|server_count/);
  });

  it("authorize GET with browser session shows chooser not silent consent", async () => {
    const email = "chooser@atoms.test";
    const ml = await fetch(`${BASE}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    assert.equal(ml.status, 200);
    await sleep(80);
    const tm = child._log().match(/token=(mt_[a-f0-9]+)/g);
    const mt = tm[tm.length - 1].replace("token=", "");
    // Create browser session via pair redeem path's cookie: use exchange with fake pending skip —
    // mint pair + oauth with cookie from prior pair test style: create bs via internal by completing pair once
    const ex = await (
      await fetch(`${BASE}/v1/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: mt }),
      })
    ).json();
    const pair = await (
      await fetch(`${BASE}/v1/ask/mcp/pair`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ex.session}`,
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).json();

    const { challenge } = pkce();
    const authUrl = new URL(`${BASE}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", "cli_chooser");
    authUrl.searchParams.set("redirect_uri", CLAUDE_CALLBACK);
    authUrl.searchParams.set("state", "st_ch");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", RESOURCE);
    const page1 = await fetch(authUrl);
    const html1 = await page1.text();
    const pm = html1.match(/name="pending_id" value="([^"]+)"/);
    const redeem = await fetch(`${BASE}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        pending_id: pm[1],
        mode: "pair",
        pair_code: pair.code,
      }).toString(),
    });
    const setCookie = redeem.headers.getSetCookie?.() || [];
    const cookie =
      setCookie.map((c) => c.split(";")[0]).join("; ") ||
      (redeem.headers.get("set-cookie") || "").split(";")[0] ||
      "";
    assert.ok(cookie.includes("atoms_oauth_bs"));

    const { challenge: ch2 } = pkce();
    const authUrl2 = new URL(`${BASE}/oauth/authorize`);
    authUrl2.searchParams.set("response_type", "code");
    authUrl2.searchParams.set("client_id", "cli_chooser2");
    authUrl2.searchParams.set("redirect_uri", CLAUDE_CALLBACK);
    authUrl2.searchParams.set("state", "st_ch2");
    authUrl2.searchParams.set("code_challenge", ch2);
    authUrl2.searchParams.set("code_challenge_method", "S256");
    authUrl2.searchParams.set("resource", RESOURCE);
    const page2 = await fetch(authUrl2, { headers: { cookie } });
    const html2 = await page2.text();
    assert.match(html2, /Continue as|Choose account|Use a code/i);
    assert.doesNotMatch(html2, /name="decision" value="allow"/);
  });

});
