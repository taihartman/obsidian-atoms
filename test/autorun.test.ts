import { describe, expect, it } from "vitest";
import {
  canBuildContext,
  egressAckIsCurrent,
  enableAutomaticFiling,
  readEgressAckVersion,
  EGRESS_ACK_VERSION,
  localDateString,
  includeTodayForRun,
  migrateAutoFilingWindow,
  readAutoFilingSince,
  readAutoFilingStartDay,
  readAutoFilingWindowMigrated,
  setAutomaticFilingEnabled,
  stampAutoFilingWindowStart,
  readDeviceAutoRunState,
  resolveAutoFilingSince,
  runAutoFilingCycle,
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
import type { AutoFilingGate } from "../src/platform/autorun";

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
    /** A store whose device has automatic filing on — the only device allowed to stamp. */
    const makeEnabledStore = () => {
      const s = makeStore();
      s.save(LS_AUTO_RUN_ENABLED, true);
      return s;
    };

    it("an enabled device with no stamp returns today and persists it", () => {
      const { store, load, save } = makeEnabledStore();
      expect(resolveAutoFilingSince(load, save, "2026-08-10")).toBe("2026-08-10");
      expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
    });

    // The window start means "the day the user turned automatic filing on". A device that never
    // enabled it must not mint one on first launch: that stamp would age into an ever-widening
    // sweep the moment the user later taps catch-up. Returning today without persisting is the
    // strictly safest bound — it stays "today" forever instead of drifting backwards.
    it("a disabled device with no stamp returns today and persists nothing", () => {
      const { store, load, save } = makeStore();
      expect(resolveAutoFilingSince(load, save, "2026-08-10")).toBe("2026-08-10");
      expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
    });

    it("a disabled device with a corrupt stamp still persists nothing", () => {
      for (const junk of malformed) {
        const { store, load, save } = makeStore();
        store[LS_AUTO_RUN_START_DAY] = junk;

        expect(resolveAutoFilingSince(load, save, "2026-08-10")).toBe("2026-08-10");
        expect(store[LS_AUTO_RUN_START_DAY]).toBe(junk);
      }
    });

    it("a disabled device returns a valid stored stamp unchanged", () => {
      const { store, load, save } = makeStore();
      store[LS_AUTO_RUN_START_DAY] = "2026-07-31";

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

    it("an enabled device re-stamps a malformed value rather than reading it as no bound", () => {
      for (const junk of malformed) {
        const { store, load, save } = makeEnabledStore();
        store[LS_AUTO_RUN_START_DAY] = junk;

        expect(resolveAutoFilingSince(load, save, "2026-08-10")).toBe("2026-08-10");
        expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
      }
    });

    it("returns a valid stamp unchanged and does not re-stamp it", () => {
      const { load, save } = makeEnabledStore();
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
        save(LS_AUTO_RUN_ENABLED, true);

        const since = resolveAutoFilingSince(load, save, junk as string);
        expect(since).toBe(realToday);
        expect(store[LS_AUTO_RUN_START_DAY]).toBe(realToday);
      }
    });
  });

  /**
   * The read-only twin of the resolver, for surfaces that only display the bound.
   *
   * Two of them — home's refresh and the auto-run status command — used the persisting resolver.
   * Beyond writing device state from a read, that raced `migrateAutoFilingWindow`: the migration
   * only stamps when nothing is stored, so a read that stamped first made it skip and never set
   * its flag, and the "your sweep was paused" copy that flag drives never appeared.
   */
  describe("readAutoFilingSince", () => {
    it("returns the same bound as the resolver, and persists nothing", () => {
      for (const enabled of [true, false]) {
        const { store, load, save } = makeStore();
        if (enabled) save(LS_AUTO_RUN_ENABLED, true);
        const before = { ...store };

        expect(readAutoFilingSince(load, "2026-08-10")).toBe(
          resolveAutoFilingSince(
            (k) => before[k] ?? null,
            () => {},
            "2026-08-10",
          ),
        );
        expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
      }
    });

    it("returns a valid stored stamp unchanged", () => {
      const { load, save } = makeStore();
      writeAutoFilingStartDay(save, "2026-07-31");
      expect(readAutoFilingSince(load, "2026-08-10")).toBe("2026-07-31");
    });

    it("falls back to today for every unusable stamp, and normalizes a bad today", () => {
      for (const junk of malformed) {
        const { load, save } = makeStore();
        save(LS_AUTO_RUN_START_DAY, junk);
        expect(readAutoFilingSince(load, "2026-08-10")).toBe("2026-08-10");
        expect(readAutoFilingSince(load, junk as string)).toBe(localDateString());
      }
    });

    it("leaves the migration its stamp to write", () => {
      const { load, save } = makeStore();
      save(LS_AUTO_RUN_ENABLED, true);

      // A home refresh landing before the migration, which waits on the vault index.
      readAutoFilingSince(load, "2026-08-10");

      expect(migrateAutoFilingWindow(load, save, "2026-08-10")).toBe(true);
      expect(readAutoFilingWindowMigrated(load)).toBe(true);
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

describe("runAutoFilingCycle — termination (V2, KTD2)", () => {
  // This is the regression that costs nothing visible and never stops: if the count scans all
  // history while the write files only the window, the recount never reaches zero,
  // shouldStampLastRunDay never stamps, and auto-run rescans the whole vault every hour forever.
  // The cycle is extracted so this test drives the *same* resolve→count→file→recount→stamp path
  // maybeAutoRun drives, instead of degrading into another pure-predicate test.
  //
  // KNOWN LIMIT — termination also depends on every in-window capture being fileable. A
  // quarantined capture, or an `exhausted` Plus status that files nothing, leaves unmarked
  // captures inside the window forever and reproduces the same loop. That is pre-existing and
  // is NOT closed here; this test freezes only the bound-drift half.

  function makeStore() {
    const store: Record<string, unknown> = {};
    return {
      store,
      load: (k: string) => store[k],
      save: (k: string, v: unknown) => {
        store[k] = v;
      },
    };
  }

  /** A vault of daily notes, each holding `perDay` unmarked captures. */
  function makeVault(days: string[], perDay: number) {
    const remaining = new Map(days.map((d) => [d, perDay]));
    return {
      /** Unmarked captures at or after `since` — the bounded count. */
      count(since: string): number {
        let n = 0;
        for (const [day, left] of remaining) if (day >= since) n += left;
        return n;
      },
      /** Every unmarked capture, window or not — the pre-U2 unbounded count. */
      countAll(): number {
        let n = 0;
        for (const left of remaining.values()) n += left;
        return n;
      },
      /** File up to PER_LAUNCH_CAP inside the window; returns markers appended. */
      file(since: string): number {
        let filed = 0;
        for (const day of [...remaining.keys()].sort()) {
          if (day < since) continue;
          while (filed < PER_LAUNCH_CAP && (remaining.get(day) ?? 0) > 0) {
            remaining.set(day, (remaining.get(day) ?? 0) - 1);
            filed++;
          }
          if (filed >= PER_LAUNCH_CAP) break;
        }
        return filed;
      },
      preWindowRemaining(since: string): number {
        let n = 0;
        for (const [day, left] of remaining) if (day < since) n += left;
        return n;
      },
    };
  }

  const history = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 5, 1) + i * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const windowStart = "2026-07-25";
  const today = "2026-08-10";

  it("a history far larger than PER_LAUNCH_CAP terminates and stamps the day", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    const vault = makeVault(history, 10); // 600 captures, 40x the per-launch cap
    const bounds: string[] = [];

    let passes = 0;
    let stamped = false;
    while (!stamped && passes < 200) {
      passes++;
      const result = await runAutoFilingCycle({
        load,
        save,
        today,
        count: async (since) => vault.count(since),
        gate: () => ({ ok: true }),
        file: async (since) => {
          bounds.push(since);
          return { markersAppended: vault.file(since) };
        },
      });
      bounds.push(result.since);
      stamped = result.stamped;
    }

    expect(stamped).toBe(true);
    expect(passes).toBeLessThan(200);
    expect(store[LS_LAST_RUN_DAY]).toBe(today);
    // Every pass used the one resolved bound, and pre-window history was never touched.
    expect(new Set(bounds)).toEqual(new Set([windowStart]));
    expect(vault.count(windowStart)).toBe(0);
    expect(vault.preWindowRemaining(windowStart)).toBeGreaterThan(0);
  });

  it("counting wider than the write is the forever loop (the bug being frozen out)", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    const vault = makeVault(history, 10);

    for (let i = 0; i < 100; i++) {
      const result = await runAutoFilingCycle({
        load,
        save,
        today,
        // The drift: count all history, file only the window.
        count: async () => vault.countAll(),
        gate: () => ({ ok: true }),
        file: async (since) => ({ markersAppended: vault.file(since) }),
      });
      expect(result.stamped).toBe(false);
    }
    expect(vault.count(windowStart)).toBe(0); // window drained long ago
    expect(store[LS_LAST_RUN_DAY]).toBeUndefined(); // yet the day is never stamped
  });

  it("resolves the bound once and hands the same value to count and file", async () => {
    const { load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    const seen: Array<["count" | "file", string]> = [];

    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async (since) => {
        seen.push(["count", since]);
        return seen.filter(([k]) => k === "file").length ? 0 : 3;
      },
      gate: () => ({ ok: true }),
      file: async (since) => {
        seen.push(["file", since]);
        return { markersAppended: 3 };
      },
    });

    expect(result.since).toBe(windowStart);
    expect(seen).toEqual([
      ["count", windowStart],
      ["file", windowStart],
      ["count", windowStart],
    ]);
    expect(result.stamped).toBe(true);
  });

  // Supersedes "stamps a bound on a device that never enabled": onload drives this cycle
  // regardless of the enable flag, so stamping here made the window start mean "first launch
  // of this build" instead of "the day the user enabled filing".
  it("a device that never enabled is bounded to today but persists no stamp", async () => {
    const { store, load, save } = makeStore();
    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async () => 0,
      gate: () => ({ ok: true }),
      file: async () => ({ markersAppended: 0 }),
    });
    expect(result.since).toBe(today);
    expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
  });

  // Tapping catch-up bypasses the enable check *for that run*; it is not the user turning
  // filing on, so it must not mint a window start that then widens with every idle day.
  it("the catch-up bypass does not stamp a window start", async () => {
    const { store, load, save } = makeStore();
    const laterToday = "2026-10-01";
    const result = await runAutoFilingCycle({
      load,
      save,
      today: laterToday,
      count: async () => 0,
      // What maybeAutoRun's gate does under catchUp.bypassEnabled: treats disabled as enabled.
      gate: () => ({ ok: true }),
      file: async () => ({ markersAppended: 0 }),
    });
    expect(result.since).toBe(laterToday);
    expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
  });

  it("an enabled device stamps its window start on the first cycle", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_ENABLED, true);
    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async () => 0,
      gate: () => ({ ok: true }),
      file: async () => ({ markersAppended: 0 }),
    });
    expect(result.since).toBe(today);
    expect(store[LS_AUTO_RUN_START_DAY]).toBe(today);
  });

  it("an empty window stamps the day so the hourly interval stops re-scanning", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    let filed = 0;

    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async () => 0,
      gate: () => ({ ok: true }),
      file: async () => {
        filed++;
        return { markersAppended: 0 };
      },
    });

    expect(result).toMatchObject({ ran: true, reason: "empty", stamped: true });
    expect(filed).toBe(0); // never pays for a pass with nothing to file
    expect(store[LS_LAST_RUN_DAY]).toBe(today);
  });

  it("a closed gate neither files nor stamps, and reports its own reason", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    let filed = 0;

    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async () => 7,
      gate: (remaining) => {
        expect(remaining).toBe(7);
        return { ok: false, reason: "missing_key" };
      },
      file: async () => {
        filed++;
        return { markersAppended: 7 };
      },
    });

    expect(result).toMatchObject({ ran: false, reason: "missing_key", stamped: false });
    expect(filed).toBe(0);
    expect(store[LS_LAST_RUN_DAY]).toBeUndefined();
  });

  it("a throwing write never stamps, so the day retries", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    const seen: string[] = [];

    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async () => 4,
      gate: () => ({ ok: true }),
      file: async () => {
        throw new Error("offline");
      },
      beginWork: () => {
        seen.push("begin");
      },
      endWork: () => {
        seen.push("end");
      },
      onError: (e) => seen.push(`error:${(e as Error).message}`),
    });

    expect(result).toMatchObject({ ran: false, reason: "error", stamped: false });
    expect(store[LS_LAST_RUN_DAY]).toBeUndefined();
    expect(seen).toEqual(["begin", "error:offline", "end"]);
  });

  // maybeAutoRun fires from onload, an hourly interval, the manual path, and commands. The
  // in-flight check and the in-flight set must land in one synchronous step: with an await
  // between them, two callers both read "free" and both pay for a write pass.
  it("two overlapping cycles: only one runs the paid write pass", async () => {
    const { load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);

    let inFlight = false;
    const files: string[] = [];
    const cycle = () =>
      runAutoFilingCycle({
        load,
        save,
        today,
        count: async () => 5,
        gate: async () => ({ ok: true }),
        beginWork: () => {
          if (inFlight) return false;
          inFlight = true;
          return true;
        },
        endWork: () => {
          inFlight = false;
        },
        file: async (since) => {
          files.push(since);
          return { markersAppended: 5 };
        },
      });

    const [a, b] = await Promise.all([cycle(), cycle()]);

    expect(files).toEqual([windowStart]);
    const reasons = [a.reason, b.reason].sort();
    expect(reasons).toEqual(["in_flight", "ok"]);
    expect(inFlight).toBe(false);
  });

  // Every exit after the claim must release it — the gate's own not-ok returns and the empty
  // short-circuit included, or one skipped release wedges filing until the app restarts.
  it("releases the in-flight claim on every exit path", async () => {
    const shapes: Array<{
      name: string;
      count: number;
      gate: AutoFilingGate;
      throws?: boolean;
    }> = [
      { name: "gate closed", count: 5, gate: { ok: false, reason: "missing_key" } },
      { name: "empty window", count: 0, gate: { ok: true } },
      { name: "write throws", count: 5, gate: { ok: true }, throws: true },
      { name: "ok", count: 5, gate: { ok: true } },
    ];

    for (const shape of shapes) {
      const { load, save } = makeStore();
      save(LS_AUTO_RUN_START_DAY, windowStart);
      let inFlight = false;

      await runAutoFilingCycle({
        load,
        save,
        today,
        count: async () => shape.count,
        gate: async () => shape.gate,
        beginWork: () => {
          inFlight = true;
          return true;
        },
        endWork: () => {
          inFlight = false;
        },
        file: async () => {
          if (shape.throws) throw new Error("offline");
          return { markersAppended: shape.count };
        },
        onError: () => {},
      });

      expect(inFlight, shape.name).toBe(false);
    }
  });

  // onFiled runs *after* writeLastRunDay, and it raises Notices and refreshes home — so it can
  // throw with the day already stamped and the captures already filed. The error result has to
  // say what is on disk, not the zeroes that read as "nothing happened".
  it("a throw after the write reports the captures actually filed and the day actually stamped", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);

    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async (_since, fallback) => fallback ?? 6,
      gate: () => ({ ok: true }),
      file: async () => ({ markersAppended: 6 }),
      onFiled: () => {
        throw new Error("home refresh blew up");
      },
      onError: () => {},
    });

    expect(store[LS_LAST_RUN_DAY]).toBe(today); // the day really was burned
    expect(result).toMatchObject({
      ran: false,
      reason: "error",
      filed: 6,
      stamped: true,
    });
  });

  it("the recount falls back to count-minus-filed when listing fails", async () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, windowStart);
    const fallbacks: Array<number | undefined> = [];

    const result = await runAutoFilingCycle({
      load,
      save,
      today,
      count: async (_since, fallback) => {
        fallbacks.push(fallback);
        return fallback ?? 9;
      },
      gate: () => ({ ok: true }),
      file: async () => ({ markersAppended: 9 }),
    });

    expect(fallbacks).toEqual([undefined, 0]);
    expect(result.stamped).toBe(true);
    expect(store[LS_LAST_RUN_DAY]).toBe(today);
  });
});

/**
 * U3 / U4 — who stamps the filing-window start, and when.
 *
 * The window start means "the day this user turned automatic filing on", so every enable path
 * has to write it. Leaning on `resolveAutoFilingSince`'s fail-closed fallback instead would make
 * the stamp depend on an enable path happening to kick a run first — load-bearing ordering by
 * accident.
 */
describe("stamping the filing window (U3/U4)", () => {
  const makeStore = () => {
    const store: Record<string, unknown> = {};
    const load = (k: string) => store[k] ?? null;
    const save = (k: string, v: unknown) => {
      store[k] = v;
    };
    return { store, load, save };
  };

  it("enableAutomaticFiling stamps the day filing was turned on", () => {
    const { store, load, save } = makeStore();

    enableAutomaticFiling(save, { load, today: "2026-08-10" });

    expect(store[LS_AUTO_RUN_ENABLED]).toBe(true);
    expect(store[LS_AUTO_RUN_EGRESS_ACK]).toBe(EGRESS_ACK_VERSION);
    expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
  });

  it("the Settings toggle stamps through the same helper", () => {
    const { store, load, save } = makeStore();

    setAutomaticFilingEnabled(load, save, true, "2026-08-10");

    expect(store[LS_AUTO_RUN_ENABLED]).toBe(true);
    expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
  });

  it("disabling preserves the previous stamp (KTD6)", () => {
    const { store, load, save } = makeStore();
    setAutomaticFilingEnabled(load, save, true, "2026-08-10");

    setAutomaticFilingEnabled(load, save, false, "2026-08-20");

    expect(store[LS_AUTO_RUN_ENABLED]).toBe(false);
    expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
  });

  it("re-enabling stamps the later day", () => {
    const { store, load, save } = makeStore();
    setAutomaticFilingEnabled(load, save, true, "2026-08-10");
    setAutomaticFilingEnabled(load, save, false, "2026-08-12");

    setAutomaticFilingEnabled(load, save, true, "2026-08-20");

    expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-20");
  });

  it("never lets an earlier day overwrite a later one", () => {
    const { store, load, save } = makeStore();
    save(LS_AUTO_RUN_START_DAY, "2026-08-20");

    stampAutoFilingWindowStart(load, save, "2026-08-01");
    expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-20");

    stampAutoFilingWindowStart(load, save, "2026-08-21");
    expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-21");
  });

  it("never stamps a day that is not a real date", () => {
    const { store, load, save } = makeStore();

    for (const junk of ["", "   ", "2026-8-1", "2026-02-31", "tomorrow"]) {
      stampAutoFilingWindowStart(load, save, junk);
    }

    expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
  });

  /**
   * KTD1 — today's daily is reachable from the enable tap and from nothing else. Every
   * unattended source has to be forced back to false here, not merely never asked.
   */
  describe("includeToday", () => {
    it("is true only for the attended enable tap", () => {
      expect(includeTodayForRun("manual", true)).toBe(true);
      for (const source of ["onload", "interval", "resume"] as const) {
        expect(includeTodayForRun(source, true)).toBe(false);
      }
    });

    it("defaults to false on every source", () => {
      for (const source of ["onload", "interval", "manual", "resume"] as const) {
        expect(includeTodayForRun(source)).toBe(false);
        expect(includeTodayForRun(source, false)).toBe(false);
      }
    });
  });

  /**
   * U4 / KTD5 — devices that had filing on before the window existed carry no start day. The
   * migration stamps it ahead of the first pass and records that it happened, so a later
   * surface can explain why an in-progress sweep stopped rather than reading as a new upsell.
   */
  describe("migration", () => {
    it("stamps once and flags the device", () => {
      const { store, load, save } = makeStore();
      save(LS_AUTO_RUN_ENABLED, true);

      expect(migrateAutoFilingWindow(load, save, "2026-08-10")).toBe(true);
      expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
      expect(readAutoFilingWindowMigrated(load)).toBe(true);
    });

    it("does not re-stamp on the next load", () => {
      const { store, load, save } = makeStore();
      save(LS_AUTO_RUN_ENABLED, true);
      migrateAutoFilingWindow(load, save, "2026-08-10");

      expect(migrateAutoFilingWindow(load, save, "2026-08-20")).toBe(false);
      expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-08-10");
    });

    it("leaves an existing stamp untouched and flags nothing", () => {
      const { store, load, save } = makeStore();
      save(LS_AUTO_RUN_ENABLED, true);
      save(LS_AUTO_RUN_START_DAY, "2026-07-01");

      expect(migrateAutoFilingWindow(load, save, "2026-08-10")).toBe(false);
      expect(store[LS_AUTO_RUN_START_DAY]).toBe("2026-07-01");
      expect(readAutoFilingWindowMigrated(load)).toBe(false);
    });

    it("gives a disabled device neither stamp nor flag", () => {
      const { store, load, save } = makeStore();

      expect(migrateAutoFilingWindow(load, save, "2026-08-10")).toBe(false);
      expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
      expect(readAutoFilingWindowMigrated(load)).toBe(false);
    });
  });
});
