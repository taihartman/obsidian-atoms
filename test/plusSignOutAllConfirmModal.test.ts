/**
 * #320 U5 — the consent gesture in front of "Sign out all devices".
 *
 * The cancel path is tested before the confirm path on purpose: the whole point
 * of the modal is the branch that does nothing, and a consent dialog that
 * cannot say no is decoration.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureObsidianUi,
  stopCapturingObsidianUi,
  type UiCapture,
} from "./mocks/obsidian";
import type { ConfirmVerdict } from "../src/shared/confirm";
import {
  PlusSignOutAllConfirmModal,
  signOutAllConfirmCopy,
} from "../src/settings/plusSignOutAllConfirmModal";

let ui: UiCapture;

beforeEach(() => {
  ui = captureObsidianUi();
  return () => stopCapturingObsidianUi();
});

function openConfirm(email = "a@b.co"): {
  verdicts: ConfirmVerdict[];
  modal: PlusSignOutAllConfirmModal;
} {
  const verdicts: ConfirmVerdict[] = [];
  const modal = new PlusSignOutAllConfirmModal({} as never, email, (v) =>
    verdicts.push(v),
  );
  modal.open();
  return { verdicts, modal };
}

const press = (label: string) =>
  ui.buttons.find((b) => b.text === label)?.click();

describe("PlusSignOutAllConfirmModal — saying no", () => {
  it("cancelling records declined", () => {
    const copy = signOutAllConfirmCopy();
    const { verdicts } = openConfirm();
    press(copy.declineLabel);
    expect(verdicts).toEqual(["declined"]);
  });

  it("closing without choosing records dismissed", () => {
    const { verdicts, modal } = openConfirm();
    modal.onClose();
    expect(verdicts).toEqual(["dismissed"]);
  });

  it("the latch holds — answering twice reports once", () => {
    const copy = signOutAllConfirmCopy();
    const { verdicts, modal } = openConfirm();
    press(copy.confirmLabel);
    modal.onClose();
    press(copy.declineLabel);
    expect(verdicts).toEqual(["confirmed"]);
  });
});

describe("PlusSignOutAllConfirmModal — copy", () => {
  it("says this device signs out too (KTD2)", () => {
    const copy = signOutAllConfirmCopy();
    expect(copy.thisDevice).toMatch(/this device is signed out too/i);
    expect(copy.lines).toContain(copy.thisDevice);
  });

  it("says connected apps are disconnected (R10)", () => {
    const copy = signOutAllConfirmCopy();
    expect(copy.connectedApps).toMatch(/connected apps are disconnected/i);
    expect(copy.lines).toContain(copy.connectedApps);
  });

  it("names the account when it knows it, and reads fine when it does not", () => {
    expect(signOutAllConfirmCopy("a@b.co").lines.join(" ")).toContain("a@b.co");
    expect(signOutAllConfirmCopy().lines.join(" ")).toContain(
      "signed in to this account",
    );
  });

  it("carries no session token", () => {
    expect(signOutAllConfirmCopy("a@b.co").lines.join(" ")).not.toMatch(
      /sess_|mt_/,
    );
  });

  it("states every consequence above the buttons", () => {
    const copy = signOutAllConfirmCopy();
    openConfirm();
    const declineAt = ui.strings.indexOf(copy.declineLabel);
    for (const line of [copy.thisDevice, copy.connectedApps]) {
      const at = ui.strings.indexOf(line);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(declineAt);
    }
  });

  it("offers the safe option first", () => {
    const copy = signOutAllConfirmCopy();
    openConfirm();
    expect(ui.buttons.map((b) => b.text)).toEqual([
      copy.declineLabel,
      copy.confirmLabel,
    ]);
  });
});

describe("PlusSignOutAllConfirmModal — saying yes", () => {
  it("confirming records confirmed, once", () => {
    const copy = signOutAllConfirmCopy();
    const { verdicts } = openConfirm();
    press(copy.confirmLabel);
    expect(verdicts).toEqual(["confirmed"]);
  });
});
