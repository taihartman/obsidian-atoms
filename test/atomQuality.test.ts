import { describe, expect, it } from "vitest";
import {
  CURRENT_ATOMS_QUALITY,
  isEligibleForUpdate,
  isLinkerGenerated,
  parseAtomsQuality,
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

  it("qualityStampLines shape", () => {
    const s = qualityStampLines("2026-07-16", 2);
    expect(s.lines).toEqual([
      "atoms-quality: 2",
      "quality-updated: 2026-07-16",
    ]);
  });
});
