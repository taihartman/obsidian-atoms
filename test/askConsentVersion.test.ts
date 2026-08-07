/**
 * #360 — the two Ask acks record *what* was agreed to, not only *when*.
 *
 * Before this, `askPrivacyAckAt` and `askWriteAckAt` were bare timestamps and every gate read
 * `Boolean(timestamp)`. Rewording a disclosure therefore changed nothing for anyone already
 * acked: the timestamp stayed non-empty, the gate stayed open, and the device went on
 * consenting to text it had never seen. That is #315 one ack over, and the fix is the one
 * `EGRESS_ACK_VERSION` already uses.
 *
 * The load-bearing assertions here are the ones that can only fail if the version is actually
 * consulted — a legacy grant (timestamp set, version empty) must read as **not** consent
 * everywhere, and the frozen-wording block must go red the moment a disclosure is edited
 * without a bump. A suite that only checked "accepting writes a version" would have been green
 * for the whole life of the bug it is guarding.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AskCoordinator } from "../src/plugin/askCoordinator";
import {
  ASK_PRIVACY_ACK_VERSION,
  ASK_WRITE_ACK_VERSION,
  askAckIsCurrent,
  askAckStanding,
  askPrivacyAckIsCurrent,
  askWriteAckIsCurrent,
} from "../src/shared/askAck";
import {
  ASK_PRIVACY_ACK_TITLE,
  ASK_PRIVACY_DISCLOSURE,
  ASK_WRITE_ACK_TITLE,
  ASK_WRITE_DISCLOSURE,
} from "../src/settings/consent";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../src/shared/types";
import type { PlusSession } from "../src/platform/filingAuth";
import { Modal } from "./mocks/obsidian";
import {
  flip,
  press,
  pressSheet,
  row,
  settingTab,
  sheetOpen,
  sheetText,
} from "./helpers/settingsTab";

afterEach(() => {
  for (const open of [...Modal.open]) open.close();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const AT = "2026-08-01T10:00:00.000Z";
const ASK_MIRROR_ROW = "Ask mirror";
const ASK_WRITE_ROW = "Allow filing from Claude or ChatGPT";
const ASK_PRIVACY_ACK_ROW = "What Ask stores and shares";
const ASK_WRITE_ACK_ROW = "Vault write acknowledgment";

const SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "user@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
};

/** A tab with an Atoms Plus session, because the Ask section renders only behind one. */
function askTab(settings: Partial<LinkerSettings> = {}) {
  const made = settingTab({ session: SESSION, settings });
  made.tab.display();
  return made;
}

/** The description the named row actually rendered. */
function rowDesc(tab: Parameters<typeof row>[0], name: string): string {
  return row(tab, name).querySelector(".setting-item-description")?.textContent ?? "";
}

/** Whether the named row's switch is rendered on. */
function isOn(tab: Parameters<typeof row>[0], name: string): boolean {
  return Boolean(row(tab, name).querySelector(".is-enabled"));
}

/** A pre-#360 device: it recorded when someone agreed, and nothing about to what. */
const LEGACY_PRIVACY = {
  askPrivacyAckAt: AT,
  askPrivacyAckVersion: "",
  askEnabled: true,
} as const;

const CURRENT_PRIVACY = {
  askPrivacyAckAt: AT,
  askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
  askEnabled: true,
} as const;

describe("#360 askAckIsCurrent", () => {
  it("treats an empty version as no consent — the legacy grant, and the whole point", () => {
    expect(askAckIsCurrent("", "2026-08-07")).toBe(false);
  });

  it("treats a missing version as no consent", () => {
    expect(askAckIsCurrent(null, "2026-08-07")).toBe(false);
    expect(askAckIsCurrent(undefined, "2026-08-07")).toBe(false);
  });

  it("treats whitespace as no consent, not as a version named ' '", () => {
    expect(askAckIsCurrent("   ", "2026-08-07")).toBe(false);
  });

  it("treats a version this build does not ship as no consent", () => {
    expect(askAckIsCurrent("2026-01-01", "2026-08-07")).toBe(false);
    // A downgrade: the stored stamp is *newer* than what this build shows. Still not consent
    // to the words on screen.
    expect(askAckIsCurrent("2027-01-01", "2026-08-07")).toBe(false);
  });

  it("is consent only for the exact wording this build shows", () => {
    expect(askAckIsCurrent("2026-08-07", "2026-08-07")).toBe(true);
    expect(askAckIsCurrent("  2026-08-07  ", "2026-08-07")).toBe(true);
  });

  it("reads each ack's own field, never the other's", () => {
    // The two constants happen to be the same date today, so a value comparison would pass
    // whichever field each predicate read. These assert the *wiring* instead.
    expect(
      askPrivacyAckIsCurrent({ askPrivacyAckAt: AT, askPrivacyAckVersion: "not-shipped" }),
    ).toBe(false);
    expect(
      askWriteAckIsCurrent({ askWriteAckAt: AT, askWriteAckVersion: "not-shipped" }),
    ).toBe(false);
    expect(
      askPrivacyAckIsCurrent({ askPrivacyAckAt: AT, askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION }),
    ).toBe(true);
    expect(
      askWriteAckIsCurrent({ askWriteAckAt: AT, askWriteAckVersion: ASK_WRITE_ACK_VERSION }),
    ).toBe(true);
  });

  /**
   * The orphaned version: timestamp gone, version standing.
   *
   * Not a state one build can produce — which is exactly why it was missed. The shipping build
   * clears an ack by emptying its timestamp, has never heard of the version field, and round-trips
   * it back to disk untouched. So a withdrawal made on a not-yet-upgraded phone reaches an
   * upgraded desktop looking like this.
   */
  it("is not consent when the timestamp is gone, however current the version", () => {
    expect(
      askPrivacyAckIsCurrent({ askPrivacyAckAt: "", askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION }),
    ).toBe(false);
    expect(
      askWriteAckIsCurrent({ askWriteAckAt: "", askWriteAckVersion: ASK_WRITE_ACK_VERSION }),
    ).toBe(false);
  });

  it("survives a null version rather than taking the Settings render down with it", () => {
    const nulled = null as unknown as string;
    expect(() => askAckStanding(nulled, ASK_PRIVACY_ACK_VERSION)).not.toThrow();
    expect(askAckStanding(nulled, ASK_PRIVACY_ACK_VERSION)).toBe("legacy");
  });

  it("names how a stored stamp is out of step, for the sentence the review row shows", () => {
    expect(askAckStanding("2026-08-07", "2026-08-07")).toBe("current");
    expect(askAckStanding("", "2026-08-07")).toBe("legacy");
    expect(askAckStanding("2026-01-01", "2026-08-07")).toBe("other");
  });

  it("ships a default with no grant on either ack", () => {
    expect(askPrivacyAckIsCurrent(DEFAULT_SETTINGS)).toBe(false);
    expect(askWriteAckIsCurrent(DEFAULT_SETTINGS)).toBe(false);
  });
});

/**
 * Every Ask wording this build has ever asked for consent against, keyed by the stamp devices
 * store — the same guard `egressConsentParity.test.ts` puts on the egress disclosure.
 *
 * This is the half that makes the stamp mean anything. Versioning the ack only helps if
 * changing the words forces the version to move; otherwise a future edit ships new text under
 * the old stamp and every existing device silently keeps a record for wording it never saw.
 * Exact strings, not substrings: a softened clause is precisely the edit that matters.
 *
 * **To change a disclosure:** bump its version in `src/shared/askAck.ts` and add its text here.
 * Never edit an existing entry — it is the record of what those devices actually agreed to.
 *
 * **What this does not catch, stated so nobody over-trusts it:** editing a frozen entry in place
 * alongside the live constant, in one commit, passes. The guard forces a *forgotten* bump, not an
 * honest one; the remaining defence is that both sides of that edit are visible in the same diff.
 * Same limit as `FROZEN_CONSENT` in `egressConsentParity.test.ts`, and the reason
 * `docs/solutions/best-practices/a-golden-value-in-the-same-file-is-defended-only-by-a-comment.md`
 * says to write the limit down rather than imply the map is tamper-proof.
 */
const FROZEN_ASK_PRIVACY: Readonly<Record<string, { title: string; disclosure: string }>> = {
  "2026-08-06": {
    title: "What Ask stores and shares",
    disclosure:
      "(1) only Atoms/ leaves this device; (2) bodies are stored on Atoms Plus servers; (3) the host can decrypt at rest in v1 (not zero-knowledge); (4) when I chat in Claude, Anthropic receives tool results (titles, snippets, bodies); when I chat in ChatGPT, OpenAI receives them; (5) Wipe deletes the cloud mirror, pending outbox writes, and connector tokens; (6) turning Ask off does not wipe.",
  },
};

const FROZEN_ASK_WRITE: Readonly<Record<string, { title: string; disclosure: string }>> = {
  "2026-08-06": {
    title: "Vault write acknowledgment",
    disclosure:
      "Claude or ChatGPT can queue new atom bodies to Atoms Plus, and this vault will write them as new files under my Atoms folder. New files only — existing bodies are never rewritten. This is a separate consent from the Ask privacy acknowledgment, and turning it off stops the writes without touching the mirror.",
  },
};

describe("#360 the ack versions name the wording actually shipped", () => {
  it("pins ASK_PRIVACY_ACK_VERSION to the privacy disclosure this build shows", () => {
    const frozen = FROZEN_ASK_PRIVACY[ASK_PRIVACY_ACK_VERSION];
    expect(
      frozen,
      `ASK_PRIVACY_ACK_VERSION "${ASK_PRIVACY_ACK_VERSION}" has no frozen wording — bump it and add its text to FROZEN_ASK_PRIVACY`,
    ).toBeDefined();
    expect(ASK_PRIVACY_ACK_TITLE).toBe(frozen!.title);
    expect(ASK_PRIVACY_DISCLOSURE).toBe(frozen!.disclosure);
  });

  it("pins ASK_WRITE_ACK_VERSION to the write disclosure this build shows", () => {
    const frozen = FROZEN_ASK_WRITE[ASK_WRITE_ACK_VERSION];
    expect(
      frozen,
      `ASK_WRITE_ACK_VERSION "${ASK_WRITE_ACK_VERSION}" has no frozen wording — bump it and add its text to FROZEN_ASK_WRITE`,
    ).toBeDefined();
    expect(ASK_WRITE_ACK_TITLE).toBe(frozen!.title);
    expect(ASK_WRITE_DISCLOSURE).toBe(frozen!.disclosure);
  });

  it("keeps the two acks on separate levers, so bumping one never re-prompts the other", () => {
    expect(Object.keys(FROZEN_ASK_PRIVACY)).toContain(ASK_PRIVACY_ACK_VERSION);
    expect(Object.keys(FROZEN_ASK_WRITE)).toContain(ASK_WRITE_ACK_VERSION);
  });
});

describe("#360 the mirror gate", () => {
  /** The production gate, on a plugin double holding exactly the ack state under test. */
  function gate(settings: Partial<LinkerSettings>) {
    const plugin = {
      app: {
        vault: { getMarkdownFiles: () => [], read: async () => "" },
        metadataCache: { getFirstLinkpathDest: () => null },
        loadLocalStorage: () => null,
        saveLocalStorage: () => undefined,
      },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      refreshAtomsHomeLeaves: async () => undefined,
    };
    return new AskCoordinator(plugin as never);
  }

  it("stays shut for a legacy grant, so no body leaves under a stale consent", () => {
    expect(gate(LEGACY_PRIVACY).mirrorPermitted()).toBe(false);
  });

  it("stays shut for a version this build does not ship", () => {
    expect(
      gate({ ...LEGACY_PRIVACY, askPrivacyAckVersion: "2026-01-01" }).mirrorPermitted(),
    ).toBe(false);
  });

  it("opens for a grant made against the wording this build shows", () => {
    expect(gate(CURRENT_PRIVACY).mirrorPermitted()).toBe(true);
  });

  /**
   * The state an older-build device on the same synced vault actually writes: it withdrew by
   * clearing the timestamp, and carried the version field it does not understand straight back
   * to disk. A version-only gate opened here, and nothing on screen could have shut it.
   */
  it("stays shut on an orphaned version — withdrawn timestamp, standing stamp", () => {
    expect(
      gate({
        askEnabled: true,
        askPrivacyAckAt: "",
        askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
      }).mirrorPermitted(),
    ).toBe(false);
  });

  it("refuses the outbox on an orphaned write version, which the 60s timer would otherwise spend", async () => {
    const coordinator = gate({
      ...CURRENT_PRIVACY,
      askWriteAckAt: "",
      askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    });
    await expect(coordinator.applyOutbox()).resolves.toEqual({
      kind: "worked",
      landed: 0,
      rejected: 0,
    });
  });

  it("refuses the outbox when the write ack is a legacy grant, mirror or no mirror", async () => {
    const coordinator = gate({
      ...CURRENT_PRIVACY,
      askWriteAckAt: AT,
      askWriteAckVersion: "",
    });
    // `landed: 0, rejected: 0` is the idle shape the gate returns before it reaches a host —
    // nothing was pulled and nothing was written into the vault.
    await expect(coordinator.applyOutbox()).resolves.toEqual({
      kind: "worked",
      landed: 0,
      rejected: 0,
    });
  });
});

describe("#360 Settings, on a device carrying a legacy grant", () => {
  it("shows the mirror off rather than reporting a push that is not happening", () => {
    const { tab } = askTab(LEGACY_PRIVACY);
    expect(isOn(tab, ASK_MIRROR_ROW)).toBe(false);
  });

  it("re-asks the disclosure when the user turns the mirror back on", async () => {
    const { tab } = askTab(LEGACY_PRIVACY);
    flip(tab, ASK_MIRROR_ROW);
    await flush();

    expect(sheetOpen()).toBe(true);
    expect(sheetText()).toContain(ASK_PRIVACY_DISCLOSURE);
  });

  it("stamps the version alongside the timestamp when that sheet is accepted", async () => {
    const { tab } = askTab(LEGACY_PRIVACY);
    flip(tab, ASK_MIRROR_ROW);
    await flush();
    pressSheet("I understand");
    await flush();

    expect(tab.plugin.settings.askPrivacyAckVersion).toBe(ASK_PRIVACY_ACK_VERSION);
    expect(tab.plugin.settings.askPrivacyAckAt).not.toBe("");
    // The re-ack is a fresh decision, so it carries a fresh time — not the stale one it replaced.
    expect(tab.plugin.settings.askPrivacyAckAt).not.toBe(AT);
    expect(tab.plugin.settings.askEnabled).toBe(true);
  });

  it("writes no version when that sheet is declined", async () => {
    const { tab } = askTab(LEGACY_PRIVACY);
    flip(tab, ASK_MIRROR_ROW);
    await flush();
    pressSheet("Cancel");
    await flush();

    expect(tab.plugin.settings.askPrivacyAckVersion).toBe("");
    expect(isOn(tab, ASK_MIRROR_ROW)).toBe(false);
  });

  it("still offers the record and its withdrawal — a stale grant is not an absent one", () => {
    const { tab } = askTab(LEGACY_PRIVACY);
    expect(() => row(tab, ASK_PRIVACY_ACK_ROW)).not.toThrow();
  });

  it("says which wording the record actually names, rather than claiming the current one", () => {
    const { tab } = askTab(LEGACY_PRIVACY);
    expect(rowDesc(tab, ASK_PRIVACY_ACK_ROW)).toBe(
      "Acknowledged 2026-08-01, against earlier wording",
    );
  });

  it("calls an unrecognised stamp different, not earlier — a downgrade names later text", () => {
    const { tab } = askTab({ ...LEGACY_PRIVACY, askPrivacyAckVersion: "2027-01-01" });
    expect(rowDesc(tab, ASK_PRIVACY_ACK_ROW)).toBe(
      "Acknowledged 2026-08-01, against different wording",
    );
  });

  it("says nothing extra once the record names the wording on screen", () => {
    const { tab } = askTab(CURRENT_PRIVACY);
    expect(rowDesc(tab, ASK_PRIVACY_ACK_ROW)).toBe("Acknowledged 2026-08-01");
  });

  it("re-poses the sheet on an orphaned version rather than enabling on a withdrawn record", async () => {
    const { tab } = askTab({
      askEnabled: true,
      askPrivacyAckAt: "",
      askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
    });
    expect(isOn(tab, ASK_MIRROR_ROW)).toBe(false);

    flip(tab, ASK_MIRROR_ROW);
    await flush();

    expect(sheetOpen()).toBe(true);
    expect(sheetText()).toContain(ASK_PRIVACY_DISCLOSURE);
  });

  it("clears the version, not only the timestamp, when the record is withdrawn", async () => {
    const { tab } = askTab({
      ...CURRENT_PRIVACY,
      askWriteAckAt: AT,
      askWriteAckVersion: ASK_WRITE_ACK_VERSION,
    });
    press(tab, ASK_PRIVACY_ACK_ROW, "Review");
    pressSheet("Withdraw acknowledgment");
    await flush();

    expect(tab.plugin.settings.askPrivacyAckAt).toBe("");
    expect(tab.plugin.settings.askPrivacyAckVersion).toBe("");
    // The narrower consent cannot outlive the one it was granted on top of — both halves.
    expect(tab.plugin.settings.askWriteAckAt).toBe("");
    expect(tab.plugin.settings.askWriteAckVersion).toBe("");
  });
});

describe("#360 Settings, the vault-write ack", () => {
  const granted = {
    ...CURRENT_PRIVACY,
    askWriteAckAt: AT,
    askWriteAckVersion: ASK_WRITE_ACK_VERSION,
  } as const;

  it("shows off for a legacy write grant, even with the mirror live", () => {
    const { tab } = askTab({ ...granted, askWriteAckVersion: "" });
    expect(isOn(tab, ASK_WRITE_ROW)).toBe(false);
  });

  it("stays off for a write version this build does not ship", () => {
    const { tab } = askTab({ ...granted, askWriteAckVersion: "2027-01-01" });
    expect(isOn(tab, ASK_WRITE_ROW)).toBe(false);
  });

  // The suffix is wired for both acks; asserting it only on the privacy row would leave the
  // write row's copy free to drift.
  it("names the wording its own record holds, the same three ways the privacy row does", () => {
    expect(rowDesc(askTab(granted).tab, ASK_WRITE_ACK_ROW)).toBe("Acknowledged 2026-08-01");
    expect(
      rowDesc(askTab({ ...granted, askWriteAckVersion: "" }).tab, ASK_WRITE_ACK_ROW),
    ).toBe("Acknowledged 2026-08-01, against earlier wording");
    expect(
      rowDesc(askTab({ ...granted, askWriteAckVersion: "2027-01-01" }).tab, ASK_WRITE_ACK_ROW),
    ).toBe("Acknowledged 2026-08-01, against different wording");
  });

  it("stamps the version when its sheet is accepted", async () => {
    const { tab } = askTab({ ...CURRENT_PRIVACY });
    flip(tab, ASK_WRITE_ROW);
    await flush();
    pressSheet("I understand");
    await flush();

    expect(tab.plugin.settings.askWriteAckVersion).toBe(ASK_WRITE_ACK_VERSION);
    expect(tab.plugin.settings.askWriteAckAt).not.toBe("");
  });

  it("clears the version when its own record is withdrawn, leaving the mirror alone", async () => {
    const { tab } = askTab(granted);
    press(tab, ASK_WRITE_ACK_ROW, "Review");
    pressSheet("Withdraw acknowledgment");
    await flush();

    expect(tab.plugin.settings.askWriteAckAt).toBe("");
    expect(tab.plugin.settings.askWriteAckVersion).toBe("");
    expect(tab.plugin.settings.askPrivacyAckVersion).toBe(ASK_PRIVACY_ACK_VERSION);
    expect(tab.plugin.settings.askEnabled).toBe(true);
  });

  it("clears the version when the mirror is turned off underneath it", async () => {
    const { tab } = askTab(granted);
    flip(tab, ASK_MIRROR_ROW);
    await flush();

    expect(tab.plugin.settings.askEnabled).toBe(false);
    expect(tab.plugin.settings.askWriteAckAt).toBe("");
    expect(tab.plugin.settings.askWriteAckVersion).toBe("");
  });

  it("refuses to be granted on top of a privacy ack that has gone stale", async () => {
    const { tab } = askTab({ ...LEGACY_PRIVACY, askEnabled: true });
    // The row is disabled on a stale privacy ack, so the handler is reached the way a stale
    // screen reaches it: a gesture built before the ack went out of date.
    flip(tab, ASK_WRITE_ROW);
    await flush();

    expect(tab.plugin.settings.askWriteAckVersion).toBe("");
    expect(tab.plugin.settings.askWriteAckAt).toBe("");
  });
});
