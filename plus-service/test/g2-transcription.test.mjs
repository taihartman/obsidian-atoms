import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAiBatchTranscriptionProvider,
  createG2TranscriptionService,
  G2_MAX_PCM_BYTES,
} from "../src/g2/transcription.mjs";
import { createStore } from "../src/store.mjs";

const binding = Object.freeze({
  email: "owner@atoms.test",
  familyId: "g2d_owner",
  jkt: "thumbprint-owner",
  origin: "https://com.atoms.g2.evenhub",
  generation: 4,
});

function controlledProvider() {
  const calls = [];
  return {
    calls,
    transcribe(input) {
      let resolve;
      let reject;
      const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
      calls.push({ ...input, resolve, reject });
      return promise;
    },
  };
}

describe("G2 bounded transcription", () => {
  it("rechecks durable authorization across workers before PCM and provider egress", async () => {
    const store = await createStore({ mode: "memory" });
    store.ensureAccount(binding.email);
    await store.grantPeriod(binding.email, { remaining: 50, status: "active", plan: "monthly" });
    const pair = await store.g2PairMint(binding.email, { scopes: ["g2:transcribe"] });
    const redeemed = await store.g2PairRedeem(pair.code, { jkt: binding.jkt, name: "Owner G2" });
    const consent = await store.g2SynchronizeDisclosure(binding.email, {
      baseRevision: 0,
      disclosure: { granted: true, version: "g2-audio-v1" },
      freshGesture: true,
    });
    const live = { ...binding, familyId: redeemed.device.id, generation: consent.revision };
    const repository = {
      authorize: (candidate) => store.g2Authorize(candidate),
      ticketPut: (...args) => store.g2TranscriptionTicketPut(...args),
      ticketConsume: (...args) => store.g2TranscriptionTicketConsume(...args),
      claim: (candidate, recordingId, owner, leaseMs) =>
        store.g2TranscriptionClaim(candidate, recordingId, owner, Date.now(), leaseMs),
      complete: (...args) => store.g2TranscriptionComplete(...args),
      fail: (...args) => store.g2TranscriptionFail(...args),
      get: (...args) => store.g2TranscriptionGet(...args),
    };
    const provider = controlledProvider();
    const workerA = createG2TranscriptionService({ provider, repository, authorizationPollMs: 5 });
    const opened = await workerA.open((await workerA.mintTicket(live, { recordingId: "rec-cross-worker", purpose: "batch" })).value, live);
    assert.equal((await workerA.push(opened.sessionId, { sequence: 0, pcm: Buffer.from([1, 2]) })).ok, true);
    let closedAs;
    workerA.onSessionClose(opened.sessionId, (reason) => { closedAs = reason; });

    await store.g2RevokeDevice(live.email, live.familyId); // worker B
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closedAs, "revoked", "an idle socket closes without waiting for another PCM frame");
    assert.equal((await workerA.push(opened.sessionId, { sequence: 1, pcm: Buffer.from([3, 4]) })).error, "session_closed");
    assert.equal((await workerA.finalize(opened.sessionId)).state, "revoked");
    assert.equal(provider.calls.length, 0, "revoked capture never reaches the provider");
  });

  it("aborts in-flight provider work after cross-worker disclosure withdrawal", async () => {
    const store = await createStore({ mode: "memory" });
    store.ensureAccount(binding.email);
    await store.grantPeriod(binding.email, { remaining: 50, status: "active", plan: "monthly" });
    const pair = await store.g2PairMint(binding.email, { scopes: ["g2:transcribe"] });
    const redeemed = await store.g2PairRedeem(pair.code, { jkt: binding.jkt, name: "Owner G2" });
    const consent = await store.g2SynchronizeDisclosure(binding.email, {
      baseRevision: 0, disclosure: { granted: true, version: "g2-audio-v1" }, freshGesture: true,
    });
    const live = { ...binding, familyId: redeemed.device.id, generation: consent.revision };
    const repository = {
      authorize: (candidate) => store.g2Authorize(candidate),
      ticketPut: (...args) => store.g2TranscriptionTicketPut(...args),
      ticketConsume: (...args) => store.g2TranscriptionTicketConsume(...args),
      claim: (candidate, recordingId, owner, leaseMs) => store.g2TranscriptionClaim(candidate, recordingId, owner, Date.now(), leaseMs),
      complete: (...args) => store.g2TranscriptionComplete(...args), fail: (...args) => store.g2TranscriptionFail(...args),
      get: (...args) => store.g2TranscriptionGet(...args),
    };
    const provider = controlledProvider();
    const workerA = createG2TranscriptionService({ provider, repository, authorizationPollMs: 5 });
    const opened = await workerA.open((await workerA.mintTicket(live, { recordingId: "rec-withdraw", purpose: "batch" })).value, live);
    await workerA.push(opened.sessionId, { sequence: 0, pcm: Buffer.from([1, 2]) });
    const pending = workerA.finalize(opened.sessionId);
    await new Promise((resolve) => setImmediate(resolve));
    await store.g2SynchronizeDisclosure(live.email, {
      baseRevision: live.generation, disclosure: { granted: false, version: "" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(provider.calls[0].signal.aborted, true);
    provider.calls[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    assert.equal((await pending).state, "revoked");
  });

  it("bounds OpenAI transcription with a caller-composed deadline", async () => {
    const caller = new AbortController();
    let observed;
    const provider = createOpenAiBatchTranscriptionProvider({
      apiKey: "sk-test", url: "https://speech.invalid", model: "speech-test", timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        observed = init.signal;
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
    });
    await assert.rejects(provider.transcribe({ pcm: Buffer.from([1, 2]), sampleRateHz: 16_000, signal: caller.signal }), /speech_provider_timeout/);
    assert.equal(observed.aborted, true);
    assert.equal(caller.signal.aborted, false, "provider deadline does not mutate caller signal");

    const cancelled = new AbortController();
    const callerBound = createOpenAiBatchTranscriptionProvider({
      apiKey: "sk-test", url: "https://speech.invalid", model: "speech-test", timeoutMs: 1_000,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("caller_cancelled"), { name: "AbortError" })), { once: true });
      }),
    });
    const pending = callerBound.transcribe({ pcm: Buffer.from([1, 2]), sampleRateHz: 16_000, signal: cancelled.signal });
    cancelled.abort("revoked");
    await assert.rejects(pending, /caller_cancelled/);
  });
  it("a worker restart takes an expired lease while a late former owner cannot replace the terminal result", async () => {
    let time = 1_000;
    const rows = new Map();
    const repository = {
      claim(bindingValue, recordingId, owner, leaseMs) {
        const row = rows.get(recordingId);
        if (row?.state === "completed") return { ...row, acquired: false };
        if (row?.leaseUntil > time && row.leaseOwner !== owner) return { ...row, acquired: false };
        const next = { binding: bindingValue, recordingId, state: "transcribing", leaseOwner: owner, leaseUntil: time + leaseMs };
        rows.set(recordingId, next);
        return { ...next, acquired: true };
      },
      complete(bindingValue, recordingId, owner, transcript) {
        const row = rows.get(recordingId);
        if (!row || row.leaseOwner !== owner || row.binding.generation !== bindingValue.generation) return false;
        rows.set(recordingId, { ...row, state: "completed", transcript });
        return true;
      },
      get(bindingValue, recordingId) {
        const row = rows.get(recordingId);
        return row?.binding.email === bindingValue.email ? row : null;
      },
    };
    const firstProvider = controlledProvider();
    const firstWorker = createG2TranscriptionService({ provider: firstProvider, now: () => time, repository, leaseMs: 30_000 });
    const first = firstWorker.open(firstWorker.mintTicket(binding, { recordingId: "rec-crash", purpose: "batch" }).value, binding);
    firstWorker.push(first.sessionId, { sequence: 0, pcm: Buffer.from([1, 2]) });
    const abandoned = firstWorker.finalize(first.sessionId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(firstProvider.calls.length, 1);

    time += 31_000;
    const secondProvider = controlledProvider();
    const secondWorker = createG2TranscriptionService({ provider: secondProvider, now: () => time, repository, leaseMs: 30_000 });
    const second = secondWorker.open(secondWorker.mintTicket(binding, { recordingId: "rec-crash", purpose: "batch" }).value, binding);
    secondWorker.push(second.sessionId, { sequence: 0, pcm: Buffer.from([1, 2]) });
    const takeover = secondWorker.finalize(second.sessionId);
    await new Promise((resolve) => setImmediate(resolve));
    secondProvider.calls[0].resolve({ transcript: "winner" });
    assert.equal((await takeover).transcript, "winner");

    firstProvider.calls[0].resolve({ transcript: "late stale result" });
    assert.equal((await abandoned).transcript, "winner");
  });

  it("G2_STREAM_TICKET_010 consumes one bound ticket before accepting audio", () => {
    const provider = controlledProvider();
    const service = createG2TranscriptionService({ provider, now: () => 10_000 });
    const ticket = service.mintTicket(binding, { recordingId: "rec-1", purpose: "stream" });

    assert.equal(service.open(ticket.value, binding).state, "open");
    assert.equal(service.open(ticket.value, binding).error, "ticket_invalid");

    const stolen = service.mintTicket(binding, { recordingId: "rec-2", purpose: "stream" });
    assert.equal(service.open(stolen.value, { ...binding, jkt: "other" }).error, "ticket_invalid");
    assert.equal(provider.calls.length, 0, "opening and rejected audio never contact provider");
  });

  it("G2_STREAM_AUDIO_011 accepts arbitrary even chunks once, rejects gaps and bounds", async () => {
    const provider = controlledProvider();
    const service = createG2TranscriptionService({ provider });
    const opened = service.open(service.mintTicket(binding, { recordingId: "rec-3", purpose: "stream" }).value, binding);

    assert.deepEqual(service.push(opened.sessionId, { sequence: 0, pcm: Buffer.from([1, 2]) }), { ok: true, nextSequence: 1, acceptedBytes: 2 });
    assert.deepEqual(service.push(opened.sessionId, { sequence: 0, pcm: Buffer.from([1, 2]) }), {
      ok: true,
      duplicate: true,
      nextSequence: 1,
      acceptedBytes: 0,
    });
    assert.equal(service.push(opened.sessionId, { sequence: 0, pcm: Buffer.from([8, 8]) }).error, "sequence_conflict");
    assert.equal(service.push(opened.sessionId, { sequence: 2, pcm: Buffer.from([3, 4]) }).error, "sequence_gap");
    assert.equal(service.push(opened.sessionId, { sequence: 1, pcm: Buffer.from([3]) }).error, "odd_pcm_bytes");
    assert.equal(service.push(opened.sessionId, { sequence: 1, pcm: Buffer.alloc(G2_MAX_PCM_BYTES) }).error, "recording_limit");

    const done = service.finalize(opened.sessionId);
    assert.equal(provider.calls.length, 1);
    assert.deepEqual([...provider.calls[0].pcm], [1, 2]);
    provider.calls[0].resolve({ transcript: "exact final\n" });
    assert.deepEqual(await done, { state: "completed", recordingId: "rec-3", transcript: "exact final\n" });
    assert.equal(service.finalize(opened.sessionId), done, "duplicate finalize attaches to one provider promise");
  });

  it("leases one provider owner, discards late revoked completion, and requires manual retry after ambiguity", async () => {
    const provider = controlledProvider();
    const service = createG2TranscriptionService({ provider });
    const first = service.open(service.mintTicket(binding, { recordingId: "rec-4", purpose: "batch" }).value, binding);
    service.push(first.sessionId, { sequence: 0, pcm: Buffer.from([9, 8]) });
    const pending = service.finalize(first.sessionId);
    const attached = service.status(binding, "rec-4");
    assert.equal(attached.state, "transcribing");
    assert.equal(provider.calls.length, 1);

    service.revoke({ email: binding.email, familyId: binding.familyId, generation: 5 });
    assert.equal(provider.calls[0].signal.aborted, true);
    provider.calls[0].resolve({ transcript: "must not escape" });
    assert.deepEqual(await pending, { state: "revoked", recordingId: "rec-4" });
    assert.equal(service.status(binding, "rec-4").state, "revoked");

    const retryBinding = { ...binding, generation: 6 };
    const second = service.open(service.mintTicket(retryBinding, { recordingId: "rec-5", purpose: "batch" }).value, retryBinding);
    service.push(second.sessionId, { sequence: 0, pcm: Buffer.from([7, 6]) });
    const ambiguous = service.finalize(second.sessionId);
    provider.calls[1].reject(Object.assign(new Error("provider disconnected"), { ambiguous: true }));
    assert.equal((await ambiguous).state, "completion_unknown");
    assert.equal(service.status(retryBinding, "rec-5").manualRetryRequired, true);
    assert.equal(service.manualRetry(retryBinding, "rec-5").state, "ready_for_manual_retry");
  });

  it("enforces per-account concurrency and emits content-free metadata logs", () => {
    const provider = controlledProvider();
    const logs = [];
    const service = createG2TranscriptionService({ provider, maxConcurrentPerAccount: 1, logger: (row) => logs.push(row) });
    const a = service.open(service.mintTicket(binding, { recordingId: "rec-a", purpose: "stream" }).value, binding);
    const b = service.open(service.mintTicket(binding, { recordingId: "rec-b", purpose: "stream" }).value, binding);
    assert.equal(a.state, "open");
    assert.equal(b.error, "concurrency_limit");
    service.push(a.sessionId, { sequence: 0, pcm: Buffer.from([0xde, 0xad]) });
    assert.equal(JSON.stringify(logs).includes("222,173"), false);
    assert.equal(JSON.stringify(logs).includes("transcript"), false);
    assert.equal(JSON.stringify(logs).includes("authorization"), false);
  });
});
