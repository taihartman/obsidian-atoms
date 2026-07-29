import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import {
  aggregateTagsFromFileCaches,
  buildContextPrefixBlock,
  buildTitlesBlock,
  buildVaultContext,
  collectLinkTargets,
  collectTitles,
  CONTEXT_BLOCK_SEPARATOR,
  DEFAULT_SHORTLIST_K,
  MetadataContextProvider,
  renderStablePrefix,
  titleFromPath,
} from "../src/pipeline/context";
import { buildContextUserMessage } from "../src/pipeline/classify";
import {
  approveProposedTag,
  eligibleTags,
  filterTagsToActive,
  mergeProposedTags,
  normalizeTag,
  STRUCTURAL_TAGS,
  tagCountsSorted,
} from "../src/pipeline/vocabulary";

describe("titles", () => {
  it("strips path and extension", () => {
    expect(titleFromPath("Atoms/Sleep debt.md")).toBe("Sleep debt");
    expect(titleFromPath("Daily/2026-07-14.md")).toBe("2026-07-14");
  });

  it("collects unique sorted titles", () => {
    expect(
      collectTitles(["b.md", "folder/a.md", "b.md", "Atoms/Z claim.md"]),
    ).toEqual(["a", "b", "Z claim"]);
  });
});

describe("tag aggregation (fallback path)", () => {
  it("counts inline tags + frontmatter tags", () => {
    const counts = aggregateTagsFromFileCaches([
      {
        path: "a.md",
        cache: {
          tags: [{ tag: "#idea" }, { tag: "#idea" }, { tag: "#health" }],
          frontmatter: { tags: ["decision", "idea"] },
        },
      },
      {
        path: "b.md",
        cache: {
          tags: [{ tag: "#health" }],
          frontmatter: { tags: "question, reference" },
        },
      },
      { path: "empty.md", cache: null },
    ]);
    expect(counts.get("idea")).toBe(3); // 2 inline + 1 fm
    expect(counts.get("health")).toBe(2);
    expect(counts.get("decision")).toBe(1);
    expect(counts.get("question")).toBe(1);
    expect(counts.get("reference")).toBe(1);
  });

  it("sorts by frequency then name", () => {
    const m = new Map([
      ["zebra", 1],
      ["idea", 5],
      ["alpha", 5],
    ]);
    expect(tagCountsSorted(m).map((x) => x.tag)).toEqual([
      "alpha",
      "idea",
      "zebra",
    ]);
  });
});

describe("buildVaultContext + stable prefix", () => {
  it("unions vault tags with Active vocabulary; deterministic order", () => {
    const ctx = buildVaultContext({
      titles: ["B note", "A note"],
      vaultTags: ["health", "idea"],
      activeVocabulary: ["idea", "question", "observation"],
    });
    expect(ctx.titles).toEqual(["A note", "B note"]);
    expect(ctx.vocabulary).toEqual([
      "idea",
      "list",
      "media",
      "movie",
      "observation",
      "person",
      "preferences",
      "question",
      "relationship",
      "show",
      "watch",
    ]);
    expect(ctx.tags).toEqual([
      "health",
      "idea",
      "list",
      "media",
      "movie",
      "observation",
      "person",
      "preferences",
      "question",
      "relationship",
      "show",
      "watch",
    ]);
  });

  it("handles empty vault / no tags", () => {
    const ctx = buildVaultContext({
      titles: [],
      vaultTags: [],
      activeVocabulary: ["idea"],
    });
    expect(ctx.titles).toEqual([]);
    expect(ctx.tags).toEqual([
      "idea",
      "list",
      "media",
      "movie",
      "person",
      "preferences",
      "relationship",
      "show",
      "watch",
    ]);
    expect(ctx.vocabulary).toEqual([
      "idea",
      "list",
      "media",
      "movie",
      "person",
      "preferences",
      "relationship",
      "show",
      "watch",
    ]);
  });

  it("cached block A survives two different captures; the titles block does not", () => {
    // The old version of this test rendered the *same* context twice and asserted the
    // bytes matched — true by construction, and green even once a per-capture shortlist
    // made the title list volatile. The property the cache actually needs is that the
    // cached block is stable across two captures whose shortlists differ.
    const base = {
      vaultTags: ["idea"],
      activeVocabulary: ["idea", "question"],
      personHubs: ["Alex"],
    };
    const first = buildVaultContext({ ...base, titles: ["Note one"] });
    const second = buildVaultContext({ ...base, titles: ["Note two"] });

    expect(buildContextPrefixBlock(first)).toBe(buildContextPrefixBlock(second));
    expect(buildTitlesBlock(first)).not.toBe(buildTitlesBlock(second));
    // renderStablePrefix means block A and nothing else — no title list rides along.
    expect(renderStablePrefix(first)).toBe(buildContextPrefixBlock(first));
    expect(renderStablePrefix(first)).not.toContain("### Note titles");

    // The two blocks still concatenate to exactly the one-string message.
    expect(
      buildContextPrefixBlock(first) +
        CONTEXT_BLOCK_SEPARATOR +
        buildTitlesBlock(first),
    ).toBe(buildContextUserMessage(first));

    const a = buildContextUserMessage(first);
    expect(a).toContain("### Person hubs");
    expect(a).toContain("- Alex");
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no dates embedded as data
    // Instruction text may mention "run IDs" as a prohibition — that's fine.
    expect(a).not.toMatch(/run-id[=:]/i);
  });

  it("empty person hubs render as (none)", () => {
    const ctx = buildVaultContext({
      titles: ["Note"],
      vaultTags: [],
      activeVocabulary: ["idea"],
    });
    expect(ctx.personHubs).toEqual([]);
    expect(buildContextUserMessage(ctx)).toContain(
      "### Person hubs (from your vault — prefer linking these exact titles)\n(none)",
    );
  });
});

describe("vocabulary (U5) + structural tags", () => {
  it("structural tags are always eligible", () => {
    const e = eligibleTags(["idea"]);
    for (const t of STRUCTURAL_TAGS) {
      expect(e).toContain(t);
    }
    expect(e).toContain("idea");
  });

  it("filters model tags to eligible (Active ∪ structural)", () => {
    expect(
      filterTagsToActive(
        ["idea", "health", "#Question", "noise-tag", "person", "preferences"],
        ["idea", "question"],
      ),
    ).toEqual(["idea", "person", "preferences", "question"]);
  });

  it("collectLinkTargets includes aliases", () => {
    expect(
      collectLinkTargets([
        {
          path: "Alex/Alex.md",
          cache: { frontmatter: { aliases: ["Al"] } },
        },
      ]),
    ).toEqual(["Al", "Alex"]);
  });

  it("merges proposed tags without auto-activating", () => {
    const proposed = mergeProposedTags(
      ["health"],
      ["health", "sleep", "idea"],
      ["idea"],
    );
    expect(proposed).toEqual(["health", "sleep"]);
    expect(proposed).not.toContain("idea");
  });

  it("approving proposed moves into Active", () => {
    const next = approveProposedTag("health", ["idea"], ["health", "sleep"]);
    expect(next.activeVocabulary).toEqual(["health", "idea"]);
    expect(next.proposedTags).toEqual(["sleep"]);
  });

  it("normalizeTag strips hash", () => {
    expect(normalizeTag("  #Idea ")).toBe("idea");
  });
});

// --- U3: the shortlist seam ------------------------------------------------

interface FakeFile {
  path: string;
  content: string;
  cache?: {
    tags?: Array<{ tag: string }>;
    frontmatter?: Record<string, unknown> | null;
  } | null;
}

/** Vault double that counts reads — the once-per-run contract is measured, not assumed. */
function fakeApp(files: FakeFile[]): { app: App; reads: () => number } {
  let reads = 0;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const app = {
    vault: {
      getMarkdownFiles: () => files.map((f) => ({ path: f.path })),
      cachedRead: async (file: { path: string }) => {
        reads += 1;
        return byPath.get(file.path)?.content ?? "";
      },
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => byPath.get(file.path)?.cache ?? null,
    },
  };
  return { app: app as unknown as App, reads: () => reads };
}

const fakeAtom = (title: string, capture: string, prose = ""): FakeFile => ({
  path: `Atoms/${title}.md`,
  content: `---
created: 2026-07-01T10:00:00
generated-by: linker
tags:
  - idea
---
${capture}${prose ? `\n\n${prose}` : ""}
`,
  cache: { frontmatter: { tags: ["idea"] } },
});

const SLEEP = fakeAtom(
  "Sleep debt compounds",
  "Sleep debt compounds across the week and wrecks my focus by Thursday",
);
const ESPRESSO = fakeAtom(
  "Espresso grind size",
  "Grinding the espresso finer pulled a sweeter shot this morning",
);
const KAYAK = fakeAtom(
  "Kayak trip planning",
  "Planning a kayak trip down the river next spring",
);
const ALEX: FakeFile = {
  path: "People/Alex.md",
  content: `---
tags:
  - person
aliases:
  - Al
---
Alex paddles a kayak most weekends.
`,
  cache: { frontmatter: { tags: ["person"], aliases: ["Al"] } },
};

const vault = () => fakeApp([SLEEP, ESPRESSO, KAYAK, ALEX]);
const provider = (app: App) => new MetadataContextProvider(app, () => ["idea"]);

describe("MetadataContextProvider.getCandidates (U3 shortlist seam)", () => {
  it("scores the argument: two captures get different shortlists", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const sleep = await run.getCandidates("sleep debt wrecked my focus");
    const coffee = await run.getCandidates("espresso tasted sweeter today");
    expect(sleep.titles[0]).toBe("Sleep debt compounds");
    expect(coffee.titles[0]).toBe("Espresso grind size");
    expect(sleep.titles).not.toEqual(coffee.titles);
  });

  it("caps at k and honours a configured non-default k", async () => {
    const { app } = vault();
    expect(DEFAULT_SHORTLIST_K).toBe(400);
    const wide = await (await provider(app).beginRun()).getCandidates(
      "sleep espresso kayak",
    );
    expect(wide.titles.length).toBeGreaterThan(1);
    const narrow = await (
      await provider(app).beginRun({ k: 1 })
    ).getCandidates("sleep espresso kayak");
    expect(narrow.titles).toHaveLength(1);
    expect(narrow.stats.k).toBe(1);
  });

  it("a capture matching nothing yields an empty shortlist, not a throw", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const ctx = await run.getCandidates("zzzz qqqq vvvv");
    expect(ctx.titles).toEqual([]);
    expect(ctx.shortlist).toEqual([]);
    // The rest of the context survives — tags and vocabulary are not shortlisted.
    expect(ctx.vocabulary).toContain("idea");
  });

  it("keeps person hubs linkable — hub list intact, alias reachable", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const ctx = await run.getCandidates("Al is paddling this weekend");
    expect(ctx.personHubs).toContain("Alex");
    expect(ctx.titles).toContain("Al");
  });

  it("dedupes by path so one note never occupies two slots", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const ctx = await run.getCandidates("Alex Al kayak weekends paddling");
    const alexSlots = ctx.shortlist.filter((c) => c.path === "People/Alex.md");
    expect(alexSlots).toHaveLength(1);
  });

  it("orders by score descending, not alphabetically", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const ctx = await run.getCandidates(
      "sleep debt wrecked my focus during the kayak trip",
    );
    expect(ctx.titles.length).toBeGreaterThan(1);
    const scores = ctx.shortlist.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(ctx.titles).not.toEqual(
      [...ctx.titles].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("seeds the corpus once per run, however many captures follow", async () => {
    const { app, reads } = vault();
    const run = await provider(app).beginRun();
    await run.getCandidates("sleep");
    await run.getCandidates("espresso");
    await run.getCandidates("kayak");
    expect(reads()).toBe(4); // one per markdown file, not per capture
  });

  it("an atom appended mid-run is scoreable by a later capture", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const before = await run.getCandidates("tandem bicycle brake cable");
    expect(before.titles).not.toContain("Tandem brake cable");

    run.addAtom({
      path: "Atoms/Tandem brake cable.md",
      title: "Tandem brake cable",
      body: "The tandem bicycle brake cable frayed on the descent",
      tags: ["idea"],
    });

    const after = await run.getCandidates("tandem bicycle brake cable");
    expect(after.titles).toContain("Tandem brake cable");
  });

  it("a new run re-seeds rather than reusing the previous run's corpus", async () => {
    const { app } = vault();
    const p = provider(app);
    const first = await p.beginRun();
    first.addAtom({
      path: "Atoms/Tandem brake cable.md",
      title: "Tandem brake cable",
      body: "The tandem bicycle brake cable frayed on the descent",
    });
    expect((await first.getCandidates("tandem brake cable")).titles).toContain(
      "Tandem brake cable",
    );
    first.end();

    // The vault double never gained that file, so a re-seeded run cannot see it.
    const second = await p.beginRun();
    expect(
      (await second.getCandidates("tandem brake cable")).titles,
    ).not.toContain("Tandem brake cable");
  });

  it("an ended run refuses further scoring instead of serving a stale corpus", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    run.end();
    run.end(); // idempotent
    await expect(run.getCandidates("sleep debt")).rejects.toThrow(/ended/i);
  });
});

describe("ContextRun.getChunkCandidates (U5 union)", () => {
  it("is a superset of each capture's own shortlist, deduped and score-ordered", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const sleep = await run.getCandidates("sleep debt wrecked my focus");
    const coffee = await run.getCandidates("espresso tasted sweeter today");
    const chunk = await run.getChunkCandidates([
      "sleep debt wrecked my focus",
      "espresso tasted sweeter today",
    ]);

    for (const t of [...sleep.titles, ...coffee.titles]) {
      expect(chunk.titles).toContain(t);
    }
    expect(new Set(chunk.titles).size).toBe(chunk.titles.length);
    const scores = chunk.shortlist.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("a chunk of one is exactly that capture's shortlist", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    const one = await run.getCandidates("sleep debt wrecked my focus");
    const chunk = await run.getChunkCandidates(["sleep debt wrecked my focus"]);
    expect(chunk.titles).toEqual(one.titles);
  });

  it("refuses to score after the run ends", async () => {
    const { app } = vault();
    const run = await provider(app).beginRun();
    run.end();
    await expect(run.getChunkCandidates(["anything"])).rejects.toThrow(
      /run has ended/,
    );
  });
});
