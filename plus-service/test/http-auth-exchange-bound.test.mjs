/**
 * #240 U4 — `POST /v1/auth/exchange` is the plugin's route, and it is bound to
 * the verifier the requesting device registered at mint time (R12). A mismatch
 * is a refusal that spends nothing (R16) and reads differently from an expired
 * link, so the plugin can render R5's message rather than R7's.
 *
 * Run: node --test test/http-auth-exchange-bound.test.mjs  (from plus-service/)
 *
 * Against a spawned server, like the mint suite: the store parity tests in
 * `security-auth-criticals.test.mjs` prove the abort, and these prove the route
 * wires it up — including that the browser GET landing, which KD9 says skips
 * the check, still redeems a bound token.
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
const PORT = 22000 + Math.floor(Math.random() * 2000);
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

/** POST the plugin's exchange route. */
async function exchange(body) {
  const res = await fetch(`${BASE}/v1/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * Plant a magic-token row directly. The mint route is U3's and rate-limited;
 * what is under test here is redemption, so the row is written the way the
 * mint would have written it and the plaintext token stays in the test's hand.
 */
let counter = 0;
function plant({ email, verifierHash = null, vault = null, expMs } = {}) {
  const token = `mt_${String(counter++).padStart(4, "0")}${"x".repeat(28)}`;
  store.writeMagicRowForTest(hashToken(token), {
    email: email || `u${counter}@ex.com`,
    expMs: expMs ?? Date.now() + 15 * 60 * 1000,
    verifierHash,
    vault,
  });
  return token;
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-u4-"));
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

describe("#240 U4 — POST /v1/auth/exchange is verifier-bound", () => {
  it("the matching verifier issues a session and consumes the token", async () => {
    const verifier = `ver_${"m".repeat(40)}`;
    const token = plant({
      email: "match@ex.com",
      verifierHash: challenge(verifier),
      vault: "Requesting Vault",
    });

    const { status, body } = await exchange({ token, verifier });
    assert.equal(status, 200);
    assert.equal(body.email, "match@ex.com");
    assert.ok(String(body.sessionToken).startsWith("sess_"));
    assert.equal(store.peekMagic(token).status, "invalid");
  });

  it("a wrong verifier is refused, and the same link then succeeds (AE12, R16)", async () => {
    const verifier = `ver_${"w".repeat(40)}`;
    const token = plant({
      email: "wrong@ex.com",
      verifierHash: challenge(verifier),
      vault: "Requesting Vault",
    });

    const bad = await exchange({ token, verifier: `ver_${"z".repeat(40)}` });
    assert.equal(bad.status, 403);
    // U8 reads the verdict from `result` and lets it win over the status code,
    // in the same vocabulary U13's peek route answers in. Without it a 403
    // falls through the plugin's generic error mapper and R5's message — the
    // one thing the user needs here — is never rendered.
    assert.equal(bad.body.result, "refused");
    assert.equal(bad.body.reason, "verifier_mismatch");

    // The refusal carries nothing spendable — no session to hold and no magic
    // token echoed back into a log or a screenshot.
    const serialized = JSON.stringify(bad.body);
    assert.equal(serialized.includes("sess_"), false);
    assert.equal(serialized.includes(token), false);

    // R16 — still usable, so the user opens the requesting vault and taps again.
    assert.equal(store.peekMagic(token).status, "usable");
    const good = await exchange({ token, verifier });
    assert.equal(good.status, 200);
    assert.ok(String(good.body.sessionToken).startsWith("sess_"));
  });

  it("a bound token with no verifier is refused on this route", async () => {
    const verifier = `ver_${"n".repeat(40)}`;
    const token = plant({
      email: "noverifier@ex.com",
      verifierHash: challenge(verifier),
    });

    const { status, body } = await exchange({ token });
    assert.equal(status, 403);
    assert.equal(body.result, "refused");
    assert.equal(body.reason, "verifier_mismatch");
    assert.equal(body.sessionToken, undefined);
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("an unbound token still exchanges here, with or without a verifier", async () => {
    // KD9's older-plugin-build path. It is *not* what keeps U6's fallback
    // working — that route skips the check outright, for bound rows too.
    for (const body of [{}, { verifier: `ver_${"q".repeat(40)}` }]) {
      const token = plant({ email: "legacy@ex.com" });
      const out = await exchange({ token, ...body });
      assert.equal(out.status, 200, JSON.stringify(body));
      assert.ok(String(out.body.sessionToken).startsWith("sess_"));
    }
  });

  it("an expired bound token reads as expired, not as a mismatch (R7 vs R5)", async () => {
    const verifier = `ver_${"e".repeat(40)}`;
    const token = plant({
      email: "expired@ex.com",
      verifierHash: challenge(verifier),
      expMs: Date.now() - 1000,
    });

    const { status, body } = await exchange({ token, verifier });
    assert.equal(status, 401);
    assert.equal(body.result, "expired");
    assert.equal(body.reason, undefined);
    assert.match(body.message, /expired/i);
  });

  it("a token that never existed reads as invalid, not as expired", async () => {
    // Three outcomes, three codes: the plugin tells "this link died of age"
    // apart from "this link was already spent or was never real".
    const { status, body } = await exchange({
      token: `mt_${"0".repeat(32)}`,
      verifier: `ver_${"u".repeat(40)}`,
    });
    assert.equal(status, 401);
    assert.equal(body.result, "invalid");
  });

  it("an oversized verifier is rejected without touching the token", async () => {
    const verifier = `ver_${"o".repeat(40)}`;
    const token = plant({
      email: "huge@ex.com",
      verifierHash: challenge(verifier),
    });

    const { status } = await exchange({ token, verifier: "v".repeat(4096) });
    assert.equal(status, 400);
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("KD9: skipVerifierCheck still redeems a bound token", async () => {
    // The web path is at a different trust level and skips the check by design
    // (KD9). If this ever turns red because the abort was pushed into the store
    // unconditionally, cross-device recovery is gone.
    //
    // Asserted at the store rather than through the GET landing: #240 U5 made
    // that page non-consuming, so the caller of this skip is now U6's fallback
    // POST. The rule being guarded is the store's, and it is unchanged.
    const token = plant({
      email: "browser@ex.com",
      verifierHash: challenge(`ver_${"b".repeat(40)}`),
      vault: "Elsewhere",
    });

    const out = store.exchangeMagic(token, { skipVerifierCheck: true });
    assert.equal(out.account.email, "browser@ex.com");
    assert.ok(out.session);
    assert.equal(store.peekMagic(token).status, "invalid");
  });
});
