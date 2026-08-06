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
