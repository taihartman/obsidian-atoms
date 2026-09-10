import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The repository Plus service is intentionally JavaScript-only.
import { G2_ALLOWED_SCOPES } from "../../../plus-service/src/store/shared.mjs";

import {
  acknowledgeCreateOutbox,
  bootstrapSimulatorAccount,
  createDeterministicProviderHandler,
  deterministicAnthropicResponse,
  G2_V1_SCOPES,
  parseHarnessArgs,
  serviceEnvironment,
  simulatorCreateTargetPath,
  terminateTrackedChild,
  trackChildForCleanup,
  validateHarnessOptions,
} from "../scripts/simulator-harness-lib.mjs";

describe("simulator harness safety", () => {
  it.skipIf(process.platform === "win32")("cleans a detached listener descendant through the real signal path", async () => {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => reservation.once("listening", resolve));
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("cleanup_test_port_unavailable");
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));

    const runner = spawn(process.execPath, [
      new URL("./fixtures/simulator-cleanup-runner.mjs", import.meta.url).pathname,
      "runner",
      String(port),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    runner.stdout.setEncoding("utf8");
    runner.stderr.setEncoding("utf8");
    let output = "";
    runner.stdout.on("data", (chunk) => { output += chunk; });
    runner.stderr.on("data", (chunk) => { output += chunk; });
    let groupPid = 0;

    const canConnect = () => new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });

    try {
      const readyDeadline = Date.now() + 5_000;
      while (!output.includes("READY ") && Date.now() < readyDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const match = output.match(/READY (\d+)/u);
      if (!match) throw new Error(`cleanup_runner_not_ready:${output}`);
      groupPid = Number(match[1]);
      expect(await canConnect()).toBe(true);

      const exited = new Promise<void>((resolve, reject) => {
        runner.once("exit", () => resolve());
        runner.once("error", reject);
      });
      runner.kill("SIGINT");
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("cleanup_runner_did_not_exit")), 5_000)),
      ]);

      const closedDeadline = Date.now() + 5_000;
      while (await canConnect()) {
        if (Date.now() >= closedDeadline) throw new Error("cleanup_descendant_listener_survived");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      if (runner.exitCode == null) runner.kill("SIGKILL");
      if (Number.isInteger(groupPid) && groupPid > 1) {
        try { process.kill(-groupPid, "SIGKILL"); } catch { /* exact test group is already gone */ }
      }
    }
  }, 15_000);

  it("retains an exited process-group leader and terminates its descendants by group id", () => {
    const groupLeader = Object.assign(new EventEmitter(), {
      pid: 31_837,
      exitCode: 0,
      _processGroup: true,
      kill: vi.fn(),
    });
    const children = new Set<typeof groupLeader>();
    const processKill = vi.fn();

    trackChildForCleanup(children, groupLeader);
    groupLeader.emit("exit", 0, null);
    expect(children.has(groupLeader)).toBe(true);

    terminateTrackedChild(groupLeader, { platform: "darwin", processKill, signal: "SIGTERM" });
    expect(processKill).toHaveBeenCalledExactlyOnceWith(-31_837, "SIGTERM");
    expect(groupLeader.kill).not.toHaveBeenCalled();
  });

  it("removes ordinary exited children and never issues a broad negative-pid kill", () => {
    const ordinary = Object.assign(new EventEmitter(), { pid: 41_000, exitCode: null, _processGroup: false, kill: vi.fn() });
    const children = new Set<typeof ordinary>();
    trackChildForCleanup(children, ordinary);
    ordinary.emit("exit", 0, null);
    expect(children.has(ordinary)).toBe(false);

    const invalidGroup = { pid: 1, exitCode: null, _processGroup: true, kill: vi.fn() };
    const processKill = vi.fn();
    terminateTrackedChild(invalidGroup, { platform: "linux", processKill, signal: "SIGKILL" });
    expect(processKill).not.toHaveBeenCalled();
    expect(invalidGroup.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("re-exports the server-authoritative G2 scopes", () => {
    expect(G2_V1_SCOPES).toBe(G2_ALLOWED_SCOPES);
  });

  it("parses only supported command arguments and validates the account email", () => {
    expect(parseHarnessArgs([
      "--plus-port", "18787",
      "--vite-port=15173",
      "--provider-port", "18788",
      "--automation-port", "19898",
      "--email", "SIMULATOR@Atoms.Test",
      "--services-check",
    ])).toEqual({
      plusPort: 18787,
      vitePort: 15173,
      providerPort: 18788,
      automationPort: 19898,
      email: "simulator@atoms.test",
      servicesCheck: true,
    });
    expect(() => parseHarnessArgs(["--email", "not-an-email"])).toThrow("invalid_simulator_email");
    expect(() => parseHarnessArgs(["--unknown"])).toThrow("unknown_simulator_argument");
  });

  it("accepts distinct loopback ports and refuses production mode", () => {
    expect(validateHarnessOptions({ plusPort: 18787, vitePort: 15173, providerPort: 18788, automationPort: 19898 })).toMatchObject({
      plusBaseUrl: "http://127.0.0.1:18787",
      companionOrigin: "http://127.0.0.1:15173",
    });
    expect(() => validateHarnessOptions({ plusPort: 8787, vitePort: 8787, providerPort: 8788, automationPort: 9898 })).toThrow("simulator_ports_must_be_distinct");
    expect(() => serviceEnvironment({ plusBaseUrl: "http://127.0.0.1:8787", companionOrigin: "http://127.0.0.1:5173", providerBaseUrl: "http://127.0.0.1:8788" }, { ATOMS_PLUS_ENV: "production" })).toThrow("simulator_production_environment_refused");
  });

  it("uses only local deterministic provider endpoints and disables real delivery", () => {
    const env = serviceEnvironment({
      plusBaseUrl: "http://127.0.0.1:8787",
      companionOrigin: "http://127.0.0.1:5173",
      providerBaseUrl: "http://127.0.0.1:8788",
    }, {});
    expect(env).toMatchObject({
      ATOMS_PLUS_ENV: "development",
      ATOMS_PLUS_STORE: "memory",
      G2_ENABLED: "1",
      G2_TRANSCRIPTION_ENABLED: "1",
      ATOMS_PLUS_BIND_HOST: "127.0.0.1",
      G2_APP_ORIGIN: "http://127.0.0.1:5173",
      ANTHROPIC_MESSAGES_URL: "http://127.0.0.1:8788/anthropic/messages",
      OPENAI_TRANSCRIPTION_URL: "http://127.0.0.1:8788/openai/transcriptions",
      RESEND_API_KEY: "",
      STRIPE_SECRET_KEY: "",
    });
    expect(env.G2_OPENAI_API_KEY).toBe("simulator-only");
    expect(env.G2_ANTHROPIC_API_KEY).toBe("simulator-only");
  });
});

describe("deterministic provider shaping", () => {
  it("responds to transcription without iterating or retaining the upload", async () => {
    const resume = vi.fn();
    const writeHead = vi.fn();
    const end = vi.fn();
    const request = {
      method: "POST", url: "/openai/transcriptions", resume,
      async *[Symbol.asyncIterator]() { throw new Error("upload_was_buffered"); },
    };
    const handler = createDeterministicProviderHandler({ port: 18788 });

    await handler(request as never, { writeHead, end } as never);

    expect(resume).toHaveBeenCalledOnce();
    expect(writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "content-type": "application/json" }));
    expect(JSON.parse(end.mock.calls[0][0])).toEqual({ text: "The simulator captured an atom about Cobalt project milestones." });
  });

  it("returns metadata without echoing the captured transcript", () => {
    const response = deterministicAnthropicResponse({
      output_config: { format: { schema: { required: ["title", "tags", "links"] } } },
      messages: [{ role: "user", content: [{ type: "text", text: "private captured words" }] }],
    });
    const value = JSON.parse(response.content[0].text);
    expect(value).toEqual({ title: "Simulator capture", tags: [], links: [] });
    expect(JSON.stringify(response)).not.toContain("private captured words");
  });

  it("returns exact query citations for every supplied source", () => {
    const chunks = [
      { id: "chk_a", sourceId: "atom_a", title: "Cobalt", text: "The Cobalt project ships on Friday." },
      { id: "chk_b", sourceId: "atom_b", title: "Owner", text: "Mina owns the Cobalt launch checklist." },
    ];
    const response = deterministicAnthropicResponse({
      output_config: { format: { schema: { required: ["state", "claims"] } } },
      messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ question: "What is known about Cobalt?", chunks }) }] }],
    });
    const value = JSON.parse(response.content[0].text);
    expect(value.state).toBe("answer");
    expect(value.claims).toEqual([
      { text: chunks[0].text, citations: [{ chunkId: "chk_a", quote: chunks[0].text }] },
      { text: chunks[1].text, citations: [{ chunkId: "chk_b", quote: chunks[1].text }] },
    ]);
  });
});

describe("simulator bootstrap HTTP sequence", () => {
  it("creates a verified session, grants consent, seeds atoms, and mints full G2 scopes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      { ok: true },
      { session: "sess_verified" },
      { revision: 0, askMirror: { granted: false }, askWrite: { granted: false } },
      { revision: 1, askMirror: { granted: true }, askWrite: { granted: true } },
      { count: 2, upserted: 2 },
      { code: "PAIRCODE", expiresAt: "2099-01-01T00:00:00.000Z" },
    ];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await bootstrapSimulatorAccount({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: fetchImpl as typeof fetch,
      readMagicToken: async () => "mt_test",
    });

    expect(result).toMatchObject({ session: "sess_verified", pairingCode: "PAIRCODE" });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/auth/magic-link",
      "/v1/auth/exchange",
      "/v1/g2/consent",
      "/v1/g2/consent",
      "/v1/ask/mirror/upsert",
      "/v1/g2/pair/code",
    ]);
    for (const call of calls.slice(2)) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer sess_verified");
    }
    expect(JSON.parse(String(calls[3].init?.body))).toMatchObject({
      baseRevision: 0,
      freshGesture: true,
      askMirror: { granted: true, version: "2026-08-07" },
      askWrite: { granted: true, version: "2026-09-08" },
    });
    expect(JSON.parse(String(calls[5].init?.body)).scopes).toEqual([
      "g2:capture", "g2:transcribe", "g2:prepare", "g2:commit", "g2:status", "g2:query", "g2:recent", "g2:fetch",
    ]);
  });

  it("times out a hanging request while retaining caller abort compatibility", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));

    try {
      const pending = bootstrapSimulatorAccount({
        baseUrl: "http://127.0.0.1:8787",
        fetchImpl: fetchImpl as typeof fetch,
        readMagicToken: async () => "mt_test",
        signal: caller.signal,
        requestTimeoutMs: 1_000,
      });
      const rejection = expect(pending).rejects.toThrow("simulator_request_timeout");
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(caller.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates a caller abort through a hanging request", async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = bootstrapSimulatorAccount({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: fetchImpl as typeof fetch,
      readMagicToken: async () => "mt_test",
      signal: caller.signal,
    });
    const rejection = expect(pending).rejects.toThrow("caller_cancelled");
    caller.abort(new Error("caller_cancelled"));
    await rejection;
  });
});

describe("simulator paired-vault delivery", () => {
  it("uses distinct stable paths for same-title rows and stable paths for retries", () => {
    const first = { id: "obx_first", payload: { title: "Cobalt: launch?" } };
    const second = { id: "obx_second", payload: { title: "Cobalt: launch?" } };
    expect(simulatorCreateTargetPath(first)).not.toBe(simulatorCreateTargetPath(second));
    expect(simulatorCreateTargetPath(first)).toBe(simulatorCreateTargetPath({ ...first }));
  });

  it("mirrors each G2 create through the public route before acknowledging it", async () => {
    const controller = new AbortController();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const row = {
      id: "obx_g2_capture",
      kind: "create",
      payload: {
        origin: "g2",
        title: "Cobalt: launch?",
        body: "Exact captured body\n",
        tags: ["capture", "simulator"],
        links: ["Cobalt project"],
      },
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      const payload = path === "/v1/ask/outbox/pull"
        ? { items: [row] }
        : { ok: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      await acknowledgeCreateOutbox({
        baseUrl: "http://127.0.0.1:8787",
        session: "sess_verified",
        signal: controller.signal,
        intervalMs: 0,
        onAck: () => controller.abort(),
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/ask/outbox/pull",
      "/v1/ask/mirror/upsert",
      "/v1/ask/outbox/ack",
    ]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      atoms: [{
        path: "Atoms/Cobalt- launch---obx_g2_capture.md",
        title: row.payload.title,
        body: row.payload.body,
        tags: row.payload.tags,
        links: row.payload.links,
      }],
    });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      id: row.id,
      status: "applied",
      target_path: "Atoms/Cobalt- launch---obx_g2_capture.md",
    });
  });
});
