import { Modal, Setting, type App } from "obsidian";
import {
  updateNotesConfirmCopy,
  type UpdateNotesBilling,
  updateNotesQuotedN,
} from "./atomsHomeData";

/** The spend confirm currently on screen, if any. One at a time. */
let openConfirm: Modal | null = null;

/** True while Home or Settings is showing the Update notes spend question. */
export function updateNotesConfirmIsOpen(): boolean {
  return openConfirm !== null;
}

/**
 * Spend-only Update notes confirm. Home and Settings share this so quoted N,
 * billing copy, and Cancel/Escape/outside stay one path. Confirm runs
 * `onConfirm(limit)` with the quoted N; dismiss does not. A second open while
 * this sheet is up is a no-op.
 */
export function openUpdateNotesConfirm(opts: {
  app: App;
  n: number;
  billing: UpdateNotesBilling;
  onConfirm: (limit: number) => void;
}): void {
  if (openConfirm) return;
  const n = updateNotesQuotedN(opts.n);
  if (n <= 0) return;
  const copy = updateNotesConfirmCopy({ n, billing: opts.billing });
  const modal = new Modal(opts.app);
  openConfirm = modal;
  modal.titleEl.setText(copy.title);
  modal.contentEl.createEl("p", { text: copy.body });
  modal.onClose = () => {
    if (openConfirm === modal) openConfirm = null;
  };
  new Setting(modal.contentEl)
    .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
    .addButton((b) =>
      b
        .setButtonText("Update")
        .setCta()
        .onClick(() => {
          modal.close();
          opts.onConfirm(n);
        }),
    );
  modal.open();
}
