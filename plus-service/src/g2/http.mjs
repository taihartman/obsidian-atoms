import { randomBytes } from "node:crypto";
import { createG2Nonce, validateG2Dpop } from "./auth.mjs";
import { subscriptionLive } from "../store/shared.mjs";

const CONTENT_SCOPES = Object.freeze({
  transcribe: "g2:transcribe", prepare: "g2:prepare", commit: "g2:commit",
  status: "g2:status", query: "g2:query", recent: "g2:recent", fetch: "g2:fetch",
});
const nonceSecret = process.env.G2_DPOP_NONCE_SECRET || randomBytes(32).toString("hex");

function exactOrigin(req) {
  const configured = String(process.env.G2_APP_ORIGIN || "").replace(/\/$/, "");
  return configured && req.headers.origin === configured ? configured : null;
}

function headers(origin) {
  return { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type, dpop, dpop-nonce",
    "access-control-allow-methods": "GET, POST, OPTIONS", "cache-control": "no-store", vary: "Origin" };
}

function target(req, path) {
  return `${String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}${path}`;
}

export async function handleG2Routes({ req, res, path, store, bearer, json, readBody, clientIp }) {
  if (!path.startsWith("/v1/g2/")) return false;
  const sessionRoute = path === "/v1/g2/pair/code" || path === "/v1/g2/devices" || /^\/v1\/g2\/devices\/[^/]+\/revoke$/.test(path);
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
    const revoke = /^\/v1\/g2\/devices\/([^/]+)\/revoke$/.exec(path);
    if (req.method === "POST" && revoke) {
      const account = await store.accountFromSession(bearer(req), { requireVerified: true });
      if (!account) { json(res, 401, { message: "Request denied" }); return true; }
      const ok = await store.g2RevokeDevice(account.email, decodeURIComponent(revoke[1]));
      json(res, ok ? 200 : 404, ok ? { ok: true } : { message: "Device not found" }); return true;
    }
    json(res, 404, { message: "Not found" }); return true;
  }
  const origin = exactOrigin(req);
  if (!origin) { json(res, 403, { message: "Request denied" }, { "cache-control": "no-store", vary: "Origin" }); return true; }
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
    json(res, out ? 200 : 401, out || { message: "Request denied" }, extra); return true;
  }
  const route = path.split("/")[3]; const scope = CONTENT_SCOPES[route];
  if (scope) {
    const token = bearer(req);
    if (!token.startsWith("g2a_")) { json(res, 401, { message: "Request denied" }, extra); return true; }
    const auth = await store.g2AccessLookup(token);
    const checked = auth && await validateG2Dpop({ proof, method: req.method, targetUrl: target(req, path), nonce, nonceSecret, token, expectedJkt: auth.jkt, store });
    if (!checked || !auth.scopes.includes(scope)) { json(res, 401, { message: "Request denied" }, extra); return true; }
    json(res, 501, { message: "Not implemented" }, extra); return true;
  }
  json(res, 404, { message: "Not found" }, extra); return true;
}
