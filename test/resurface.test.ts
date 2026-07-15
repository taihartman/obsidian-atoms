import { describe, expect, it } from "vitest";
import {
  calendarDateToday,
  cueLabel,
  formatCueDate,
  isOnThisDayMatch,
  isThrottled,
  listConnectedCandidates,
  listOnThisDayCandidates,
  listQuietCandidates,
  listResurfaceCandidates,
  markResurfaceShown,
  monthDayKey,
  pickResurface,
  type IndexedAtom,
} from "../src/resurface";

const atom = (opts: {
  created: string;
  source?: string;
  body: string;
  links?: string;
}) => `---
created: ${opts.created}
source: "[[${opts.source ?? opts.created.slice(0, 10)}]]"
generated-by: linker
tags: []
---
${opts.body}${opts.links ? `\n\n${opts.links}` : ""}
`;

describe("monthDayKey / isOnThisDayMatch", () => {
  it("matches anniversary, not today", () => {
    expect(monthDayKey("2024-07-15")).toBe("07-15");
    expect(isOnThisDayMatch("2024-07-15", "2026-07-15")).toBe(true);
    expect(isOnThisDayMatch("2026-07-15", "2026-07-15")).toBe(false);
    expect(isOnThisDayMatch("2024-07-14", "2026-07-15")).toBe(false);
  });
});

describe("listOnThisDayCandidates", () => {
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
  ];

  it("lists only on-this-day", () => {
    const list = listOnThisDayCandidates(files, today, "Atoms");
    expect(list.map((c) => c.path)).toEqual(["Atoms/Past Lives.md"]);
    expect(list[0]!.cue).toBe("on-this-day");
  });
});

describe("connected + quiet + priority", () => {
  const indexed: IndexedAtom[] = [
    {
      path: "Atoms/Recent.md",
      title: "Recent",
      bodySnippet: "just filed",
      matchDate: "2026-07-14",
      mtime: 1_000_000,
      linkChips: ["Nichita"],
      content: "",
    },
    {
      path: "Atoms/About Nichita.md",
      title: "About Nichita",
      bodySnippet: "she likes teal",
      matchDate: "2026-01-01",
      mtime: 500_000,
      linkChips: ["Nichita"],
      content: "",
    },
    {
      path: "Atoms/Ancient.md",
      title: "Ancient",
      bodySnippet: "old thought",
      matchDate: "2020-01-01",
      mtime: 1_000,
      linkChips: [],
      content: "",
    },
  ];

  it("connected shares link chip with recent seed", () => {
    const seeds = new Set(["Atoms/Recent.md"]);
    const c = listConnectedCandidates(indexed, seeds);
    expect(c.map((x) => x.path)).toContain("Atoms/About Nichita.md");
    expect(c[0]!.cue).toBe("connected");
  });

  it("quiet prefers aged mtime", () => {
    const now = 1_000_000 + 20 * 24 * 60 * 60 * 1000;
    const q = listQuietCandidates(indexed, {
      now,
      minAgeDays: 14,
      recentSeedPaths: new Set(["Atoms/Recent.md"]),
    });
    expect(q.map((x) => x.path)).toContain("Atoms/Ancient.md");
    expect(q.every((x) => x.cue === "quiet")).toBe(true);
  });

  it("listResurfaceCandidates prioritizes on-this-day first", () => {
    const today = "2026-07-15";
    const files = [
      {
        path: "Atoms/Anniversary.md",
        content: atom({
          created: "2024-07-15",
          source: "2024-07-15",
          body: "year ago thought",
        }),
        mtime: 100,
      },
      {
        path: "Atoms/Recent.md",
        content: atom({
          created: "2026-07-14",
          body: "related to [[Nichita]]",
          links: "about [[Nichita]]",
        }),
        mtime: Date.now(),
      },
      {
        path: "Atoms/About Nichita.md",
        content: atom({
          created: "2025-01-01",
          body: "Nichita fact",
          links: "about [[Nichita]]",
        }),
        mtime: 200,
      },
      {
        path: "Atoms/Old quiet.md",
        content: atom({
          created: "2020-03-01",
          body: "dusty claim",
        }),
        mtime: 50,
      },
    ];
    const list = listResurfaceCandidates(files, today, "Atoms", {
      now: Date.now(),
    });
    expect(list[0]!.path).toBe("Atoms/Anniversary.md");
    expect(list[0]!.cue).toBe("on-this-day");
    expect(list.some((c) => c.cue === "connected")).toBe(true);
    expect(list.some((c) => c.cue === "quiet")).toBe(true);
  });
});

describe("throttle + pick", () => {
  it("skips throttled and session skip", () => {
    const cands = [
      {
        path: "Atoms/A.md",
        title: "A",
        bodySnippet: "a",
        matchDate: "2024-01-01",
        cue: "quiet" as const,
      },
      {
        path: "Atoms/B.md",
        title: "B",
        bodySnippet: "b",
        matchDate: "2024-01-02",
        cue: "quiet" as const,
      },
    ];
    const now = Date.now();
    let th = markResurfaceShown("Atoms/A.md", {}, now);
    expect(isThrottled("Atoms/A.md", th, now)).toBe(true);
    expect(pickResurface(cands, [], th, now)?.path).toBe("Atoms/B.md");
    expect(pickResurface(cands, ["Atoms/B.md"], th, now)).toBeNull();
  });
});

describe("calendarDateToday", () => {
  it("formats local date", () => {
    const d = new Date(2026, 6, 15);
    expect(calendarDateToday(d)).toBe("2026-07-15");
  });
});

describe("copy helpers", () => {
  it("human dates and calm cue labels", () => {
    expect(formatCueDate("2024-07-15")).toBe("Jul 15, 2024");
    expect(cueLabel("quiet")).toBe("Worth meeting again");
    expect(cueLabel("connected")).toMatch(/recent/i);
  });
});
