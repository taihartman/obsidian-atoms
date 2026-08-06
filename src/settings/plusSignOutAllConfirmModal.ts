/**
 * #320 U5 — the consent gesture in front of "Sign out all devices".
 *
 * The same two rules as `plusSignInConfirmModal.ts`, for different reasons.
 * **Cancel is the safe option and it is first**, because this action is not
 * undoable from the device that asks for it: it revokes the caller's own
 * session (KTD2), so a mis-tap signs the user out of the vault they are
 * standing in. And **everything the action does is stated before the buttons**,
 * because two of its three effects are invisible from here — the other devices
 * are elsewhere, and the connected apps are not devices at all.
 */
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type { ConfirmVerdict } from "../shared/confirm";
import { markDestructive } from "./destructiveButton";

export type SignOutAllConfirmCopy = {
  title: string;
  /** Rendered in order, all of it above the buttons. */
  lines: string[];
  /** KTD2 — the caller signs out too. Also present in `lines`. */
  thisDevice: string;
  /** R10 — MCP grants die with the sessions. Also present in `lines`. */
  connectedApps: string;
  /** Safe option, listed first. */
  declineLabel: string;
  confirmLabel: string;
};

/**
 * Extracted from the modal so the copy is assertable without a DOM: vitest runs
 * in node and the shared `Modal` stub renders into nothing.
 */
export function signOutAllConfirmCopy(email?: string): SignOutAllConfirmCopy {
  const thisDevice =
    "This device is signed out too. You will need a new sign-in link to come back.";
  const connectedApps =
    "Connected apps are disconnected and will need to be reconnected.";
  return {
    title: "Sign out all devices?",
    lines: [
      email
        ? `Every device signed in as ${email} is signed out.`
        : "Every device signed in to this account is signed out.",
      thisDevice,
      connectedApps,
      "Your atoms and your vault are untouched.",
    ],
    thisDevice,
    connectedApps,
    declineLabel: "Not now",
    confirmLabel: "Sign out everywhere",
  };
}

/**
 * Mirrors `PlusSignInConfirmModal`: safe option first, one `answered` latch, and
 * `onClose` counted as a dismissal rather than consent.
 */
export class PlusSignOutAllConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly email: string | undefined,
    private readonly onVerdict: (verdict: ConfirmVerdict) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const copy = signOutAllConfirmCopy(this.email);
    contentEl.createEl("h2", { text: copy.title });
    for (const line of copy.lines) {
      contentEl.createEl("p", { text: line });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(copy.declineLabel).onClick(() => {
          this.answer("declined");
        }),
      )
      .addButton((btn) =>
        markDestructive(btn.setButtonText(copy.confirmLabel)).onClick(() => {
          this.answer("confirmed");
        }),
      );
  }

  onClose() {
    this.contentEl.empty();
    // Closing without choosing is a dismissal, not consent.
    this.answer("dismissed");
  }

  private answer(verdict: ConfirmVerdict): void {
    if (this.answered) return;
    this.answered = true;
    this.onVerdict(verdict);
    if (verdict !== "dismissed") this.close();
  }
}

/** Open the confirmation and resolve with what the user chose. */
export function askSignOutAllApproval(
  app: App,
  email?: string,
): Promise<ConfirmVerdict> {
  return new Promise<ConfirmVerdict>((resolve) => {
    new PlusSignOutAllConfirmModal(app, email, resolve).open();
  });
}
