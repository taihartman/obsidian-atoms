import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 21000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://com.atoms.g2.evenhub";
let child;

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function dpop(method, pathName, nonce, token, overrides = {}) {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk, ...overrides.header };
  const payload = { htm: method, htu: `${BASE}${pathName}`, iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(), nonce, ...(token ? { ath: createHash("sha256").update(token).digest("base64url") } : {}), ...overrides.payload };
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function waitHealth() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {} await sleep(100); }
  throw new Error(`server did not start: ${child._log()}`);
}

async function sessionFor(email) {
  await fetch(`${BASE}/v1/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  await sleep(30);
  const tokens = [...child._log().matchAll(/token=(mt_[a-f0-9]+)/g)];
  const token = tokens.at(-1)[1];
  return (await (await fetch(`${BASE}/v1/auth/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })).json()).session;
}

async function nonce() {
  const response = await fetch(`${BASE}/v1/g2/auth/nonce`, { headers: { origin: ORIGIN } });
  assert.equal(response.status, 200);
  return (await response.json()).nonce;
}

async function pair(scopes = ["g2:query"]) {
  const session = await sessionFor(`g2-${randomUUID()}@atoms.test`);
  const minted = await fetch(`${BASE}/v1/g2/pair/code`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${session}`, "content-type": "application/json" }, body: JSON.stringify({ scopes }) });
  assert.equal(minted.status, 200, await minted.clone().text());
  const code = (await minted.json()).code; const n = await nonce();
  const redeemed = await fetch(`${BASE}/v1/g2/pair/redeem`, { method: "POST", headers: { origin: ORIGIN, dpop: dpop("POST", "/v1/g2/pair/redeem", n), "dpop-nonce": n, "content-type": "application/json" }, body: JSON.stringify({ code, name: "Test G2" }) });
  assert.equal(redeemed.status, 200, await redeemed.clone().text());
  return { session, ...(await redeemed.json()) };
}

before(async () => {
  child = spawn("node", ["src/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT), PUBLIC_BASE_URL: BASE,
    G2_APP_ORIGIN: ORIGIN, G2_DPOP_NONCE_SECRET: "test-g2-nonce-secret", DOGFOOD_AUTO_GRANT: "1", ATOMS_PLUS_STORE: "memory",
    ATOMS_PLUS_ENV: "development", ANTHROPIC_API_KEY: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "",
    STRIPE_PRICE_MONTHLY: "", STRIPE_PRICE_YEARLY: "", STRIPE_PRICE_TOPUP: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; }); child._log = () => log;
  await waitHealth();
});
after(() => { if (child && !child.killed) child.kill("SIGTERM"); });

describe("G2 HTTP authorization contract", () => {
  it("G2_SESSION_CONSENT_008 G2_SESSION_CONSENT_009 accept only a verified session", async () => {
    const session = await sessionFor(`g2-consent-${randomUUID()}@atoms.test`);
    const accepted = await fetch(`${BASE}/v1/g2/consent`, {
      headers: { authorization: `Bearer ${session}` },
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      revision: 0,
      g2Disclosure: { granted: false, version: "" },
      askMirror: { granted: false, version: "" },
      askWrite: { granted: false, version: "" },
    });
    const updated = await fetch(`${BASE}/v1/g2/consent`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: 0,
        freshGesture: true,
        askMirror: { granted: true, version: "mirror-v1" },
        askWrite: { granted: true, version: "write-v1" },
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).revision, 1);
    const refused = await fetch(`${BASE}/v1/g2/consent`, {
      headers: { authorization: "Bearer g2a_wrong" },
    });
    assert.equal(refused.status, 401);
  });

  it("G2_NONCE_007 and all G2 responses enforce exact Origin and no-store", async () => {
    const bad = await fetch(`${BASE}/v1/g2/auth/nonce`, { headers: { origin: "https://lookalike.invalid" } });
    assert.equal(bad.status, 403); assert.equal(bad.headers.get("cache-control"), "no-store");
    const good = await fetch(`${BASE}/v1/g2/auth/nonce`, { headers: { origin: ORIGIN } });
    assert.equal(good.headers.get("access-control-allow-origin"), ORIGIN); assert.equal(good.headers.get("vary"), "Origin");
  });

  it("G2_SESSION_MINT_001 G2_SESSION_LIST_002 G2_SESSION_REVOKE_003 reject wrong credential families", async () => {
    for (const route of ["/v1/g2/pair/code", "/v1/g2/devices", "/v1/g2/devices/fake/revoke"]) {
      const response = await fetch(`${BASE}${route}`, { method: route.endsWith("devices") ? "GET" : "POST", headers: { origin: ORIGIN, authorization: "Bearer mcp_wrong" } });
      assert.equal(response.status, 401);
    }
  });

  it("G2_REDEEM_004 validates RFC 9449 fields and rejects proof replay", async () => {
    const paired = await pair();
    const devices = await fetch(`${BASE}/v1/g2/devices`, { headers: { origin: ORIGIN, authorization: `Bearer ${paired.session}` } });
    assert.equal(devices.status, 200); assert.equal((await devices.json()).devices.length, 1);
    const n = await nonce(); const proof = dpop("POST", "/v1/g2/auth/refresh", n, paired.refreshToken);
    const first = await fetch(`${BASE}/v1/g2/auth/refresh`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${paired.refreshToken}`, dpop: proof, "dpop-nonce": n } });
    assert.equal(first.status, 200, await first.clone().text());
    const replay = await fetch(`${BASE}/v1/g2/auth/refresh`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${paired.refreshToken}`, dpop: proof, "dpop-nonce": n } });
    assert.equal(replay.status, 401);
  });

  it("G2_CONTENT_006 requires g2a_, DPoP ath, nonce, target, and route scope", async () => {
    const paired = await pair(["g2:query"]); const n = await nonce();
    const queryProof = dpop("POST", "/v1/g2/query", n, paired.accessToken);
    const allowed = await fetch(`${BASE}/v1/g2/query`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`, dpop: queryProof, "dpop-nonce": n } });
    assert.equal(allowed.status, 501);
    const n2 = await nonce();
    const denied = await fetch(`${BASE}/v1/g2/commit`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`, dpop: dpop("POST", "/v1/g2/commit", n2, paired.accessToken), "dpop-nonce": n2 } });
    assert.equal(denied.status, 401);
    const badTargetNonce = await nonce();
    const badTarget = await fetch(`${BASE}/v1/g2/query`, { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`, dpop: dpop("POST", "/v1/g2/query", badTargetNonce, paired.accessToken, { payload: { htu: `${BASE}/v1/g2/fetch` } }), "dpop-nonce": badTargetNonce } });
    assert.equal(badTarget.status, 401);

    const cases = [
      { label: "htm", payload: { htm: "GET" } },
      { label: "iat", payload: { iat: Math.floor(Date.now() / 1000) - 900 } },
      { label: "jti", payload: { jti: "short" } },
      { label: "ath", payload: { ath: "wrong" } },
      { label: "alg", header: { alg: "HS256" } },
      { label: "public JWK", header: { jwk: { ...jwk, d: "must-not-be-present" } } },
    ];
    for (const invalid of cases) {
      const fresh = await nonce();
      const response = await fetch(`${BASE}/v1/g2/query`, { method: "POST", headers: {
        origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`,
        dpop: dpop("POST", "/v1/g2/query", fresh, paired.accessToken, invalid), "dpop-nonce": fresh,
      } });
      assert.equal(response.status, 401, invalid.label);
    }
    const signedNonce = await nonce(); const differentHeaderNonce = await nonce();
    const nonceMismatch = await fetch(`${BASE}/v1/g2/query`, { method: "POST", headers: {
      origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`,
      dpop: dpop("POST", "/v1/g2/query", signedNonce, paired.accessToken), "dpop-nonce": differentHeaderNonce,
    } });
    assert.equal(nonceMismatch.status, 401, "nonce");
  });
});
