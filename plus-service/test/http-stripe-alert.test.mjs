/**
 * #238 U2/U3 class A — `POST /v1/billing/webhook` rejects.
 *
 * The route has no rate limit and a reject needs only a malformed
 * `Stripe-Signature`, so this proves KTD2's flood guard end to end against a
 * real spawned server on a real sqlite store: 50 anonymous rejects collapse to
 * one row with `occurrences` 50, and produce exactly one alert. Recording and
 * alerting must not change the response the caller already gets.
 *
 * RESEND_API_KEY is deliberately empty — `sendOpsEmail` takes its non-prod
 * console path, so the test counts delivery attempts without a network call.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSqliteStore } from "../src/store/sqlite.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 18500 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let log = "";
let dbDir;
let dbPath;

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

function stopChild() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

before(async () => {
  dbDir = mkdtempSync(path.join(tmpdir(), "atoms-plus-238-"));
  dbPath = path.join(dbDir, "plus.sqlite");
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ATOMS_PLUS_ENV: "development",
      NODE_ENV: "test",
      DOGFOOD_AUTO_GRANT: "0",
      ATOMS_PLUS_STORE: "sqlite",
      ATOMS_PLUS_DATABASE_PATH: dbPath,
      ATOMS_PLUS_ALERT_EMAIL: "ops@atoms.test",
      ATOMS_PLUS_ALERT_THROTTLE_MIN: "60",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
      STRIPE_PRICE_MONTHLY: "price_monthly_test",
      STRIPE_PRICE_YEARLY: "price_yearly_test",
      STRIPE_PRICE_TOPUP: "price_topup_test",
      STRIPE_DOGFOOD_CHECKOUT: "0",
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

after(async () => {
  await stopChild();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

describe("#238 class A — webhook rejects are recorded and alerted once", () => {
  it("50 rejects collapse to one row, one email, unchanged responses", async () => {
    const body = JSON.stringify({ id: "evt_forged", type: "ping", data: {} });

    for (let i = 0; i < 50; i += 1) {
      const res = await fetch(`${BASE}/v1/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=1,v1=deadbeef",
        },
        body,
      });
      assert.equal(res.status, 400, "reject status unchanged by recording");
      const json = await res.json();
      assert.ok(json.message, "reject body unchanged by recording");
      assert.equal(json.received, undefined);
    }

    // A missing signature header rejects too, and joins the same daily row.
    const noSig = await fetch(`${BASE}/v1/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(noSig.status, 400);

    await sleep(200);
    const opsLines = log.match(/\[plus\] ops email/g) || [];
    assert.equal(opsLines.length, 1, `exactly one alert, got ${opsLines.length}`);
    assert.doesNotMatch(log, /sess_|mt_[a-f0-9]/, "no token in the ops log line");

    // Read the row back from the server's own sqlite file.
    await stopChild();
    const store = createSqliteStore(dbPath);
    const rows = await store.listStripeIncidents({ since: 0 });
    assert.equal(rows.length, 1, "one row per kind per day, not 51");
    assert.equal(rows[0].kind, "webhook_reject");
    assert.equal(rows[0].stripeId, "");
    assert.equal(rows[0].occurrences, 51);
    assert.ok(rows[0].alertedAt, "the row that alerted is stamped");
    if (store.close) await store.close();
  });
});
