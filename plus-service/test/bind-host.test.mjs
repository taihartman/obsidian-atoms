import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseBindHost } from "../src/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

test("optional bind host accepts IP literals and rejects hostnames", () => {
  assert.equal(parseBindHost(""), "");
  assert.equal(parseBindHost("127.0.0.1"), "127.0.0.1");
  assert.equal(parseBindHost("::1"), "::1");
  assert.throws(() => parseBindHost("localhost"), /invalid_bind_host/);
});

test("server binds to the requested loopback address", async (t) => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      ATOMS_PLUS_BIND_HOST: "127.0.0.1",
      ATOMS_PLUS_STORE: "memory",
      ATOMS_PLUS_ENV: "development",
      G2_ENABLED: "0",
      RESEND_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const deadline = Date.now() + 5_000;
  while (!output.includes("[plus] listening") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match(output, new RegExp(`listening bind=127\\.0\\.0\\.1 port=${port}`));
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
});
