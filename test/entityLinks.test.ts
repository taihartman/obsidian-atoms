import { describe, expect, it } from "vitest";
import {
  enrichEntityLinks,
  exactVaultTitle,
  findExactEntityTitlesInCapture,
  isEntityShaped,
} from "../src/pipeline/enrich/entityLinks";
import type { ClassificationResult } from "../src/shared/types";

const atom = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  verdict: "atom",
  title: "Pack bug spray",
  tags: [],
  proposed_tags: [],
  links: [],
  ...over,
});

describe("isEntityShaped", () => {
  it("detects packing / trip", () => {
    expect(isEntityShaped("pack bug spray for the trail")).toBe(true);
    expect(isEntityShaped("packing list: hat, pants")).toBe(true);
    expect(isEntityShaped("trip to Yosemite next week")).toBe(true);
  });

  it("ignores unrelated prose", () => {
    expect(isEntityShaped("Alex likes periwinkle")).toBe(false);
  });
});

describe("exactVaultTitle", () => {
  it("exact match only", () => {
    expect(exactVaultTitle("japan", ["Japan packing 2024", "Japan"])).toBe(
      "Japan",
    );
    expect(exactVaultTitle("japan", ["Japan packing 2024"])).toBeNull();
  });
});

describe("enrichEntityLinks", () => {
  it("no-op for non-atom", () => {
    const base = atom({ verdict: "noise", title: "" });
    expect(enrichEntityLinks("pack hat", base, ["Yosemite packing"])).toBe(base);
  });

  it("links exact vault title when packing-shaped", () => {
    const out = enrichEntityLinks(
      "pack bug spray for Yosemite packing trip",
      atom(),
      ["Yosemite packing", "Camping"],
    );
    expect(out.links.some((l) => l.note === "Yosemite packing")).toBe(true);
    expect(out.links.some((l) => l.note === "Camping")).toBe(false);
  });

  it("does not invent missing titles", () => {
    const out = enrichEntityLinks("pack bug spray for Yosemite", atom(), [
      "Camping",
    ]);
    expect(out.links).toHaveLength(0);
  });

  it("does not contains-match short token to longer title", () => {
    const found = findExactEntityTitlesInCapture("pack for Japan", [
      "Japan packing 2024",
    ]);
    expect(found).toEqual([]);
  });

  it("project-shaped with exact work title", () => {
    const out = enrichEntityLinks(
      "ship the Aploma launch checklist this week",
      atom({ title: "Aploma launch notes" }),
      ["Aploma"],
    );
    expect(out.links.some((l) => l.note === "Aploma")).toBe(true);
  });

  it("dedupes existing link", () => {
    const out = enrichEntityLinks(
      "pack more for Yosemite packing",
      atom({
        links: [{ note: "Yosemite packing", reason: "already ([[Yosemite packing]])" }],
      }),
      ["Yosemite packing"],
    );
    expect(out.links.filter((l) => l.note === "Yosemite packing")).toHaveLength(
      1,
    );
  });
});
