import { describe, expect, it } from "vitest";
import {
  buildLandPeak,
  formatLandBody,
  formatLandHeadline,
  landAtomsFromRefreshItems,
  landAtomsFromWriteEntries,
  landDisplayFromPeak,
} from "../src/home/landPeak";

describe("formatLandHeadline", () => {
  it("process 0 / 1 / many", () => {
    expect(formatLandHeadline("process", 0)).toBe("Nothing new filed");
    expect(formatLandHeadline("process", 1)).toBe("Filed 1 note");
    expect(formatLandHeadline("process", 12)).toBe("Filed 12 notes");
  });

  it("update wording", () => {
    expect(formatLandHeadline("update", 0)).toBe("Nothing to update");
    expect(formatLandHeadline("update", 4)).toBe("Updated 4 notes");
    expect(formatLandHeadline("update", 0, 9)).toBe("Couldn't update 9 notes");
    expect(formatLandHeadline("update", 3, 6)).toBe("Updated 3 · 6 failed");
    expect(formatLandHeadline("update", 0, 0, 5)).toBe("Cleaned up 5 notes");
  });
});

describe("formatLandBody", () => {
  it("markers-only when no atoms", () => {
    expect(formatLandBody("process", 0, 3)).toMatch(/3 markers/);
    expect(formatLandBody("process", 0, 1)).toMatch(/1 marker/);
  });

  it("update body", () => {
    expect(formatLandBody("update", 2)).toMatch(/Bodies unchanged/);
    expect(formatLandBody("update", 0, undefined, 9)).toMatch(/model id/);
    expect(formatLandBody("update", 3, undefined, 6)).toMatch(/try Update again/);
    expect(formatLandBody("update", 0, undefined, 0, 4)).toMatch(
      /link wording/i,
    );
  });
});

describe("update failure land peak", () => {
  it("all failed is not Nothing to update", () => {
    const peak = buildLandPeak({
      source: "update",
      atoms: [],
      failedCount: 9,
    });
    const d = landDisplayFromPeak(peak);
    expect(d.headline).toBe("Couldn't update 9 notes");
    expect(d.isFailure).toBe(true);
    expect(d.body).toMatch(/model id/);
  });

  it("polish-only does not say Updated", () => {
    const peak = buildLandPeak({
      source: "update",
      atoms: [{ title: "A", path: "Atoms/A.md" }],
      polishedCount: 5,
      updatedCount: 0,
    });
    const d = landDisplayFromPeak(peak);
    expect(d.headline).toBe("Cleaned up 5 notes");
    expect(d.headline).not.toMatch(/Updated/i);
    expect(d.body).toMatch(/link wording/i);
  });
});

describe("landDisplayFromPeak", () => {
  it("caps titles at 3 with moreCount", () => {
    const atoms = Array.from({ length: 12 }, (_, i) => ({
      title: `Note ${i + 1}`,
      path: `Atoms/Note ${i + 1}.md`,
    }));
    const peak = buildLandPeak({ source: "process", atoms });
    const d = landDisplayFromPeak(peak);
    expect(d.rows).toHaveLength(3);
    expect(d.moreCount).toBe(9);
    expect(d.headline).toBe("Filed 12 notes");
  });
});

describe("landAtomsFromWriteEntries", () => {
  it("includes only created atoms", () => {
    const rows = landAtomsFromWriteEntries([
      {
        verdict: "atom",
        title: "A",
        write: { atomCreated: "Atoms/A.md" },
        planned: {
          action: {
            kind: "create_atom",
            path: "Atoms/A.md",
          },
          result: { links: [{ note: "Alex" }] },
        },
      },
      {
        verdict: "atom",
        title: "B",
        write: { atomCreated: null },
        planned: {
          action: {
            kind: "skip_existing_atom",
            path: "Atoms/B.md",
            title: "B",
          },
        },
      },
      {
        verdict: "noise",
        title: "",
        write: { atomCreated: null },
        planned: { action: { kind: "marker_only" } },
      },
    ]);
    expect(rows).toEqual([
      { title: "A", path: "Atoms/A.md", meta: "Linked · Alex" },
    ]);
  });
});

describe("landAtomsFromRefreshItems", () => {
  it("maps update items", () => {
    expect(
      landAtomsFromRefreshItems([
        { title: "Old", path: "Atoms/Old.md" },
      ]),
    ).toEqual([
      { title: "Old", path: "Atoms/Old.md", meta: "Links refreshed" },
    ]);
  });
});
