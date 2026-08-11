import { AtomsHomeView } from "../../src/home/atomsHomeView";

/**
 * Raise Atoms home's "turn on automatic filing" consent, the way a tap on the filing card does.
 *
 * Driven off the prototype with a two-field stub rather than a standing `AtomsHomeView`. That is
 * deliberate: `confirmEnableAutomaticFiling` reads `this.app` and `this.plugin` and nothing else,
 * and the alternative is a full `ItemView` + `AtomsPlugin` harness for a claim about four lines.
 *
 * `onEnable` stands in for `enableAutomaticFilingFromHome` — the device-local ack write. Callers
 * decide what to observe through it: a marker that the accept fired, or the real writes.
 */
export function raiseHomeConsent(onEnable: () => void): void {
  const view = Object.create(AtomsHomeView.prototype) as {
    app: unknown;
    plugin: unknown;
    confirmEnableAutomaticFiling(): void;
  };
  view.app = {};
  view.plugin = {
    enableAutomaticFilingFromHome: async () => {
      onEnable();
    },
  };
  view.confirmEnableAutomaticFiling();
}

/**
 * Drive Atoms home's backfill offer card off the prototype, the way `raiseHomeConsent` above
 * drives the filing consent: the card's four methods read `this.app`, `this.plugin` and
 * `this.backfillDailies` and nothing else, and a full `ItemView` + `AtomsPlugin` harness would be
 * a lot of scaffolding for claims about what the card shows and what it writes.
 *
 * `store` is the device-local key/value space. `writes` records every key the card saves to, so a
 * test can assert that merely rendering wrote nothing.
 */
export interface BackfillHomeHarness {
  store: Record<string, unknown>;
  writes: string[];
  runs: number;
  model(): { title: string; body: string; meter: string; primary: string; dismiss: string } | null;
  press(): void;
  dismiss(): void;
}

export function backfillHome(opts: {
  auth: unknown;
  dailies?: Array<{ date: string; path: string; unprocessedCount: number }>;
  store?: Record<string, unknown>;
}): BackfillHomeHarness {
  const store: Record<string, unknown> = { ...(opts.store ?? {}) };
  const writes: string[] = [];
  const harness = { store, writes, runs: 0 } as BackfillHomeHarness;
  const view = Object.create(AtomsHomeView.prototype) as Record<string, unknown>;
  view.app = {
    loadLocalStorage: (k: string) => store[k] ?? null,
    saveLocalStorage: (k: string, v: unknown) => {
      writes.push(k);
      // Obsidian drops falsy values, and the ack's cleared shape depends on that.
      if (v) store[k] = v;
      else delete store[k];
    },
  };
  view.plugin = {
    resolveFilingAuth: () => opts.auth,
    runBackfillFromHome: async () => {
      harness.runs += 1;
    },
  };
  view.backfillDailies = opts.dailies ?? [];
  view.busy = false;
  view.render = () => {};

  const call = <T>(name: string): T =>
    (view[name] as () => T).call(view);
  harness.model = () => call("backfillOfferModel");
  harness.press = () => call("startBackfillFromCard");
  harness.dismiss = () => call("dismissBackfillOffer");
  return harness;
}
