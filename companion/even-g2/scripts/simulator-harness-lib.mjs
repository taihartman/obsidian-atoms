import { createServer } from "node:http";
import { G2_ALLOWED_SCOPES } from "../../../plus-service/src/store/shared.mjs";

export const G2_V1_SCOPES = G2_ALLOWED_SCOPES;

export const SIMULATOR_ATOMS = Object.freeze([
  {
    path: "Atoms/Cobalt launch.md",
    title: "Cobalt launch",
    body: "The Cobalt project ships on Friday. Mina owns the Cobalt launch checklist.",
    tags: ["simulator"],
    created: "2026-09-09T12:00:00.000Z",
  },
  {
    path: "Atoms/Field notes cadence.md",
    title: "Field notes cadence",
    body: "Field notes are reviewed every Tuesday before the team planning session.",
    tags: ["simulator"],
    created: "2026-09-08T12:00:00.000Z",
  },
]);

export function trackChildForCleanup(children, child) {
  children.add(child);
  child.once("exit", () => {
    // A detached leader can exit while its descendants continue to own the
    // process group and ports. Retain the leader's PID as the safe group ID.
    if (!child._processGroup) children.delete(child);
  });
  return child;
}

export function terminateTrackedChild(child, {
  platform = process.platform,
  processKill = process.kill,
  signal = "SIGTERM",
} = {}) {
  if (!child) return;
  const groupPid = Number(child.pid);
  if (child._processGroup && platform !== "win32" && Number.isInteger(groupPid) && groupPid > 1) {
    try {
      processKill(-groupPid, signal);
      return;
    } catch {
      // The process group may already be gone; fall back to the leader handle
      // only when it is still alive.
    }
  }
  if (child.exitCode == null) {
    try { child.kill(signal); } catch { /* already stopped */ }
  }
}

export async function shutdownTrackedChildren(children, {
  forceGroupsImmediately = false,
  graceMs = 500,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  for (const child of children) terminateTrackedChild(child, { signal: "SIGTERM" });
  if (forceGroupsImmediately) {
    // Signal callbacks cannot rely on a later timer when invoked through an
    // npm/terminal process tree. Kill only the isolated groups we created,
    // synchronously, before yielding control.
    for (const child of children) {
      if (child._processGroup) terminateTrackedChild(child, { signal: "SIGKILL" });
    }
    return;
  }
  await wait(graceMs);
  for (const child of children) terminateTrackedChild(child, { signal: "SIGKILL" });
}

function refused(message) {
  throw new Error(message);
}

function port(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) refused(`invalid_${name}`);
  return parsed;
}

function loopbackOrigin(raw, name) {
  let url;
  try { url = new URL(String(raw)); } catch { refused(`invalid_${name}`); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    refused(`invalid_${name}`);
  }
  return url.origin;
}

function simulatorEmail(value) {
  const email = String(value || "g2-simulator@atoms.test").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) refused("invalid_simulator_email");
  return email;
}

export function parseHarnessArgs(args = []) {
  const values = {};
  const ports = new Map([
    ["--plus-port", "plusPort"],
    ["--vite-port", "vitePort"],
    ["--provider-port", "providerPort"],
    ["--automation-port", "automationPort"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const raw = String(args[index]);
    if (raw === "--services-check") {
      values.servicesCheck = true;
      continue;
    }
    const [flag, inline] = raw.split("=", 2);
    if (ports.has(flag)) {
      const value = inline ?? args[++index];
      if (value == null || String(value).startsWith("--")) refused(`invalid_${ports.get(flag).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`);
      values[ports.get(flag)] = port(value, ports.get(flag).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
      continue;
    }
    if (flag === "--email") {
      const value = inline ?? args[++index];
      if (value == null || String(value).startsWith("--")) refused("invalid_simulator_email");
      values.email = simulatorEmail(value);
      continue;
    }
    refused(`unknown_simulator_argument:${raw}`);
  }
  return {
    plusPort: values.plusPort ?? 8787,
    vitePort: values.vitePort ?? 5173,
    providerPort: values.providerPort ?? 8788,
    automationPort: values.automationPort ?? 9898,
    email: values.email ?? "g2-simulator@atoms.test",
    servicesCheck: values.servicesCheck === true,
  };
}

export function validateHarnessOptions(input = {}) {
  const plusPort = port(input.plusPort ?? 8787, "plus_port");
  const vitePort = port(input.vitePort ?? 5173, "vite_port");
  const providerPort = port(input.providerPort ?? 8788, "provider_port");
  const automationPort = port(input.automationPort ?? 9898, "automation_port");
  if (new Set([plusPort, vitePort, providerPort, automationPort]).size !== 4) refused("simulator_ports_must_be_distinct");
  return {
    plusPort,
    vitePort,
    providerPort,
    automationPort,
    plusBaseUrl: `http://127.0.0.1:${plusPort}`,
    companionOrigin: `http://127.0.0.1:${vitePort}`,
    providerBaseUrl: `http://127.0.0.1:${providerPort}`,
    automationBaseUrl: `http://127.0.0.1:${automationPort}`,
  };
}

export function serviceEnvironment(urls, inherited = process.env) {
  const plusBaseUrl = loopbackOrigin(urls.plusBaseUrl, "plus_base_url");
  const companionOrigin = loopbackOrigin(urls.companionOrigin, "companion_origin");
  const providerBaseUrl = loopbackOrigin(urls.providerBaseUrl, "provider_base_url");
  if ([inherited.ATOMS_PLUS_ENV, inherited.NODE_ENV].some((value) => ["prod", "production"].includes(String(value || "").toLowerCase()))) {
    refused("simulator_production_environment_refused");
  }
  return {
    ATOMS_PLUS_ENV: "development",
    NODE_ENV: "development",
    ATOMS_PLUS_STORE: "memory",
    ATOMS_PLUS_BIND_HOST: "127.0.0.1",
    DOGFOOD_AUTO_GRANT: "1",
    PORT: new URL(plusBaseUrl).port,
    PUBLIC_BASE_URL: plusBaseUrl,
    G2_ENABLED: "1",
    G2_APP_ORIGIN: companionOrigin,
    G2_TRANSCRIPTION_ENABLED: "1",
    G2_OPENAI_API_KEY: "simulator-only",
    G2_ANTHROPIC_API_KEY: "simulator-only",
    OPENAI_TRANSCRIPTION_URL: `${providerBaseUrl}/openai/transcriptions`,
    ANTHROPIC_MESSAGES_URL: `${providerBaseUrl}/anthropic/messages`,
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    RESEND_API_KEY: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_PRICE_MONTHLY: "",
    STRIPE_PRICE_YEARLY: "",
    STRIPE_PRICE_TOPUP: "",
    ASK_EXPAND_ENABLED: "0",
    G2_DPOP_NONCE_SECRET: "atoms-g2-local-simulator-nonce-secret",
    G2_SOCKET_IDLE_TIMEOUT_MS: "30000",
  };
}

function schemaRequired(payload) {
  return payload?.output_config?.format?.schema?.required || [];
}

function words(value) {
  return new Set(String(value || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

function citationQuote(text, question) {
  const questionWords = words(question);
  const candidates = String(text || "").match(/[^.!?]+[.!?]?/gu) || [];
  const matching = candidates.find((candidate) => [...words(candidate)].some((word) => questionWords.has(word)));
  return String(matching || candidates[0] || "").trim().slice(0, 500).trim();
}

export function deterministicAnthropicResponse(payload) {
  const required = schemaRequired(payload);
  if (required.includes("title") && required.includes("tags") && required.includes("links")) {
    return { content: [{ type: "text", text: JSON.stringify({ title: "Simulator capture", tags: [], links: [] }) }] };
  }
  if (required.includes("state") && required.includes("claims")) {
    const raw = payload?.messages?.at?.(-1)?.content?.find?.((block) => block?.type === "text")?.text;
    let request;
    try { request = JSON.parse(String(raw || "")); } catch { request = {}; }
    const chunks = Array.isArray(request.chunks) ? request.chunks : [];
    const sourceIds = new Set();
    const claims = [];
    for (const chunk of chunks) {
      if (!chunk?.id || !chunk?.sourceId || sourceIds.has(chunk.sourceId)) continue;
      const quote = citationQuote(chunk.text, request.question);
      if (!quote) continue;
      sourceIds.add(chunk.sourceId);
      claims.push({ text: quote, citations: [{ chunkId: String(chunk.id), quote }] });
    }
    return { content: [{ type: "text", text: JSON.stringify({ state: claims.length ? "answer" : "insufficient", claims }) }] };
  }
  return { content: [{ type: "text", text: JSON.stringify({ state: "insufficient", claims: [] }) }] };
}

export function createDeterministicProviderHandler({ host = "127.0.0.1", port: listenPort = 8788 } = {}) {
  if (host !== "127.0.0.1") refused("simulator_provider_host_refused");
  const selectedPort = port(listenPort, "provider_port");
  let transcriptionCount = 0;
  return async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${selectedPort}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, service: "atoms-g2-simulator-provider" }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/openai/transcriptions") {
      req.resume();
      transcriptionCount += 1;
      const text = transcriptionCount % 2 === 1
        ? "The simulator captured an atom about Cobalt project milestones."
        : "What is known about Cobalt?";
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ text }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.method === "POST" && url.pathname === "/anthropic/messages") {
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { payload = {}; }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(deterministicAnthropicResponse(payload)));
      return;
    }
    res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ message: "Not found" }));
  };
}

export function createDeterministicProviderServer(options = {}) {
  return createServer(createDeterministicProviderHandler(options));
}

async function jsonRequest(fetchImpl, url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("simulator_request_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`simulator_bootstrap_${response.status}:${JSON.stringify(payload)}`);
    return payload;
  } catch (error) {
    if (controller.signal.reason instanceof Error && controller.signal.reason.message === "simulator_request_timeout") {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function bootstrapSimulatorAccount({
  baseUrl,
  fetchImpl = fetch,
  readMagicToken,
  email = "g2-simulator@atoms.test",
  atoms = SIMULATOR_ATOMS,
  signal,
  requestTimeoutMs = 10_000,
} = {}) {
  const base = loopbackOrigin(baseUrl, "plus_base_url");
  const accountEmail = simulatorEmail(email);
  if (typeof readMagicToken !== "function") refused("simulator_magic_token_reader_required");
  const headers = { "content-type": "application/json" };
  await jsonRequest(fetchImpl, `${base}/v1/auth/magic-link`, { method: "POST", headers, body: JSON.stringify({ email: accountEmail }), signal }, requestTimeoutMs);
  const token = await readMagicToken();
  if (!/^mt_[A-Za-z0-9_-]+$/.test(String(token || ""))) refused("simulator_magic_token_unavailable");
  const exchange = await jsonRequest(fetchImpl, `${base}/v1/auth/exchange`, { method: "POST", headers, body: JSON.stringify({ token }), signal }, requestTimeoutMs);
  const session = String(exchange?.session || exchange?.sessionToken || "");
  if (!session.startsWith("sess_")) refused("simulator_verified_session_unavailable");
  const authorizedHeaders = { ...headers, authorization: `Bearer ${session}` };
  const current = await jsonRequest(fetchImpl, `${base}/v1/g2/consent`, { method: "GET", headers: authorizedHeaders, signal }, requestTimeoutMs);
  const consent = await jsonRequest(fetchImpl, `${base}/v1/g2/consent`, {
    method: "POST",
    headers: authorizedHeaders,
    body: JSON.stringify({
      baseRevision: current.revision,
      freshGesture: true,
      askMirror: { granted: true, version: "2026-08-07" },
      askWrite: { granted: true, version: "2026-09-08" },
    }),
  }, requestTimeoutMs);
  if (!consent?.askMirror?.granted || !consent?.askWrite?.granted) refused("simulator_consent_grant_refused");
  await jsonRequest(fetchImpl, `${base}/v1/ask/mirror/upsert`, {
    method: "POST", headers: authorizedHeaders, body: JSON.stringify({ atoms }), signal,
  }, requestTimeoutMs);
  const pair = await jsonRequest(fetchImpl, `${base}/v1/g2/pair/code`, {
    method: "POST", headers: authorizedHeaders, body: JSON.stringify({ scopes: G2_V1_SCOPES }),
  }, requestTimeoutMs);
  if (!pair?.code) refused("simulator_pairing_code_unavailable");
  return { session, pairingCode: pair.code, expiresAt: pair.expiresAt, email: accountEmail, consent };
}

export function simulatorCreateTargetPath(row) {
  const title = String(row?.payload?.title || "Simulator capture").replace(/[/:\\?%*|"<>]/g, "-").slice(0, 160);
  const rowId = String(row?.id || "unknown").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  return `Atoms/${title}--${rowId}.md`;
}

export async function acknowledgeCreateOutbox({ baseUrl, session, signal, intervalMs = 10_000, requestTimeoutMs = 10_000, onAck = () => {} }) {
  const base = loopbackOrigin(baseUrl, "plus_base_url");
  const headers = { "content-type": "application/json", authorization: `Bearer ${session}` };
  while (!signal?.aborted) {
    try {
      const pulled = await jsonRequest(fetch, `${base}/v1/ask/outbox/pull`, { method: "POST", headers, body: JSON.stringify({ limit: 20 }), signal }, requestTimeoutMs);
      for (const row of pulled?.items || pulled?.rows || []) {
        if (row?.kind !== "create" || row?.payload?.origin !== "g2") continue;
        const payload = row.payload;
        const targetPath = simulatorCreateTargetPath(row);
        await jsonRequest(fetch, `${base}/v1/ask/mirror/upsert`, {
          method: "POST", headers, signal,
          body: JSON.stringify({ atoms: [{
            path: targetPath,
            title: payload.title,
            body: payload.body,
            tags: payload.tags,
            links: payload.links,
          }] }),
        }, requestTimeoutMs);
        await jsonRequest(fetch, `${base}/v1/ask/outbox/ack`, {
          method: "POST", headers, signal,
          body: JSON.stringify({ id: row.id, status: "applied", target_path: targetPath }),
        }, requestTimeoutMs);
        onAck(row.id);
      }
    } catch (error) {
      if (signal?.aborted) break;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
