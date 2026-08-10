import type { App, EventRef } from "obsidian";
import { readEgressNoticeAcked } from "./resume";

/** Device-local keys — never data.json (KTD7 / R13). */
export const LS_AUTO_RUN_ENABLED = "atoms-auto-run-enabled";
export const LS_LAST_RUN_DAY = "atoms-last-run-day";
/** One-time egress ack required before first unattended send (plan privacy). */
export const LS_AUTO_RUN_EGRESS_ACK = "atoms-auto-run-egress-ack";
/** Day automatic filing was enabled on this device — the filing window start (KTD6). */
export const LS_AUTO_RUN_START_DAY = "atoms-auto-run-start-day";
/**
 * This device had automatic filing on before the window existed, and U4 stamped it (KTD5).
 *
 * Recorded because the migration deliberately pauses an in-progress silent sweep — the honest
 * default, since nobody consented to it — and a BRAT or Community auto-update never shows release
 * notes. Without this flag a paying user watches filing stop and concludes the plugin broke.
 */
export const LS_AUTO_RUN_WINDOW_MIGRATED = "atoms-auto-run-window-migrated";

/**
 * Which disclosure a stored egress ack was granted against (KTD4).
 *
 * The key used to hold a bare `true`, which recorded that someone consented but not to *what* —
 * so a device that accepted through the old home modal kept granting unattended sends while
 * Settings reported an acknowledgment for wording that user never saw (#315). Stamping the ack
 * makes staleness detectable: anything other than this exact string — an older stamp, or the
 * legacy boolean — reads as unacknowledged, and unattended filing stops until the user accepts
 * the current text once. Nothing raises that sheet on its own: the re-prompt is the next enable
 * the user performs, from home's filing card or the Settings toggle. Losing automatic filing
 * silently at the upgrade boundary is expected release behavior, and belongs in release notes.
 *
 * Staleness reaches this ack only. `readEgressPermitted` below also honors the catch-up notice,
 * which carries its own separate disclosure and its own un-stamped boolean.
 *
 * **Bump this whenever `EGRESS_DISCLOSURE` (src/settings/consent.ts) changes what it discloses.**
 * `egressConsentParity.test.ts` freezes the two together, so forgetting the bump fails there
 * rather than silently leaving every existing device holding consent to text nobody read.
 */
export const EGRESS_ACK_VERSION = "2026-08-06";

/** What fired a filing pass. Only `manual` is a run the user asked for in the moment. */
export type AutoRunSource = "onload" | "interval" | "manual" | "resume";

/** Cap sequential API calls per launch so a month away doesn't fire ~150 (H7). */
export const PER_LAUNCH_CAP = 15;

export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A real calendar day in `YYYY-MM-DD`, the only shape the window bound accepts.
 *
 * Strict on purpose: the stamp lives in localStorage, which any other plugin or a devtools
 * session can write (KTD6), and every comparison against it is a lexical string compare — so a
 * near-miss like `2026-8-1` would sort wrong rather than fail loudly. Calendar values are checked
 * too, since `2026-02-31` matches the shape and names no day.
 */
function isFilingDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (lengths[month - 1] ?? 0);
}

/** The stored filing-window start, or null when nothing usable is stored. */
export function readAutoFilingStartDay(
  load: (key: string) => unknown,
): string | null {
  const v = load(LS_AUTO_RUN_START_DAY);
  return isFilingDay(v) ? v : null;
}

/** Stamp the filing-window start. A day that is not a real date is never persisted. */
export function writeAutoFilingStartDay(
  save: (key: string, data: unknown) => void,
  day: string,
): void {
  if (!isFilingDay(day)) return;
  save(LS_AUTO_RUN_START_DAY, day);
}

/**
 * Move the filing-window start to `day` — forward only, and never backwards.
 *
 * Every enable path stamps through here rather than calling `writeAutoFilingStartDay` directly,
 * so the one invariant that keeps the window from widening lives in one place: a stamp only ever
 * moves later. Re-enabling always names today, which is later than any earlier stamp — but a
 * tampered or clock-skewed value that sorts later must not be dragged back, because a start day
 * that can move earlier is a full-history sweep waiting for the right two writes.
 */
export function stampAutoFilingWindowStart(
  load: (key: string) => unknown,
  save: (key: string, data: unknown) => void,
  day: string,
): void {
  const stored = readAutoFilingStartDay(load);
  if (stored !== null && stored >= day) return;
  writeAutoFilingStartDay(save, day);
}

/**
 * Turn automatic filing on or off, stamping the window start whenever it goes on (U3).
 *
 * Enable-and-stamp is one operation on purpose. Split across call sites it is a step a future
 * enable path forgets, and the read-side fallback in `resolveAutoFilingSince` only covers the
 * miss when a run happens to follow the enable — ordering that holds by accident.
 *
 * Turning it *off* preserves the previous stamp (KTD6): disabling is not consent to re-file
 * everything since the old start day, and the next enable stamps its own, later day anyway.
 */
export function setAutomaticFilingEnabled(
  load: (key: string) => unknown,
  save: (key: string, data: unknown) => void,
  on: boolean,
  today: string = localDateString(),
): void {
  writeAutoRunEnabled(save, on);
  if (on) stampAutoFilingWindowStart(load, save, today);
}

/**
 * Whether a run may reach today's daily — the enable tap, and nothing else (KTD1).
 *
 * A strict window files nothing on day one, since no unattended pass ever includes today: the
 * user accepts a disclosure and sees nothing until tomorrow. Day one comes from one attended run
 * fired by the user's own tap, which non-negotiable #3 permits as explicit user force. Every
 * unattended source is forced back to false here rather than merely never asking, so the rule
 * survives a future caller that threads its options through without reading this comment.
 */
export function includeTodayForRun(
  source: AutoRunSource,
  requested?: boolean,
): boolean {
  return source === "manual" && requested === true;
}

/**
 * Give a device that had automatic filing on before the window existed a start day, once (U4).
 *
 * Runs on load, ahead of the first pass, so the migration owns the first stamp rather than
 * `resolveAutoFilingSince`'s fallback happening to write the same day with nothing recording that
 * it did. Returns true only on the load that performs it; a disabled device gets neither the
 * stamp nor the flag, because it has not enabled anything to migrate.
 */
export function migrateAutoFilingWindow(
  load: (key: string) => unknown,
  save: (key: string, data: unknown) => void,
  today: string = localDateString(),
): boolean {
  if (!readDeviceAutoRunState(load).enabled) return false;
  if (readAutoFilingStartDay(load) !== null) return false;
  const day = isFilingDay(today) ? today : localDateString();
  stampAutoFilingWindowStart(load, save, day);
  save(LS_AUTO_RUN_WINDOW_MIGRATED, true);
  return true;
}

/** Whether U4 stamped this device's window — what U5's copy keys on (KTD5). */
export function readAutoFilingWindowMigrated(
  load: (key: string) => unknown,
): boolean {
  return load(LS_AUTO_RUN_WINDOW_MIGRATED) === true;
}

/**
 * The filing-window bound for an unattended pass — always a day, never "unbounded" (KTD2).
 *
 * Absent, malformed, or tampered stamps resolve to today. The tempting alternative — treat
 * "no stamp" as no bound — is the full-history sweep this window exists to end, and it would
 * reach any device that never enabled automatic filing yet still files through the manual
 * catch-up. Failing closed costs at most a day the user can recover through the priced
 * backfill offer; failing open costs their whole history, silently.
 *
 * **Only a device with automatic filing on ever *persists* that day.** The stamp means "the day
 * the user enabled automatic filing", and `maybeAutoRun("onload")` runs on every launch whether
 * or not filing is on — so persisting here unconditionally would redefine the window start as
 * "first launch of this build". A user who leaves filing off for two months and then taps
 * catch-up would get two months of unasked filing, widening the longer they wait. A disabled
 * device instead re-resolves to today on every launch: a bound that never ages. The enable flag
 * is read from storage on purpose, not from any per-run bypass — `catchUp.bypassEnabled` treats
 * a disabled device as enabled for one run, and tapping catch-up is not turning filing on.
 *
 * `today` is normalized for the same reason the stored value is: every bound is compared
 * lexically, so handing back an unusable one (`""` sorts before every daily) would reopen the
 * sweep from the one place that promises it cannot happen.
 */
export function resolveAutoFilingSince(
  load: (key: string) => unknown,
  save: (key: string, data: unknown) => void,
  today: string,
): string {
  const stored = readAutoFilingStartDay(load);
  if (stored) return stored;
  const day = isFilingDay(today) ? today : localDateString();
  if (readDeviceAutoRunState(load).enabled) writeAutoFilingStartDay(save, day);
  return day;
}

/**
 * Whether auto-run should attempt a write pass.
 * Same calendar day still runs when past unprocessed remain (cap drain / retry).
 * Does not stamp days — see shouldStampLastRunDay.
 */
export function shouldRunAutoProcess(opts: {
  enabled: boolean;
  lastRunDay: string | null;
  today: string;
  egressAcked: boolean;
  /** Past-only unmarked count (never includes today). Default 0. */
  pastUnprocessedRemaining?: number;
}): boolean {
  if (!opts.enabled) return false;
  if (!opts.egressAcked) return false;
  const remaining = opts.pastUnprocessedRemaining ?? 0;
  if (!opts.lastRunDay) return true;
  if (opts.lastRunDay < opts.today) return true;
  // Same day: continue only while past work remains (markers keep re-entry safe).
  if (opts.lastRunDay === opts.today && remaining > 0) return true;
  return false;
}

/**
 * Stamp last-run day only after a non-throwing run leaves zero past work.
 * Failures / remaining queue must not burn the calendar day.
 */
export function shouldStampLastRunDay(opts: {
  threw: boolean;
  pastRemainingAfter: number;
}): boolean {
  if (opts.threw) return false;
  return opts.pastRemainingAfter === 0;
}

/** A gate verdict: the paid pass proceeds, or it does not and says why. */
export type AutoFilingGate = { ok: true } | { ok: false; reason: string };

export interface AutoFilingCycleDeps {
  load: (key: string) => unknown;
  save: (key: string, data: unknown) => void;
  /** Local calendar day, `YYYY-MM-DD`. */
  today: string;
  /**
   * Unmarked captures inside the window. `fallback` is what to report when listing fails —
   * it is the *recount*'s only defense, so a failed listing cannot fake a drained window.
   */
  count: (since: string, fallback?: number) => Promise<number>;
  /** Everything the caller must check once the window count is known (enabled, ack, auth, in-flight). */
  gate: (pastRemaining: number) => AutoFilingGate | Promise<AutoFilingGate>;
  /** File inside the window — same bound the count used. Returns markers appended. */
  file: (since: string) => Promise<{ markersAppended: number }>;
  /**
   * Claim the in-flight slot, synchronously. Return `false` to refuse because another pass
   * already holds it; anything else claims it.
   *
   * The claim must be one uninterrupted check-and-set: the cycle calls this *before* its first
   * `await`, because `maybeAutoRun` is fired from onload, an hourly interval, the manual path,
   * and commands, and two callers that both observe "free" across an await boundary both pay
   * for a write pass. `endWork` releases it and runs on every exit after a successful claim.
   */
  beginWork?: () => boolean | void;
  endWork?: () => void;
  /** Notices / home refresh, after stamping. Throwing here is treated as a failed pass. */
  onFiled?: (filed: number) => void | Promise<void>;
  onError?: (e: unknown) => void;
}

export interface AutoFilingCycleResult {
  ran: boolean;
  reason: string;
  /** The one bound this pass resolved — both the count and the write saw exactly this. */
  since: string;
  filed: number;
  stamped: boolean;
  /** Window captures still unmarked after the pass — 0 is what stamps the day. */
  pastRemainingAfter: number;
}

/**
 * One unattended filing pass: resolve the bound → count → gate → file → recount → stamp.
 *
 * Extracted from `maybeAutoRun` so the coupling KTD2 names is testable. The count and the
 * write must agree on one bound: if the count scans wider than the write files, the recount
 * never reaches zero, `shouldStampLastRunDay` never stamps the calendar day, and auto-run
 * rescans the whole vault every hour forever. It is silent — the cost is vault reads, not
 * API spend. Resolving `since` *here*, and handing that same string to both callbacks, makes
 * the drift unrepresentable rather than merely tested for.
 *
 * `resolveAutoFilingSince` never returns "unbounded", so no pass can reach history.
 */
export async function runAutoFilingCycle(
  deps: AutoFilingCycleDeps,
): Promise<AutoFilingCycleResult> {
  const since = resolveAutoFilingSince(deps.load, deps.save, deps.today);

  // Claim before the first await, and hold it for the whole cycle. Everything below can yield,
  // so any check that lived past this point would be a check another caller could slip through.
  if (deps.beginWork?.() === false) {
    return {
      ran: false,
      reason: "in_flight",
      since,
      filed: 0,
      stamped: false,
      pastRemainingAfter: 0,
    };
  }

  let pastRemaining = 0;
  let filed = 0;
  let stamped = false;
  try {
    pastRemaining = await deps.count(since);

    const gate = await deps.gate(pastRemaining);
    if (!gate.ok) {
      return {
        ran: false,
        reason: gate.reason,
        since,
        filed: 0,
        stamped: false,
        pastRemainingAfter: pastRemaining,
      };
    }

    // Nothing in the window — stamp so the hourly interval stops re-scanning.
    if (pastRemaining === 0) {
      writeLastRunDay(deps.save, deps.today);
      stamped = true;
      return {
        ran: true,
        reason: "empty",
        since,
        filed: 0,
        stamped: true,
        pastRemainingAfter: 0,
      };
    }

    const { markersAppended } = await deps.file(since);
    filed = markersAppended;
    const pastAfter = await deps.count(
      since,
      Math.max(0, pastRemaining - markersAppended),
    );
    stamped = shouldStampLastRunDay({
      threw: false,
      pastRemainingAfter: pastAfter,
    });
    if (stamped) writeLastRunDay(deps.save, deps.today);
    await deps.onFiled?.(markersAppended);
    return {
      ran: true,
      reason: "ok",
      since,
      filed,
      stamped,
      pastRemainingAfter: pastAfter,
    };
  } catch (e) {
    // Never stamp *because of* a throw — but do not deny a stamp that already happened. The
    // day is written before `onFiled` runs its Notices and home refresh, so a throw from there
    // lands here with captures genuinely filed and the day genuinely burned. Reporting 0/false
    // would tell the caller (and its tests) the opposite of what is on disk.
    deps.onError?.(e);
    return {
      ran: false,
      reason: "error",
      since,
      filed,
      stamped,
      pastRemainingAfter: pastRemaining,
    };
  } finally {
    deps.endWork?.();
  }
}

export interface DeviceAutoRunState {
  enabled: boolean;
  lastRunDay: string | null;
  egressAcked: boolean;
  /** Filing-window start (KTD6); null until an enable path stamps it. */
  startDay: string | null;
}

export function readDeviceAutoRunState(
  load: (key: string) => unknown,
): DeviceAutoRunState {
  const enabled = load(LS_AUTO_RUN_ENABLED) === true;
  const last = load(LS_LAST_RUN_DAY);
  const lastRunDay = typeof last === "string" && last ? last : null;
  const egressAcked = egressAckIsCurrent(readEgressAckVersion(load));
  const startDay = readAutoFilingStartDay(load);
  return { enabled, lastRunDay, egressAcked, startDay };
}

/**
 * The disclosure version a stored ack names, or null when nothing usable is stored.
 *
 * A legacy `true` is deliberately null rather than "some old version": it names no wording at
 * all, which is the condition KTD4 exists to clear.
 */
export function readEgressAckVersion(
  load: (key: string) => unknown,
): string | null {
  const v = load(LS_AUTO_RUN_EGRESS_ACK);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Acked against the disclosure this build actually shows. Anything else is not consent. */
export function egressAckIsCurrent(
  acked: string | null | undefined,
  shipped: string = EGRESS_ACK_VERSION,
): boolean {
  if (acked == null || acked === "") return false;
  return acked === shipped;
}

export function writeAutoRunEnabled(
  save: (key: string, data: unknown) => void,
  enabled: boolean,
): void {
  save(LS_AUTO_RUN_ENABLED, enabled);
}

export function writeLastRunDay(
  save: (key: string, data: unknown) => void,
  day: string,
): void {
  save(LS_LAST_RUN_DAY, day);
}

/**
 * Record — or clear — the egress ack.
 *
 * Accepting stores the disclosure version, not `true`, so the record says what was agreed to.
 * Withdrawing keeps passing `false`: the cleared shape is unchanged. Obsidian's own
 * `saveLocalStorage` drops the entry for any falsy value, so what lands on disk is an absent
 * key — which reads as unacknowledged through the same path a stale stamp does.
 */
export function writeEgressAck(
  save: (key: string, data: unknown) => void,
  acked: boolean,
  version: string = EGRESS_ACK_VERSION,
): void {
  save(LS_AUTO_RUN_EGRESS_ACK, acked ? version : false);
}

/**
 * Every device-local way the paid, unattended path can be permitted, in one place.
 *
 * Two booleans grant it — the auto-run egress ack, and the catch-up notice a manual run may
 * lean on — and a withdrawal surface that knows about only one of them leaves the other still
 * granting what the user just took back. Composed here so the gate and the withdrawal read the
 * same list.
 */
export function readEgressPermitted(
  load: (key: string) => unknown,
  opts: { catchUp: boolean },
): boolean {
  if (readDeviceAutoRunState(load).egressAcked) return true;
  return opts.catchUp && readEgressNoticeAcked(load);
}

/**
 * One-tap home enable: privacy ack + auto-run on + window start (device-local only).
 *
 * `load` trails `save` rather than leading it, against this file's usual order, because the
 * accepted shape is frozen by `egressConsentParity.test.ts` — the disclosure the home sheet
 * shows is verified against the store this call lands in. Omitting it stamps today outright,
 * which is right for a fresh enable and only loses the forward-only comparison.
 */
export function enableAutomaticFiling(
  save: (key: string, data: unknown) => void,
  load: (key: string) => unknown = () => null,
  today: string = localDateString(),
): void {
  writeEgressAck(save, true);
  setAutomaticFilingEnabled(load, save, true, today);
}

/**
 * Gate buildContext behind layout + metadataCache settle (U9 cold-start).
 * Never call buildContext before this resolves.
 */
export function waitForVaultIndexReady(app: App): Promise<void> {
  return new Promise((resolve) => {
    const finish = (() => {
      let done = false;
      return () => {
        if (done) return;
        done = true;
        resolve();
      };
    })();

    const afterLayout = () => {
      // Prefer official "resolved" signal when it fires.
      let ref: EventRef | null = null;
      try {
        ref = app.metadataCache.on("resolved", () => {
          if (ref) app.metadataCache.offref(ref);
          finish();
        });
      } catch {
        finish();
        return;
      }

      // If the cache is already warm, "resolved" may not fire again.
      // Settle quickly so we don't block forever, but give the indexer a beat.
      const warm =
        typeof (app.metadataCache as { initialized?: boolean }).initialized ===
        "boolean"
          ? (app.metadataCache as { initialized?: boolean }).initialized
          : app.vault.getMarkdownFiles().length > 0;

      window.setTimeout(
        () => {
          if (ref) {
            try {
              app.metadataCache.offref(ref);
            } catch {
              /* ignore */
            }
          }
          finish();
        },
        warm ? 150 : 800,
      );
    };

    try {
      app.workspace.onLayoutReady(afterLayout);
    } catch {
      afterLayout();
    }
  });
}

/** Pure: whether buildContext is allowed (cache considered ready). */
export function canBuildContext(cacheReady: boolean): boolean {
  return cacheReady === true;
}
