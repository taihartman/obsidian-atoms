/**
 * Poll Plus entitlement after Stripe Checkout (awaitingCheckout flag).
 */
import { Notice } from "obsidian";
import type { App } from "obsidian";
import {
  clearAwaitingCheckout,
  isAwaitingCheckout,
  readPlusSession,
  type LocalStorageLike,
} from "./filingAuth";
import { DEFAULT_PLUS_BASE_URL, type PlusClientConfig } from "./plusClient";
import { plusFetchRequest } from "./plusClient";
import { refreshPlusEntitlementRecord } from "./plusRefresh";

export type PlusResumeHost = {
  app: App & LocalStorageLike;
  settings: { plusBaseUrl: string };
  registerInterval: (id: number) => number;
};

const MAX_POLLS = 8;
const INTERVAL_MS = 5000;

/**
 * If awaiting checkout, refresh /v1/me. Clears flag when entitled.
 * @returns true if entitlement became active/trialing/exhausted
 */
export async function refreshPlusSessionQuiet(
  host: PlusResumeHost,
): Promise<boolean> {
  if (!isAwaitingCheckout(host.app)) return false;
  const session = readPlusSession(host.app);
  if (!session) {
    clearAwaitingCheckout(host.app);
    return false;
  }
  const base = host.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
  const cfg: PlusClientConfig = { baseUrl: base, request: plusFetchRequest };
  // Shared refresh: a failed or partial answer records the outcome for Settings
  // and leaves the stored session alone.
  const record = await refreshPlusEntitlementRecord(host.app, cfg, session);
  if (record.kind !== "ok") return false;
  const status = readPlusSession(host.app)?.status;
  if (
    status === "active" ||
    status === "trialing" ||
    status === "exhausted"
  ) {
    clearAwaitingCheckout(host.app);
    new Notice("Atoms Plus is ready", 6000);
    return true;
  }
  return false;
}

/** Wire onload + interval while awaitingCheckout. */
export function schedulePlusCheckoutResume(host: PlusResumeHost): void {
  let polls = 0;

  const tick = () => {
    void refreshPlusSessionQuiet(host).then((done) => {
      if (done) polls = MAX_POLLS;
    });
    polls += 1;
    if (polls >= MAX_POLLS) {
      // leave flag for next focus; user can Refresh
    }
  };

  const onVisible = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!isAwaitingCheckout(host.app)) return;
    polls = 0;
    void refreshPlusSessionQuiet(host);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onVisible);
  }

  if (isAwaitingCheckout(host.app)) {
    void refreshPlusSessionQuiet(host);
  }
  host.registerInterval(
    window.setInterval(() => {
      if (!isAwaitingCheckout(host.app)) {
        polls = 0;
        return;
      }
      if (polls >= MAX_POLLS) return;
      tick();
    }, INTERVAL_MS),
  );
}
