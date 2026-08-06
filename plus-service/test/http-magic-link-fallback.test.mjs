/**
 * #240 U6 — the demoted fallback that mints a pasteable session on a form POST.
 *
 * Run: node --test test/http-magic-link-fallback.test.mjs  (from plus-service/)
 *
 * Against a spawned server, like the U3/U4/U5 suites. Three things are under
 * test and none of them is visible from the store layer: that a page load (GET
 * or HEAD, the shapes a mail scanner issues) still spends nothing even though
 * the form is now present (R6, R17); that an explicit submit of that form mints
 * a session for a **bound** token with no verifier presented, which is the whole
 * of KD3's cross-device recovery and the assertion that fails first if someone
 * later "hardens" this route (KD9); and that the page it renders no longer ends
 * by telling the user to tap **Refresh status** (R15, AE11).
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
const PORT = 26000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
/** The dedicated HTML-rendering route. Not the plugin's JSON exchange. */
const FALLBACK_PATH = "/v1/auth/exchange/fallback";

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
  const token = `mt_${String(counter++).padStart(4, "0")}${"z".repeat(28)}`;
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
  return plant({ verifierHash: challenge("ver_fallback"), ...fields });
}

async function land(token) {
  const res = await fetch(
    `${BASE}/v1/auth/exchange?token=${encodeURIComponent(token)}`,
    { redirect: "manual" },
  );
  return { res, html: await res.text() };
}

/** Submit the fallback form exactly as a scriptless browser would. */
async function submit(token) {
  const res = await fetch(`${BASE}${FALLBACK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    redirect: "manual",
  });
  return { res, html: await res.text() };
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "atoms-u6-"));
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

describe("#240 U6 — the fallback form is present but a page load spends nothing", () => {
  it("the demoted block carries a POST form with the token in a hidden field", async () => {
    const token = plantBound({ email: "form@ex.com", vault: "Vault A" });
    const { html } = await land(token);

    const block = html.slice(html.indexOf('id="fallback"'));
    assert.match(block, /<form[^>]*method="post"/i);
    assert.ok(
      block.includes(`action="${FALLBACK_PATH}"`),
      `the form posts to the dedicated route: ${block}`,
    );
    assert.match(block, /<input[^>]*type="hidden"[^>]*name="token"/i);
    assert.ok(block.includes(`value="${token}"`), "the hidden field carries the token");
    // Still no script anywhere — KTD4 holds with the form present.
    assert.equal(/<script/i.test(html), false);
  });

  it("the promoted (unbound) block carries the same form", async () => {
    // AE9's older-build page has no handoff at all, so the form is the page.
    const token = plant({ email: "oldform@ex.com", vault: "Old Vault" });
    const { res, html } = await land(token);

    assert.equal(res.status, 200);
    assert.equal(html.includes("obsidian://"), false);
    const block = html.slice(html.indexOf('id="fallback"'));
    assert.match(block, /<form[^>]*method="post"/i);
    assert.ok(block.includes(`value="${token}"`));
  });

  it("R17: two GETs of the page carrying the form still consume nothing", async () => {
    const token = plantBound({ email: "getsafe@ex.com", vault: "Vault B" });
    await land(token);
    await land(token);
    assert.equal(store.peekMagic(token).status, "usable");
  });

  it("R6: a scanner's HEAD of the landing page consumes nothing", async () => {
    const token = plantBound({ email: "headsafe@ex.com", vault: "Vault C" });
    const res = await fetch(
      `${BASE}/v1/auth/exchange?token=${encodeURIComponent(token)}`,
      { method: "HEAD", redirect: "manual" },
    );
    assert.equal(await res.text(), "", "HEAD carries no body");
    assert.equal(store.peekMagic(token).status, "usable");

    // And the token is still spendable by the deliberate action afterwards.
    const { res: posted } = await submit(token);
    assert.equal(posted.status, 200);
  });

  it("the CSP names form-action 'self' so the submit is permitted, not assumed", async () => {
    const token = plantBound({ email: "csp@ex.com", vault: "Vault D" });
    const { res } = await land(token);
    const csp = res.headers.get("content-security-policy") || "";
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /form-action 'self'/);
  });
});

describe("#240 U6 — the form POST mints a pasteable session", () => {
  it("KD9: a token carrying a verifier hash mints a session with no verifier presented", async () => {
    // THE assertion. Every link a current build mints is bound, so a fallback
    // that honored the verifier check would recover nothing and KD3's
    // cross-device path would be dead on arrival. This route skips the check by
    // design, for bound and unbound rows alike, and retires with #286 — a later
    // "hardening" pass that turns this red has deleted the recovery.
    const token = plantBound({ email: "bound@ex.com", vault: "Elsewhere" });
    const { res, html } = await submit(token);

    assert.equal(res.status, 200);
    assert.match(html, /bound@ex\.com/);
    assert.match(html, /sess_/, "the session is printed for pasting");
    assert.equal(store.peekMagic(token).status, "invalid", "the token is spent");
  });

  it("AE9: a token carrying no verifier hash mints a session too", async () => {
    const token = plant({ email: "unbound@ex.com" });
    const { res, html } = await submit(token);

    assert.equal(res.status, 200);
    assert.match(html, /unbound@ex\.com/);
    assert.match(html, /sess_/);
    assert.equal(store.peekMagic(token).status, "invalid");
  });

  it("AE11: the success page never says Refresh status", async () => {
    // The no-op by construction this whole issue exists because of. U11 removes
    // the sentence from the plugin; nothing else removes it from this page.
    const token = plantBound({ email: "copy@ex.com", vault: "Vault E" });
    const { html } = await submit(token);

    assert.equal(
      /refresh status/i.test(html),
      false,
      `success page still points at Refresh status: ${html}`,
    );
    // R15's replacement: paste it into Settings.
    assert.match(html, /paste/i);
    assert.match(html, /Settings/);
  });

  it("submitting the same form twice reports the link is gone on the second attempt", async () => {
    const token = plantBound({ email: "twice@ex.com", vault: "Vault F" });

    const first = await submit(token);
    assert.equal(first.res.status, 200);
    assert.match(first.html, /sess_/);

    const second = await submit(token);
    assert.equal(second.res.status, 400);
    assert.equal(second.html.includes("sess_"), false, "no session on a spent link");
    assert.match(second.html, /expired|used/i);
  });

  it("an expired or unknown token renders the dead-link page, never a session", async () => {
    const expired = plantBound({ email: "old@ex.com", expMs: Date.now() - 1000 });
    for (const token of [expired, "mt_neverminted"]) {
      const { res, html } = await submit(token);
      assert.equal(res.status, 400, token);
      assert.equal(html.includes("sess_"), false);
    }
  });

  it("a submit with no token at all renders the dead-link page rather than throwing", async () => {
    const res = await fetch(`${BASE}${FALLBACK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.text()).includes("sess_"), false);
  });

  it("the success page carries the landing headers, including no-store", async () => {
    // It prints a session token. A cached copy is a cached credential.
    const token = plantBound({ email: "hdr@ex.com", vault: "Vault G" });
    const { res } = await submit(token);

    assert.match(res.headers.get("content-type") || "", /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  it("the rendered session and email are escaped, not interpolated raw", async () => {
    const token = plantBound({ email: 'x"<b>@ex.com', vault: "Vault H" });
    const { html } = await submit(token);
    assert.equal(html.includes("<b>@ex.com"), false, "no raw markup from a stored value");
    assert.match(html, /&lt;b&gt;/);
  });
});

describe("#240 U6 — the two routes parse different content types", () => {
  it("the fallback parses urlencoded rather than throwing on it", async () => {
    // `readBody` is JSON-only and throws on anything else, which is why this is
    // a separate route rather than a branch inside the plugin's exchange.
    const token = plantBound({ email: "urlenc@ex.com", vault: "Vault I" });
    const { res } = await submit(token);
    assert.equal(res.status, 200);
  });

  it("POST /v1/auth/exchange still accepts JSON unchanged", async () => {
    const verifier = "ver_fallback";
    const token = plantBound({ email: "json@ex.com", vault: "Vault J" });
    const res = await fetch(`${BASE}/v1/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, verifier }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, "json@ex.com");
    assert.ok(String(body.sessionToken).startsWith("sess_"));
  });

  it("the fallback route rejects a GET — minting is a POST-only action (KTD5)", async () => {
    const token = plantBound({ email: "getmint@ex.com", vault: "Vault K" });
    const res = await fetch(`${BASE}${FALLBACK_PATH}?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 404);
    assert.equal(store.peekMagic(token).status, "usable");
  });
});
