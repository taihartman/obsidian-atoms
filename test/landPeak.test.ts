import { describe, expect, it } from "vitest";
import {
  buildLandPeak,
  formatLandBody,
  formatLandHeadline,
  formatLandSentence,
  formatLandTally,
  landAtomsFromRefreshItems,
  landAtomsFromWriteEntries,
  landDisplayFromPeak,
  pickSpokenLandAtom,
} from "../src/home/landPeak";

function writeAtom(
  title: string,
  opts: {
    created?: string | null;
    links?: Array<{ note?: string; reason?: string }>;
    verdict?: string;
  } = {},
) {
  const created = opts.created === undefined ? `Atoms/${title}.md` : opts.created;
  return {
    verdict: opts.verdict ?? "atom",
    title,
    write: { atomCreated: created },
    planned: {
      action: {
        kind: created ? "create_atom" : "skip_existing_atom",
        path: `Atoms/${title}.md`,
        title,
      },
      result: opts.links ? { links: opts.links } : undefined,
    },
  };
}

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
    expect(formatLandBody("update", 3, undefined, 6)).toMatch(/Try Update again/);
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
  it("process first screen is one featured row, full list stays on peak", () => {
    const atoms = Array.from({ length: 12 }, (_, i) => ({
      title: `Note ${i + 1}`,
      path: `Atoms/Note ${i + 1}.md`,
      links: i === 0 ? [{ note: "Alex", reason: "revises last week" }] : undefined,
    }));
    const peak = buildLandPeak({ source: "process", atoms, skippedCount: 2 });
    const d = landDisplayFromPeak(peak);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]?.title).toBe("Note 1");
    expect(d.moreCount).toBe(0);
    expect(peak.atoms).toHaveLength(12);
    expect(d.headline).toBe("Filed, and linked");
    expect(d.tally).toBe("12 filed · 2 noise");
    expect(d.body).toBe("12 filed · 2 noise");
    expect(d.sentence).toBe("revises last week");
  });

  it("update still caps titles at 3 with moreCount", () => {
    const atoms = Array.from({ length: 12 }, (_, i) => ({
      title: `Note ${i + 1}`,
      path: `Atoms/Note ${i + 1}.md`,
    }));
    const peak = buildLandPeak({ source: "update", atoms, updatedCount: 12 });
    const d = landDisplayFromPeak(peak);
    expect(d.rows).toHaveLength(3);
    expect(d.moreCount).toBe(9);
    expect(d.headline).toBe("Updated 12 notes");
    expect(d.sentence).toBeNull();
  });
});

describe("landAtomsFromWriteEntries", () => {
  it("includes only created atoms and keeps links", () => {
    const rows = landAtomsFromWriteEntries([
      writeAtom("A", { links: [{ note: "Alex", reason: "preference about Alex" }] }),
      writeAtom("B", { created: null }),
      writeAtom("", { verdict: "noise", created: null }),
    ]);
    expect(rows).toEqual([
      {
        title: "A",
        path: "Atoms/A.md",
        links: [{ note: "Alex", reason: "preference about Alex" }],
      },
    ]);
  });
});

describe("spoken land atom", () => {
  it("AE1 reasoned run", () => {
    const atoms = landAtomsFromWriteEntries([
      writeAtom("Ross keeps people watching", {
        links: [
          {
            note: "How to stop viewers from clicking away",
            reason: "revises last week’s click-away note",
          },
        ],
      }),
      writeAtom("Pancake atom, Saturday"),
      writeAtom("Nichita on the balcony"),
      writeAtom("Four"),
      writeAtom("Five"),
      writeAtom("Six"),
    ]);
    const peak = buildLandPeak({
      source: "process",
      atoms,
      skippedCount: 2,
    });
    const d = landDisplayFromPeak(peak);
    expect(d.sentence).toBe("revises last week’s click-away note");
    expect(d.featured?.title).toBe("Ross keeps people watching");
    expect(d.rows).toHaveLength(1);
    expect(d.tally).toBe("6 filed · 2 noise");
  });

  it("unwraps wikilinks so the Done card does not show raw [[brackets]]", () => {
    expect(
      formatLandSentence({
        note: "My car",
        reason: "new reading in the [[My car]] series",
      }),
    ).toBe("new reading in the My car series");
    const atoms = landAtomsFromWriteEntries([
      writeAtom("My car is at 73137 Miles", {
        links: [
          {
            note: "My car",
            reason: "new reading in the [[My car]] series",
          },
        ],
      }),
    ]);
    const d = landDisplayFromPeak(buildLandPeak({ source: "process", atoms }));
    expect(d.sentence).toBe("new reading in the My car series");
    expect(d.sentence).not.toMatch(/\[\[/);
    expect(d.sentenceParts).toEqual([
      { kind: "text", text: "new reading in the " },
      { kind: "link", text: "My car" },
      { kind: "text", text: " series" },
    ]);
  });

  it("uses piped-wikilink alias as the spoken name", () => {
    expect(
      formatLandSentence({
        note: "My car",
        reason: "logged against [[My car|the car]]",
      }),
    ).toBe("logged against the car");
  });

  it("AE2 blank reason uses the note name", () => {
    expect(
      formatLandSentence({ note: "Alex", reason: "" }),
    ).toBe("Alex");
    const atoms = landAtomsFromWriteEntries([
      writeAtom("Solo", { links: [{ note: "Alex", reason: "" }] }),
    ]);
    const d = landDisplayFromPeak(buildLandPeak({ source: "process", atoms }));
    expect(d.sentence).toBe("Alex");
    expect(d.sentenceParts).toEqual([{ kind: "link", text: "Alex" }]);
  });

  it("AE3 sticker reason is still spoken", () => {
    const atoms = landAtomsFromWriteEntries([
      writeAtom("Solo", {
        links: [{ note: "Alex", reason: "preference about Alex" }],
      }),
    ]);
    const d = landDisplayFromPeak(buildLandPeak({ source: "process", atoms }));
    expect(d.sentence).toBe("preference about Alex");
  });

  it("AE4 no links — tally only", () => {
    const atoms = landAtomsFromWriteEntries([
      writeAtom("A"),
      writeAtom("B"),
      writeAtom("C"),
    ]);
    const d = landDisplayFromPeak(
      buildLandPeak({ source: "process", atoms, skippedCount: 1 }),
    );
    expect(d.sentence).toBeNull();
    expect(d.featured).toBeNull();
    expect(d.rows).toHaveLength(0);
    expect(d.tally).toBe("3 filed · 1 noise");
    expect(d.headline).toBe("Filed");
    expect(d.body).not.toMatch(/filed, not linked/i);
  });

  it("prefers a later reasoned atom over an earlier blank-reason link", () => {
    const atoms = landAtomsFromWriteEntries([
      writeAtom("First", { links: [{ note: "Alex", reason: "" }] }),
      writeAtom("Second", {
        links: [{ note: "Ross", reason: "revises the retention note" }],
      }),
    ]);
    expect(pickSpokenLandAtom(atoms)?.title).toBe("Second");
  });

  it("formatLandTally omits a zero skip", () => {
    expect(formatLandTally(6, 0)).toBe("6 filed");
    expect(formatLandTally(6, 2)).toBe("6 filed · 2 noise");
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
