/** Minimal stub so unit tests can import modules that depend on `obsidian`. */
export function requestUrl(_opts: unknown): Promise<unknown> {
  throw new Error("requestUrl mock not configured — inject deps.request in tests");
}

export class Plugin {}
export class PluginSettingTab {}
export class Notice {
  constructor(_msg: string) {}
}
export class Setting {
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addButton() {
    return this;
  }
  addText() {
    return this;
  }
  addToggle() {
    return this;
  }
  addComponent() {
    return this;
  }
}
export class SecretComponent {}
export class Modal {
  app: unknown;
  contentEl: {
    empty: () => void;
    addClass: () => void;
    createEl: () => { setText: () => void; style: Record<string, string> };
  };
  constructor(app: unknown) {
    this.app = app;
    this.contentEl = {
      empty: () => {},
      addClass: () => {},
      createEl: () => ({ setText: () => {}, style: {} }),
    };
  }
  onOpen() {}
  onClose() {}
  close() {}
}
export type App = unknown;
export type TFile = { path: string; basename?: string };
export type EventRef = unknown;
