/**
 * #240 U10 — the sign-in confirmation, and the surface every handoff outcome
 * lands on.
 *
 * Two rules shape this file. **Cancel is the safe option and it is first**.
 * #240's KD4 justified that with `exchangeMagic` revoking the account's other
 * sessions before minting; #320 narrowed that revoke to unverified sessions, so
 * the ordering now rests on the surviving reason: the exchange **spends** a
 * single-use token, and asking afterwards would make cancel the choice that
 * costs the user their link. And **a refusal is a modal, not a toast**: R5
 * demands a visible refusal, and a `Notice` competes with the user still
 * switching back from their mail app.
 */
import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type { ConfirmVerdict, SignInConfirmRequest } from "../shared/confirm";
import {
  SIGNING_IN_MESSAGE,
  type SignInStatusSurface,
} from "../platform/plusSignIn";
import { markDestructive } from "./destructiveButton";

export type SignInConfirmCopy = {
  title: string;
  /**
   * Rendered in order, all of it above the buttons — which is what makes the
   * disclosure a fact the user has *before* choosing rather than an outcome
   * they discover afterwards (R4).
   */
  lines: string[];
  /**
   * What signing in here does to the account's other devices. Also present in
   * `lines`; that identity is asserted.
   *
   * #320 KTD7 — kept as a field rather than deleted. Before the narrowing it
   * warned that other devices were signed out; now it tells the truth (they
   * stay) and points at the control that signs them out on purpose. The user
   * still learns where the recovery path is, at the moment the old promise
   * used to appear.
   */
  disclosure: string;
  /** Safe option, listed first. */
  declineLabel: string;
  confirmLabel: string;
};

/**
 * Extracted from the modal so the copy is assertable without a DOM: vitest runs
 * in node and the shared `Modal` stub renders into nothing.
 */
export function signInConfirmCopy(request: SignInConfirmRequest): SignInConfirmCopy {
  const disclosure =
    "Your other devices stay signed in. To sign them out, use “Sign out all devices” in Settings → Atoms.";
  return {
    title: "Sign in to Atoms Plus?",
    lines: [
      `Atoms Plus verified this sign-in link for ${request.email}.`,
      "Approving lets this vault act as that account and sync its atoms to Atoms Plus.",
      disclosure,
    ],
    disclosure,
    declineLabel: "Not now",
    confirmLabel: "Sign in",
  };
}

/**
 * The gesture that releases a sign-in exchange (R4).
 *
 * Mirrors `AskMirrorDeleteConfirmModal`: safe option first, one `answered`
 * latch, and `onClose` counted as a dismissal rather than consent. The
 * requesting vault is deliberately not named — the peek this confirmation
 * follows was satisfied by *this* vault's device-held verifier, so "requested
 * by" could only ever print the vault the user is already looking at.
 */
export class PlusSignInConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly request: SignInConfirmRequest,
    private readonly onVerdict: (verdict: ConfirmVerdict) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const copy = signInConfirmCopy(this.request);
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
export function askSignInApproval(
  app: App,
  request: SignInConfirmRequest,
): Promise<ConfirmVerdict> {
  return new Promise<ConfirmVerdict>((resolve) => {
    new PlusSignInConfirmModal(app, request, resolve).open();
  });
}

/**
 * A dead end the user has to see: dismiss-only, one button, no timer (R5).
 * Same shape as the confirmation minus the choice, so a refusal reads as
 * deliberate rather than as the silent drop #240 exists to remove.
 */
export class SignInOutcomeModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Atoms Plus sign-in" });
    contentEl.createEl("p", { text: this.message });
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Got it").onClick(() => {
        this.close();
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * The one surface a handoff owns from the tap onwards.
 *
 * Progress replaces itself inside a single non-expiring `Notice`; a terminal
 * failure retires the notice and opens the acknowledgement modal instead, so
 * nothing stacks and nothing disappears on a timer.
 */
export function createSignInStatusSurface(app: App): SignInStatusSurface {
  const notice = new Notice(SIGNING_IN_MESSAGE, 0);
  return {
    update: (message: string) => notice.setMessage(message),
    fail: (message: string) => {
      notice.hide();
      new SignInOutcomeModal(app, message).open();
    },
    hide: () => notice.hide(),
  };
}
