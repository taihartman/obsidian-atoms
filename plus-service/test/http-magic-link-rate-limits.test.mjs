/**
 * #240 U13 / KTD10 — every unauthenticated magic-token surface is rate-limited,
 * and each one on its own key.
 *
 * Run: node --test test/http-magic-link-rate-limits.test.mjs  (from plus-service/)
 *
 * The separation is the point. A non-consuming check is an unauthenticated
 * oracle on token validity, and the landing page is the surface a mail scanner
 * or a link-preview bot hammers without anyone asking it to. If that traffic
 * shared a key with the deliberate POSTs, a scanner would 429 the human's
 * "Sign in here" button and the plugin's peek — turning a defence against
 * undirected noise into the outage it was meant to prevent.
 *
 * Ceilings come from `MAGIC_LINK_RATE_LIMITS` rather than being restated here,
 * so tuning a number is one edit and never a silently stale assertion.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MAGIC_LINK_RATE_LIMITS } from "../src/ratelimit.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 26000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dir;
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

/** A token that resolves to nothing — every surface answers before the store. */
const DEAD = `mt_${"0".repeat(32)}`;

/**
 * One callable per surface, keyed by the same name `MAGIC_LINK_RATE_LIMITS`
 * uses, so a surface added to the table without a probe here is a missing-key
 * failure rather than a quietly unexercised limit.
 */
const SURFACES = {
  landing: (ip) =>
    fetch(`${BASE}/v1/auth/exchange?token=${DEAD}`, {
      headers: { "x-forwarded-for": ip },
    }),
  peek: (ip) =>
    fetch(`${BASE}/v1/auth/peek`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ token: DEAD, verifier: `ver_${"r".repeat(40)}` }),
    }),
  exchange: (ip) =>
    fetch(`${BASE}/v1/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ token: DEAD }),
    }),
  fallback: (ip) =>
    fetch(`${BASE}/v1/auth/exchange/fallback`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": ip,
      },
      body: new URLSearchParams({ token: DEAD }).toString(),
    }),
};

/** Spend `n` requests against one surface from one IP; return the last status. */
async function hammer(name, ip, n) {
  let status = 0;
  for (let i = 0; i < n; i++) status = (await SURFACES[name](ip)).status;
  return status;
}

let ipCounter = 0;
function freshIp() {
  return `198.51.100.${(ipCounter++ % 250) + 1}`;
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-u13-rl-"));
  child = spawn("node", ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ATOMS_PLUS_STORE: "sqlite",
      ATOMS_PLUS_DATABASE_PATH: path.join(dir, "plus.sqlite"),
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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("#240 U13 / KTD10 — four surfaces, four keys", () => {
  it("declares a distinct key prefix and a ceiling for each surface", () => {
    const names = Object.keys(MAGIC_LINK_RATE_LIMITS);
    assert.deepEqual(names.sort(), Object.keys(SURFACES).sort());
    const prefixes = names.map((n) => MAGIC_LINK_RATE_LIMITS[n].key);
    assert.equal(new Set(prefixes).size, names.length, prefixes.join(","));
    for (const n of names) {
      assert.ok(MAGIC_LINK_RATE_LIMITS[n].limit > 0, n);
    }
  });

  for (const name of Object.keys(SURFACES)) {
    it(`${name} answers 429 past its own ceiling`, async () => {
      const { limit } = MAGIC_LINK_RATE_LIMITS[name];
      const ip = freshIp();
      const last = await hammer(name, ip, limit);
      assert.notEqual(last, 429, `${name} 429'd inside its ceiling`);
      assert.equal((await SURFACES[name](ip)).status, 429);
    });
  }

  it("exhausting the landing page does not 429 the peek, the exchange, or the fallback", async () => {
    // Same IP throughout: a scanner and the human share an address all the
    // time — behind a NAT, on a phone, or because `x-forwarded-for` is
    // client-supplied and can be aimed at a victim's bucket on purpose.
    const ip = freshIp();
    await hammer("landing", ip, MAGIC_LINK_RATE_LIMITS.landing.limit);
    assert.equal((await SURFACES.landing(ip)).status, 429);

    for (const name of ["peek", "exchange", "fallback"]) {
      assert.notEqual(
        (await SURFACES[name](ip)).status,
        429,
        `${name} shares the landing page's bucket`,
      );
    }
  });

  it("exhausting the peek does not 429 the exchange", async () => {
    // The reverse direction matters too: a plugin retrying a peek must not
    // lock the user out of the exchange they are about to approve.
    const ip = freshIp();
    await hammer("peek", ip, MAGIC_LINK_RATE_LIMITS.peek.limit);
    assert.equal((await SURFACES.peek(ip)).status, 429);
    assert.notEqual((await SURFACES.exchange(ip)).status, 429);
  });

  it("a 429 from the peek states no verdict", async () => {
    // U8 lets a stated verdict beat the status code, so a throttle that
    // labelled itself `invalid` or `refused` would be read as a decision about
    // the link and would send the user to request a new one for no reason.
    const ip = freshIp();
    await hammer("peek", ip, MAGIC_LINK_RATE_LIMITS.peek.limit);
    const res = await SURFACES.peek(ip);
    const body = await res.json();
    assert.equal(res.status, 429);
    assert.equal(body.result, undefined);
    assert.equal(body.verdict, undefined);
    assert.ok(body.retryAfterSec > 0);
  });
});
