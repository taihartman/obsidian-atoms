import { describe, expect, it } from "vitest";
import {
  atomPathForTitle,
  buildAtomMarkdown,
  insertMarkerAfterCapture,
  markerLineForDecision,
  planWrite,
  resolveCreatedField,
  sanitizeFilename,
  formatAtomBody,
} from "../src/render";
import type { Capture, ClassificationResult } from "../src/types";
import { parseCaptures } from "../src/parse";

const capture = (text: string, start = 0, end = 0): Capture => ({
  text,
  timestamp: "14:32",
  startLine: start,
  endLine: end,
  processed: false,
  markerKind: null,
  markerLine: null,
});

describe("sanitizeFilename (KTD8)", () => {
  it("replaces illegal chars and sets alias when changed", () => {
    const s = sanitizeFilename("Sleep: debt / plateaus?");
    expect(s.filename).not.toMatch(/[/:?]/);
    expect(s.alias).toBe("Sleep: debt / plateaus?");
  });

  it("no alias when title already safe", () => {
    const s = sanitizeFilename("Sleep debt plateaus");
    expect(s.filename).toBe("Sleep debt plateaus");
    expect(s.alias).toBeNull();
  });
});

describe("buildAtomMarkdown (AE1 / R15)", () => {
  it("has exactly the four frontmatter fields (+ optional aliases)", () => {
    const result: ClassificationResult = {
      verdict: "atom",
      title: "Sleep debt plateaus",
      tags: ["idea"],
      proposed_tags: [],
      links: [
        {
          note: "Old",
          reason: "revises [[Old]]",
        },
      ],
    };
    const md = buildAtomMarkdown({
      result,
      captureText: "sleep debt seems to plateau",
      created: "2026-07-14T14:32:00",
      sourceDailyPath: "Daily/2026-07-14.md",
    });

    expect(md).toMatch(/^---\n/);
    expect(md).toContain("created: 2026-07-14T14:32:00");
    expect(md).toContain('source: "[[2026-07-14]]"');
    expect(md).toContain("generated-by: linker");
    expect(md).toContain("tags:");
    expect(md).toContain("- idea");
    expect(md).not.toContain("model:");
    expect(md).not.toContain("prompt-version");
    expect(md).not.toContain("confidence");
    // Verbatim body
    expect(md).toContain("sleep debt seems to plateau");
    // Link prose
    expect(md).toContain("revises [[Old]]");
  });

  it("adds aliases when title has illegal filename chars", () => {
    const md = buildAtomMarkdown({
      result: {
        verdict: "atom",
        title: "A: claim/with slash",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      captureText: "body",
      created: "2026-07-14",
      sourceDailyPath: "Daily/2026-07-14.md",
    });
    expect(md).toContain("aliases:");
    expect(md).toContain("A: claim/with slash");
  });
});

describe("insertMarkerAfterCapture (R4/R6)", () => {
  it("appends marker under capture without changing capture bytes", () => {
    const daily = "- sleep debt seems to plateau\n- next item\n";
    const caps = parseCaptures(daily);
    const c = caps[0]!;
    const originalLine = daily.split("\n")[c.startLine];
    const marker = markerLineForDecision("atom", "Sleep debt plateaus");
    const { content, changed } = insertMarkerAfterCapture(daily, c, marker);
    expect(changed).toBe(true);
    expect(content.split("\n")[c.startLine]).toBe(originalLine);
    expect(content).toContain(marker);
    expect(content.indexOf(marker)).toBeGreaterThan(
      content.indexOf("sleep debt seems to plateau"),
    );
    // next capture still present
    expect(content).toContain("- next item");
  });

  it("is idempotent if marker already present", () => {
    const daily =
      "- buy milk\n\t<!--linker:task-->\n";
    const caps = parseCaptures(daily);
    // parse marks it processed; still test insert on endLine 0
    const c: Capture = {
      ...caps[0]!,
      processed: false,
      endLine: 0,
    };
    const { changed } = insertMarkerAfterCapture(
      daily,
      c,
      "\t<!--linker:task-->",
    );
    expect(changed).toBe(false);
  });

  it("task marker creates no atom path in plan", () => {
    const plan = planWrite({
      result: {
        verdict: "task",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      capture: capture("buy milk"),
      dailyPath: "Daily/2026-07-14.md",
      dailyDate: "2026-07-14",
      atomFolder: "Atoms",
      existingAtomPaths: new Set(),
    });
    expect(plan.action.kind).toBe("marker_only");
    expect(plan.markerLine).toBe("\t<!--linker:task-->");
  });
});

describe("planWrite collision (KTD8)", () => {
  it("does not create a new file on same-title collision", () => {
    const title = "Sleep debt plateaus";
    const path = atomPathForTitle("Atoms", title);
    const plan = planWrite({
      result: {
        verdict: "atom",
        title,
        tags: ["idea"],
        proposed_tags: [],
        links: [],
      },
      capture: capture("again the same thought"),
      dailyPath: "Daily/2026-07-13.md",
      dailyDate: "2026-07-13",
      atomFolder: "Atoms",
      existingAtomPaths: new Set([path]),
    });
    expect(plan.action.kind).toBe("skip_atom_collision");
    expect(plan.markerLine).toContain("[[Sleep debt plateaus]]");
    expect(plan.result.links.some((l) => l.reason.includes("revises"))).toBe(
      true,
    );
  });

  it("plans create_atom with content for new title", () => {
    const plan = planWrite({
      result: {
        verdict: "atom",
        title: "Brand new claim",
        tags: ["idea"],
        proposed_tags: [],
        links: [],
      },
      capture: capture("verbatim body here"),
      dailyPath: "Daily/2026-07-14.md",
      dailyDate: "2026-07-14",
      atomFolder: "Atoms",
      existingAtomPaths: new Set(),
    });
    expect(plan.action.kind).toBe("create_atom");
    if (plan.action.kind === "create_atom") {
      expect(plan.action.path).toBe("Atoms/Brand new claim.md");
      expect(plan.action.content).toContain("verbatim body here");
      expect(plan.action.content).toContain('source: "[[2026-07-14]]"');
    }
  });
});

describe("resolveCreatedField", () => {
  it("uses capture timestamp when present", () => {
    expect(resolveCreatedField("2026-07-14", "14:32")).toBe(
      "2026-07-14T14:32:00",
    );
  });
  it("falls back to daily date", () => {
    expect(resolveCreatedField("2026-07-14", null)).toBe("2026-07-14");
  });
});

describe("formatAtomBody verbatim", () => {
  it("does not paraphrase capture text", () => {
    const text = "exactly this wording, hedges and all";
    const body = formatAtomBody(text, {
      verdict: "atom",
      title: "T",
      tags: [],
      proposed_tags: [],
      links: [],
    });
    expect(body).toBe(text);
  });
});
