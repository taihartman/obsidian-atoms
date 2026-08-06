/**
 * Obsidian patches `HTMLElement.prototype` with a small DOM sugar layer (`createEl`,
 * `createDiv`, `empty`, `addClass`, …) that plugin code — and `src/settings/settings.ts`
 * especially — uses everywhere. A bare jsdom/happy-dom document has none of it, so a test
 * that renders a settings row would die on the first `containerEl.createEl(...)`.
 *
 * Importing this module installs the subset the plugin actually calls. `test/mocks/obsidian.ts`
 * imports it for its side effect, so any test that touches the `obsidian` module (directly or
 * through the code under test) gets the augmentations before the first element is built.
 *
 * Signatures follow `obsidian.d.ts`; the prototype is written through a loose alias so this
 * file does not have to restate the library's overloads.
 */
import { noteUiString } from "./uiCapture";

/** Subset of Obsidian's `DomElementInfo` that the plugin passes. */
export interface DomElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
}

type ElInfo = string | DomElementInfo | undefined;
type ElCallback = ((el: HTMLElement) => void) | undefined;

function applyInfo(el: HTMLElement, info: ElInfo): void {
  if (!info) return;
  if (typeof info === "string") {
    el.addClass(info);
    return;
  }
  if (info.cls) el.addClasses(typeof info.cls === "string" ? info.cls.split(" ") : info.cls);
  if (info.text !== undefined) el.setText(info.text);
  if (info.title !== undefined) el.setAttribute("title", info.title);
  if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
  if (info.type !== undefined) (el as HTMLInputElement).type = info.type;
  if (info.placeholder !== undefined) (el as HTMLInputElement).placeholder = info.placeholder;
  if (info.href !== undefined) el.setAttribute("href", info.href);
  if (info.attr) {
    for (const [key, value] of Object.entries(info.attr)) {
      if (value === null || value === false) el.removeAttribute(key);
      else el.setAttribute(key, String(value));
    }
  }
}

function attach(parent: HTMLElement, el: HTMLElement, info: ElInfo): void {
  const target =
    (typeof info === "object" && info?.parent instanceof Node ? info.parent : parent) ?? parent;
  if (typeof info === "object" && info?.prepend) target.insertBefore(el, target.firstChild);
  else target.appendChild(el);
}

function makeEl(tag: string, info: ElInfo, callback: ElCallback): HTMLElement {
  const el = document.createElement(tag);
  applyInfo(el, info);
  callback?.(el);
  return el;
}

const sugar: Record<string, unknown> = {
  createEl(this: HTMLElement, tag: string, info?: ElInfo, callback?: ElCallback): HTMLElement {
    const el = makeEl(tag, info, callback);
    attach(this, el, info);
    return el;
  },
  createDiv(this: HTMLElement, info?: ElInfo, callback?: ElCallback): HTMLElement {
    return this.createEl("div", info as never, callback as never);
  },
  createSpan(this: HTMLElement, info?: ElInfo, callback?: ElCallback): HTMLElement {
    return this.createEl("span", info as never, callback as never);
  },
  empty(this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  },
  detach(this: HTMLElement): void {
    this.parentNode?.removeChild(this);
  },
  setText(this: HTMLElement, text: string): void {
    // The one funnel every `createEl({ text })` and explicit `setText` passes through, so a
    // capturing test sees prose in the order it was drawn without the mock keeping a second
    // copy of the DOM. Inert unless a capture is running.
    noteUiString(text);
    this.textContent = text;
  },
  appendText(this: HTMLElement, text: string): void {
    this.appendChild(document.createTextNode(text));
  },
  addClass(this: HTMLElement, ...classes: string[]): void {
    this.classList.add(...classes.filter(Boolean));
  },
  addClasses(this: HTMLElement, classes: string[]): void {
    this.classList.add(...classes.filter(Boolean));
  },
  removeClass(this: HTMLElement, ...classes: string[]): void {
    this.classList.remove(...classes.filter(Boolean));
  },
  removeClasses(this: HTMLElement, classes: string[]): void {
    this.classList.remove(...classes.filter(Boolean));
  },
  toggleClass(this: HTMLElement, classes: string | string[], value: boolean): void {
    const list = typeof classes === "string" ? [classes] : classes;
    for (const cls of list) this.classList.toggle(cls, value);
  },
  hasClass(this: HTMLElement, cls: string): boolean {
    return this.classList.contains(cls);
  },
  setAttr(this: HTMLElement, key: string, value: string | number | boolean | null): void {
    if (value === null || value === false) this.removeAttribute(key);
    else this.setAttribute(key, String(value));
  },
  setAttrs(this: HTMLElement, attrs: Record<string, string | number | boolean | null>): void {
    for (const [key, value] of Object.entries(attrs)) this.setAttr(key, value);
  },
  show(this: HTMLElement): void {
    this.style.display = "";
  },
  hide(this: HTMLElement): void {
    this.style.display = "none";
  },
  toggle(this: HTMLElement, show: boolean): void {
    if (show) this.show();
    else this.hide();
  },
};

/**
 * Install once. A no-op outside a DOM environment so the node-environment tests that pull
 * `test/mocks/obsidian.ts` in for `requestUrl`/`TFile` keep working untouched.
 */
export function installObsidianDomSugar(): void {
  if (typeof HTMLElement === "undefined") return;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const [name, impl] of Object.entries(sugar)) {
    if (proto[name]) continue;
    Object.defineProperty(proto, name, { value: impl, writable: true, configurable: true });
  }
}

installObsidianDomSugar();
