/**
 * Throwaway vault AE smoke — writes under test_vault only.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseHubSections } from "../src/pipeline/hubSections";
import { planHubProjection } from "../src/pipeline/runHubProjection";

const vault = join(process.cwd(), "test_vault/test vault");
const hubPath = join(vault, "People/Nichita.md");
const atomPath = join(vault, "Atoms/Nichita likes teal and soft light.md");

const OPEN = "<!-- atoms:generated v=1 -->";
const CLOSE = "<!-- /atoms:generated -->";

describe("hub projection vault smoke (throwaway)", () => {
  it("AE1–AE5 on test_vault Nichita hub", () => {
    if (!existsSync(vault)) {
      // skip if no throwaway vault
      return;
    }
    mkdirSync(join(vault, "People"), { recursive: true });
    mkdirSync(join(vault, "Atoms"), { recursive: true });

    const hubHuman = `---
tags:
  - person
---
# Nichita

Hand-written intro: always call before visiting.

## Gift Ideas

Notes I keep myself above the plugin block.

## Personality

Warm and curious — human synthesis forever.
`;
    writeFileSync(hubPath, hubHuman);

    const atom = `---
created: 2026-06-01
source: "[[2026-06-01]]"
generated-by: linker
atoms-quality: 5
quality-updated: 2026-07-17
tags:
  - person
  - preferences
hub-section: "Gift Ideas"
---
Nichita likes teal and soft light

concrete aesthetic preference for gifts / clothes ([[Nichita]]).
`;
    writeFileSync(atomPath, atom);

    const sections = parseHubSections(hubHuman);
    expect(sections).toContain("Gift Ideas");
    expect(sections).toContain("Personality");

    const plan = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Nichita"],
      atoms: [{ title: "Nichita likes teal and soft light", content: atom }],
      hubs: new Map([
        [
          "nichita",
          {
            title: "Nichita",
            path: hubPath,
            content: hubHuman,
            sections,
          },
        ],
      ]),
    });
    expect(plan.errors).toEqual([]);
    expect(plan.writes).toHaveLength(1);
    const next = plan.writes[0]!.next;
    const oi = next.indexOf(OPEN);
    const ci = next.indexOf(CLOSE);
    const prefix = next.slice(0, oi);
    // AE1 human outside block
    expect(prefix).toContain("Hand-written intro");
    expect(prefix).toContain("## Personality");
    expect(prefix).toContain("Notes I keep myself");
    expect(prefix).not.toContain(OPEN);
    // AE2 section route
    expect(next).toContain("## Gift Ideas");
    expect(next).toContain("[[Nichita likes teal and soft light]]");

    writeFileSync(hubPath, next);
    const after = readFileSync(hubPath, "utf8");
    const h1 = createHash("sha256").update(after).digest("hex");

    // AE4
    const plan2 = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Nichita"],
      atoms: [{ title: "Nichita likes teal and soft light", content: atom }],
      hubs: new Map([
        [
          "nichita",
          {
            title: "Nichita",
            path: hubPath,
            content: after,
            sections: parseHubSections(after),
          },
        ],
      ]),
    });
    expect(plan2.writes[0]!.changed).toBe(false);
    expect(createHash("sha256").update(plan2.writes[0]!.next).digest("hex")).toBe(
      h1,
    );

    // AE5
    const damaged = after.replace(CLOSE, "");
    const plan3 = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Nichita"],
      atoms: [{ title: "Nichita likes teal and soft light", content: atom }],
      hubs: new Map([
        [
          "nichita",
          { title: "Nichita", path: hubPath, content: damaged, sections },
        ],
      ]),
    });
    expect(plan3.writes).toEqual([]);
    expect(plan3.errors[0]?.reason).toBe("unclosed-generated-block");

    // AE3
    const atomU = atom.replace(/hub-section:.*\n/, "");
    const plan4 = planHubProjection({
      enabled: true,
      touchedHubTitles: ["Nichita"],
      atoms: [{ title: "Nichita likes teal and soft light", content: atomU }],
      hubs: new Map([
        [
          "nichita",
          {
            title: "Nichita",
            path: hubPath,
            content: after,
            sections: parseHubSections(after),
          },
        ],
      ]),
    });
    expect(plan4.writes[0]!.next).toContain("## Unsorted");
  });
});
