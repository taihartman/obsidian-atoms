import { describe, expect, it } from "vitest";
import {
  atomMemoryDay,
  bodySnippet,
  calendarDateToday,
  candidateFromAtomFile,
  isOnThisDayMatch,
  listOnThisDayCandidates,
  monthDayKey,
  pickResurface,
} from "../src/resurface";

const atom = (opts: {
  created: string;
  source?: string;
  body: string;
  title?: string;
}) => `---
created: ${opts.created}
source: "[[${opts.source ?? opts.created.slice(0, 10)}]]"
generated-by: linker
tags: []
---
${opts.body}
`;

describe("monthDayKey / isOnThisDayMatch", () => {
  it("matches anniversary, not today", () => {
    expect(monthDayKey("2024-07-15")).toBe("07-15");
    expect(isOnThisDayMatch("2024-07-15", "2026-07-15")).toBe(true);
    expect(isOnThisDayMatch("2026-07-15", "2026-07-15")).toBe(false);
    expect(isOnThisDayMatch("2024-07-14", "2026-07-15")).toBe(false);
  });
});

describe("atomMemoryDay", () => {
  it("prefers source date", () => {
    const c = atom({
      created: "2020-01-01",
      source: "2024-07-15",
      body: "hello",
    });
    expect(atomMemoryDay(c)).toBe("2024-07-15");
  });
});

describe("bodySnippet", () => {
  it("takes first line and truncates", () => {
    expect(bodySnippet("line one\nline two")).toBe("line one");
    expect(bodySnippet("a".repeat(200)).length).toBeLessThanOrEqual(140);
  });
});

describe("list / pick", () => {
  const today = "2026-07-15";
  const files = [
    {
      path: "Atoms/Past Lives.md",
      content: atom({
        created: "2024-07-15",
        source: "2024-07-15",
        body: "watch Past Lives after dinner",
      }),
    },
    {
      path: "Atoms/Today only.md",
      content: atom({
        created: "2026-07-15",
        source: "2026-07-15",
        body: "just captured",
      }),
    },
    {
      path: "Atoms/Other day.md",
      content: atom({
        created: "2024-03-01",
        source: "2024-03-01",
        body: "wrong day",
      }),
    },
    {
      path: "Notes/Manual.md",
      content: atom({
        created: "2024-07-15",
        body: "not generated properly",
      }).replace("generated-by: linker", "tags: []"),
    },
  ];

  it("lists only on-this-day generated atoms", () => {
    const list = listOnThisDayCandidates(files, today, "Atoms");
    expect(list.map((c) => c.path)).toEqual(["Atoms/Past Lives.md"]);
    expect(list[0]!.bodySnippet).toContain("Past Lives");
    expect(list[0]!.cue).toBe("on-this-day");
  });

  it("pick respects skip set", () => {
    const list = listOnThisDayCandidates(files, today, "Atoms");
    expect(pickResurface(list, [])?.path).toBe("Atoms/Past Lives.md");
    expect(pickResurface(list, ["Atoms/Past Lives.md"])).toBeNull();
  });

  it("candidateFromAtomFile rejects non-folder", () => {
    expect(
      candidateFromAtomFile(
        "Other/Past Lives.md",
        files[0]!.content,
        today,
        "Atoms",
      ),
    ).toBeNull();
  });
});

describe("calendarDateToday", () => {
  it("formats local date", () => {
    const d = new Date(2026, 6, 15); // month 0-indexed
    expect(calendarDateToday(d)).toBe("2026-07-15");
  });
});
