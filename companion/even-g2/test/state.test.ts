import { describe, expect, it } from "vitest";

import { ROOT_ACTIONS, initialState, reduceAppState } from "../src/app/state";
import { truncateUtf8 } from "../src/ui/paginate";

describe("G2 app state", () => {
  it("keeps the approved root order and requires confirmation before create", () => {
    expect(ROOT_ACTIONS).toEqual(["New capture"]);
    const ready = { ...initialState(), screen: "root" as const };
    const starting = reduceAppState(ready, { type: "select-root", index: 0 });
    expect(starting.screen).toBe("starting-recording");
    const recording = reduceAppState(starting, { type: "recording-started" });
    expect(recording.screen).toBe("recording");
    const prepared = reduceAppState(recording, { type: "prepared", title: "A walk thought" });
    expect(prepared).toMatchObject({ screen: "confirmation", title: "A walk thought", selectedIndex: 0 });
    expect(reduceAppState(prepared, { type: "back" }).screen).toBe("root");
    expect(reduceAppState(prepared, { type: "confirm-create" }).screen).toBe("loading");
  });

  it("routes every lifecycle failure to a visible, actionable state", () => {
    for (const reason of ["offline", "revoked", "microphone-denied", "transcription-failed", "preparation-failed", "proposal-expired", "title-collision", "commit-unknown", "recovery-full"] as const) {
      const state = reduceAppState(initialState(), { type: "fail", reason });
      expect(state).toMatchObject({ screen: "error", reason });
      expect("primaryAction" in state && state.primaryAction).toBeTruthy();
    }
  });

  it("clamps list selection to each screen's visible Return row", () => {
    const answer = { screen: "answer" as const, answer: "Friday", sources: [{ id: "a", title: "Launch" }], selectedIndex: 0 };
    expect(reduceAppState(answer, { type: "select", index: 99 }).selectedIndex).toBe(1);
    expect(reduceAppState(answer, { type: "select", index: -4 }).selectedIndex).toBe(0);
    const recent = { screen: "recent" as const, items: [{ id: "a", title: "Launch" }, { id: "b", title: "Owner" }], coverageComplete: true, selectedIndex: 0 };
    expect(reduceAppState(recent, { type: "select", index: 99 }).selectedIndex).toBe(2);
  });

  it("truncates ASCII, CJK, and emoji labels on UTF-8 boundaries", () => {
    for (const value of ["a".repeat(90), "記憶".repeat(30), "🌱".repeat(30)]) {
      const result = truncateUtf8(value, 63);
      expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(63);
      expect(result).not.toContain("�");
    }
  });
});
