import type { App, EventRef } from "obsidian";

/** Device-local keys — never data.json (KTD7 / R13). */
export const LS_AUTO_RUN_ENABLED = "atoms-auto-run-enabled";
export const LS_LAST_RUN_DAY = "atoms-last-run-day";
/** One-time egress ack required before first unattended send (plan privacy). */
export const LS_AUTO_RUN_EGRESS_ACK = "atoms-auto-run-egress-ack";

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
  const egressAcked = load(LS_AUTO_RUN_EGRESS_ACK) === true;
  return { enabled, lastRunDay, egressAcked };
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

export function writeEgressAck(
  save: (key: string, data: unknown) => void,
  acked: boolean,
): void {
  save(LS_AUTO_RUN_EGRESS_ACK, acked);
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
