import { describe, expect, it } from "vitest";
import {
  buildRefreshedAtomMarkdown,
  extractCaptureBody,
  keepAsAtomResult,
  planRefreshWrite,
  repairMarkerLine,
  countEligibleAtoms,
} from "../src/pipeline/refreshAtoms";
import { CURRENT_ATOMS_QUALITY } from "../src/shared/atomQuality";
import type { ClassificationResult } from "../src/shared/types";
import { buildAtomMarkdown } from "../src/pipeline/render";

const atomResult = (
  over: Partial<ClassificationResult> = {},
): ClassificationResult => ({
  verdict: "atom",
  title: "New declarative title",
  tags: ["idea"],
  proposed_tags: [],
  links: [{ note: "Alex", reason: "concrete preference about [[Alex]]" }],
  ...over,
});

const oldAtom = `---
created: 2026-07-01T10:00:00
source: "[[2026-07-01]]"
generated-by: linker
tags:
  - person
---
Alex likes periwinkle

preference about [[Alex]].
`;

describe("extractCaptureBody", () => {
  it("splits capture and reason on single blank line", () => {
    const r = extractCaptureBody(oldAtom);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.captureText).toBe("Alex likes periwinkle");
      expect(r.method).toBe("blank_line");
    }
  });

  it("whole body when no blank line", () => {
    const md = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
tags: []
---
just the capture words
`;
    const r = extractCaptureBody(md);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.captureText).toBe("just the capture words");
      expect(r.method).toBe("whole_body");
    }
  });

  it("rejects multi blank-line bodies as untrusted", () => {
    const md = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
tags: []
---
para one

para two hand edit

old reason
`;
    const r = extractCaptureBody(md);
    expect(r.ok).toBe(false);
  });
});

describe("buildRefreshedAtomMarkdown", () => {
  it("preserves created/source and body capture; stamps quality", () => {
    const md = buildRefreshedAtomMarkdown({
      oldContent: oldAtom,
      result: atomResult(),
      captureText: "Alex likes periwinkle",
      qualityUpdated: "2026-07-16",
    });
    expect(md).toContain("created: 2026-07-01T10:00:00");
    expect(md).toContain('source: "[[2026-07-01]]"');
    expect(md).toContain(`atoms-quality: ${CURRENT_ATOMS_QUALITY}`);
    expect(md).toContain("quality-updated: 2026-07-16");
    expect(md).toContain("Alex likes periwinkle");
    expect(md).toContain("concrete preference about [[Alex]]");
    expect(md).not.toMatch(/\npreference about \[\[Alex\]\]\.\n/);
  });

  it("body byte-equal to extract for capture region", () => {
    const capture = "Alex likes periwinkle";
    const md = buildRefreshedAtomMarkdown({
      oldContent: oldAtom,
      result: atomResult({ links: [] }),
      captureText: capture,
    });
    const body = md.split(/\n---\n/)[1] ?? "";
    expect(body.trim()).toBe(capture);
  });
});

describe("keepAsAtomResult", () => {
  it("forces atom on noise and reuses title", () => {
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

describe("planRefreshWrite", () => {
  it("plans modify without rename when title same path", () => {
    const plan = planRefreshWrite({
      path: "Atoms/New declarative title.md",
      oldContent: oldAtom,
      result: atomResult(),
      captureText: "Alex likes periwinkle",
      atomFolder: "Atoms",
      existingAtomPaths: new Set(["Atoms/New declarative title.md"]),
      sourceDailyPath: "Daily/2026-07-01.md",
    });
    expect(plan.kind).toBe("modify");
    if (plan.kind === "modify") {
      expect(plan.renameTo).toBeNull();
      expect(plan.content).toContain("Alex likes periwinkle");
    }
  });

  it("plans rename when new path free", () => {
    const plan = planRefreshWrite({
      path: "Atoms/Alex likes the color periwinkle.md",
      oldContent: oldAtom,
      result: atomResult({ title: "Alex likes periwinkle" }),
      captureText: "Alex likes periwinkle",
      atomFolder: "Atoms",
      existingAtomPaths: new Set([
        "Atoms/Alex likes the color periwinkle.md",
      ]),
      sourceDailyPath: "Daily/2026-07-01.md",
    });
    expect(plan.kind).toBe("modify");
    if (plan.kind === "modify") {
      expect(plan.renameTo).toBe("Atoms/Alex likes periwinkle.md");
      expect(plan.content).toContain("Alex likes the color periwinkle");
    }
  });

  it("keeps path and aliases when target collides", () => {
    const plan = planRefreshWrite({
      path: "Atoms/Old.md",
      oldContent: oldAtom,
      result: atomResult({ title: "Taken" }),
      captureText: "Alex likes periwinkle",
      atomFolder: "Atoms",
      existingAtomPaths: new Set(["Atoms/Old.md", "Atoms/Taken.md"]),
      sourceDailyPath: null,
    });
    expect(plan.kind).toBe("modify");
    if (plan.kind === "modify") {
      expect(plan.renameTo).toBeNull();
      expect(plan.content).toContain("aliases:");
    }
  });
});

describe("repairMarkerLine", () => {
  it("updates marker when unique capture match", () => {
    const daily = `- 10:00 Alex likes periwinkle
\t↳ [[Old Title]] <!--linker-->
- other bullet
`;
    const r = repairMarkerLine(
      daily,
      "Alex likes periwinkle",
      "Old Title",
      "New Title",
    );
    expect(r.changed).toBe(true);
    expect(r.content).toContain("[[New Title]]");
    expect(r.content).toContain("- 10:00 Alex likes periwinkle");
  });

  it("skips on ambiguous captures", () => {
    const daily = `- same line
\t↳ [[Old]] <!--linker-->
- same line
\t↳ [[Old]] <!--linker-->
`;
    const r = repairMarkerLine(daily, "same line", "Old", "New");
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("ambiguous");
  });
});

describe("countEligibleAtoms", () => {
  it("counts unstamped linker atoms", () => {
    const stamped = buildAtomMarkdown({
      result: atomResult(),
      captureText: "x",
      created: "2026-07-16",
      sourceDailyPath: "2026-07-16.md",
    });
    expect(
      countEligibleAtoms([{ content: oldAtom }, { content: stamped }]),
    ).toBe(1);
  });
});
