import { createHash, randomBytes } from "node:crypto";

export const G2_PCM_SAMPLE_RATE_HZ = 16_000;
export const G2_MAX_RECORDING_SECONDS = 120;
export const G2_MAX_PCM_BYTES = G2_PCM_SAMPLE_RATE_HZ * 2 * G2_MAX_RECORDING_SECONDS;
const DEFAULT_TICKET_TTL_MS = 30_000;

function opaque(prefix) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function ticketKey(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sameBinding(a, b) {
  return a.email === b.email && a.familyId === b.familyId && a.jkt === b.jkt &&
    a.origin === b.origin && a.generation === b.generation;
}

function publicStatus(row) {
  if (!row) return { state: "not_found" };
  const base = { state: row.state, recordingId: row.recordingId };
  if (row.state === "completed") return { ...base, transcript: row.transcript };
  if (row.state === "completion_unknown") return { ...base, manualRetryRequired: true };
  return base;
}

/**
 * Transport-neutral owner for G2 provider leases. WebSocket and completed-audio
 * adapters must consume a ticket with `open` before they call `push`.
 */
export function createG2TranscriptionService({
  provider,
  now = () => Date.now(),
  logger = () => {},
  maxConcurrentPerAccount = 2,
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
  repository = null,
  leaseMs = 30_000,
  metrics = () => {},
} = {}) {
  if (!provider?.transcribe) throw new Error("transcription_provider_required");
  const tickets = new Map();
  const sessions = new Map();
  const recordings = new Map();

  function log(event, row, extra = {}) {
    logger({ event, state: row?.state, ...extra });
  }

  const then = (value, next) => value && typeof value.then === "function" ? value.then(next) : next(value);

  function activeFor(email) {
    let count = 0;
    for (const row of recordings.values()) {
      if (row.binding.email === email && ["open", "transcribing"].includes(row.state)) count += 1;
    }
    return count;
  }

  function mintTicket(binding, { recordingId, purpose }) {
    if (!recordingId || !["stream", "batch"].includes(purpose)) throw new Error("invalid_ticket_request");
    const value = opaque("g2t");
    const stored = {
      binding: { ...binding }, recordingId: String(recordingId), purpose,
      expiresAt: now() + ticketTtlMs,
    };
    const write = repository?.ticketPut
      ? repository.ticketPut(ticketKey(value), stored.binding, stored)
      : tickets.set(ticketKey(value), stored);
    log("ticket_minted", { recordingId, binding });
    return then(write, () => ({ value, expiresAt: stored.expiresAt, recordingId, purpose, maxBytes: G2_MAX_PCM_BYTES }));
  }

  function open(value, binding) {
    const key = ticketKey(value);
    let consumed;
    if (repository?.ticketConsume) consumed = repository.ticketConsume(key, binding, now());
    else { consumed = tickets.get(key); tickets.delete(key); }
    return then(consumed, (ticket) => openConsumed(ticket, binding));
  }

  function openConsumed(ticket, binding) {
    if (!ticket || ticket.expiresAt < now() || !sameBinding(ticket.binding, binding)) {
      return { state: "blocked", error: "ticket_invalid" };
    }
    const existing = recordings.get(ticket.recordingId);
    if (existing) {
      if (!sameBinding(existing.binding, binding)) return { state: "blocked", error: "ticket_invalid" };
      clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
      return {
        ...publicStatus(existing),
        sessionId: existing.sessionId,
        nextSequence: existing.nextSequence,
      };
    }
    if (repository?.acquireSlot) {
      return then(repository.acquireSlot(binding, ticket.recordingId, now(), 5 * 60_000, maxConcurrentPerAccount),
        (acquired) => acquired ? createOpenSession(ticket, binding) : { state: "blocked", error: "concurrency_limit" });
    }
    if (activeFor(binding.email) >= maxConcurrentPerAccount) return { state: "blocked", error: "concurrency_limit" };
    return createOpenSession(ticket, binding);
  }

  function createOpenSession(ticket, binding) {
    const sessionId = opaque("g2s");
    const row = {
      recordingId: ticket.recordingId,
      sessionId,
      purpose: ticket.purpose,
      binding: { ...binding },
      state: "open",
      chunks: [],
      bytes: 0,
      nextSequence: 0,
      abortController: null,
      completion: null,
      leaseOwner: null,
      transcript: null,
      disconnectTimer: null,
    };
    recordings.set(row.recordingId, row);
    sessions.set(sessionId, row);
    log("stream_opened", row);
    return { state: "open", sessionId, recordingId: row.recordingId, nextSequence: 0 };
  }

  function openWebSocket(value, origin) {
    const key = ticketKey(value);
    let consumed;
    if (repository?.ticketConsume) consumed = repository.ticketConsume(key, { origin }, now());
    else { consumed = tickets.get(key); tickets.delete(key); }
    return then(consumed, (ticket) => {
      if (!ticket?.binding || ticket.binding.origin !== origin) return { state: "blocked", error: "ticket_invalid" };
      return openConsumed(ticket, ticket.binding);
    });
  }

  function push(sessionId, { sequence, pcm }, context) {
    const row = sessions.get(String(sessionId));
    if (context && (context.recordingId !== row?.recordingId || !sameBinding(row.binding, context.binding))) {
      return { ok: false, error: "session_closed" };
    }
    if (!row || row.state !== "open") return { ok: false, error: "session_closed" };
    const bytes = Buffer.from(pcm ?? []);
    if (bytes.byteLength % 2 !== 0) return { ok: false, error: "odd_pcm_bytes" };
    if (!Number.isSafeInteger(sequence) || sequence < 0) return { ok: false, error: "sequence_gap" };
    if (sequence < row.nextSequence) {
      const prior = row.chunks[sequence];
      const digest = createHash("sha256").update(bytes).digest("hex");
      return prior?.digest === digest
        ? { ok: true, duplicate: true, nextSequence: row.nextSequence, acceptedBytes: 0 }
        : { ok: false, error: "sequence_conflict" };
    }
    if (sequence !== row.nextSequence) return { ok: false, error: "sequence_gap" };
    if (row.bytes + bytes.byteLength > G2_MAX_PCM_BYTES) return { ok: false, error: "recording_limit" };
    row.chunks.push({ bytes, digest: createHash("sha256").update(bytes).digest("hex") });
    row.bytes += bytes.byteLength;
    row.nextSequence += 1;
    log("audio_accepted", row, { sequence, acceptedBytes: bytes.byteLength, totalBytes: row.bytes });
    return { ok: true, nextSequence: row.nextSequence, acceptedBytes: bytes.byteLength };
  }

  function finalize(sessionId, context) {
    const row = sessions.get(String(sessionId));
    if (context && (!row || context.recordingId !== row.recordingId || !sameBinding(row.binding, context.binding))) {
      return Promise.resolve({ state: "not_found" });
    }
    if (!row) return Promise.resolve({ state: "not_found" });
    if (row.completion) return row.completion;
    if (row.state !== "open") return Promise.resolve(publicStatus(row));
    row.state = "transcribing";
    row.abortController = new AbortController();
    row.leaseOwner = opaque("lease");
    const owner = row.leaseOwner;
    const generation = row.binding.generation;
    const pcm = Buffer.concat(row.chunks.map((chunk) => chunk.bytes), row.bytes);
    const audioDurationMs = Math.round(row.bytes / (G2_PCM_SAMPLE_RATE_HZ * 2) * 1000);
    const providerStartedAt = now();
    log("provider_started", row, { bytes: row.bytes });
    row.completion = (async () => {
      if (repository?.claim) {
        const claim = await repository.claim(row.binding, row.recordingId, owner, leaseMs);
        if (!claim?.acquired) {
          row.state = claim?.state ?? "transcribing";
          row.transcript = claim?.transcript ?? null;
          if (row.state === "completed") await repository?.releaseSlot?.(row.binding, row.recordingId);
          return publicStatus(row);
        }
      }
      try {
        const result = await provider.transcribe({
          recordingId: row.recordingId,
          pcm,
          sampleRateHz: G2_PCM_SAMPLE_RATE_HZ,
          signal: row.abortController.signal,
        });
        if (row.leaseOwner !== owner || row.binding.generation !== generation || row.state === "revoked") {
          return publicStatus(row);
        }
        const transcript = String(result?.transcript ?? "");
        if (repository) {
          const won = await repository.complete(row.binding, row.recordingId, owner, transcript);
          if (!won) {
            const durable = await repository.get(row.binding, row.recordingId);
            row.state = durable?.state ?? "completion_unknown";
            row.transcript = durable?.transcript ?? null;
            return publicStatus(row);
          }
        }
        row.state = "completed";
        row.transcript = transcript;
        row.chunks = [];
        row.bytes = 0;
        log("provider_completed", row);
        metrics({ operation: "transcription", count: 1, statusClass: "ok", durationMs: audioDurationMs,
          providerLatencyMs: now() - providerStartedAt });
        return publicStatus(row);
      } catch (error) {
        if (row.state === "revoked" || row.abortController?.signal.aborted) return publicStatus(row);
        row.state = error?.ambiguous ? "completion_unknown" : "retryable";
        await repository?.fail?.(row.binding, row.recordingId, owner, row.state);
        log("provider_failed", row, { ambiguous: Boolean(error?.ambiguous) });
        metrics({ operation: "transcription", count: 1,
          statusClass: error?.ambiguous ? "retryable" : "failed", durationMs: audioDurationMs,
          providerLatencyMs: now() - providerStartedAt });
        return publicStatus(row);
      } finally {
        if (row.state !== "completion_unknown") await repository?.releaseSlot?.(row.binding, row.recordingId);
      }
    })();
    return row.completion;
  }

  function status(binding, recordingId) {
    const row = recordings.get(String(recordingId));
    return row && sameBinding(row.binding, binding) ? publicStatus(row) : { state: "not_found" };
  }

  function manualRetry(binding, recordingId) {
    const row = recordings.get(String(recordingId));
    if (!row || !sameBinding(row.binding, binding) || row.state !== "completion_unknown") return { state: "not_found" };
    row.state = "open";
    row.completion = null;
    row.leaseOwner = null;
    log("manual_retry_authorized", row);
    return { state: "ready_for_manual_retry", recordingId: row.recordingId };
  }

  function cancel(binding, recordingId, reason = "cancelled") {
    const row = recordings.get(String(recordingId));
    if (!row || !sameBinding(row.binding, binding)) return { state: "not_found" };
    row.abortController?.abort(reason);
    clearTimeout(row.disconnectTimer);
    row.disconnectTimer = null;
    row.leaseOwner = null;
    row.state = reason;
    row.chunks = [];
    row.bytes = 0;
    log("recording_cancelled", row, { reason });
    for (const listener of row.closeListeners ?? []) listener(reason);
    void repository?.releaseSlot?.(row.binding, row.recordingId);
    return publicStatus(row);
  }

  function cancelSession(sessionId, reason = "cancelled") {
    const row = sessions.get(String(sessionId));
    return row ? cancel(row.binding, row.recordingId, reason) : { state: "not_found" };
  }

  function onSessionClose(sessionId, listener) {
    const row = sessions.get(String(sessionId));
    if (!row) return () => {};
    row.closeListeners ??= new Set();
    row.closeListeners.add(listener);
    return () => row.closeListeners.delete(listener);
  }

  function disconnect(sessionId, graceMs = 30_000) {
    const row = sessions.get(String(sessionId));
    if (!row || row.state !== "open") return;
    clearTimeout(row.disconnectTimer);
    row.disconnectTimer = setTimeout(() => cancelSession(sessionId, "timeout"), graceMs);
    row.disconnectTimer.unref?.();
  }

  function revoke({ email, familyId, generation }) {
    for (const [key, ticket] of tickets) {
      if (ticket.binding.email === email && ticket.binding.familyId === familyId && ticket.binding.generation < generation) {
        tickets.delete(key);
      }
    }
    for (const row of recordings.values()) {
      if (row.binding.email !== email || row.binding.familyId !== familyId || row.binding.generation >= generation) continue;
      row.abortController?.abort("revoked");
      row.leaseOwner = null;
      row.state = "revoked";
      row.chunks = [];
      row.bytes = 0;
      log("recording_revoked", row);
      for (const listener of row.closeListeners ?? []) listener("revoked");
    }
  }

  return {
    available: provider.available !== false,
    mintTicket,
    open,
    openWebSocket,
    push,
    finalize,
    status,
    manualRetry,
    cancel,
    cancelSession,
    onSessionClose,
    disconnect,
    revoke,
  };
}

function wavPcm16Mono(pcm, sampleRateHz = G2_PCM_SAMPLE_RATE_HZ) {
  const input = Buffer.from(pcm);
  const out = Buffer.alloc(44 + input.length);
  out.write("RIFF", 0); out.writeUInt32LE(36 + input.length, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRateHz, 24); out.writeUInt32LE(sampleRateHz * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36);
  out.writeUInt32LE(input.length, 40); input.copy(out, 44);
  return out;
}

/** Selected completed-audio batch fallback. No provider request is made without a key. */
export function createOpenAiBatchTranscriptionProvider({ apiKey, url, model, fetchImpl = fetch }) {
  return {
    available: Boolean(apiKey),
    async transcribe({ pcm, sampleRateHz, signal }) {
      if (!apiKey) throw new Error("speech_provider_disabled");
      const form = new FormData();
      form.append("model", model);
      form.append("file", new Blob([wavPcm16Mono(pcm, sampleRateHz)], { type: "audio/wav" }), "capture.wav");
      const response = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form, signal });
      if (!response.ok) throw new Error(`speech_provider_${response.status}`);
      const body = await response.json();
      return { transcript: String(body.text ?? "") };
    },
  };
}
