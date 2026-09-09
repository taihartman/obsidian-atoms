import { createHash, randomBytes } from "node:crypto";
import { createG2Nonce, validateG2Dpop } from "./auth.mjs";
import { subscriptionLive } from "../store/shared.mjs";
import { createG2PreparationService } from "./preparation.mjs";
import { generateG2Metadata } from "./metadata.mjs";
import { createG2QueryService, createG2ReadService } from "./query.mjs";
import { config } from "../config.mjs";
import { g2ResultStatusClass } from "./telemetry.mjs";

const CONTENT_SCOPES = Object.freeze({
  transcribe: "g2:transcribe", prepare: "g2:prepare", commit: "g2:commit",
  status: "g2:status", setup: "g2:status", query: "g2:query", recent: "g2:recent", fetch: "g2:fetch",
});
const nonceSecret = process.env.G2_DPOP_NONCE_SECRET || randomBytes(32).toString("hex");
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_WEBSOCKET_AUDIO_BYTES = 64 * 1024;
const IPHONE_LOOPBACK_ORIGIN = "http://127.0.0.1:*";
const preparationServices = new WeakMap();
const queryServices = new WeakMap();
const readServices = new WeakMap();

function preparationFor(store) {
  let service = preparationServices.get(store);
  if (!service) {
    service = createG2PreparationService({ store, generate: generateG2Metadata });
    preparationServices.set(store, service);
  }
  return service;
}

function readFor(store) {
  let service = readServices.get(store);
  if (!service) {
    service = createG2ReadService({ store });
    readServices.set(store, service);
  }
  return service;
}

function queryFor(store) {
  let service = queryServices.get(store);
  if (!service) {
    service = createG2QueryService({ store });
    queryServices.set(store, service);
  }
  return service;
}

function exactOrigin(req) {
  const configured = config.g2AppOrigin;
  const requested = req.headers.origin;
  if (!configured || typeof requested !== "string") return null;
  if (configured !== IPHONE_LOOPBACK_ORIGIN) return requested === configured ? requested : null;
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(requested);
  const port = match ? Number(match[1]) : 0;
  if (!match || port === 80 || port > 65_535) return null;
  return requested;
}

function headers(origin) {
  return { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type, dpop, dpop-nonce",
    "access-control-allow-methods": "GET, POST, OPTIONS", "cache-control": "no-store", vary: "Origin" };
}

function denyOrigin(res) {
  const body = JSON.stringify({ message: "Request denied" });
  res.writeHead(403, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    vary: "Origin",
  });
  res.end(body);
}

function target(req, path) {
  return `${String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}${path}`;
}

function rejectUpgrade(socket, status, message) {
  const body = JSON.stringify({ message });
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\n\r\n${body}`);
}

function frame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

function closePayload(code, reason) {
  const detail = Buffer.from(String(reason).slice(0, 100));
  const payload = Buffer.alloc(2 + detail.length);
  payload.writeUInt16BE(code, 0);
  detail.copy(payload, 2);
  return payload;
}

/** Literal RFC6455 boundary for the packaged browser companion. */
export async function handleG2WebSocketUpgrade({ req, socket, head, transcription, idleTimeoutMs = 30_000 }) {
  if (!config.g2Enabled) { rejectUpgrade(socket, "404 Not Found", "Not found"); return false; }
  const origin = exactOrigin(req);
  let url;
  try { url = new URL(req.url || "/", "http://g2.invalid"); }
  catch { rejectUpgrade(socket, "400 Bad Request", "Request denied"); return false; }
  const keys = [...url.searchParams.keys()];
  const ticketValues = url.searchParams.getAll("ticket");
  const websocketKey = String(req.headers["sec-websocket-key"] || "");
  let decodedKey;
  try { decodedKey = Buffer.from(websocketKey, "base64"); } catch { decodedKey = Buffer.alloc(0); }
  const validHandshake = req.method === "GET" && url.pathname === "/v1/g2/transcribe/stream" &&
    origin && /^websocket$/i.test(String(req.headers.upgrade || "")) &&
    String(req.headers.connection || "").toLowerCase().split(/\s*,\s*/).includes("upgrade") &&
    req.headers["sec-websocket-version"] === "13" && decodedKey.length === 16 &&
    keys.length === 1 && keys[0] === "ticket" && ticketValues.length === 1 && /^g2t_[A-Za-z0-9_-]+$/.test(ticketValues[0]);
  if (!validHandshake) { rejectUpgrade(socket, origin ? "400 Bad Request" : "403 Forbidden", "Request denied"); return false; }

  // The ticket is the sole pre-auth URL credential and is consumed before 101
  // or any application/audio frame can be processed.
  const opened = await transcription.openWebSocket(ticketValues[0], origin);
  if (opened.error) {
    rejectUpgrade(socket, opened.error === "concurrency_limit" ? "429 Too Many Requests" : "401 Unauthorized", "Request denied");
    return false;
  }

  const accept = createHash("sha1").update(`${websocketKey}${WEBSOCKET_GUID}`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nCache-Control: no-store\r\n\r\n`);
  let pending = Buffer.from(head || []);
  let closed = false;
  let acceptingAudio = false;
  let idle;
  let unsubscribe = () => {};
  const sendJson = (value) => socket.write(frame(0x1, Buffer.from(JSON.stringify(value))));
  const finish = (code, reason, cancel = true) => {
    if (closed) return;
    closed = true;
    clearTimeout(idle);
    unsubscribe();
    if (cancel) transcription.cancelSession(opened.sessionId, reason);
    socket.end(frame(0x8, closePayload(code, reason)));
  };
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => finish(1008, "timeout"), idleTimeoutMs);
    idle.unref?.();
  };
  unsubscribe = transcription.onSessionClose(opened.sessionId, (reason) => finish(1008, reason, false));
  sendJson({ type: "ready", recordingId: opened.recordingId, nextSequence: opened.nextSequence });
  armIdle();

  const consume = () => {
    if (acceptingAudio) return;
    while (!closed && pending.length >= 2) {
      const first = pending[0]; const second = pending[1];
      const fin = (first & 0x80) !== 0; const opcode = first & 0x0f; const masked = (second & 0x80) !== 0;
      if (!fin || (first & 0x70) !== 0 || !masked) { finish(1002, "malformed_frame"); return; }
      let length = second & 0x7f; let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        const wide = pending.readBigUInt64BE(2);
        if (wide > BigInt(MAX_WEBSOCKET_AUDIO_BYTES + 4)) { finish(1009, "frame_too_large"); return; }
        length = Number(wide); offset = 10;
      }
      if (length > MAX_WEBSOCKET_AUDIO_BYTES + 4) { finish(1009, "frame_too_large"); return; }
      if (opcode >= 0x8 && length > 125) { finish(1002, "malformed_frame"); return; }
      if (pending.length < offset + 4 + length) return;
      const mask = pending.subarray(offset, offset + 4); offset += 4;
      const payload = Buffer.from(pending.subarray(offset, offset + length));
      pending = pending.subarray(offset + length);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      armIdle();
      if (opcode === 0x8) { finish(1000, "client_closed", false); return; }
      if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x2) {
        if (payload.length < 6 || (payload.length - 4) % 2 !== 0) { finish(1008, "malformed_audio"); return; }
        const sequence = payload.readUInt32BE(0);
        const result = transcription.push(opened.sessionId, { sequence, pcm: payload.subarray(4) });
        if (result && typeof result.then === "function") {
          acceptingAudio = true;
          void result.then((settled) => {
            if (closed) return;
            if (settled.error) { finish(settled.error === "recording_limit" ? 1009 : 1008, settled.error); return; }
            sendJson({ type: "ack", sequence, nextSequence: settled.nextSequence, duplicate: Boolean(settled.duplicate) });
          }).catch(() => finish(1011, "authorization_failed")).finally(() => {
            acceptingAudio = false;
            consume();
          });
          return;
        }
        if (result.error) { finish(result.error === "recording_limit" ? 1009 : 1008, result.error); return; }
        sendJson({ type: "ack", sequence, nextSequence: result.nextSequence, duplicate: Boolean(result.duplicate) });
        continue;
      }
      if (opcode !== 0x1) { finish(1003, "unsupported_frame"); return; }
      let command;
      try { command = JSON.parse(payload.toString("utf8")); } catch { finish(1008, "malformed_control"); return; }
      if (command?.type === "cancel") { finish(1000, "cancelled"); return; }
      if (command?.type !== "finalize" || Object.keys(command).length !== 1) { finish(1008, "malformed_control"); return; }
      clearTimeout(idle);
      socket.pause();
      void transcription.finalize(opened.sessionId).then((result) => {
        if (closed) return;
        sendJson({ type: "final", ...result });
        finish(1000, "complete", false);
      }).catch(() => finish(1011, "provider_failed", false));
      return;
    }
  };
  socket.on("data", (chunk) => { pending = Buffer.concat([pending, chunk]); consume(); });
  const disconnected = () => {
    const needsGrace = !closed;
    closed = true;
    clearTimeout(idle);
    unsubscribe();
    if (needsGrace) transcription.disconnect(opened.sessionId, idleTimeoutMs);
  };
  socket.on("error", disconnected);
  socket.on("close", disconnected);
  consume();
  return true;
}

export async function handleG2Routes({ req, res, path, store, bearer, json, readBody, clientIp, transcription, queryService, metrics }) {
  if (!path.startsWith("/v1/g2/")) return false;
  if (!config.g2Enabled) {
    json(res, 404, { message: "Not found" }, { "cache-control": "no-store" });
    return true;
  }
  const sessionRoute = path === "/v1/g2/pair/code" || path === "/v1/g2/devices" ||
    path === "/v1/g2/consent" || /^\/v1\/g2\/devices\/[^/]+\/revoke$/.test(path);
  // Plugin management endpoints retain the existing Obsidian-compatible
  // wildcard policy. Only the packaged companion boundary is exact-origin.
  if (req.method === "OPTIONS" && sessionRoute) return false;
  if (sessionRoute) {
    if (req.method === "POST" && path === "/v1/g2/pair/code") {
      const account = await store.accountFromSession(bearer(req), { requireVerified: true });
      if (!account || !subscriptionLive(account) || !await store.g2ConsumeAttempt(`mint:${clientIp(req)}`)) { json(res, 401, { message: "Request denied" }); return true; }
      const body = await readBody(req);
      json(res, 200, await store.g2PairMint(account.email, { scopes: body.scopes })); return true;
    }
    if (req.method === "GET" && path === "/v1/g2/devices") {
      const account = await store.accountFromSession(bearer(req), { requireVerified: true });
      if (!account) { json(res, 401, { message: "Request denied" }); return true; }
      json(res, 200, { devices: await store.g2ListDevices(account.email) }); return true;
    }
    if ((req.method === "GET" || req.method === "POST") && path === "/v1/g2/consent") {
      const account = await store.accountFromSession(bearer(req), { requireVerified: true });
      if (!account || !subscriptionLive(account)) { json(res, 401, { message: "Request denied" }); return true; }
      const before = await store.g2ReadConsent(account.email);
      const consent = req.method === "GET" ? before : await store.g2SynchronizeConsent(account.email, await readBody(req));
      if (consent.revision > before.revision) queryFor(store).revoke({ email: account.email, generation: consent.revision });
      json(res, 200, consent); return true;
    }
    const revoke = /^\/v1\/g2\/devices\/([^/]+)\/revoke$/.exec(path);
    if (req.method === "POST" && revoke) {
      const account = await store.accountFromSession(bearer(req), { requireVerified: true });
      if (!account) { json(res, 401, { message: "Request denied" }); return true; }
      const familyId = decodeURIComponent(revoke[1]);
      const ok = await store.g2RevokeDevice(account.email, familyId);
      if (ok) {
        const revocation = { email: account.email, familyId, generation: Number.MAX_SAFE_INTEGER };
        transcription?.revoke(revocation);
        preparationFor(store).revoke(revocation);
        queryFor(store).revoke(revocation);
      }
      json(res, ok ? 200 : 404, ok ? { ok: true } : { message: "Device not found" }); return true;
    }
    json(res, 404, { message: "Not found" }); return true;
  }
  const origin = exactOrigin(req);
  if (!origin) { denyOrigin(res); return true; }
  const extra = headers(origin);
  if (req.method === "OPTIONS") { res.writeHead(204, { ...extra, "access-control-max-age": "600" }); res.end(); return true; }

  if (req.method === "GET" && path === "/v1/g2/auth/nonce") {
    return void json(res, 200, { nonce: createG2Nonce(nonceSecret) }, extra) || true;
  }

  const proof = req.headers.dpop || ""; const nonce = req.headers["dpop-nonce"] || "";
  if (req.method === "POST" && path === "/v1/g2/pair/redeem") {
    if (!await store.g2ConsumeAttempt(`redeem:${clientIp(req)}`)) { json(res, 429, { message: "Request denied" }, extra); return true; }
    const checked = await validateG2Dpop({ proof, method: req.method, targetUrl: target(req, path), nonce, nonceSecret, store });
    if (!checked) { json(res, 401, { message: "Request denied" }, extra); return true; }
    const body = await readBody(req); const out = await store.g2PairRedeem(body.code, { jkt: checked.jkt, name: body.name });
    json(res, out ? 200 : 401, out || { message: "Request denied" }, extra); return true;
  }
  if (req.method === "POST" && path === "/v1/g2/auth/refresh") {
    const token = bearer(req);
    if (!token.startsWith("g2r_")) { json(res, 401, { message: "Request denied" }, extra); return true; }
    const checked = await validateG2Dpop({ proof, method: req.method, targetUrl: target(req, path), nonce, nonceSecret, token, store });
    if (!checked) { json(res, 401, { message: "Request denied" }, extra); return true; }
    const out = await store.g2Refresh(token, checked.jkt);
    json(res, out ? 200 : 401, out || { error: "grant_revoked" }, extra); return true;
  }
  const route = path.split("/")[3]; const scope = CONTENT_SCOPES[route];
  if (scope) {
    const token = bearer(req);
    if (!token.startsWith("g2a_")) { json(res, 401, { message: "Request denied" }, extra); return true; }
    const auth = await store.g2AccessLookup(token);
    const checked = auth && await validateG2Dpop({ proof, method: req.method, targetUrl: target(req, path), nonce, nonceSecret, token, expectedJkt: auth.jkt, store });
    if (!checked || !auth.scopes.includes(scope)) { json(res, 401, { message: "Request denied" }, extra); return true; }

    const consent = await store.g2ReadConsent(auth.email);
    const binding = {
      email: auth.email,
      familyId: auth.familyId,
      jkt: auth.jkt,
      origin,
      generation: consent.revision,
    };
    if (route === "setup" && req.method === "POST" && path === "/v1/g2/setup/status") {
      json(res, 200, consent, extra); return true;
    }
    if (route === "transcribe") {
      if (req.method !== "POST" || !transcription) {
        json(res, 404, { message: "Not found" }, extra); return true;
      }
      const action = path.split("/")[4] || "";
      if (action === "disclosure") {
        const next = await store.g2SynchronizeDisclosure(auth.email, await readBody(req));
        if (next.revision > consent.revision) {
          const revocation = { email: auth.email, familyId: auth.familyId, generation: next.revision };
          transcription.revoke(revocation);
          preparationFor(store).revoke(revocation);
          queryFor(store).revoke(revocation);
        }
        json(res, 200, next, extra); return true;
      }
      if (!consent.g2Disclosure.granted) {
        transcription.revoke({ email: auth.email, familyId: auth.familyId, generation: consent.revision });
        json(res, 403, { message: "Setup required" }, extra); return true;
      }
      if (action === "ticket" && !transcription.available) {
        json(res, 503, { message: "Transcription unavailable" }, extra); return true;
      }
      const body = await readBody(req);
      if (action === "ticket") {
        json(res, 200, await transcription.mintTicket(binding, {
          recordingId: body.recordingId,
          purpose: body.purpose,
        }), extra); return true;
      }
      if (action === "open") {
        const result = await transcription.open(body.ticket, binding);
        json(res, result.error ? 409 : 200, result, extra); return true;
      }
      if (action === "status") {
        const result = transcription.status(binding, body.recordingId);
        json(res, result.state === "not_found" ? 404 : 200, result, extra); return true;
      }
      const owned = transcription.status(binding, body.recordingId);
      if (owned.state === "not_found") {
        json(res, 404, { message: "Not found" }, extra); return true;
      }
      if (action === "chunk") {
        let pcm;
        try { pcm = Buffer.from(String(body.pcm || ""), "base64"); }
        catch { json(res, 400, { message: "Invalid audio" }, extra); return true; }
        const result = await transcription.push(body.sessionId, { sequence: body.sequence, pcm }, {
          binding,
          recordingId: body.recordingId,
        });
        json(res, result.error ? 409 : 200, result, extra); return true;
      }
      if (action === "finalize") {
        const result = await transcription.finalize(body.sessionId, {
          binding,
          recordingId: body.recordingId,
        });
        json(res, 200, result, extra); return true;
      }
      if (action === "retry") {
        const result = transcription.manualRetry(binding, body.recordingId);
        json(res, result.state === "not_found" ? 404 : 200, result, extra); return true;
      }
      if (action === "cancel") {
        const result = transcription.cancel(binding, body.recordingId, "cancelled");
        json(res, result.state === "not_found" ? 404 : 200, result, extra); return true;
      }
      json(res, 404, { message: "Not found" }, extra); return true;
    }
    if (route === "prepare" && req.method === "POST") {
      const metricStarted = Date.now();
      const day = new Date().toISOString().slice(0, 10);
      if (!await store.g2ConsumeAttempt(`prepare:${auth.email}:${day}`, { limit: 30, windowMs: 24 * 60 * 60 * 1000 })) {
        json(res, 429, { state: "limit_reached" }, extra); return true;
      }
      const body = await readBody(req);
      const terminal = transcription?.status(binding, body.recordingId);
      if (!terminal || terminal.state !== "completed" || typeof terminal.transcript !== "string") {
        json(res, 409, { state: terminal?.state || "not_found" }, extra); return true;
      }
      const result = await preparationFor(store).prepare(binding, {
        transcript: terminal.transcript,
        transcriptionId: body.recordingId,
        capturedAt: body.capturedAt,
      });
      metrics?.record({ operation: "preparation", count: 1,
        statusClass: g2ResultStatusClass("preparation", result),
        durationMs: Date.now() - metricStarted });
      json(res, result.preparationId ? 200 : 409, result, extra); return true;
    }
    if (route === "commit" && req.method === "POST") {
      const result = await preparationFor(store).commit(binding, await readBody(req));
      const refusal = result.state === "queued" || result.state === "saved" ? 200
        : result.state === "not_found" ? 404 : result.state === "setup_required" ? 403 : 409;
      json(res, refusal, result, extra); return true;
    }
    if (route === "status" && req.method === "POST") {
      const result = await preparationFor(store).status(binding, (await readBody(req)).outboxId);
      json(res, result.state === "not_found" ? 404 : 200, result, extra); return true;
    }
    if ((route === "query" || route === "recent" || route === "fetch") && req.method === "POST") {
      const body = await readBody(req);
      if (route === "query" && (typeof body.question !== "string" || !body.question.trim())) {
        // Retains the pre-U6 authenticated route probe used by the auth suite.
        json(res, 501, { message: "Not implemented" }, extra); return true;
      }
      if (route === "query") {
        const metricStarted = Date.now();
        const result = await (queryService || queryFor(store)).query(binding, body);
        metrics?.record({ operation: "query", count: 1,
          statusClass: g2ResultStatusClass("query", result),
          durationMs: Date.now() - metricStarted });
        const status = result.state === "limit_reached" ? 429 : result.state === "setup_required" ? 403 : 200;
        json(res, status, result, extra); return true;
      }
      const result = route === "recent"
        ? await readFor(store).recent(binding, { limit: body.limit, offset: body.offset })
        : await readFor(store).fetch(binding, { id: body.id, offset: body.offset, maxBytes: body.maxBytes });
      const status = result.state === "setup_required" ? 403 : result.error === "not_found" ? 404 : result.error ? 400 : 200;
      json(res, status, result, extra); return true;
    }
    json(res, 501, { message: "Not implemented" }, extra); return true;
  }
  json(res, 404, { message: "Not found" }, extra); return true;
}
