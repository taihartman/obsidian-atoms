/**
 * #339 review fixes — the three guardrails around search expansion.
 *
 * F1: the backfill must not hold its caller's HTTP request open while it makes
 *     one model call per row (a 200-atom first sync 502'd on Fly's proxy).
 * F2: a barely-expanded index must not advertise `retrieval: lexical_expanded`
 *     (KTD1/R22 — "do not emit it solely because the column exists").
 * F3: body-plaintext egress is off unless an operator turns it on.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  backfillExpandForEmail,
  retrievalModeForCoverage,
} from "../src/ask/expandSearch.mjs";
import { config } from "../src/config.mjs";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

/** Restore whatever the rest of the suite left in the environment. */
function withEnv(vars, fn) {
  const prior = {};
  for (const [k, v] of Object.entries(vars)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let out;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  // An async body must keep the env until *it* finishes, not until it returns
  // its promise — restoring synchronously would run the body unconfigured.
  if (out && typeof out.then === "function") return out.finally(restore);
  restore();
  return out;
}

describe("F3 — expand (body plaintext egress) is off by default", () => {
  it("stays off when ASK_EXPAND_ENABLED is unset", () => {
    withEnv({ ASK_EXPAND_ENABLED: undefined }, () => {
      assert.equal(config.askExpandEnabled, false);
    });
  });

  it("turns on only when an operator sets it", () => {
    withEnv({ ASK_EXPAND_ENABLED: "1" }, () => {
      assert.equal(config.askExpandEnabled, true);
    });
    withEnv({ ASK_EXPAND_ENABLED: "0" }, () => {
      assert.equal(config.askExpandEnabled, false);
    });
  });
});

describe("F2 — retrieval mode honours the coverage floor", () => {
  it("partial coverage stays lexical; at/above the floor is lexical_expanded", () => {
    withEnv({ ASK_EXPAND_ENABLED: "1", ASK_EXPAND_COVERAGE_FLOOR: undefined }, () => {
      assert.equal(config.askExpandCoverageFloor, 0.8);
      // One expanded row in a hundred is not paraphrase mode.
      assert.equal(retrievalModeForCoverage(0.01), "lexical");
      assert.equal(retrievalModeForCoverage(0.5), "lexical");
      assert.equal(retrievalModeForCoverage(0.79), "lexical");
      assert.equal(retrievalModeForCoverage(0.8), "lexical_expanded");
      assert.equal(retrievalModeForCoverage(1), "lexical_expanded");
    });
  });

  it("expand disabled reports lexical whatever the coverage", () => {
    withEnv({ ASK_EXPAND_ENABLED: "0" }, () => {
      assert.equal(retrievalModeForCoverage(1), "lexical");
    });
  });
});

describe("F1 — backfill queues instead of blocking the response", () => {
  /** @type {typeof globalThis.fetch} */
  let realFetch;
  /** @type {() => void} */
  let releaseUpstream = () => {};
  let fetchCalls = 0;

  before(() => {
    realFetch = globalThis.fetch;
    const gate = new Promise((resolve) => {
      releaseUpstream = resolve;
    });
    // Stands in for Anthropic: hangs until the test lets it go, so "did the
    // backfill wait for the model?" is decidable rather than a race.
    globalThis.fetch = async () => {
      fetchCalls += 1;
      await gate;
      return { ok: false, status: 500 };
    };
  });

  after(() => {
    releaseUpstream();
    globalThis.fetch = realFetch;
  });

  for (const mode of askStoreModes()) {
    it(`[${mode}] returns while the model calls are still in flight`, async () => {
      await withStore(mode, async (store) => {
        await withEnv(
          { ASK_EXPAND_ENABLED: "1", ANTHROPIC_API_KEY: "sk-test" },
          async () => {
            const email = `f1-${mode}@ex.co`;
            await store.mirrorUpsert(email, [
              { path: "Atoms/A.md", title: "A", body: "body a", tags: [] },
              { path: "Atoms/B.md", title: "B", body: "body b", tags: [] },
            ]);

            const first = await backfillExpandForEmail(store, email, {
              limit: 50,
            });

            assert.equal(first.ok, true);
            assert.equal(first.queued, 2);
            // Nothing can have been expanded: upstream has not answered yet.
            assert.equal(first.expanded, 0);
            assert.equal(Number(await store.mirrorExpandCoverage(email)), 0);

            // The same rows are still listed as missing until the pool writes
            // back. Re-queueing them here is what paid Anthropic twice.
            const second = await backfillExpandForEmail(store, email, {
              limit: 50,
            });
            assert.equal(second.queued, 0);
          },
        );
      });
    });
  }

  it("upstream was actually called (the gate is not just a no-op)", () => {
    assert.ok(fetchCalls > 0);
  });
});
