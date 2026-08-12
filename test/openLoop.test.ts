import { describe, expect, it } from "vitest";
import {
  OPEN_LOOP_KEY,
  OPEN_LOOP_SOURCE_KEY,
  REDEEMS_RELATION,
  canClassifierWrite,
  formatOpenLoopFmLines,
  linksIncludeRedeems,
  openNow,
  parseOpenLoopFm,
  type OpenLoopFm,
  type OpenLoopState,
} from "../src/shared/openLoop";

describe("openNow", () => {
  it("is true only for active without redeeming child", () => {
    expect(openNow({ state: "active", hasRedeemingChild: false })).toBe(true);
    expect(openNow({ state: "active", hasRedeemingChild: true })).toBe(false);
  });

  it("is false for terminals and unset", () => {
    for (const state of [
      "not_a_loop",
      "resolved_elsewhere",
      "abandoned",
      null,
    ] as const) {
      expect(openNow({ state, hasRedeemingChild: false })).toBe(false);
      expect(openNow({ state, hasRedeemingChild: true })).toBe(false);
    }
  });
});

describe("canClassifierWrite", () => {
  it("allows write when unset", () => {
    expect(canClassifierWrite(null)).toBe(true);
  });

  it("allows overwrite of inferred active", () => {
    expect(
      canClassifierWrite({ state: "active", source: "inferred" }),
    ).toBe(true);
  });

  it("blocks user source in any state", () => {
    const states: OpenLoopState[] = [
      "active",
      "not_a_loop",
      "resolved_elsewhere",
      "abandoned",
    ];
    for (const state of states) {
      expect(canClassifierWrite({ state, source: "user" })).toBe(false);
    }
  });
});

describe("parseOpenLoopFm / formatOpenLoopFmLines", () => {
  it("round-trips active inferred", () => {
    const fm: OpenLoopFm = { state: "active", source: "inferred" };
    const lines = formatOpenLoopFmLines(fm);
    expect(lines).toContain(`${OPEN_LOOP_KEY}: active`);
    expect(lines).toContain(`${OPEN_LOOP_SOURCE_KEY}: inferred`);
    const block = ["---", ...lines, "---", "", "body"].join("\n");
    expect(parseOpenLoopFm(block)).toEqual(fm);
  });

  it("returns null when keys absent", () => {
    expect(parseOpenLoopFm("---\ntags: []\n---\n\nhi")).toBeNull();
  });

  it("rejects unknown state", () => {
    expect(
      parseOpenLoopFm(`---\n${OPEN_LOOP_KEY}: maybe\n${OPEN_LOOP_SOURCE_KEY}: user\n---\n`),
    ).toBeNull();
  });

  it("requires both keys for a parse hit", () => {
    expect(
      parseOpenLoopFm(`---\n${OPEN_LOOP_KEY}: active\n---\n`),
    ).toBeNull();
  });

  it("ignores loop keys only present in body", () => {
    expect(
      parseOpenLoopFm(
        `---\ntags: []\n---\n\n${OPEN_LOOP_KEY}: active\n${OPEN_LOOP_SOURCE_KEY}: inferred\n`,
      ),
    ).toBeNull();
  });
});

describe("linksIncludeRedeems", () => {
  it("detects redeems relation case-insensitively", () => {
    expect(
      linksIncludeRedeems([{ note: "Parent", relation: REDEEMS_RELATION }]),
    ).toBe(true);
    expect(
      linksIncludeRedeems([{ note: "Parent", relation: "Redeems" }]),
    ).toBe(true);
    expect(
      linksIncludeRedeems([{ note: "Parent", relation: "continues" }]),
    ).toBe(false);
    expect(linksIncludeRedeems([])).toBe(false);
  });

  it("also matches reason text containing redeems", () => {
    expect(
      linksIncludeRedeems([
        { note: "Parent", reason: "redeems [[Parent]]" },
      ]),
    ).toBe(true);
  });
});
