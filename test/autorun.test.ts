import { describe, expect, it } from "vitest";
import {
  canBuildContext,
  egressAckIsCurrent,
  enableAutomaticFiling,
  readEgressAckVersion,
  EGRESS_ACK_VERSION,
  localDateString,
  readAutoFilingStartDay,
  readDeviceAutoRunState,
  resolveAutoFilingSince,
  shouldRunAutoProcess,
  shouldStampLastRunDay,
  writeAutoFilingStartDay,
  writeAutoRunEnabled,
  writeEgressAck,
  writeLastRunDay,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_START_DAY,
  LS_LAST_RUN_DAY,
  PER_LAUNCH_CAP,
} from "../src/platform/autorun";

describe("shouldRunAutoProcess", () => {
  it("same-calendar-day with no past work → no run", () => {
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: "2026-07-15",
        today: "2026-07-15",
        egressAcked: true,
        pastUnprocessedRemaining: 0,
      }),
    ).toBe(false);
  });

  it("same-calendar-day with past work remaining → runs (cap drain / retry)", () => {
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: "2026-07-15",
        today: "2026-07-15",
        egressAcked: true,
        pastUnprocessedRemaining: 5,
      }),
    ).toBe(true);
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
        pastUnprocessedRemaining: 9,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoProcess({
        enabled: true,
        lastRunDay: null,
        today: "2026-07-15",
        egressAcked: false,
        pastUnprocessedRemaining: 9,
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

describe("shouldStampLastRunDay", () => {
  it("does not stamp on throw", () => {
    expect(
      shouldStampLastRunDay({ threw: true, pastRemainingAfter: 0 }),
    ).toBe(false);
  });

  it("stamps when finished and no past remaining", () => {
    expect(
      shouldStampLastRunDay({ threw: false, pastRemainingAfter: 0 }),
    ).toBe(true);
  });

  it("does not stamp when past work remains (cap / failures)", () => {
    expect(
      shouldStampLastRunDay({ threw: false, pastRemainingAfter: 2 }),
    ).toBe(false);
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
    expect(store[LS_AUTO_RUN_EGRESS_ACK]).toBe(EGRESS_ACK_VERSION);
    expect(store[LS_LAST_RUN_DAY]).toBe("2026-07-14");

    const state = readDeviceAutoRunState(load);
    expect(state).toEqual({
      enabled: true,
      lastRunDay: "2026-07-14",
      egressAcked: true,
      startDay: null,
    });

    // Keys are device-local names — not written into settings object shape
    expect(Object.keys(store).every((k) => k.startsWith("atoms-"))).toBe(
      true,
    );
  });

  /**
   * U6 / KTD4 — the ack has to say *what* was consented to, or it cannot go stale.
   *
   * The legacy `true` is the case that matters: those devices granted unattended egress against
   * the old home modal's wording, and reading them as acknowledged is exactly the consent record
   * #315 called wrong.
   */
  describe("egress ack staleness", () => {
    const stored = (v: unknown) => (k: string) =>
      k === LS_AUTO_RUN_EGRESS_ACK ? v : null;

    it("reads the version an accept stored", () => {
      const store: Record<string, unknown> = {};
      writeEgressAck((k, v) => {
        store[k] = v;
      }, true);
      const load = (k: string) => store[k] ?? null;

      expect(readEgressAckVersion(load)).toBe(EGRESS_ACK_VERSION);
      expect(readDeviceAutoRunState(load).egressAcked).toBe(true);
    });

    it("treats the legacy boolean as never acknowledged", () => {
      expect(readEgressAckVersion(stored(true))).toBeNull();
      expect(readDeviceAutoRunState(stored(true)).egressAcked).toBe(false);
    });

    it("treats a stamp from older wording as never acknowledged", () => {
      expect(egressAckIsCurrent("2020-01-01")).toBe(false);
      expect(readDeviceAutoRunState(stored("2020-01-01")).egressAcked).toBe(false);
    });

    it("withdrawal clears it", () => {
      const store: Record<string, unknown> = {};
      const save = (k: string, v: unknown) => {
        store[k] = v;
      };
      writeEgressAck(save, true);
      writeEgressAck(save, false);

      expect(store[LS_AUTO_RUN_EGRESS_ACK]).toBe(false);
      expect(readDeviceAutoRunState((k) => store[k] ?? null).egressAcked).toBe(false);
    });

    it("rejects blank and non-string stamps", () => {
      for (const junk of ["", "   ", 1, null, undefined, {}]) {
        expect(readEgressAckVersion(stored(junk))).toBeNull();
        expect(readDeviceAutoRunState(stored(junk)).egressAcked).toBe(false);
      }
    });
  });

  it("enableAutomaticFiling sets ack + enabled", () => {
    const store: Record<string, unknown> = {};
    const save = (k: string, v: unknown) => {
      store[k] = v;
    };
    enableAutomaticFiling(save);
    expect(store[LS_AUTO_RUN_ENABLED]).toBe(true);
    expect(store[LS_AUTO_RUN_EGRESS_ACK]).toBe(EGRESS_ACK_VERSION);
  });
});

/**
 * U1 / KTD2 — the filing window bound, which must fail closed.
 *
 * "No usable stamp" can never mean "no bound": that is the unbounded full-history sweep this
 * plan exists to kill, so every unreadable value is re-stamped with today instead.
 */
describe("auto-filing window", () => {
  const makeStore = () => {
    const store: Record<string, unknown> = {};
    const load = (k: string) => store[k] ?? null;
    const save = (k: string, v: unknown) => {
      store[k] = v;
    };
    return { store, load, save };
  };

  /** Shapes that look like a day but are not one. Each must be rejected, not passed through. */
  const malformed = [
    "",
    "   ",
    "2026-13-01",
    "2026-02-31",
    "2026-00-10",
    "2026-08-00",
    "2026-08-32",
    "20260810",
    "2026-8-1",
    "2026-08-10T00:00:00",
    "yesterday",
    "0000-00-00",
    true,
    42,
    null,
    undefined,
    {},
  ];

  describe("readAutoFilingStartDay", () => {
    it("reads a well-formed stamp", () => {
      const { load, save } = makeStore();
      writeAutoFilingStartDay(save, "2026-08-10");
      expect(readAutoFilingStartDay(load)).toBe("2026-08-10");
    });

    it("is null when unset", () => {
      const { load } = makeStore();
      expect(readAutoFilingStartDay(load)).toBeNull();
    });

    it("is null for anything that is not a real calendar day", () => {
      for (const junk of malformed) {
        const load = (k: string) => (k === LS_AUTO_RUN_START_DAY ? junk : null);
        expect(readAutoFilingStartDay(load)).toBeNull();
      }
    });
  });

  describe("writeAutoFilingStartDay", () => {
    it("persists a valid day", () => {
      const { store, save } = makeStore();
      writeAutoFilingStartDay(save, "2026-08-10");
      expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
    });

    it("refuses to persist an invalid day", () => {
      for (const junk of malformed) {
        const { store, save } = makeStore();
        writeAutoFilingStartDay(save, junk as string);
        expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
      }
    });
  });

  describe("resolveAutoFilingSince", () => {
    it("stamps and returns today when the key is missing", () => {
      const { store, load, save } = makeStore();
      expect(resolveAutoFilingSince(load, save, "2026-08-10")).toBe("2026-08-10");
      expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
    });

    it("re-stamps a malformed value rather than reading it as no bound", () => {
      for (const junk of malformed) {
        const { store, load, save } = makeStore();
        store[LS_AUTO_RUN_START_DAY] = junk;

        expect(resolveAutoFilingSince(load, save, "2026-08-10")).toBe("2026-08-10");
        expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
      }
    });

    it("returns a valid stamp unchanged and does not re-stamp it", () => {
      const { load, save } = makeStore();
      writeAutoFilingStartDay(save, "2026-07-31");

      let saves = 0;
      const countingSave = (k: string, v: unknown) => {
        saves += 1;
        save(k, v);
      };

      expect(resolveAutoFilingSince(load, countingSave, "2026-08-10")).toBe(
        "2026-07-31",
      );
      expect(saves).toBe(0);
    });

    it("never returns undefined, null, or empty for any stored value", () => {
      for (const junk of [...malformed, "2026-08-10", [], NaN]) {
        const { load, save } = makeStore();
        save(LS_AUTO_RUN_START_DAY, junk);

        const since = resolveAutoFilingSince(load, save, "2026-08-10");
        expect(typeof since).toBe("string");
        expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("normalizes a malformed today rather than handing back an unusable bound", () => {
      const realToday = localDateString();

      for (const junk of malformed) {
        const { store, load, save } = makeStore();

        const since = resolveAutoFilingSince(load, save, junk as string);
        expect(since).toBe(realToday);
        expect(store[LS_AUTO_RUN_START_DAY]).toBe(realToday);
      }
    });
  });

  it("comparison stays lexical across a month boundary", () => {
    // The bound is applied as a string compare — never Date math, so no DST hazard.
    expect("2026-07-31" < "2026-08-01").toBe(true);
    expect("2026-08-01" >= "2026-07-31").toBe(true);
    expect("2026-12-31" < "2027-01-01").toBe(true);
  });

  it("DeviceAutoRunState carries the stamp, null when unset", () => {
    const { store, load, save } = makeStore();
    expect(readDeviceAutoRunState(load).startDay).toBeNull();

    writeAutoFilingStartDay(save, "2026-08-10");
    expect(readDeviceAutoRunState(load).startDay).toBe("2026-08-10");

    store[LS_AUTO_RUN_START_DAY] = "2026-13-01";
    expect(readDeviceAutoRunState(load).startDay).toBeNull();
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
