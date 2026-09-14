import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const port = 22000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let child;

async function waitHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error("feature-off server did not start");
}

async function rawUpgrade() {
  const socket = connect(port, "127.0.0.1");
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.write([
    "GET /v1/g2/transcribe/stream?ticket=g2t_untrusted HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Origin: https://untrusted.example", "", "",
  ].join("\r\n"));
  const response = await new Promise((resolve, reject) => {
    let raw = "";
    socket.on("data", (chunk) => { raw += chunk.toString(); if (raw.includes("\r\n\r\n")) resolve(raw); });
    socket.once("error", reject);
  });
  socket.destroy();
  return response;
}

before(async () => {
  child = spawn("node", ["src/server.mjs"], { cwd: root, env: {
    ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, ATOMS_PLUS_ENV: "development",
    ATOMS_PLUS_STORE: "memory", DOGFOOD_AUTO_GRANT: "1", G2_ENABLED: "0",
    G2_APP_ORIGIN: "https://should-not-be-consulted.example", G2_OPENAI_API_KEY: "",
    G2_ANTHROPIC_API_KEY: "", ANTHROPIC_API_KEY: "", STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "", STRIPE_PRICE_MONTHLY: "", STRIPE_PRICE_YEARLY: "", STRIPE_PRICE_TOPUP: "",
  }, stdio: ["ignore", "pipe", "pipe"] });
  await waitHealth();
});

after(() => { if (child && !child.killed) child.kill("SIGTERM"); });

describe("G2 runtime feature-off boundary", () => {
  it("returns 404 before auth, store, body, origin, or provider work for every G2 HTTP surface", async () => {
    const routes = [
      ["POST", "/v1/g2/pair/code"], ["GET", "/v1/g2/devices"], ["GET", "/v1/g2/consent"],
      ["POST", "/v1/g2/consent"], ["POST", "/v1/g2/devices/untrusted/revoke"], ["GET", "/v1/g2/auth/nonce"],
      ["POST", "/v1/g2/pair/redeem"], ["POST", "/v1/g2/auth/refresh"], ["POST", "/v1/g2/transcribe/ticket"],
      ["POST", "/v1/g2/prepare"], ["POST", "/v1/g2/commit"], ["POST", "/v1/g2/status"],
      ["POST", "/v1/g2/query"], ["POST", "/v1/g2/recent"], ["POST", "/v1/g2/fetch"],
    ];
    for (const [method, route] of routes) {
      const response = await fetch(`${base}${route}`, {
        method, headers: { origin: "https://untrusted.example", authorization: "Bearer deliberately-wrong", "content-type": "application/json" },
        ...(method === "POST" ? { body: "{not-json" } : {}),
      });
      assert.equal(response.status, 404, route);
      assert.equal(response.headers.get("cache-control"), "no-store", route);
      assert.deepEqual(await response.json(), { message: "Not found" }, route);
    }
  });

  it("rejects the raw G2 WebSocket upgrade as 404 before reading a ticket or Origin", async () => {
    assert.match(await rawUpgrade(), /^HTTP\/1\.1 404 Not Found/);
  });

  it("leaves an existing Ask classify endpoint unchanged", async () => {
    const response = await fetch(`${base}/v1/classify`, { method: "POST", headers: {
      authorization: "Bearer invalid-ask-session", "content-type": "application/json",
    }, body: JSON.stringify({ text: "ordinary Ask request" }) });
    assert.equal(response.status, 401);
  });
});
