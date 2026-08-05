/** Minimal stub so unit tests can import modules that depend on `obsidian`. */
import "./domAugmentations";

export function requestUrl(_opts: unknown): Promise<unknown> {
  throw new Error("requestUrl mock not configured — inject deps.request in tests");
}

export class Plugin {}
export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  /** Real element, so a tab's `display()` renders into something a test can read back. */
  containerEl: HTMLElement = document.createElement("div");
  constructor(app?: unknown, plugin?: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}
export class Notice {
  /** Every notice raised since the last reset — a test's handle on user-visible outcomes. */
  static messages: string[] = [];
  constructor(msg: string) {
    Notice.messages.push(msg);
  }
}

/**
 * The row grammar is asserted on rendered output, so `Setting` is a DOM-backed recorder
 * rather than a no-op chainable: it builds the element skeleton Obsidian does
 * (`setting-item` > `setting-item-info` {name, desc} + `setting-item-control`) and records
 * every control added, in order, as {@link Setting.controls}.
 *
 * Only the surface the plugin calls is modelled, and only where `obsidian.d.ts` has it —
 * `Setting` has no `setWarning`, for instance; that lives on `ButtonComponent`, deprecated
 * there in favour of `setDestructive`.
 */
export type ControlKind = "button" | "extraButton" | "toggle" | "text" | "dropdown" | "component";

export interface RecordedControl {
  kind: ControlKind;
  component: unknown;
}

class BaseComponent {
  disabled = false;
  tooltip: string | null = null;
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  /** Last `onClick` handler, so a test can fire a row's action without a synthetic event. */
  clickHandler: ((evt?: unknown) => unknown) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.buttonEl = containerEl.appendChild(document.createElement("button"));
  }
  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }
  setIcon(icon: string): this {
    this.buttonEl.setAttribute("data-icon", icon);
    return this;
  }
  setClass(cls: string): this {
    this.buttonEl.classList.add(cls);
    return this;
  }
  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }
  removeCta(): this {
    this.buttonEl.classList.remove("mod-cta");
    return this;
  }
  /** @deprecated mirrors the API — prefer {@link ButtonComponent.setDestructive}. */
  setWarning(): this {
    this.buttonEl.classList.add("mod-warning");
    return this;
  }
  setDestructive(): this {
    this.buttonEl.classList.add("mod-destructive");
    return this;
  }
  removeDestructive(): this {
    this.buttonEl.classList.remove("mod-destructive");
    return this;
  }
  override setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return super.setDisabled(disabled);
  }
  override setTooltip(tooltip: string): this {
    this.buttonEl.setAttribute("aria-label", tooltip);
    return super.setTooltip(tooltip);
  }
  onClick(callback: (evt?: unknown) => unknown): this {
    this.clickHandler = callback;
    this.buttonEl.addEventListener("click", (evt) => callback(evt));
    return this;
  }
}

export class ExtraButtonComponent extends BaseComponent {
  extraSettingsEl: HTMLElement;
  clickHandler: (() => unknown) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.extraSettingsEl = containerEl.appendChild(document.createElement("div"));
    this.extraSettingsEl.classList.add("extra-setting-button");
  }
  setIcon(icon: string): this {
    this.extraSettingsEl.setAttribute("data-icon", icon);
    return this;
  }
  override setTooltip(tooltip: string): this {
    this.extraSettingsEl.setAttribute("aria-label", tooltip);
    return super.setTooltip(tooltip);
  }
  onClick(callback: () => unknown): this {
    this.clickHandler = callback;
    this.extraSettingsEl.addEventListener("click", () => callback());
    return this;
  }
}

class ValueComponent<T> extends BaseComponent {
  protected value: T;
  protected changeHandler: ((value: T) => unknown) | null = null;
  constructor(initial: T) {
    super();
    this.value = initial;
  }
  getValue(): T {
    return this.value;
  }
  onChange(callback: (value: T) => unknown): this {
    this.changeHandler = callback;
    return this;
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super(false);
    this.toggleEl = containerEl.appendChild(document.createElement("div"));
    this.toggleEl.classList.add("checkbox-container");
    // Obsidian's real switch flips on a click of its own element. Mirroring that here is what
    // lets a test reach a toggle through the rendered tab, with no handle on the component.
    this.toggleEl.addEventListener("click", () => this.toggle());
  }
  setValue(value: boolean): this {
    this.value = value;
    this.toggleEl.classList.toggle("is-enabled", value);
    this.changeHandler?.(value);
    return this;
  }
  override setDisabled(disabled: boolean): this {
    this.toggleEl.classList.toggle("is-disabled", disabled);
    return super.setDisabled(disabled);
  }
  /** Test affordance: flip the switch the way a click would, firing `onChange`. */
  toggle(): this {
    return this.setValue(!this.value);
  }
}

export class TextComponent extends ValueComponent<string> {
  inputEl: HTMLInputElement;
  constructor(containerEl: HTMLElement) {
    super("");
    this.inputEl = containerEl.appendChild(document.createElement("input"));
    this.inputEl.type = "text";
    // Same reason as ToggleComponent: typing into the rendered field must reach `onChange`
    // without the test holding the component.
    this.inputEl.addEventListener("input", () => this.fill(this.inputEl.value));
  }
  setValue(value: string): this {
    this.value = value;
    this.inputEl.value = value;
    return this;
  }
  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }
  override setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return super.setDisabled(disabled);
  }
  /** Test affordance: type into the field and fire `onChange`, as a real user would. */
  fill(value: string): this {
    this.setValue(value);
    this.changeHandler?.(value);
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  constructor(containerEl: HTMLElement) {
    super("");
    this.selectEl = containerEl.appendChild(document.createElement("select"));
  }
  addOption(value: string, display: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = display;
    this.selectEl.appendChild(option);
    return this;
  }
  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) this.addOption(value, display);
    return this;
  }
  setValue(value: string): this {
    this.value = value;
    this.selectEl.value = value;
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: unknown[] = [];
  /** Every control added to this row, in the order it was added. */
  controls: RecordedControl[] = [];

  constructor(containerEl: HTMLElement = document.createElement("div")) {
    this.settingEl = containerEl.appendChild(document.createElement("div"));
    this.settingEl.classList.add("setting-item");
    this.infoEl = this.settingEl.appendChild(document.createElement("div"));
    this.infoEl.classList.add("setting-item-info");
    this.nameEl = this.infoEl.appendChild(document.createElement("div"));
    this.nameEl.classList.add("setting-item-name");
    this.descEl = this.infoEl.appendChild(document.createElement("div"));
    this.descEl.classList.add("setting-item-description");
    this.controlEl = this.settingEl.appendChild(document.createElement("div"));
    this.controlEl.classList.add("setting-item-control");
  }

  /** Rendered row name, as a reader sees it. */
  get name(): string {
    return this.nameEl.textContent ?? "";
  }

  /** Rendered row description, as a reader sees it. */
  get desc(): string {
    return this.descEl.textContent ?? "";
  }

  setName(name: string | DocumentFragment): this {
    this.nameEl.textContent = "";
    if (typeof name === "string") this.nameEl.textContent = name;
    else this.nameEl.appendChild(name);
    return this;
  }
  setDesc(desc: string | DocumentFragment): this {
    this.descEl.textContent = "";
    if (typeof desc === "string") this.descEl.textContent = desc;
    else this.descEl.appendChild(desc);
    return this;
  }
  setClass(cls: string): this {
    this.settingEl.classList.add(cls);
    return this;
  }
  setTooltip(tooltip: string): this {
    this.settingEl.setAttribute("aria-label", tooltip);
    return this;
  }
  setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.settingEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  private record<T>(kind: ControlKind, component: T, cb: (component: T) => unknown): this {
    this.components.push(component);
    this.controls.push({ kind, component });
    cb(component);
    return this;
  }

  addButton(cb: (component: ButtonComponent) => unknown): this {
    return this.record("button", new ButtonComponent(this.controlEl), cb);
  }
  addExtraButton(cb: (component: ExtraButtonComponent) => unknown): this {
    return this.record("extraButton", new ExtraButtonComponent(this.controlEl), cb);
  }
  addToggle(cb: (component: ToggleComponent) => unknown): this {
    return this.record("toggle", new ToggleComponent(this.controlEl), cb);
  }
  addText(cb: (component: TextComponent) => unknown): this {
    return this.record("text", new TextComponent(this.controlEl), cb);
  }
  addDropdown(cb: (component: DropdownComponent) => unknown): this {
    return this.record("dropdown", new DropdownComponent(this.controlEl), cb);
  }
  addComponent<T>(cb: (el: HTMLElement) => T): this {
    const component = cb(this.controlEl);
    this.components.push(component);
    this.controls.push({ kind: "component", component });
    return this;
  }
  then(cb: (setting: this) => unknown): this {
    cb(this);
    return this;
  }
  clear(): this {
    this.controlEl.textContent = "";
    this.components = [];
    this.controls = [];
    return this;
  }
}
export class TFile {
  path: string;
  basename?: string;
  constructor(path = "") {
    this.path = path;
  }
}
export const moment = (input?: string) => ({
  format: (f: string) => {
    if (input) return input;
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return f === "YYYY-MM-DD" ? `${y}-${mo}-${day}` : `${y}-${mo}-${day}`;
  },
  // Carried so callers can recover the requested date from a moment-like value.
  _input: input ?? null,
});
/**
 * Modelled rather than left a bare stub: rendering the real settings tab walks the API-key
 * row, and a stub there threw before any later section rendered — which quietly turned every
 * whole-tab test into a test of how far `display()` got.
 */
export class SecretComponent extends BaseComponent {
  app: unknown;
  containerEl: HTMLElement | undefined;
  /**
   * A real input, for the same reason `TextComponent` has one: saving a secret id is what
   * triggers the API-key check, so a test has to reach the field through the rendered row.
   */
  inputEl: HTMLInputElement;
  value = "";
  private changeHandler: ((value: string) => unknown) | null = null;
  constructor(app: unknown, containerEl?: HTMLElement) {
    super();
    this.app = app;
    this.containerEl = containerEl;
    this.inputEl = (containerEl ?? document.createElement("div")).appendChild(
      document.createElement("input"),
    );
    this.inputEl.type = "password";
    this.inputEl.addEventListener("input", () => this.fill(this.inputEl.value));
  }
  setValue(value: string): this {
    this.value = value;
    this.inputEl.value = value;
    return this;
  }
  onChange(cb: (value: string) => unknown): this {
    this.changeHandler = cb;
    return this;
  }
  /** Test affordance: type into the field and fire `onChange`, as a real user would. */
  fill(value: string): this {
    this.setValue(value);
    this.changeHandler?.(value);
    return this;
  }
}
/**
 * DOM-backed, because consent now lives in a sheet: a test has to read the disclosure a modal
 * renders and press its buttons, and the previous stub swallowed both. `open()`/`close()` run
 * the lifecycle hooks exactly once per visit, so "dismissed" (Escape, click-outside, the tab
 * closing — all of which reach Obsidian as `close()`) stays distinguishable from "accepted".
 */
export class Modal {
  app: unknown;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  private isOpen = false;
  /** Modals currently open, oldest first — a test's handle on a sheet it never constructed. */
  static open: Modal[] = [];
  constructor(app: unknown) {
    this.app = app;
    this.containerEl = document.createElement("div");
    this.containerEl.classList.add("modal-container");
    this.titleEl = this.containerEl.appendChild(document.createElement("div"));
    this.titleEl.classList.add("modal-title");
    this.contentEl = this.containerEl.appendChild(document.createElement("div"));
    this.contentEl.classList.add("modal-content");
  }
  onOpen() {}
  onClose() {}
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    Modal.open.push(this);
    document.body.appendChild(this.containerEl);
    this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    const at = Modal.open.indexOf(this);
    if (at >= 0) Modal.open.splice(at, 1);
    this.containerEl.remove();
    this.onClose();
  }
}
/**
 * Suggest modals are constructed by view code but never driven from unit tests — only the
 * shape a subclass extends is modelled, so importing those modules does not blow up.
 */
export class SuggestModal<T> extends Modal {
  setPlaceholder(_text: string): void {}
  getSuggestions(_query: string): T[] {
    return [];
  }
}
export class FuzzySuggestModal<T> extends SuggestModal<T> {
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T, _evt: unknown): void {}
}

/** Passed to `getActiveViewOfType` as a token; tests stub what the workspace hands back. */
export class MarkdownView {}

/** Enough of the view base class that modules declaring an `ItemView` subclass can be imported. */
export class ItemView {
  app: unknown;
  containerEl: HTMLElement = document.createElement("div");
  contentEl: HTMLElement = this.containerEl.appendChild(document.createElement("div"));
  constructor(public leaf?: unknown) {}
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  registerEvent(_ref: unknown): void {}
  registerDomEvent(_el: unknown, _type: string, _cb: unknown): void {}
}
export type WorkspaceLeaf = unknown;

export type App = unknown;
export type EventRef = unknown;
