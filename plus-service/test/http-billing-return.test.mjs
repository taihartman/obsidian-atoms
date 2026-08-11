/**
 * Billing return page shares the product HTML shell + landing security headers.
 * Run: node --test test/http-billing-return.test.mjs  (from plus-service/)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 25000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let log = "";

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
  throw new Error(`server did not become healthy: ${log}`);
}

before(async () => {
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ATOMS_PLUS_STORE: "memory",
      RESEND_API_KEY: "",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => {
    log += d.toString();
  });
  child.stderr.on("data", (d) => {
    log += d.toString();
  });
  await waitHealth();
});

after(() => {
  if (child && !child.killed) child.kill("SIGTERM");
});

async function getReturn(ok) {
  const res = await fetch(`${BASE}/v1/billing/return?ok=${ok}`);
  return { res, html: await res.text() };
}

describe("GET /v1/billing/return shell", () => {
  it("ok=1 ships shell + landing security headers", async () => {
    const { res, html } = await getReturn("1");
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(html, /name="viewport"/);
    assert.match(html, /You're set/);
    assert.equal(/<script/i.test(html), false);
    assert.equal(html.includes("7c3aed"), false);
  });

  it("ok=0 keeps cancel copy", async () => {
    const { res, html } = await getReturn("0");
    assert.equal(res.status, 200);
    assert.match(html, /Checkout canceled/);
    assert.match(html, /No charge/);
  });
});
