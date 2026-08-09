import { describe, expect, it } from "vitest";
import {
  GENERATED_CLOSE,
  GENERATED_OPEN,
} from "../src/pipeline/hubSections";
import {
  isListHubCandidate,
  pathInPersonHubDenylist,
  pathInSafetyDenylist,
  shouldWriteNonPersonHub,
} from "../src/pipeline/hubQualify";

describe("pathInSafetyDenylist", () => {
  it("denies Atoms, Daily, Templates, Archive, dotfolders", () => {
    expect(pathInSafetyDenylist("Atoms/Claim.md")).toBe(true);
    expect(pathInSafetyDenylist("Daily/2026-08-09.md")).toBe(true);
    expect(pathInSafetyDenylist("Templates/Note.md")).toBe(true);
    expect(pathInSafetyDenylist("Archive/Old.md")).toBe(true);
    expect(pathInSafetyDenylist(".obsidian/plugins/x.md")).toBe(true);
  });

  it("allows Projects and Recipes for list hubs", () => {
    expect(pathInSafetyDenylist("Projects/Trip.md")).toBe(false);
    expect(pathInSafetyDenylist("Recipes/Pie.md")).toBe(false);
    expect(pathInSafetyDenylist("Movies.md")).toBe(false);
  });
});

describe("pathInPersonHubDenylist", () => {
  it("still denies Projects for person discovery", () => {
    expect(pathInPersonHubDenylist("Projects/Cooking.md")).toBe(true);
    expect(pathInPersonHubDenylist("Personal notes/Social/Alex.md")).toBe(
      false,
    );
  });
});

describe("shouldWriteNonPersonHub", () => {
  it("blocks single member Unsorted-only without delimiters", () => {
    expect(
      shouldWriteNonPersonHub({
        memberCount: 1,
        hasMatchingHubSection: false,
        hubHasGeneratedDelimiters: false,
      }),
    ).toBe(false);
  });

  it("allows ≥2 members, matching section, or existing delimiters", () => {
    expect(
      shouldWriteNonPersonHub({
        memberCount: 2,
        hasMatchingHubSection: false,
        hubHasGeneratedDelimiters: false,
      }),
    ).toBe(true);
    expect(
      shouldWriteNonPersonHub({
        memberCount: 1,
        hasMatchingHubSection: true,
        hubHasGeneratedDelimiters: false,
      }),
    ).toBe(true);
    expect(
      shouldWriteNonPersonHub({
        memberCount: 1,
        hasMatchingHubSection: false,
        hubHasGeneratedDelimiters: true,
      }),
    ).toBe(true);
  });
});

describe("isListHubCandidate", () => {
  it("requires safety-ok path and ≥1 H2", () => {
    expect(
      isListHubCandidate({
        path: "Movies.md",
        sections: ["Want to watch"],
      }),
    ).toBe(true);
    expect(
      isListHubCandidate({
        path: "Movies.md",
        sections: [],
      }),
    ).toBe(false);
    expect(
      isListHubCandidate({
        path: "Atoms/x.md",
        sections: ["A"],
      }),
    ).toBe(false);
  });

  it("detects existing generated delimiters from content", () => {
    const content = `# Movies\n\n## Want\n\n${GENERATED_OPEN}\n- [[a]]\n${GENERATED_CLOSE}\n`;
    expect(
      isListHubCandidate({
        path: "Movies.md",
        content,
      }),
    ).toBe(true);
  });
});
