import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRefreshedAtomMarkdown,
  extractCaptureBody,
  keepAsAtomResult,
  parseImmutableFrontmatter,
  planRefreshApply,
  refreshChunkDate,
  repairMarkerTitleInDaily,
  runRefreshEligibleAtoms,
} from "../src/pipeline/refreshAtoms";
import { CURRENT_ATOMS_QUALITY } from "../src/pipeline/atomQuality";
import {
  atomResult as atomResult2,
  contextProviderFor as provider,
  fakeClassify,
  fakeVault,
  type VaultDouble,
} from "./helpers/pipelineVault";
import type { ClassificationResult } from "../src/shared/types";

afterEach(() => vi.restoreAllMocks());

const oldAtom = `---
created: 2026-07-01T10:00:00
source: "[[2026-07-01]]"
generated-by: linker
tags:
  - idea
---
sleep debt seems to plateau

preference about sleep.
`;

const atomResult = (): ClassificationResult => ({
  verdict: "atom",
  title: "Sleep debt plateaus",
  tags: ["idea"],
  proposed_tags: [],
  links: [{ note: "Old", reason: "revises [[Old]]" }],
});

describe("parseImmutableFrontmatter", () => {
  it("parses aliases with apostrophes without JSON errors", () => {
    const md = `---
created: 2026-07-15
source: "[[2026-07-15]]"
generated-by: linker
aliases:
  - "Sherry is Ning's friend from CRG who works at a hospital"
  - "Nichita likes Darkest Files because it makes her feel like a detective"
tags: []
---
body
`;
    const fm = parseImmutableFrontmatter(md);
    expect(fm.existingAliases).toContain(
      "Sherry is Ning's friend from CRG who works at a hospital",
    );
    expect(fm.existingAliases[0]).not.toMatch(/^"/);
  });
});

describe("extractCaptureBody", () => {
  it("splits on blank line and keeps capture only", () => {
    expect(extractCaptureBody(oldAtom)).toBe("sleep debt seems to plateau");
  });

  it("whole body when no blank split", () => {
    const md = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
tags: []
---
one block only
`;
    expect(extractCaptureBody(md)).toBe("one block only");
  });
});

describe("keepAsAtomResult (R13)", () => {
  it("forces noise to atom with fallback title", () => {
    const r = keepAsAtomResult(
      {
        verdict: "noise",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      "Old Title",
    );
    expect(r.verdict).toBe("atom");
    expect(r.title).toBe("Old Title");
  });
});

describe("buildRefreshedAtomMarkdown", () => {
  it("preserves created/source and capture body; stamps quality", () => {
    const capture = extractCaptureBody(oldAtom);
    const md = buildRefreshedAtomMarkdown({
      oldContent: oldAtom,
      captureText: capture,
      result: atomResult(),
      title: "Sleep debt plateaus",
      previousTitle: "weak old title",
      today: "2026-07-20",
    });
    expect(md).toContain("created: 2026-07-01T10:00:00");
    expect(md).toContain('source: "[[2026-07-01]]"');
    expect(md).toContain(`atoms-quality: ${CURRENT_ATOMS_QUALITY}`);
    expect(md).toContain("quality-updated: 2026-07-20");
    expect(md).toContain("sleep debt seems to plateau");
    expect(md).toContain("revises [[Old]]");
    expect(md).not.toContain("preference about sleep");
    expect(md).toContain("weak old title");
  });

  it("noise verdict still yields atom markdown with body", () => {
    const capture = extractCaptureBody(oldAtom);
    const md = buildRefreshedAtomMarkdown({
      oldContent: oldAtom,
      captureText: capture,
      result: {
        verdict: "noise",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      title: "Fallback Title",
      today: "2026-07-20",
    });
    expect(md).toContain("generated-by: linker");
    expect(md).toContain("sleep debt seems to plateau");
    expect(md).toContain(`atoms-quality: ${CURRENT_ATOMS_QUALITY}`);
  });
});

describe("planRefreshApply", () => {
  it("drops links to prior title / aliases as self", () => {
    const prior = "weak old title";
    const content = `---
created: 2026-07-01
source: "[[2026-07-01]]"
generated-by: linker
aliases:
  - "even older title"
tags: []
---
sleep debt seems to plateau

junk
`;
    const plan = planRefreshApply({
      path: "Atoms/weak old title.md",
      oldTitle: prior,
      oldContent: content,
      result: {
        verdict: "atom",
        title: "Sleep debt plateaus",
        tags: ["idea"],
        proposed_tags: [],
        links: [
          {
            note: prior,
            reason: `restates ([[${prior}]])`,
          },
          {
            note: "even older title",
            reason: "duplicate of ([[even older title]])",
          },
          {
            note: "Old",
            reason: "revises [[Old]]",
          },
        ],
      },
      atomFolder: "Atoms",
      existingAtomPaths: new Set(["Atoms/weak old title.md"]),
      today: "2026-07-20",
    });
    expect(plan.content).toContain("revises [[Old]]");
    // Prior titles may remain as frontmatter aliases; must not appear as body links
    const body = plan.content.split("\n---\n").slice(1).join("\n---\n");
    expect(body).not.toContain(`[[${prior}]]`);
    expect(body).not.toContain("[[even older title]]");
  });

  it("plans rename when title changes and path free", () => {
    const plan = planRefreshApply({
      path: "Atoms/weak old title.md",
      oldTitle: "weak old title",
      oldContent: oldAtom,
      result: atomResult(),
      atomFolder: "Atoms",
      existingAtomPaths: new Set(["Atoms/weak old title.md"]),
      today: "2026-07-20",
    });
    expect(plan.rename).toBe(true);
    expect(plan.newPath).toBe("Atoms/Sleep debt plateaus.md");
    expect(plan.captureText).toBe("sleep debt seems to plateau");
  });

  it("skips rename on collision", () => {
    const plan = planRefreshApply({
      path: "Atoms/weak old title.md",
      oldTitle: "weak old title",
      oldContent: oldAtom,
      result: atomResult(),
      atomFolder: "Atoms",
      existingAtomPaths: new Set([
        "Atoms/weak old title.md",
        "Atoms/Sleep debt plateaus.md",
      ]),
      today: "2026-07-20",
    });
    expect(plan.rename).toBe(false);
    expect(plan.newPath).toBe("Atoms/weak old title.md");
  });
});

describe("repairMarkerTitleInDaily", () => {
  it("retargets plugin marker only", () => {
    const daily = `- sleep debt seems to plateau
	↳ [[weak old title]] <!--linker-->
- other bullet
`;
    const r = repairMarkerTitleInDaily(
      daily,
      "sleep debt seems to plateau",
      "weak old title",
      "Sleep debt plateaus",
    );
    expect(r.changed).toBe(true);
    expect(r.content).toContain("[[Sleep debt plateaus]]");
    expect(r.content).toContain("- sleep debt seems to plateau");
    expect(r.content).toContain("- other bullet");
  });
});

// --- U5: refresh routes through the shortlist seam, chunked ---------------------------------

/** A refile-eligible atom: quality below current, no links, so `rankRefileCandidates` takes it. */
const staleAtom = (source: string, capture: string) => `---
created: ${source}
source: "[[${source}]]"
generated-by: linker
atoms-quality: 1
tags:
  - idea
---
${capture}
`;

/** `listLinkerAtoms` reads `f.stat.mtime`; the obsidian double has no stat. */
const withStats = (v: VaultDouble): VaultDouble => {
  for (const f of v.app.vault.getMarkdownFiles()) {
    (f as unknown as { stat: { mtime: number } }).stat = { mtime: 1 };
  }
  return v;
};

const refreshVault = () =>
  withStats(
    fakeVault({
      // Two January atoms and one March atom — two monthly chunks.
      "Atoms/jan one.md": staleAtom("2026-01-05", "the tandem brake cable snapped on the descent"),
      "Atoms/jan two.md": staleAtom("2026-01-20", "espresso grind size changed the extraction"),
      "Atoms/mar one.md": staleAtom("2026-03-08", "the kayak portage route was flooded"),
      // Linkable neighbours, not themselves refile-eligible.
      "Notes/Tandem maintenance.md": "the tandem brake cable and its housing\n",
      "Notes/Espresso dialling.md": "espresso grind size and extraction notes\n",
      "Notes/Kayak routes.md": "kayak portage route notes\n",
    }),
  );

const titlesBlock = (parts: Array<{ text?: string }>) => parts[1]?.text ?? "";

describe("runRefreshEligibleAtoms — chunked shortlist (U5)", () => {
  it("sends one BYTE-IDENTICAL titles block per chunk, and a different one across chunks", async () => {
    const v = refreshVault();
    const classify = fakeClassify([atomResult2("A"), atomResult2("B"), atomResult2("C")]);

    await runRefreshEligibleAtoms({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      skipPolish: true,
      classifyDeps: { request: classify.request as never },
    });

    expect(classify.contextParts).toHaveLength(3);
    const blocks = classify.contextParts.map(titlesBlock);
    // January's two atoms share a chunk: same bytes, exactly.
    expect(blocks[0]).toBe(blocks[1]);
    // March is its own chunk and must not be handed January's list.
    expect(blocks[2]).not.toBe(blocks[0]);
  });

  it("caches the titles block for a multi-atom chunk and not for a lone one", async () => {
    const v = refreshVault();
    const classify = fakeClassify([atomResult2("A"), atomResult2("B"), atomResult2("C")]);

    await runRefreshEligibleAtoms({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      skipPolish: true,
      classifyDeps: { request: classify.request as never },
    });

    const cache = classify.contextParts.map((p) => p[1]?.cache_control);
    expect(cache[0]).toEqual({ type: "ephemeral", ttl: "5m" });
    expect(cache[1]).toEqual({ type: "ephemeral", ttl: "5m" });
    // March holds one atom — a cache write nothing would read back.
    expect(cache[2]).toBeUndefined();
    // Block A's breakpoint is untouched throughout.
    for (const p of classify.contextParts) {
      expect(p[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
    }
  });

  it("scores against the capture, not the atom's current title", async () => {
    // Title says one thing, the user's verbatim capture says another. Retrieval must follow
    // the capture — the title is the paraphrase this refresh exists to replace.
    const v = withStats(
      fakeVault({
        "Atoms/Unrelated placeholder title.md": staleAtom(
          "2026-01-05",
          "the kayak portage route was flooded again",
        ),
        "Notes/Kayak routes.md": "kayak portage route notes for the flooded season\n",
        "Notes/Placeholder trivia.md": "unrelated placeholder title trivia\n",
      }),
    );
    const classify = fakeClassify([atomResult2("Kayak portage flooded")]);

    await runRefreshEligibleAtoms({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      skipPolish: true,
      classifyDeps: { request: classify.request as never },
    });

    const block = titlesBlock(classify.contextParts[0]!);
    const kayak = block.indexOf("Kayak routes");
    const placeholder = block.indexOf("Placeholder trivia");
    expect(kayak).toBeGreaterThanOrEqual(0);
    // Score order, so the capture's match outranks the title's.
    expect(placeholder === -1 || kayak < placeholder).toBe(true);
  });

  it("passes expandGraph:false — a catch-up must not pay for the walk (KTD7)", async () => {
    const v = refreshVault();
    const p = provider(v.app);
    const spy = vi.spyOn(p, "beginRun");
    const classify = fakeClassify([atomResult2("A")]);

    await runRefreshEligibleAtoms({
      app: v.app,
      contextProvider: p,
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      skipPolish: true,
      shortlistK: 40,
      classifyDeps: { request: classify.request as never },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ expandGraph: false, shortlistK: 40 }),
    );
  });

  it("tolerates an empty shortlist", async () => {
    const v = withStats(
      fakeVault({
        "Atoms/only one.md": staleAtom("2026-01-05", "a lone thought with no neighbours"),
      }),
    );
    const classify = fakeClassify([atomResult2("Lone thought")]);

    const report = await runRefreshEligibleAtoms({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      skipPolish: true,
      classifyDeps: { request: classify.request as never },
    });

    expect(report.failed).toBe(0);
    // Only the atom itself is in the corpus, so nothing else can be offered.
    expect(titlesBlock(classify.contextParts[0]!)).not.toContain("- Notes");
  });
});

describe("refreshChunkDate", () => {
  it("prefers the source daily over the created stamp", () => {
    expect(
      refreshChunkDate(staleAtom("2026-01-05", "x").replace("created: 2026-01-05", "created: 2026-09-09")),
    ).toBe("2026-01-05");
  });

  it("falls back to created when the source is not a date", () => {
    const content = `---
created: 2026-04-02
source: "[[Some note]]"
generated-by: linker
---
body
`;
    expect(refreshChunkDate(content)).toBe("2026-04-02");
  });
});
