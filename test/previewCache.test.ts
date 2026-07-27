import { describe, expect, it } from "vitest";
import {
  emptyPreviewCache,
  fingerprintPreviewKey,
  lookupPreviewCache,
  parsePreviewCache,
  putPreviewCache,
} from "../src/platform/previewCache";
import type { ClassificationResult } from "../src/shared/types";

const sample: ClassificationResult = {
  verdict: "atom",
  title: "Test claim",
  tags: ["idea"],
  proposed_tags: [],
  links: [],
};

describe("previewCache", () => {
  it("fingerprint changes when capture changes", () => {
    const a = fingerprintPreviewKey("hello", "claude-sonnet-5", 5);
    const b = fingerprintPreviewKey("hello!", "claude-sonnet-5", 5);
    expect(a).not.toBe(b);
  });

  it("fingerprint changes when quality stamp changes", () => {
    const a = fingerprintPreviewKey("hello", "m", 4);
    const b = fingerprintPreviewKey("hello", "m", 5);
    expect(a).not.toBe(b);
  });

  it("put/lookup hit", () => {
    const key = fingerprintPreviewKey("c", "m", 5);
    let store = emptyPreviewCache();
    store = putPreviewCache(store, key, sample);
    expect(lookupPreviewCache(store, key)).toEqual(sample);
  });

  it("miss when key differs", () => {
    const key = fingerprintPreviewKey("c", "m", 5);
    const store = putPreviewCache(emptyPreviewCache(), key, sample);
    expect(lookupPreviewCache(store, fingerprintPreviewKey("other", "m", 5))).toBeNull();
  });

  it("round-trips parse", () => {
    const key = fingerprintPreviewKey("c", "m", 5);
    const store = putPreviewCache(emptyPreviewCache(), key, sample);
    const again = parsePreviewCache(JSON.stringify(store));
    expect(lookupPreviewCache(again, key)?.title).toBe("Test claim");
  });
});
