import { describe, expect, it } from "vitest";
import { parseCaptures } from "../src/pipeline/parse";
import {
  restoreSkippedInContent,
  unlabelNoticeMessage,
  unlabelSkippedInContent,
} from "../src/pipeline/unlabel";

const noiseDaily = [
  "- keepable thought",
  "\t<!--linker:noise-->",
  "- other",
  "\t<!--linker:task-->",
  "",
].join("\n");

describe("unlabelSkippedInContent", () => {
  it("strips noise marker; body unchanged", () => {
    const caps = parseCaptures(noiseDaily);
    const c = caps[0]!;
    const r = unlabelSkippedInContent(noiseDaily, {
      startLine: c.startLine,
      snippet: c.text,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("noise");
    expect(r.content).toContain("- keepable thought");
    expect(r.content).not.toContain("<!--linker:noise-->");
    const again = parseCaptures(r.content);
    expect(again[0]!.processed).toBe(false);
    expect(again[0]!.text).toBe("keepable thought");
  });

  it("strips task marker", () => {
    const caps = parseCaptures(noiseDaily);
    const c = caps[1]!;
    const r = unlabelSkippedInContent(noiseDaily, {
      startLine: c.startLine,
      snippet: c.text,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("task");
    expect(r.content).not.toContain("<!--linker:task-->");
  });

  it("refuses atom marker", () => {
    const md = [
      "- filed",
      "\t↳ [[Filed]] <!--linker-->",
      "",
    ].join("\n");
    const r = unlabelSkippedInContent(md, { startLine: 0, snippet: "filed" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("atom");
  });

  it("refuses unprocessed", () => {
    const md = "- open\n";
    const r = unlabelSkippedInContent(md, { startLine: 0, snippet: "open" });
    expect(r.ok).toBe(false);
  });
});

describe("restoreSkippedInContent", () => {
  it("round-trips strip then restore noise", () => {
    const caps = parseCaptures(noiseDaily);
    const c = caps[0]!;
    const stripped = unlabelSkippedInContent(noiseDaily, {
      startLine: c.startLine,
      snippet: c.text,
    });
    expect(stripped.ok).toBe(true);
    if (!stripped.ok) return;
    const restored = restoreSkippedInContent(stripped.content, {
      startLine: c.startLine,
      snippet: c.text,
      kind: "noise",
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const again = parseCaptures(restored.content);
    expect(again[0]!.markerKind).toBe("noise");
    expect(again[0]!.text).toBe("keepable thought");
  });

  it("refuses restore when already marked", () => {
    const caps = parseCaptures(noiseDaily);
    const c = caps[0]!;
    const r = restoreSkippedInContent(noiseDaily, {
      startLine: c.startLine,
      snippet: c.text,
      kind: "noise",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("already_marked");
  });
});

describe("unlabelNoticeMessage", () => {
  it("branches past vs today", () => {
    expect(unlabelNoticeMessage("2026-08-01", "2026-08-05")).toContain(
      "next Process",
    );
    expect(unlabelNoticeMessage("2026-08-05", "2026-08-05")).toContain(
      "Process today",
    );
  });
});
