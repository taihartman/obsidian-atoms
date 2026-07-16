import { describe, expect, it } from "vitest";
import {
  enrichMediaLinks,
  extractWorkTitle,
  isMediaShaped,
  titleCaseWork,
} from "../src/media";
import type { ClassificationResult } from "../src/types";
import { filterTagsToActive, STRUCTURAL_TAGS } from "../src/vocabulary";

const atomBase = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  verdict: "atom",
  title: "Christian recommended watching My Hero Academia",
  tags: ["preferences"],
  proposed_tags: [],
  links: [],
  ...over,
});

describe("isMediaShaped / extractWorkTitle", () => {
  it("detects Christian → MHA dump", () => {
    const c = "Christian told me to watch my hero academia";
    expect(isMediaShaped(c)).toBe(true);
    expect(extractWorkTitle(c)?.toLowerCase()).toContain("hero academia");
  });

  it("detects bare watch", () => {
    expect(isMediaShaped("watch Past Lives")).toBe(true);
    expect(extractWorkTitle("watch Past Lives")).toMatch(/Past Lives/i);
  });

  it("ignores pure preference without watch", () => {
    expect(isMediaShaped("Alex likes periwinkle")).toBe(false);
    expect(extractWorkTitle("Alex likes periwinkle")).toBeNull();
  });
});

describe("enrichMediaLinks", () => {
  it("adds media tags + work link; keeps title/verdict", () => {
    const capture = "Christian told me to watch my hero academia";
    const out = enrichMediaLinks(capture, atomBase(), []);
    expect(out.verdict).toBe("atom");
    expect(out.title).toBe(atomBase().title);
    expect(out.tags).toEqual(
      expect.arrayContaining(["watch", "show", "media", "preferences"]),
    );
    expect(out.links.some((l) => /hero academia/i.test(l.note))).toBe(true);
  });

  it("prefers existing vault title for work", () => {
    const capture = "watch past lives";
    const out = enrichMediaLinks(capture, atomBase({ title: "Want Past Lives", tags: [] }), [
      "Past Lives",
      "Other",
    ]);
    expect(out.links.some((l) => l.note === "Past Lives")).toBe(true);
  });

  it("no-op for non-media atoms", () => {
    const base = atomBase({
      title: "Alex likes periwinkle",
      tags: ["preferences", "person"],
    });
    const out = enrichMediaLinks("Alex likes periwinkle", base, []);
    expect(out).toEqual(base);
  });

  it("skips non-atom verdicts", () => {
    const noise: ClassificationResult = {
      verdict: "noise",
      title: "",
      tags: [],
      proposed_tags: [],
      links: [],
    };
    expect(enrichMediaLinks("watch X", noise, [])).toEqual(noise);
  });
});

describe("structural media tags", () => {
  it("media tags always eligible even if Active is empty of them", () => {
    for (const t of ["watch", "movie", "show", "media", "list"]) {
      expect(STRUCTURAL_TAGS).toContain(t);
    }
    expect(filterTagsToActive(["watch", "show", "bogus"], ["idea"])).toEqual([
      "show",
      "watch",
    ]);
  });
});

describe("titleCaseWork", () => {
  it("title-cases simple multiword", () => {
    expect(titleCaseWork("my hero academia")).toBe("My Hero Academia");
  });
});
