/**
 * #240 U5 — `GET /v1/auth/exchange` is the landing page the emailed link opens.
 * It offers a tap-to-open handoff to the tokens that can complete one (KD9),
 * names the requesting vault (R18), prints no session (R11), asserts no outcome
 * it cannot observe (R14), and spends nothing on a page load (R6).
 *
 * Run: node --test test/http-magic-link-landing.test.mjs  (from plus-service/)
 *
 * Against a spawned server, like the U3/U4 suites: what is under test is the
 * route's branching, its headers, and the HTML it renders — none of which the
 * store layer can show. The test's own sqlite handle opens the same file the
 * server does, so it can plant rows and peek at what a page load did or did not
 * consume.
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

/** Plant a magic-token row the way the mint route would have written it. */
let counter = 0;
function plant({ email, verifierHash = null, vault = null, expMs } = {}) {
  const token = `mt_${String(counter++).padStart(4, "0")}${"y".repeat(28)}`;
  store.writeMagicRowForTest(hashToken(token), {
    email: email || `u${counter}@ex.com`,
    expMs: expMs ?? Date.now() + 15 * 60 * 1000,
    verifierHash,
    vault,
  });
  return token;
}

/** A bound token — every link a current plugin build mints carries a hash. */
function plantBound(fields = {}) {
  return plant({ verifierHash: challenge("ver_landing"), ...fields });
}

async function land(token, query = "") {
  const res = await fetch(
    `${BASE}/v1/auth/exchange?token=${encodeURIComponent(token)}${query}`,
    { redirect: "manual" },
  );
  return { res, html: await res.text() };
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-u5-"));
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

describe("#240 U5 — the landing page offers a handoff and spends nothing", () => {
  it("AE6: a bound link renders the obsidian:// handoff carrying the token and names the vault", async () => {
    const token = plantBound({ email: "ae6@ex.com", vault: "Remote Vault" });
    const { res, html } = await land(token);

    assert.equal(res.status, 200);
    assert.match(html, /obsidian:\/\/atoms-signin/);
    assert.ok(
      html.includes(`token=${encodeURIComponent(token)}`),
      "the anchor carries the magic token",
    );
    assert.match(html, /Remote Vault/);
  });

  it("AE5: two page loads consume nothing, and the token still exchanges after", async () => {
    const token = plantBound({ email: "ae5@ex.com", vault: "Vault A" });

    await land(token);
    await land(token);
    assert.equal(store.peekMagic(token).status, "usable");

    // Still redeemable by the plugin's bound route afterwards.
    const ex = await fetch(`${BASE}/v1/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, verifier: "ver_landing" }),
    });
    assert.equal(ex.status, 200);
    assert.equal(store.peekMagic(token).status, "invalid");
  });

  it("R11: the rendered body carries no session token", async () => {
    const token = plantBound({ email: "nosess@ex.com", vault: "Vault B" });
    const { html } = await land(token);
    assert.equal(html.includes("sess_"), false, "no session anywhere in body");
  });

  it("R7: an expired link says so and offers no handoff", async () => {
    const token = plantBound({
      email: "gone@ex.com",
      vault: "Vault C",
      expMs: Date.now() - 1000,
    });
    const { res, html } = await land(token);

    assert.equal(res.status, 400);
    assert.match(html, /expired/i);
    assert.equal(html.includes("obsidian://"), false);
    // R7's remedy is to request a new link from Settings.
    assert.match(html, /Settings/);
  });

  it("an unknown token renders the same dead-link message", async () => {
    const { res, html } = await land("mt_neverminted");
    assert.equal(res.status, 400);
    assert.equal(html.includes("obsidian://"), false);
    assert.equal(html.includes("sess_"), false);
  });

  it("carries Referrer-Policy, Cache-Control: no-store, and a script-free CSP", async () => {
    const token = plantBound({ email: "hdr@ex.com", vault: "Vault D" });
    const { res } = await land(token);

    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("cache-control"), "no-store");
    // `form-action 'self'` joined it in U6, which put a form on this page;
    // `default-src` does not govern that directive, so it is named explicitly.
    assert.equal(
      res.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    );
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  it("a token minted without a vault renders no vault name, never the string undefined", async () => {
    const token = plantBound({ email: "novault@ex.com", vault: null });
    const { res, html } = await land(token);

    assert.equal(res.status, 200);
    assert.match(html, /obsidian:\/\/atoms-signin/);
    assert.equal(html.includes("undefined"), false);
    assert.equal(html.includes("null"), false);
    // The handoff URL carries no empty vault parameter either.
    assert.equal(/vault=(&|"|')/.test(html), false);
  });

  it("AE9: an unbound link renders no handoff at all and promotes the fallback", async () => {
    // An older plugin build minted no verifier hash, so no build on that device
    // could complete U4's bound exchange — the anchor would be a dead end.
    const token = plant({ email: "old@ex.com", vault: "Old Vault" });
    const { res, html } = await land(token);

    assert.equal(res.status, 200);
    assert.equal(html.includes("obsidian://"), false, "no dead-end handoff");
    assert.match(html, /id="fallback"/);
    assert.match(html, /older version/i);
    // Promoted: with no handoff there is no troubleshooting block to sit under,
    // so the fallback *is* the page. The bound render below demotes it instead.
    assert.equal(/<details/.test(html), false);
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("R14: the page asserts no outcome, ships no script, and needs no transition", async () => {
    const token = plantBound({ email: "r14@ex.com", vault: "Vault E" });
    const { html } = await land(token);

    assert.equal(html.includes("visibilityState"), false);
    assert.equal(/<script/i.test(html), false);
    assert.equal(/Signed in/i.test(html), false);
    assert.equal(/sign-?in (succeeded|failed)/i.test(html), false);
    // R8's remedies are in a native <details> present in the initial HTML.
    assert.match(html, /<details/);
    // R10 — with a handoff on offer the fallback sits below it, demoted.
    assert.ok(
      html.indexOf('id="fallback"') > html.indexOf("<details"),
      "fallback is demoted below the troubleshooting block",
    );
  });

  it("R8: the troubleshooting block names both remedies distinctly", async () => {
    const token = plantBound({ email: "r8@ex.com", vault: "Vault F" });
    const { html } = await land(token);
    const details = html.slice(html.indexOf("<details"));

    // Wrong device: reopen the email where Obsidian is.
    assert.match(details, /device running Obsidian/i);
    // Wrong browser: the in-app browser blocks the scheme — use the system one.
    assert.match(details, /system browser/i);
  });

  it("KTD4: the handoff anchor is a real touch target", async () => {
    const token = plantBound({ email: "tap@ex.com", vault: "Vault G" });
    const { html } = await land(token);
    const anchor = html.slice(html.indexOf("<a href=\"obsidian://"));
    const tag = anchor.slice(0, anchor.indexOf(">") + 1);

    assert.match(tag, /display:block/);
    const m = /min-height:(\d+)px/.exec(tag);
    assert.ok(m, `anchor declares a min-height: ${tag}`);
    assert.ok(Number(m[1]) >= 44, `min-height ${m[1]}px is at least 44px`);
    assert.match(tag, /padding:/);
  });
});

describe("#240 U5 — the OAuth pending branch", () => {
  it("a stale or unknown pending id consumes nothing and renders no session", async () => {
    // Pre-existing hole: the stale pending fell through to exchanging the token
    // and then printing the session as HTML. Nothing may be spent here.
    const token = plantBound({ email: "stale@ex.com", vault: "Vault H" });
    const { res, html } = await land(token, "&pending=pend_doesnotexist");

    assert.equal(html.includes("sess_"), false, "no session printed");
    assert.equal(res.status < 300, false, "no 2xx signed-in page");
    assert.equal(
      store.peekMagic(token).status,
      "usable",
      "the token survives a stale pending",
    );
  });

  it("a live pending id still consumes the token and never renders the handoff", async () => {
    // The OAuth browser hop owns this branch (KTD12). The account here is not
    // Plus, so the hop stops at its own 403 — but the token is spent and no
    // obsidian:// handoff is offered for a request the user never consented to.
    const token = plantBound({ email: "oauth@ex.com", vault: "Vault I" });
    const pendingId = store.mcpCreatePending({
      clientId: "c_test",
      redirectUri: "http://127.0.0.1/cb",
    });
    const { html } = await land(token, `&pending=${encodeURIComponent(pendingId)}`);

    assert.equal(html.includes("obsidian://"), false);
    assert.equal(html.includes("sess_"), false);
    assert.equal(store.peekMagic(token).status, "invalid", "token consumed");
  });
});

describe("#240 U5 — dev-exchange is gone", () => {
  it("GET /v1/auth/dev-exchange returns 404", async () => {
    // Pinned so the duplicate cannot be reintroduced unbranched (#230's shape).
    const res = await fetch(`${BASE}/v1/auth/dev-exchange?token=mt_whatever`);
    assert.equal(res.status, 404);
  });
});
