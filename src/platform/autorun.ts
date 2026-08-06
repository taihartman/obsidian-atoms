import type { App, EventRef } from "obsidian";
import { readEgressNoticeAcked } from "./resume";

/** Device-local keys — never data.json (KTD7 / R13). */
export const LS_AUTO_RUN_ENABLED = "atoms-auto-run-enabled";
export const LS_LAST_RUN_DAY = "atoms-last-run-day";
/** One-time egress ack required before first unattended send (plan privacy). */
export const LS_AUTO_RUN_EGRESS_ACK = "atoms-auto-run-egress-ack";

/**
 * Which disclosure a stored egress ack was granted against (KTD4).
 *
 * The key used to hold a bare `true`, which recorded that someone consented but not to *what* —
 * so a device that accepted through the old home modal kept granting unattended sends while
 * Settings reported an acknowledgment for wording that user never saw (#315). Stamping the ack
 * makes staleness detectable: anything other than this exact string — an older stamp, or the
 * legacy boolean — reads as unacknowledged, and the next automatic-filing attempt re-prompts once
 * against the current text. The one-time re-prompt is expected release behavior.
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
}

export function readDeviceAutoRunState(
  load: (key: string) => unknown,
): DeviceAutoRunState {
  const enabled = load(LS_AUTO_RUN_ENABLED) === true;
  const last = load(LS_LAST_RUN_DAY);
  const lastRunDay = typeof last === "string" && last ? last : null;
  const egressAcked = egressAckIsCurrent(readEgressAckVersion(load));
  return { enabled, lastRunDay, egressAcked };
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
 * Withdrawing keeps writing `false`: the cleared shape is unchanged, and it reads as
 * unacknowledged through the same path a stale stamp does.
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
