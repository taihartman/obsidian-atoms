import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createG2PreparationService } from "../src/g2/preparation.mjs";
import { createG2MetadataAdapter } from "../src/g2/metadata.mjs";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

const binding = { email: "g2-create@example.com", familyId: "g2f_one", generation: 3 };
const capturedAt = "2026-09-08T17:14:03-04:00";
const transcript = "  Keep this exactly.\r\nIncluding the end.  \r\n";

describe("G2 server-held metadata adapter", () => {
  // G2_PREPARE_METADATA_013: transcript egress is bounded by live device
  // authority and model output cannot cross the downstream metadata allowlists.
  it("uses structured output with bounded title and tag context", async () => {
    let request;
    const adapter = createG2MetadataAdapter({
      apiKey: "sk-ant-test",
      fetchImpl: async (_url, init) => {
        request = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ type: "text", text: JSON.stringify({
              title: "Exact metadata title",
              tags: ["ideas"],
              links: [{ note: "Known context", reason: "explains why this capture connects" }],
            }) }],
          }),
        };
      },
    });
    const result = await adapter({
      transcript,
      availableTags: Array.from({ length: 70 }, (_, i) => `tag-${i}`),
      mirrorTitles: Array.from({ length: 70 }, (_, i) => `Title ${i}`),
    });
    assert.deepEqual(result, { ok: true, metadata: {
      title: "Exact metadata title",
      tags: ["ideas"],
      links: [{ note: "Known context", reason: "explains why this capture connects" }],
    } });
    assert.equal(request.output_config.format.type, "json_schema");
    const prompt = request.messages[0].content[0].text;
    assert.match(prompt, /Title 49/);
    assert.doesNotMatch(prompt, /Title 50/);
    assert.match(prompt, /tag-49/);
    assert.doesNotMatch(prompt, /tag-50/);
    assert.equal(request.messages[1].content[0].text, transcript);
  });

  it("fails closed without a key and for malicious or invalid structured output", async () => {
    let calls = 0;
    const keyless = createG2MetadataAdapter({
      apiKey: "",
      fetchImpl: async () => { calls += 1; throw new Error("must not send"); },
    });
    assert.deepEqual(await keyless({ transcript, availableTags: [], mirrorTitles: [] }), {
      ok: false, reason: "unavailable",
    });
    assert.equal(calls, 0);

    for (const text of [
      "```json\n{\"title\":\"Injected\",\"tags\":[],\"links\":[]}\n```",
      JSON.stringify({ title: "Injected", tags: [], links: [], body: "rewrite sacred bytes" }),
      JSON.stringify({ title: "Injected", tags: [], links: [{ note: "Known context" }] }),
    ]) {
      const invalid = createG2MetadataAdapter({
        apiKey: "sk-ant-test",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ content: [{ type: "text", text }] }),
        }),
      });
      assert.deepEqual(await invalid({ transcript, availableTags: [], mirrorTitles: [] }), {
        ok: false, reason: "invalid_output",
      });
    }
  });

  it("turns a bounded upstream timeout into a content-free failure", async () => {
    const adapter = createG2MetadataAdapter({
      apiKey: "sk-ant-test",
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    });
    assert.deepEqual(await adapter({ transcript, availableTags: [], mirrorTitles: [] }), {
      ok: false, reason: "timeout",
    });
  });
});

async function seeded(store) {
  store.ensureAccount(binding.email);
  await store.grantPeriod(binding.email, { remaining: 150, status: "active", plan: "monthly" });
  const pair = await store.g2PairMint(binding.email, { scopes: ["g2:prepare", "g2:commit", "g2:status"] });
  const redeemed = await store.g2PairRedeem(pair.code, { jkt: "g2-create-test-jkt", name: "Test G2" });
  await store.g2SynchronizeConsent(binding.email, {
    baseRevision: 0,
    askMirror: { granted: true, version: "ask-mirror-v1" },
    askWrite: { granted: true, version: "ask-write-v1" },
    freshGesture: true,
  });
  const consent = await store.g2SynchronizeDisclosure(binding.email, {
    baseRevision: 1,
    disclosure: { granted: true, version: "g2-audio-v1" },
    freshGesture: true,
  });
  await store.mirrorUpsert(binding.email, [{
    path: "Atoms/Known context.md", title: "Known context", body: "known", tags: ["ideas"],
  }]);
  return { ...binding, familyId: redeemed.device.id, generation: consent.revision };
}

describe("G2 prepare, confirm, and delivery", () => {
  for (const mode of askStoreModes()) {
    it(`${mode}: persists the sacred proposal and commits exactly once`, async () => {
      await withStore(mode, async (store) => {
        const liveBinding = await seeded(store);
        const service = createG2PreparationService({
          store,
          now: () => Date.parse("2026-09-08T22:00:00Z"),
          generate: async () => ({
            title: "Keep this exactly",
            tags: ["ideas", "invented"],
            links: [
              { note: "Known context", reason: "adds context to the captured thought" },
              { note: "Unknown", reason: "must not survive" },
            ],
          }),
        });
        const proposal = await service.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_one" });
        assert.equal(proposal.body, transcript);
        assert.deepEqual(proposal.tags, ["ideas"]);
        assert.deepEqual(proposal.links, [{ note: "Known context", reason: "adds context to the captured thought" }]);

        const restored = await service.get(liveBinding, proposal.preparationId);
        assert.equal(restored.fingerprint, proposal.fingerprint);
        assert.equal(restored.body, transcript);

        const first = await service.commit(liveBinding, {
          preparationId: proposal.preparationId,
          fingerprint: proposal.fingerprint,
          confirmedTitle: proposal.title,
          commitKey: "commit_one",
        });
        const retry = await service.commit(liveBinding, {
          preparationId: proposal.preparationId,
          fingerprint: proposal.fingerprint,
          confirmedTitle: proposal.title,
          commitKey: "commit_one",
        });
        assert.equal(first.state, "queued");
        assert.equal(retry.outboxId, first.outboxId);
        assert.equal((await store.outboxPull(binding.email)).items.length, 1);

        const changed = await store.outboxEnqueue(binding.email, {
          kind: "create", payload: { title: "Changed", body: "changed", proposal_fingerprint: "different" },
          client_request_id: "commit_one", proposal_fingerprint: "different",
        });
        assert.equal(changed.ok, false);
        assert.equal(changed.error, "idempotency_conflict");
      });
    });

    it(`${mode}: atomically refuses G2 enqueue after write consent withdrawal`, async () => {
      await withStore(mode, async (store) => {
        const liveBinding = await seeded(store);
        const result = await store.g2SynchronizeConsent(binding.email, {
          baseRevision: liveBinding.generation,
          askWrite: { granted: false, version: "" },
        });
        assert.equal(result.askWrite.granted, false);
        const enqueue = await store.g2OutboxEnqueue(liveBinding, {
          kind: "create",
          payload: { title: "Must not queue", body: transcript, origin: "g2", proposal_fingerprint: "fp-withdrawn" },
          client_request_id: "commit-withdrawn",
          proposal_fingerprint: "fp-withdrawn",
        });
        assert.deepEqual(enqueue, { ok: false, error: "setup_required" });
        assert.equal((await store.outboxPull(binding.email)).items.length, 0);
      });
    });
  }

  it("requires the displayed title and rejects expiry before enqueue", async () => {
    await withStore("memory", async (store) => {
      const liveBinding = await seeded(store);
      let now = Date.parse("2026-09-08T22:00:00Z");
      const service = createG2PreparationService({
        store, now: () => now,
        generate: async () => ({ title: "Keep this exactly", tags: [], links: [] }),
      });
      const proposal = await service.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_two" });
      assert.equal((await service.commit(liveBinding, {
        preparationId: proposal.preparationId, fingerprint: proposal.fingerprint,
        confirmedTitle: "A different title", commitKey: "commit_two",
      })).state, "confirmation_mismatch");
      now += 16 * 60 * 1000;
      assert.equal((await service.commit(liveBinding, {
        preparationId: proposal.preparationId, fingerprint: proposal.fingerprint,
        confirmedTitle: proposal.title, commitKey: "commit_two",
      })).state, "expired");
      assert.equal((await store.outboxPull(binding.email)).items.length, 0);
    });
  });

  it("rechecks withdrawal inside the atomic enqueue boundary", async () => {
    await withStore("memory", async (store) => {
      const liveBinding = await seeded(store);
      const service = createG2PreparationService({
        store,
        generate: async () => ({ title: "Atomic boundary", tags: [], links: [] }),
      });
      const proposal = await service.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_atomic" });
      const atomic = store.g2OutboxEnqueue.bind(store);
      store.g2OutboxEnqueue = async (...args) => {
        await store.g2SynchronizeConsent(binding.email, {
          baseRevision: liveBinding.generation,
          askWrite: { granted: false, version: "" },
        });
        return atomic(...args);
      };
      const committed = await service.commit(liveBinding, {
        preparationId: proposal.preparationId,
        fingerprint: proposal.fingerprint,
        confirmedTitle: proposal.title,
        commitKey: "commit-atomic-withdrawal",
      });
      assert.deepEqual(committed, { state: "setup_required" });
      assert.equal((await store.outboxPull(binding.email)).items.length, 0);
    });
  });

  it("purges an unconfirmed proposal on disclosure withdrawal and hides foreign status", async () => {
    await withStore("memory", async (store) => {
      const liveBinding = await seeded(store);
      const service = createG2PreparationService({
        store,
        generate: async () => ({ title: "Keep this exactly", tags: [], links: [] }),
      });
      const proposal = await service.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_three" });
      await store.g2SynchronizeDisclosure(binding.email, {
        baseRevision: 2,
        disclosure: { granted: false, version: "" },
      });
      assert.equal(await service.get(liveBinding, proposal.preparationId), null);
      assert.deepEqual(await service.status({ ...liveBinding, email: "other@example.com" }, "obx_unknown"), { state: "not_found" });
    });
  });

  it("uses the structured adapter result without changing captured bytes", async () => {
    await withStore("memory", async (store) => {
      const liveBinding = await seeded(store);
      const adapter = createG2MetadataAdapter({
        apiKey: "sk-ant-test",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ content: [{ type: "text", text: JSON.stringify({
            title: "A generated declarative title",
            tags: ["ideas"],
            links: [{ note: "Known context", reason: "grounds the new thought in known context" }],
          }) }] }),
        }),
      });
      const service = createG2PreparationService({ store, generate: adapter });
      const proposal = await service.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_model" });
      assert.equal(proposal.title, "A generated declarative title");
      assert.deepEqual(proposal.tags, ["ideas"]);
      assert.deepEqual(proposal.links, [{ note: "Known context", reason: "grounds the new thought in known context" }]);
      assert.equal(proposal.body, transcript);
      assert.equal(proposal.capturedRecordSha256, "a10ef7fe3b93388b97e7e33d977fd7f38b0df6c5c1fd86c6321dcb3ab5928c90");
    });
  });

  it("reports unavailable or failed metadata instead of substituting a heuristic title", async () => {
    await withStore("memory", async (store) => {
      const liveBinding = await seeded(store);
      const unavailable = createG2PreparationService({ store });
      assert.deepEqual(await unavailable.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_no_key" }), {
        state: "preparation_unavailable",
      });
      const invalid = createG2PreparationService({
        store,
        generate: async () => ({ ok: false, reason: "invalid_output" }),
      });
      assert.deepEqual(await invalid.prepare(liveBinding, { transcript, capturedAt, transcriptionId: "trn_invalid" }), {
        state: "preparation_failed",
      });
    });
  });

  for (const event of ["disclosure withdrawal", "device revocation"]) {
    it(`aborts and refuses a late model result after ${event}`, async () => {
      await withStore("memory", async (store) => {
        const liveBinding = await seeded(store);
        let release;
        let entered;
        const started = new Promise((resolve) => { entered = resolve; });
        const parked = new Promise((resolve) => { release = resolve; });
        let observedSignal;
        const originalPut = store.g2PreparationPut;
        let puts = 0;
        store.g2PreparationPut = (...args) => { puts += 1; return originalPut(...args); };
        const service = createG2PreparationService({
          store,
          generate: async ({ signal }) => {
            observedSignal = signal;
            entered();
            await parked;
            // Deliberately ignore abort: a late provider callback still cannot publish.
            return { title: "Late metadata", tags: ["ideas"], links: [] };
          },
        });
        const pending = service.prepare(liveBinding, { transcript, capturedAt, transcriptionId: `trn_${event}` });
        await started;
        if (event === "disclosure withdrawal") {
          const next = await store.g2SynchronizeDisclosure(binding.email, {
            baseRevision: liveBinding.generation,
            disclosure: { granted: false, version: "" },
          });
          service.revoke({ ...liveBinding, generation: next.revision });
        } else {
          assert.equal(await store.g2RevokeDevice(binding.email, liveBinding.familyId), true);
          service.revoke({ ...liveBinding, generation: Number.MAX_SAFE_INTEGER });
        }
        assert.equal(observedSignal.aborted, true);
        release();
        assert.deepEqual(await pending, { state: "setup_required" });
        assert.equal(puts, 0, "late metadata must not become a proposal");
      });
    });
  }
});
