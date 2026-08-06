/**
 * #240 U10 — the confirmation dialog itself: what it says, in what order, and
 * what it counts as consent.
 *
 * Copy is asserted through the exported copy function *and* through the render,
 * because the ordering claim (disclosure above the buttons) is a property of the
 * render and nothing else.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureObsidianUi,
  stopCapturingObsidianUi,
  type UiCapture,
} from "./mocks/obsidian";
import type { ConfirmVerdict } from "../src/shared/confirm";
import {
  PlusSignInConfirmModal,
  SignInOutcomeModal,
  createSignInStatusSurface,
  signInConfirmCopy,
} from "../src/settings/plusSignInConfirmModal";
import { SIGNING_IN_MESSAGE } from "../src/platform/plusSignIn";
import { MAGIC_LINK_REFUSED_MESSAGE } from "../src/platform/plusClient";

const request = { kind: "plus-signin" as const, email: "a@b.co" };

let ui: UiCapture;

beforeEach(() => {
  ui = captureObsidianUi();
  return () => stopCapturingObsidianUi();
});

function openConfirm(): {
  verdicts: ConfirmVerdict[];
  modal: PlusSignInConfirmModal;
} {
  const verdicts: ConfirmVerdict[] = [];
  const modal = new PlusSignInConfirmModal({} as never, request, (v) =>
    verdicts.push(v),
  );
  modal.open();
  return { verdicts, modal };
}

describe("PlusSignInConfirmModal — copy", () => {
  it("names the server-verified email and no token", () => {
    const copy = signInConfirmCopy(request);
    expect(copy.lines.join(" ")).toContain("a@b.co");
    expect(copy.lines.join(" ")).not.toMatch(/mt_|sess_/);
  });

  it("states the sign-out consequence, and states it above the buttons", () => {
    const copy = signInConfirmCopy(request);
    expect(copy.disclosure).toMatch(/signs this account out on your other devices/i);
    // Identity, not similarity: the disclosure is one of the rendered lines,
    // and every line renders before the two buttons.
    expect(copy.lines).toContain(copy.disclosure);

    openConfirm();
    const disclosureAt = ui.strings.indexOf(copy.disclosure);
    const declineAt = ui.strings.indexOf(copy.declineLabel);
    const confirmAt = ui.strings.indexOf(copy.confirmLabel);
    expect(disclosureAt).toBeGreaterThan(-1);
    expect(disclosureAt).toBeLessThan(declineAt);
    expect(disclosureAt).toBeLessThan(confirmAt);
  });

  it("offers the safe option first", () => {
    const copy = signInConfirmCopy(request);
    openConfirm();
    expect(ui.buttons.map((b) => b.text)).toEqual([
      copy.declineLabel,
      copy.confirmLabel,
    ]);
  });
});

describe("PlusSignInConfirmModal — verdicts", () => {
  it("returns confirmed only when the sign-in button is pressed", () => {
    const { verdicts } = openConfirm();
    ui.buttons[1].click();
    expect(verdicts).toEqual(["confirmed"]);
  });

  it("returns declined for the safe option", () => {
    const { verdicts } = openConfirm();
    ui.buttons[0].click();
    expect(verdicts).toEqual(["declined"]);
  });

  it("counts a dismissal as a refusal, never as consent", () => {
    const { verdicts, modal } = openConfirm();
    modal.onClose();
    expect(verdicts).toEqual(["dismissed"]);
  });

  it("answers once, so a close after a choice cannot overwrite it", () => {
    const { verdicts, modal } = openConfirm();
    ui.buttons[1].click();
    modal.onClose();
    expect(verdicts).toEqual(["confirmed"]);
  });
});

describe("sign-in outcome surface", () => {
  it("acknowledges a dead end with one button and no second choice", () => {
    new SignInOutcomeModal({} as never, MAGIC_LINK_REFUSED_MESSAGE).open();
    expect(ui.strings).toContain(MAGIC_LINK_REFUSED_MESSAGE);
    expect(ui.buttons).toHaveLength(1);
  });

  it("puts progress in a Notice and a failure in a modal, never the reverse", () => {
    const surface = createSignInStatusSurface({} as never);
    surface.update("Working…");
    surface.fail(MAGIC_LINK_REFUSED_MESSAGE);

    expect(ui.notices).toEqual([SIGNING_IN_MESSAGE, "Working…"]);
    // A refusal on a timer is indistinguishable from the silent drop (R5).
    expect(ui.notices).not.toContain(MAGIC_LINK_REFUSED_MESSAGE);
    expect(ui.strings).toContain(MAGIC_LINK_REFUSED_MESSAGE);
  });
});
