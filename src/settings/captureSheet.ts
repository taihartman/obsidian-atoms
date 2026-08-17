import { App, Modal, Setting } from "obsidian";

import { CAPTURE_SHORTCUT_STEPS } from "./captureShortcut";

/**
 * What the sheet needs in order to do its one job: show the procedure, and offer the install.
 *
 * `installLabel` and `disabledNote` arrive already decided rather than being worked out here. The
 * label is `labelCaptureShortcutCta`'s answer, which the settings tab already reads for the row,
 * and whether there is a link at all is a `mobile-install.json` question the tab is holding
 * anyway. Deciding either a second time inside the sheet is how the row and the sheet end up
 * disagreeing about whether this phone is set up.
 */
export interface CaptureShortcutSheetSpec {
  /** Defaults to {@link CAPTURE_SHEET_TITLE}. Android passes its own. */
  title?: string;
  /** Defaults to {@link CAPTURE_SHEET_LEAD}. */
  lead?: string;
  /** Defaults to the iOS Capture Atom steps. */
  steps?: readonly string[];
  /** "Install Capture Atom", "Get Atoms Capture", or "Update Capture Atom". */
  installLabel: string;
  /** Set when `mobile-install.json` yields no link, and the reason to show instead. */
  disabledNote?: string;
  /** Runs on press. The sheet closes first, so a Notice it raises is not behind the sheet. */
  onInstall: () => void;
}

/**
 * The capture-on-phone procedure, as a sheet rather than a row description.
 *
 * A sheet and not a destination: this is three steps and one button, it has no state of its own
 * to manage, and a route would put it in the back stack of a screen the user reached to do one
 * thing. It is also read-only in the sense that matters — dismissing it writes nothing, so a
 * reader can open it to check what step 3 said without changing anything about this device.
 *
 * The steps are an ordered list, not paragraphs. They are numbered in the source of truth
 * (`CAPTURE_SHORTCUT_STEPS`), they must be done in that order, and an `<ol>` is the one element
 * that says so to a screen reader as well as to an eye.
 */
export class CaptureShortcutSheetModal extends Modal {
  constructor(
    app: App,
    private readonly spec: CaptureShortcutSheetSpec,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.spec.title ?? CAPTURE_SHEET_TITLE });
    contentEl.createEl("p", {
      text: this.spec.lead ?? CAPTURE_SHEET_LEAD,
      cls: "setting-item-description",
    });

    const steps = contentEl.createEl("ol", { cls: "atoms-capture-steps" });
    for (const step of this.spec.steps ?? CAPTURE_SHORTCUT_STEPS) {
      steps.createEl("li", { text: step });
    }

    if (this.spec.disabledNote !== undefined) {
      contentEl.createEl("p", {
        text: this.spec.disabledNote,
        cls: "setting-item-description",
      });
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Close").onClick(() => this.close()))
      .addButton((btn) => {
        btn
          .setButtonText(this.spec.installLabel)
          .setCta()
          .setDisabled(this.spec.disabledNote !== undefined)
          .onClick(() => {
            // Closed before the handler runs: the install opens a URL and raises a Notice about
            // what to do next, and a Notice behind an open sheet is a Notice nobody reads.
            this.close();
            this.spec.onInstall();
          });
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Same words as the row that opens it, so the sheet is obviously the thing that row named. */
export const ANDROID_CAPTURE_SHEET_TITLE = "Atoms Capture";

export const ANDROID_CAPTURE_SHEET_LEAD =
  "On Android, capture is its own app. It writes the same inbox line the iPhone shortcut does.";

export const ANDROID_CAPTURE_STEPS: readonly string[] = [
  "Get Atoms Capture from Google Play.",
  "Open it and link this vault.",
  "Capture from the overlay, the widget, or the shade tile.",
];

export const CAPTURE_SHEET_TITLE = "Capture on your phone";

/**
 * Why the shortcut exists, in the one sentence the steps do not carry. It names the daily note
 * because that is where a capture has to land for anything else in Atoms to see it.
 */
export const CAPTURE_SHEET_LEAD =
  "Say or type a thought on your phone and it lands as a bullet in today's daily note.";
