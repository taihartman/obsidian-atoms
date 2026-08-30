import { describe, expect, it } from "vitest";
import {
  homeScrollScreen,
  shouldSkipHomeVaultRefresh,
} from "../src/home/homeScroll";

describe("homeScrollScreen", () => {
  it("treats a missing detail as the main library", () => {
    expect(homeScrollScreen(null)).toBe("main");
    expect(homeScrollScreen(undefined)).toBe("main");
  });

  it("keys each in-home detail so a second screen does not inherit the first", () => {
    expect(homeScrollScreen({ kind: "atom", path: "Atoms/A.md" })).toBe(
      "open:atom:Atoms/A.md",
    );
    expect(homeScrollScreen({ kind: "atom", path: "Atoms/B.md" })).toBe(
      "open:atom:Atoms/B.md",
    );
    expect(
      homeScrollScreen({ kind: "entity-siblings", label: "Show list" }),
    ).toBe("open:entity:Show list");
    expect(
      homeScrollScreen({
        kind: "mind-change-pair",
        thenPath: "Atoms/Then.md",
        nowPath: "Atoms/Now.md",
      }),
    ).toBe("open:pair:Atoms/Then.md:Atoms/Now.md");
  });
});

describe("shouldSkipHomeVaultRefresh", () => {
  it("lets idle home follow vault writes", () => {
    expect(
      shouldSkipHomeVaultRefresh({ busy: false, autoRunInFlight: false }),
    ).toBe(false);
  });

  it("skips while Process has the view", () => {
    expect(
      shouldSkipHomeVaultRefresh({ busy: true, autoRunInFlight: false }),
    ).toBe(true);
  });

  it("skips while auto-run is filing even though busy stays false", () => {
    expect(
      shouldSkipHomeVaultRefresh({ busy: false, autoRunInFlight: true }),
    ).toBe(true);
  });
});
