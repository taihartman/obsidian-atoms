import { describe, expect, it } from "vitest";
import {
  extractLinkProseRegion,
  parseLinkProse,
} from "../src/pipeline/parseLinkProse";
import { formatLinkProse } from "../src/pipeline/render";
import type { ClassificationLink } from "../src/shared/types";

describe("parseLinkProse", () => {
  it("parses weak preference sentence", () => {
    const links = parseLinkProse("preference about [[Alex]].");
    expect(links).toHaveLength(1);
    expect(links[0]!.note).toBe("Alex");
    expect(links[0]!.reason.toLowerCase()).toContain("preference");
  });

  it("parses multi-link prose", () => {
    const links = parseLinkProse(
      "concrete aesthetic preference for gifts ([[Alex]]). revises [[Old claim]].",
    );
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.map((l) => l.note)).toContain("Alex");
    expect(links.map((l) => l.note)).toContain("Old claim");
  });

  it("round-trips formatLinkProse for fixture links", () => {
    const original: ClassificationLink[] = [
      {
        note: "Alex",
        reason: "concrete aesthetic preference for gifts / clothes ([[Alex]])",
      },
      { note: "Old claim", reason: "revises [[Old claim]]" },
    ];
    const prose = formatLinkProse(original);
    const parsed = parseLinkProse(prose);
    expect(parsed.map((l) => l.note)).toEqual(original.map((l) => l.note));
    expect(parsed[1]!.reason.toLowerCase()).toContain("revises");
  });

  it("returns empty for blank", () => {
    expect(parseLinkProse("")).toEqual([]);
    expect(parseLinkProse("   ")).toEqual([]);
  });

  it("parses Related to [[X]] shape", () => {
    const links = parseLinkProse("Related to [[Sleep]].");
    expect(links).toHaveLength(1);
    expect(links[0]!.note).toBe("Sleep");
  });
});

describe("extractLinkProseRegion", () => {
  it("returns prose after blank line under body", () => {
    const md = `---
created: 2026-07-01
generated-by: linker
tags: []
---
capture text here

preference about [[Alex]].
`;
    expect(extractLinkProseRegion(md)).toMatch(/preference about/);
  });
});
