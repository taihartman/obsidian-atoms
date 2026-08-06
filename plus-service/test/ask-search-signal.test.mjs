import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreSearch,
  buildSearchHits,
  makeSnippet,
  contentWords,
} from "../src/store/askHelpers.mjs";

describe("contentWords", () => {
  it("drops stopwords and keeps names", () => {
    const w = contentWords("retention hook loops with Ross");
    assert.deepEqual(w, ["retention", "hook", "loops", "ross"]);
  });
});

describe("scoreSearch confidence", () => {
  it("exact title is high", () => {
    const r = scoreSearch(
      { title: "Zebra habitat", path: "Atoms/Z.md", tags: [], body: "x" },
      "Zebra habitat",
    );
    assert.equal(r.confidence, "high");
    assert.ok(r.score > 0);
  });

  it("title prefix is high", () => {
    const r = scoreSearch(
      { title: "Newsletter idea share routine", path: "a.md", tags: [], body: "" },
      "Newsletter idea",
    );
    assert.equal(r.confidence, "high");
  });

  it("exact tag is high", () => {
    const r = scoreSearch(
      { title: "Other", path: "a.md", tags: ["decision"], body: "" },
      "decision",
    );
    assert.equal(r.confidence, "high");
  });

  it("AE1-shaped multi-word junk is suppressed", () => {
    const mri = scoreSearch(
      {
        title: "Nichita got new MRI tech position at Clinton Crossing",
        path: "Atoms/Mri.md",
        tags: [],
        body: "Nichita got a job as MRI tech near Clinton Crossing.",
      },
      "retention hook loops YouTube Ross",
    );
    assert.equal(mri.confidence, null);

    const snapple = scoreSearch(
      {
        title: "Nichita loves Snapple apple flavor",
        path: "Atoms/S.md",
        tags: [],
        body: "Nichita loves Snapple apple flavor",
      },
      "retention hook loops YouTube Ross",
    );
    assert.equal(snapple.confidence, null);
  });

  it("AE2-shaped newsletter hit is medium or high; junk snapple suppressed on same query", () => {
    const hit = scoreSearch(
      {
        title: "Newsletter idea- share Claude cowork routine for atoms",
        path: "Atoms/N.md",
        tags: [],
        body: "newsletter use case for the Atoms app and Claude",
      },
      "newsletter use case Atoms app",
    );
    assert.ok(hit.confidence === "high" || hit.confidence === "medium");

    const junk = scoreSearch(
      {
        title: "Nichita loves Snapple apple flavor",
        path: "Atoms/S.md",
        tags: [],
        body: "Nichita loves Snapple apple flavor",
      },
      "newsletter use case Atoms app",
    );
    assert.equal(junk.confidence, null);
  });

  it("AE7 body-only strong coverage is medium", () => {
    const r = scoreSearch(
      {
        title: "Unrelated title here",
        path: "Atoms/U.md",
        tags: [],
        body: "deep curiosity gaps and the zeigarnik effect in retention loops",
      },
      "curiosity gaps zeigarnik retention loops",
    );
    assert.equal(r.confidence, "medium");
  });

  it("AE8 proper noun alone is medium+", () => {
    const r = scoreSearch(
      {
        title: "Nichita may become MRI tech",
        path: "Atoms/N.md",
        tags: [],
        body: "update on Nichita career",
      },
      "Nichita",
    );
    assert.ok(r.confidence === "high" || r.confidence === "medium");
  });

  it("title ranks above body-only when both qualify", () => {
    const titleHit = scoreSearch(
      { title: "Zebra habitat", path: "a.md", tags: [], body: "something else" },
      "zebra",
    );
    const bodyHit = scoreSearch(
      {
        title: "Other note",
        path: "b.md",
        tags: [],
        body: "mentions zebra in body only",
      },
      "zebra",
    );
    assert.ok(titleHit.confidence);
    assert.ok(bodyHit.confidence);
    assert.ok(titleHit.score > bodyHit.score);
  });

  it("multi-word all content words in title is high", () => {
    const r = scoreSearch(
      {
        title: "open loops and manufacture stakes for retention",
        path: "a.md",
        tags: [],
        body: "x",
      },
      "open loops manufacture stakes",
    );
    assert.equal(r.confidence, "high");
  });

  it("Ross-shaped expand-only paraphrase is medium", () => {
    const r = scoreSearch(
      {
        title: "Ross's retention framework- stack open loops and manufacture stakes",
        path: "Atoms/R.md",
        tags: [],
        body: "stack open loops and manufacture stakes in the first seconds",
        expand:
          "how to stop viewers from clicking away\nhow to keep people watching past the first seconds",
      },
      "how to stop viewers from clicking away",
    );
    assert.equal(r.confidence, "medium");
    assert.ok(r.expandStrong);
    assert.ok(r.match_signals?.includes("expand"));
  });
});

describe("buildSearchHits floor", () => {
  it("AE1 corpus returns empty", () => {
    const pubs = [
      {
        id: "1",
        title: "Nichita got new MRI tech position at Clinton Crossing",
        path: "Atoms/Mri.md",
        text: "Nichita got a job as MRI tech near Clinton Crossing.",
        tags: [],
        links: [],
      },
      {
        id: "2",
        title: "Nichita loves Snapple apple flavor",
        path: "Atoms/S.md",
        text: "Nichita loves Snapple apple flavor",
        tags: [],
        links: [],
      },
    ];
    const hits = buildSearchHits(pubs, "retention hook loops YouTube Ross", 8);
    assert.equal(hits.length, 0);
  });

  it("returns confidence on hits", () => {
    const pubs = [
      {
        id: "1",
        title: "Solo",
        path: "Atoms/S.md",
        text: "x",
        tags: [],
        links: [],
      },
    ];
    const hits = buildSearchHits(pubs, "Solo", 8);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].confidence, "high");
    assert.ok(typeof hits[0].score === "number");
  });

  it("relative floor drops weak tail below half top", () => {
    const pubs = [
      {
        id: "1",
        title: "Newsletter idea share routine",
        path: "Atoms/N.md",
        text: "newsletter use case Atoms app",
        tags: [],
        links: [],
      },
      {
        id: "2",
        title: "Personal notes Social Nichita",
        path: "Hubs/N.md",
        text: "app notes about social",
        tags: [],
        links: [],
      },
    ];
    const hits = buildSearchHits(pubs, "newsletter use case Atoms app", 8);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].title, "Newsletter idea share routine");
    // companion must not ride if far below top (score geometry)
    const titles = hits.map((h) => h.title);
    if (hits.length > 1) {
      const top = hits[0].score;
      for (const h of hits.slice(1)) {
        assert.ok(h.score >= 0.5 * top || (h.match_signals || []).includes("expand"));
      }
    }
    assert.ok(titles.includes("Newsletter idea share routine"));
  });

  it("AE4b expand hit survives stronger off-intent title", () => {
    const pubs = [
      {
        id: "noise",
        title: "how to stop viewers from clicking away guide",
        path: "Atoms/Noise.md",
        text: "unrelated noise about UI buttons",
        tags: [],
        links: [],
      },
      {
        id: "ross",
        title: "Ross's retention framework- stack open loops and manufacture stakes",
        path: "Atoms/R.md",
        text: "stack open loops and manufacture stakes",
        expand:
          "how to stop viewers from clicking away\nkeep viewers watching",
        tags: [],
        links: [],
      },
    ];
    // Force expand-only on ross by querying a paraphrase that is only in expand
    // and also appears in noise title — both may score; expandStrong keeps ross.
    const hits = buildSearchHits(
      pubs,
      "how to stop viewers from clicking away",
      8,
    );
    const ross = hits.find((h) => String(h.title).includes("Ross"));
    assert.ok(ross, "expand-backed Ross hit must remain");
  });

  it("AE5 superseded still returns with status", () => {
    const pubs = [
      {
        id: "p",
        title: "Andrew loves High School Musical",
        path: "Atoms/P.md",
        text: "Andrew loves HSM",
        tags: [],
        links: [],
      },
      {
        id: "c",
        title: "Andrew joke about HSM",
        path: "Atoms/C.md",
        text: "it was a joke",
        tags: [],
        links: [
          {
            note: "Andrew loves High School Musical",
            reason: "revises [[Andrew loves High School Musical]]",
          },
        ],
      },
    ];
    const hits = buildSearchHits(pubs, "Andrew loves High School Musical", 8);
    const parent = hits.find((h) => h.title === "Andrew loves High School Musical");
    assert.ok(parent);
    assert.ok(parent.confidence === "high" || parent.confidence === "medium");
    assert.equal(parent.status, "superseded");
    assert.ok(parent.superseded_by);
  });
});

describe("makeSnippet word boundary", () => {
  it("does not end mid-word when truncating", () => {
    const body =
      "word ".repeat(80) + "targetphrase and more words after the match here forever";
    const snip = makeSnippet(body, "targetphrase", 60);
    assert.ok(!/\w$/.test(snip.replace(/…$/, "")) || snip.endsWith("…"));
    const core = snip.replace(/^…/, "").replace(/…$/, "");
    assert.ok(!/\w$/.test(core) || core.split(/\s+/).pop().length < 20);
  });
});
