import { describe, expect, it } from "vitest";
import {
  isDailyBasenameKey,
  isSoftEntityKey,
  SOFT_ENTITY_KEYS,
} from "../src/pipeline/softKeys";

describe("softKeys", () => {
  it("flags soft buckets case-insensitively", () => {
    expect(isSoftEntityKey("Camping")).toBe(true);
    expect(isSoftEntityKey("people")).toBe(true);
    expect(isSoftEntityKey("App ideas")).toBe(true);
    expect(isSoftEntityKey("Travel")).toBe(true);
    expect(SOFT_ENTITY_KEYS.has("projects")).toBe(true);
  });

  it("allows real entity titles", () => {
    expect(isSoftEntityKey("Yosemite packing")).toBe(false);
    expect(isSoftEntityKey("Alex")).toBe(false);
  });

  it("detects daily basenames", () => {
    expect(isDailyBasenameKey("2026-07-01")).toBe(true);
    expect(isDailyBasenameKey("Yosemite packing")).toBe(false);
  });
});
