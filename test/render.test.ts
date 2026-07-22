import { describe, expect, it } from "vitest";
import {
  atomPathForTitle,
  buildAtomMarkdown,
  clampAtomFolder,
  insertMarkerAfterCapture,
  markerLineForDecision,
  planWrite,
  replaceMarkerAfterCapture,
  resolveCreatedField,
  sanitizeFilename,
  stripMarkersAfterCapture,
  formatAtomBody,
  TITLE_MAX_LEN,
} from "../src/pipeline/render";
import type { Capture, ClassificationResult } from "../src/shared/types";
import { parseCaptures } from "../src/pipeline/parse";

const capture = (text: string, start = 0, end = 0): Capture => ({
  text,
  timestamp: "14:32",
  startLine: start,
  endLine: end,
  processed: false,
  markerKind: null,
  markerLine: null,
});

describe("sanitizeFilename (KTD8 + security)", () => {
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

  it("neutralizes newlines and wikilink breakouts (AE2)", () => {
    const s = sanitizeFilename("foo]]\nbar/../x");
    expect(s.filename).not.toContain("\n");
    expect(s.filename).not.toContain("]]");
    expect(s.filename).not.toContain("/");
    expect(s.filename).not.toMatch(/\.\./);
    const marker = markerLineForDecision("atom", "foo]]\nbar/../x");
    expect(marker.split("\n")).toHaveLength(1);
    expect(marker).toMatch(/↳ \[\[.+\]\] <!--linker-->/);
  });

  it("bounds length", () => {
    const long = "a".repeat(TITLE_MAX_LEN + 40);
    expect(sanitizeFilename(long).filename.length).toBeLessThanOrEqual(
      TITLE_MAX_LEN,
    );
  });
});

describe("clampAtomFolder (AE3)", () => {
  it("accepts a single relative segment", () => {
    expect(clampAtomFolder("Atoms")).toBe("Atoms");
    expect(clampAtomFolder("My Atoms/")).toBe("My Atoms");
  });

  it("rejects poison / multi-segment / absolute", () => {
    expect(clampAtomFolder("../Outside")).toBe("Atoms");
    expect(clampAtomFolder("/abs")).toBe("Atoms");
    expect(clampAtomFolder("foo/bar")).toBe("Atoms");
    expect(clampAtomFolder("..")).toBe("Atoms");
    expect(clampAtomFolder("")).toBe("Atoms");
  });
});

describe("buildAtomMarkdown (AE1 / R15)", () => {
  it("has core frontmatter + quality stamps (+ optional aliases)", () => {
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
      qualityUpdated: "2026-07-16",
    });

    expect(md).toMatch(/^---\n/);
    expect(md).toContain("created: 2026-07-14T14:32:00");
    expect(md).toContain('source: "[[2026-07-14]]"');
    expect(md).toContain("generated-by: linker");
    expect(md).toContain("atoms-quality:");
    expect(md).toContain("quality-updated: 2026-07-16");
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

describe("planWrite collision (protect existing)", () => {
  it("skips file write on same-title collision and still plans marker", () => {
    const title = "Sleep debt plateaus";
    const path = atomPathForTitle("Atoms", title);
    const plan = planWrite({
      result: {
        verdict: "atom",
        title,
        tags: ["idea", "watch"],
        proposed_tags: [],
        links: [{ note: "Show", reason: "media" }],
      },
      capture: capture("again the same thought"),
      dailyPath: "Daily/2026-07-13.md",
      dailyDate: "2026-07-13",
      atomFolder: "Atoms",
      existingAtomPaths: new Set([path]),
    });
    expect(plan.action.kind).toBe("skip_existing_atom");
    if (plan.action.kind === "skip_existing_atom") {
      expect(plan.action.path).toBe(path);
      expect(plan.action.title).toBe(title);
    }
    expect(plan.markerLine).toContain("[[Sleep debt plateaus]]");
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
  it("untimestamped uses noon + startLine seconds for within-day order", () => {
    expect(resolveCreatedField("2026-07-14", null, 0)).toBe(
      "2026-07-14T12:00:00",
    );
    expect(resolveCreatedField("2026-07-14", null, 3)).toBe(
      "2026-07-14T12:00:03",
    );
    expect(resolveCreatedField("2026-07-14", null, 13)).toBe(
      "2026-07-14T12:00:13",
    );
  });
  it("later startLine sorts after earlier (same day)", () => {
    const early = resolveCreatedField("2026-07-14", null, 3);
    const late = resolveCreatedField("2026-07-14", null, 13);
    expect(early < late).toBe(true);
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

describe("insertMarkerAfterCapture — no double markers", () => {
  it("does not stack a second marker when one already follows the capture", () => {
    const content = [
      "- hello world",
      "\t<!--linker:noise-->",
      "- next",
      "",
    ].join("\n");
    const cap = capture("hello world", 0, 0);
    const once = insertMarkerAfterCapture(content, cap, "\t<!--linker:noise-->");
    expect(once.changed).toBe(false);
    const stacked = [
      "- hello world",
      "\t<!--linker:noise-->",
      "\t<!--linker:noise-->",
      "- next",
      "",
    ].join("\n");
    const again = insertMarkerAfterCapture(stacked, cap, "\t<!--linker:noise-->");
    expect(again.changed).toBe(false);
  });
});

describe("replaceMarkerAfterCapture (reconsider)", () => {
  it("strips stacked markers and writes one new marker; body unchanged", () => {
    const daily = [
      "- packing list for Japan",
      "\t<!--linker:noise-->",
      "\t<!--linker:noise-->",
      "- next",
      "",
    ].join("\n");
    const cap = capture("packing list for Japan", 0, 0);
    const original = daily.split("\n")[0];
    const marker = markerLineForDecision("atom", "Japan packing list");
    const { content, changed } = replaceMarkerAfterCapture(daily, cap, marker);
    expect(changed).toBe(true);
    expect(content.split("\n")[0]).toBe(original);
    expect(content).toContain(marker);
    expect((content.match(/<!--linker/g) ?? []).length).toBe(1);
    expect(content).toContain("- next");
  });

  it("stripMarkers removes only marker lines under capture", () => {
    const daily =
      "- buy milk\n\t<!--linker:task-->\n\t<!--linker:noise-->\n- keep\n";
    const cap = capture("buy milk", 0, 0);
    const { content, removed } = stripMarkersAfterCapture(daily, cap);
    expect(removed).toBe(2);
    expect(content).toContain("- buy milk");
    expect(content).not.toContain("linker");
    expect(content).toContain("- keep");
  });
});
