import { describe, expect, it } from "vitest";
import {
  buildRefreshedAtomMarkdown,
  extractCaptureBody,
  keepAsAtomResult,
  planRefreshApply,
  repairMarkerTitleInDaily,
} from "../src/pipeline/refreshAtoms";
import { CURRENT_ATOMS_QUALITY } from "../src/pipeline/atomQuality";
import type { ClassificationResult } from "../src/shared/types";

const oldAtom = `---
created: 2026-07-01T10:00:00
source: "[[2026-07-01]]"
generated-by: linker
tags:
  - idea
---
sleep debt seems to plateau

preference about sleep.
`;

const atomResult = (): ClassificationResult => ({
  verdict: "atom",
  title: "Sleep debt plateaus",
  tags: ["idea"],
  proposed_tags: [],
  links: [{ note: "Old", reason: "revises [[Old]]" }],
});

describe("extractCaptureBody", () => {
  it("splits on blank line and keeps capture only", () => {
    expect(extractCaptureBody(oldAtom)).toBe("sleep debt seems to plateau");
  });

  it("whole body when no blank split", () => {
    const md = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
tags: []
---
one block only
`;
    expect(extractCaptureBody(md)).toBe("one block only");
  });
});

describe("keepAsAtomResult (R13)", () => {
  it("forces noise to atom with fallback title", () => {
    const r = keepAsAtomResult(
      {
        verdict: "noise",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      "Old Title",
    );
    expect(r.verdict).toBe("atom");
    expect(r.title).toBe("Old Title");
  });
});

describe("buildRefreshedAtomMarkdown", () => {
  it("preserves created/source and capture body; stamps quality", () => {
    const capture = extractCaptureBody(oldAtom);
    const md = buildRefreshedAtomMarkdown({
      oldContent: oldAtom,
      captureText: capture,
      result: atomResult(),
      title: "Sleep debt plateaus",
      previousTitle: "weak old title",
      today: "2026-07-20",
    });
    expect(md).toContain("created: 2026-07-01T10:00:00");
    expect(md).toContain('source: "[[2026-07-01]]"');
    expect(md).toContain(`atoms-quality: ${CURRENT_ATOMS_QUALITY}`);
    expect(md).toContain("quality-updated: 2026-07-20");
    expect(md).toContain("sleep debt seems to plateau");
    expect(md).toContain("revises [[Old]]");
    expect(md).not.toContain("preference about sleep");
    expect(md).toContain("weak old title");
  });

  it("noise verdict still yields atom markdown with body", () => {
    const capture = extractCaptureBody(oldAtom);
    const md = buildRefreshedAtomMarkdown({
      oldContent: oldAtom,
      captureText: capture,
      result: {
        verdict: "noise",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      title: "Fallback Title",
      today: "2026-07-20",
    });
    expect(md).toContain("generated-by: linker");
    expect(md).toContain("sleep debt seems to plateau");
    expect(md).toContain(`atoms-quality: ${CURRENT_ATOMS_QUALITY}`);
  });
});

describe("planRefreshApply", () => {
  it("plans rename when title changes and path free", () => {
    const plan = planRefreshApply({
      path: "Atoms/weak old title.md",
      oldTitle: "weak old title",
      oldContent: oldAtom,
      result: atomResult(),
      atomFolder: "Atoms",
      existingAtomPaths: new Set(["Atoms/weak old title.md"]),
      today: "2026-07-20",
    });
    expect(plan.rename).toBe(true);
    expect(plan.newPath).toBe("Atoms/Sleep debt plateaus.md");
    expect(plan.captureText).toBe("sleep debt seems to plateau");
  });

  it("skips rename on collision", () => {
    const plan = planRefreshApply({
      path: "Atoms/weak old title.md",
      oldTitle: "weak old title",
      oldContent: oldAtom,
      result: atomResult(),
      atomFolder: "Atoms",
      existingAtomPaths: new Set([
        "Atoms/weak old title.md",
        "Atoms/Sleep debt plateaus.md",
      ]),
      today: "2026-07-20",
    });
    expect(plan.rename).toBe(false);
    expect(plan.newPath).toBe("Atoms/weak old title.md");
  });
});

describe("repairMarkerTitleInDaily", () => {
  it("retargets plugin marker only", () => {
    const daily = `- sleep debt seems to plateau
	↳ [[weak old title]] <!--linker-->
- other bullet
`;
    const r = repairMarkerTitleInDaily(
      daily,
      "sleep debt seems to plateau",
      "weak old title",
      "Sleep debt plateaus",
    );
    expect(r.changed).toBe(true);
    expect(r.content).toContain("[[Sleep debt plateaus]]");
    expect(r.content).toContain("- sleep debt seems to plateau");
    expect(r.content).toContain("- other bullet");
  });
});
