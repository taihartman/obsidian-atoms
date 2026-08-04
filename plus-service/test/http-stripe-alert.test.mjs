/**
 * #238 U2/U3 class A — `POST /v1/billing/webhook` rejects.
 *
 * A reject needs only a malformed `Stripe-Signature`, so this proves KTD2's
 * flood guard end to end against a real spawned server on a real sqlite store:
 * anonymous rejects collapse to one row, and produce exactly one alert.
 * Recording and alerting must not change the response the caller already gets.
 *
 * It also pins the reject-path rate limit (F4): the day bucket collapses *rows*
 * but not *writes*, so an unauthenticated flood would otherwise UPSERT the same
 * row thousands of times and serialize on one Postgres row lock. Past the limit
 * the write is skipped and the response is byte-identical.
 *
 * RESEND_API_KEY is deliberately empty — `sendOpsEmail` takes its non-prod
 * console path, so the test counts delivery attempts without a network call.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSqliteStore } from "../src/store/sqlite.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";

/** Requests the reject path may record before the limiter closes it. */
const RATE_LIMIT_PER_MIN = 60;
/** Enough to prove collapse (one row, one alert) without hitting the limit. */
const FLOOD = 50;

let PORT;
let BASE;
let child;
let log = "";
let dbDir;
let dbPath;

/**
 * Let the OS pick a free port, then hand it to the child. Not race-free — the
 * port is released before the child binds it — but unlike a random number in a
 * fixed band it cannot collide with a concurrently running test file.
 */
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Poll a readiness condition instead of sleeping a guessed interval. */
async function waitFor(label, check, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - t0 >= ms) {
      throw new Error(`timed out waiting for ${label}: ${log}`);
    }
    await sleep(25);
  }
}

async function waitHealth(ms = 5000) {
  await waitFor(
    "server health",
    async () => {
      try {
        return (await fetch(`${BASE}/health`)).ok;
      } catch {
        return false;
      }
    },
    ms,
  );
}

/** How many ops emails the server has attempted so far, read from its log. */
function opsEmailCount() {
  return (log.match(/\[plus\] ops email/g) || []).length;
}

async function postReject(headers) {
  return fetch(`${BASE}/v1/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: BODY,
  });
}

function stopChild() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

const BODY = JSON.stringify({ id: "evt_forged", type: "ping", data: {} });
const FORGED = { "stripe-signature": "t=1,v1=deadbeef" };

before(async () => {
  PORT = await reserveFreePort();
  BASE = `http://127.0.0.1:${PORT}`;
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
      ATOMS_PLUS_RATE_LIMIT_PER_MIN: String(RATE_LIMIT_PER_MIN),
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
  it("a reject flood collapses to one row, one email, unchanged responses", async () => {
    for (let i = 0; i < FLOOD; i += 1) {
      const res = await postReject(FORGED);
      assert.equal(res.status, 400, "reject status unchanged by recording");
      const json = await res.json();
      assert.ok(json.message, "reject body unchanged by recording");
      assert.equal(json.received, undefined);
    }

    // A missing signature header rejects too, and joins the same daily row.
    const noSig = await postReject({});
    assert.equal(noSig.status, 400);

    // The alert is sent after the response is written, so poll for it rather
    // than sleeping a guessed interval.
    await waitFor("the ops alert", () => opsEmailCount() >= 1);
    assert.equal(opsEmailCount(), 1, "exactly one alert for the whole flood");
    assert.doesNotMatch(log, /sess_|mt_[a-f0-9]/, "no token in the ops log line");
  });

  it("stops writing past the rate limit, with the same status and body", async () => {
    // FLOOD + 1 rejects are already spent; overshoot the limit by a clear margin.
    const remaining = RATE_LIMIT_PER_MIN - (FLOOD + 1);
    for (let i = 0; i < remaining + 20; i += 1) {
      const res = await postReject(FORGED);
      assert.equal(res.status, 400, "throttling must not change the status");
      const json = await res.json();
      assert.ok(json.message, "throttling must not change the body");
      assert.equal(json.received, undefined);
    }

    // Read the row back from the server's own sqlite file.
    await stopChild();
    const store = createSqliteStore(dbPath);
    const rows = await store.listStripeIncidents({ since: 0 });
    assert.equal(rows.length, 1, "one row per kind per day, not one per request");
    assert.equal(rows[0].kind, "webhook_reject");
    assert.equal(rows[0].stripeId, "");
    assert.equal(
      rows[0].occurrences,
      RATE_LIMIT_PER_MIN,
      "occurrences stop at the rate limit — the extra requests cost no DB write",
    );
    assert.ok(rows[0].alertedAt, "the row that alerted is stamped");
    if (store.close) await store.close();
  });
});
