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

  it("does not rebuild the screen when the synced file changed nothing this device holds", async () => {
    const { plugin } = pluginOnSyncedVault(GRANTED);
    await plugin.loadSettings();
    let refreshes = 0;
    plugin.settingTab = {
      refreshFromExternalSettings: () => {
        refreshes += 1;
      },
    } as unknown as typeof plugin.settingTab;

    // Same bytes back — what `loadSettings`' own legacy-hash write looks like bouncing through
    // this hook, and what an unrelated device's no-op write looks like.
    await plugin.onExternalSettingsChange();

    expect(refreshes).toBe(0);
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

  /**
   * F4 — the *non-throwing* shape of the same mid-write file. `loadSettings` coalesces a
   * missing read to `{}`, which is right on a fresh install and catastrophic at runtime: it
   * resets every setting to defaults and the next save pushes that wipe to every device.
   */
  it.each([
    ["null", null],
    ["a bare string", "not an object"],
  ])("does not wipe settings when the external read comes back as %s", async (_label, bad) => {
    const { plugin } = pluginOnSyncedVault({
      ...GRANTED,
      plusBaseUrl: "https://plus.example",
      atomFolder: "Atoms",
    });
    await plugin.loadSettings();
    let saves = 0;
    Object.assign(plugin, {
      loadData: async () => bad,
      saveData: async () => {
        saves += 1;
      },
    });

    await plugin.onExternalSettingsChange();

    expect(plugin.settings.askPrivacyAckAt).toBe(GRANTED.askPrivacyAckAt);
    expect(plugin.settings.plusBaseUrl).toBe("https://plus.example");
    // Nothing was applied, so nothing may be persisted — a save here is how the wipe
    // would reach the other devices.
    expect(saves).toBe(0);
  });

  /**
   * F2 — read-modify-write lost update on a synced file. The hook's read can resolve *after*
   * a local withdrawal has already mutated `settings` and started its own save. Re-pointing
   * settings at the copy the read is holding would leave memory more permissive than disk,
   * and the next save would push the resurrected grant back out through Sync.
   */
  it("discards an external read that a local write overtook", async () => {
    const { plugin } = pluginOnSyncedVault(GRANTED);
    await plugin.loadSettings();

    let releaseRead = () => {};
    const readInFlight = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    Object.assign(plugin, {
      // The pre-withdrawal bytes: what a read that started before the local write returns.
      loadData: async () => {
        await readInFlight;
        return { ...GRANTED };
      },
    });

    const hook = plugin.onExternalSettingsChange();
    // The user withdraws on *this* device while that read is outstanding.
    plugin.settings.askPrivacyAckAt = "";
    await plugin.saveSettings();
    releaseRead();
    await hook;

    expect(plugin.settings.askPrivacyAckAt).toBe("");
  });

  /**
   * F3 — the same aliasing mistake, one field over. `plusSignIn` stores the host object once
   * and reads `plusBaseUrl` from it much later, at token-exchange time. Every settings load
   * replaces `plugin.settings`, so a host holding the object rather than a getter would keep
   * signing in against whichever base URL existed at startup.
   */
  it("reads plusBaseUrl live, so sign-in follows a settings reload", async () => {
    const { plugin, syncWrites } = pluginOnSyncedVault({
      ...GRANTED,
      plusBaseUrl: "https://old.example",
    });
    await plugin.loadSettings();
    // Captured once, the way plusSignIn captures it.
    const host = plugin.plusSignInHost();
    expect(host.settings.plusBaseUrl).toBe("https://old.example");

    syncWrites({ ...GRANTED, plusBaseUrl: "https://new.example" });
    await plugin.onExternalSettingsChange();

    expect(host.settings.plusBaseUrl).toBe("https://new.example");
  });

  /**
   * F1's other half. Closing the gate is not enough on its own: a mirror pass already inside
   * its single-flight loop owes itself a follow-up that never re-enters the gate in `sync()`.
   * `askCoordinator.test.ts` proves what cancelling does; this proves the hook asks for it.
   */
  it("cancels pending mirror work when the reloaded state may not push", async () => {
    const { plugin, syncWrites } = pluginOnSyncedVault(GRANTED);
    await plugin.loadSettings();
    let cancels = 0;
    // Only the cancellation is stubbed. `mirrorPermitted()` stays the real one, so this
    // asserts the hook's actual decision rather than a predicate copied into the test.
    plugin.ask.cancelPendingSync = () => {
      cancels += 1;
    };

    syncWrites(WITHDRAWN);
    await plugin.onExternalSettingsChange();
    expect(cancels).toBe(1);

    // A grant owes no cancellation — that would drop a legitimate follow-up.
    syncWrites(GRANTED);
    await plugin.onExternalSettingsChange();
    expect(cancels).toBe(1);
  });
});
