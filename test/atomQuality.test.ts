import { describe, expect, it } from "vitest";
import {
  CURRENT_ATOMS_QUALITY,
  isEligibleForRefresh,
  parseAtomsQuality,
  qualityUpdatedDate,
} from "../src/shared/atomQuality";

describe("atomQuality", () => {
  it("parses missing quality as 0", () => {
    const md = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
tags: []
---
body
`;
    expect(parseAtomsQuality(md)).toBe(0);
    expect(isEligibleForRefresh(md)).toBe(true);
  });

  it("current quality not eligible", () => {
    const md = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
atoms-quality: ${CURRENT_ATOMS_QUALITY}
quality-updated: 2026-07-16
tags: []
---
body
`;
    expect(parseAtomsQuality(md)).toBe(CURRENT_ATOMS_QUALITY);
    expect(isEligibleForRefresh(md)).toBe(false);
  });

  it("requires generated-by linker", () => {
    const md = `---
created: 2026-07-01
tags: []
---
body
`;
    expect(isEligibleForRefresh(md)).toBe(false);
  });

  it("qualityUpdatedDate is YYYY-MM-DD", () => {
    expect(qualityUpdatedDate(new Date("2026-07-16T15:00:00"))).toBe(
      "2026-07-16",
    );
  });
});
