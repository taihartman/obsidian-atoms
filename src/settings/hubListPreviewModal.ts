/**
 * Preview which hub notes get atom lists before bulk write.
 */

import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import {
  hubListPreviewCopy,
  type HubListPreviewSummary,
} from "../pipeline/hubListPreview";

export type HubListPreviewResult =
  | { action: "confirm"; includeUnsorted: boolean }
  | { action: "dismiss" };

/**
 * Calm modal: hub rows + Include Unsorted + Not now / Update lists.
 * Safe option (Not now) is first.
 */
export class HubListPreviewModal extends Modal {
  private answered = false;
  private includeUnsorted = true;

  constructor(
    app: App,
    private readonly summaryWithUnsorted: HubListPreviewSummary,
    private readonly summaryWithoutUnsorted: HubListPreviewSummary,
    private readonly onResult: (result: HubListPreviewResult) => void,
  ) {
    super(app);
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
    this.finish({ action: "dismiss" });
  }

  private currentSummary(): HubListPreviewSummary {
    return this.includeUnsorted
      ? this.summaryWithUnsorted
      : this.summaryWithoutUnsorted;
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    const copy = hubListPreviewCopy();
    const summary = this.currentSummary();

    contentEl.createEl("h2", { text: copy.title });

    if (summary.empty && this.summaryWithUnsorted.empty) {
      contentEl.createEl("p", { text: copy.emptyBody });
      new Setting(contentEl).addButton((btn) =>
        btn.setButtonText(copy.doneLabel).setCta().onClick(() => {
          this.finish({ action: "dismiss" });
          this.close();
        }),
      );
      return;
    }

    contentEl.createEl("p", { text: copy.body });

    const list = contentEl.createDiv({ cls: "atoms-hub-list-preview" });
    for (const row of summary.rows) {
      const hub = list.createDiv({ cls: "atoms-hub-list-preview-hub" });
      const top = hub.createDiv({ cls: "atoms-hub-list-preview-hub-top" });
      top.createSpan({
        text: row.hubTitle,
        cls: "atoms-hub-list-preview-title",
      });
      top.createSpan({
        text: copy.atomCountLabel(row.total),
        cls: "atoms-hub-list-preview-count",
      });
      const secs = hub.createDiv({ cls: "atoms-hub-list-preview-secs" });
      for (const s of row.sections) {
        const isU = s.name.trim().toLowerCase() === "unsorted";
        secs.createSpan({
          text: `${s.name} · ${s.count}`,
          cls: isU
            ? "atoms-hub-list-preview-chip is-unsorted"
            : "atoms-hub-list-preview-chip",
        });
      }
    }
    if (summary.moreCount > 0) {
      list.createEl("p", {
        text: copy.moreLabel(summary.moreCount),
        cls: "atoms-hub-list-preview-more",
      });
    }

    new Setting(contentEl)
      .setName(copy.includeUnsortedLabel)
      .setDesc(copy.includeUnsortedDesc)
      .addToggle((tg) =>
        tg.setValue(this.includeUnsorted).onChange((on) => {
          this.includeUnsorted = on;
          this.render();
        }),
      );

    if (summary.empty) {
      contentEl.createEl("p", {
        text: "With Unsorted off, nothing would be written right now.",
        cls: "setting-item-description",
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(copy.notNowLabel).onClick(() => {
          this.finish({ action: "dismiss" });
          this.close();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText(copy.updateLabel)
          .setCta()
          .setDisabled(summary.empty)
          .onClick(() => {
            if (summary.empty) return;
            this.finish({
              action: "confirm",
              includeUnsorted: this.includeUnsorted,
            });
            this.close();
          }),
      );
  }

  private finish(result: HubListPreviewResult) {
    if (this.answered) return;
    this.answered = true;
    this.onResult(result);
  }
}

export function openHubListPreviewModal(
  app: App,
  withUnsorted: HubListPreviewSummary,
  withoutUnsorted: HubListPreviewSummary,
): Promise<HubListPreviewResult> {
  return new Promise((resolve) => {
    new HubListPreviewModal(app, withUnsorted, withoutUnsorted, resolve).open();
  });
}
