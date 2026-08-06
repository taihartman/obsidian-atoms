/**
 * #320 U3 — `POST /v1/auth/sign-out-all`, the control that re-earns the
 * account-wide revoke U1 took off the sign-in path.
 *
 * Run: node --test test/http-auth-sign-out-all.test.mjs  (from plus-service/)
 *
 * Against a spawned server, and asserting against the store rather than the
 * response body: a route that answers `{ ok: true }` while revoking nothing
 * would pass any test that only reads the response. `server.mjs` creates and
 * listens at module scope with no export, so the only way to exercise the route
 * is a child process on a random port over a temp sqlite file that this process
 * then re-opens. Same harness as `http-auth-peek.test.mjs`.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSqliteStore } from "../src/store/sqlite.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 26000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
/** `config.rateLimitPerMinute`'s default, which the spawned server inherits. */
const RATE_LIMIT = 30;

let child;
let dir;
let dbPath;
/** @type {ReturnType<typeof createSqliteStore>} */
let store;
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

let ipCounter = 0;
function freshIp() {
  return `203.0.113.${(ipCounter++ % 250) + 1}`;
}

async function signOutAll(bearerToken) {
  const headers = { "x-forwarded-for": freshIp() };
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  const res = await fetch(`${BASE}/v1/auth/sign-out-all`, {
    method: "POST",
    headers,
  });
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    body: await res.json(),
  };
}

/** An entitled account with `count` live verified sessions, as sign-in leaves it. */
function seedAccount(email, count = 1) {
  store.grantPeriod(email, { remaining: 50, status: "active" });
  return Array.from({ length: count }, () =>
    store.createSession(email, { verified: true }),
  );
}

const live = (session) =>
  store.accountFromSession(session, { requireVerified: true })?.email ?? null;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-320-"));
  dbPath = path.join(dir, "plus.sqlite");
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ATOMS_PLUS_STORE: "sqlite",
      ATOMS_PLUS_DATABASE_PATH: dbPath,
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
  store = createSqliteStore(dbPath);
});

after(() => {
  if (child && !child.killed) child.kill("SIGTERM");
  if (store?.close) store.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("#320 U3 — POST /v1/auth/sign-out-all", () => {
  it("revokes every session on the account, the caller's included", async () => {
    const [desktop, phone] = seedAccount("both@ex.com", 2);

    const { status, body, cacheControl } = await signOutAll(desktop);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(cacheControl, "no-store");

    // KTD2 — one code path, no carve-out for the device that asked.
    assert.equal(live(desktop), null);
    assert.equal(live(phone), null);
  });

  it("answers 401 with no Authorization header, and revokes nothing", async () => {
    const [session] = seedAccount("noheader@ex.com");

    const { status, body } = await signOutAll(null);
    assert.equal(status, 401);
    assert.match(body.message, /sign out all devices/i);
    assert.equal(live(session), "noheader@ex.com");
  });

  it("answers 401 to a garbage bearer, and revokes nothing", async () => {
    const [session] = seedAccount("garbage@ex.com");

    const { status } = await signOutAll("sess_not_a_real_session");
    assert.equal(status, 401);
    assert.equal(live(session), "garbage@ex.com");
  });

  it("answers 401 to an already-revoked bearer, and revokes nothing", async () => {
    const [dead, alive] = seedAccount("revoked@ex.com", 2);
    store.revokeSession(dead);

    const { status } = await signOutAll(dead);
    assert.equal(status, 401);
    assert.equal(live(alive), "revoked@ex.com");
  });

  it("answers 401 to an unverified soft session, and revokes nothing", async () => {
    // The case the permissive sibling would have answered 200 to (KTD5): a
    // session that never proved it owns the email must not be able to evict
    // every device that did.
    const soft = store.startWithEmail("soft@ex.com");
    assert.equal(soft.ok, true);
    const [verified] = seedAccount("soft@ex.com");

    const { status } = await signOutAll(soft.session);
    assert.equal(status, 401);
    assert.equal(live(verified), "soft@ex.com");
  });

  it("answers 401, not 500, when the caller retries with its now-dead session", async () => {
    const [session] = seedAccount("retry@ex.com");

    assert.equal((await signOutAll(session)).status, 200);
    const second = await signOutAll(session);
    assert.equal(second.status, 401);
  });

  it("leaves another account's sessions alone", async () => {
    const [mine] = seedAccount("mine320@ex.com");
    const [theirs] = seedAccount("theirs320@ex.com");

    assert.equal((await signOutAll(mine)).status, 200);

    assert.equal(live(mine), null);
    assert.equal(live(theirs), "theirs320@ex.com");
  });

  it("disconnects the account's connected apps (R10)", async () => {
    const [session] = seedAccount("mcp320@ex.com");
    const tokens = store.mintMcpTokensForTest(
      "mcp320@ex.com",
      "client-320",
      "https://example.test/mcp",
    );
    assert.equal(store.accountFromMcpToken(tokens.accessToken)?.email, "mcp320@ex.com");

    assert.equal((await signOutAll(session)).status, 200);

    // Connected apps authenticate off their own grants, not the sessions table,
    // so without the MCP revoke a device the user no longer controls keeps
    // account access for the life of its 30-day refresh token.
    assert.equal(store.accountFromMcpToken(tokens.accessToken), null);
  });

  it("is durable against a checkout webhook that lands afterwards (R10)", async () => {
    // The one that proves the control is durable rather than advisory.
    const soft = store.startWithEmail("late@ex.com");
    assert.equal(
      store.bindCheckoutSession("cs_late_320", "late@ex.com", soft.session),
      true,
    );
    const [session] = seedAccount("late@ex.com");

    assert.equal((await signOutAll(session)).status, 200);

    // `promoteCheckoutSession` clears `revoked` without asking why the row was
    // revoked, and bindings live 24h. If the route left the binding behind, this
    // returns true and one evicted session comes back verified — permanently,
    // because after U1 no later sign-in reaps it.
    assert.equal(store.promoteCheckoutSession("cs_late_320", "late@ex.com"), false);
    assert.equal(store.accountFromSession(soft.session), null);
  });

  it("rate limits on the account, answering 429 with retryAfterSec (R9)", async () => {
    // Seeded rather than looped on one bearer: KTD2 kills the caller's own
    // session on first success, so a repeat call 401s before reaching the
    // limiter, and the HTTP sign-in path has a ceiling of its own. A fresh
    // session per call, minted between calls — every success revokes the whole
    // account, so seeding them all up front would kill the later bearers too.
    seedAccount("flood@ex.com", 0);

    const statuses = [];
    for (let i = 0; i <= RATE_LIMIT; i += 1) {
      const session = store.createSession("flood@ex.com", { verified: true });
      statuses.push(await signOutAll(session));
    }

    assert.equal(statuses.filter((r) => r.status === 200).length, RATE_LIMIT);
    const limited = statuses[RATE_LIMIT];
    assert.equal(limited.status, 429);
    assert.ok(limited.body.retryAfterSec >= 1);
  });
});
