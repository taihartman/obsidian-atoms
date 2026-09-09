import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createG2TranscriptionService,
  G2_MAX_PCM_BYTES,
} from "../src/g2/transcription.mjs";

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
