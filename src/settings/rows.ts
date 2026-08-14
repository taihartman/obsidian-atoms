import {
  type App,
  type ButtonComponent,
  type DropdownComponent,
  Modal,
  Setting,
  type TextComponent,
  type ToggleComponent,
} from "obsidian";
// One home for the 1.11.4-safe destructive style. It lives outside this module because the
// sign-in confirmation (#240 U10) needs the same answer without pulling in the row grammar;
// re-exported so `destructiveRow`'s neighbours can keep importing it from here.
import { markDestructive } from "./destructiveButton";

export { markDestructive };

/**
 * Row grammar for the Atoms settings tab: seven row kinds, seven right edges.
 *
 * | Kind          | Right edge                    |
 * |---------------|-------------------------------|
 * | `settingRow`  | toggle or input               |
 * | `destinationRow` | chevron                    |
 * | `actionRow`   | accent-text button            |
 * | `destructiveRow` | destructive/warning button |
 * | `formRow`     | input plus the one button that commits it |
 * | `formActionsRow` | input plus several buttons that each commit it |
 * | `statusRow`   | muted trailing text, no control |
 *
 * `formRow`'s two controls are one grammar — "type this, then commit it" — the way a
 * `destinationRow`'s name and chevron are one. Its button is not an independent action: its only
 * job is to submit the field beside it, which is why the pair is its own kind rather than an
 * optional `button` bolted onto `settingRow`.
 *
 * `formActionsRow` is the same grammar with more than one commit: every button still only
 * submits the field beside it. It exists because signed-out Account has one email and three
 * things to do with it. Three `formRow`s would be three email boxes.
 *
 * `group()` sits alongside them without being one: it is the container those rows compose into,
 * carrying the header and the single footer that used to be a description on every row.
 *
 * No row may carry two grammars, so every builder applies exactly one affordance and returns
 * `void` — `Setting` is chainable, and handing the row back would let a caller bolt a second
 * affordance on after the fact. Same shape and same `void` return as `settingHeading()`.
 */

/** A group's prose, and the rows that sit between the two halves of it. */
export interface SettingGroupSpec {
  /** The eyebrow above the group — what these rows are for, in the reader's words. */
  header: string;
  /**
   * The one sentence under the group. Prose only, never an action: a group explains itself
   * once, at the bottom, instead of repeating a description on every row inside it.
   */
  footer?: string;
  /** Builds the rows into the group's own container. Same `containerEl`-first shape as a row. */
  render: (groupEl: HTMLElement) => void;
}

/**
 * A run of rows as one inset block: header above, rows inside, one footer below.
 *
 * A container rather than a row kind — it carries no name, no control, and no right edge, so it
 * is to rows what `renderDestination` is to screens. Every builder already takes its container
 * first, so a row composes into a group with no signature of its own changing.
 *
 * The header is built with `createEl` rather than `settingHeading()`: a heading made from a
 * `Setting` renders as a `.setting-item`, which would put a row-shaped element *outside* the
 * group box it labels, and the eyebrow the design asks for is chrome around rows rather than one
 * of them. The footer keeps `setting-item-description` alongside its own class so it stays the
 * same prose element the rest of the tab uses.
 */
export function group(containerEl: HTMLElement, spec: SettingGroupSpec): void {
  containerEl.createEl("h3", { cls: "atoms-setting-group-header", text: spec.header });
  spec.render(containerEl.createDiv({ cls: "atoms-setting-group" }));
  if (spec.footer === undefined) return;
  containerEl.createEl("p", {
    cls: ["setting-item-description", "atoms-setting-group-foot"],
    text: spec.footer,
  });
}

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

/**
 * Make a whole row the target, for a pointer and for a keyboard alike.
 *
 * The chevron is an `extraButton` — a div, not a `<button>` — so a row whose only affordance is
 * "the row is the target" is reachable by pointer and by nothing else. `tabindex` puts it in the
 * tab order, `role="button"` tells a screen reader what landing there means, and Enter and Space
 * share the click handler so the announced role is the truth. Space is prevented because its
 * default is scrolling the pane behind the row the user just activated.
 */
function activatableRow(setting: Setting, onActivate: () => void): void {
  const el = setting.settingEl;
  el.addClass("mod-clickable");
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  // The listener lives on the row, not the chevron: a chevron click bubbles here, so the row
  // acts exactly once wherever the user aims.
  el.addEventListener("click", () => onActivate());
  el.addEventListener("keydown", (evt: KeyboardEvent) => {
    if (evt.key !== "Enter" && evt.key !== " ") return;
    evt.preventDefault();
    onActivate();
  });
}

/** A way into somewhere else: chevron right edge, whole row clickable, never a toggle. */
export function destinationRow(
  containerEl: HTMLElement,
  row: RowInfo & { onOpen: () => void },
): void {
  const setting = baseRow(containerEl, row);
  setting.addExtraButton((chevron) => chevron.setIcon("chevron-right"));
  setting.settingEl.addClass("atoms-setting-destination");
  activatableRow(setting, () => row.onOpen());
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
  activatableRow(setting, () => row.onBack());
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

/** What a guarded button needs, minus the row prose — all `addGuardedButton` reads. */
type GuardedButton = Omit<ButtonRow, keyof RowInfo>;

/**
 * Put a guarded button on a `Setting` the caller already built.
 *
 * Split out of `buttonRow` because `formRow`'s row carries a text field before its button lands
 * on it, so it cannot go through a helper that builds its own `Setting` first. One implementation
 * of the guard, reached two ways — forking it is how the double-tap bugs above come back.
 */
function addGuardedButton(
  setting: Setting,
  row: GuardedButton,
  style: (btn: ButtonComponent) => ButtonComponent,
): void {
  setting.addButton((btn) => {
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

function buttonRow(
  containerEl: HTMLElement,
  row: ButtonRow,
  style: (btn: ButtonComponent) => ButtonComponent,
): void {
  addGuardedButton(baseRow(containerEl, row), row, style);
}

/** Something that happens now: one accent-text button, never a toggle. */
export function actionRow(containerEl: HTMLElement, row: ButtonRow): void {
  buttonRow(containerEl, row, (btn) => btn.setCta());
}

/** Something that destroys data: one destructive button, never accent, never a toggle. */
export function destructiveRow(containerEl: HTMLElement, row: ButtonRow): void {
  buttonRow(containerEl, row, markDestructive);
}

/** A form row's shape: the field, and the one button that commits it. */
export type FormRowSpec = RowInfo & {
  placeholder?: string;
  /** Field-level setup — password type, autocomplete, initial value. Never adds a control. */
  configure?: (text: TextComponent) => void;
  submit: {
    /** Same contract as `ButtonRowSpec.action`: the identity the in-flight guard tracks. */
    action: string;
    label: string;
    onSubmit: (value: string) => void | Promise<void>;
  };
};

/** A spec plus the registry that outlives the render it was built in. */
type FormRow = Omit<FormRowSpec, "submit"> & {
  submit: FormRowSpec["submit"] & { inFlight: InFlightActions };
};

/**
 * A field and the one button that commits it, in a single row.
 *
 * The button submits the field's **trimmed** value: `startsWith("sess_")` on a pasted session
 * token and `includes("@")` on an email both only survive on a trimmed string, and the DOM-reading
 * helper this replaced ended in `.value.trim()`. Trimming here rather than at four call sites is
 * what keeps a token pasted with a leading space from failing validation.
 *
 * Enter does not submit. The button used to live in its own row, where Enter did nothing, and
 * wiring it now would add an unasked-for interaction on two money/identity paths — a decision to
 * revisit deliberately, not to acquire by accident.
 *
 * In flight, the button is held and the field stays editable: the guard is `actionRow`'s, so a
 * rebuild mid-flight renders the button disabled and pressing it joins the run already going.
 */
export function formRow(containerEl: HTMLElement, row: FormRow): void {
  const setting = baseRow(containerEl, row);
  setting.settingEl.addClass("atoms-setting-form");
  // Captured rather than returned: the submit handler needs the live field, and handing the
  // component back to the caller is the chainable escape hatch the `void` returns exist to close.
  let field!: TextComponent;
  setting.addText((text) => {
    field = text;
    if (row.placeholder !== undefined) text.setPlaceholder(row.placeholder);
    row.configure?.(text);
  });
  addGuardedButton(
    setting,
    {
      label: row.submit.label,
      action: row.submit.action,
      inFlight: row.submit.inFlight,
      onClick: () => row.submit.onSubmit(field.getValue().trim()),
    },
    (btn) => btn.setCta(),
  );
}

/** One field, and every button that may commit it. Each button still only submits that field. */
export type FormActionsRowSpec = RowInfo & {
  placeholder?: string;
  configure?: (text: TextComponent) => void;
  submits: Array<{
    action: string;
    label: string;
    /** Accent the primary commit. Others stay quiet. */
    accent?: boolean;
    onSubmit: (value: string) => void | Promise<void>;
  }>;
};

type FormActionsRow = Omit<FormActionsRowSpec, "submits"> & {
  submits: Array<FormActionsRowSpec["submits"][number] & { inFlight: InFlightActions }>;
};

/**
 * A field and several buttons that each submit it.
 *
 * Same trim and Enter rules as `formRow`. Each commit has its own in-flight id, so a double-tap
 * on Start free trial does not also hold Use promo code.
 */
export function formActionsRow(containerEl: HTMLElement, row: FormActionsRow): void {
  const setting = baseRow(containerEl, row);
  setting.settingEl.addClass("atoms-setting-form");
  setting.settingEl.addClass("atoms-setting-form-actions");
  let field!: TextComponent;
  setting.addText((text) => {
    field = text;
    if (row.placeholder !== undefined) text.setPlaceholder(row.placeholder);
    row.configure?.(text);
  });
  for (const submit of row.submits) {
    addGuardedButton(
      setting,
      {
        label: submit.label,
        action: submit.action,
        inFlight: submit.inFlight,
        onClick: () => submit.onSubmit(field.getValue().trim()),
      },
      (btn) => (submit.accent ? btn.setCta() : btn),
    );
  }
}

/** The question a destructive row asks before it acts. */
export interface ConfirmSheet {
  app: App;
  title: string;
  body: string;
  /** The way out — "Cancel", "Keep". Never styled destructive. */
  cancelLabel: string;
  /** The destructive answer, styled to match the row that opened the sheet. */
  confirmLabel: string;
  /** Runs after the sheet closes; the row stays held until its promise settles. */
  onConfirm: () => Promise<void>;
}

/**
 * A destructive question, and the promise that keeps its row held until it is answered.
 *
 * Returning before the answer is what lets one destructive row stack two sheets on a double-tap,
 * so the promise settles on the *action* when the user confirms and on `onClose` otherwise —
 * Cancel, Escape, and a click outside all arrive as `close()`, so one branch covers all three.
 *
 * Lives here rather than beside either caller because a confirm sheet is the destructive row's
 * other half: the row declares the kind, the sheet asks the question, and the two settings
 * confirms that existed independently had already drifted into the same shape twice.
 */
export function confirmSheet(sheet: ConfirmSheet): Promise<void> {
  return new Promise<void>((resolve) => {
    const modal = new Modal(sheet.app);
    modal.titleEl.setText(sheet.title);
    modal.contentEl.createEl("p", { text: sheet.body });
    let confirmed = false;
    modal.onClose = () => {
      if (!confirmed) resolve();
    };
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText(sheet.cancelLabel).onClick(() => modal.close()))
      .addButton((b) =>
        markDestructive(b.setButtonText(sheet.confirmLabel))
          .setCta()
          .onClick(() => {
            confirmed = true;
            modal.close();
            void sheet.onConfirm().finally(resolve);
          }),
      );
    modal.open();
  });
}

/**
 * Read-only state: muted trailing text, no control, and no description paragraph.
 *
 * `value` is optional because the same grammar covers a fact with nothing to report on its right
 * edge — a plain statement the user reads and cannot act on, like the three lines the engine
 * screen uses to say what leaves the device. Omitting it renders no span at all rather than an
 * empty one, so a row that has nothing to say does not reserve a column for saying it. This is
 * not a second kind: a statement is read-only state whose state is the sentence.
 */
export function statusRow(
  containerEl: HTMLElement,
  row: { name: string | DocumentFragment; value?: string },
): void {
  const setting = new Setting(containerEl).setName(row.name);
  setting.settingEl.addClass("atoms-setting-status-row");
  if (row.value === undefined) return;
  setting.controlEl.createSpan({ cls: "atoms-setting-status", text: row.value });
}
