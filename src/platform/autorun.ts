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
 * The filing-window bound for an unattended pass — always a day, never "unbounded" (KTD2).
 *
 * Absent, malformed, or tampered stamps are re-stamped with today and today is returned. The
 * tempting alternative — treat "no stamp" as no bound — is the full-history sweep this window
 * exists to end, and it would reach any device that never enabled automatic filing yet still
 * files through the manual catch-up. Failing closed costs at most a day the user can recover
 * through the priced backfill offer; failing open costs their whole history, silently.
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
  writeAutoFilingStartDay(save, day);
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
 * One-tap home enable: privacy ack + auto-run on (device-local only).
 */
export function enableAutomaticFiling(
  save: (key: string, data: unknown) => void,
): void {
  writeEgressAck(save, true);
  writeAutoRunEnabled(save, true);
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
