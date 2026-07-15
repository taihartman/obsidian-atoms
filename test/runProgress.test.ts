import { describe, expect, it } from "vitest";
import {
  formatRunSummary,
  progressLabel,
  progressPercent,
  snippetCapture,
  summaryFromDryRun,
  type RunSummary,
} from "../src/runProgress";
import type { DryRunReport } from "../src/preview";
import type { Capture } from "../src/types";

const cap: Capture = {
  text: "x",
  timestamp: null,
  startLine: 0,
  endLine: 0,
  processed: false,
  markerKind: null,
  markerLine: null,
};

describe("formatRunSummary", () => {
  it("formats mixed verdicts", () => {
    const s: RunSummary = {
      atoms: 2,
      tasks: 1,
      noise: 2,
      failed: 0,
      mode: "process",
    };
    expect(formatRunSummary(s)).toBe("Done · 2 atoms · 1 task · 2 noise");
  });

  it("handles empty / all failed", () => {
    expect(
      formatRunSummary({
        atoms: 0,
        tasks: 0,
        noise: 0,
        failed: 0,
        mode: "preview",
      }),
    ).toBe("Nothing to preview");
    expect(
      formatRunSummary({
        atoms: 0,
        tasks: 0,
        noise: 0,
        failed: 3,
        mode: "process",
      }),
    ).toBe("Done · 3 failed");
  });
});

describe("progress helpers", () => {
  it("percent and label", () => {
    expect(progressPercent(3, 12)).toBe(25);
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressLabel("process", 2, 5)).toBe("Processing 2 of 5");
    expect(progressLabel("preview", 1, 3)).toBe("Previewing 1 of 3");
  });

  it("snippet truncates", () => {
    expect(snippetCapture("short")).toBe("short");
    expect(snippetCapture("a".repeat(100)).length).toBeLessThanOrEqual(72);
  });
});

describe("summaryFromDryRun", () => {
  it("tallies entries", () => {
    const report: DryRunReport = {
      entries: [
        {
          dailyPath: "a.md",
          date: "2026-07-15",
          capture: cap,
          outcome: {
            ok: true,
            result: {
              verdict: "atom",
              title: "T",
              tags: [],
              proposed_tags: [],
              links: [],
            },
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            keyFingerprint: "x",
          },
          wouldWriteMarker: null,
          wouldCreateAtomPath: null,
        },
        {
          dailyPath: "a.md",
          date: "2026-07-15",
          capture: cap,
          outcome: {
            ok: true,
            result: {
              verdict: "noise",
              title: "",
              tags: [],
              proposed_tags: [],
              links: [],
            },
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            keyFingerprint: "x",
          },
          wouldWriteMarker: null,
          wouldCreateAtomPath: null,
        },
      ],
      totalUnprocessedScanned: 2,
      classified: 2,
      failed: 0,
      wroteNothing: true,
      generatedAt: "t",
    };
    const s = summaryFromDryRun(report);
    expect(s.atoms).toBe(1);
    expect(s.noise).toBe(1);
    expect(formatRunSummary(s)).toContain("1 atom");
  });
});
