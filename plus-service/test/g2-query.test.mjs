import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { createG2QueryAdapter, createG2QueryService, createG2ReadService } from "../src/g2/query.mjs";

async function fixture(generate, opts = {}) {
  const store = await createStore({ mode: "memory" });
  const email = "query@example.com";
  store.ensureAccount(email);
  await store.grantPeriod(email, { remaining: 50, status: "active", plan: "monthly" });
  const pair = await store.g2PairMint(email, { scopes: ["g2:query", "g2:recent", "g2:fetch"] });
  const redeemed = await store.g2PairRedeem(pair.code, { jkt: "query-jkt", name: "Query G2" });
  let consent = await store.g2SynchronizeConsent(email, {
    baseRevision: 0,
    askMirror: { granted: true, version: "ask-mirror-v1" },
    freshGesture: true,
  });
  if (opts.disclosure !== false) {
    consent = await store.g2SynchronizeDisclosure(email, {
      baseRevision: consent.revision,
      disclosure: { granted: true, version: "g2-audio-v1" },
      freshGesture: true,
    });
  }
  await store.mirrorUpsert(email, [
    { path: "Atoms/Launch.md", title: "Launch", body: "The café launch is Friday.\nBring the blue banner.", tags: ["work"], created: "2026-09-08" },
    { path: "Atoms/Backup.md", title: "Backup", body: "The launch might be Saturday if it rains.", tags: ["work"], created: "2026-09-07" },
  ]);
  const binding = { email, familyId: redeemed.device.id, jkt: "query-jkt", generation: consent.revision };
  return { store, binding, service: createG2QueryService({ store, generate, now: opts.now, logger: opts.logger }) };
}

describe("grounded G2 query", () => {
  // G2_GROUNDED_QUERY_014 binds every answer to an authorized immutable mirror snapshot.
  it("accepts exact unambiguous UTF-8 evidence and derives byte ranges", async () => {
    let seen;
    const logs = [];
    const fx = await fixture(async (input) => {
      seen = input;
      return { ok: true, answer: { state: "answer", claims: [{ text: "The café launch is Friday.", citations: [{ chunkId: input.chunks[0].id, quote: "The café launch is Friday." }] }] } };
    }, { logger: (row) => logs.push(row) });
    const result = await fx.service.query(fx.binding, { question: "When is the café launch?" });
    assert.equal(result.state, "answered");
    assert.equal(result.answer, "The café launch is Friday.");
    assert.equal(result.claims[0].citations[0].byte_start, 0);
    assert.equal(result.claims[0].citations[0].byte_end, Buffer.byteLength("The café launch is Friday.", "utf8"));
    assert.match(seen.chunks[0].id, /^chk_[a-f0-9]{24}$/);
    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes("When is the café launch"), false);
    assert.equal(serializedLogs.includes("The café launch is Friday"), false);
  });

  it("rejects unknown, altered, ambiguous, irrelevant, and normalization-trick citations", async () => {
    const cases = [
      (_input) => ({ chunkId: "chk_unknown", quote: "The café launch is Friday." }),
      (input) => ({ chunkId: input.chunks[0].id, quote: "The café launch is Thursday." }),
      (input) => ({ chunkId: input.chunks[0].id, quote: "cafe\u0301 launch" }),
      (input) => ({ chunkId: input.chunks[0].id, quote: "Bring the blue banner." }),
    ];
    for (const citation of cases) {
      const fx = await fixture(async (input) => ({ ok: true, answer: { state: "answer", claims: [{ text: "The launch is Friday.", citations: [citation(input)] }] } }));
      const result = await fx.service.query(fx.binding, { question: "When is the launch?" });
      assert.equal(result.state, "closest_matches");
      assert.ok(result.matches.length > 0);
      assert.equal(JSON.stringify(result).includes("blue banner"), false);
    }
  });

  it("falls back for absent, conflicting, incomplete, or mutated evidence", async () => {
    const absent = await fixture(async () => { throw new Error("model must not run"); });
    assert.equal((await absent.service.query(absent.binding, { question: "Where are my tulips?" })).state, "closest_matches");

    let mutated = false;
    const fx = await fixture(async (input) => {
      if (!mutated) {
        mutated = true;
        await fx.store.mirrorUpsert(fx.binding.email, [{ path: "Atoms/Launch.md", title: "Renamed", body: "The café launch is Friday.\nBring the blue banner." }]);
      }
      return { ok: true, answer: { state: "answer", claims: [{ text: "The café launch is Friday.", citations: [{ chunkId: input.chunks[0].id, quote: "The café launch is Friday." }] }] } };
    });
    assert.equal((await fx.service.query(fx.binding, { question: "When is the café launch?" })).state, "closest_matches");

    const stale = await fixture(async () => { throw new Error("stale evidence must not leave the server"); }, { now: () => Date.now() + 2 * 24 * 60 * 60 * 1000 });
    assert.equal((await stale.service.query(stale.binding, { question: "When is the café launch?" })).state, "closest_matches");
  });

  it("rejects an otherwise exact quote when it occurs more than once", async () => {
    const fx = await fixture(async (input) => ({ ok: true, answer: { state: "answer", claims: [{ text: "Launch is repeated.", citations: [{ chunkId: input.chunks[0].id, quote: "launch" }] }] } }));
    await fx.store.mirrorUpsert(fx.binding.email, [{ path: "Atoms/Launch.md", title: "Launch", body: "launch launch" }]);
    assert.equal((await fx.service.query(fx.binding, { question: "What launch is repeated?" })).state, "closest_matches");
  });

  it("shares a content-free 30 model-call daily limit across the account", async () => {
    let calls = 0;
    const fx = await fixture(async (input) => {
      calls += 1;
      return { ok: true, answer: { state: "answer", claims: [{ text: "The café launch is Friday.", citations: [{ chunkId: input.chunks[0].id, quote: "The café launch is Friday." }] }] } };
    });
    for (let i = 0; i < 30; i++) assert.equal((await fx.service.query(fx.binding, { question: "When is the café launch?" })).state, "answered");
    assert.equal((await fx.service.query(fx.binding, { question: "When is the café launch?" })).state, "limit_reached");
    assert.equal(calls, 30);
  });

  it("uses structured output and fails closed on extra model fields", async () => {
    let request;
    const adapter = createG2QueryAdapter({
      apiKey: "sk-ant-test",
      fetchImpl: async (_url, init) => {
        request = JSON.parse(init.body);
        return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ state: "answer", claims: [{ text: "Friday", citations: [{ chunkId: "chk_one", quote: "Friday" }] }], invented: true }) }] }) };
      },
    });
    assert.deepEqual(await adapter({ question: "When?", chunks: [] }), { ok: false, reason: "invalid_output" });
    assert.equal(request.output_config.format.type, "json_schema");
  });

  it("requires current G2 disclosure before query model egress", async () => {
    let calls = 0;
    const fx = await fixture(async () => { calls += 1; return { ok: false, reason: "must_not_run" }; }, { disclosure: false });
    assert.deepEqual(await fx.service.query(fx.binding, { question: "When is the café launch?" }), { state: "setup_required" });
    assert.equal(calls, 0);
  });

  it("rejects exact contradictory evidence even when it shares the topic word", async () => {
    const fx = await fixture(async (input) => {
      const saturday = input.chunks.find((chunk) => chunk.text.includes("Saturday"));
      return { ok: true, answer: { state: "answer", claims: [{ text: "The launch is Friday.", citations: [{ chunkId: saturday.id, quote: "The launch might be Saturday if it rains." }] }] } };
    });
    assert.equal((await fx.service.query(fx.binding, { question: "When is the launch?" })).state, "closest_matches");
  });

  it("falls back when a materially retrieved conflicting source is uncited", async () => {
    const fx = await fixture(async (input) => {
      const friday = input.chunks.find((chunk) => chunk.text.includes("Friday"));
      return { ok: true, answer: { state: "answer", claims: [{ text: "The launch is Friday.", citations: [{ chunkId: friday.id, quote: "The café launch is Friday." }] }] } };
    });
    assert.equal((await fx.service.query(fx.binding, { question: "When is the launch?" })).state, "closest_matches");
  });

  it("accepts the structured conflicting verdict only as closest matches", async () => {
    const fx = await fixture(async () => ({ ok: true, answer: { state: "conflicting", claims: [] } }));
    const result = await fx.service.query(fx.binding, { question: "When is the launch?" });
    assert.equal(result.state, "closest_matches");
    assert.ok(result.matches.length > 1);
  });
});

describe("G2 recent and fetch authorization races", () => {
  it("returns setup_required without a list when disclosure is withdrawn during recent", async () => {
    const fx = await fixture(async () => ({ ok: false }), {});
    const original = fx.store.mirrorList.bind(fx.store);
    let withdrew = false;
    fx.store.mirrorList = async (...args) => {
      const result = await original(...args);
      if (!withdrew) {
        withdrew = true;
        await fx.store.g2SynchronizeDisclosure(fx.binding.email, { baseRevision: fx.binding.generation, disclosure: { granted: false, version: "" } });
      }
      return result;
    };
    assert.deepEqual(await createG2ReadService({ store: fx.store }).recent(fx.binding, { limit: 20 }), { state: "setup_required" });
  });

  it("returns setup_required without body when the device is revoked during fetch", async () => {
    const fx = await fixture(async () => ({ ok: false }), {});
    const id = (await fx.store.mirrorList(fx.binding.email, { limit: 1 })).items[0].id;
    const original = fx.store.mirrorFetch.bind(fx.store);
    let revoked = false;
    fx.store.mirrorFetch = async (...args) => {
      const result = await original(...args);
      if (!revoked) {
        revoked = true;
        await fx.store.g2RevokeDevice(fx.binding.email, fx.binding.familyId);
      }
      return result;
    };
    assert.deepEqual(await createG2ReadService({ store: fx.store }).fetch(fx.binding, { id }), { state: "setup_required" });
  });
});
