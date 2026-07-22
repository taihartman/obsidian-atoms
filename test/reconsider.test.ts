import { describe, expect, it } from "vitest";
import {
  canApplyReconsider,
  findCaptureAtLine,
  forceKeepAtomResult,
  gateReconsiderTarget,
  labelVerdict,
} from "../src/pipeline/reconsider";
import { parseCaptures } from "../src/pipeline/parse";

const daily = [
  "- buy milk",
  "\t<!--linker:noise-->",
  "- packing list for Japan: passport",
  "\t<!--linker:noise-->",
  "- Christian recommended My Hero Academia",
  "\t↳ [[Christian recommended My Hero Academia]] <!--linker-->",
  "- unmarked thought",
  "",
].join("\n");

describe("findCaptureAtLine", () => {
  it("resolves cursor on capture body", () => {
    const c = findCaptureAtLine(daily, 2);
    expect(c?.text).toContain("packing list");
    expect(c?.markerKind).toBe("noise");
  });

  it("resolves cursor on marker line", () => {
    const c = findCaptureAtLine(daily, 3);
    expect(c?.text).toContain("packing list");
  });

  it("resolves atom marker as atom gate", () => {
    const c = findCaptureAtLine(daily, 5);
    expect(c?.markerKind).toBe("atom");
    expect(gateReconsiderTarget(c).ok).toBe(false);
    if (!gateReconsiderTarget(c).ok) {
      expect(gateReconsiderTarget(c).reason).toBe("atom");
    }
  });

  it("misses empty space / unknown line", () => {
    expect(findCaptureAtLine(daily, 99)).toBeNull();
    expect(gateReconsiderTarget(null).reason).toBe("none");
  });

  it("unprocessed is not ok", () => {
    const c = findCaptureAtLine(daily, 6);
    expect(c?.processed).toBe(false);
    const g = gateReconsiderTarget(c);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toBe("unprocessed");
  });
});

describe("canApplyReconsider", () => {
  it("allows noise/task → atom only", () => {
    expect(canApplyReconsider("noise", "atom")).toBe(true);
    expect(canApplyReconsider("task", "atom")).toBe(true);
    expect(canApplyReconsider("noise", "noise")).toBe(false);
    expect(canApplyReconsider("noise", "task")).toBe(false);
    expect(canApplyReconsider("atom", "atom")).toBe(false);
    expect(canApplyReconsider("atom", "noise")).toBe(false);
  });
});

describe("labelVerdict", () => {
  it("uses human language", () => {
    expect(labelVerdict("atom")).toBe("Note");
    expect(labelVerdict("noise")).toBe("Skipped");
    expect(labelVerdict("task")).toBe("Skipped");
  });
});

describe("parse + gate noise", () => {
  it("noise capture is ok target", () => {
    const caps = parseCaptures(daily);
    const pack = caps.find((c) => c.text.includes("packing"));
    const g = gateReconsiderTarget(pack ?? null);
    expect(g.ok).toBe(true);
  });
});

describe("forceKeepAtomResult", () => {
  it("builds atom from capture text", () => {
    const r = forceKeepAtomResult(
      "Documents - 1. valid id, 2. receipt, 3. PayPal",
    );
    expect(r.verdict).toBe("atom");
    expect(r.title.toLowerCase()).toContain("document");
  });
});
