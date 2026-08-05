import { AtomsSettingTab } from "../../src/settings/settings";
import {
  LS_PLUS_SESSION,
  serializePlusSession,
  type FilingAuth,
  type PlusSession,
} from "../../src/platform/filingAuth";
import { DEFAULT_SETTINGS } from "../../src/shared/types";

export interface SettingTabOptions {
  /** What `plugin.resolveFilingAuth()` reports. Defaults to no credentials at all. */
  auth?: FilingAuth;
  /** Device-local Plus session the tab reads back through `readPlusSession`. */
  session?: PlusSession | null;
}

/**
 * A settings tab wired to a plugin double. The double is a Proxy answering every unknown member
 * with a no-op function rather than being enumerated: `display()` walks every section, so a
 * literal double would have to grow a member for each new call in `settings.ts` and would fail as
 * a missing-method crash — noise that says nothing about the rows under test.
 */
export function settingTab(opts: SettingTabOptions = {}): {
  tab: AtomsSettingTab;
  scroller: HTMLElement;
} {
  const local = new Map<string, unknown>();
  if (opts.session) local.set(LS_PLUS_SESSION, serializePlusSession(opts.session));
  const app = {
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      local.set(key, value);
    },
    vault: { getMarkdownFiles: () => [], adapter: {}, getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    workspace: { getActiveFile: () => null },
  };
  const known: Record<string, unknown> = {
    app,
    manifest: { version: "9.9.9" },
    settings: { ...DEFAULT_SETTINGS },
    resolveFilingAuth: () => opts.auth ?? { mode: "none" },
  };
  const plugin = new Proxy(known, {
    get: (target, prop: string) => (prop in target ? target[prop] : () => undefined),
    has: () => true,
  });

  const tab = new AtomsSettingTab(app as never, plugin as never);
  // `settingsScrollEl()` falls back to `containerEl.parentElement`, so the tab needs one for
  // the scroll assertions to be about the tab rather than about a null scroller.
  const scroller = document.createElement("div");
  scroller.appendChild(tab.containerEl);
  return { tab, scroller };
}

/** Every rendered row name on whatever screen is currently up, in document order. */
export function rowNames(tab: AtomsSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll(".setting-item-name")).map(
    (el) => el.textContent ?? "",
  );
}

/** Rows the user can walk into, by name, on whatever screen is currently rendered. */
export function destinationNames(tab: AtomsSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll(".atoms-setting-destination")).map(
    (el) => el.querySelector(".setting-item-name")?.textContent ?? "",
  );
}

/** Walk into the destination whose entry row carries this name. */
export function open(tab: AtomsSettingTab, name: string): void {
  const entry = Array.from(tab.containerEl.querySelectorAll(".atoms-setting-destination")).find(
    (el) => el.querySelector(".setting-item-name")?.textContent === name,
  );
  if (!(entry instanceof HTMLElement)) throw new Error(`no destination row named ${name}`);
  entry.click();
}
