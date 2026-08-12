import { describe, expect, it } from "vitest";
import {
  filterPlanIncludeUnsorted,
  hubListPreviewCopy,
  summarizeHubProjectionPlan,
} from "../src/pipeline/hubListPreview";
import { planHubProjection } from "../src/pipeline/runHubProjection";
import { GENERATED_OPEN } from "../src/pipeline/hubSections";

describe("summarizeHubProjectionPlan", () => {
  it("counts sections including Unsorted", () => {
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Movies"],
      atoms: [
        {
          title: "Dune",
          content:
            '---\nhub-section: "Want to watch"\n---\nx\n\nbelongs with [[Movies]] (list).\n',
        },
        {
          title: "Loose",
          content: "---\n---\ny\n\nbelongs with [[Movies]] (list).\n",
        },
      ],
      hubs: new Map([
        [
          "movies",
          {
            title: "Movies",
            path: "Movies.md",
            content: "# Movies\n\n## Want to watch\n",
            sections: ["Want to watch"],
            kind: "list",
          },
        ],
      ]),
    });
    // need 2 members for R3c list write with one unsorted - actually Dune has section so hasMatching
    const sum = summarizeHubProjectionPlan(plan);
    expect(sum.empty).toBe(false);
    expect(sum.rows[0]!.hubTitle).toBe("Movies");
    expect(sum.rows[0]!.total).toBe(2);
    const names = sum.rows[0]!.sections.map((s) => s.name);
    expect(names).toContain("Want to watch");
    expect(names).toContain("Unsorted");
  });

  it("empty when nothing changed", () => {
    const sum = summarizeHubProjectionPlan({
      writes: [],
      errors: [],
      skipped: [],
    });
    expect(sum.empty).toBe(true);
  });
});

describe("filterPlanIncludeUnsorted", () => {
  it("drops Unsorted-only atoms and pure-Unsorted hubs", () => {
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Movies"],
      atoms: [
        {
          title: "Dune",
          content:
            '---\nhub-section: "Want to watch"\n---\nx\n\nbelongs with [[Movies]] (list).\n',
        },
        {
          title: "Loose",
          content: "---\n---\ny\n\nbelongs with [[Movies]] (list).\n",
        },
      ],
      hubs: new Map([
        [
          "movies",
          {
            title: "Movies",
            path: "Movies.md",
            content: "# Movies\n\n## Want to watch\n",
            sections: ["Want to watch"],
            kind: "list",
          },
        ],
      ]),
    });
    const filtered = filterPlanIncludeUnsorted(plan, false);
    expect(filtered.writes).toHaveLength(1);
    expect(filtered.writes[0]!.next).toContain("Dune");
    expect(filtered.writes[0]!.next).not.toContain("Loose");
    expect(filtered.writes[0]!.next).not.toContain("## Unsorted");
  });

  it("removes hub that only had Unsorted", () => {
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Movies"],
      atoms: [
        {
          title: "A",
          content: "---\n---\nx\n\nbelongs with [[Movies]] (list).\n",
        },
        {
          title: "B",
          content: "---\n---\ny\n\nbelongs with [[Movies]] (list).\n",
        },
      ],
      hubs: new Map([
        [
          "movies",
          {
            title: "Movies",
            path: "Movies.md",
            content: `# Movies\n\n${GENERATED_OPEN}\n## Unsorted\n- [[old]]\n<!-- /atoms:generated -->\n`,
            sections: ["Want to watch"],
            kind: "list",
          },
        ],
      ]),
    });
    const filtered = filterPlanIncludeUnsorted(plan, false);
    expect(filtered.writes.filter((w) => w.changed)).toHaveLength(0);
    expect(filtered.skipped.some((s) => s.skipReason === "unsorted-excluded")).toBe(
      true,
    );
  });

  it("includeUnsorted true is identity", () => {
    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Alex"],
      atoms: [
        {
          title: "G",
          content:
            '---\nhub-section: "Gift Ideas"\n---\nx\n\nabout [[Alex]] (g).\n',
        },
      ],
      hubs: new Map([
        [
          "alex",
          {
            title: "Alex",
            path: "People/Alex.md",
            content: "# Alex\n\n## Gift Ideas\n",
            sections: ["Gift Ideas"],
            kind: "person",
          },
        ],
      ]),
    });
    const f = filterPlanIncludeUnsorted(plan, true);
    expect(f.writes).toEqual(plan.writes);
  });
});

describe("hubListPreviewCopy", () => {
  it("has plain language", () => {
    const c = hubListPreviewCopy();
    expect(c.title).toBe("Update hub lists?");
    expect(c.body.toLowerCase()).not.toContain("projection");
    expect(c.notNowLabel).toBe("Not now");
    expect(c.updateLabel).toBe("Update lists");
  });
});
