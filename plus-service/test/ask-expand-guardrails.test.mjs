/**
 * #339 review fixes — the three guardrails around search expansion.
 *
 * F1: the backfill must not hold its caller's HTTP request open while it makes
 *     one model call per row (a 200-atom first sync 502'd on Fly's proxy).
 * F2: a barely-expanded index must not advertise `retrieval: lexical_expanded`
 *     (KTD1/R22 — "do not emit it solely because the column exists").
 * F3: body-plaintext egress never happens by accident. As of #340 the flag is
 *     on by default (the disclosure now names this egress and every device
 *     re-prompts), so what is pinned here is the pair of gates that outlived
 *     the default: an operator can still turn it off, and a deployment with no
 *     Anthropic key is inert regardless.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  backfillExpandForEmail,
  generateExpandPhrases,
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

describe("F3 — body plaintext egress never happens by accident", () => {
  // #340 flipped this default to on. The old assertion (off when unset) was the
  // guard while the shipped disclosure did not name body egress; that is no
  // longer true, so re-pinning it here would only pin a stale fact. What has to
  // stay true is that an operator keeps a working off switch.
  it("is on by default now that the disclosure names this egress", () => {
    withEnv({ ASK_EXPAND_ENABLED: undefined }, () => {
      assert.equal(config.askExpandEnabled, true);
    });
  });

  it("an operator can still turn it off, and only 0 does it", () => {
    withEnv({ ASK_EXPAND_ENABLED: "0" }, () => {
      assert.equal(config.askExpandEnabled, false);
    });
    withEnv({ ASK_EXPAND_ENABLED: "1" }, () => {
      assert.equal(config.askExpandEnabled, true);
    });
  });

  // The second gate, and the one the flag default cannot reach: a deployment
  // that never configured a key sends nothing, however the flag reads.
  it("sends nothing when the deployment has no Anthropic key", async () => {
    let fetched = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetched = true;
      return { ok: false, status: 500 };
    };
    try {
      await withEnv(
        { ASK_EXPAND_ENABLED: "1", ANTHROPIC_API_KEY: undefined },
        async () => {
          const out = await generateExpandPhrases({
            title: "A",
            tags: [],
            body: "body plaintext that must not leave",
          });
          assert.equal(out.ok, false);
          assert.equal(out.reason, "no_key");
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(fetched, false, "no key must mean no request at all");
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

// Regression: the request once carried `temperature: 0`. Current Claude
// models (Sonnet 5 and later) reject sampling parameters with a 400, so
// every expand call failed upstream and the pool logged ok=0 with
// hundreds of upstream_400 (prod, 2026-09-02). The prompt asks for a
// deterministic list; the model does that without a sampling knob.
describe("ask expand request shape", () => {
  it("sends no sampling parameters to the Messages API", async () => {
    let body = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify([
                "how to set up the reverse proxy",
                "reverse proxy config for staging",
              ]),
            },
          ],
        }),
      };
    };
    try {
      await withEnv(
        { ASK_EXPAND_ENABLED: "1", ANTHROPIC_API_KEY: "sk-test" },
        async () => {
          const out = await generateExpandPhrases({
            title: "A",
            tags: [],
            body: "some body",
          });
          assert.equal(out.ok, true);
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(body, "request must be sent");
    for (const k of ["temperature", "top_p", "top_k"]) {
      assert.equal(k in body, false, `${k} must not be sent`);
    }
    assert.ok(body.max_tokens >= 400, "max_tokens must leave room for output");
  });
});
