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
import { issuedBaseFromResponse } from "../src/platform/plusClient";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import { open, rowNames, settingTab } from "./helpers/settingsTab";

/** The base the exchange answered from, which is all the wrapper is given. */
const ISSUER = issuedBaseFromResponse("https://self.host.example");

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
  // Account sits two taps in since U4: the main screen asks who files, the engine screen offers
  // the two answers, and this row is the Plus one.
  open(made.tab, "Filing");
  open(made.tab, "Atoms Plus");
  return { ...made, app };
}

describe("#473 Account redraw after installPlusSession", () => {
  it("flips the open Account destination to signed-in without leaving", async () => {
    const { tab, app } = liveAccountTab();
    expect(rowNames(tab)).toContain("Email");
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

    await plugin.installPlusSession(SESSION, ISSUER);

    expect(readPlusSession(app)?.email).toBe("plus@example.com");
    expect(rowNames(tab)).toContain("Sign out");
    expect(rowNames(tab)).toContain("Signed in as");
    expect(tab.containerEl.textContent).toContain("plus@example.com");
    expect(rowNames(tab)).not.toContain("Email");
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

    await plugin.installPlusSession(SESSION, ISSUER);
    expect(readPlusSession(app)?.email).toBe("plus@example.com");
  });

  /**
   * #508 U2 — the wrapper is the indirection where a stamp is likeliest to be
   * re-resolved from settings, because the plugin has `this.settings` right
   * there. The configured base here is a different host, so a wrapper that read
   * it instead of forwarding its argument fails both assertions.
   */
  it("forwards the issuer it was handed instead of reading plusBaseUrl", async () => {
    const { app } = liveAccountTab();
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      app,
      settings: { ...DEFAULT_SETTINGS, plusBaseUrl: "https://plus.tryatoms.app" },
      saveSettings: async () => {},
      ask: {
        mirrorPermitted: () => false,
        cancelPendingSync: () => {},
      },
      settingTab: null,
    });

    await plugin.installPlusSession(SESSION, ISSUER);

    const stored = readPlusSession(app);
    expect(stored?.issuedBase).toBe("https://self.host.example");
    expect(stored?.verifiedBase).toBe("https://self.host.example");
  });
});
