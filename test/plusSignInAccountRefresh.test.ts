/**
 * #473 — magic-link install writes the session and must rebuild the open Account
 * screen. Paste/trial already redraw; the protocol-handler path goes through
 * `plugin.installPlusSession` and used to leave the signed-out form up until Back.
 */
import { describe, expect, it } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";
import {
  readPlusSession,
  resolveFilingAuth,
  type PlusSession,
} from "../src/platform/filingAuth";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import { open, rowNames, settingTab } from "./helpers/settingsTab";

const SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "plus@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
};

function liveAccountTab() {
  const made = settingTab();
  const app = (made.tab as unknown as { app: Parameters<typeof readPlusSession>[0] }).app;
  (made.plugin as unknown as { resolveFilingAuth: () => unknown }).resolveFilingAuth = () =>
    resolveFilingAuth({
      byokApiKey: null,
      plusSession: readPlusSession(app),
    });
  made.tab.display();
  open(made.tab, "Set up automatic filing");
  return { ...made, app };
}

describe("#473 Account redraw after installPlusSession", () => {
  it("flips the open Account destination to signed-in without leaving", async () => {
    const { tab, app } = liveAccountTab();
    expect(rowNames(tab)).toContain("Sign in with a link");
    expect(rowNames(tab)).not.toContain("Sign out");

    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      app,
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: async () => {},
      ask: {
        mirrorPermitted: () => false,
        cancelPendingSync: () => {},
      },
      settingTab: tab,
    });

    await plugin.installPlusSession(SESSION);

    expect(readPlusSession(app)?.email).toBe("plus@example.com");
    expect(rowNames(tab)).toContain("Sign out");
    expect(rowNames(tab)).toContain("Signed in as");
    expect(tab.containerEl.textContent).toContain("plus@example.com");
    expect(rowNames(tab)).not.toContain("Sign in with a link");
  });

  it("installs when Settings is closed", async () => {
    const { app } = liveAccountTab();
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      app,
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: async () => {},
      ask: {
        mirrorPermitted: () => false,
        cancelPendingSync: () => {},
      },
      settingTab: null,
    });

    await plugin.installPlusSession(SESSION);
    expect(readPlusSession(app)?.email).toBe("plus@example.com");
  });
});
