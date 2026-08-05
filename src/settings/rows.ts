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

/**
 * The way back out of a destination: `destinationRow` mirrored, chevron pointing the other way.
 * Named for the destination it leaves, so the row doubles as that screen's title, and rendered
 * first so leaving never means scrolling to the bottom.
 *
 * Not a sixth row kind — it is the return leg of the same navigation grammar `destinationRow`
 * opens, which is why it shares that row's shape and carries no control of its own.
 */
export function backRow(
  containerEl: HTMLElement,
  row: RowInfo & { onBack: () => void },
): void {
  const setting = baseRow(containerEl, row);
  setting.addExtraButton((chevron) => chevron.setIcon("chevron-left"));
  setting.settingEl.addClass("atoms-setting-back");
  setting.settingEl.addClass("mod-clickable");
  setting.settingEl.addEventListener("click", () => row.onBack());
}

/**
 * What a button row does when pressed. Returning a promise is how a caller opts into the
 * in-flight guard below; returning nothing is the plain synchronous case.
 */
type RowAction = () => void | Promise<void>;

/** A button row's shape, shared by the accent and destructive kinds. */
type ButtonRow = RowInfo & {
  label: string;
  onClick: RowAction;
  disabled?: boolean;
  tooltip?: string;
};

/**
 * Run a row's action, and hold its button down for as long as that takes.
 *
 * The guard lives here rather than in the caller because the alternative is handing back the
 * `ButtonComponent` so each caller can disable it — exactly the chainable escape hatch the
 * `void` returns exist to close. Without it, a double-tap on *Send sign-in link* sent two
 * emails and a double-tap on *Refresh status* made two requests.
 */
function runRowAction(btn: ButtonComponent, onClick: RowAction): void {
  const pending = onClick();
  if (!(pending instanceof Promise)) return;
  btn.setDisabled(true);
  // Re-enabled from a `finally` so a rejected action leaves a usable row rather than a dead one.
  // The rejection is absorbed here: the action reports its own failures (Notices), and letting
  // it escape a fire-and-forget handler would only surface as an unhandled rejection.
  void pending.finally(() => btn.setDisabled(false)).catch(() => {});
}

function buttonRow(
  containerEl: HTMLElement,
  row: ButtonRow,
  style: (btn: ButtonComponent) => ButtonComponent,
): void {
  baseRow(containerEl, row).addButton((btn) => {
    style(btn.setButtonText(row.label)).onClick(() => runRowAction(btn, row.onClick));
    if (row.tooltip !== undefined) btn.setTooltip(row.tooltip);
    if (row.disabled) btn.setDisabled(true);
  });
}

/** Something that happens now: one accent-text button, never a toggle. */
export function actionRow(containerEl: HTMLElement, row: ButtonRow): void {
  buttonRow(containerEl, row, (btn) => btn.setCta());
}

/** Something that destroys data: one destructive button, never accent, never a toggle. */
export function destructiveRow(containerEl: HTMLElement, row: ButtonRow): void {
  buttonRow(containerEl, row, markDestructive);
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
