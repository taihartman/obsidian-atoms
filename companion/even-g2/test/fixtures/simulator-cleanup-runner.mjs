import { spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";

import { shutdownTrackedChildren, trackChildForCleanup } from "../../scripts/simulator-harness-lib.mjs";

const mode = process.argv[2];
const port = Number(process.argv[3]);

if (mode === "listener") {
  process.on("SIGHUP", () => {});
  process.on("SIGTERM", () => {});
  createServer((socket) => {
    socket.on("error", () => {});
    socket.end("ready");
  }).listen(port, "127.0.0.1", () => {
    process.stdout.write("LISTENING\n");
  });
} else if (mode === "launcher") {
  const listener = spawn(process.execPath, [new URL(import.meta.url).pathname, "listener", String(port)], {
    detached: false,
    stdio: "ignore",
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (connected) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  listener.unref();
  process.exit(0);
} else if (mode === "runner") {
  const children = new Set();
  const launcher = spawn(process.execPath, [new URL(import.meta.url).pathname, "launcher", String(port)], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  launcher._processGroup = true;
  trackChildForCleanup(children, launcher);
  await once(launcher, "exit");

  const deadline = Date.now() + 5_000;
  let listenerReady = false;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (connected) { listenerReady = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!listenerReady) throw new Error("listener_descendant_not_ready");
  process.stdout.write(`READY ${launcher.pid}\n`);
  const keepAlive = setInterval(() => {}, 1_000);

  const stop = () => {
    clearInterval(keepAlive);
    void shutdownTrackedChildren(children, { forceGroupsImmediately: true }).then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
