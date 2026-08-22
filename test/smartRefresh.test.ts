import { describe, expect, it } from "vitest";
import {
  buildPolishedAtomMarkdown,
  computeLinkStats,
  extractCaptureBody,
  planLocalPolish,
  rankRefileCandidates,
  refileRecencyMs,
  type EligibleAtom,
  type LinkStats,
} from "../src/pipeline/refreshAtoms";
import { parseAtomsQuality } from "../src/pipeline/atomQuality";
import { isWeakLinkReason } from "../src/pipeline/enrich/linkQuality";

const weakAtom = (title: string, quality: number, reason: string) => `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
atoms-quality: ${quality}
quality-updated: 2026-07-01
tags:
  - person
---
Alex likes the color periwinkle

${reason}
`;

describe("planLocalPolish", () => {
  it("rewrites weak reason without bumping quality", () => {
    const content = weakAtom("Alex likes periwinkle", 3, "preference about [[Alex]].");
    const plan = planLocalPolish({
      path: "Atoms/Alex likes periwinkle.md",
      title: "Alex likes periwinkle",
      content,
      today: "2026-07-17",
    });
    expect(plan).not.toBeNull();
    expect(extractCaptureBody(plan!.content)).toBe(
      "Alex likes the color periwinkle",
    );
    expect(parseAtomsQuality(plan!.content)).toBe(3);
    expect(plan!.content).toContain("links-polished: 2026-07-17");
    expect(isWeakLinkReason("preference about [[Alex]]")).toBe(true);
    expect(plan!.content.toLowerCase()).not.toMatch(/preference about/);
  });

  it("no-ops on strong supersession only", () => {
    const content = weakAtom(
      "Sleep claim",
      5,
      "revises [[Old sleep claim]].",
    );
    const plan = planLocalPolish({
      path: "Atoms/Sleep claim.md",
      title: "Sleep claim",
      content,
    });
    expect(plan).toBeNull();
  });
});

describe("refileRecencyMs", () => {
  it("uses the source daily day, not missing created as today", () => {
    const content = `---
source: "[[2026-03-08]]"
generated-by: linker
atoms-quality: 0
tags: []
---
capture
`;
    const ms = refileRecencyMs(content);
    expect(ms).toBe(new Date(2026, 2, 8, 12, 0, 0, 0).getTime());
  });

  it("falls back to created when source is missing", () => {
    const content = `---
created: 2026-04-02T09:15:00
generated-by: linker
atoms-quality: 0
tags: []
---
capture
`;
    expect(refileRecencyMs(content)).toBe(
      new Date(2026, 3, 2, 9, 15, 0, 0).getTime(),
    );
  });

  it("does not treat a missing created field as today", () => {
    const content = `---
generated-by: linker
atoms-quality: 0
tags: []
---
capture
`;
    expect(refileRecencyMs(content)).toBeNull();
  });

  it("strips .md from a source daily wikilink", () => {
    const content = `---
source: "[[2026-03-08.md]]"
generated-by: linker
atoms-quality: 0
tags: []
---
capture
`;
    expect(refileRecencyMs(content)).toBe(
      new Date(2026, 2, 8, 12, 0, 0, 0).getTime(),
    );
  });
});

function rankItem(opts: {
  path: string;
  title: string;
  source?: string;
  created?: string;
  quality?: number;
  prose?: string;
  mtime?: number;
}): EligibleAtom & { stats: LinkStats; mtime: number } {
  const quality = opts.quality ?? 0;
  const lines = [
    opts.created !== undefined ? `created: ${opts.created}` : null,
    opts.source !== undefined ? `source: "[[${opts.source}]]"` : null,
    "generated-by: linker",
    `atoms-quality: ${quality}`,
    "tags: []",
  ].filter((line): line is string => line !== null);
  const content = `---
${lines.join("\n")}
---
${opts.prose ?? "just a capture with no links"}
`;
  return {
    path: opts.path,
    title: opts.title,
    content,
    quality,
    mtime: opts.mtime ?? 1,
    stats: computeLinkStats(content, new Set(["old", "alex"])),
  };
}

describe("rankRefileCandidates", () => {
  it("prefers a newer source-day healthy-linked atom over an older empty-link atom", () => {
    const olderEmpty = rankItem({
      path: "Atoms/Empty.md",
      title: "Empty",
      source: "2026-01-01",
      created: "2026-01-01",
      prose: "just a capture with no links",
    });
    const newerStrong = rankItem({
      path: "Atoms/Strong.md",
      title: "Strong",
      source: "2026-07-01",
      created: "2026-07-01",
      prose: "revises [[Old]].",
    });
    const ranked = rankRefileCandidates([olderEmpty, newerStrong], 1);
    expect(ranked[0]!.path).toBe("Atoms/Strong.md");
  });

  it("among empty-link atoms, newer source day wins", () => {
    const older = rankItem({
      path: "Atoms/Older.md",
      title: "Older",
      source: "2026-01-01",
    });
    const newer = rankItem({
      path: "Atoms/Newer.md",
      title: "Newer",
      source: "2026-06-01",
    });
    const ranked = rankRefileCandidates([older, newer], 1);
    expect(ranked[0]!.path).toBe("Atoms/Newer.md");
  });

  it("at equal source day, newer created wins", () => {
    // Later path on the *older* created stamp, so path sort cannot fake the win.
    const morning = rankItem({
      path: "Atoms/Alpha.md",
      title: "Alpha",
      source: "2026-06-01",
      created: "2026-06-01T08:00:00",
    });
    const evening = rankItem({
      path: "Atoms/Zulu.md",
      title: "Zulu",
      source: "2026-06-01",
      created: "2026-06-01T20:00:00",
    });
    const ranked = rankRefileCandidates([morning, evening], 1);
    expect(ranked[0]!.path).toBe("Atoms/Zulu.md");
    const swapped = rankRefileCandidates(
      [
        rankItem({
          path: "Atoms/Alpha.md",
          title: "Alpha",
          source: "2026-06-01",
          created: "2026-06-01T20:00:00",
        }),
        rankItem({
          path: "Atoms/Zulu.md",
          title: "Zulu",
          source: "2026-06-01",
          created: "2026-06-01T08:00:00",
        }),
      ],
      1,
    );
    expect(swapped[0]!.path).toBe("Atoms/Alpha.md");
  });

  it("day-only created still ranks when source is missing", () => {
    const stamped = rankItem({
      path: "Atoms/Stamped.md",
      title: "Stamped",
      created: "2026-05-03",
    });
    const unstamped = rankItem({
      path: "Atoms/Unstamped.md",
      title: "Unstamped",
    });
    const ranked = rankRefileCandidates([unstamped, stamped], 1);
    expect(ranked[0]!.path).toBe("Atoms/Stamped.md");
  });

  it("missing both stamps sort last by path", () => {
    const b = rankItem({ path: "Atoms/B.md", title: "B" });
    const a = rankItem({ path: "Atoms/A.md", title: "A" });
    const dated = rankItem({
      path: "Atoms/Dated.md",
      title: "Dated",
      source: "2026-01-01",
    });
    const ranked = rankRefileCandidates([b, dated, a], 3);
    expect(ranked.map((r) => r.path)).toEqual([
      "Atoms/Dated.md",
      "Atoms/A.md",
      "Atoms/B.md",
    ]);
  });

  it("raising mtime on the loser does not change order", () => {
    const older = rankItem({
      path: "Atoms/Older.md",
      title: "Older",
      source: "2026-01-01",
      mtime: 9e15,
    });
    const newer = rankItem({
      path: "Atoms/Newer.md",
      title: "Newer",
      source: "2026-06-01",
      mtime: 1,
    });
    const ranked = rankRefileCandidates([older, newer], 1);
    expect(ranked[0]!.path).toBe("Atoms/Newer.md");
  });

  it("at equal recency, empty-link beats healthy-linked", () => {
    const empty = rankItem({
      path: "Atoms/Empty.md",
      title: "Empty",
      source: "2026-06-01",
    });
    const strong = rankItem({
      path: "Atoms/Strong.md",
      title: "Strong",
      source: "2026-06-01",
      prose: "revises [[Old]].",
    });
    const ranked = rankRefileCandidates([strong, empty], 1);
    expect(ranked[0]!.path).toBe("Atoms/Empty.md");
  });

  it("excludes atoms already at CURRENT before ranking", () => {
    const current = rankItem({
      path: "Atoms/Current.md",
      title: "Current",
      source: "2026-08-01",
      quality: 9,
    });
    const stale = rankItem({
      path: "Atoms/Stale.md",
      title: "Stale",
      source: "2026-01-01",
      quality: 1,
    });
    const ranked = rankRefileCandidates([current, stale], 15);
    expect(ranked.map((r) => r.path)).toEqual(["Atoms/Stale.md"]);
  });
});

describe("buildPolishedAtomMarkdown", () => {
  it("keeps capture and quality", () => {
    const old = weakAtom("T", 4, "preference about [[Alex]].");
    const md = buildPolishedAtomMarkdown({
      oldContent: old,
      captureText: "Alex likes the color periwinkle",
      result: {
        verdict: "atom",
        title: "T",
        tags: ["person"],
        proposed_tags: [],
        links: [
          {
            note: "Alex",
            reason: "concrete aesthetic preference for gifts / clothes ([[Alex]])",
          },
        ],
      },
      title: "T",
      today: "2026-07-17",
    });
    expect(parseAtomsQuality(md)).toBe(4);
    expect(md).toContain("Alex likes the color periwinkle");
    expect(md).toContain("links-polished: 2026-07-17");
  });
});
