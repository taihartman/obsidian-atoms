/**
 * #501 — a device that already stored a broken atom folder repairs itself on load.
 *
 * The guards in `clampAtomFolder` stop the *next* keystroke. They do nothing on their own for the
 * device that typed `.hidden` last week and has been filing into a folder Obsidian will not index
 * ever since, which is the only device that actually has this bug. `applyLoadedSettings` clamps
 * the stored value at load, so the repair reaches that device the next time Obsidian opens.
 *
 * This matters beyond tidiness because the read path and the write path disagree until it
 * happens: `atomPathForTitle` clamps, so writes would land in `Atoms/`, while home, the graph and
 * the Ask mirror read `settings.atomFolder` raw and would keep looking in the old folder.
 */
import { describe, expect, it } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";

function pluginWithStoredSettings(disk: Record<string, unknown>) {
  let onDisk: unknown = { ...disk };
  const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
  Object.assign(plugin, {
    loadData: async () => onDisk,
    saveData: async (next: Record<string, unknown>) => {
      onDisk = { ...next };
    },
  });
  return { plugin, read: () => onDisk as Record<string, unknown> };
}

describe("a stored atom folder that cannot work (#501)", () => {
  it("repairs a dot-folder on load, so every surface agrees where atoms are", async () => {
    const { plugin } = pluginWithStoredSettings({ atomFolder: ".hidden" });

    await plugin.loadSettings();

    expect(plugin.settings.atomFolder).toBe("Atoms");
  });

  it("repairs a folder name no filesystem will take", async () => {
    const { plugin } = pluginWithStoredSettings({
      atomFolder: "L".repeat(300),
    });

    await plugin.loadSettings();

    expect(plugin.settings.atomFolder).toBe("Atoms");
  });

  /**
   * In memory alone this is not a repair. `data.json` syncs, so a device that only fixed its own
   * copy keeps receiving the broken name from every other device and re-clamps it on every load
   * forever, and any surface that re-merges the file reads the bad value again. Both the
   * cross-model review and the live drive caught this: after a reload the setting read `Atoms`
   * while the file on disk still said `.hidden`.
   */
  it("writes the repair to disk, so it does not have to happen again", async () => {
    const { plugin, read } = pluginWithStoredSettings({ atomFolder: ".hidden" });

    await plugin.loadSettings();

    expect(read().atomFolder).toBe("Atoms");
  });

  it("leaves a folder that works exactly as the user set it", async () => {
    const { plugin, read } = pluginWithStoredSettings({
      atomFolder: "Second Brain",
    });

    await plugin.loadSettings();

    expect(plugin.settings.atomFolder).toBe("Second Brain");
    // And no gratuitous rewrite of a file that was already right.
    expect(read().atomFolder).toBe("Second Brain");
  });
});
