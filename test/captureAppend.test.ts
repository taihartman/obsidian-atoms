import { describe, expect, it } from "vitest";
import {
  captureTextFromProtocolParams,
  contentToAppend,
  formatCaptureBullet,
  MAX_CAPTURE_CHARS,
  normalizeCaptureText,
} from "../src/pipeline/captureAppend";

describe("normalizeCaptureText", () => {
  it("trims and collapses whitespace/newlines", () => {
    expect(normalizeCaptureText("  hello\n\nworld  ")).toBe("hello world");
    expect(normalizeCaptureText("a\r\nb\rc")).toBe("a b c");
  });

  it("returns empty for blank input", () => {
    expect(normalizeCaptureText("   \n\t  ")).toBe("");
    expect(normalizeCaptureText("")).toBe("");
  });
});

describe("formatCaptureBullet", () => {
  it("prefixes a top-level bullet", () => {
    expect(formatCaptureBullet("ship it")).toBe("- ship it");
  });

  it("does not double-bullet", () => {
    expect(formatCaptureBullet("- already")).toBe("- already");
    expect(formatCaptureBullet("- already bulleted")).toBe(
      "- already bulleted",
    );
  });

  it("returns empty for blank", () => {
    expect(formatCaptureBullet("  ")).toBe("");
  });
});

describe("contentToAppend", () => {
  it("appends with trailing newline on empty file", () => {
    expect(contentToAppend("", "- hi")).toBe("- hi\n");
  });

  it("adds leading newline when file lacks trailing newline", () => {
    expect(contentToAppend("body", "- hi")).toBe("\n- hi\n");
  });

  it("does not add extra blank when file already ends with newline", () => {
    expect(contentToAppend("body\n", "- hi")).toBe("- hi\n");
  });
});

describe("captureTextFromProtocolParams", () => {
  it("prefers text over data", () => {
    expect(
      captureTextFromProtocolParams({ text: "a", data: "b" }),
    ).toBe("a");
  });

  it("falls back to data", () => {
    expect(captureTextFromProtocolParams({ data: "from-data" })).toBe(
      "from-data",
    );
  });

  it("returns empty when missing", () => {
    expect(captureTextFromProtocolParams({})).toBe("");
  });
});

describe("MAX_CAPTURE_CHARS", () => {
  it("is a positive hard cap", () => {
    expect(MAX_CAPTURE_CHARS).toBeGreaterThan(1000);
  });
});
