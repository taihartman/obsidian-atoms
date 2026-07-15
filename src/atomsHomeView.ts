import { ItemView, Menu, Notice, WorkspaceLeaf, type TFile } from "obsidian";
import type AtomsPlugin from "./main";
import {
  filterLinkedOnly,
  formatRelativeTime,
  listAtomLibraryEntries,
  queuePeekTexts,
  shouldShowWaitCard,
  type AtomLibraryEntry,
} from "./atomsHomeData";
import {
  CAPTURE_SHORTCUT_INSTALL_URL,
  CAPTURE_SHORTCUT_VERSION,
  labelInstallOrUpdate,
  needsShortcutCta,
  openShortcutInstallUrl,
  readShortcutAck,
  writeShortcutAck,
} from "./captureShortcut";
import {
  DailyNotesDisabledError,
  getPastDailyNotesWithUnmarkedCaptures,
  openTodaysDaily,
} from "./daily";

export const ATOMS_HOME_VIEW_TYPE = "atoms-home";

type FilterMode = "all" | "linked";

/**
 * Mobile-first Atoms home: library when clear, wait card when pending,
 * first-day setup when empty.
 */
export class AtomsHomeView extends ItemView {
  plugin: AtomsPlugin;
  private filter: FilterMode = "all";
  private entries: AtomLibraryEntry[] = [];
  private unprocessedCount = 0;
  private peek: Array<{ text: string; date: string }> = [];
  private busy = false;
  private rootEl: HTMLElement | null = null;
  private shortcutAcked: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AtomsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ATOMS_HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Atoms";
  }

  getIcon(): string {
    return "library";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("atoms-home");
    this.rootEl = container;
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.rootEl = null;
  }

  async refresh(): Promise<void> {
    await this.loadData();
    this.render();
  }

  private isFirstDay(): boolean {
    return this.entries.length === 0 && this.unprocessedCount === 0;
  }

  private showShortcutBanner(): boolean {
    if (!CAPTURE_SHORTCUT_INSTALL_URL.trim()) return false;
    if (this.isFirstDay()) return false; // setup card owns Install
    return needsShortcutCta(this.shortcutAcked);
  }

  private async loadData(): Promise<void> {
    const folder = this.plugin.settings.atomFolder || "Atoms";
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      const p = f.path;
      return p === folder || p.startsWith(`${folder}/`);
    });

    const inputs = await Promise.all(
      files.map(async (f: TFile) => ({
        path: f.path,
        mtime: f.stat.mtime,
        content: await this.app.vault.cachedRead(f),
      })),
    );
    this.entries = listAtomLibraryEntries(inputs, folder);

    this.shortcutAcked = readShortcutAck((k) => this.app.loadLocalStorage(k));

    try {
      const past = await getPastDailyNotesWithUnmarkedCaptures(this.app);
      this.unprocessedCount = past.totalUnprocessed;
      this.peek = queuePeekTexts(past.notes, 3);
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        this.unprocessedCount = 0;
        this.peek = [];
      } else {
        throw e;
      }
    }
  }

  private visibleEntries(): AtomLibraryEntry[] {
    return this.filter === "linked"
      ? filterLinkedOnly(this.entries)
      : this.entries;
  }

  private render(): void {
    const root = this.rootEl;
    if (!root) return;
    root.empty();

    const firstDay = this.isFirstDay();

    // Header
    const header = root.createDiv({ cls: "atoms-home-header" });
    const top = header.createDiv({ cls: "atoms-home-header-top" });
    const moreBtn = top.createEl("button", {
      cls: "atoms-home-icon-btn",
      text: "⋯",
      attr: { "aria-label": "More" },
    });
    moreBtn.addEventListener("click", (ev) => this.showMoreMenu(ev));

    const todayBtn = top.createEl("button", {
      cls: "atoms-home-icon-btn",
      text: "◎",
      attr: { "aria-label": "Open today's note" },
    });
    todayBtn.addEventListener("click", () => void this.onOpenToday());

    top.createDiv({ cls: "atoms-home-spacer" });
    const gearBtn = top.createEl("button", {
      cls: "atoms-home-icon-btn",
      text: "⚙",
      attr: { "aria-label": "Settings" },
    });
    gearBtn.addEventListener("click", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).setting?.open?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).setting?.openTabById?.("atoms");
    });

    header.createEl("h1", { cls: "atoms-home-title", text: "Atoms" });
    header.createEl("p", {
      cls: "atoms-home-subtitle",
      text: firstDay
        ? "Get set up to capture"
        : shouldShowWaitCard(this.unprocessedCount)
          ? "Process when ready · library below"
          : "Latest from your vault",
    });

    const scroll = root.createDiv({ cls: "atoms-home-scroll" });

    // Shortcut update banner (not first-day — setup card owns Install)
    if (this.showShortcutBanner()) {
      const banner = scroll.createDiv({ cls: "atoms-home-update-banner" });
      const text = banner.createDiv();
      text.createEl("strong", {
        text:
          this.shortcutAcked == null
            ? "Capture shortcut"
            : "Capture shortcut update",
      });
      text.createEl("span", {
        text: `v${CAPTURE_SHORTCUT_VERSION}`,
        cls: "atoms-home-update-meta",
      });
      const b = banner.createEl("button", {
        text: this.shortcutAcked == null ? "Install" : "Update",
        cls: "atoms-home-update-btn",
      });
      b.addEventListener("click", () => this.onInstallShortcut());
    }

    // Wait card
    if (shouldShowWaitCard(this.unprocessedCount)) {
      const card = scroll.createDiv({ cls: "atoms-home-wait-card" });
      card.createEl("h2", {
        text: `${this.unprocessedCount} capture${this.unprocessedCount === 1 ? "" : "s"} waiting`,
      });
      card.createEl("p", {
        text: "Past dailies ready to classify. Preview before anything is written.",
      });
      const actions = card.createDiv({ cls: "atoms-home-wait-actions" });
      const previewBtn = actions.createEl("button", {
        cls: "atoms-home-btn atoms-home-btn-primary",
        text: this.busy ? "…" : "Preview",
      });
      previewBtn.disabled = this.busy;
      previewBtn.addEventListener("click", () => void this.onPreview());
      const processBtn = actions.createEl("button", {
        cls: "atoms-home-btn atoms-home-btn-secondary",
        text: "Process",
      });
      processBtn.disabled = this.busy;
      processBtn.addEventListener("click", () => void this.onProcess());

      if (this.peek.length) {
        scroll.createDiv({
          cls: "atoms-home-queue-label",
          text: "Still in dailies",
        });
        const peekList = scroll.createDiv({ cls: "atoms-home-list" });
        for (const p of this.peek) {
          const row = peekList.createDiv({ cls: "atoms-home-qcell" });
          row.createSpan({ text: p.text || "(empty)" });
          row.createEl("em", { text: p.date });
        }
      }
    }

    // First-day setup card
    if (firstDay) {
      const setup = scroll.createDiv({ cls: "atoms-home-setup-card" });
      setup.createEl("h2", { text: "Start capturing" });
      setup.createEl("p", {
        text: "Atoms files thoughts from your daily note after the day ends. Capture goes in Daily — not this list.",
      });
      const steps = setup.createEl("ol", { cls: "atoms-home-setup-steps" });
      const s1 = steps.createEl("li");
      s1.createSpan({ cls: "atoms-home-step-num", text: "1" });
      s1.createSpan({
        text: "Open today and write thoughts as bullets",
      });
      const s2 = steps.createEl("li");
      s2.createSpan({ cls: "atoms-home-step-num", text: "2" });
      s2.createSpan({
        text: "Install the capture shortcut so share-sheet dumps land correctly",
      });
      const s3 = steps.createEl("li");
      s3.createSpan({ cls: "atoms-home-step-num", text: "3" });
      s3.createSpan({
        text: "Tomorrow (or after midnight), Preview → Process from here",
      });

      setup.createDiv({
        cls: "atoms-home-mono",
        text: "- Nichita likes periwinkle pajamas\n- buy milk",
      });

      const actions = setup.createDiv({ cls: "atoms-home-setup-actions" });
      const openBtn = actions.createEl("button", {
        cls: "atoms-home-btn atoms-home-btn-primary",
        text: "Open today's note",
      });
      openBtn.addEventListener("click", () => void this.onOpenToday());

      const installLabel = labelInstallOrUpdate(this.shortcutAcked);
      const installBtn = actions.createEl("button", {
        cls: "atoms-home-btn atoms-home-btn-secondary",
        text: installLabel,
      });
      if (!CAPTURE_SHORTCUT_INSTALL_URL.trim()) {
        installBtn.disabled = true;
        installBtn.setAttr(
          "title",
          "Install link not configured yet — see Settings → Capture",
        );
      }
      installBtn.addEventListener("click", () => this.onInstallShortcut());

      const hint = setup.createDiv({ cls: "atoms-home-setup-hint" });
      hint.createEl("strong", { text: "Why empty? " });
      hint.createSpan({
        text: "This list only shows atoms Atoms has filed. Today's note is never auto-processed while you're still writing. Use - bullets at the start of each line.",
      });
    }

    // Filters + library (hide filter chrome on pure first-day empty to reduce noise)
    if (!firstDay || this.entries.length > 0) {
      const filters = scroll.createDiv({ cls: "atoms-home-filters" });
      for (const mode of ["all", "linked"] as FilterMode[]) {
        const b = filters.createEl("button", {
          cls:
            "atoms-home-filter" + (this.filter === mode ? " is-active" : ""),
          text: mode === "all" ? "All" : "Linked",
        });
        b.addEventListener("click", () => {
          this.filter = mode;
          this.render();
        });
      }
    }

    scroll.createDiv({
      cls: "atoms-home-section",
      text: "Recently added",
    });

    const visible = this.visibleEntries();
    if (!visible.length) {
      const empty = scroll.createDiv({ cls: "atoms-home-empty" });
      if (this.entries.length) {
        empty.createEl("p", {
          text: "No linked atoms in this filter. Switch to All, or process captures that link to notes.",
        });
      } else if (shouldShowWaitCard(this.unprocessedCount)) {
        empty.createEl("p", {
          text: "Library fills after Process. Use Preview above first.",
        });
      } else if (!firstDay) {
        empty.createEl("p", {
          text: "No atoms yet — this list only shows notes Atoms has filed into Atoms/.",
        });
      } else {
        empty.createEl("p", {
          cls: "atoms-home-empty-soft",
          text: "No atoms yet",
        });
      }
    } else {
      const list = scroll.createDiv({ cls: "atoms-home-list" });
      const now = Date.now();
      for (const e of visible) {
        const row = list.createDiv({ cls: "atoms-home-cell" });
        row.addEventListener("click", () => {
          void this.app.workspace.openLinkText(e.title, e.path, false);
        });
        const main = row.createDiv();
        main.createDiv({ cls: "atoms-home-cell-title", text: e.title });
        const meta = main.createDiv({ cls: "atoms-home-cell-meta" });
        for (const chip of e.linkChips) {
          meta.createSpan({ cls: "atoms-home-link-chip", text: chip });
        }
        if (e.sourceDay) {
          meta.createSpan({
            text: (e.linkChips.length ? " · " : "") + `from ${e.sourceDay}`,
          });
        }
        row.createDiv({
          cls: "atoms-home-cell-time",
          text: formatRelativeTime(e.mtime, now),
        });
      }
    }

    if (!firstDay) {
      scroll.createEl("p", {
        cls: "atoms-home-footnote",
        text: shouldShowWaitCard(this.unprocessedCount)
          ? "Preview before write. Library below is already in Atoms/."
          : "Atom notes only. Capture stays in Daily.",
      });
    }
  }

  private showMoreMenu(ev: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle("Open today's note").onClick(() => void this.onOpenToday()),
    );
    menu.addItem((i) =>
      i
        .setTitle(labelInstallOrUpdate(this.shortcutAcked))
        .onClick(() => this.onInstallShortcut()),
    );
    menu.addItem((i) =>
      i.setTitle("Refresh").onClick(() => void this.refresh()),
    );
    menu.addItem((i) =>
      i.setTitle("Test connection").onClick(() => {
        void this.plugin.runTestConnectionFromHome();
      }),
    );
    menu.addItem((i) =>
      i.setTitle("Backfill…").onClick(() => {
        void this.plugin.runBackfillFromHome();
      }),
    );
    menu.showAtMouseEvent(ev);
  }

  private async onOpenToday(): Promise<void> {
    try {
      const file = await openTodaysDaily(this.app);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        new Notice(e.message);
        return;
      }
      new Notice(
        e instanceof Error
          ? e.message
          : "Could not open today's daily note",
      );
    }
  }

  private onInstallShortcut(): void {
    const url = CAPTURE_SHORTCUT_INSTALL_URL.trim();
    if (!url) {
      new Notice(
        "Capture shortcut link is not configured yet. See Settings → Capture or docs/capture-shortcut.md",
      );
      return;
    }
    const ok = openShortcutInstallUrl(url);
    if (!ok) {
      new Notice("Could not open the shortcut link");
      return;
    }
    writeShortcutAck(
      (k, v) => this.app.saveLocalStorage(k, v),
      CAPTURE_SHORTCUT_VERSION,
    );
    this.shortcutAcked = CAPTURE_SHORTCUT_VERSION;
    new Notice(
      `Capture shortcut ${labelInstallOrUpdate(null) === "Install capture shortcut" ? "install" : "update"} opened — add it in Shortcuts, then you're set (v${CAPTURE_SHORTCUT_VERSION})`,
    );
    this.render();
  }

  private async onPreview(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.plugin.runDryRunFromHome();
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }

  private async onProcess(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.plugin.runProcessFromHome();
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }
}
