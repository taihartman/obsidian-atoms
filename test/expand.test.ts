import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import {
  buildLinkGraph,
  expandFromSeeds,
  EXPANSION_SLOTS,
  type LinkGraph,
} from "../src/pipeline/expand";
import { buildCandidateCorpus } from "../src/pipeline/candidates";
import { MetadataContextProvider } from "../src/pipeline/context";
import { rankShortlist } from "../src/pipeline/shortlist";

// --- the pure walk ---------------------------------------------------------

/** Undirected adjacency from `a -> b` pairs, so the fixtures read as edges. */
function graphOf(edges: Array<[string, string]>): LinkGraph {
  const resolved: Record<string, Record<string, number>> = {};
  for (const [a, b] of edges) {
    resolved[a] = { ...(resolved[a] ?? {}), [b]: 1 };
  }
  return buildLinkGraph(resolved);
}

const NO_HUBS: ReadonlySet<string> = new Set<string>();

describe("buildLinkGraph", () => {
  it("makes Obsidian's outbound-only index undirected", () => {
    const g = buildLinkGraph({ "a.md": { "b.md": 1 } });
    expect([...(g.get("a.md") ?? [])]).toEqual(["b.md"]);
    expect([...(g.get("b.md") ?? [])]).toEqual(["a.md"]);
  });

  it("survives a vault with no link index at all", () => {
    expect(buildLinkGraph(undefined).size).toBe(0);
  });
});

describe("expandFromSeeds (hub-blocked 2-hop walk)", () => {
  it("reaches a note two hops out — the whole point, since a zero score is absolute", () => {
    const g = graphOf([
      ["seed.md", "one-hop.md"],
      ["one-hop.md", "two-hop.md"],
    ]);
    expect(expandFromSeeds(["seed.md"], { graph: g, hubPaths: NO_HUBS })).toEqual([
      "one-hop.md",
      "two-hop.md",
    ]);
  });

  it("blocks traversal *through* a hub: the hub is reached, its 40 neighbours are not", () => {
    const g = graphOf([
      ["seed.md", "People/Alex.md"],
      ...Array.from(
        { length: 40 },
        (_, i) => ["People/Alex.md", `far/${i}.md`] as [string, string],
      ),
    ]);
    const hubbed = expandFromSeeds(["seed.md"], {
      graph: g,
      hubPaths: new Set(["People/Alex.md"]),
    });
    expect(hubbed).toEqual(["People/Alex.md"]);

    // Same graph, hub traversable: the flood expansion exists to prevent.
    const flooded = expandFromSeeds(["seed.md"], { graph: g, hubPaths: NO_HUBS });
    expect(flooded.length).toBe(EXPANSION_SLOTS);
  });

  it("never reaches another graph component, at any depth", () => {
    const g = graphOf([
      ["seed.md", "near.md"],
      ["near.md", "nearer.md"],
      ["island-a.md", "island-b.md"],
    ]);
    const reached = expandFromSeeds(["seed.md"], { graph: g, hubPaths: NO_HUBS });
    expect(reached).not.toContain("island-a.md");
    expect(reached).not.toContain("island-b.md");
  });

  it("adds a bounded number of slots, not an unbounded set", () => {
    const g = graphOf(
      Array.from({ length: 500 }, (_, i) => ["seed.md", `n${i}.md`] as [string, string]),
    );
    expect(expandFromSeeds(["seed.md"], { graph: g, hubPaths: NO_HUBS })).toHaveLength(
      EXPANSION_SLOTS,
    );
  });

  it("walks only the top seeds, but never returns a note already shortlisted", () => {
    const g = graphOf([
      ["top.md", "reached.md"],
      ["deep.md", "not-walked.md"],
      ["reached.md", "already-listed.md"],
    ]);
    const reached = expandFromSeeds(["top.md", "already-listed.md", "deep.md"], {
      graph: g,
      hubPaths: NO_HUBS,
      seedLimit: 1,
    });
    expect(reached).toEqual(["reached.md"]);
  });

  it("respects a caller that keeps no reached note", () => {
    const g = graphOf([["seed.md", "attachment.png"]]);
    expect(
      expandFromSeeds(["seed.md"], { graph: g, hubPaths: NO_HUBS, accept: () => false }),
    ).toEqual([]);
  });
});

// --- through the provider --------------------------------------------------

interface FakeFile {
  path: string;
  content: string;
  cache?: {
    tags?: Array<{ tag: string }>;
    frontmatter?: Record<string, unknown> | null;
  } | null;
}

function fakeApp(
  files: FakeFile[],
  resolvedLinks: Record<string, Record<string, number>> = {},
): App {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    vault: {
      getMarkdownFiles: () => files.map((f) => ({ path: f.path })),
      cachedRead: async (file: { path: string }) => byPath.get(file.path)?.content ?? "",
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => byPath.get(file.path)?.cache ?? null,
      resolvedLinks,
    },
  } as unknown as App;
}

const atom = (title: string, capture: string): FakeFile => ({
  path: `Atoms/${title}.md`,
  content: `---
created: 2026-07-01T10:00:00
generated-by: linker
tags:
  - idea
---
${capture}
`,
  cache: { frontmatter: { tags: ["idea"] } },
});

const note = (path: string, body: string, cache?: FakeFile["cache"]): FakeFile => ({
  path,
  content: body,
  cache: cache ?? null,
});

const ESPRESSO = atom(
  "Espresso grind size",
  "Grinding the espresso finer pulled a sweeter shot this morning",
);
const ROASTERS = note("Notes/Roasters.md", "Where the beans come from.");
const WATER = note("Notes/Water chemistry.md", "Magnesium and bicarbonate ratios.");
const ISLAND = note("Notes/Rowing club.md", "Tuesday rowing club minutes.");

const CAPTURE = "espresso grind finer pulled sweeter";

const dailyVault = () =>
  fakeApp([ESPRESSO, ROASTERS, WATER, ISLAND], {
    [ESPRESSO.path]: { [ROASTERS.path]: 1 },
    [ROASTERS.path]: { [WATER.path]: 1 },
  });

const provider = (app: App) => new MetadataContextProvider(app, () => ["idea"]);

describe("graph expansion through the shortlist seam (R7)", () => {
  it("adds a two-hop note that BM25 scored an absolute zero", async () => {
    const app = dailyVault();

    const off = await (await provider(app).beginRun({ expandGraph: false })).getCandidates(
      CAPTURE,
    );
    expect(off.titles).toEqual(["Espresso grind size"]);
    expect(off.stats.zeroScoring).toBeGreaterThan(0);

    const on = await (await provider(app).beginRun()).getCandidates(CAPTURE);
    expect(on.titles).toEqual(["Espresso grind size", "Roasters", "Water chemistry"]);
    expect(on.stats.expanded).toBe(2);
    // Reached, not scored: an expansion slot must never pose as a match.
    expect(on.shortlist.filter((c) => c.score === 0).map((c) => c.title)).toEqual([
      "Roasters",
      "Water chemistry",
    ]);
    // A separate component stays out however deep the walk goes.
    expect(on.titles).not.toContain("Rowing club");
  });

  it("with the setting off, the shortlist is byte-identical to U3's output", async () => {
    const app = dailyVault();
    const off = await (await provider(app).beginRun({ expandGraph: false })).getCandidates(
      CAPTURE,
    );

    // Baseline computed from U1/U2 directly, not from another ContextRun.
    const corpus = await buildCandidateCorpus(app, { atomFolder: "" });
    const ranked = rankShortlist(CAPTURE, corpus.notes, 400);
    const expected = {
      titles: ranked.map((n) => n.title),
      shortlist: ranked.map((n) => ({ path: n.path, title: n.title, score: n.score })),
      stats: {
        corpusSize: corpus.notes.length,
        matched: ranked.length,
        zeroScoring: corpus.notes.length - ranked.length,
        returned: ranked.length,
        k: 400,
      },
    };

    expect(
      JSON.stringify({ titles: off.titles, shortlist: off.shortlist, stats: off.stats }),
    ).toBe(JSON.stringify(expected));
    expect("expanded" in off.stats).toBe(false);
  });

  it("catch-up shape: expansion contributes nothing beyond hubs already in context", async () => {
    // The only edges a backfill has are atom → pre-existing hub. Links between the run's own atoms
    // are written during the run and are not in the graph yet (KTD7).
    const ALEX = note("People/Alex.md", "Alex paddles a kayak most weekends.", {
      frontmatter: { tags: ["person"] },
    });
    const OTHER = atom("Sleep debt compounds", "Sleep debt wrecks my focus by Thursday");
    const alexNeighbours = Array.from({ length: 6 }, (_, i) =>
      note(`Notes/Alex thread ${i}.md`, `Unrelated thread number ${i}.`),
    );
    const app = fakeApp([ESPRESSO, OTHER, ALEX, ...alexNeighbours], {
      [ESPRESSO.path]: { [ALEX.path]: 1 },
      [OTHER.path]: { [ALEX.path]: 1 },
      [ALEX.path]: Object.fromEntries(alexNeighbours.map((n) => [n.path, 1])),
    });

    const ctx = await (await provider(app).beginRun()).getCandidates(CAPTURE);
    expect(ctx.personHubs).toContain("Alex"); // precondition: Alex is the hub, by the one definition

    const added = ctx.shortlist.filter((c) => c.score === 0).map((c) => c.title);
    // Every slot expansion spent is a person hub the model could already link — zero new reach.
    for (const title of added) expect(ctx.personHubs).toContain(title);
    // No second atom, and none of the hub's six neighbours: traversal stopped at the hub.
    expect(ctx.titles).not.toContain("Sleep debt compounds");
    for (const n of alexNeighbours) {
      expect(ctx.titles).not.toContain(n.path.replace("Notes/", "").replace(".md", ""));
    }
  });
});
