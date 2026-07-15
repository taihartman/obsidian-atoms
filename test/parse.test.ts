import { describe, expect, it } from "vitest";
import {
  collectPastNotesWithUnmarkedCaptures,
  isEmptyCaptureText,
  isMarkerLine,
  parseCaptures,
  unprocessedCaptures,
} from "../src/parse";

describe("parseCaptures — formats", () => {
  it("parses plain bullet thought", () => {
    const caps = parseCaptures("- plain thought\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("plain thought");
    expect(caps[0]!.timestamp).toBeNull();
    expect(caps[0]!.processed).toBe(false);
  });

  it("parses timestamped bullet", () => {
    const caps = parseCaptures("- 14:32 timestamped thought\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.timestamp).toBe("14:32");
    expect(caps[0]!.text).toBe("timestamped thought");
    expect(caps[0]!.processed).toBe(false);
  });
});

describe("parseCaptures — markers (KTD1)", () => {
  it("AE2: atom marker line marks capture processed", () => {
    const md = [
      "- sleep debt plateaus",
      "\t↳ [[Sleep debt doesn't accumulate linearly]] <!--linker-->",
      "",
    ].join("\n");
    const caps = parseCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.processed).toBe(true);
    expect(caps[0]!.markerKind).toBe("atom");
    expect(caps[0]!.text).toBe("sleep debt plateaus");
  });

  it("AE3: task marker marks processed without atom", () => {
    const md = ["- buy oat milk", "\t<!--linker:task-->", ""].join("\n");
    const caps = parseCaptures(md);
    expect(caps[0]!.processed).toBe(true);
    expect(caps[0]!.markerKind).toBe("task");
  });

  it("noise marker marks processed", () => {
    const md = ["- lol", "\t<!--linker:noise-->", ""].join("\n");
    expect(parseCaptures(md)[0]!.markerKind).toBe("noise");
    expect(parseCaptures(md)[0]!.processed).toBe(true);
  });

  it("wikilink inside capture text is NOT a marker (collision case)", () => {
    const md = "- reminded me of [[a user link]] but no marker yet\n";
    const caps = parseCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.processed).toBe(false);
    expect(caps[0]!.text).toContain("[[a user link]]");
    expect(isMarkerLine(caps[0]!.text)).toBe(false);
  });
});

describe("parseCaptures — multi-line extent", () => {
  it("treats indented continuations as one capture; marker after full extent", () => {
    const md = [
      "- first line of a long thought",
      "  second line still part of it",
      "\tthird line with tab indent",
      "\t↳ [[Long thought claim]] <!--linker-->",
      "- next capture",
    ].join("\n");
    const caps = parseCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.text).toBe(
      "first line of a long thought\nsecond line still part of it\nthird line with tab indent",
    );
    expect(caps[0]!.processed).toBe(true);
    expect(caps[0]!.markerKind).toBe("atom");
    // Continuations must not be mistaken for separate captures or markers.
    expect(caps[1]!.text).toBe("next capture");
    expect(caps[1]!.processed).toBe(false);
  });

  it("does not treat indented non-marker lines as markers", () => {
    const md = [
      "- thought with continuation",
      "  still going — mentions [[wikilink]] inside",
      "",
    ].join("\n");
    const caps = parseCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.processed).toBe(false);
    expect(caps[0]!.text).toContain("[[wikilink]]");
  });
});

describe("parseCaptures — empty / edge", () => {
  it("empty daily note → zero captures", () => {
    expect(parseCaptures("")).toEqual([]);
    expect(parseCaptures("\n\n")).toEqual([]);
  });

  it("heading-only note → zero captures", () => {
    expect(parseCaptures("# 2026-07-14\n\nJust prose, no bullets.\n")).toEqual(
      [],
    );
  });
});

describe("collectPastNotesWithUnmarkedCaptures — AE4 today excluded", () => {
  const fixtures = [
    {
      path: "2026-07-15.md",
      date: "2026-07-15",
      content: "- unmarked in today should never be returned\n",
    },
    {
      path: "2026-07-14.md",
      date: "2026-07-14",
      content: [
        "- unmarked yesterday",
        "- already done",
        "\t<!--linker:noise-->",
      ].join("\n"),
    },
    {
      path: "2026-07-13.md",
      date: "2026-07-13",
      content: "- fully marked\n\t↳ [[X]] <!--linker-->\n",
    },
  ];

  it("excludes today even with unmarked captures", () => {
    const notes = collectPastNotesWithUnmarkedCaptures(fixtures, "2026-07-15");
    expect(notes.map((n) => n.date)).toEqual(["2026-07-14"]);
    expect(notes[0]!.unprocessed.map((c) => c.text)).toEqual([
      "unmarked yesterday",
    ]);
  });

  it("includeToday keeps today's unmarked captures for manual force", () => {
    const notes = collectPastNotesWithUnmarkedCaptures(fixtures, "2026-07-15", {
      includeToday: true,
    });
    expect(notes.map((n) => n.date)).toEqual(["2026-07-14", "2026-07-15"]);
    expect(
      notes.find((n) => n.date === "2026-07-15")!.unprocessed.map((c) => c.text),
    ).toEqual(["unmarked in today should never be returned"]);
  });

  it("drops days whose captures are all marked", () => {
    const notes = collectPastNotesWithUnmarkedCaptures(fixtures, "2026-07-15");
    expect(notes.find((n) => n.date === "2026-07-13")).toBeUndefined();
  });

  it("unprocessedCaptures filters correctly", () => {
    const caps = parseCaptures(
      "- a\n\t<!--linker:task-->\n- b\n",
    );
    expect(unprocessedCaptures(caps).map((c) => c.text)).toEqual(["b"]);
  });

  it("skips empty bullet captures", () => {
    const caps = parseCaptures("- \n- real\n-   \n");
    expect(unprocessedCaptures(caps).map((c) => c.text)).toEqual(["real"]);
    expect(isEmptyCaptureText("")).toBe(true);
    expect(isEmptyCaptureText("  ")).toBe(true);
  });
});
