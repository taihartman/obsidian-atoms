import { describe, expect, it } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";

/**
 * #323 — the Ask consent acks live in `data.json`, which Obsidian Sync replicates between
 * devices, but `plugin.settings` is populated once at load. Every consent gate reads that
 * in-memory copy: `askMirrorPermitted()` in `settings.ts` and the egress gates in
 * `askCoordinator.ts` all test `settings.askEnabled && settings.askPrivacyAckAt`.
 *
 * So a withdrawal on device A replicates to device B's disk and B, already running, keeps
 * mirroring note bodies under a consent the user revoked. Obsidian's answer is
 * `Plugin.onExternalSettingsChange()` (`obsidian.d.ts`), which fires when `data.json` changes
 * underneath a running plugin. Until it is implemented there is no re-read path at all —
 * `loadData()` is called exactly once, in `loadSettings()`.
 */

/** A plugin whose `data.json` the test controls, standing in for what Sync writes. */
function pluginOnSyncedVault(disk: Record<string, unknown>) {
  const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
  let onDisk = { ...disk };
  Object.assign(plugin, {
    loadData: async () => ({ ...onDisk }),
    saveData: async (next: Record<string, unknown>) => {
      onDisk = { ...next };
    },
  });
  /** What Sync replicating another device's write looks like from here. */
  const syncWrites = (next: Record<string, unknown>) => {
    onDisk = { ...next };
  };
  return { plugin, syncWrites };
}

const GRANTED = {
  askEnabled: true,
  askPrivacyAckAt: "2026-08-01T00:00:00.000Z",
  askWriteAckAt: "2026-08-01T00:00:00.000Z",
};

const WITHDRAWN = { ...GRANTED, askPrivacyAckAt: "", askWriteAckAt: "" };

describe("#323 cross-device consent", () => {
  it("closes the mirror gate when another device withdraws the ack, without a restart", async () => {
    const { plugin, syncWrites } = pluginOnSyncedVault(GRANTED);
    await plugin.loadSettings();
    expect(plugin.settings.askPrivacyAckAt).toBeTruthy();

    // Phone withdraws; Sync lands the cleared file under this already-running desktop.
    syncWrites(WITHDRAWN);
    await plugin.onExternalSettingsChange();

    // Every gate reads these two, so falsifying them is what closes egress.
    expect(plugin.settings.askPrivacyAckAt).toBe("");
    expect(plugin.settings.askWriteAckAt).toBe("");
  });

  it("picks up a grant made on another device too, not just a withdrawal", async () => {
    const { plugin, syncWrites } = pluginOnSyncedVault(WITHDRAWN);
    await plugin.loadSettings();
    expect(plugin.settings.askPrivacyAckAt).toBe("");

    syncWrites(GRANTED);
    await plugin.onExternalSettingsChange();

    expect(plugin.settings.askPrivacyAckAt).toBe(GRANTED.askPrivacyAckAt);
  });

  it("re-renders an open Settings screen, which was drawn against the replaced state", async () => {
    const { plugin, syncWrites } = pluginOnSyncedVault(GRANTED);
    await plugin.loadSettings();
    let refreshes = 0;
    plugin.settingTab = {
      refreshFromExternalSettings: () => {
        refreshes += 1;
      },
    } as unknown as typeof plugin.settingTab;

    syncWrites(WITHDRAWN);
    await plugin.onExternalSettingsChange();

    expect(refreshes).toBe(1);
  });

  it("leaves settings untouched when the external file is unreadable", async () => {
    const { plugin } = pluginOnSyncedVault(GRANTED);
    await plugin.loadSettings();
    Object.assign(plugin, {
      loadData: async () => {
        throw new Error("data.json mid-write");
      },
    });

    // A partial file mid-Sync must not be read as a withdrawal-shaped blank, and must not
    // throw into Obsidian's hook caller either.
    await expect(plugin.onExternalSettingsChange()).resolves.toBeUndefined();
    expect(plugin.settings.askPrivacyAckAt).toBe(GRANTED.askPrivacyAckAt);
  });
});
