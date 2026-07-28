import { describe, expect, it } from "vitest";
import {
  hubTitlesFromAtomContents,
  planHubProjection,
} from "../src/pipeline/runHubProjection";
import { GENERATED_CLOSE, GENERATED_OPEN } from "../src/pipeline/hubSections";
import { normalizeHubSection } from "../src/pipeline/classify";
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
});
