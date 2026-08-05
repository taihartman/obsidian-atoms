import { AtomsSettingTab } from "../../src/settings/settings";
// `../mocks/obsidian` rather than `"obsidian"`: vitest aliases the module, `tsc` does not.
import { Modal } from "../mocks/obsidian";
import {
  LS_PLUS_SESSION,
  serializePlusSession,
  type FilingAuth,
  type PlusSession,
} from "../../src/platform/filingAuth";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../../src/shared/types";

export interface SettingTabOptions {
  /** What `plugin.resolveFilingAuth()` reports. Defaults to no credentials at all. */
  auth?: FilingAuth;
  /** Device-local Plus session the tab reads back through `readPlusSession`. */
  session?: PlusSession | null;
  /** Overrides merged over `DEFAULT_SETTINGS` for the plugin double. */
  settings?: Partial<LinkerSettings>;
  /** Tags the vault already uses, one file each, for the "found in your vault" ranking. */
  vaultTags?: string[];
  /** Device-local keys the tab should find already written (auto-run state, egress ack). */
  local?: Record<string, unknown>;
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
  /** Device-local storage the tab reads and writes, for asserting on ack keys. */
  local: Map<string, unknown>;
} {
  // A sheet left open by an earlier test would still be in `Modal.open` and in the document.
  for (const stale of [...Modal.open]) stale.close();
  const local = new Map<string, unknown>();
  if (opts.session) local.set(LS_PLUS_SESSION, serializePlusSession(opts.session));
  for (const [key, value] of Object.entries(opts.local ?? {})) local.set(key, value);
  // One markdown file per requested tag: the ranking only reads counts, so a file apiece is the
  // smallest vault that still exercises it.
  const files = (opts.vaultTags ?? []).map((tag, i) => ({ path: `tagged-${i}.md`, tag }));
  const caches = new Map(files.map((f) => [f.path, { tags: [{ tag: f.tag }] }]));
  const app = {
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      local.set(key, value);
    },
    vault: {
      getMarkdownFiles: () => files,
      adapter: {},
      getAbstractFileByPath: () => null,
    },
    metadataCache: {
      getFileCache: (f: { path: string }) => caches.get(f.path) ?? null,
      resolvedLinks: {},
    },
    workspace: { getActiveFile: () => null },
  };
  const known: Record<string, unknown> = {
    app,
    manifest: { version: "9.9.9" },
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    resolveFilingAuth: () => opts.auth ?? { mode: "none" },
    // The Proxy's no-op fallback returns `undefined`, and these two are handed to
    // `fireAndForgetAsk`, which calls `.catch` on what it is given.
    syncAskMirror: () => Promise.resolve({ ok: false, message: "test double" }),
    applyAskOutbox: () => Promise.resolve(),
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
  return { tab, scroller, local };
}

/** The one sheet currently up. Throws rather than letting an assertion pass against nothing. */
export function sheet(): Modal {
  if (Modal.open.length !== 1) {
    throw new Error(`expected exactly one open sheet, found ${Modal.open.length}`);
  }
  return Modal.open[0]!;
}

/** Whether any sheet is up — the decline assertions are about a sheet that is not. */
export function sheetOpen(): boolean {
  return Modal.open.length > 0;
}

/** Everything the open sheet says, title included, as a reader sees it. */
export function sheetText(): string {
  const open = sheet();
  return `${open.titleEl.textContent ?? ""} ${open.contentEl.textContent ?? ""}`;
}

/** Press the sheet's button carrying this label. */
export function pressSheet(label: string): void {
  const button = Array.from(sheet().contentEl.querySelectorAll("button")).find(
    (el) => el.textContent === label,
  );
  if (!button) throw new Error(`open sheet has no button labelled ${label}`);
  button.click();
}

/**
 * Escape, a click outside, and the settings tab closing all reach Obsidian as `Modal.close()`,
 * so one helper stands for all three dismissal paths.
 */
export function dismissSheet(): void {
  sheet().close();
}

/** Every rendered row name on whatever screen is currently up, in document order. */
export function rowNames(tab: AtomsSettingTab): string[] {
  return Array.from(tab.containerEl.querySelectorAll(".setting-item-name")).map(
    (el) => el.textContent ?? "",
  );
}

/** The one rendered row carrying this name. Throws rather than silently acting on nothing. */
export function row(tab: AtomsSettingTab, name: string): HTMLElement {
  const found = Array.from(tab.containerEl.querySelectorAll(".setting-item")).filter(
    (el) => el.querySelector(".setting-item-name")?.textContent === name,
  );
  if (found.length !== 1 || !(found[0] instanceof HTMLElement)) {
    throw new Error(`expected one row named ${name}, found ${found.length}`);
  }
  return found[0];
}

/** Press the button on the named row, the way a user reaches it: through the rendered row. */
export function press(tab: AtomsSettingTab, name: string, label: string): void {
  const button = Array.from(row(tab, name).querySelectorAll("button")).find(
    (el) => el.textContent === label,
  );
  if (!button) throw new Error(`row ${name} has no button labelled ${label}`);
  button.click();
}

/** Type into the named row's field, firing the change handler as a real keystroke would. */
export function fill(tab: AtomsSettingTab, name: string, value: string): void {
  const input = row(tab, name).querySelector("input");
  if (!input) throw new Error(`row ${name} has no input`);
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

/** Flip the named row's switch. */
export function flip(tab: AtomsSettingTab, name: string): void {
  const toggle = row(tab, name).querySelector(".checkbox-container");
  if (!(toggle instanceof HTMLElement)) throw new Error(`row ${name} has no toggle`);
  toggle.click();
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
