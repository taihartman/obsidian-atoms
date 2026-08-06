/**
 * U3 — the Atoms home "turn on automatic filing" prompt *is* the settings egress sheet.
 *
 * Home and Settings write the same device-local ack, so a consent granted from home has to be
 * the same disclosure, in the same chrome. The seam is `egressConsentSpec`: one place where the
 * egress title and disclosure are paired, which both surfaces build their sheet from.
 *
 * The home half goes through `raiseHomeConsent` (test/helpers/homeView.ts), which explains the
 * two-field prototype stub it drives the confirm with.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./mocks/obsidian";
import { dismissSheet, pressSheet, sheet, sheetOpen, sheetText } from "./helpers/settingsTab";
import {
  ConsentSheetModal,
  EGRESS_ACK_TITLE,
  EGRESS_DISCLOSURE,
  egressConsentSpec,
  type ConsentVerdict,
} from "../src/settings/consent";
import { raiseHomeConsent } from "./helpers/homeView";

afterEach(() => {
  for (const open of [...Modal.open]) open.close();
});

/** Buttons on the open sheet, in render order — the labels a reader chooses between. */
function sheetButtons(): string[] {
  return Array.from(sheet().contentEl.querySelectorAll("button")).map(
    (el) => el.textContent ?? "",
  );
}

/** Home's confirm. Returns the log of enables, which is the device-local ack write in disguise. */
function openHomeConsent(): string[] {
  const enabled: string[] = [];
  raiseHomeConsent(() => enabled.push("enabled"));
  return enabled;
}

describe("egressConsentSpec", () => {
  it("pairs the egress title with the egress disclosure", () => {
    const spec = egressConsentSpec(() => {});
    expect(spec.title).toBe(EGRESS_ACK_TITLE);
    expect(spec.disclosure).toBe(EGRESS_DISCLOSURE);
    // Enabling is not reviewing: an unset `granted` is what makes the sheet offer accept.
    expect(spec.granted).toBeUndefined();
  });

  it("carries the review record when one is passed, without a second copy of the words", () => {
    const spec = egressConsentSpec(() => {}, "Acknowledged on this device.");
    expect(spec.granted).toBe("Acknowledged on this device.");
    expect(spec.title).toBe(EGRESS_ACK_TITLE);
    expect(spec.disclosure).toBe(EGRESS_DISCLOSURE);
  });

  it("hands every verdict back to its caller", () => {
    const seen: ConsentVerdict[] = [];
    const spec = egressConsentSpec((verdict) => seen.push(verdict));
    spec.onVerdict("accepted");
    spec.onVerdict("withdrawn");
    expect(seen).toEqual(["accepted", "withdrawn"]);
  });

  it("builds a sheet that says the disclosure it names", () => {
    new ConsentSheetModal({} as never, egressConsentSpec(() => {})).open();
    expect(sheetText()).toContain(EGRESS_ACK_TITLE);
    expect(sheetText()).toContain(EGRESS_DISCLOSURE);
  });
});

describe("Atoms home — enable automatic filing", () => {
  it("opens the shared egress sheet, wording and chrome unchanged", () => {
    openHomeConsent();
    expect(sheetText()).toContain(EGRESS_ACK_TITLE);
    expect(sheetText()).toContain(EGRESS_DISCLOSURE);
    // The shared chrome's labels, not home's old "Enable".
    expect(sheetButtons()).toEqual(["Cancel", "I understand"]);
    expect(sheetText()).not.toContain("Automatic filing");
  });

  it("enables only on an explicit accept", () => {
    const enabled = openHomeConsent();
    pressSheet("I understand");
    expect(enabled).toEqual(["enabled"]);
    expect(sheetOpen()).toBe(false);
  });

  it("writes nothing when the sheet is cancelled", () => {
    const enabled = openHomeConsent();
    pressSheet("Cancel");
    expect(enabled).toEqual([]);
    expect(sheetOpen()).toBe(false);
  });

  it("writes nothing when the sheet is dismissed — Escape, or a click outside", () => {
    const enabled = openHomeConsent();
    dismissSheet();
    expect(enabled).toEqual([]);
  });
});
