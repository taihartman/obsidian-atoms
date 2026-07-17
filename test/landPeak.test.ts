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
  });
});

describe("formatLandBody", () => {
  it("markers-only when no atoms", () => {
    expect(formatLandBody("process", 0, 3)).toMatch(/3 markers/);
    expect(formatLandBody("process", 0, 1)).toMatch(/1 marker/);
  });

  it("update body", () => {
    expect(formatLandBody("update", 2)).toMatch(/Bodies unchanged/);
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
