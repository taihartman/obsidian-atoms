import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseExpandResponse,
  buildExpandPrompt,
  expandCoverageOf,
  retrievalModeForCoverage,
} from "../src/ask/expandSearch.mjs";
import { createMemoryStore } from "../src/store/memory.mjs";
import { buildSearchHits } from "../src/store/askHelpers.mjs";

describe("parseExpandResponse", () => {
  it("accepts JSON array", () => {
    const p = parseExpandResponse(
      JSON.stringify([
        "how to keep viewers watching",
        "stop people clicking away early",
      ]),
      {
        title: "Ross retention open loops stakes",
        tags: [],
        bodySlice: "viewers watching first seconds open loops stakes",
      },
    );
    assert.ok(p.length >= 1);
  });

  it("rejects empty garbage", () => {
    assert.deepEqual(parseExpandResponse(""), []);
    assert.deepEqual(parseExpandResponse("short"), []); // < 8 chars
  });

  it("drops only generic fluff templates", () => {
    const p = parseExpandResponse(["how to improve", "what is success"], {
      title: "Zebra habitat",
      bodySlice: "zebras live in savanna",
    });
    assert.equal(p.length, 0);
  });

  it("keeps paraphrase phrases that do not share tokens with the body", () => {
    // Asserted by identity, not by a regex any one survivor could satisfy: an
    // earlier version checked only `length >= 1` plus a loose pattern, so a
    // source-overlap filter could drop the pure paraphrase and still pass.
    // "how to stop viewers from clicking away" shares no >=4-char token with
    // the title or body below — that is exactly what the feature must keep.
    const p = parseExpandResponse(
      [
        "how to stop viewers from clicking away",
        "keep people watching past the first seconds",
      ],
      {
        title: "Ross's retention framework- stack open loops and manufacture stakes",
        bodySlice: "stack open loops and manufacture stakes in the first seconds",
      },
    );
    assert.ok(
      p.includes("how to stop viewers from clicking away"),
      `zero-overlap paraphrase must survive verbatim; got ${JSON.stringify(p)}`,
    );
    assert.deepEqual(p, [
      "how to stop viewers from clicking away",
      "keep people watching past the first seconds",
    ]);
  });
});

describe("buildExpandPrompt", () => {
  it("includes title", () => {
    const s = buildExpandPrompt("Hello", ["tag"], "body text");
    assert.ok(s.includes("Hello"));
    assert.ok(s.includes("body text"));
  });
});

describe("expand coverage helpers", () => {
  it("coverage fraction", () => {
    assert.equal(expandCoverageOf([{ expand: "a" }, {}]), 0.5);
    assert.equal(expandCoverageOf([]), 0);
  });
});

describe("mirror expand soft path", () => {
  it("hash change clears expand; setExpand is hash-conditional", async () => {
    process.env.ASK_EXPAND_ENABLED = "0";
    const store = createMemoryStore();
    const email = "e@ex.co";
    const r1 = store.mirrorUpsert(email, [
      {
        path: "Atoms/A.md",
        title: "Note A",
        body: "body one about open loops",
        tags: [],
      },
    ]);
    assert.equal(r1.upserted, 1);
    assert.ok(r1.needExpand?.length === 1);
    const hash = r1.needExpand[0].contentHash;
    const set = store.mirrorSetExpand(
      email,
      "Atoms/A.md",
      hash,
      "how to stop viewers from clicking away",
    );
    assert.equal(set.updated, 1);
    assert.ok(store.mirrorExpandCoverage(email) > 0);

    const stale = store.mirrorSetExpand(
      email,
      "Atoms/A.md",
      "wrong-hash",
      "should not apply",
    );
    assert.equal(stale.updated, 0);

    const pubs = [
      {
        id: "1",
        title: "Note A",
        path: "Atoms/A.md",
        text: "body one about open loops",
        expand: "how to stop viewers from clicking away",
        tags: [],
        links: [],
      },
    ];
    const hits = buildSearchHits(
      pubs,
      "how to stop viewers from clicking away",
      8,
    );
    assert.equal(hits.length, 1);
    // Two independent claims. As one `&&` these were vacuous: `buildSearchHits`
    // enumerates its fields and never sets `.expand`, so the right conjunct was
    // always undefined and the whole assertion passed without reading the hit.
    assert.ok(
      !JSON.stringify(hits[0]).includes("how to stop"),
      "expand text must not be serialised into a hit",
    );
    assert.equal(hits[0].expand, undefined, "hits carry no expand field");
  });
});
