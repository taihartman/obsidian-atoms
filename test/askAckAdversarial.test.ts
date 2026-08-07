/**
 * #360 adversarial — a chaos user trying to make the two versioned Ask acks fall over.
 *
 * Everything here is an *attack*, not a spec confirmation. A test that passes is a hole that
 * was already shut; a test that fails is a hole this build actually has. Read the failures,
 * not the count.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";
import { AskCoordinator } from "../src/plugin/askCoordinator";
import { runAskOutboxApply, type AskOutboxHost } from "../src/plugin/catchUp";
import {
  ASK_PRIVACY_ACK_VERSION,
  ASK_WRITE_ACK_VERSION,
  askAckStanding,
  askPrivacyAckIsCurrent,
  askWriteAckIsCurrent,
} from "../src/shared/askAck";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../src/shared/types";
import type { PlusSession } from "../src/platform/filingAuth";
import { Modal } from "./mocks/obsidian";
import { flip, press, row, settingTab, sheet, sheetOpen } from "./helpers/settingsTab";

afterEach(() => {
  for (const open of [...Modal.open]) open.close();
  vi.useRealTimers();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const AT = "2026-08-01T10:00:00.000Z";
const ASK_MIRROR_ROW = "Ask mirror";
const ASK_WRITE_ROW = "Allow filing from Claude or ChatGPT";

const SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "user@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
};

const CURRENT_PRIVACY = {
  askPrivacyAckAt: AT,
  askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
  askEnabled: true,
} as const;

const CURRENT_WRITE = {
  askWriteAckAt: AT,
  askWriteAckVersion: ASK_WRITE_ACK_VERSION,
} as const;

function askTab(settings: Partial<LinkerSettings> = {}) {
  const made = settingTab({ session: SESSION, settings });
  made.tab.display();
  return made;
}

/** The sheet's button node, grabbed while it is still on screen. */
function sheetButton(label: string): HTMLButtonElement {
  const button = Array.from(sheet().contentEl.querySelectorAll("button")).find(
    (el) => el.textContent === label,
  );
  if (!button) throw new Error(`open sheet has no button labelled ${label}`);
  return button as HTMLButtonElement;
}

// ---------------------------------------------------------------------------
// 1. Resurrection — a sheet that outlived the consent it was posed about.
// ---------------------------------------------------------------------------

describe("adversarial: a consent sheet that outlives a withdrawal", () => {
  it("cannot resurrect a privacy ack withdrawn on another device while the sheet was up", async () => {
    const { tab, plugin } = askTab({ askEnabled: false });
    flip(tab, ASK_MIRROR_ROW);
    expect(sheetOpen()).toBe(true);
    // Hold the node the user's finger is already over.
    const understand = sheetButton("I understand");

    // Sync lands the phone's withdrawal underneath the open sheet.
    plugin.settings.askPrivacyAckAt = "";
    plugin.settings.askPrivacyAckVersion = "";
    plugin.settings.askEnabled = false;
    tab.refreshFromExternalSettings();

    understand.click();
    await flush();

    expect(plugin.settings.askPrivacyAckAt).toBe("");
    expect(plugin.settings.askPrivacyAckVersion).toBe("");
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(false);
    expect(plugin.settings.askEnabled).toBe(false);
  });

  it("cannot resurrect it through the whole plugin path either (onExternalSettingsChange)", async () => {
    let onDisk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      askEnabled: false,
      askPrivacyAckAt: "",
      askPrivacyAckVersion: "",
    };
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      loadData: async () => ({ ...onDisk }),
      saveData: async (next: Record<string, unknown>) => {
        onDisk = { ...next };
      },
    });
    await plugin.loadSettings();

    const { tab } = settingTab({ session: SESSION, settings: plugin.settings });
    // The tab double carries its own settings object; point both at the plugin's.
    Object.assign(tab as unknown as { plugin: unknown }, {});
    tab.display();
    // Register the tab the way display() does on the real plugin.
    plugin.settingTab = tab;

    // Nothing to assert about the tab's own copy here — this case is about the plugin
    // reaching the tab at all when a withdrawal arrives.
    onDisk = { ...onDisk, askPrivacyAckAt: "", askPrivacyAckVersion: "", askEnabled: false };
    await plugin.onExternalSettingsChange();
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Narrower consent granted on top of a broader one that is gone.
// ---------------------------------------------------------------------------

describe("adversarial: the write ack on top of a privacy ack that vanished", () => {
  it("does not grant the write ack when privacy is withdrawn under the open write sheet", async () => {
    const { tab, plugin } = askTab({ ...CURRENT_PRIVACY });
    flip(tab, ASK_WRITE_ROW);
    expect(sheetOpen()).toBe(true);
    const understand = sheetButton("I understand");

    // The broader consent goes away underneath the narrower sheet.
    plugin.settings.askPrivacyAckAt = "";
    plugin.settings.askPrivacyAckVersion = "";
    plugin.settings.askEnabled = false;
    tab.refreshFromExternalSettings();

    understand.click();
    await flush();

    expect(plugin.settings.askWriteAckAt).toBe("");
    expect(plugin.settings.askWriteAckVersion).toBe("");
    expect(askWriteAckIsCurrent(plugin.settings)).toBe(false);
  });

  /**
   * The same shape without the settle: the verdict handler itself, asked to grant while the
   * broader consent is gone. `setAskWriteAck(true)` re-checks only its *own* ack after the
   * save; the privacy precondition is checked before the sheet opens and never again.
   */
  it("re-checks the privacy precondition at the moment of grant, not only before the sheet", async () => {
    const { tab, plugin } = askTab({ ...CURRENT_PRIVACY });
    flip(tab, ASK_WRITE_ROW);
    const open = sheet();
    const spec = (open as unknown as { spec: { onVerdict: (v: string) => void } }).spec;

    // Privacy is gone by the time the verdict is delivered — the state any settle race,
    // or a future caller that forgets to settle, would leave behind.
    plugin.settings.askPrivacyAckAt = "";
    plugin.settings.askPrivacyAckVersion = "";
    spec.onVerdict("accepted");
    await flush();

    expect(
      askWriteAckIsCurrent(plugin.settings),
      "write ack granted on top of a privacy ack that no longer exists",
    ).toBe(false);
  });

  /**
   * The fully reachable shape of the same asymmetry, no sheet timing involved.
   *
   * Withdrawing privacy *in Settings* also clears the write ack — `renderAskPrivacyAckRecord`
   * says so in as many words: "the narrower ack cannot outlive the one it was granted on top
   * of." Withdrawing privacy on **another device** goes through `applyLoadedSettings` /
   * `adoptExternalWithdrawal`, and neither enforces that pairing. So the write ack survives a
   * privacy withdrawal it should not have, and the next privacy grant re-opens the write gate
   * without ever posing the write disclosure again.
   */
  it("does not leave the write ack standing when privacy is withdrawn from another device", async () => {
    let onDisk: Record<string, unknown> = {
      askEnabled: true,
      askPrivacyAckAt: AT,
      askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
      askWriteAckAt: AT,
      askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    };
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      loadData: async () => ({ ...onDisk }),
      saveData: async (next: Record<string, unknown>) => {
        onDisk = { ...next };
      },
    });
    await plugin.loadSettings();

    // The phone withdraws the broader consent only.
    onDisk = { ...onDisk, askEnabled: false, askPrivacyAckAt: "", askPrivacyAckVersion: "" };
    await plugin.onExternalSettingsChange();

    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(false);
    expect(
      askWriteAckIsCurrent(plugin.settings),
      "the write ack outlived the privacy ack it was granted on top of",
    ).toBe(false);
  });

  /**
   * The #360-native shape, needing no second device at all: the next time
   * `ASK_PRIVACY_ACK_VERSION` moves — which the constant's own doc-comment instructs — every
   * device holds a **stale privacy ack and a current write ack**. Re-reading the new privacy
   * disclosure is the whole point of the bump, and it re-opens the write gate on the spot,
   * under a write consent granted against the privacy wording that was just superseded.
   */
  it("does not re-open the write gate on the privacy re-prompt after a version bump", async () => {
    const { tab, plugin } = askTab({
      askEnabled: true,
      askPrivacyAckAt: AT,
      // What every device carries the moment the privacy version is bumped.
      askPrivacyAckVersion: "2026-07-01",
      ...CURRENT_WRITE,
    });
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(false);
    expect(askWriteAckIsCurrent(plugin.settings)).toBe(true);

    flip(tab, ASK_MIRROR_ROW);
    sheetButton("I understand").click();
    await flush();

    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(true);
    expect(
      askWriteAckIsCurrent(plugin.settings),
      "the write ack outlived the privacy wording it was granted on top of",
    ).toBe(false);
  });

  it("re-granting privacy does not silently re-open the write gate", async () => {
    // The state the test above leaves behind: privacy gone, write ack still current.
    const { tab, plugin } = askTab({
      askEnabled: false,
      askPrivacyAckAt: "",
      askPrivacyAckVersion: "",
      ...CURRENT_WRITE,
    });
    flip(tab, ASK_MIRROR_ROW);
    sheetButton("I understand").click();
    await flush();

    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(true);
    expect(
      askWriteAckIsCurrent(plugin.settings),
      "filing from Claude/ChatGPT resumed without the write disclosure being posed again",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Double-fire.
// ---------------------------------------------------------------------------

describe("adversarial: double-fire", () => {
  it("writes one grant, not two, when I understand is hammered", async () => {
    const { tab, plugin } = askTab({ askEnabled: false });
    flip(tab, ASK_MIRROR_ROW);
    const understand = sheetButton("I understand");
    understand.click();
    const first = plugin.settings.askPrivacyAckAt;
    understand.click();
    understand.click();
    await flush();
    expect(plugin.settings.askPrivacyAckAt).toBe(first);
    expect(Modal.open.length).toBe(0);
  });

  it("never stacks two sheets when the mirror toggle is double-tapped", async () => {
    const { tab } = askTab({ askEnabled: false });
    flip(tab, ASK_MIRROR_ROW);
    expect(Modal.open.length).toBe(1);
    // The re-render the first sheet's decline queues has replaced the row; flip the new one.
    flip(tab, ASK_MIRROR_ROW);
    expect(Modal.open.length).toBe(1);
    flip(tab, ASK_MIRROR_ROW);
    expect(Modal.open.length).toBe(1);
  });

  it("does not double-withdraw into a half-written record", async () => {
    const { tab, plugin } = askTab({ ...CURRENT_PRIVACY, ...CURRENT_WRITE });
    press(tab, "What Ask stores and shares", "Review");
    const withdraw = sheetButton("Withdraw acknowledgment");
    withdraw.click();
    withdraw.click();
    await flush();
    expect(plugin.settings.askPrivacyAckAt).toBe("");
    expect(plugin.settings.askPrivacyAckVersion).toBe("");
    expect(plugin.settings.askWriteAckAt).toBe("");
    expect(plugin.settings.askWriteAckVersion).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. Dangling review row.
// ---------------------------------------------------------------------------

describe("adversarial: the review row after its record is gone", () => {
  it("removes the privacy record row once withdrawn, leaving nothing to press", async () => {
    const { tab } = askTab({ ...CURRENT_PRIVACY, ...CURRENT_WRITE });
    press(tab, "What Ask stores and shares", "Review");
    sheetButton("Withdraw acknowledgment").click();
    await flush();
    expect(() => row(tab, "What Ask stores and shares")).toThrow();
    expect(() => row(tab, "Vault write acknowledgment")).toThrow();
  });

  it("re-pressing a retained Review node cannot re-grant anything", async () => {
    const { tab, plugin } = askTab({ ...CURRENT_PRIVACY, ...CURRENT_WRITE });
    const review = Array.from(
      row(tab, "Vault write acknowledgment").querySelectorAll("button"),
    ).find((el) => el.textContent === "Review") as HTMLButtonElement;
    review.click();
    sheetButton("Withdraw acknowledgment").click();
    await flush();
    // The detached node from the pre-withdrawal render, pressed again.
    review.click();
    await flush();
    expect(plugin.settings.askWriteAckAt).toBe("");
    expect(plugin.settings.askWriteAckVersion).toBe("");
    // The ghost sheet it poses is a review, so it can only offer withdrawal — never a grant.
    if (sheetOpen()) {
      const labels = Array.from(sheet().contentEl.querySelectorAll("button")).map(
        (el) => el.textContent,
      );
      expect(labels).not.toContain("I understand");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Withdraw mid-flight.
// ---------------------------------------------------------------------------

describe("adversarial: a withdrawal landing inside an in-flight pass", () => {
  it("does not push after a withdrawal lands inside setAskMirrorEnabled's save", async () => {
    let release = () => {};
    const saving = new Promise<void>((r) => {
      release = r;
    });
    const { tab, plugin, calls } = (() => {
      const made = settingTab({
        session: SESSION,
        settings: { askEnabled: false },
        plugin: { saveSettings: () => saving },
      });
      made.tab.display();
      return made;
    })();
    flip(tab, ASK_MIRROR_ROW);
    sheetButton("I understand").click();
    // The save is in flight. Sync lands the withdrawal now.
    plugin.settings.askPrivacyAckAt = "";
    plugin.settings.askPrivacyAckVersion = "";
    plugin.settings.askEnabled = false;
    release();
    await flush();
    expect(calls).not.toContain("syncAskMirror");
  });

  /**
   * `AskCoordinator.applyOutbox()` checks the write ack once and then hands ten round trips to
   * `runAskOutboxApply`, which knows nothing about consent. A withdrawal landing after item one
   * therefore does not stop the pass — items two through ten still create files in the vault.
   */
  it("stops creating files when the write ack is withdrawn between outbox items", async () => {
    const settings: LinkerSettings = {
      ...DEFAULT_SETTINGS,
      ...CURRENT_PRIVACY,
      ...CURRENT_WRITE,
    };
    const created: string[] = [];
    let pulled = 0;
    const host: AskOutboxHost = {
      beginPass: () => true,
      endPass: () => {},
      pullOne: async () => {
        pulled += 1;
        if (pulled > 3) return null;
        return {
          id: `item-${pulled}`,
          payload: { title: `Atom ${pulled}`, body: "body" },
        } as never;
      },
      ack: async () => {},
      // Wired exactly as `createOutboxHost` wires it: read live off the settings object, so a
      // withdrawal landing between items is visible to the very next one.
      writePermitted: () => askWriteAckIsCurrent(settings),
      applyToVault: async (payload) => {
        // The gate as the product states it: this write is authorized by the write ack.
        expect(
          askWriteAckIsCurrent(settings),
          `wrote "${payload.title}" into the vault after the write ack was withdrawn`,
        ).toBe(true);
        created.push(payload.title);
        // The user presses Withdraw (or Sync lands one) while the pass is between items.
        settings.askWriteAckAt = "";
        settings.askWriteAckVersion = "";
        return { kind: "created", path: `Atoms/${payload.title}.md` } as never;
      },
      syncMirror: async () => ({ kind: "worked", uploaded: 1, deleted: 0 }) as never,
      notice: () => {},
      onLanded: () => {},
    };

    await runAskOutboxApply(host);
    expect(created, "the pass kept writing under a withdrawn consent").toEqual(["Atom 1"]);
  });
});

// ---------------------------------------------------------------------------
// 6. The 60s outbox timer, driven for real.
// ---------------------------------------------------------------------------

describe("adversarial: the registered 60s outbox interval", () => {
  /** A coordinator wired the way onload wires it, with the interval capturable. */
  function lifecycle(settings: Partial<LinkerSettings>) {
    const outboxCalls: number[] = [];
    let layoutReady = () => {};
    const plugin = {
      app: {
        workspace: {
          onLayoutReady: (cb: () => void) => {
            layoutReady = cb;
          },
        },
        vault: { on: () => ({}), getMarkdownFiles: () => [], read: async () => "" },
        metadataCache: { getFirstLinkpathDest: () => null },
        loadLocalStorage: () => null,
        saveLocalStorage: () => undefined,
      },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      registerEvent: () => {},
      registerInterval: () => {},
      refreshAtomsHomeLeaves: async () => undefined,
    };
    const coordinator = new AskCoordinator(plugin as never);
    const original = coordinator.applyOutbox.bind(coordinator);
    coordinator.applyOutbox = async () => {
      outboxCalls.push(Date.now());
      return original();
    };
    return { coordinator, plugin, outboxCalls, fireLayoutReady: () => layoutReady() };
  }

  it("spends nothing on an orphaned write version when the timer fires unattended", async () => {
    vi.useFakeTimers();
    const { coordinator, outboxCalls } = lifecycle({
      ...CURRENT_PRIVACY,
      askWriteAckAt: "",
      askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    });
    coordinator.registerLifecycle();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outboxCalls.length).toBeGreaterThan(0);
    // The gate is what has to hold; the pass must never reach a host.
    await expect(coordinator.applyOutbox()).resolves.toEqual({
      kind: "worked",
      landed: 0,
      rejected: 0,
    });
  });

  it("still refuses when the privacy half goes stale between two ticks", async () => {
    vi.useFakeTimers();
    const { coordinator, plugin } = lifecycle({ ...CURRENT_PRIVACY, ...CURRENT_WRITE });
    coordinator.registerLifecycle();
    plugin.settings.askPrivacyAckVersion = "2019-01-01";
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(coordinator.applyOutbox()).resolves.toEqual({
      kind: "worked",
      landed: 0,
      rejected: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Write-only skew from an older build, on the F2 race path.
// ---------------------------------------------------------------------------

describe("adversarial: an older device withdrawing only the write ack", () => {
  it("clears the write version on the race path, leaving the privacy grant alone", async () => {
    let onDisk: Record<string, unknown> = {
      askEnabled: true,
      askPrivacyAckAt: AT,
      askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
      askWriteAckAt: AT,
      askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    };
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      loadData: async () => ({ ...onDisk }),
      saveData: async (next: Record<string, unknown>) => {
        onDisk = { ...next };
      },
    });
    await plugin.loadSettings();
    plugin.ask.cancelPendingSync = () => {};

    let releaseRead = () => {};
    const readInFlight = new Promise<void>((r) => {
      releaseRead = r;
    });
    Object.assign(plugin, {
      loadData: async () => {
        await readInFlight;
        // Pre-#360 build: it knows the two timestamps and nothing about versions, and it
        // withdrew only the write ack.
        return { askEnabled: true, askPrivacyAckAt: AT, askWriteAckAt: "" };
      },
    });

    const hook = plugin.onExternalSettingsChange();
    plugin.settings.activeVocabulary = "changed-by-something-else";
    await plugin.saveSettings();
    releaseRead();
    await hook;

    expect(plugin.settings.askWriteAckAt).toBe("");
    expect(plugin.settings.askWriteAckVersion).toBe("");
    expect(askWriteAckIsCurrent(plugin.settings)).toBe(false);
    // The broader ack was not touched — a write withdrawal is not a privacy withdrawal.
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(true);
    expect(plugin.ask.mirrorPermitted()).toBe(true);
    expect(onDisk.askWriteAckVersion).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 8. Enabled off, consent current.
// ---------------------------------------------------------------------------

describe("adversarial: askEnabled off while both acks stay current", () => {
  it("re-enables without re-prompting, and resumes the mirror", async () => {
    const { tab, plugin, calls } = askTab({
      ...CURRENT_PRIVACY,
      ...CURRENT_WRITE,
      askEnabled: false,
    });
    flip(tab, ASK_MIRROR_ROW);
    await flush();
    expect(sheetOpen(), "re-posed a sheet for consent that is genuinely current").toBe(false);
    expect(plugin.settings.askEnabled).toBe(true);
    expect(calls).toContain("syncAskMirror");
  });

  it("arrives that way from another device without clearing either ack", async () => {
    let onDisk: Record<string, unknown> = {
      askEnabled: true,
      askPrivacyAckAt: AT,
      askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
      askWriteAckAt: AT,
      askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    };
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      loadData: async () => ({ ...onDisk }),
      saveData: async (next: Record<string, unknown>) => {
        onDisk = { ...next };
      },
    });
    await plugin.loadSettings();
    onDisk = { ...onDisk, askEnabled: false };
    await plugin.onExternalSettingsChange();

    expect(plugin.settings.askEnabled).toBe(false);
    expect(plugin.ask.mirrorPermitted()).toBe(false);
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(true);
    expect(askWriteAckIsCurrent(plugin.settings)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Degenerate hand-edited data.json values.
// ---------------------------------------------------------------------------

describe("adversarial: degenerate ack values from a hand-edited data.json", () => {
  const DEGENERATE_VERSIONS: [string, unknown][] = [
    ["null", null],
    ["zero", 0],
    ["true", true],
    ["whitespace", "   "],
    ["huge", "x".repeat(10_000)],
    ["object", {}],
    ["array", []],
  ];

  for (const [name, value] of DEGENERATE_VERSIONS) {
    it(`never reads a ${name} version as consent, and never throws deciding`, () => {
      const s = {
        ...DEFAULT_SETTINGS,
        askPrivacyAckAt: AT,
        askPrivacyAckVersion: value as string,
      };
      expect(() => askPrivacyAckIsCurrent(s)).not.toThrow();
      expect(askPrivacyAckIsCurrent(s)).toBe(false);
      expect(() => askAckStanding(value as string, ASK_PRIVACY_ACK_VERSION)).not.toThrow();
    });
  }

  const DEGENERATE_TIMESTAMPS: [string, unknown][] = [
    ["null", null],
    ["zero", 0],
    ["true", true],
    ["the string yes", "yes"],
    ["huge", "x".repeat(10_000)],
    ["object", {}],
  ];

  for (const [name, value] of DEGENERATE_TIMESTAMPS) {
    it(`survives a ${name} timestamp while Settings renders`, () => {
      const made = settingTab({
        session: SESSION,
        settings: {
          askEnabled: true,
          askPrivacyAckAt: value as string,
          askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
          askWriteAckAt: value as string,
          askWriteAckVersion: ASK_WRITE_ACK_VERSION,
        },
      });
      // The whole screen, including the rows that withdraw consent, must survive it.
      expect(() => made.tab.display()).not.toThrow();
    });
  }

  it("does not read a non-timestamp as a live privacy grant", () => {
    for (const value of [true, 1, "yes", {}]) {
      const s = {
        ...DEFAULT_SETTINGS,
        askPrivacyAckAt: value as string,
        askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
        askEnabled: true,
      };
      expect(
        askPrivacyAckIsCurrent(s),
        `${JSON.stringify(value)} read as a live consent timestamp`,
      ).toBe(false);
    }
  });

  it("survives a degenerate version while Settings renders", () => {
    for (const value of [0, true, {}]) {
      const made = settingTab({
        session: SESSION,
        settings: {
          askEnabled: true,
          askPrivacyAckAt: AT,
          askPrivacyAckVersion: value as string,
        },
      });
      expect(() => made.tab.display(), `version ${JSON.stringify(value)}`).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Blank / partial external reads.
// ---------------------------------------------------------------------------

describe("adversarial: a blank or partial data.json arriving mid-write", () => {
  function synced(disk: Record<string, unknown>) {
    let onDisk: unknown = { ...disk };
    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      loadData: async () => onDisk,
      saveData: async (next: Record<string, unknown>) => {
        onDisk = { ...next };
      },
    });
    return { plugin, put: (next: unknown) => (onDisk = next) };
  }

  const GRANTED = {
    askEnabled: true,
    askPrivacyAckAt: AT,
    askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
    askWriteAckAt: AT,
    askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    atomFolder: "Second Brain",
    plusBaseUrl: "https://plus.example.test",
  };

  it("keeps the last good copy when the file reads back as null", async () => {
    const { plugin, put } = synced(GRANTED);
    await plugin.loadSettings();
    put(null);
    await plugin.onExternalSettingsChange();
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(true);
  });

  it("does not invent a withdrawal from an empty object", async () => {
    const { plugin, put } = synced(GRANTED);
    await plugin.loadSettings();
    put({});
    await plugin.onExternalSettingsChange();
    expect(
      askPrivacyAckIsCurrent(plugin.settings),
      "an empty read was taken as a withdrawal",
    ).toBe(true);
    expect(plugin.settings.atomFolder, "an empty read reset the atom folder").toBe(
      "Second Brain",
    );
  });

  it("does not reset everything from an array-shaped read", async () => {
    const { plugin, put } = synced(GRANTED);
    await plugin.loadSettings();
    put([]);
    await plugin.onExternalSettingsChange();
    expect(plugin.settings.plusBaseUrl).toBe("https://plus.example.test");
  });

  it("does not silently lose a real withdrawal when the read throws once", async () => {
    const { plugin, put } = synced(GRANTED);
    await plugin.loadSettings();
    Object.assign(plugin, {
      loadData: async () => {
        throw new Error("mid-write");
      },
    });
    await plugin.onExternalSettingsChange();
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(true);

    // The readable file arrives; the withdrawal must still be taken.
    Object.assign(plugin, { loadData: async () => ({ ...GRANTED, askPrivacyAckAt: "", askPrivacyAckVersion: "" }) });
    put({ ...GRANTED, askPrivacyAckAt: "", askPrivacyAckVersion: "" });
    await plugin.onExternalSettingsChange();
    expect(askPrivacyAckIsCurrent(plugin.settings)).toBe(false);
  });
});
