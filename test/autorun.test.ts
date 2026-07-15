import { describe, expect, it } from "vitest";
import {
  canBuildContext,
  localDateString,
  readDeviceAutoRunState,
  shouldRunAutoProcess,
  writeAutoRunEnabled,
  writeEgressAck,
  writeLastRunDay,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_LAST_RUN_DAY,
  PER_LAUNCH_CAP,
} from "../src/autorun";

describe("shouldRunAutoProcess", () => {
  it("same-calendar-day → no run", () => {
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: "2026-07-15",
        today: "2026-07-15",
        egressAcked: true,
      }),
    ).toBe(false);
  });

  it("earlier day → runs", () => {
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: "2026-07-14",
        today: "2026-07-15",
        egressAcked: true,
      }),
    ).toBe(true);
  });

  it("never run when disabled or no egress ack", () => {
    expect(
      shouldRunAutoProcess({
        enabled: false,
        lastRunDay: null,
        today: "2026-07-15",
        egressAcked: true,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: null,
        today: "2026-07-15",
        egressAcked: false,
      }),
    ).toBe(false);
  });

  it("first run (no last day) when enabled+acked", () => {
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: null,
        today: "2026-07-15",
        egressAcked: true,
      }),
    ).toBe(true);
  });
});

describe("device-local storage (not data.json)", () => {
  it("round-trips via load/save helpers only", () => {
    const store: Record<string, unknown> = {};
    const load = (k: string) => store[k] ?? null;
    const save = (k: string, v: unknown) => {
      store[k] = v;
    };

    writeAutoRunEnabled(save, true);
    writeEgressAck(save, true);
    writeLastRunDay(save, "2026-07-14");

    expect(store[LS_AUTO_RUN_ENABLED]).toBe(true);
    expect(store[LS_AUTO_RUN_EGRESS_ACK]).toBe(true);
    expect(store[LS_LAST_RUN_DAY]).toBe("2026-07-14");

    const state = readDeviceAutoRunState(load);
    expect(state).toEqual({
      enabled: true,
      lastRunDay: "2026-07-14",
      egressAcked: true,
    });

    // Keys are device-local names — not written into settings object shape
    expect(Object.keys(store).every((k) => k.startsWith("ai-linker-"))).toBe(
      true,
    );
  });
});

describe("cold-start context gate", () => {
  it("forbids buildContext until cache ready", () => {
    expect(canBuildContext(false)).toBe(false);
    expect(canBuildContext(true)).toBe(true);
  });
});

describe("constants", () => {
  it("per-launch cap is positive and bounded", () => {
    expect(PER_LAUNCH_CAP).toBeGreaterThan(0);
    expect(PER_LAUNCH_CAP).toBeLessThanOrEqual(50);
  });

  it("localDateString is YYYY-MM-DD", () => {
    expect(localDateString(new Date("2026-07-15T12:00:00"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
