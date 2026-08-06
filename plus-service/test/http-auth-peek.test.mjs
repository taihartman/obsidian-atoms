/**
 * #240 U13 — `POST /v1/auth/peek` is the plugin's non-consuming check (KTD15).
 *
 * Run: node --test test/http-auth-peek.test.mjs  (from plus-service/)
 *
 * Against a spawned server on purpose: the store parity tests already prove
 * `peekMagic` reads without spending, and what needs proving here is that the
 * *route* does — end to end over HTTP, peek then peek then exchange — plus the
 * disclosure boundary the store cannot enforce. The store reports `usable` with
 * the stored hash for a row nobody may exchange; the route is what downgrades
 * that to `refused` and withholds the email.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { hashToken } from "../src/store/shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 24000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dir;
let dbPath;
/** @type {ReturnType<typeof createSqliteStore>} */
let store;
let log = "";

/** base64url(SHA-256(verifier)) — the wire shape `src/platform/pkce.ts` sends. */
function challenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

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

/**
 * Every case gets its own forged `x-forwarded-for`, because the rate limits
 * this unit also owns are keyed on `clientIp` and the window is a process-wide
 * Map — without this the suite would slowly rate-limit itself as it grew.
 * That the header works at all is the forgeability the ceilings are chosen
 * around; see `http-magic-link-rate-limits.test.mjs`.
 */
let ipCounter = 0;
function freshIp() {
  return `203.0.113.${(ipCounter++ % 250) + 1}`;
}

async function peek(body, ip = freshIp()) {
  const res = await fetch(`${BASE}/v1/auth/peek`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    body: await res.json(),
  };
}

async function exchange(body) {
  const res = await fetch(`${BASE}/v1/auth/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": freshIp(),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Plant a magic-token row the way U3's mint would have written it. */
let counter = 0;
function plant({ email, verifierHash = null, vault = null, expMs } = {}) {
  const token = `mt_${String(counter++).padStart(4, "0")}${"p".repeat(28)}`;
  store.writeMagicRowForTest(hashToken(token), {
    email: email || `u${counter}@ex.com`,
    expMs: expMs ?? Date.now() + 15 * 60 * 1000,
    verifierHash,
    vault,
  });
  return token;
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-u13-"));
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

describe("#240 U13 — POST /v1/auth/peek", () => {
  it("a matching verifier answers usable with the email and requesting vault", async () => {
    const verifier = `ver_${"m".repeat(40)}`;
    const token = plant({
      email: "match@ex.com",
      verifierHash: challenge(verifier),
      vault: "Requesting Vault",
    });

    const { status, body, cacheControl } = await peek({ token, verifier });
    assert.equal(status, 200);
    // U8 reads `json.result ?? json.verdict`; the vocabulary is the exchange's.
    assert.equal(body.result, "usable");
    assert.equal(body.email, "match@ex.com");
    assert.equal(body.vault, "Requesting Vault");
    // A usable answer names an account, so no intermediary may keep it.
    assert.equal(cacheControl, "no-store");
  });

  it("peeking twice and then exchanging still works (AE2, AE12)", async () => {
    // Non-consumption proved over HTTP, not at the store: the route is what
    // must never reach `exchangeMagic`, and only a real request can show that.
    const verifier = `ver_${"t".repeat(40)}`;
    const token = plant({
      email: "twice@ex.com",
      verifierHash: challenge(verifier),
      vault: "Twice Vault",
    });

    for (const _ of [1, 2]) {
      const out = await peek({ token, verifier });
      assert.equal(out.status, 200);
      assert.equal(out.body.result, "usable");
    }
    assert.equal(store.peekMagic(token).status, "usable");

    const spent = await exchange({ token, verifier });
    assert.equal(spent.status, 200);
    assert.ok(String(spent.body.sessionToken).startsWith("sess_"));
  });

  it("a peek that is never followed by an exchange leaves the token alive", async () => {
    const verifier = `ver_${"a".repeat(40)}`;
    const token = plant({
      email: "abandoned@ex.com",
      verifierHash: challenge(verifier),
    });

    await peek({ token, verifier });
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("a wrong verifier is refused with the vault and without the email (AE7)", async () => {
    const verifier = `ver_${"w".repeat(40)}`;
    const token = plant({
      email: "wrong@ex.com",
      verifierHash: challenge(verifier),
      vault: "Requesting Vault",
    });

    const bad = await peek({ token, verifier: `ver_${"z".repeat(40)}` });
    assert.equal(bad.status, 403);
    assert.equal(bad.body.result, "refused");
    assert.equal(bad.body.reason, "verifier_mismatch");
    // Load-bearing: this is the only server-attested vault name a refusing
    // plugin will ever hold. Without it U9's refusal has nothing to name but
    // the deep link's attacker-controlled `vault=` param.
    assert.equal(bad.body.vault, "Requesting Vault");
    // Naming the vault is not naming the account.
    assert.equal(bad.body.email, undefined);

    // R16 — refused costs nothing, so the right vault still redeems it.
    assert.equal(store.peekMagic(token).status, "usable");
    const good = await exchange({ token, verifier });
    assert.equal(good.status, 200);
  });

  it("a bound token peeked with no verifier answers refused, not usable", async () => {
    const token = plant({
      email: "noverifier@ex.com",
      verifierHash: challenge(`ver_${"n".repeat(40)}`),
      vault: "Bound Vault",
    });

    const { status, body } = await peek({ token });
    assert.equal(status, 403);
    assert.equal(body.result, "refused");
    assert.equal(body.vault, "Bound Vault");
    assert.equal(body.email, undefined);
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("an unbound token answers refused and discloses no email", async () => {
    // The store's shared compare passes an unbound row — correctly, for the
    // exchange, where an older build's token legitimately redeems. This route
    // must not inherit that pass: answering `usable` here would hand an
    // account email to any caller holding the link.
    const token = plant({ email: "legacy@ex.com", vault: "Legacy Vault" });

    for (const body of [{}, { verifier: `ver_${"q".repeat(40)}` }]) {
      const out = await peek({ token, ...body });
      assert.equal(out.status, 403, JSON.stringify(body));
      assert.equal(out.body.result, "refused");
      assert.equal(out.body.email, undefined);
    }
    // And it is still exchangeable — the peek refused, it did not revoke.
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("an expired token answers expired, distinguishably from refused (R7 vs R5)", async () => {
    const verifier = `ver_${"e".repeat(40)}`;
    const token = plant({
      email: "expired@ex.com",
      verifierHash: challenge(verifier),
      expMs: Date.now() - 1000,
    });

    const { status, body } = await peek({ token, verifier });
    assert.equal(status, 401);
    assert.equal(body.result, "expired");
    assert.equal(body.reason, undefined);
  });

  it("a token that never existed answers invalid", async () => {
    const { status, body } = await peek({
      token: `mt_${"0".repeat(32)}`,
      verifier: `ver_${"u".repeat(40)}`,
    });
    assert.equal(status, 401);
    assert.equal(body.result, "invalid");
  });

  it("a spent token answers invalid, and the peek minted nothing", async () => {
    const verifier = `ver_${"s".repeat(40)}`;
    const token = plant({
      email: "spent@ex.com",
      verifierHash: challenge(verifier),
    });
    await exchange({ token, verifier });

    const { status, body } = await peek({ token, verifier });
    assert.equal(status, 401);
    assert.equal(body.result, "invalid");
    assert.equal(body.session, undefined);
    assert.equal(body.sessionToken, undefined);
  });

  it("no verdict leaks a session, the magic token, or the verifier", async () => {
    const verifier = `ver_${"l".repeat(40)}`;
    const usable = plant({
      email: "leak@ex.com",
      verifierHash: challenge(verifier),
      vault: "Leak Vault",
    });
    const unbound = plant({ email: "leak2@ex.com" });
    const dead = plant({
      email: "leak3@ex.com",
      verifierHash: challenge(verifier),
      expMs: Date.now() - 1000,
    });

    const cases = [
      { token: usable, verifier },
      { token: usable, verifier: `ver_${"x".repeat(40)}` },
      { token: unbound, verifier },
      { token: dead, verifier },
      { token: `mt_${"9".repeat(32)}`, verifier },
    ];
    for (const body of cases) {
      const out = await peek(body);
      const serialized = JSON.stringify(out.body);
      assert.equal(serialized.includes("sess_"), false, serialized);
      assert.equal(serialized.includes(body.token), false, serialized);
      assert.equal(serialized.includes(body.verifier), false, serialized);
      assert.equal(serialized.includes(challenge(verifier)), false, serialized);
      // Every response, not only the one carrying an email — a caching rule
      // that depends on the verdict is a rule nobody can reason about.
      assert.equal(out.cacheControl, "no-store", serialized);
    }
  });

  it("a missing token is a 400, not a verdict", async () => {
    const { status, body } = await peek({ verifier: `ver_${"b".repeat(40)}` });
    assert.equal(status, 400);
    assert.equal(body.result, undefined);
  });

  it("an oversized verifier is rejected without touching the token", async () => {
    const verifier = `ver_${"o".repeat(40)}`;
    const token = plant({
      email: "huge@ex.com",
      verifierHash: challenge(verifier),
    });

    const { status } = await peek({ token, verifier: "v".repeat(4096) });
    assert.equal(status, 400);
    assert.equal(store.peekMagic(token).status, "usable");
  });
});
