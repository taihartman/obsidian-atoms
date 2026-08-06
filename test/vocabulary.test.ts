import { describe, expect, it } from "vitest";
import {
  checkCustomTag,
  MAX_CUSTOM_TAG_LENGTH,
  normalizeTag,
} from "../src/pipeline/vocabulary";

/**
 * The gate on the one path where a human types a brand-new tag. Active tags are not decoration:
 * `eligibleTags()` quotes them into the classify prompt, so an unbounded field is an unbounded
 * prompt, and "the button did nothing" is not an answer a user can act on.
 */
describe("checkCustomTag", () => {
  it("accepts an ordinary tag, normalized", () => {
    expect(checkCustomTag("  #Health  ")).toEqual({ ok: true, tag: "health" });
  });

  it.each([
    ["hyphens and slashes", "project/alpha-2026"],
    ["underscores", "book_notes"],
    ["a non-Latin script", "日本語"],
  ])("accepts %s", (_label, raw) => {
    expect(checkCustomTag(raw).ok).toBe(true);
  });

  it.each([
    ["nothing but hashes", "###"],
    ["nothing but whitespace", "   "],
    ["the empty string", ""],
  ])("rejects %s, which normalizes away to nothing", (_label, raw) => {
    expect(normalizeTag(raw)).toBe("");
    const checked = checkCustomTag(raw);
    expect(checked.ok).toBe(false);
    // The reason is the whole point: a silent `return` left the draft sitting in the field with
    // no Notice, no row, and nothing for the user to read but a button that looked broken.
    expect(checked.ok === false && checked.reason.length > 0).toBe(true);
  });

  it("rejects a tag past the length cap and names the cap", () => {
    const checked = checkCustomTag("a".repeat(MAX_CUSTOM_TAG_LENGTH + 1));
    expect(checked.ok).toBe(false);
    expect(checked.ok === false && checked.reason).toContain(
      String(MAX_CUSTOM_TAG_LENGTH),
    );
  });

  it("accepts a tag exactly at the cap", () => {
    expect(checkCustomTag("a".repeat(MAX_CUSTOM_TAG_LENGTH)).ok).toBe(true);
  });

  it.each([
    ["emoji", "🔥🔥"],
    ["spaces", "two words"],
    ["punctuation", "what?!"],
    ["a leading digit", "2026goals"],
  ])("rejects %s", (_label, raw) => {
    expect(checkCustomTag(raw).ok).toBe(false);
  });

  it("leaves the tags the plugin already ships alone", () => {
    // A cap that rejected the defaults would be a cap that broke a working vault on upgrade.
    for (const tag of ["idea", "question", "observation", "reference", "person"]) {
      expect(checkCustomTag(tag)).toEqual({ ok: true, tag });
    }
  });
});
