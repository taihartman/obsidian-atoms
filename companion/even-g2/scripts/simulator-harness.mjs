#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  acknowledgeCreateOutbox,
  bootstrapSimulatorAccount,
  createDeterministicProviderServer,
  parseHarnessArgs,
  serviceEnvironment,
  shutdownTrackedChildren,
  terminateTrackedChild,
  trackChildForCleanup,
  validateHarnessOptions,
} from "./simulator-harness-lib.mjs";

const require = createRequire(import.meta.url);
const companionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(companionRoot, "../..");
const plusRoot = join(repoRoot, "plus-service");
const viteBin = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const simulatorBin = join(dirname(require.resolve("@evenrealities/evenhub-simulator/package.json")), "bin/index.js");
const args = parseHarnessArgs(process.argv.slice(2));
const options = { ...validateHarnessOptions(args), email: args.email, servicesCheck: args.servicesCheck };
const controller = new AbortController();
const children = new Set();
let providerServer;
let cleaning = false;

function redact(value) {
  return String(value)
    .replace(/token=mt_[A-Za-z0-9_-]+/gu, "token=[redacted]")
    .replace(/\b(?:sess|g2a|g2r)_[A-Za-z0-9_-]+\b/gu, "[redacted]");
}

function spawnChild(label, executable, childArgs, spawnOptions, { processGroup = false } = {}) {
  const child = spawn(executable, childArgs, {
    ...spawnOptions,
    detached: processGroup && process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child._label = label;
  child._processGroup = processGroup;
  child._log = "";
  const collect = (chunk) => {
    child._log = `${child._log}${chunk.toString()}`.slice(-262_144);
    const safe = redact(chunk.toString()).trimEnd();
    if (safe) process.stdout.write(`[${label}] ${safe}\n`);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  trackChildForCleanup(children, child);
  child.once("error", (error) => {
    process.stderr.write(`[${label}] ${error.message}\n`);
  });
  return child;
}

async function waitForHttp(url, { label, timeoutMs = 15_000, text, child } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unavailable";
  while (Date.now() < deadline && !controller.signal.aborted) {
    if (child?.exitCode != null) throw new Error(`${label || "service"}_exited:${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (response.ok && (!text || body.includes(text))) return body;
      lastError = `${response.status} ${body.slice(0, 120)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100, undefined, { signal: controller.signal }).catch(() => {});
  }
  throw new Error(`${label || "service"}_did_not_start:${lastError}`);
}

async function waitForMagicToken(child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !controller.signal.aborted) {
    const matches = [...child._log.matchAll(/token=(mt_[A-Za-z0-9_-]+)/gu)];
    if (matches.length) return matches.at(-1)[1];
    if (child.exitCode != null) throw new Error(`plus_service_exited:${child.exitCode}`);
    await delay(50, undefined, { signal: controller.signal }).catch(() => {});
  }
  throw new Error("simulator_magic_token_unavailable");
}

async function listenProvider() {
  providerServer = createDeterministicProviderServer({ port: options.providerPort });
  providerServer.listen(options.providerPort, "127.0.0.1");
  await once(providerServer, "listening");
}

async function cleanup(exitCode = 0, { forceGroupsImmediately = false } = {}) {
  if (cleaning) return;
  cleaning = true;
  controller.abort();
  const childShutdown = shutdownTrackedChildren(children, { forceGroupsImmediately });
  if (providerServer?.listening) {
    providerServer.close();
    await Promise.race([once(providerServer, "close"), delay(1_000)]).catch(() => {});
  }
  await childShutdown;
  await delay(50).catch(() => {});
  process.exitCode = exitCode;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { void cleanup(0, { forceGroupsImmediately: true }); });
}

async function run() {
  if (!existsSync(join(plusRoot, "src/server.mjs"))) throw new Error("plus_service_not_found");
  await listenProvider();
  await waitForHttp(`${options.providerBaseUrl}/health`, { label: "provider" });

  const plus = spawnChild("plus", process.execPath, ["src/server.mjs"], {
    cwd: plusRoot,
    env: { ...process.env, ...serviceEnvironment(options, process.env) },
  });
  await waitForHttp(`${options.plusBaseUrl}/health`, { label: "plus-service", child: plus });
  const account = await bootstrapSimulatorAccount({
    baseUrl: options.plusBaseUrl,
    email: options.email,
    readMagicToken: () => waitForMagicToken(plus),
  });

  const vite = spawnChild("vite", process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(options.vitePort), "--strictPort"], {
    cwd: companionRoot,
    env: { ...process.env, NODE_ENV: "development" },
  });
  const targetUrl = `${options.companionOrigin}/simulator.html?plus=${encodeURIComponent(options.plusBaseUrl)}&auto=1&pair=${encodeURIComponent(account.pairingCode)}`;
  await waitForHttp(targetUrl, { label: "companion", text: "/src/simulator.ts", child: vite });
  await waitForHttp(`${options.companionOrigin}/src/simulator.ts`, { label: "companion-entry", text: "startG2Companion", child: vite });

  process.stdout.write(`\nAtoms G2 simulator account: ${account.email}\n`);
  process.stdout.write(`Pairing code: ${account.pairingCode} (expires ${account.expiresAt})\n`);
  process.stdout.write(`Companion: ${targetUrl}\n`);

  if (options.servicesCheck) {
    await delay(500, undefined, { signal: controller.signal });
    process.stdout.write("Local simulator supporting-services check passed: deterministic provider, real memory Plus service, public-route bootstrap, and Vite entry are healthy. The pinned glasses simulator and Create, Ask, and Recent drive are not exercised.\n");
    await cleanup(0);
    return;
  }

  void acknowledgeCreateOutbox({
    baseUrl: options.plusBaseUrl,
    session: account.session,
    signal: controller.signal,
    onAck: (id) => process.stdout.write(`[outbox] applied ${id}\n`),
  }).catch((error) => {
    if (!controller.signal.aborted) {
      process.stderr.write(`[outbox] ${error instanceof Error ? error.message : String(error)}\n`);
      void cleanup(1);
    }
  });

  const simulator = spawnChild("simulator", process.execPath, [simulatorBin, targetUrl, "--automation-port", String(options.automationPort)], {
    cwd: companionRoot,
    env: process.env,
  }, { processGroup: true });
  await waitForHttp(`${options.automationBaseUrl}/api/ping`, { label: "simulator-automation", timeoutMs: 30_000, text: "pong", child: simulator });
  process.stdout.write(`Automation API: ${options.automationBaseUrl}\n`);
  process.stdout.write("Simulator phone pairing and disclosure are submitted through their real controls automatically. Use the glasses controls; press Ctrl-C to stop the entire local stack.\n");

  const [code, signal] = await once(simulator, "exit");
  if (!cleaning) {
    process.stderr.write(`[simulator] exited (${signal || code || 0})\n`);
    await cleanup(code === 0 || signal === "SIGTERM" ? 0 : 1);
  }
  terminateTrackedChild(vite);
}

run().catch(async (error) => {
  process.stderr.write(`Atoms G2 simulator failed: ${error instanceof Error ? error.message : String(error)}\n`);
  await cleanup(1);
});
