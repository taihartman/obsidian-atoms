import { describe, expect, it } from "vitest";
import {
  enrichListHubLinks,
  isListHubShaped,
} from "../src/pipeline/enrich/listHubs";
import type { ClassificationResult } from "../src/shared/types";
import { normalizeHubSection } from "../src/pipeline/classify";

const baseAtom = (): ClassificationResult => ({
  verdict: "atom",
  title: "Dune",
  tags: [],
  proposed_tags: [],
  links: [],
});

describe("enrichListHubLinks", () => {
  it("links unique Movies hub for watch capture", () => {
    const out = enrichListHubLinks(
      "want to watch Dune",
      baseAtom(),
      [
        {
          canonicalTitle: "Movies",
          matchKeys: ["Movies"],
          sections: ["Want to watch", "Watched"],
        },
      ],
    );
    expect(out.links?.some((l) => l.note === "Movies")).toBe(true);
  });

  it("does not link when zero or two matches", () => {
    expect(
      enrichListHubLinks("want to watch Dune", baseAtom(), []).links,
    ).toEqual([]);
    const two = enrichListHubLinks("want to watch Dune", baseAtom(), [
      {
        canonicalTitle: "Movies",
        matchKeys: ["Movies"],
        sections: ["Want to watch"],
      },
      {
        canonicalTitle: "Films",
        matchKeys: ["Films"],
        sections: ["Want to watch"],
      },
    ]);
    // soft path only hits exact Movies/Shows/Watchlist names — Films alone may not soft-hit
    // with two list hubs without title in text → no unique soft hit either
    expect(two.links?.length ?? 0).toBe(0);
  });
});

describe("isListHubShaped", () => {
  it("detects watch and packing", () => {
    expect(isListHubShaped("want to watch Dune")).toBe(true);
    expect(isListHubShaped("packing list for trip")).toBe(true);
    expect(isListHubShaped("hello world")).toBe(false);
  });
});

describe("normalizeHubSection list hubs", () => {
  it("keeps section from listHubDetails", () => {
    const r = normalizeHubSection(
      { ...baseAtom(), hub_section: "Want to watch" },
      {
        titles: [],
        tags: [],
        vocabulary: [],
        personHubs: [],
        personHubDetails: [],
        listHubDetails: [
          {
            canonicalTitle: "Movies",
            matchKeys: ["Movies"],
            sections: ["Want to watch"],
          },
        ],
      },
    );
    expect(r.hub_section).toBe("Want to watch");
  });
});
