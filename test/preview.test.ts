import { describe, expect, it } from "vitest";
import {
  buildPreviewEntry,
  renderPreviewMarkdown,
  type DryRunReport,
} from "../src/pipeline/preview";
import { markerLineForDecision, formatLinkProse } from "../src/pipeline/render";
import type { Capture, DailyNoteWithCaptures } from "../src/shared/types";

const capture: Capture = {
  text: "sleep debt seems to plateau",
  timestamp: "14:32",
  startLine: 0,
  endLine: 0,
  processed: false,
  markerKind: null,
  markerLine: null,
};

const note: DailyNoteWithCaptures = {
  path: "Daily/2026-07-14.md",
  date: "2026-07-14",
  captures: [capture],
  unprocessed: [capture],
};

describe("markerLineForDecision (KTD1)", () => {
  it("atom marker shape", () => {
    expect(markerLineForDecision("atom", "Sleep debt plateaus")).toBe(
      "\t↳ [[Sleep debt plateaus]] <!--linker-->",
    );
  });
  it("task / noise sentinel-only", () => {
    expect(markerLineForDecision("task", "")).toBe("\t<!--linker:task-->");
    expect(markerLineForDecision("noise", "")).toBe("\t<!--linker:noise-->");
  });
});

describe("buildPreviewEntry + renderPreviewMarkdown (AE5 shape)", () => {
  it("lists verdict, title, links, marker for atom", () => {
    const entry = buildPreviewEntry({
      note,
      capture,
      atomFolder: "Atoms",
      outcome: {
        ok: true,
        result: {
          verdict: "atom",
          title: "Sleep debt plateaus",
          tags: ["idea"],
          proposed_tags: ["health"],
          links: [
            {
              note: "Old claim",
              reason: "revises [[Old claim]]",
            },
          ],
        },
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        keyFingerprint: "…test",
      },
    });

    expect(entry.wouldWriteMarker).toContain("<!--linker-->");
    expect(entry.wouldCreateAtomPath).toBe("Atoms/Sleep debt plateaus.md");

    const report: DryRunReport = {
      entries: [entry],
      totalUnprocessedScanned: 1,
      classified: 1,
      failed: 0,
      personHubMisses: 0,
      wroteNothing: true,
      generatedAt: "2026-07-15T00:00:00.000Z",
    };
    const md = renderPreviewMarkdown(report);
    expect(md).toContain("**Verdict:** `atom`");
    expect(md).toContain("Sleep debt plateaus");
    expect(md).toContain("revises [[Old claim]]");
    expect(md).toContain("<!--linker-->");
    expect(md).toContain("nothing was written");
    expect(md).toContain("sleep debt seems to plateau");
  });

  it("task entry has task marker and no atom path", () => {
    const entry = buildPreviewEntry({
      note,
      capture: { ...capture, text: "buy milk" },
      atomFolder: "Atoms",
      outcome: {
        ok: true,
        result: {
          verdict: "task",
          title: "",
          tags: [],
          proposed_tags: [],
          links: [],
        },
        usage: emptyU(),
        keyFingerprint: "…",
      },
    });
    expect(entry.wouldCreateAtomPath).toBeNull();
    expect(entry.wouldWriteMarker).toBe("\t<!--linker:task-->");
  });

  it("flags person-shaped atom with no hub match", () => {
    const entry = buildPreviewEntry({
      note,
      capture: {
        ...capture,
        text: "Alex likes periwinkle pajamas",
      },
      atomFolder: "Atoms",
      hubs: [],
      outcome: {
        ok: true,
        result: {
          verdict: "atom",
          title: "Alex prefers periwinkle",
          tags: ["preferences"],
          proposed_tags: [],
          links: [],
        },
        usage: emptyU(),
        keyFingerprint: "…",
      },
    });
    expect(entry.personHubMiss).toBe(true);
    const md = renderPreviewMarkdown({
      entries: [entry],
      totalUnprocessedScanned: 1,
      classified: 1,
      failed: 0,
      personHubMisses: 1,
      wroteNothing: true,
      generatedAt: "t",
    });
    expect(md).toContain("No person hub matched");
  });

  it("does not flag when hub is linked", () => {
    const entry = buildPreviewEntry({
      note,
      capture: {
        ...capture,
        text: "Alex likes periwinkle pajamas",
      },
      atomFolder: "Atoms",
      hubs: [
        {
          canonicalTitle: "Alex",
          matchKeys: ["Alex"],
          path: "People/Alex.md",
        },
      ],
      outcome: {
        ok: true,
        result: {
          verdict: "atom",
          title: "Alex prefers periwinkle",
          tags: ["person", "preferences"],
          proposed_tags: [],
          links: [
            { note: "Alex", reason: "preference about [[Alex]]" },
          ],
        },
        usage: emptyU(),
        keyFingerprint: "…",
      },
    });
    expect(entry.personHubMiss).toBe(false);
  });

  it("failed classification still appears in preview", () => {
    const entry = buildPreviewEntry({
      note,
      capture,
      atomFolder: "Atoms",
      outcome: {
        ok: false,
        reason: "offline",
        message: "Network error",
      },
    });
    const md = renderPreviewMarkdown({
      entries: [entry],
      totalUnprocessedScanned: 1,
      classified: 0,
      failed: 1,
      personHubMisses: 0,
      wroteNothing: true,
      generatedAt: "t",
    });
    expect(md).toContain("FAILED");
    expect(md).toContain("offline");
  });
});

describe("formatLinkProse", () => {
  it("keeps supersession reason readable", () => {
    expect(
      formatLinkProse([
        { note: "X", reason: "revises [[X]]" },
      ]),
    ).toContain("revises [[X]]");
  });
});

function emptyU() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}
