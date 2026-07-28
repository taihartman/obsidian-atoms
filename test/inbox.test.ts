import { describe, expect, it } from "vitest";
import {
  INBOX_FILED_MARKER,
  isInboxFiledMarkerLine,
  parseInboxCaptures,
  pendingInboxCaptures,
  unparseableInboxCaptures,
} from "../src/pipeline/inbox";

describe("parseInboxCaptures — capture shape", () => {
  it("parses a single-line stamped capture", () => {
    const caps = parseInboxCaptures("- 2026-07-27T09:14-04:00 buy milk\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.time).toBe("09:14");
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.filed).toBe(false);
    expect(caps[0]!.unparseable).toBe(false);
  });

  it("accepts a stamp with seconds precision", () => {
    const caps = parseInboxCaptures("- 2026-07-27T09:14:03-04:00 buy milk\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.time).toBe("09:14");
    expect(caps[0]!.stamp).toBe("2026-07-27T09:14:03-04:00");
    expect(caps[0]!.text).toBe("buy milk");
  });

  it("accepts a Z-suffixed stamp", () => {
    const caps = parseInboxCaptures("- 2026-07-27T09:14Z thought\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.text).toBe("thought");
  });

  it("joins indented continuation lines into one capture", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 first line",
      "\tsecond line",
      "\tthird line",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("first line\nsecond line\nthird line");
  });

  it("keeps blank-line-separated captures separate", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 one",
      "",
      "- 2026-07-27T10:00-04:00 two",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.text).toBe("one");
    expect(caps[1]!.text).toBe("two");
  });

  it("skips empty bullets", () => {
    const caps = parseInboxCaptures("- \n- 2026-07-27T09:14-04:00 real\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("real");
  });

  it("ignores frontmatter and prose above the first bullet", () => {
    const md = [
      "---",
      "atoms-inbox: true",
      "---",
      "",
      "Captures land here. Do not edit by hand.",
      "",
      "- 2026-07-27T09:14-04:00 real capture",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("real capture");
  });
});

describe("parseInboxCaptures — day attribution", () => {
  it("derives the date from the stamp's own offset, not the device's", () => {
    // 23:40 on the 27th at -04:00 is the 28th in UTC. The capture belongs to
    // the 27th — the day it was made, where it was made.
    const caps = parseInboxCaptures("- 2026-07-27T23:40-04:00 late thought\n");
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.time).toBe("23:40");
  });

  it("attributes captures across a date boundary to their own days", () => {
    const md = [
      "- 2026-07-27T23:59-04:00 before midnight",
      "- 2026-07-28T00:01-04:00 after midnight",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps.map((c) => c.date)).toEqual(["2026-07-27", "2026-07-28"]);
  });
});

describe("parseInboxCaptures — filed markers", () => {
  it("marks a capture filed when the marker follows its extent", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 buy milk",
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.filed).toBe(true);
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.markerLine).toBe(1);
  });

  it("does not absorb the marker into a multi-line body", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 first line",
      "\tsecond line",
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps[0]!.text).toBe("first line\nsecond line");
    expect(caps[0]!.filed).toBe(true);
  });

  it("treats the sentinel inside capture text as body, not a marker", () => {
    const caps = parseInboxCaptures(
      `- 2026-07-27T09:14-04:00 note about ${INBOX_FILED_MARKER} syntax\n`,
    );
    expect(caps).toHaveLength(1);
    expect(caps[0]!.filed).toBe(false);
    expect(caps[0]!.text).toBe(`note about ${INBOX_FILED_MARKER} syntax`);
  });

  it("does not treat a daily-note linker marker as an inbox filed marker", () => {
    // The inbox owns its own sentinel; the daily's linker family must not
    // silently mark inbox captures filed (KTD9).
    expect(isInboxFiledMarkerLine("\t<!--linker:noise-->")).toBe(false);
    expect(
      isInboxFiledMarkerLine("\t↳ [[Some atom]] <!--linker-->"),
    ).toBe(false);
    expect(isInboxFiledMarkerLine(`\t${INBOX_FILED_MARKER}`)).toBe(true);
  });

  it("leaves a following capture unfiled", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 filed one",
      `\t${INBOX_FILED_MARKER}`,
      "- 2026-07-27T09:20-04:00 pending one",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.filed).toBe(true);
    expect(caps[1]!.filed).toBe(false);
  });
});

describe("parseInboxCaptures — unparseable lines", () => {
  it("flags a bullet with no stamp rather than dropping it", () => {
    const caps = parseInboxCaptures("- no stamp here\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.unparseable).toBe(true);
    expect(caps[0]!.date).toBeNull();
    expect(caps[0]!.text).toBe("no stamp here");
  });

  it("flags a malformed stamp rather than guessing a date", () => {
    const caps = parseInboxCaptures("- 2026-13-45T99:99-04:00 nonsense\n");
    expect(caps[0]!.unparseable).toBe(true);
    expect(caps[0]!.date).toBeNull();
  });

  it("keeps parsing valid captures after an unparseable one", () => {
    const md = [
      "- broken line",
      "- 2026-07-27T09:14-04:00 good one",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.unparseable).toBe(true);
    expect(caps[1]!.unparseable).toBe(false);
    expect(caps[1]!.text).toBe("good one");
  });
});

describe("inbox capture selectors", () => {
  const md = [
    "- 2026-07-27T09:14-04:00 filed",
    `\t${INBOX_FILED_MARKER}`,
    "- 2026-07-27T09:20-04:00 pending",
    "- broken",
    "",
  ].join("\n");

  it("pending excludes filed and unparseable captures", () => {
    const pending = pendingInboxCaptures(parseInboxCaptures(md));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.text).toBe("pending");
  });

  it("unparseable selects only the unreadable lines", () => {
    const bad = unparseableInboxCaptures(parseInboxCaptures(md));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.text).toBe("broken");
  });
});
