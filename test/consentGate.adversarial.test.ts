/**
 * Adversarial break-it pass on the device-local egress consent gate.
 *
 * Written by the adversarial-qa pass. Most cases are attacks that held on the first build; the
 * lifecycle and scroll blocks at the bottom are regression guards for holes it proved, each of
 * which failed before the fix that now carries it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./mocks/obsidian";
import {
  flip,
  press,
  pressSheet,
  row,
  rowNames,
  settingTab,
  sheet,
  sheetOpen,
} from "./helpers/settingsTab";
import {
  EGRESS_ACK_VERSION,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  egressAckIsCurrent,
  readDeviceAutoRunState,
  readEgressAckVersion,
  readEgressPermitted,
  shouldRunAutoProcess,
} from "../src/platform/autorun";
import { LS_EGRESS_NOTICE } from "../src/platform/resume";
import { AtomsHomeView } from "../src/home/atomsHomeView";

afterEach(() => {
  for (const open of [...Modal.open]) open.close();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const AUTO_ROW = "File automatically when Obsidian opens";
const ACK_ROW = "What Atoms sends to Anthropic";

/** Every button on the open sheet carrying this label — a double-fire needs the same element. */
function sheetButton(label: string): HTMLButtonElement {
  const found = Array.from(sheet().contentEl.querySelectorAll("button")).find(
    (el) => el.textContent === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button ${label}`);
  return found;
}

describe("adversarial: sheet double-settle", () => {
  it("writes one ack for two rapid taps on I understand", async () => {
    const { tab, local } = settingTab();
    tab.display();
    flip(tab, AUTO_ROW);
    await flush();

    const btn = sheetButton("I understand");
    btn.click();
    btn.click();
    await flush();

    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
    expect(sheetOpen()).toBe(false);
  });

  it("lets Cancel win over an I understand pressed a beat later", async () => {
    const { tab, local } = settingTab();
    tab.display();
    flip(tab, AUTO_ROW);
    await flush();

    const cancel = sheetButton("Cancel");
    const accept = sheetButton("I understand");
    cancel.click();
    // The sheet is gone but the detached button still carries its handler — an impatient second
    // tap lands on it.
    accept.click();
    await flush();

    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
    expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
  });

  it("withdraws once for two taps on Withdraw acknowledgment", async () => {
    const { tab, local } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_EGRESS_NOTICE]: true,
      },
    });
    tab.display();
    press(tab, ACK_ROW, "Review");
    const withdraw = sheetButton("Withdraw acknowledgment");
    withdraw.click();
    withdraw.click();
    await flush();

    const load = (k: string) => local.get(k) ?? null;
    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    expect(rowNames(tab)).not.toContain(ACK_ROW);
  });
});

describe("adversarial: re-entry", () => {
  it("lets Close win over a Withdraw pressed a beat later", async () => {
    const { tab, local } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        [LS_AUTO_RUN_ENABLED]: true,
      },
    });
    tab.display();
    press(tab, ACK_ROW, "Review");
    const close = sheetButton("Close");
    const withdraw = sheetButton("Withdraw acknowledgment");
    close.click();
    withdraw.click();
    await flush();

    // Closing a review leaves the record alone; the late tap must not revoke it either.
    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
  });

  it("survives a Review handler fired again after the row it belonged to is gone", async () => {
    const { tab, local } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_EGRESS_NOTICE]: true,
      },
    });
    tab.display();
    const stale = Array.from(row(tab, ACK_ROW).querySelectorAll("button")).find(
      (el) => el.textContent === "Review",
    );
    if (!stale) throw new Error("no Review button");

    press(tab, ACK_ROW, "Review");
    pressSheet("Withdraw acknowledgment");
    await flush();
    expect(rowNames(tab)).not.toContain(ACK_ROW);

    // The row is gone from the screen; its button is not gone from the user's finger.
    stale.click();
    await flush();
    if (sheetOpen()) pressSheet("Withdraw acknowledgment");
    await flush();

    const load = (k: string) => local.get(k) ?? null;
    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    expect(rowNames(tab)).not.toContain(ACK_ROW);
  });

  it("closes Settings on an open egress sheet without granting", async () => {
    const { tab, local } = settingTab();
    tab.display();
    flip(tab, AUTO_ROW);
    await flush();
    expect(sheetOpen()).toBe(true);

    tab.hide();
    await flush();

    expect(sheetOpen()).toBe(false);
    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
    expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
  });

  it("keeps the three keys consistent across three enable/withdraw cycles", async () => {
    const { tab, local } = settingTab();
    tab.display();
    const load = (k: string) => local.get(k) ?? null;

    for (let cycle = 0; cycle < 3; cycle += 1) {
      flip(tab, AUTO_ROW);
      await flush();
      pressSheet("I understand");
      await flush();

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
      expect(readEgressPermitted(load, { catchUp: true })).toBe(true);
      expect(rowNames(tab)).toContain(ACK_ROW);

      press(tab, ACK_ROW, "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
      expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
      expect(rowNames(tab)).not.toContain(ACK_ROW);
    }
  });

  it("re-enables without re-posing the sheet while the ack still stands", async () => {
    const { tab, local } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        [LS_AUTO_RUN_ENABLED]: true,
      },
    });
    tab.display();

    // Off, then on again. The ack survives the round trip and the second enable asks nothing.
    flip(tab, AUTO_ROW);
    await flush();
    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(false);
    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
    expect(rowNames(tab)).toContain(ACK_ROW);

    flip(tab, AUTO_ROW);
    await flush();
    expect(sheetOpen()).toBe(false);
    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
  });
});

describe("adversarial: notice interactions", () => {
  it("clears a notice that arrived while the enable sheet was already open", async () => {
    const { tab, local } = settingTab();
    tab.display();
    flip(tab, AUTO_ROW);
    await flush();

    // Another surface grants the catch-up notice under the open sheet.
    local.set(LS_EGRESS_NOTICE, true);
    pressSheet("I understand");
    await flush();

    const load = (k: string) => local.get(k) ?? null;
    expect(readEgressPermitted(load, { catchUp: true })).toBe(true);

    press(tab, ACK_ROW, "Review");
    pressSheet("Withdraw acknowledgment");
    await flush();

    // The withdrawal has to reach the grant it never saw arrive.
    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    expect(readEgressPermitted(load, { catchUp: false })).toBe(false);
  });
});

describe("adversarial: version boundary", () => {
  it("treats an unknown future stamp as unacknowledged, with no row when nothing else grants", () => {
    const { tab, local } = settingTab({
      local: { [LS_AUTO_RUN_EGRESS_ACK]: "2027-01-01", [LS_AUTO_RUN_ENABLED]: true },
    });
    tab.display();
    const load = (k: string) => local.get(k) ?? null;

    expect(readDeviceAutoRunState(load).egressAcked).toBe(false);
    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    expect(rowNames(tab)).not.toContain(ACK_ROW);
    expect(row(tab, AUTO_ROW).querySelector(".is-enabled")).toBeNull();
  });

  it("still reaches the withdrawal for a future stamp once a notice grants", () => {
    const { tab, local } = settingTab({
      local: { [LS_AUTO_RUN_EGRESS_ACK]: "2027-01-01", [LS_EGRESS_NOTICE]: true },
    });
    tab.display();
    const load = (k: string) => local.get(k) ?? null;

    expect(rowNames(tab)).toContain(ACK_ROW);
    press(tab, ACK_ROW, "Review");
    pressSheet("Withdraw acknowledgment");

    // Total: the withdrawal clears the future stamp too, not just the notice.
    expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe("2027-01-01");
    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
  });

  it("reads every degenerate ack value as unacknowledged", () => {
    const junk: unknown[] = [
      "",
      "   ",
      0,
      1,
      [],
      {},
      true,
      false,
      null,
      "2026-08-05",
      "2026-08-07",
      "x".repeat(10000),
      `${EGRESS_ACK_VERSION}x`,
    ];
    for (const value of junk) {
      const load = () => value;
      expect(readDeviceAutoRunState(load).egressAcked).toBe(false);
      expect(readEgressPermitted(load, { catchUp: false })).toBe(false);
    }
    // Whitespace around the shipped stamp is the same consent, deliberately.
    expect(egressAckIsCurrent(readEgressAckVersion(() => ` ${EGRESS_ACK_VERSION}\n`))).toBe(true);
  });

  it("does not run unattended when enabled is on but nothing granted", () => {
    const local = new Map<string, unknown>([[LS_AUTO_RUN_ENABLED, true]]);
    const load = (k: string) => local.get(k) ?? null;
    const state = readDeviceAutoRunState(load);

    expect(state.enabled).toBe(true);
    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    expect(
      shouldRunAutoProcess({
        enabled: state.enabled,
        lastRunDay: null,
        today: "2026-08-06",
        egressAcked: readEgressPermitted(load, { catchUp: true }),
        pastUnprocessedRemaining: 5,
      }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * PROVEN HOLE — settling a sheet on the way into a destination leaves the
 * declined screen's scroll position queued, and it lands on the destination.
 * `openRoute()` closes the sheet first; the decline's `redisplay()` schedules
 * rAF + setTimeout restores of the *old* screen's scrollTop, then openRoute
 * sets 0 synchronously — and the queued restores win.
 * ------------------------------------------------------------------ */
describe("adversarial: destination scroll after a settled sheet", () => {
  it("starts the destination at the top even when a sheet was settled on the way in", async () => {
    const { tab, scroller } = settingTab();
    tab.display();
    scroller.scrollTop = 420;

    flip(tab, AUTO_ROW);
    await flush();
    expect(sheetOpen()).toBe(true);

    (await import("./helpers/settingsTab")).open(tab, "Advanced");
    expect(scroller.scrollTop).toBe(0);

    // The decline's deferred scroll restores land here.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(scroller.scrollTop).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * PROVEN HOLE — home's consent sheet outlives the view that posed it.
 * Settings settles an open sheet in openRoute(), hide(), and presentConsent();
 * home's `confirmEnableAutomaticFiling` keeps no handle at all, so the sheet
 * survives the leaf being detached — and the plugin being disabled — and its
 * accept still writes the ack and turns paid unattended filing on.
 * Proposed fix: hold the sheet on the view and close it from onClose().
 * ------------------------------------------------------------------ */
describe("adversarial: home consent lifecycle", () => {
  /** The same two-field stub test/helpers/homeView.ts drives, plus the onClose fields. */
  function homeStub(onEnable: () => void) {
    const view = Object.create(AtomsHomeView.prototype) as {
      app: unknown;
      plugin: unknown;
      rootEl: unknown;
      refreshTimer: number | null;
      confirmEnableAutomaticFiling(): void;
      onClose(): Promise<void>;
    };
    view.app = {};
    view.rootEl = document.createElement("div");
    view.refreshTimer = null;
    view.plugin = {
      enableAutomaticFilingFromHome: async () => {
        onEnable();
      },
    };
    return view;
  }

  it("settles the sheet when the home leaf closes underneath it", async () => {
    const enabled: string[] = [];
    const view = homeStub(() => enabled.push("enabled"));
    view.confirmEnableAutomaticFiling();
    expect(sheetOpen()).toBe(true);

    await view.onClose();

    expect(sheetOpen()).toBe(false);
    expect(enabled).toEqual([]);
  });

  it("does not grant from a sheet whose home view is already gone", async () => {
    const enabled: string[] = [];
    const view = homeStub(() => enabled.push("enabled"));
    view.confirmEnableAutomaticFiling();

    await view.onClose();
    if (sheetOpen()) pressSheet("I understand");
    await flush();

    expect(enabled).toEqual([]);
  });

  it("cannot reverse a withdrawal the user made in Settings in front of it", async () => {
    // The worst shape of the lifecycle hole: a home sheet still on screen while the user opens
    // Settings over it and withdraws. If that sheet survives, accepting it afterwards silently
    // re-grants the consent they just took back — a paid path reopened by a stale click target.
    const { tab, local } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        [LS_AUTO_RUN_ENABLED]: true,
      },
    });
    tab.display();
    const load = (k: string) => local.get(k) ?? null;

    const enabled: string[] = [];
    const view = homeStub(() => enabled.push("enabled"));
    view.confirmEnableAutomaticFiling();
    expect(Modal.open.length).toBe(1);

    press(tab, ACK_ROW, "Review");
    // One sheet at a time: posing the Review settles home's, so there is no second target left.
    expect(Modal.open.length).toBe(1);
    pressSheet("Withdraw acknowledgment");
    await flush();

    expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    expect(sheetOpen()).toBe(false);
    expect(enabled).toEqual([]);
  });
});

describe("adversarial: which wording the stranded record names", () => {
  it("says 'earlier' for the upgrade case, where the grant named no wording at all", () => {
    const { tab } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: true,
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_EGRESS_NOTICE]: true,
      },
    });
    tab.display();

    expect(row(tab, ACK_ROW).textContent).toContain("against earlier wording");
  });

  it("says 'different' for the downgrade case, where the stamp names later wording", () => {
    const { tab } = settingTab({
      local: {
        [LS_AUTO_RUN_EGRESS_ACK]: "2027-01-01",
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_EGRESS_NOTICE]: true,
      },
    });
    tab.display();

    const desc = row(tab, ACK_ROW).textContent ?? "";
    expect(desc).toContain("against different wording");
    expect(desc).not.toContain("against earlier wording");
  });
});
