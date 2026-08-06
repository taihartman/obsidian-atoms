/** Minimal stub so unit tests can import modules that depend on `obsidian`. */
export function requestUrl(_opts: unknown): Promise<unknown> {
  throw new Error("requestUrl mock not configured — inject deps.request in tests");
}

export class Plugin {}
export class PluginSettingTab {}

/**
 * Opt-in recorder for what a settings render actually put on screen. Off by
 * default so every existing test keeps the old inert `Setting`; a test that
 * calls `captureObsidianUi()` gets every name, description, placeholder and
 * button label the render produced, which is what a panel-wide copy assertion
 * needs.
 */
export type UiCapture = {
  /** Every string rendered into the panel, in render order. */
  strings: string[];
  buttons: { text: string; click: () => unknown }[];
  inputs: { dataset: Record<string, string>; value: string }[];
  notices: string[];
};

let capture: UiCapture | null = null;

export function captureObsidianUi(): UiCapture {
  capture = { strings: [], buttons: [], inputs: [], notices: [] };
  return capture;
}

export function stopCapturingObsidianUi(): void {
  capture = null;
}

function note(value: unknown): void {
  if (capture && typeof value === "string") capture.strings.push(value);
}

function makeButton() {
  const entry = { text: "", click: (() => {}) as () => unknown };
  capture?.buttons.push(entry);
  const btn = {
    setButtonText(text: string) {
      entry.text = text;
      note(text);
      return btn;
    },
    setCta: () => btn,
    setWarning: () => btn,
    setTooltip: () => btn,
    setIcon: () => btn,
    setDisabled: () => btn,
    onClick(fn: () => unknown) {
      entry.click = fn;
      return btn;
    },
  };
  return btn;
}

function makeText() {
  const inputEl = { dataset: {} as Record<string, string>, value: "" };
  capture?.inputs.push(inputEl);
  const text = {
    inputEl,
    setPlaceholder(placeholder: string) {
      note(placeholder);
      return text;
    },
    setValue(v: string) {
      inputEl.value = v;
      return text;
    },
    onChange: () => text,
  };
  return text;
}

export class Notice {
  message: string;
  constructor(msg: string, _timeout?: number) {
    this.message = msg;
    capture?.notices.push(msg);
  }
  /** Every message a Notice carried, so a test can tell a toast from a modal. */
  setMessage(msg: string) {
    this.message = msg;
    capture?.notices.push(msg);
    return this;
  }
  hide() {}
}
export class Setting {
  constructor(_containerEl?: unknown) {}
  setName(name?: unknown) {
    note(name);
    return this;
  }
  setDesc(desc?: unknown) {
    note(desc);
    return this;
  }
  setHeading() {
    return this;
  }
  addButton(cb?: (btn: unknown) => void) {
    if (capture && cb) cb(makeButton());
    return this;
  }
  addText(cb?: (text: unknown) => void) {
    if (capture && cb) cb(makeText());
    return this;
  }
  addToggle() {
    return this;
  }
  addComponent() {
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
export class SecretComponent {}
type ModalEl = {
  empty: () => void;
  addClass: () => void;
  createEl: (
    tag?: string,
    opts?: { text?: string; cls?: string },
  ) => ModalEl & { setText: (text: string) => void; style: Record<string, string> };
};

function makeModalEl(): ModalEl {
  const el: ModalEl = {
    empty: () => {},
    addClass: () => {},
    // Text goes through `note` so a capturing test can assert what a modal
    // actually rendered, and in what order relative to its buttons.
    createEl: (_tag?: string, opts?: { text?: string; cls?: string }) => {
      note(opts?.text);
      return Object.assign(makeModalEl(), {
        setText: (text: string) => note(text),
        style: {} as Record<string, string>,
      });
    },
  };
  return el;
}

export class Modal {
  app: unknown;
  contentEl: ModalEl;
  constructor(app: unknown) {
    this.app = app;
    this.contentEl = makeModalEl();
  }
  /** Obsidian renders on open; tests need the same trigger. */
  open() {
    this.onOpen();
  }
  onOpen() {}
  onClose() {}
  /** Inert, as before: dismissal is driven by calling `onClose` directly. */
  close() {}
}
export type App = unknown;
export type EventRef = unknown;
