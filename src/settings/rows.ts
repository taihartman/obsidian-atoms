import {
  type ButtonComponent,
  type DropdownComponent,
  Setting,
  type TextComponent,
  type ToggleComponent,
} from "obsidian";

/**
 * Row grammar for the Atoms settings tab: five row kinds, five right edges.
 *
 * | Kind          | Right edge                    |
 * |---------------|-------------------------------|
 * | `settingRow`  | toggle or input               |
 * | `destinationRow` | chevron                    |
 * | `actionRow`   | accent-text button            |
 * | `destructiveRow` | destructive/warning button |
 * | `statusRow`   | muted trailing text, no control |
 *
 * No row may carry two grammars, so every builder applies exactly one affordance and returns
 * `void` — `Setting` is chainable, and handing the row back would let a caller bolt a second
 * affordance on after the fact. Same shape and same `void` return as `settingHeading()`.
 */

/** Name + optional description shared by every row kind that has a description. */
interface RowInfo {
  name: string | DocumentFragment;
  desc?: string | DocumentFragment;
}

/**
 * The single control a `settingRow` may carry. A discriminated union rather than three optional
 * callbacks, so "exactly one" is a type error to violate rather than a convention to remember.
 */
export type SettingControl =
  | { kind: "toggle"; configure: (toggle: ToggleComponent) => void }
  | { kind: "text"; configure: (text: TextComponent) => void }
  | { kind: "dropdown"; configure: (dropdown: DropdownComponent) => void };

/**
 * `setDestructive()` only exists from Obsidian 1.13, but the manifest supports 1.11.4. Calling
 * it on an older installer threw mid-render and killed the whole Atoms settings tab for anyone
 * with a stored Plus session — every control below "Wipe cloud copy" simply vanished. Prefer it
 * where present, fall back to the deprecated-but-still-shipping warning style otherwise.
 */
export function markDestructive(btn: ButtonComponent): ButtonComponent {
  // Bracket access so static community lint does not treat setDestructive
  // (1.13+) as an unconditional API use against minAppVersion 1.11.4.
  const maybe = btn as ButtonComponent & Record<string, unknown>;
  const fn = maybe["setDestructive"];
  if (typeof fn === "function") {
    return (fn as () => ButtonComponent).call(btn);
  }
  return btn.setWarning();
}

function baseRow(containerEl: HTMLElement, info: RowInfo): Setting {
  const setting = new Setting(containerEl).setName(info.name);
  if (info.desc !== undefined) setting.setDesc(info.desc);
  return setting;
}

/** A preference the user sets: the only kind that may wear a toggle or an input. */
export function settingRow(
  containerEl: HTMLElement,
  row: RowInfo & { control: SettingControl },
): void {
  const setting = baseRow(containerEl, row);
  switch (row.control.kind) {
    case "toggle":
      setting.addToggle(row.control.configure);
      return;
    case "text":
      setting.addText(row.control.configure);
      return;
    case "dropdown":
      setting.addDropdown(row.control.configure);
      return;
  }
}

/** A way into somewhere else: chevron right edge, whole row clickable, never a toggle. */
export function destinationRow(
  containerEl: HTMLElement,
  row: RowInfo & { onOpen: () => void },
): void {
  const setting = baseRow(containerEl, row);
  setting.addExtraButton((chevron) => chevron.setIcon("chevron-right"));
  setting.settingEl.addClass("atoms-setting-destination");
  setting.settingEl.addClass("mod-clickable");
  // The listener lives on the row, not the chevron: a chevron click bubbles here, so the
  // destination opens exactly once wherever the user aims.
  setting.settingEl.addEventListener("click", () => row.onOpen());
}

/** Something that happens now: one accent-text button, never a toggle. */
export function actionRow(
  containerEl: HTMLElement,
  row: RowInfo & { label: string; onClick: () => void; disabled?: boolean; tooltip?: string },
): void {
  baseRow(containerEl, row).addButton((btn) => {
    btn.setButtonText(row.label).setCta().onClick(row.onClick);
    if (row.tooltip !== undefined) btn.setTooltip(row.tooltip);
    if (row.disabled) btn.setDisabled(true);
  });
}

/** Something that destroys data: one destructive button, never accent, never a toggle. */
export function destructiveRow(
  containerEl: HTMLElement,
  row: RowInfo & { label: string; onClick: () => void; disabled?: boolean; tooltip?: string },
): void {
  baseRow(containerEl, row).addButton((btn) => {
    markDestructive(btn.setButtonText(row.label)).onClick(row.onClick);
    if (row.tooltip !== undefined) btn.setTooltip(row.tooltip);
    if (row.disabled) btn.setDisabled(true);
  });
}

/** Read-only state: muted trailing text, no control, and no description paragraph. */
export function statusRow(
  containerEl: HTMLElement,
  row: { name: string | DocumentFragment; value: string },
): void {
  const setting = new Setting(containerEl).setName(row.name);
  setting.settingEl.addClass("atoms-setting-status-row");
  setting.controlEl.createSpan({ cls: "atoms-setting-status", text: row.value });
}
