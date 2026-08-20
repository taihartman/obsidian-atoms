import { describe, expect, it } from "vitest";
import { applyClassificationQuality } from "../src/pipeline/classify";
import { shortTitleFromCapture } from "../src/pipeline/enrich/ideaRescue";
import {
  TITLE_CONTEXT_COVERAGE,
  TITLE_CONTEXT_MIN_SHARED,
  isTitleBorrowedFromContext,
  neighbourTitlesForBorrowCheck,
  repairBorrowedTitle,
} from "../src/pipeline/enrich/titleCoherence";
import { tokens } from "../src/pipeline/shortlist";
import type { ClassificationResult } from "../src/shared/types";

const IPHONE = "Liv just got an iPhone 17 Pro";
const FARMERS_CAPTURE =
  "Farmers carries are the best thing I ever did for my workout habits it just gets me like I think it just gets me picking up weights and makes me make it easier to do anything else";
const FARMERS_TITLE = "Farmers carries are a great workout habit trigger";
const BORROWED_TITLE = "Farmers carries jumpstart workout habit motivation";

function atom(title: string): ClassificationResult {
  return {
    verdict: "atom",
    title,
    tags: [],
    proposed_tags: [],
    links: [],
  };
}

function coverageAgainst(title: string, neighbour: string): number {
  const t = new Set(tokens(title));
  const n = new Set(tokens(neighbour));
  let shared = 0;
  for (const x of t) if (n.has(x)) shared += 1;
  return t.size === 0 ? 0 : shared / t.size;
}

describe("borrowed-title coverage band", () => {
  it("sits above a weak topical pair and at or below the iPhone/farmers paraphrase", () => {
    const sleepTitle = "Sleep debt doesn't accumulate linearly";
    const sleepNeighbour = "Sleep debt compounds overnight";
    const farmersCoverage = coverageAgainst(BORROWED_TITLE, FARMERS_TITLE);
    const sleepCoverage = coverageAgainst(sleepTitle, sleepNeighbour);
    expect(farmersCoverage).toBeGreaterThan(sleepCoverage);
    expect(TITLE_CONTEXT_COVERAGE).toBeGreaterThan(sleepCoverage);
    expect(TITLE_CONTEXT_COVERAGE).toBeLessThanOrEqual(farmersCoverage);
    expect(TITLE_CONTEXT_MIN_SHARED).toBe(2);
  });
});

describe("isTitleBorrowedFromContext", () => {
  it("flags a farmers-carries paraphrase on an iPhone capture", () => {
    expect(
      isTitleBorrowedFromContext(BORROWED_TITLE, IPHONE, [FARMERS_TITLE]),
    ).toBe(true);
  });

  it("does not flag a title grounded in the capture", () => {
    expect(
      isTitleBorrowedFromContext(FARMERS_TITLE, FARMERS_CAPTURE, [FARMERS_TITLE]),
    ).toBe(false);
  });

  it("does not flag a weak topical abstract title", () => {
    expect(
      isTitleBorrowedFromContext(
        "Sleep debt doesn't accumulate linearly",
        "I don't think missed nights stack the way people say",
        ["Sleep debt compounds overnight"],
      ),
    ).toBe(false);
  });

  it("cannot prove a borrow with an empty neighbour list", () => {
    expect(isTitleBorrowedFromContext(BORROWED_TITLE, IPHONE, [])).toBe(false);
  });
});

describe("repairBorrowedTitle", () => {
  it("rewrites the iPhone capture's farmers-carries title from the capture", () => {
    const out = repairBorrowedTitle(IPHONE, atom(BORROWED_TITLE), [FARMERS_TITLE]);
    expect(out.title).toBe(shortTitleFromCapture(IPHONE));
    expect(out.title).not.toMatch(/farmers/i);
    expect(out.verdict).toBe("atom");
  });

  it("keeps a same-thread title that the capture actually supports", () => {
    const src = atom(FARMERS_TITLE);
    expect(repairBorrowedTitle(FARMERS_CAPTURE, src, [FARMERS_TITLE])).toBe(src);
  });

  it("leaves noise alone", () => {
    const noise: ClassificationResult = {
      verdict: "noise",
      title: "",
      tags: [],
      proposed_tags: [],
      links: [],
    };
    expect(repairBorrowedTitle(IPHONE, noise, [FARMERS_TITLE])).toBe(noise);
  });

  it("sees a continue parent that is not already in the shortlist", () => {
    const neighbours = neighbourTitlesForBorrowCheck([], FARMERS_TITLE);
    expect(neighbours).toEqual([FARMERS_TITLE]);
    const out = repairBorrowedTitle(IPHONE, atom(BORROWED_TITLE), neighbours);
    expect(out.title).toBe(shortTitleFromCapture(IPHONE));
  });
});

describe("applyClassificationQuality includes borrowed-title repair", () => {
  it("rewrites before a fixture write would mint the marker", () => {
    const out = applyClassificationQuality(
      IPHONE,
      atom(BORROWED_TITLE),
      { titles: [FARMERS_TITLE] },
    );
    expect(out.title).toBe(shortTitleFromCapture(IPHONE));
  });
});
