/**
 * Poll Plus entitlement after Stripe Checkout (awaitingCheckout flag).
 */
import { Notice } from "obsidian";
import type { App } from "obsidian";
import {
  clearAwaitingCheckout,
  isAwaitingCheckout,
  readPlusSession,
  writePlusSession,
  type LocalStorageLike,
} from "./filingAuth";
import {
  DEFAULT_PLUS_BASE_URL,
  getEntitlement,
  type PlusClientConfig,
} from "./plusClient";
import { plusFetchRequest } from "./plusClient";

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
  const r = await getEntitlement(cfg, session.sessionToken);
  if (!r.ok) return false;
  const e = r.entitlement;
  writePlusSession(host.app, {
    ...session,
    email: e.email || session.email,
    status: e.status,
    remaining: e.remaining,
    periodEnd: e.periodEnd,
    refreshedAt: Date.now(),
  });
  if (
    e.status === "active" ||
    e.status === "trialing" ||
    e.status === "exhausted"
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
