import { describe, expect, it } from "vitest";

import type { App } from "obsidian";

import { closeSettings, openSettingsTab } from "../src/platform/obsidianSettings";

/**
 * The deep link into Obsidian's own settings modal.
 *
 * Worth its own test rather than being covered through a screen: `app.setting` is undocumented and
 * not on the public `App` type, so every branch here is a guess about somebody else's private API.
 * The settings tab's first-day step and five call sites in Atoms home all walk through it, and the
 * shared test double never defines `app.setting` — so a screen test only ever exercises the
 * missing-modal arm and would report full green with the other three broken.
 */

/** An `app` carrying a settings modal that records what was asked of it. */
function appWithSetting(open: () => void | Promise<void>): {
  app: App;
  calls: string[];
  tabs: string[];
} {
  const calls: string[] = [];
  const tabs: string[] = [];
  const app = {
    setting: {
      open: () => {
        calls.push("open");
        return open();
      },
      close: () => {
        calls.push("close");
      },
      openTabById: (id: string) => {
        calls.push("openTabById");
        tabs.push(id);
      },
    },
  } as unknown as App;
  return { app, calls, tabs };
}

/** Let the `.then` / `.catch` continuation run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("openSettingsTab", () => {
  it("opens the modal, then lands on the requested tab", async () => {
    const { app, calls, tabs } = appWithSetting(() => undefined);

    openSettingsTab(app, "daily-notes");
    await flush();

    expect(calls).toEqual(["open", "openTabById"]);
    expect(tabs).toEqual(["daily-notes"]);
  });

  it("waits for a modal that opens asynchronously before selecting the tab", async () => {
    let settle: (() => void) | undefined;
    const { app, calls, tabs } = appWithSetting(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );

    openSettingsTab(app, "atoms");
    await flush();
    // Nothing to land on yet — selecting a tab before the modal exists is the bug this awaits away.
    expect(calls).toEqual(["open"]);

    settle?.();
    await flush();

    expect(calls).toEqual(["open", "openTabById"]);
    expect(tabs).toEqual(["atoms"]);
  });

  it("selects no tab and raises nothing when the modal refuses to open", async () => {
    const { app, calls, tabs } = appWithSetting(() => Promise.reject(new Error("no")));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    globalThis.addEventListener?.("unhandledrejection", onUnhandled as EventListener);

    openSettingsTab(app, "atoms");
    await flush();
    globalThis.removeEventListener?.("unhandledrejection", onUnhandled as EventListener);

    expect(calls).toEqual(["open"]);
    expect(tabs).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it("does nothing at all when this build has no settings modal", async () => {
    // Not a crash and not a throw: the interface is a guess, and a build without it is a build
    // where the row simply has nowhere to go.
    expect(() => openSettingsTab({} as App, "atoms")).not.toThrow();
    await flush();
  });
});

describe("closeSettings", () => {
  it("closes the modal so the row's real target is visible", () => {
    const { app, calls } = appWithSetting(() => undefined);

    closeSettings(app);

    expect(calls).toEqual(["close"]);
  });

  it("does nothing when there is no settings modal", () => {
    expect(() => closeSettings({} as App)).not.toThrow();
  });
});
