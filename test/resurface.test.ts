import { describe, expect, it } from "vitest";
import {
  calendarDateToday,
  calendarDayDelta,
  citatorLinesForAtom,
  claimBodyForDisplay,
  connectedKicker,
  cueLabel,
  extractSupersessionEdges,
  formatCueDate,
  isOnThisDayMatch,
  isThrottled,
  listConnectedCandidates,
  listMindChangeCandidates,
  listOnThisDayCandidates,
  listQuietCandidates,
  listResurfaceCandidates,
  markResurfaceShown,
  mindChangeAlreadyShownToday,
  mindChangeConnectorLabel,
  mindChangeHeroLaterLine,
  mindChangeHeroLaterLineParts,
  mindChangePairKey,
  monthDayKey,
  pickResurface,
  type IndexedAtom,
} from "../src/resurface/resurface";

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
      linkChips: ["Alex"],
      content: "",
    },
    {
      path: "Atoms/About Alex.md",
      title: "About Alex",
      bodySnippet: "she likes teal",
      matchDate: "2026-01-01",
      mtime: 500_000,
      linkChips: ["Alex"],
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

  it("connected shares non-soft chip with recent seed and names it", () => {
    const seeds = new Set(["Atoms/Recent.md"]);
    const c = listConnectedCandidates(indexed, seeds);
    expect(c.map((x) => x.path)).toContain("Atoms/About Alex.md");
    expect(c[0]!.cue).toBe("connected");
    expect(c[0]!.connectedVia).toBe("Alex");
    expect(c[0]!.connectedSeedTitle).toBe("Recent");
  });

  it("People-only share does not create connected", () => {
    const peopleOnly: IndexedAtom[] = [
      {
        path: "Atoms/New.md",
        title: "New",
        bodySnippet: "x",
        matchDate: "2026-07-14",
        mtime: 1_000_000,
        linkChips: ["People"],
        content: "",
      },
      {
        path: "Atoms/Old.md",
        title: "Old",
        bodySnippet: "y",
        matchDate: "2026-01-01",
        mtime: 500_000,
        linkChips: ["People"],
        content: "",
      },
    ];
    const c = listConnectedCandidates(peopleOnly, new Set(["Atoms/New.md"]));
    expect(c).toHaveLength(0);
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
          body: "related to [[Alex]]",
          links: "about [[Alex]]",
        }),
        mtime: Date.now(),
      },
      {
        path: "Atoms/About Alex.md",
        content: atom({
          created: "2025-01-01",
          body: "Alex fact",
          links: "about [[Alex]]",
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
    // Opaque "Related to something recent" must never ship as connected kicker.
    expect(cueLabel("connected")).not.toMatch(/something recent/i);
  });
});

describe("supersession edges + mind-change", () => {
  it("extracts revises wikilink from link prose", () => {
    const edges = extractSupersessionEdges(
      atom({
        created: "2026-07-10",
        body: "New take on sleep.",
        links: "revises [[Sleep debt doesn't stack]].",
      }),
    );
    expect(edges).toEqual([
      {
        peerTitle: "Sleep debt doesn't stack",
        relation: "revises",
        direction: "outbound",
      },
    ]);
  });

  it("ignores relates-only links", () => {
    const edges = extractSupersessionEdges(
      atom({
        created: "2026-07-10",
        body: "x",
        links: "relates because [[Other]].",
      }),
    );
    expect(edges).toEqual([]);
  });

  it("lists mind-change with old body primary", () => {
    const older: IndexedAtom = {
      path: "Atoms/Old claim.md",
      title: "Old claim",
      bodySnippet: "I used to think X",
      matchDate: "2026-01-01",
      mtime: 100,
      linkChips: [],
      content: atom({ created: "2026-01-01", body: "I used to think X" }),
    };
    const newer: IndexedAtom = {
      path: "Atoms/New claim.md",
      title: "New claim",
      bodySnippet: "Now Y",
      matchDate: "2026-07-01",
      mtime: 200,
      linkChips: ["Old claim"],
      content: atom({
        created: "2026-07-01",
        body: "Now Y",
        links: "revises [[Old claim]].",
      }),
    };
    const list = listMindChangeCandidates([older, newer], "Atoms");
    expect(list).toHaveLength(1);
    expect(list[0]!.cue).toBe("mind-change");
    expect(list[0]!.path).toBe("Atoms/Old claim.md");
    expect(list[0]!.bodySnippet).toBe("I used to think X");
    expect(list[0]!.laterTitle).toBe("New claim");
    expect(list[0]!.laterPath).toBe("Atoms/New claim.md");
    expect(list[0]!.laterMatchDate).toBe("2026-07-01");
  });

  it("prioritizes mind-change above on-this-day", () => {
    const files = [
      {
        path: "Atoms/Old claim.md",
        content: atom({
          created: "2024-07-15",
          source: "2024-07-15",
          body: "old belief body here",
        }),
        mtime: 50,
      },
      {
        path: "Atoms/New claim.md",
        content: atom({
          created: "2026-07-01",
          body: "updated",
          links: "revises [[Old claim]].",
        }),
        mtime: 200,
      },
      {
        path: "Atoms/Past Lives.md",
        content: atom({
          created: "2024-07-15",
          source: "2024-07-15",
          body: "anniversary memory",
        }),
        mtime: 80,
      },
    ];
    const list = listResurfaceCandidates(files, "2026-07-15", "Atoms");
    expect(list[0]!.cue).toBe("mind-change");
    expect(list[0]!.path).toBe("Atoms/Old claim.md");
  });

  it("pickResurface skips mind-change after day cap", () => {
    const cands = [
      {
        path: "Atoms/Old.md",
        title: "Old",
        bodySnippet: "x",
        matchDate: "",
        cue: "mind-change" as const,
        laterPath: "Atoms/New.md",
        laterTitle: "New",
        relation: "revises" as const,
      },
      {
        path: "Atoms/Other.md",
        title: "Other",
        bodySnippet: "y",
        matchDate: "2024-07-15",
        cue: "on-this-day" as const,
      },
    ];
    expect(
      pickResurface(cands, [], {}, Date.now(), 7, {
        mindChangeDayShown: "2026-07-16",
        todayYmd: "2026-07-16",
      })?.cue,
    ).toBe("on-this-day");
    expect(mindChangeAlreadyShownToday("2026-07-16", "2026-07-16")).toBe(true);
    expect(mindChangePairKey("b", "a")).toBe("a::b");
  });
});

describe("cueLabel mind-change", () => {
  it("labels mind change calmly", () => {
    expect(cueLabel("mind-change")).toBe("Mind change");
  });
});

describe("mind-change pair throttle + contradicts", () => {
  it("extracts contradicts", () => {
    const edges = extractSupersessionEdges(
      atom({
        created: "2026-07-10",
        body: "No.",
        links: "contradicts [[Earlier claim]].",
      }),
    );
    expect(edges[0]).toMatchObject({
      peerTitle: "Earlier claim",
      relation: "contradicts",
    });
  });

  it("pickResurface skips mind-change when pair is throttled", () => {
    const cands = [
      {
        path: "Atoms/Old.md",
        title: "Old",
        bodySnippet: "x",
        matchDate: "",
        cue: "mind-change" as const,
        laterPath: "Atoms/New.md",
        laterTitle: "New",
        relation: "revises" as const,
      },
      {
        path: "Atoms/Quiet.md",
        title: "Quiet",
        bodySnippet: "z",
        matchDate: "",
        cue: "quiet" as const,
      },
    ];
    const pk = mindChangePairKey("Atoms/Old.md", "Atoms/New.md");
    const pairThrottle = { [pk]: Date.now() };
    expect(
      pickResurface(cands, [], {}, Date.now(), 7, {
        todayYmd: "2026-07-16",
        mindChangeDayShown: null,
        pairThrottle,
      })?.cue,
    ).toBe("quiet");
  });
});

describe("mind-change v2 copy helpers", () => {
  it("calendarDayDelta counts whole calendar days", () => {
    expect(calendarDayDelta("2026-01-01", "2026-01-13")).toBe(12);
    expect(calendarDayDelta("2026-01-01", "2026-01-02")).toBe(1);
    expect(calendarDayDelta("bad", "2026-01-02")).toBeNull();
    expect(calendarDayDelta("2026-01-01", "")).toBeNull();
  });

  it("mindChangeHeroLaterLine uses day delta when known", () => {
    expect(
      mindChangeHeroLaterLine({
        laterTitle: "Sleep debt doesn't stack",
        relation: "revises",
        dayDelta: 12,
      }),
    ).toBe(
      "Twelve days later you revised this: Sleep debt doesn't stack",
    );
    expect(
      mindChangeHeroLaterLine({
        laterTitle: "No",
        relation: "contradicts",
        dayDelta: 1,
      }),
    ).toBe("One day later you contradicted this: No");
  });

  it("mindChangeHeroLaterLine falls back without inventing days", () => {
    expect(
      mindChangeHeroLaterLine({
        laterTitle: "New claim",
        relation: "revises",
        dayDelta: null,
      }),
    ).toBe("Later you revised this: New claim");
    expect(
      mindChangeHeroLaterLine({
        laterTitle: "New claim",
        relation: "contradicts",
      }),
    ).toBe("Later you contradicted this: New claim");
  });

  it("never emits em dash or relates in hero later line", () => {
    const line = mindChangeHeroLaterLine({
      laterTitle: "X",
      relation: "revises",
      dayDelta: 5,
    });
    expect(line).not.toContain("—");
    expect(line).not.toContain("relates");
    expect(line).not.toContain("·");
  });

  it("mindChangeHeroLaterLineParts keeps titles with colons intact", () => {
    const parts = mindChangeHeroLaterLineParts({
      laterTitle: "Sleep: debt stacks",
      relation: "revises",
      dayDelta: 3,
    });
    expect(parts.prefix).toBe("Three days later you revised this");
    expect(parts.title).toBe("Sleep: debt stacks");
    expect(mindChangeHeroLaterLine({
      laterTitle: "Sleep: debt stacks",
      relation: "revises",
      dayDelta: 3,
    })).toBe("Three days later you revised this: Sleep: debt stacks");
  });

  it("mindChangeConnectorLabel is lowercase chrome", () => {
    expect(mindChangeConnectorLabel("revises")).toBe("revised by");
    expect(mindChangeConnectorLabel("contradicts")).toBe("contradicted by");
  });

  it("citatorLinesForAtom returns hard edges only", () => {
    const older: IndexedAtom = {
      path: "Atoms/Old claim.md",
      title: "Old claim",
      bodySnippet: "I used to think X",
      matchDate: "2026-01-01",
      mtime: 100,
      linkChips: [],
      content: atom({ created: "2026-01-01", body: "I used to think X" }),
    };
    const newer: IndexedAtom = {
      path: "Atoms/New claim.md",
      title: "New claim",
      bodySnippet: "Now Y",
      matchDate: "2026-07-01",
      mtime: 200,
      linkChips: ["Old claim"],
      content: atom({
        created: "2026-07-01",
        body: "Now Y",
        links: "revises [[Old claim]].",
      }),
    };
    const out = citatorLinesForAtom(newer, [older, newer]);
    expect(out).toEqual([
      {
        relationLabel: "revises",
        peerTitle: "Old claim",
        peerPath: "Atoms/Old claim.md",
        direction: "out",
      },
    ]);
    const inbound = citatorLinesForAtom(older, [older, newer]);
    expect(inbound).toEqual([
      {
        relationLabel: "revised by",
        peerTitle: "New claim",
        peerPath: "Atoms/New claim.md",
        direction: "in",
      },
    ]);
  });
});

describe("claimBodyForDisplay", () => {
  it("strips trailing revises/contradicts edge lines for claim quotes only", () => {
    expect(
      claimBodyForDisplay("Now I believe Y.\n\nrevises [[Old claim]]."),
    ).toBe("Now I believe Y.");
    expect(
      claimBodyForDisplay("Still true.\n\ncontradicts [[Earlier]]."),
    ).toBe("Still true.");
    expect(claimBodyForDisplay("[[Old claim]] revises.")).toBe("…");
  });

  it("keeps real claim text that merely mentions revises without a wikilink edge", () => {
    expect(
      claimBodyForDisplay("I revises nothing here, just a sentence."),
    ).toBe("I revises nothing here, just a sentence.");
  });

  it("keeps claim prose that includes an edge mid-line with other words", () => {
    expect(
      claimBodyForDisplay("[[Old claim]] revises this thought entirely."),
    ).toBe("[[Old claim]] revises this thought entirely.");
  });

  it("does not invent content when body is only an edge line", () => {
    expect(claimBodyForDisplay("revises [[Old claim]].")).toBe("…");
  });
});
