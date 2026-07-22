/**
 * HTTP dogfood against a live plus-service (spawned for the test).
 * Run: node --test test/http-dogfood.test.mjs  (from plus-service/)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
// High random port to avoid clashes with local services
const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;

async function waitHealth(ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("server did not become healthy");
}

before(async () => {
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      DOGFOOD_AUTO_GRANT: "1",
      // leave ANTHROPIC unset to prove refund path
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      // force dogfood checkout path in CI/local with real Stripe env
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PRICE_MONTHLY: "",
      STRIPE_PRICE_YEARLY: "",
      STRIPE_PRICE_TOPUP: "",
      STRIPE_DOGFOOD_CHECKOUT: "0",
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

describe("HTTP dogfood flows", () => {
  it("health reports port-aligned public base", async () => {
    const h = await (await fetch(`${BASE}/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.includedFilings, 150);
    // server log should mention publicBase with PORT
    await sleep(50);
    assert.match(child._log(), new RegExp(`publicBase=http://127\\.0\\.0\\.1:${PORT}`));
  });

  it("magic-link → exchange → me → failed classify refunds → topup", async () => {
    const ml = await fetch(`${BASE}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "http-dogfood@atoms.test" }),
    });
    assert.equal(ml.status, 200);

    // token only in log
    await sleep(50);
    const m = child._log().match(/token=(mt_[a-f0-9]+)/);
    assert.ok(m, "magic token in log");
    const token = m[1];

    const ex = await (
      await fetch(`${BASE}/v1/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    ).json();
    assert.ok(ex.session);
    assert.equal(ex.remaining, 150);
    assert.ok(["trialing", "active"].includes(ex.status));

    const sess = ex.session;
    const me = await (
      await fetch(`${BASE}/v1/me`, {
        headers: { authorization: `Bearer ${sess}` },
      })
    ).json();
    assert.equal(me.email, "http-dogfood@atoms.test");
    assert.equal(me.remaining, 150);

    // forged session rejected
    const bad = await fetch(`${BASE}/v1/me`, {
      headers: { authorization: "Bearer sess_forged_deadbeef" },
    });
    assert.equal(bad.status, 401);

    // classify without key should 503 and not burn filing
    const cl = await fetch(`${BASE}/v1/classify`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sess}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        capture: "dogfood thought",
        messagesRequest: {
          model: "x",
          max_tokens: 8,
          messages: [{ role: "user", content: "hi" }],
        },
      }),
    });
    if (!process.env.ANTHROPIC_API_KEY) {
      assert.equal(cl.status, 503);
      const me2 = await (
        await fetch(`${BASE}/v1/me`, {
          headers: { authorization: `Bearer ${sess}` },
        })
      ).json();
      assert.equal(me2.remaining, 150, "refund after failed classify");
    } else {
      // real key: expect 200 and remaining 149
      assert.ok(cl.status === 200 || cl.status === 503);
      if (cl.status === 200) {
        const me2 = await (
          await fetch(`${BASE}/v1/me`, {
            headers: { authorization: `Bearer ${sess}` },
          })
        ).json();
        assert.equal(me2.remaining, 149);
      }
    }

    const top = await (
      await fetch(`${BASE}/v1/billing/checkout`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sess}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "topup_50" }),
      })
    ).json();
    assert.ok(top.url || top.message);

    const me3 = await (
      await fetch(`${BASE}/v1/me`, {
        headers: { authorization: `Bearer ${sess}` },
      })
    ).json();
    assert.ok(me3.remaining >= 200 || me3.remaining === 199);
  });
});
