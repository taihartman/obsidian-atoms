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
  FOLDER_MAX_BYTES,
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

  /**
   * #501 H2. A dotfile is not a traversal, so none of the guards above catch it, and Obsidian does
   * not index one: a file written to `.hidden/` lands on disk and is then absent from
   * `getAbstractFileByPath`, from `getMarkdownFiles()` and from `metadataCache` — so it is missing
   * from the explorer, from search and from the graph, and the `↳ [[title]]` marker the pipeline
   * appends to the daily note can never resolve. `.obsidian` is worse still: it aims atoms at the
   * config directory.
   */
  it("rejects a folder Obsidian will not index", () => {
    expect(clampAtomFolder(".hidden")).toBe("Atoms");
    expect(clampAtomFolder(".obsidian")).toBe("Atoms");
    expect(clampAtomFolder(".")).toBe("Atoms");
    // A dot inside the name is ordinary and stays allowed.
    expect(clampAtomFolder("v1.2 Atoms")).toBe("v1.2 Atoms");
  });

  /**
   * #501 H3. macOS caps a path component at 255 bytes, so an over-long folder fails every write —
   * `createFolder` and `create` both throw `ENAMETOOLONG` and Obsidian's own scanner logs it —
   * while the setting keeps the value and filing silently stops producing atoms.
   *
   * The cap is on **bytes**, not characters, because bytes are what the limit is: sixty-four
   * 4-byte emoji are 256 bytes and would sail through a character count.
   *
   * It sits exactly at the filesystem's own limit rather than at a tidier smaller number, because
   * `applyLoadedSettings` clamps at load: a stricter rule would move a working vault's folder on
   * upgrade and strand the atoms already in it. A long name is not a broken one.
   */
  it("rejects a folder no filesystem will take, and only that", () => {
    expect(clampAtomFolder("L".repeat(300))).toBe("Atoms");
    expect(clampAtomFolder("L".repeat(FOLDER_MAX_BYTES + 1))).toBe("Atoms");
    expect(clampAtomFolder("L".repeat(FOLDER_MAX_BYTES))).toBe(
      "L".repeat(FOLDER_MAX_BYTES),
    );
    // Long, unusual, and entirely writable: a name like this must survive an upgrade.
    expect(clampAtomFolder("A very long but perfectly legal atom folder name")).toBe(
      "A very long but perfectly legal atom folder name",
    );
    // Counted in bytes: 64 characters, 256 bytes.
    expect(clampAtomFolder("🧠".repeat(64))).toBe("Atoms");
    // 32 of the same emoji is 128 bytes and stays legal.
    expect(clampAtomFolder("🧠".repeat(32))).toBe("🧠".repeat(32));
  });

  /**
   * The folder half of a path must not be looser than the filename half. `sanitizeFilename` has
   * always stripped leading and trailing dots, refused the reserved device names and capped
   * length; every rule tested above is the folder catching up with rules the filename beside it
   * already keeps. A review caught this comment claiming that parity before the last three rules
   * were actually there.
   *
   * `Atoms.`, `con` and a trailing space are legal on macOS and refused by Windows, and a vault
   * syncs, so the cross-platform rule is the real one.
   */
  it("holds atom folders to the rules atom filenames already keep", () => {
    expect(sanitizeFilename(".hidden").filename).not.toMatch(/^\./);
    expect(sanitizeFilename("L".repeat(300)).filename.length).toBeLessThanOrEqual(
      TITLE_MAX_LEN,
    );
    expect(sanitizeFilename("con").filename).toBe("Untitled");

    expect(clampAtomFolder("Atoms.")).toBe("Atoms");
    expect(clampAtomFolder("con")).toBe("Atoms");
    expect(clampAtomFolder("NUL")).toBe("Atoms");
    // The trailing-slash strip hands back the space in front of it; the segment is re-trimmed.
    expect(clampAtomFolder("My Atoms /")).toBe("My Atoms");
    expect(clampAtomFolder("   ")).toBe("Atoms");
    // Not reserved, merely starts like one.
    expect(clampAtomFolder("console")).toBe("console");
  });

  /**
   * The cap's value is the decision, not the comparison. Every boundary test above derives its
   * expectation from the constant, so all of them stay green if someone edits 255 to 64 — and
   * that edit is precisely the harmful one, because this value is applied to the *stored* setting
   * at load, so lowering it silently relocates working vaults on upgrade.
   */
  it("keeps the folder cap at the filesystem's own limit", () => {
    expect(FOLDER_MAX_BYTES).toBe(255);
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
