import { describe, expect, it } from "vitest";
import {
  BACKFILL_CAP,
  DAILY_BURN,
  RESERVE_BASELINE,
  daysRemainingFrom,
  deriveRecentFirstRange,
  resolveBackfillBudget,
  type BackfillDaily,
} from "../src/pipeline/backfillOffer";

function daily(
  date: string,
  unprocessedCount: number,
): BackfillDaily {
  return { date, path: `Daily/${date}.md`, unprocessedCount };
}

describe("daysRemainingFrom", () => {
  it("counts whole UTC days between today and periodEnd", () => {
    expect(daysRemainingFrom("2026-08-10", "2026-08-20T04:00:00.000Z")).toBe(10);
  });

  it("is null for a missing or unparseable periodEnd", () => {
    expect(daysRemainingFrom("2026-08-10", undefined)).toBeNull();
    expect(daysRemainingFrom("2026-08-10", "soon")).toBeNull();
    expect(daysRemainingFrom("2026-08-10", "")).toBeNull();
  });

  it("is null for a non-positive difference (expired period / clock skew)", () => {
    expect(daysRemainingFrom("2026-08-10", "2026-08-10T00:00:00.000Z")).toBeNull();
    expect(daysRemainingFrom("2026-08-10", "2026-08-07T00:00:00.000Z")).toBeNull();
  });

  it("does not shift across a DST boundary", () => {
    // US DST ends 2026-11-01; a raw-instant subtraction would give 13.96 days here.
    expect(daysRemainingFrom("2026-10-25", "2026-11-08")).toBe(14);
  });
});

describe("resolveBackfillBudget", () => {
  it("shrinks the reserve with daysRemaining on a fresh periodEnd", () => {
    const near = resolveBackfillBudget({
      period: "trial",
      fresh: true,
      remaining: 150,
      today: "2026-08-10",
      periodEnd: "2026-08-12",
    });
    expect(near.daysRemaining).toBe(2);
    expect(near.reserve).toBe(2 * DAILY_BURN);
    expect(near.budget).toBe(Math.min(BACKFILL_CAP.trial, 150 - 10));
  });

  it("never lets the reserve exceed the baseline on a long period", () => {
    const far = resolveBackfillBudget({
      period: "paid",
      fresh: true,
      remaining: 150,
      today: "2026-08-10",
      periodEnd: "2026-12-31",
    });
    expect(far.reserve).toBe(RESERVE_BASELINE.paid);
  });

  it("falls back to the full baseline reserve when the refresh failed", () => {
    const stale = resolveBackfillBudget({
      period: "trial",
      fresh: false,
      remaining: 150,
      today: "2026-08-10",
      periodEnd: "2026-08-11",
    });
    expect(stale.reserve).toBe(RESERVE_BASELINE.trial);
    expect(stale.reserve).toBeLessThanOrEqual(RESERVE_BASELINE.trial);
    expect(stale.budget).toBe(Math.min(BACKFILL_CAP.trial, 150 - RESERVE_BASELINE.trial));
  });

  it("takes the baseline reserve for a periodEnd in the past, and never spends past remaining", () => {
    const past = resolveBackfillBudget({
      period: "paid",
      fresh: true,
      remaining: 90,
      today: "2026-08-10",
      periodEnd: "2026-08-07",
    });
    expect(past.daysRemaining).toBeNull();
    expect(past.reserve).toBe(RESERVE_BASELINE.paid);
    expect(past.budget).toBe(0);
    expect(past.budget).toBeLessThanOrEqual(90);
  });

  it("floors the budget at 0 when remaining is already below the reserve", () => {
    const low = resolveBackfillBudget({
      period: "paid",
      fresh: true,
      remaining: 12,
      today: "2026-08-10",
      periodEnd: "2026-09-09",
    });
    expect(low.budget).toBe(0);
  });

  it("never exceeds BACKFILL_CAP even on a full meter", () => {
    const full = resolveBackfillBudget({
      period: "trial",
      fresh: true,
      remaining: 10_000,
      today: "2026-08-10",
      periodEnd: "2026-08-24",
    });
    expect(full.budget).toBe(BACKFILL_CAP.trial);
  });

  it("resolves different constants for trial and paid from the same remaining", () => {
    const args = {
      fresh: false as const,
      remaining: 150,
      today: "2026-08-10",
      periodEnd: "2026-08-24",
    };
    const trial = resolveBackfillBudget({ ...args, period: "trial" });
    const paid = resolveBackfillBudget({ ...args, period: "paid" });
    expect(trial.reserve).toBe(70);
    expect(paid.reserve).toBe(100);
    expect(trial.budget).toBe(75);
    expect(paid.budget).toBe(50);
    expect(trial.budget).not.toBe(paid.budget);
  });

  it("gives BYOK no reserve and the cap outright", () => {
    const byok = resolveBackfillBudget({
      period: "byok",
      fresh: false,
      today: "2026-08-10",
    });
    expect(byok.reserve).toBe(0);
    expect(byok.budget).toBe(BACKFILL_CAP.byok);
    expect(byok.budget).toBe(50);
  });

  it("takes the baseline reserve when remaining is unknown on a metered plan", () => {
    const unknown = resolveBackfillBudget({
      period: "paid",
      fresh: true,
      today: "2026-08-10",
      periodEnd: "2026-09-09",
    });
    expect(unknown.reserve).toBe(RESERVE_BASELINE.paid);
    expect(unknown.budget).toBe(0);
  });
});

describe("deriveRecentFirstRange", () => {
  const before = "2026-08-01";

  it("takes the newest dailies before the window, not the oldest", () => {
    const range = deriveRecentFirstRange({
      dailies: [
        daily("2026-05-01", 10),
        daily("2026-06-01", 10),
        daily("2026-07-01", 10),
      ],
      before,
      budget: 20,
    });
    expect(range.since).toBe("2026-06-01");
    expect(range.before).toBe(before);
    expect(range.captures).toBe(20);
    expect(range.dailies).toBe(2);
    expect(range.totalCaptures).toBe(30);
    expect(range.overBudget).toBe(false);
  });

  it("excludes a daily that would exceed the budget whole, never split", () => {
    const range = deriveRecentFirstRange({
      dailies: [daily("2026-07-01", 8), daily("2026-07-02", 8)],
      before,
      budget: 12,
    });
    expect(range.since).toBe("2026-07-02");
    expect(range.captures).toBe(8);
    expect(range.dailies).toBe(1);
  });

  it("signals overBudget rather than an empty offer for a single oversized daily", () => {
    const range = deriveRecentFirstRange({
      dailies: [daily("2026-07-02", 120)],
      before,
      budget: 50,
    });
    expect(range.overBudget).toBe(true);
    expect(range.since).toBeUndefined();
    expect(range.captures).toBe(0);
    expect(range.dailies).toBe(0);
    expect(range.totalCaptures).toBe(120);
  });

  it("signals overBudget when the budget is zero and work remains", () => {
    const range = deriveRecentFirstRange({
      dailies: [daily("2026-07-02", 3)],
      before,
      budget: 0,
    });
    expect(range.overBudget).toBe(true);
    expect(range.since).toBeUndefined();
  });

  it("orders unsorted input correctly (the explicit sort)", () => {
    const range = deriveRecentFirstRange({
      dailies: [
        daily("2026-06-01", 5),
        daily("2026-07-15", 5),
        daily("2026-05-01", 5),
        daily("2026-07-01", 5),
      ],
      before,
      budget: 10,
    });
    expect(range.since).toBe("2026-07-01");
    expect(range.captures).toBe(10);
    expect(range.notes.map((n) => n.date)).toEqual(["2026-07-15", "2026-07-01"]);
  });

  it("caps a BYOK range recent-first rather than taking the whole complement", () => {
    const dailies = Array.from({ length: 20 }, (_, i) =>
      daily(`2026-07-${String(i + 1).padStart(2, "0")}`, 10),
    );
    const byok = resolveBackfillBudget({
      period: "byok",
      fresh: false,
      today: "2026-08-10",
    });
    const range = deriveRecentFirstRange({ dailies, before, budget: byok.budget });
    expect(range.captures).toBe(50);
    expect(range.dailies).toBe(5);
    expect(range.since).toBe("2026-07-16");
    expect(range.totalCaptures).toBe(200);
    expect(range.overBudget).toBe(false);
  });

  it("returns an empty, non-overBudget range for an empty list", () => {
    const range = deriveRecentFirstRange({ dailies: [], before, budget: 50 });
    expect(range.since).toBeUndefined();
    expect(range.captures).toBe(0);
    expect(range.dailies).toBe(0);
    expect(range.totalCaptures).toBe(0);
    expect(range.overBudget).toBe(false);
  });

  it("returns an empty, non-overBudget range for a zero complement", () => {
    const range = deriveRecentFirstRange({
      dailies: [daily("2026-07-01", 0), daily("2026-07-02", 0)],
      before,
      budget: 50,
    });
    expect(range.totalCaptures).toBe(0);
    expect(range.overBudget).toBe(false);
    expect(range.since).toBeUndefined();
  });

  it("keeps since inclusive and before exclusive (daily.ts bound semantics)", () => {
    const range = deriveRecentFirstRange({
      dailies: [daily("2026-07-31", 5), daily("2026-08-01", 5)],
      before: "2026-08-01",
      budget: 50,
    });
    // The window-start daily itself is never in the complement: `before` is exclusive.
    expect(range.notes.map((n) => n.date)).toEqual(["2026-07-31"]);
    expect(range.since).toBe("2026-07-31");
  });
});
