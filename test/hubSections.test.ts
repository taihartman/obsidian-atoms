import { describe, expect, it } from "vitest";
import { parseHubSections } from "../src/pipeline/hubSections";

describe("parseHubSections", () => {
  it("returns H2s in document order", () => {
    const md = `# Name\n\n## Gift Ideas\n\nprose\n\n## Date Ideas\n`;
    expect(parseHubSections(md)).toEqual(["Gift Ideas", "Date Ideas"]);
  });

  it("ignores H1", () => {
    expect(parseHubSections("# Only H1\n")).toEqual([]);
  });

  it("ignores headings inside fenced code", () => {
    const md = "```\n## Not A Section\n```\n## Real\n";
    expect(parseHubSections(md)).toEqual(["Real"]);
  });

  it("ignores headings inside generated block", () => {
    const md = [
      "## Human",
      "<!-- atoms:generated v=1 -->",
      "## Gift Ideas",
      "- [[x]]",
      "<!-- /atoms:generated -->",
      "## After",
    ].join("\n");
    expect(parseHubSections(md)).toEqual(["Human", "After"]);
  });

  it("dedupes first occurrence wins", () => {
    expect(parseHubSections("## A\n## B\n## A\n")).toEqual(["A", "B"]);
  });

  it("empty body → []", () => {
    expect(parseHubSections("")).toEqual([]);
  });
});
