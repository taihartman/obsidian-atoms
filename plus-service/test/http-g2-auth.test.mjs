import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { connect } from "node:net";
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

async function rawUpgrade(ticket, origin = ORIGIN, extraQuery = "") {
  const socket = connect(PORT, "127.0.0.1");
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const pathName = `/v1/g2/transcribe/stream?ticket=${encodeURIComponent(ticket)}${extraQuery}`;
  socket.write([
    `GET ${pathName} HTTP/1.1`,
    `Host: 127.0.0.1:${PORT}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    `Origin: ${origin}`,
    "",
    "",
  ].join("\r\n"));
  const response = await new Promise((resolve, reject) => {
    let raw = Buffer.alloc(0);
    const onData = (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      const boundary = raw.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      socket.off("data", onData);
      socket.pause();
      resolve({ headers: raw.subarray(0, boundary).toString("utf8"), buffer: raw.subarray(boundary + 4), socket, pathName });
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
  return response;
}

function sendClientFrame(connection, opcode, payload) {
  const body = Buffer.from(payload);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const headerBytes = body.length < 126 ? 2 : body.length <= 0xffff ? 4 : 10;
  const encoded = Buffer.alloc(headerBytes + mask.length + body.length);
  encoded[0] = 0x80 | opcode;
  encoded[1] = 0x80 | (body.length < 126 ? body.length : body.length <= 0xffff ? 126 : 127);
  if (headerBytes === 4) encoded.writeUInt16BE(body.length, 2);
  if (headerBytes === 10) encoded.writeBigUInt64BE(BigInt(body.length), 2);
  mask.copy(encoded, headerBytes);
  for (let i = 0; i < body.length; i++) encoded[headerBytes + 4 + i] = body[i] ^ mask[i % 4];
  connection.socket.write(encoded);
}

async function readServerFrame(connection) {
  while (connection.buffer.length < 2) {
    connection.buffer = Buffer.concat([connection.buffer, await nextSocketData(connection.socket)]);
  }
  const opcode = connection.buffer[0] & 0x0f;
  let length = connection.buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    while (connection.buffer.length < 4) connection.buffer = Buffer.concat([connection.buffer, await nextSocketData(connection.socket)]);
    length = connection.buffer.readUInt16BE(2); offset = 4;
  }
  while (connection.buffer.length < offset + length) connection.buffer = Buffer.concat([connection.buffer, await nextSocketData(connection.socket)]);
  const payload = connection.buffer.subarray(offset, offset + length);
  connection.buffer = connection.buffer.subarray(offset + length);
  return { opcode, payload };
}

function nextSocketData(socket) {
  const buffered = socket.read();
  if (buffered) return Promise.resolve(buffered);
  return new Promise((resolve, reject) => {
    const onReadable = () => {
      const chunk = socket.read();
      if (!chunk) return;
      cleanup(); resolve(chunk);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("socket_closed")); };
    const cleanup = () => {
      socket.off("readable", onReadable); socket.off("error", onError); socket.off("close", onClose);
    };
    socket.on("readable", onReadable);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
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
    STRIPE_PRICE_MONTHLY: "", STRIPE_PRICE_YEARLY: "", STRIPE_PRICE_TOPUP: "", G2_TRANSCRIPTION_ENABLED: "1",
    OPENAI_API_KEY: "test-openai-key", G2_SOCKET_IDLE_TIMEOUT_MS: "5000", G2_MAX_CONCURRENT_PER_ACCOUNT: "2" }, stdio: ["ignore", "pipe", "pipe"] });
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

  it("G2_STREAM_TICKET_010 consumes a DPoP-bound ticket only after disclosure", async () => {
    const paired = await pair(["g2:transcribe"]);
    const request = async (pathName, body) => {
      const n = await nonce();
      return fetch(`${BASE}${pathName}`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${paired.accessToken}`,
          dpop: dpop("POST", pathName, n, paired.accessToken),
          "dpop-nonce": n,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    };

    const blocked = await request("/v1/g2/transcribe/ticket", {
      recordingId: "rec-http",
      purpose: "stream",
    });
    assert.equal(blocked.status, 403);

    const disclosed = await request("/v1/g2/transcribe/disclosure", {
      baseRevision: 0,
      freshGesture: true,
      disclosure: { granted: true, version: "g2-voice-v1" },
    });
    assert.equal(disclosed.status, 200, await disclosed.clone().text());

    const ticketResponse = await request("/v1/g2/transcribe/ticket", {
      recordingId: "rec-http",
      purpose: "stream",
    });
    assert.equal(ticketResponse.status, 200, await ticketResponse.clone().text());
    assert.equal(ticketResponse.headers.get("cache-control"), "no-store");
    const ticket = (await ticketResponse.json()).value;

    const upgraded = await rawUpgrade(ticket);
    assert.match(upgraded.headers, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.equal(upgraded.pathName.includes(paired.accessToken), false);
    assert.equal(upgraded.pathName.includes(paired.refreshToken), false);
    const ready = await readServerFrame(upgraded);
    assert.equal(ready.opcode, 1);
    assert.deepEqual(JSON.parse(ready.payload.toString("utf8")), {
      type: "ready", recordingId: "rec-http", nextSequence: 0,
    });
    const audio = Buffer.alloc(6); audio.writeUInt32BE(0, 0); audio[4] = 1; audio[5] = 2;
    sendClientFrame(upgraded, 2, audio);
    const ack = await readServerFrame(upgraded);
    assert.deepEqual(JSON.parse(ack.payload.toString("utf8")), {
      type: "ack", sequence: 0, nextSequence: 1, duplicate: false,
    });
    upgraded.socket.destroy();

    const opened = await request("/v1/g2/transcribe/open", { ticket });
    assert.equal(opened.status, 409, "the RFC6455 upgrade consumes the one-time ticket");
    const replay = await request("/v1/g2/transcribe/open", { ticket });
    assert.equal(replay.status, 409);

    const reconnectTicket = await request("/v1/g2/transcribe/ticket", { recordingId: "rec-http", purpose: "stream" });
    const reconnect = await rawUpgrade((await reconnectTicket.json()).value);
    assert.match(reconnect.headers, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.equal(JSON.parse((await readServerFrame(reconnect)).payload.toString("utf8")).nextSequence, 1);
    sendClientFrame(reconnect, 2, audio);
    assert.equal(JSON.parse((await readServerFrame(reconnect)).payload.toString("utf8")).duplicate, true);

    const closePromise = readServerFrame(reconnect);
    const withdrawn = await request("/v1/g2/transcribe/disclosure", {
      baseRevision: 1,
      freshGesture: true,
      disclosure: { granted: false, version: "g2-voice-v1" },
    });
    assert.equal(withdrawn.status, 200);
    const revokedClose = await closePromise;
    assert.equal(revokedClose.opcode, 8);
    assert.equal(revokedClose.payload.readUInt16BE(0), 1008);
    assert.equal(revokedClose.payload.subarray(2).toString("utf8"), "revoked");
    assert.equal(child._log().includes("provider_started"), false, "upgrade and PCM buffering do not contact the provider");
  });

  it("rejects wrong-origin, credential-bearing, malformed, and idle RFC6455 connections", async () => {
    const paired = await pair(["g2:transcribe"]);
    const request = async (pathName, body) => {
      const n = await nonce();
      return fetch(`${BASE}${pathName}`, { method: "POST", headers: {
        origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`,
        dpop: dpop("POST", pathName, n, paired.accessToken), "dpop-nonce": n,
        "content-type": "application/json",
      }, body: JSON.stringify(body) });
    };
    await request("/v1/g2/transcribe/disclosure", {
      baseRevision: 0, freshGesture: true,
      disclosure: { granted: true, version: "g2-voice-v1" },
    });
    const mint = async (recordingId) => (await (await request("/v1/g2/transcribe/ticket", {
      recordingId, purpose: "stream",
    })).json()).value;

    const ticket = await mint("rec-boundary");
    const wrongOrigin = await rawUpgrade(ticket, "https://lookalike.invalid");
    assert.match(wrongOrigin.headers, /^HTTP\/1\.1 403 Forbidden/);
    wrongOrigin.socket.destroy();
    const credentialQuery = await rawUpgrade(ticket, ORIGIN, "&access_token=g2a_forbidden");
    assert.match(credentialQuery.headers, /^HTTP\/1\.1 400 Bad Request/);
    credentialQuery.socket.destroy();

    const accepted = await rawUpgrade(ticket);
    assert.match(accepted.headers, /^HTTP\/1\.1 101 Switching Protocols/);
    await readServerFrame(accepted);
    const malformedClosePromise = readServerFrame(accepted);
    sendClientFrame(accepted, 1, Buffer.from('{"type":"audio"}'));
    const malformedClose = await malformedClosePromise;
    assert.equal(malformedClose.opcode, 8);
    assert.equal(malformedClose.payload.readUInt16BE(0), 1008);

    const idle = await rawUpgrade(await mint("rec-idle"));
    assert.match(idle.headers, /^HTTP\/1\.1 101 Switching Protocols/);
    await readServerFrame(idle);
    const idleClose = await readServerFrame(idle);
    assert.equal(idleClose.opcode, 8);
    assert.equal(idleClose.payload.readUInt16BE(0), 1008);
    assert.equal(idleClose.payload.subarray(2).toString("utf8"), "timeout");

    const bounded = await rawUpgrade(await mint("rec-size-bound"));
    await readServerFrame(bounded);
    for (let sequence = 0; sequence < 58; sequence++) {
      const frame = Buffer.alloc(4 + 65_536);
      frame.writeUInt32BE(sequence, 0);
      sendClientFrame(bounded, 2, frame);
      assert.equal(JSON.parse((await readServerFrame(bounded)).payload.toString("utf8")).nextSequence, sequence + 1);
    }
    const overflow = Buffer.alloc(4 + 38_914);
    overflow.writeUInt32BE(58, 0);
    const overflowClosePromise = readServerFrame(bounded);
    sendClientFrame(bounded, 2, overflow);
    const overflowClose = await overflowClosePromise;
    assert.equal(overflowClose.opcode, 8);
    assert.equal(overflowClose.payload.readUInt16BE(0), 1009);
    assert.equal(overflowClose.payload.subarray(2).toString("utf8"), "recording_limit");

    const [firstTicket, secondTicket, thirdTicket] = await Promise.all([
      mint("rec-concurrent-a"), mint("rec-concurrent-b"), mint("rec-concurrent-c"),
    ]);
    const first = await rawUpgrade(firstTicket);
    const second = await rawUpgrade(secondTicket);
    await readServerFrame(first); await readServerFrame(second);
    for (const connection of [first, second]) {
      const pong = readServerFrame(connection);
      sendClientFrame(connection, 9, Buffer.from("still-active"));
      assert.equal((await pong).opcode, 10);
    }
    const refused = await rawUpgrade(thirdTicket);
    assert.match(refused.headers, /^HTTP\/1\.1 429 Too Many Requests/);
    refused.socket.destroy();
    for (const connection of [first, second]) {
      const closePromise = readServerFrame(connection);
      sendClientFrame(connection, 1, Buffer.from('{"type":"cancel"}'));
      assert.equal((await closePromise).opcode, 8);
    }
  });

  it("refuses tickets minted before disclosure withdrawal or device-family revocation", async () => {
    const exercise = async (kind) => {
      const paired = await pair(["g2:transcribe"]);
      const request = async (pathName, body) => {
        const n = await nonce();
        return fetch(`${BASE}${pathName}`, { method: "POST", headers: {
          origin: ORIGIN, authorization: `Bearer ${paired.accessToken}`,
          dpop: dpop("POST", pathName, n, paired.accessToken), "dpop-nonce": n,
          "content-type": "application/json",
        }, body: JSON.stringify(body) });
      };
      await request("/v1/g2/transcribe/disclosure", {
        baseRevision: 0, freshGesture: true,
        disclosure: { granted: true, version: "g2-voice-v1" },
      });
      const minted = await request("/v1/g2/transcribe/ticket", {
        recordingId: `rec-revoked-${kind}`, purpose: "stream",
      });
      const ticket = (await minted.json()).value;
      if (kind === "disclosure") {
        await request("/v1/g2/transcribe/disclosure", {
          baseRevision: 1, freshGesture: true,
          disclosure: { granted: false, version: "g2-voice-v1" },
        });
      } else {
        const revoked = await fetch(`${BASE}/v1/g2/devices/${paired.device.id}/revoke`, {
          method: "POST", headers: { authorization: `Bearer ${paired.session}` },
        });
        assert.equal(revoked.status, 200);
      }
      const before = child._log();
      const refused = await rawUpgrade(ticket);
      assert.match(refused.headers, /^HTTP\/1\.1 401 Unauthorized/, kind);
      refused.socket.destroy();
      assert.equal(child._log().includes("provider_started", before.length), false, `${kind}: no provider audio`);
    };
    await exercise("disclosure");
    await exercise("family");
  });
});
