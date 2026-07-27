/**
 * HTTP Ask mirror against spawned plus-service.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 19000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;

async function waitHealth(ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("server did not become healthy");
}

async function sessionFor(email) {
  const ml = await fetch(`${BASE}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(ml.status, 200);
  await sleep(50);
  const m = child._log().match(/token=(mt_[a-f0-9]+)/g);
  assert.ok(m?.length, "magic token in log");
  const last = m[m.length - 1];
  const token = last.replace("token=", "");
  const ex = await (
    await fetch(`${BASE}/v1/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
  ).json();
  assert.ok(ex.session);
  return ex.session;
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
      ATOMS_PLUS_ENV: "development",
      ANTHROPIC_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PRICE_MONTHLY: "",
      STRIPE_PRICE_YEARLY: "",
      STRIPE_PRICE_TOPUP: "",
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

describe("HTTP ask mirror", () => {
  it("401 without session", async () => {
    const r = await fetch(`${BASE}/v1/ask/mirror/status`);
    assert.equal(r.status, 401);
  });

  it("upsert status wipe + reject mcp bearer", async () => {
    const session = await sessionFor("ask-mirror@atoms.test");
    const headers = {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
    };

    let r = await fetch(`${BASE}/v1/ask/mirror/upsert`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "forged@evil.com",
        atoms: [
          {
            path: "Atoms/Hello.md",
            title: "Hello",
            body: "verbatim body for ask",
            tags: ["t"],
          },
        ],
      }),
    });
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.equal(j.count, 1);
    assert.equal(j.upserted, 1);

    r = await fetch(`${BASE}/v1/ask/mirror/status`, { headers });
    assert.equal(r.status, 200);
    j = await r.json();
    assert.equal(j.count, 1);

    r = await fetch(`${BASE}/v1/ask/mirror/upsert`, {
      method: "POST",
      headers: {
        authorization: "Bearer mcp_faketoken",
        "content-type": "application/json",
      },
      body: JSON.stringify({ atoms: [] }),
    });
    assert.equal(r.status, 401);

    r = await fetch(`${BASE}/v1/ask/mirror/wipe`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(r.status, 200);
    r = await fetch(`${BASE}/v1/ask/mirror/status`, { headers });
    j = await r.json();
    assert.equal(j.count, 0);
  });

  it("413 oversized body", async () => {
    const session = await sessionFor("ask-big@atoms.test");
    const r = await fetch(`${BASE}/v1/ask/mirror/upsert`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        atoms: [
          {
            path: "Atoms/Big.md",
            title: "Big",
            body: "x".repeat(100_001),
          },
        ],
      }),
    });
    assert.equal(r.status, 413);
  });
});
