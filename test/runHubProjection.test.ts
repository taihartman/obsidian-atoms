import { describe, expect, it } from "vitest";
import {
  hubTitlesFromAtomContents,
  planHubProjection,
} from "../src/pipeline/runHubProjection";
import { GENERATED_CLOSE, GENERATED_OPEN } from "../src/pipeline/hubSections";
import {
  normalizeHubSection,
  repairHubSection,
} from "../src/pipeline/classify";
import type { ClassificationResult, VaultContext } from "../src/shared/types";

describe("planHubProjection", () => {
  it("setting off → no writes", () => {
    const plan = planHubProjection({
      enabled: false,
      touchedHubTitles: ["Alex"],
      atoms: [
        {
          title: "A",
          content:
            "---\n---\nbody\n\nabout [[Alex]] (gift).\n",
        },
      ],
      hubs: new Map([
        [
          "alex",
          {
            title: "Alex",
            path: "People/Alex.md",
            content: "# Alex\n",
            sections: ["Gift Ideas"],
          },
        ],
      ]),
    });
    expect(plan.writes).toEqual([]);
  });

  it("projects hard-linked atom into section", () => {
    const hubs = new Map([
      [
        "alex",
        {
          title: "Alex",
          path: "People/Alex.md",
          content: "# Alex\n\nHuman.\n",
          sections: ["Gift Ideas"],
        },
      ],
    ]);
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Alex"],
      atoms: [
        {
          title: "Wants a PC case",
          content: [
            "---",
            'hub-section: "Gift Ideas"',
            "---",
            "body",
            "",
            "gift idea for [[Alex]] from this capture.",
          ].join("\n"),
        },
      ],
      hubs,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.changed).toBe(true);
    expect(plan.writes[0]!.next).toContain("## Gift Ideas");
    expect(plan.writes[0]!.next).toContain("- [[Wants a PC case]]");
    expect(plan.writes[0]!.next).toContain(GENERATED_OPEN);
    expect(plan.writes[0]!.next).toContain(GENERATED_CLOSE);
    expect(plan.writes[0]!.next).toContain("Human.");
  });

  it("damaged hub → error, no write", () => {
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Alex"],
      atoms: [],
      hubs: new Map([
        [
          "alex",
          {
            title: "Alex",
            path: "P/Alex.md",
            content: `# Alex\n${GENERATED_OPEN}\n## X\n`,
            sections: [],
          },
        ],
      ]),
    });
    expect(plan.writes).toEqual([]);
    expect(plan.errors[0]?.reason).toBe("unclosed-generated-block");
  });

  it("idempotent when content unchanged", () => {
    const interior = "## Gift Ideas\n- [[Wants a PC case]]";
    const content = `# Alex\n\n${GENERATED_OPEN}\n${interior}\n${GENERATED_CLOSE}\n`;
    const hubs = new Map([
      [
        "alex",
        {
          title: "Alex",
          path: "P/Alex.md",
          content,
          sections: ["Gift Ideas"],
        },
      ],
    ]);
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Alex"],
      atoms: [
        {
          title: "Wants a PC case",
          content:
            '---\nhub-section: "Gift Ideas"\n---\nb\n\nabout [[Alex]] (x).\n',
        },
      ],
      hubs,
    });
    expect(plan.writes[0]!.changed).toBe(false);
  });
});

describe("hubTitlesFromAtomContents", () => {
  it("finds person hub hard links", () => {
    const titles = hubTitlesFromAtomContents(
      ["---\n---\nx\n\nabout [[Nichita]] (fact).\n"],
      ["Nichita", "Alex"],
    );
    expect(titles).toEqual(["Nichita"]);
  });

  it("finds list hub hard links when title is allowed", () => {
    const titles = hubTitlesFromAtomContents(
      ["---\n---\nx\n\nbelongs with [[Movies]] (watchlist).\n"],
      ["Movies", "Alex"],
    );
    expect(titles).toEqual(["Movies"]);
  });
});

describe("planHubProjection list hubs", () => {
  it("projects Movies when section matches (R3c)", () => {
    const hubs = new Map([
      [
        "movies",
        {
          title: "Movies",
          path: "Movies.md",
          content: "# Movies\n\n## Want to watch\n",
          sections: ["Want to watch", "Watched"],
          kind: "list" as const,
        },
      ],
    ]);
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Movies"],
      atoms: [
        {
          title: "Dune",
          content: [
            "---",
            'hub-section: "Want to watch"',
            "---",
            "want to watch Dune",
            "",
            "belongs with [[Movies]] (watchlist).",
          ].join("\n"),
        },
      ],
      hubs,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.writes[0]!.changed).toBe(true);
    expect(plan.writes[0]!.next).toContain("## Want to watch");
    expect(plan.writes[0]!.next).toContain("- [[Dune]]");
  });

  it("skips non-person single Unsorted without delimiters (R3c)", () => {
    const hubs = new Map([
      [
        "meeting notes",
        {
          title: "Meeting Notes",
          path: "Meeting Notes.md",
          content: "# Meeting Notes\n\n## Agenda\n",
          sections: ["Agenda"],
          kind: "list" as const,
        },
      ],
    ]);
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Meeting Notes"],
      atoms: [
        {
          title: "Accidental",
          content: "---\n---\nx\n\nsee [[Meeting Notes]] (ref).\n",
        },
      ],
      hubs,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.skipReason).toBe("non-person-write-brake");
  });

  it("places shared section name only when that hub has the H2", () => {
    const hubs = new Map([
      [
        "movies",
        {
          title: "Movies",
          path: "Movies.md",
          content: "# M\n\n## Ideas\n",
          sections: ["Ideas"],
          kind: "list" as const,
        },
      ],
      [
        "alex",
        {
          title: "Alex",
          path: "People/Alex.md",
          content: "# A\n\n## Gift Ideas\n",
          sections: ["Gift Ideas"],
          kind: "person" as const,
        },
      ],
    ]);
    const atom = {
      title: "Shared",
      content: [
        "---",
        'hub-section: "Ideas"',
        "---",
        "b",
        "",
        "about [[Movies]] (list) and [[Alex]] (person).",
      ].join("\n"),
    };
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Movies", "Alex"],
      atoms: [atom],
      hubs,
    });
    const movies = plan.writes.find((w) => w.hubTitle === "Movies")!;
    const alex = plan.writes.find((w) => w.hubTitle === "Alex")!;
    expect(movies.next).toContain("## Ideas");
    expect(movies.next).toContain("- [[Shared]]");
    expect(alex.next).toContain("## Unsorted");
    expect(alex.next).toContain("- [[Shared]]");
    expect(alex.next).not.toContain("## Ideas");
  });
});

describe("normalizeHubSection", () => {
  const ctx: VaultContext = {
    titles: [],
    tags: [],
    vocabulary: [],
    personHubs: ["Alex"],
    personHubDetails: [
      {
        canonicalTitle: "Alex",
        matchKeys: ["Alex"],
        sections: ["Gift Ideas"],
      },
    ],
  };

  it("keeps valid section", () => {
    const r: ClassificationResult = {
      verdict: "atom",
      title: "t",
      tags: [],
      proposed_tags: [],
      links: [],
      hub_section: "Gift Ideas",
    };
    expect(normalizeHubSection(r, ctx).hub_section).toBe("Gift Ideas");
  });

  it("drops hallucinated section", () => {
    const r: ClassificationResult = {
      verdict: "atom",
      title: "t",
      tags: [],
      proposed_tags: [],
      links: [],
      hub_section: "Made Up",
    };
    expect(normalizeHubSection(r, ctx).hub_section).toBeUndefined();
  });

  it("case-insensitive canonicalizes model section", () => {
    const r: ClassificationResult = {
      verdict: "atom",
      title: "t",
      tags: [],
      proposed_tags: [],
      links: [],
      hub_section: "gift ideas",
    };
    expect(normalizeHubSection(r, ctx).hub_section).toBe("Gift Ideas");
  });
});

describe("repairHubSection", () => {
  const ctx: VaultContext = {
    titles: [],
    tags: [],
    vocabulary: [],
    personHubs: ["Nichita"],
    personHubDetails: [
      {
        canonicalTitle: "Nichita",
        matchKeys: ["Nichita"],
        sections: ["Gift Ideas", "Personality"],
      },
    ],
  };

  it("fills Gift Ideas from want/gift cue when person linked", () => {
    const r: ClassificationResult = {
      verdict: "atom",
      title: "Nichita wants a big PC case for his next build",
      tags: ["person"],
      proposed_tags: [],
      links: [{ note: "Nichita", reason: "gift want" }],
    };
    const out = repairHubSection(
      "Nichita wants a big PC case for his next build",
      r,
      ctx,
    );
    expect(out.hub_section).toBe("Gift Ideas");
  });

  it("does not guess when no cue", () => {
    const r: ClassificationResult = {
      verdict: "atom",
      title: "Nichita likes teal",
      tags: ["person"],
      proposed_tags: [],
      links: [{ note: "Nichita", reason: "preference" }],
    };
    const out = repairHubSection("Nichita likes teal and soft light", r, ctx);
    expect(out.hub_section).toBeUndefined();
  });

  it("does not invent sections not on hub", () => {
    const r: ClassificationResult = {
      verdict: "atom",
      title: "wants a trip",
      tags: [],
      proposed_tags: [],
      links: [{ note: "Nichita", reason: "x" }],
    };
    const out = repairHubSection("wants a trip to Japan", r, ctx);
    expect(out.hub_section).toBeUndefined();
  });
});
