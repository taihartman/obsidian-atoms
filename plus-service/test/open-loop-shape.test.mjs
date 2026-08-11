import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachLoopFields,
  buildSearchHits,
  openNowFromLoop,
  prepareMirrorRow,
  revisionStatusFor,
  shapeFetchAtom,
  shapeMirrorListItem,
} from "../src/store/askHelpers.mjs";

describe("open loop shapes", () => {
  it("openNowFromLoop requires active and no redeem", () => {
    assert.equal(openNowFromLoop({ state: "active", source: "inferred" }, false), true);
    assert.equal(openNowFromLoop({ state: "active", source: "inferred" }, true), false);
    assert.equal(openNowFromLoop({ state: "not_a_loop", source: "user" }, false), false);
  });

  it("prepareMirrorRow stores loop_json in hash inputs", () => {
    const row = prepareMirrorRow("a@b.co", {
      path: "Atoms/Idea.md",
      title: "Idea",
      body: "I will share later",
      tags: [],
      links: [],
      loop: { state: "active", source: "inferred" },
    });
    assert.equal(row.loopJson, JSON.stringify({ state: "active", source: "inferred" }));
  });

  it("search hits expose open_now; continues does not close", () => {
    const pubs = [
      {
        id: "1",
        title: "Newsletter idea",
        path: "Atoms/Newsletter idea.md",
        kind: "atom",
        tags: ["idea"],
        text: "I will share my cowork routine in the newsletter",
        links: [],
        loop: { state: "active", source: "inferred" },
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
      {
        id: "2",
        title: "Child continue",
        path: "Atoms/Child continue.md",
        kind: "atom",
        tags: [],
        text: "more thoughts",
        links: [{ note: "Newsletter idea", reason: "continues [[Newsletter idea]]" }],
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    ];
    const hits = buildSearchHits(pubs, "newsletter cowork", 8);
    const hit = hits.find((h) => h.title === "Newsletter idea");
    assert.ok(hit);
    assert.equal(hit.open_now, true);
    assert.deepEqual(hit.loop, { state: "active", source: "inferred" });
  });

  it("redeems child makes open_now false on fetch", () => {
    const atom = {
      id: "1",
      title: "Newsletter idea",
      path: "Atoms/Newsletter idea.md",
      kind: "atom",
      tags: [],
      text: "I will share later",
      links: [],
      loop: { state: "active", source: "user" },
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    const neighbors = {
      backlinks: [
        {
          title: "Full routine",
          path: "Atoms/Full routine.md",
          reason: "redeems [[Newsletter idea]]",
          relation: "redeems",
        },
      ],
    };
    const shaped = shapeFetchAtom(atom, neighbors);
    assert.equal(shaped.open_now, false);
    assert.equal(shaped.loop.state, "active");
  });

  it("list item attaches open_now from loop without rev as active-only", () => {
    const item = shapeMirrorListItem({
      id: "1",
      title: "X",
      path: "Atoms/X.md",
      tags: [],
      kind: "atom",
      updatedAt: null,
      created: null,
      loop: { state: "active", source: "inferred" },
    });
    assert.equal(item.open_now, true);
  });
});
