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
 * Last-run gate: run only when enabled and last successful/attempted calendar
 * day is strictly before today (same day → skip).
 */
export function shouldRunAutoProcess(opts: {
  enabled: boolean;
  lastRunDay: string | null;
  today: string;
  egressAcked: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (!opts.egressAcked) return false;
  if (!opts.lastRunDay) return true;
  return opts.lastRunDay < opts.today;
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
