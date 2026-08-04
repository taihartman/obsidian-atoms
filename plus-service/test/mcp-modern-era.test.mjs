/**
 * Dual-era MCP: modern 2026-07-28 (no initialize) + legacy regression hooks.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_CALLBACK } from "../src/oauth/constants.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 19400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const RESOURCE = `${BASE}/mcp`;

let child;

function pkce() {
  const verifier = "v" + "b".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function waitHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* */
    }
    await sleep(80);
  }
  throw new Error("unhealthy");
}

/**
 * @returns {Promise<string>} mcp access token
 */
async function mintMcpTokenAndSeed() {
  const { verifier, challenge } = pkce();
  const state = "st_modern";
  const clientId = "cli_modern_era";
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
  const pm = html.match(/name="pending_id" value="([^"]+)"/);
  assert.ok(pm);
  const pendingId = pm[1];
  const email = "modern-era@atoms.test";
  await fetch(`${BASE}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, email }).toString(),
    redirect: "manual",
  });
  await sleep(80);
  const tm = child._log().match(/token=(mt_[a-f0-9]+)/g);
  assert.ok(tm?.length);
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
  const loc = new URL(consent.headers.get("location") || "");
  const code = loc.searchParams.get("code");
  assert.ok(code);
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

  await fetch(`${BASE}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
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
          path: "Atoms/Modern.md",
          title: "Modern era fixture",
          body: "dual-era modern probe body unique-xyz-99",
        },
      ],
    }),
  });

  return tokens.access_token;
}

/**
 * Parse MCP JSON or SSE single-event body into JSON-RPC object(s).
 * @param {Response} res
 */
async function parseMcpBody(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return JSON.parse(text);
  }
  // SSE: data: {...}
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  assert.ok(lines.length, `expected SSE data lines, got: ${text.slice(0, 200)}`);
  const last = lines[lines.length - 1].replace(/^data:\s*/, "");
  return JSON.parse(last);
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

describe("MCP modern era 2026-07-28", () => {
  it("tools/list + tools/call without initialize; titles and cache fields", async () => {
    const access = await mintMcpTokenAndSeed();

    const listRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "modern-test",
              version: "0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    assert.equal(listRes.status, 200, await listRes.clone().text());
    const listMsg = await parseMcpBody(listRes);
    const result = listMsg.result || listMsg;
    assert.ok(Array.isArray(result.tools), JSON.stringify(listMsg).slice(0, 400));
    assert.ok(result.tools.length >= 5);
    for (const t of result.tools) {
      assert.ok(t.title || t.annotations?.title, `title missing on ${t.name}`);
      assert.ok(
        t.securitySchemes || t._meta?.securitySchemes,
        `securitySchemes missing on ${t.name}`,
      );
    }
    const create = result.tools.find((t) => t.name === "create_atom");
    assert.ok(create);
    assert.equal(create.annotations?.destructiveHint, true);
    const statusTool = result.tools.find((t) => t.name === "mirror_status");
    assert.ok(statusTool, "mirror_status must appear in tools/list");
    assert.ok(statusTool.title || statusTool.annotations?.title);
    const listTagsTool = result.tools.find((t) => t.name === "list_tags");
    assert.ok(listTagsTool, "list_tags must appear in tools/list");
    assert.ok(listTagsTool.title || listTagsTool.annotations?.title);
    // cache hints when present (modern complete)
    if (result.ttlMs != null) {
      assert.ok(result.ttlMs >= 60_000, `ttlMs=${result.ttlMs}`);
      assert.equal(result.cacheScope, "public");
    }

    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "search_atoms",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "search_atoms",
          arguments: { query: "unique-xyz-99" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "modern-test",
              version: "0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    assert.equal(callRes.status, 200, await callRes.clone().text());
    const callMsg = await parseMcpBody(callRes);
    const callText = JSON.stringify(callMsg);
    assert.match(callText, /Modern era fixture|unique-xyz-99/);
  });

  it("sess_ and missing bearer still 401", async () => {
    const unauth = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate") || "", /resource_metadata/);

    const sess = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer sess_fake",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(sess.status, 401);
  });

  it("legacy initialize still works (2025-03-26)", async () => {
    const access = await mintMcpTokenAndSeed();
    const init = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
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
          clientInfo: { name: "legacy-test", version: "0" },
        },
      }),
    });
    assert.equal(init.status, 200, await init.clone().text());
    const body = await parseMcpBody(init);
    assert.ok(body.result || body.protocolVersion || body.serverInfo || body.result?.protocolVersion);
  });

  it("legacy Accept: application/json only (Claude-style) — not 406", async () => {
    const access = await mintMcpTokenAndSeed();
    const init = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "claude-json-only", version: "0" },
        },
      }),
    });
    assert.notEqual(init.status, 406, await init.clone().text());
    assert.equal(init.status, 200, await init.clone().text());
    const ct = init.headers.get("content-type") || "";
    assert.match(ct, /application\/json/);
    const body = await init.json();
    assert.ok(body.result?.protocolVersion || body.result?.serverInfo);

    const list = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(list.status, 200, await list.clone().text());
    const listBody = await list.json();
    const tools = listBody.result?.tools || [];
    assert.ok(tools.length >= 5, JSON.stringify(listBody).slice(0, 300));
    assert.ok(tools.some((t) => t.name === "search_atoms"));
  });
});
