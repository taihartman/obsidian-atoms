import { describe, expect, it } from "vitest";
import {
  buildPolishedAtomMarkdown,
  computeLinkStats,
  extractCaptureBody,
  planLocalPolish,
  rankRefileCandidates,
  refileScore,
  type EligibleAtom,
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

describe("rankRefileCandidates", () => {
  it("prefers empty-link over older strong-linked", () => {
    const vault = new Set(["alex", "old"]);
    const empty: EligibleAtom & {
      stats: ReturnType<typeof computeLinkStats>;
      mtime: number;
    } = {
      path: "Atoms/Empty.md",
      title: "Empty",
      content: weakAtom("Empty", 0, ""),
      quality: 0,
      mtime: 100,
      stats: { linkCount: 0, weakOrJunkCount: 0, brokenCount: 0 },
    };
    // fix empty content - no link prose
    empty.content = `---
created: 2026-07-01
generated-by: linker
atoms-quality: 0
tags: []
---
just a capture with no links
`;
    empty.stats = computeLinkStats(empty.content, vault);

    const strong: EligibleAtom & {
      stats: ReturnType<typeof computeLinkStats>;
      mtime: number;
    } = {
      path: "Atoms/Strong.md",
      title: "Strong",
      content: weakAtom("Strong", 0, "revises [[Old]]."),
      quality: 0,
      mtime: 1,
      stats: computeLinkStats(
        weakAtom("Strong", 0, "revises [[Old]]."),
        vault,
      ),
    };

    const ranked = rankRefileCandidates([strong, empty], 1);
    expect(ranked[0]!.path).toBe("Atoms/Empty.md");
    expect(
      refileScore({
        quality: empty.quality,
        stats: empty.stats,
        mtime: empty.mtime,
      }),
    ).toBeGreaterThan(
      refileScore({
        quality: strong.quality,
        stats: strong.stats,
        mtime: strong.mtime,
      }),
    );
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
