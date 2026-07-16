import { describe, expect, it } from "vitest";
import {
  aggregateTagsFromFileCaches,
  buildVaultContext,
  collectLinkTargets,
  collectTitles,
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

  it("rendered prefix is byte-identical across two captures (cache prerequisite)", () => {
    const ctx = buildVaultContext({
      titles: ["Note one", "Note two"],
      vaultTags: ["idea"],
      activeVocabulary: ["idea", "question"],
      personHubs: ["Alex"],
    });
    const a = buildContextUserMessage(ctx);
    const b = buildContextUserMessage(ctx);
    const c = renderStablePrefix(ctx);
    expect(a).toBe(b);
    expect(a).toBe(c);
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
