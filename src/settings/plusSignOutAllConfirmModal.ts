/**
 * #320 — confirm before "Sign out all devices".
 * Cancel first; states that this device and connected apps are included.
 */
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type { ConfirmVerdict } from "../shared/confirm";
import { markDestructive } from "./destructiveButton";

export type SignOutAllConfirmCopy = {
  title: string;
  lines: string[];
  thisDevice: string;
  connectedApps: string;
  declineLabel: string;
  confirmLabel: string;
};

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
    this.answer("dismissed");
  }

  private answer(verdict: ConfirmVerdict): void {
    if (this.answered) return;
    this.answered = true;
    this.onVerdict(verdict);
    if (verdict !== "dismissed") this.close();
  }
}

export function askSignOutAllApproval(
  app: App,
  email?: string,
): Promise<ConfirmVerdict> {
  return new Promise<ConfirmVerdict>((resolve) => {
    new PlusSignOutAllConfirmModal(app, email, resolve).open();
  });
}
