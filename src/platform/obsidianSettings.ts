/**
 * Deep link into a settings tab — Obsidian's own core panes, and the Atoms tab itself.
 *
 * Lives in `platform/` because it is a description of Obsidian's surface rather than product
 * logic, and because both consumers are screens: Atoms home walks the user into `atoms` and into
 * core plugins, and the settings screen's first-day step walks them into core plugins too. One
 * owner rather than one per screen — the interface below is a guess about somebody else's private
 * API, and two guesses drift apart in silence.
 */

import type { App } from "obsidian";

/**
 * Undocumented core settings modal — used by many plugins to deep-link.
 * Not on the public App type; keep a narrow local interface (no `any`).
 */
type SettingsModalApi = {
  open: () => void | Promise<void>;
  close: () => void;
  openTabById: (id: string) => void;
};

export function openSettingsTab(app: App, tabId: string): void {
  const setting = (app as { setting?: SettingsModalApi }).setting;
  if (!setting) return;
  // Settled on both arms, the same rule `runRowAction` follows: this runs from a click handler
  // that keeps no reference to the promise, so a modal that refuses to open must leave nothing
  // to deep-link into *and* nothing escaping as an unhandled rejection.
  void Promise.resolve(setting.open())
    .then(() => {
      setting.openTabById(tabId);
    })
    .catch(() => {
      /* no modal opened — there is no tab to land on, and nothing to report */
    });
}

/**
 * Get the settings modal out of the way, for a row whose target is the workspace behind it.
 *
 * The settings screen is not the product, so a row that opens a view has to leave: activating
 * Atoms home under an open modal looks like the row did nothing. Same narrow local interface as
 * the deep link above, and the same tolerance for a modal that is not there.
 */
export function closeSettings(app: App): void {
  (app as { setting?: SettingsModalApi }).setting?.close();
}
