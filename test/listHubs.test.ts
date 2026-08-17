import { describe, expect, it } from "vitest";
import {
  enrichListHubLinks,
  isListHubShaped,
  pickSoftMediaHub,
  titleMatchesCapture,
} from "../src/pipeline/enrich/listHubs";
import type { ClassificationResult, ListHubDetail } from "../src/shared/types";
import { normalizeHubSection } from "../src/pipeline/classify";

const baseAtom = (): ClassificationResult => ({
  verdict: "atom",
  title: "Dune",
  tags: [],
  proposed_tags: [],
  links: [],
});

const movies: ListHubDetail = {
  canonicalTitle: "Movies",
  matchKeys: ["Movies"],
  sections: ["Want to watch", "Watched"],
};
const shows: ListHubDetail = {
  canonicalTitle: "Shows",
  matchKeys: ["Shows"],
  sections: ["Want to watch"],
};

describe("titleMatchesCapture", () => {
  it("requires word boundaries", () => {
    expect(titleMatchesCapture("want to watch Dune", "Movies")).toBe(false);
    expect(titleMatchesCapture("add to Movies list", "Movies")).toBe(true);
    expect(titleMatchesCapture("AI movies are cool", "AI")).toBe(false); // too short
  });
});

describe("pickSoftMediaHub", () => {
  it("picks unique soft hub", () => {
    expect(pickSoftMediaHub("want to watch Dune", [movies])?.canonicalTitle).toBe(
      "Movies",
    );
  });

  it("picks Movies for generic watch dump when Movies+Shows exist", () => {
    expect(
      pickSoftMediaHub("want to watch Dune", [movies, shows])?.canonicalTitle,
    ).toBe("Movies");
  });

  it("picks Shows for series cues", () => {
    expect(
      pickSoftMediaHub("watching Severance season 2", [movies, shows])
        ?.canonicalTitle,
    ).toBe("Shows");
  });

  it("prefers explicit name in capture", () => {
    expect(
      pickSoftMediaHub("add to my Shows list", [movies, shows])?.canonicalTitle,
    ).toBe("Shows");
  });

  it("picks Show list for an anime cue", () => {
    const showList: ListHubDetail = {
      canonicalTitle: "Show list",
      matchKeys: ["Show list"],
      sections: ["Unsorted"],
    };
    expect(
      pickSoftMediaHub("I want to watch the anime Frieren", [showList])
        ?.canonicalTitle,
    ).toBe("Show list");
  });

  it("does not dump a movie-shaped capture onto Show list", () => {
    const showList: ListHubDetail = {
      canonicalTitle: "Show list",
      matchKeys: ["Show list"],
      sections: ["Unsorted"],
    };
    expect(pickSoftMediaHub("want to watch the Dune movie", [showList])).toBeNull();
  });
});

describe("enrichListHubLinks", () => {
  it("links unique Movies hub for watch capture", () => {
    const out = enrichListHubLinks("want to watch Dune", baseAtom(), [movies]);
    expect(out.links?.some((l) => l.note === "Movies")).toBe(true);
  });

  it("does not link when zero matches", () => {
    expect(
      enrichListHubLinks("want to watch Dune", baseAtom(), []).links,
    ).toEqual([]);
  });

  it("links Movies when Movies+Shows both exist (generic watch)", () => {
    const out = enrichListHubLinks("want to watch Dune", baseAtom(), [
      movies,
      shows,
    ]);
    expect(out.links?.some((l) => l.note === "Movies")).toBe(true);
    expect(out.links?.some((l) => l.note === "Shows")).toBe(false);
  });

  it("links Shows when capture names shows", () => {
    const out = enrichListHubLinks(
      "want to watch Severance on my Shows list",
      baseAtom(),
      [movies, shows],
    );
    expect(out.links?.some((l) => l.note === "Shows")).toBe(true);
  });

  it("links sole soft hub when media-shaped and only Movies exists", () => {
    const out = enrichListHubLinks("want to watch Dune", baseAtom(), [movies]);
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
        listHubDetails: [movies],
      },
    );
    expect(r.hub_section).toBe("Want to watch");
  });
});
