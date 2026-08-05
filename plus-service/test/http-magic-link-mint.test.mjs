/**
 * #240 U3 — POST /v1/auth/magic-link records the requesting device's verifier
 * hash (R12) and the requesting vault (R3) against the token, and sweeps every
 * expired magic-token row on the way in (KTD13).
 *
 * Run: node --test test/http-magic-link-mint.test.mjs  (from plus-service/)
 *
 * Deliberately against a spawned server rather than the store layer: the route's
 * own validation and its call into createMagicToken are both under test. The
 * server runs on a temp sqlite file this process also opens, which is the only
 * way a route test can see what the route actually stored — there is no peek
 * endpoint until U13.
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
const PORT = 20000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const RATE_LIMIT = 5;

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

/** POST the mint route. `ip` isolates the per-IP rate-limit bucket per test. */
async function mint(body, ip) {
  return fetch(`${BASE}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/**
 * The plaintext token exists only in the emailed link, which non-prod delivery
 * prints to the console. Reading it back out is how the test holds what the
 * user's mail client would hold.
 */
async function tokenFromLog(email) {
  for (let i = 0; i < 40; i++) {
    const m = log.match(
      new RegExp(`magic link for ${email}: \\S*[?&]token=([^\\s&]+)`),
    );
    if (m) return decodeURIComponent(m[1]);
    await sleep(25);
  }
  throw new Error(`no magic link logged for ${email}`);
}

function rowFor(rows, email) {
  return rows.find((r) => r.email === email);
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-u3-"));
  dbPath = path.join(dir, "plus.sqlite");
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ATOMS_PLUS_STORE: "sqlite",
      ATOMS_PLUS_DATABASE_PATH: dbPath,
      ATOMS_PLUS_RATE_LIMIT_PER_MIN: String(RATE_LIMIT),
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

describe("#240 U3 — mint records verifier hash and vault", () => {
  it("stores both against the token, and neither reaches the log", async () => {
    const email = "bound@ex.com";
    const verifierHash = "a".repeat(64);
    const res = await mint(
      { email, verifierHash, vault: "Remote Vault" },
      "10.0.0.1",
    );
    assert.equal(res.status, 200);

    const row = rowFor(store.magicRowsForTest(), email);
    assert.equal(row.verifierHash, verifierHash);
    assert.equal(row.vault, "Remote Vault");

    // A peek with the emailed token shows the requesting vault (R3/R18).
    const peek = store.peekMagic(await tokenFromLog(email));
    assert.equal(peek.status, "usable");
    assert.equal(peek.vault, "Remote Vault");

    // Neither value is logged — the link log must not grow (R11).
    assert.equal(log.includes(verifierHash), false);
    assert.equal(log.includes("Remote Vault"), false);
  });

  it("a mint omitting both still succeeds and lands on the unbound page", async () => {
    const email = "unbound@ex.com";
    assert.equal((await mint({ email }, "10.0.0.2")).status, 200);

    const row = rowFor(store.magicRowsForTest(), email);
    assert.equal(row.verifierHash, null);
    assert.equal(row.vault, null);

    // #240 U5 — an older build's link still reaches a working page, but the
    // page offers the fallback instead of a handoff no build there can finish.
    const token = await tokenFromLog(email);
    const html = await fetch(
      `${BASE}/v1/auth/exchange?token=${encodeURIComponent(token)}`,
    );
    assert.equal(html.status, 200);
    const body = await html.text();
    assert.match(body, /id="fallback"/);
    assert.equal(body.includes("obsidian://"), false);
  });

  it("rejects an oversized or non-string verifierHash without storing it", async () => {
    for (const [label, body] of [
      ["oversized", { email: "bad1@ex.com", verifierHash: "a".repeat(4096) }],
      ["non-string", { email: "bad2@ex.com", verifierHash: { hash: "x" } }],
      ["numeric", { email: "bad3@ex.com", verifierHash: 12345 }],
      ["oversized vault", { email: "bad4@ex.com", vault: "v".repeat(4096) }],
      ["non-string vault", { email: "bad5@ex.com", vault: ["v"] }],
    ]) {
      const res = await mint(body, "10.0.0.3");
      assert.equal(res.status, 400, `${label} should be rejected`);
      assert.equal(
        rowFor(store.magicRowsForTest(), body.email),
        undefined,
        `${label} should store nothing`,
      );
    }
  });

  it("still rate-limits the mint key with the new fields present", async () => {
    const ip = "10.0.0.4";
    let last;
    for (let i = 0; i <= RATE_LIMIT; i++) {
      last = await mint(
        {
          email: `rl${i}@ex.com`,
          verifierHash: "b".repeat(64),
          vault: "Rate Vault",
        },
        ip,
      );
    }
    assert.equal(last.status, 429);
    assert.equal((await last.json()).message, "Too many requests");
  });
});

describe("#240 U3 — the mint sweeps expired rows (KTD13)", () => {
  it("removes an expired row belonging to a different email", async () => {
    // The commonest shape KD7 promises cannot happen: someone requested one
    // link, never tapped it, and never came back. Nothing else ever deletes it.
    store.writeMagicRowForTest("stale-other-email-key", {
      email: "never-came-back@ex.com",
      expMs: Date.now() - 60_000,
      verifierHash: "c".repeat(64),
      vault: "Abandoned Vault",
    });

    assert.equal((await mint({ email: "sweeper@ex.com" }, "10.0.0.5")).status, 200);

    const rows = store.magicRowsForTest();
    assert.equal(
      rows.some((r) => r.email === "never-came-back@ex.com"),
      false,
      "an expired row for another email must be swept — the sweep is global",
    );
    assert.equal(
      JSON.stringify(rows).includes("Abandoned Vault"),
      false,
      "the abandoned vault name must not outlive its token",
    );
  });

  it("removes an expired row for the minting email", async () => {
    store.writeMagicRowForTest("stale-same-email-key", {
      email: "returning@ex.com",
      expMs: Date.now() - 1,
      vault: "Old Vault",
    });

    assert.equal(
      (await mint({ email: "returning@ex.com" }, "10.0.0.6")).status,
      200,
    );

    const rows = store
      .magicRowsForTest()
      .filter((r) => r.email === "returning@ex.com");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key === "stale-same-email-key", false);
    assert.equal(rows[0].vault, null);
  });

  it("leaves live rows alone — same email and other email both survive", async () => {
    const mine = "live-mine@ex.com";
    const theirs = "live-theirs@ex.com";
    assert.equal((await mint({ email: mine, vault: "Mine" }, "10.0.0.7")).status, 200);
    const mineToken = await tokenFromLog(mine);
    assert.equal(
      (await mint({ email: theirs, vault: "Theirs" }, "10.0.0.8")).status,
      200,
    );
    const theirsToken = await tokenFromLog(theirs);

    // A third mint runs the sweep again, moments after both were minted.
    assert.equal((await mint({ email: mine }, "10.0.0.9")).status, 200);

    assert.equal(store.peekMagic(mineToken).vault, "Mine");
    assert.equal(store.peekMagic(theirsToken).vault, "Theirs");
    assert.ok(store.exchangeMagic(mineToken)?.session);
    assert.ok(store.exchangeMagic(theirsToken)?.session);
  });
});
