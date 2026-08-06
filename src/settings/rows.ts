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

/**
 * What is currently running, keyed by *what it does* rather than by which button started it.
 *
 * A `ButtonComponent` is minted fresh on every render, so a guard stored on one dies the moment
 * anything rebuilds the screen — and after the destination split, rebuilding is an ordinary
 * gesture: press *Get more filings*, see nothing happen yet, tap back, walk in again, press
 * again. That used to open a second Stripe Checkout Session (`createCheckout` sends no
 * idempotency key), send a second sign-in email, or mint a second live pairing secret. Owning
 * the state at the tab level instead means a rebuilt row for an action already in flight renders
 * disabled, and pressing it joins the run in progress rather than starting another.
 */
export class InFlightActions {
  private readonly running = new Map<string, Promise<void>>();

  /** The run already under way for this action, if any — what a rebuilt row waits on. */
  pending(action: string): Promise<void> | undefined {
    return this.running.get(action);
  }

  /**
   * Start `onClick` under `action`, or hand back the run already in flight without starting a
   * second one. Synchronous actions pass straight through: there is no window to double-press.
   */
  run(action: string, onClick: RowAction): void | Promise<void> {
    const already = this.running.get(action);
    if (already) return already;
    const started = onClick();
    if (!(started instanceof Promise)) return started;
    // Identity-checked before deleting, so a slow run that settles after a newer one started
    // cannot clear the newer one's claim. Both arms settle: a rejected action must release its
    // action rather than wedge it forever, and this promise is handed to rows that did not
    // start it, so it absorbs the rejection rather than depending on who happens to watch.
    const release = (): void => {
      if (this.running.get(action) === tracked) this.running.delete(action);
    };
    const tracked: Promise<void> = started.then(release, release);
    this.running.set(action, tracked);
    return tracked;
  }
}

/** A button row's shape, shared by the accent and destructive kinds. */
export type ButtonRowSpec = RowInfo & {
  label: string;
  /**
   * Stable identity of what this button does — the key the in-flight guard tracks. Required
   * rather than optional so a new money or identity path cannot be added unguarded by omission.
   * Rows that repeat per item (one per tag, say) must carry the item in the id.
   */
  action: string;
  onClick: RowAction;
  disabled?: boolean;
  tooltip?: string;
};

/** A spec plus the registry that outlives the render it was built in. */
type ButtonRow = ButtonRowSpec & { inFlight: InFlightActions };

/**
 * Hold a button down for as long as the promise it is watching takes.
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
  /**
   * A statement, never an expression — `() => btn.setDisabled(false)` froze the renderer.
   *
   * `setDisabled` returns the `ButtonComponent`, and every Obsidian component is a thenable
   * (`BaseComponent.then(cb)` runs `cb(this)` and hands `this` back, for chaining). An arrow
   * whose implicit return is that component therefore resolves this chain *with a thenable*,
   * so the promise machinery calls `then`, is handed the same component again, and repeats —
   * a microtask loop that never yields. Obsidian pinned at 100% CPU with no re-render, no
   * growing stack, and no recovery short of force-quit.
   */
  const release = (): void => {
    btn.setDisabled(false);
  };
  // Both arms, so a rejected action leaves a usable row rather than a dead one, and the
  // rejection is absorbed rather than escaping a fire-and-forget handler as an unhandled one.
  // (The action reports its own failures through Notices.)
  void pending.then(release, release);
}

function buttonRow(
  containerEl: HTMLElement,
  row: ButtonRow,
  style: (btn: ButtonComponent) => ButtonComponent,
): void {
  baseRow(containerEl, row).addButton((btn) => {
    style(btn.setButtonText(row.label)).onClick(() =>
      runRowAction(btn, () => row.inFlight.run(row.action, row.onClick)),
    );
    if (row.tooltip !== undefined) btn.setTooltip(row.tooltip);
    if (row.disabled) {
      btn.setDisabled(true);
      return;
    }
    // Built while its action is already running — most often because that action's own
    // `redisplay()` rebuilt the screen mid-flight. Watching the run in progress is what makes
    // the guard survive the rebuild, and releases the button when the run actually finishes
    // rather than leaving it dead until the next render.
    const inFlight = row.inFlight.pending(row.action);
    if (inFlight) runRowAction(btn, () => inFlight);
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
