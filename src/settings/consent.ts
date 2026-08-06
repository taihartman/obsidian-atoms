import { App, Modal, Setting } from "obsidian";
import { markDestructive } from "./destructiveButton";

/**
 * The three consents, and the three disclosures that carry them (KTD7).
 *
 * They are never unified. The egress ack covers this vault's own key sending captures to
 * Anthropic; the Ask privacy ack covers bodies stored on Atoms Plus servers, decryptable at
 * rest in v1; the write ack covers Claude or ChatGPT creating files in the vault. Merging any
 * two would let agreeing to one silently authorize another, so each has its own sheet and each
 * sheet writes exactly its own field.
 */
export const EGRESS_ACK_TITLE = "Data egress acknowledgment";
// One string, two surfaces: Settings and the Atoms home egress card ask for the same
// device-local consent, so they say the same words. The clauses are numbered rather than run
// together because a four-clause sentence is the wall of text people click through, and the two
// risks lead — (3) and (4) are scope limits, and reading those first would soften what the sheet
// exists to disclose.
export const EGRESS_DISCLOSURE =
  '(1) Atoms sends my vault title graph and each capture to the Anthropic API over TLS, unattended — when Obsidian opens and when it returns to the foreground; (2) tapping "Sync everything now" classifies even when automatic filing is turned off; (3) today’s daily note is never auto-touched; (4) this setting stays on this device only.';

export const ASK_PRIVACY_ACK_TITLE = "Ask privacy acknowledgment";
export const ASK_PRIVACY_DISCLOSURE =
  "(1) only Atoms/ leaves this device; (2) bodies are stored on Atoms Plus servers; (3) the host can decrypt at rest in v1 (not zero-knowledge); (4) when I chat in Claude, Anthropic receives tool results (titles, snippets, bodies); when I chat in ChatGPT, OpenAI receives them; (5) Wipe deletes the cloud mirror, pending outbox writes, and connector tokens; (6) turning Ask off does not wipe.";

export const ASK_WRITE_ACK_TITLE = "Vault write acknowledgment";
export const ASK_WRITE_DISCLOSURE =
  "Claude or ChatGPT can queue new atom bodies to Atoms Plus, and this vault will write them as new files under my Atoms folder. New files only — existing bodies are never rewritten. This is a separate consent from the Ask privacy acknowledgment, and turning it off stops the writes without touching the mirror.";

/** How a consent sheet ended. Only `accepted` grants; only `withdrawn` revokes. */
export type ConsentVerdict = "accepted" | "declined" | "withdrawn";

/** What a consent sheet says, and who hears how it ended. */
export interface ConsentSheetSpec {
  title: string;
  disclosure: string;
  /** Set when reviewing an ack already granted — the sheet then offers withdrawal, not accept. */
  granted?: string;
  onVerdict: (verdict: ConsentVerdict) => void;
}

/**
 * A disclosure at the moment of decision, and the surface that takes it back (KTD4).
 *
 * The three permanent acknowledgment toggles this replaces were the only controls that could
 * clear an ack, so the review shape carries `Withdraw acknowledgment`: a consent that can be
 * granted but not withdrawn would be worse than the row it replaced.
 *
 * `answered` is what separates accept from dismissal. `onClose` fires for *every* close,
 * including the one an accept triggers, so it settles as `declined` only when nothing has
 * settled yet — which makes Escape, a click outside, and Settings closing all declines, and
 * leaves an accepted sheet accepted.
 */
export class ConsentSheetModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly spec: ConsentSheetSpec,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const reviewing = this.spec.granted !== undefined;
    contentEl.createEl("h2", { text: this.spec.title });
    contentEl.createEl("p", { text: `I understand: ${this.spec.disclosure}` });
    if (this.spec.granted !== undefined) {
      contentEl.createEl("p", {
        text: this.spec.granted,
        cls: "setting-item-description",
      });
    }

    const buttons = new Setting(contentEl).addButton((btn) =>
      // "Close" reads as leaving a record alone; "Cancel" as abandoning a decision.
      btn.setButtonText(reviewing ? "Close" : "Cancel").onClick(() => this.answer("declined")),
    );
    if (reviewing) {
      buttons.addButton((btn) =>
        markDestructive(btn.setButtonText("Withdraw acknowledgment")).onClick(() =>
          this.answer("withdrawn"),
        ),
      );
      return;
    }
    buttons.addButton((btn) =>
      btn
        .setButtonText("I understand")
        .setCta()
        .onClick(() => this.answer("accepted")),
    );
  }

  onClose() {
    this.contentEl.empty();
    // Closing without choosing is a decline, never consent — and never a withdrawal either.
    this.answer("declined");
  }

  private answer(verdict: ConsentVerdict): void {
    if (this.answered) return;
    this.answered = true;
    this.spec.onVerdict(verdict);
    this.close();
  }
}
