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

  it("does not link when zero matches", () => {
    expect(
      enrichListHubLinks("want to watch Dune", baseAtom(), []).links,
    ).toEqual([]);
  });

  it("picks unique soft hub when Movies+Shows both exist and text names movies", () => {
    const out = enrichListHubLinks("want to watch Dune on movies list", baseAtom(), [
      {
        canonicalTitle: "Movies",
        matchKeys: ["Movies"],
        sections: ["Want to watch"],
      },
      {
        canonicalTitle: "Shows",
        matchKeys: ["Shows"],
        sections: ["Want to watch"],
      },
    ]);
    expect(out.links?.some((l) => l.note === "Movies")).toBe(true);
  });

  it("links sole soft hub when media-shaped and only Movies exists", () => {
    const out = enrichListHubLinks("want to watch Dune", baseAtom(), [
      {
        canonicalTitle: "Movies",
        matchKeys: ["Movies"],
        sections: ["Want to watch"],
      },
    ]);
    expect(out.links?.some((l) => l.note === "Movies")).toBe(true);
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
