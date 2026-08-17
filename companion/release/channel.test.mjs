import { describe, expect, it } from "vitest";
import {
  androidBetaName,
  androidProdGuard,
  iosGithubChannelVersion,
  releaseFlags,
} from "./channel.mjs";

describe("androidProdGuard", () => {
  it("accepts a clean X.Y.Z", () => {
    expect(androidProdGuard("0.3.1")).toBe("0.3.1");
  });

  it("rejects a beta marketing string", () => {
    expect(() => androidProdGuard("0.3.0-beta.1")).toThrow(/prod/i);
  });

  it("rejects a leftover -poc suffix", () => {
    expect(() => androidProdGuard("0.2.0-poc")).toThrow(/poc/i);
  });
});

describe("androidBetaName", () => {
  it("starts at beta.1 from a clean version", () => {
    expect(androidBetaName("0.3.0")).toBe("0.3.0-beta.1");
  });

  it("increments an existing beta N", () => {
    expect(androidBetaName("0.3.0-beta.1")).toBe("0.3.0-beta.2");
  });
});

describe("iosGithubChannelVersion", () => {
  it("starts at beta.1 when no tags exist", () => {
    expect(iosGithubChannelVersion("0.1.0", [])).toBe("0.1.0-beta.1");
  });

  it("increments from existing capture-ios tags", () => {
    expect(
      iosGithubChannelVersion("0.1.0", ["capture-ios-0.1.0-beta.1"]),
    ).toBe("0.1.0-beta.2");
  });

  it("ignores other platforms and other marketing lines", () => {
    expect(
      iosGithubChannelVersion("0.1.0", [
        "capture-android-0.1.0-beta.9",
        "capture-ios-0.2.0-beta.4",
      ]),
    ).toBe("0.1.0-beta.1");
  });
});

describe("releaseFlags", () => {
  it("emits a prefixed android prod tag that is not Latest", () => {
    expect(releaseFlags({ platform: "android", version: "0.3.1" })).toEqual({
      tag: "capture-android-0.3.1",
      prerelease: false,
      latest: false,
    });
  });

  it("marks android beta as prerelease", () => {
    expect(
      releaseFlags({ platform: "android", version: "0.3.0-beta.1" }),
    ).toEqual({
      tag: "capture-android-0.3.0-beta.1",
      prerelease: true,
      latest: false,
    });
  });

  it("never emits a tag the plugin releaser would match", () => {
    const cases = [
      releaseFlags({ platform: "android", version: "0.3.1" }).tag,
      releaseFlags({ platform: "android", version: "0.3.0-beta.1" }).tag,
      releaseFlags({ platform: "ios", version: "0.1.0-beta.1" }).tag,
    ];
    for (const tag of cases) {
      expect(tag).not.toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
