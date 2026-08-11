/**
 * Backfill offer arithmetic (KTD9 + KTD10) — pure, dependency-free.
 *
 * Two bounds, not one leftover: a **period reserve** that protects forward
 * filing, and a **per-period cap** that drains the backlog gradually so the
 * subscription keeps earning while it drains. Everything is passed in — no
 * Obsidian API, no network, no clock — so the whole offer is testable at the
 * boundaries where it actually goes wrong.
 *
 * Commercial numbers (`includedFilingsPerPeriod`, `trialDays`, top-up price)
 * live in `plus-pricing.json`, the SSOT, and are never restated here. The
 * reserve and cap below are product policy, not commercial figures.
 */

/**
 * Which set of constants the device resolves. Period-specific because the
 * allowance is not: a trial gets the same 150 filings over 14 days that the
 * paid plan gets over 30, so the headroom differs completely. BYOK has no
 * meter and no period — it takes the paid cap and no reserve.
 */
export type BackfillPeriod = "trial" | "paid" | "byok";

/** Worst plausible daily filing rate the reserve is sized against. */
export const DAILY_BURN = 5;

/** Ceiling on the period reserve — the reserve only ever shrinks below it. */
export const RESERVE_BASELINE: Record<BackfillPeriod, number> = {
  trial: 70,
  paid: 100,
  byok: 0,
};

/** Per-period ceiling on backfill spend — the retention bound, not the protection bound. */
export const BACKFILL_CAP: Record<BackfillPeriod, number> = {
  trial: 75,
  paid: 50,
  byok: 50,
};

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight for a `YYYY-MM-DD` prefix, or null when it is not one. */
function utcMidnight(date: string | undefined): number | null {
  const day = date?.slice(0, 10);
  if (!day || !DATE_RE.test(day)) return null;
  const [y = NaN, m = NaN, d = NaN] = day.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole days from `today` (local `YYYY-MM-DD`, e.g. `formatLocalDate(new Date())`)
 * to `periodEnd`, or null when the answer is unknown.
 *
 * Both operands are UTC midnights built from `YYYY-MM-DD` substrings: a day
 * *difference* cannot be computed lexically, and this is the DST-safe form —
 * never subtract raw ISO instants. `periodEnd.slice(0, 10)` is the same
 * substring Settings renders as `Renews <YYYY-MM-DD>`, so the two can never
 * disagree on screen.
 *
 * Unparseable, missing, or non-positive → null → **unknown**, which takes the
 * full baseline reserve. An expired period the refresh has not replaced and a
 * skewed device clock both land here, and uncertainty must reserve more.
 */
export function daysRemainingFrom(
  today: string,
  periodEnd: string | undefined,
): number | null {
  const end = utcMidnight(periodEnd);
  const now = utcMidnight(today);
  if (end === null || now === null) return null;
  const days = Math.floor((end - now) / MS_PER_DAY);
  return days > 0 ? days : null;
}

export interface BackfillBudgetInput {
  period: BackfillPeriod;
  /**
   * True only when the entitlement refresh succeeded and was accepted.
   * A failed or rejected refresh takes the baseline reserve.
   *
   * Deliberately not a `refreshedAt`: `requireClassifyAuth`'s `onRemaining`
   * rewrites the session on every classify call, carrying the OLD `periodEnd`
   * forward while stamping `refreshedAt` fresh — so `refreshedAt` measures
   * `remaining`'s freshness and never `periodEnd`'s.
   */
  fresh: boolean;
  /** Local `YYYY-MM-DD` (caller supplies it; this module never reads a clock). */
  today: string;
  /** ISO period end when known. Ignored for BYOK. */
  periodEnd?: string;
  /** Remaining filings in the period when last synced. Ignored for BYOK. */
  remaining?: number;
}

export interface BackfillBudget {
  period: BackfillPeriod;
  /** Filings held back for forward filing. */
  reserve: number;
  /** Filings backfill may spend this period. */
  budget: number;
  /** Whole days left in the period, or null when unknown. */
  daysRemaining: number | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * ```
 * reserve = fresh ? clamp(daysRemaining × DAILY_BURN, 0, RESERVE_BASELINE) : RESERVE_BASELINE
 * budget  = min(BACKFILL_CAP, max(0, remaining - reserve))
 * ```
 *
 * `clamp`, not `min` — the reserve needs a floor as well as a ceiling. With a
 * bare `min`, a `daysRemaining` of -3 gives a reserve of -15 and a budget of
 * `remaining + 15`: the offer would spend filings the user does not have.
 * (`daysRemainingFrom` already collapses that case to null, and the clamp is
 * the second guard that keeps it true for any caller.)
 *
 * BYOK: reserve 0, budget = cap outright — no meter, nothing to protect, but
 * the same cap so there is one card shape and one code path.
 */
export function resolveBackfillBudget(
  input: BackfillBudgetInput,
): BackfillBudget {
  const { period } = input;
  if (period === "byok") {
    return {
      period,
      reserve: 0,
      budget: BACKFILL_CAP.byok,
      daysRemaining: null,
    };
  }

  const baseline = RESERVE_BASELINE[period];
  const daysRemaining = daysRemainingFrom(input.today, input.periodEnd);
  const reserve =
    input.fresh && daysRemaining !== null
      ? clamp(daysRemaining * DAILY_BURN, 0, baseline)
      : baseline;
  const remaining = input.remaining ?? 0;
  const budget = Math.min(BACKFILL_CAP[period], Math.max(0, remaining - reserve));
  return { period, reserve, budget, daysRemaining };
}

/** One past daily in the backfill complement. */
export interface BackfillDaily {
  /** Local `YYYY-MM-DD` of the daily note. */
  date: string;
  path: string;
  /** Unmarked captures on that daily. */
  unprocessedCount: number;
}

export interface RecentFirstRangeInput {
  /**
   * The complement, in any order. `getPastDailyNotesWithUnmarkedCaptures`
   * returns `Object.values(getAllDailyNotes())` order with no sort, so
   * newest-first is an ordering this module imposes, never one it assumes.
   */
  dailies: BackfillDaily[];
  /** Filing-window start, `YYYY-MM-DD` exclusive — the complement is strictly before it. */
  before: string;
  /** Filings backfill may spend, from `resolveBackfillBudget`. */
  budget: number;
}

export interface RecentFirstRange {
  /**
   * Derived bounds, directly usable as `GetUnprocessedOpts`. Matching
   * `src/pipeline/daily.ts:52-59`: `since` is **inclusive** (`date < since`
   * skips) and `before` is **exclusive** (`date >= before` skips), so `since`
   * is the oldest included daily's own date.
   *
   * Undefined when nothing fits — pair it with `overBudget` to tell "nothing
   * to do" from "cannot afford the next daily".
   */
  since?: string;
  before: string;
  /** Captures inside the derived range. */
  captures: number;
  /** Dailies inside the derived range. */
  dailies: number;
  /** Captures across the whole complement, in range or not. */
  totalCaptures: number;
  /** The included dailies, newest-first. */
  notes: BackfillDaily[];
  /**
   * The complement has work but none of it fits the budget — a single daily
   * larger than the budget, or a budget of 0. Routes to the top-up branch;
   * it must never read as "nothing to do".
   */
  overBudget: boolean;
}

/**
 * Walk backwards from the window start, accumulating **whole dailies only**.
 * Stop before the daily that would exceed the budget, so the offer is never
 * over budget and `since` stays a clean date — a daily's captures are never
 * split across the bound.
 */
export function deriveRecentFirstRange(
  input: RecentFirstRangeInput,
): RecentFirstRange {
  const { before, budget } = input;
  const complement = input.dailies
    .filter((d) => d.date < before && d.unprocessedCount > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const totalCaptures = complement.reduce((n, d) => n + d.unprocessedCount, 0);

  const notes: BackfillDaily[] = [];
  let captures = 0;
  for (const d of complement) {
    if (captures + d.unprocessedCount > budget) break;
    notes.push(d);
    captures += d.unprocessedCount;
  }

  return {
    since: notes[notes.length - 1]?.date,
    before,
    captures,
    dailies: notes.length,
    totalCaptures,
    notes,
    overBudget: totalCaptures > 0 && captures === 0,
  };
}
