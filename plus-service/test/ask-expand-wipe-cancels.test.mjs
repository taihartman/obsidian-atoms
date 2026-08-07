/**
 * Wipe must drain the expand queue, not just delete the rows.
 *
 * A queued expand job holds the atom body in its own closure and never re-reads
 * the row, so `mirrorWipe` alone leaves the plaintext on its way to Anthropic
 * after the user asked us to forget it — while the shipped disclosure says Wipe
 * removes search expansions.
 *
 * The assertion here is on the **fetch stub**, deliberately. Asserting on
 * stored state passes today with the egress still happening, which is the bug.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { enqueueMirrorExpand } from "../src/ask/expandSearch.mjs";
import { handleMirrorRoutes } from "../src/mirror/http.mjs";

const VICTIM = "wipe-victim@ex.co";
const BLOCKER = "wipe-blocker@ex.co";
const VICTIM_BODY = "victim plaintext that must never leave after a wipe";

/** Bodies of every upstream request the pool actually made. */
const sent = [];
/** @type {typeof globalThis.fetch} */
let realFetch;
/** @type {() => void} */
let releaseUpstream = () => {};
const priorEnv = {};

function setEnv(vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in priorEnv)) priorEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

before(() => {
  setEnv({
    ASK_EXPAND_ENABLED: "1",
    ANTHROPIC_API_KEY: "sk-test",
    // One slot, so the second job is provably still queued when Wipe lands.
    ASK_EXPAND_CONCURRENCY: "1",
  });
  realFetch = globalThis.fetch;
  const gate = new Promise((resolve) => {
    releaseUpstream = resolve;
  });
  globalThis.fetch = async (_url, init) => {
    sent.push(String(init?.body ?? ""));
    // The first (blocking) call parks here so the victim job stays in the pool
    // across the wipe rather than racing it.
    if (sent.length === 1) await gate;
    return { ok: false, status: 500 };
  };
});

after(() => {
  releaseUpstream();
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(priorEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Enough store surface for the pool's write-back path. */
const store = {
  mirrorSetExpand: async () => ({ updated: 1 }),
  accountFromSession: async () => ({ email: VICTIM, status: "active" }),
  mirrorWipe: async () => ({ ok: true }),
};

async function wipeViaRoute(email) {
  const calls = [];
  const handled = await handleMirrorRoutes({
    req: {
      method: "POST",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    },
    res: {},
    path: "/v1/ask/mirror/wipe",
    store: { ...store, accountFromSession: async () => ({ email, status: "active" }) },
    bearer: () => "sess_wipe_test",
    json: (_res, status, body) => calls.push({ status, body }),
    readBody: async () => ({}),
  });
  assert.equal(handled, true);
  assert.equal(calls[0]?.status, 200, JSON.stringify(calls[0]));
}

describe("wipe cancels queued expand work", () => {
  it("a job still in the pool never reaches Anthropic after Wipe", async () => {
    // Occupies the single pool slot and hangs, for a different account.
    enqueueMirrorExpand(store, {
      email: BLOCKER,
      path: "Atoms/Blocker.md",
      title: "Blocker",
      tags: [],
      body: "blocker body",
      contentHash: "hash-blocker",
    });
    const queued = enqueueMirrorExpand(store, {
      email: VICTIM,
      path: "Atoms/Victim.md",
      title: "Victim",
      tags: [],
      body: VICTIM_BODY,
      contentHash: "hash-victim-1",
    });
    assert.equal(queued, true, "victim work must actually be queued");

    await sleep(20);
    assert.equal(sent.length, 1, "only the blocker should be in flight");

    await wipeViaRoute(VICTIM);

    releaseUpstream();
    await sleep(50);

    assert.ok(
      !sent.some((b) => b.includes(VICTIM_BODY)),
      "wiped account's body must never be sent",
    );
  });

  it("a later re-sync for the same account is not blocked", async () => {
    // The cancellation is stamped, not sticky: work enqueued after the wipe
    // carries a newer timestamp and runs.
    await sleep(5);
    const queued = enqueueMirrorExpand(store, {
      email: VICTIM,
      path: "Atoms/Victim.md",
      title: "Victim",
      tags: [],
      body: VICTIM_BODY,
      contentHash: "hash-victim-2",
    });
    assert.equal(queued, true);
    await sleep(50);
    assert.ok(
      sent.some((b) => b.includes(VICTIM_BODY)),
      "a re-sync after Wipe must be able to expand again",
    );
  });
});
