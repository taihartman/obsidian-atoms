import { Modal, type App } from "obsidian";
import type { Capture, ClassificationResult, MarkerKind } from "../shared/types";
import {
  canApplyReconsider,
  labelSkipKind,
  labelVerdict,
} from "./reconsider";

export interface ReconsiderModalOpts {
  capture: Capture;
  nowKind: MarkerKind;
  result: ClassificationResult | null;
  loading?: boolean;
  errorMessage?: string;
  /** Model proposed atom — commit that plan. */
  onApply?: () => void | Promise<void>;
  /** Model still skip — user forces keep as note. */
  onKeepAnyway?: () => void | Promise<void>;
}

/**
 * Single-capture reconsider sheet: Now → Proposed, Apply commits the plan.
 * When still skipped: Keep as note (user override).
 */
export class ReconsiderModal extends Modal {
  private readonly opts: ReconsiderModalOpts;
  private applying = false;

  constructor(app: App, opts: ReconsiderModalOpts) {
    super(app);
    this.opts = opts;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("atoms-reconsider-modal");
    this.modalEl.addClass("atoms-reconsider-modal-host");

    const header = contentEl.createDiv({ cls: "atoms-reconsider-header" });
    header.createEl("p", {
      cls: "atoms-reconsider-kicker",
      text: "Reconsider",
    });
    header.createEl("h2", { text: "Nothing written yet" });
    header.createEl("p", {
      cls: "atoms-reconsider-sub",
      text: "Ask again about this capture. Your words stay as they are.",
    });

    const snip = contentEl.createDiv({ cls: "atoms-reconsider-snippet" });
    snip.createEl("p", {
      cls: "atoms-reconsider-snippet-lab",
      text: "Capture",
    });
    snip.createEl("p", {
      cls: "atoms-reconsider-snippet-body",
      text: this.opts.capture.text,
    });

    const body = contentEl.createDiv({ cls: "atoms-reconsider-body" });

    if (this.opts.loading) {
      const row = body.createDiv({ cls: "atoms-reconsider-loading" });
      row.createSpan({ cls: "atoms-reconsider-spin" });
      row.createSpan({ text: "Looking at this line…" });
    } else if (this.opts.errorMessage) {
      body.createDiv({
        cls: "atoms-reconsider-helper is-warn",
        text: this.opts.errorMessage,
      });
    } else if (this.opts.result) {
      const compare = body.createDiv({ cls: "atoms-reconsider-compare" });
      const now = compare.createDiv({ cls: "atoms-reconsider-leg" });
      now.createEl("p", { cls: "atoms-reconsider-lab", text: "Now" });
      now.createSpan({
        cls: "atoms-reconsider-badge is-skip",
        text: labelSkipKind(this.opts.nowKind),
      });
      now.createEl("p", {
        cls: "atoms-reconsider-quiet",
        text: "Set aside. Not in your library.",
      });

      compare.createDiv({ cls: "atoms-reconsider-arrow", text: "→" });

      const next = compare.createDiv({ cls: "atoms-reconsider-leg" });
      next.createEl("p", { cls: "atoms-reconsider-lab", text: "Proposed" });
      const v = this.opts.result.verdict;
      next.createSpan({
        cls:
          "atoms-reconsider-badge " +
          (v === "atom" ? "is-note" : "is-skip"),
        text: labelVerdict(v),
      });
      if (v === "atom" && this.opts.result.title.trim()) {
        next.createEl("p", {
          cls: "atoms-reconsider-claim",
          text: this.opts.result.title.trim(),
        });
        const links = this.opts.result.links ?? [];
        if (links.length) {
          const chips = next.createDiv({ cls: "atoms-reconsider-chips" });
          for (const l of links.slice(0, 4)) {
            const note = (l.note || "").trim();
            if (!note) continue;
            chips.createSpan({
              cls: "atoms-reconsider-chip",
              text: note,
            });
          }
        }
      } else {
        next.createEl("p", {
          cls: "atoms-reconsider-quiet",
          text: "Still logistics — not worth keeping.",
        });
      }
    }

    const canApply =
      !!this.opts.result &&
      canApplyReconsider(this.opts.nowKind, this.opts.result.verdict);
    const canForce =
      !!this.opts.result &&
      !canApply &&
      !!this.opts.onKeepAnyway &&
      this.opts.loading !== true;

    const helper = contentEl.createDiv({ cls: "atoms-reconsider-helper" });
    if (this.opts.loading || this.opts.errorMessage) {
      helper.setText("");
    } else if (canApply) {
      helper.setText("Creates one note. Leaves your capture wording alone.");
    } else if (canForce) {
      helper.setText(
        "Model still skipped it. Keep as note if you want it in your library.",
      );
    } else if (this.opts.result) {
      helper.setText("Still not worth keeping.");
    }

    const footer = contentEl.createDiv({ cls: "atoms-reconsider-footer" });
    const cancel = footer.createEl("button", {
      cls: "atoms-reconsider-btn atoms-reconsider-btn-secondary",
      text: "Cancel",
    });
    cancel.addEventListener("click", () => this.close());

    if (canForce) {
      const keep = footer.createEl("button", {
        cls: "atoms-reconsider-btn atoms-reconsider-btn-primary",
        text: "Keep as note",
      });
      keep.addEventListener("click", () => {
        if (this.applying || !this.opts.onKeepAnyway) return;
        this.applying = true;
        keep.disabled = true;
        void Promise.resolve(this.opts.onKeepAnyway())
          .then(() => this.close())
          .catch(() => {
            this.applying = false;
            keep.disabled = false;
          });
      });
    } else {
      const apply = footer.createEl("button", {
        cls: "atoms-reconsider-btn atoms-reconsider-btn-primary",
        text: canApply ? "Apply" : "No change",
      });
      apply.disabled =
        !canApply || !this.opts.onApply || this.opts.loading === true;
      apply.addEventListener("click", () => {
        if (apply.disabled || this.applying || !this.opts.onApply) return;
        this.applying = true;
        apply.disabled = true;
        void Promise.resolve(this.opts.onApply())
          .then(() => this.close())
          .catch(() => {
            this.applying = false;
            apply.disabled = false;
          });
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
