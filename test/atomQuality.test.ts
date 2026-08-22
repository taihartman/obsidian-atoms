import { describe, expect, it } from "vitest";
import {
  CURRENT_ATOMS_QUALITY,
  CURRENT_ATOMS_QUALITY_ANSWER,
  CURRENT_ATOMS_QUALITY_REASON,
  countRefileFromFileCaches,
  isEligibleForUpdate,
  isEligibleForUpdateFromCache,
  isLinkerGenerated,
  parseAtomsQuality,
  parseLocalStampMs,
  qualityStampLines,
} from "../src/pipeline/atomQuality";

const legacy = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
tags:
  - idea
---
old capture text

relates to something.
`;

const stamped = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
atoms-quality: ${CURRENT_ATOMS_QUALITY}
quality-updated: 2026-07-16
tags: []
---
body
`;

const stampedV2 = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
atoms-quality: 2
quality-updated: 2026-07-16
tags: []
---
body
`;

describe("atomQuality", () => {
  it("ships a Home reason and Settings answer next to CURRENT", () => {
    expect(CURRENT_ATOMS_QUALITY).toBe(9);
    expect(CURRENT_ATOMS_QUALITY_REASON).toBe(
      "Readings of the same thing can link now. Your original text stays.",
    );
    expect(CURRENT_ATOMS_QUALITY_ANSWER).toBe("Readings can link");
  });

  it("unstamped linker atoms are quality 0 and eligible", () => {
    expect(isLinkerGenerated(legacy)).toBe(true);
    expect(parseAtomsQuality(legacy)).toBe(0);
    expect(isEligibleForUpdate(legacy)).toBe(true);
  });

  it("CURRENT stamp is not eligible", () => {
    expect(parseAtomsQuality(stamped)).toBe(CURRENT_ATOMS_QUALITY);
    expect(isEligibleForUpdate(stamped)).toBe(false);
  });

  it("older stamp is eligible after quality bump", () => {
    expect(CURRENT_ATOMS_QUALITY).toBeGreaterThanOrEqual(5);
    expect(parseAtomsQuality(stampedV2)).toBe(2);
    expect(isEligibleForUpdate(stampedV2)).toBe(true);
  });

  it("non-linker content is not eligible", () => {
    expect(isEligibleForUpdate("# hand note\n\nhello")).toBe(false);
  });

  it("counts refile debt from metadataCache frontmatter inside the atom folder", () => {
    const files = [
      {
        path: "Atoms/Old.md",
        cache: {
          frontmatter: { "generated-by": "linker", "atoms-quality": 8 },
        },
      },
      {
        path: "Atoms/Unstamped.md",
        cache: { frontmatter: { "generated-by": "linker" } },
      },
      {
        path: "Atoms/Current.md",
        cache: {
          frontmatter: {
            "generated-by": "linker",
            "atoms-quality": CURRENT_ATOMS_QUALITY,
          },
        },
      },
      {
        path: "Atoms/Ask.md",
        cache: {
          frontmatter: { "generated-by": "ask-mcp", "atoms-quality": 1 },
        },
      },
      {
        path: "Notes/Elsewhere.md",
        cache: {
          frontmatter: { "generated-by": "linker", "atoms-quality": 1 },
        },
      },
      { path: "Atoms/NoCache.md", cache: null },
    ];
    expect(countRefileFromFileCaches(files, "Atoms")).toBe(2);
    expect(
      isEligibleForUpdateFromCache({
        frontmatter: { "generated-by": "linker", "atoms-quality": "3" },
      }),
    ).toBe(true);
  });

  it("qualityStampLines shape", () => {
    const s = qualityStampLines("2026-07-16", 2);
    expect(s.lines).toEqual([
      "atoms-quality: 2",
      "quality-updated: 2026-07-16",
    ]);
  });

  it("parseLocalStampMs is noon for a day stamp and wall clock for a datetime", () => {
    expect(parseLocalStampMs("2026-03-08")).toBe(
      new Date(2026, 2, 8, 12, 0, 0, 0).getTime(),
    );
    expect(parseLocalStampMs("2026-04-02T09:15:00")).toBe(
      new Date(2026, 3, 2, 9, 15, 0, 0).getTime(),
    );
    expect(parseLocalStampMs("not-a-date")).toBeNull();
  });
});
