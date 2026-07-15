import { ItemView, Menu, WorkspaceLeaf, type TFile } from "obsidian";
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
  DailyNotesDisabledError,
  getPastDailyNotesWithUnmarkedCaptures,
} from "./daily";

export const ATOMS_HOME_VIEW_TYPE = "atoms-home";

type FilterMode = "all" | "linked";

/**
 * Mobile-first Atoms home: library when clear, dominant wait card when pending.
 */
export class AtomsHomeView extends ItemView {
  plugin: AtomsPlugin;
  private filter: FilterMode = "all";
  private entries: AtomLibraryEntry[] = [];
  private unprocessedCount = 0;
  private peek: Array<{ text: string; date: string }> = [];
  private busy = false;
  private rootEl: HTMLElement | null = null;

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

    // Header
    const header = root.createDiv({ cls: "atoms-home-header" });
    const top = header.createDiv({ cls: "atoms-home-header-top" });
    const moreBtn = top.createEl("button", {
      cls: "atoms-home-icon-btn",
      text: "⋯",
      attr: { "aria-label": "More" },
    });
    moreBtn.addEventListener("click", (ev) => this.showMoreMenu(ev));
    top.createDiv({ cls: "atoms-home-spacer" });
    const gearBtn = top.createEl("button", {
      cls: "atoms-home-icon-btn",
      text: "⚙",
      attr: { "aria-label": "Settings" },
    });
    gearBtn.addEventListener("click", () => {
      // Open community plugin settings for this plugin when possible
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).setting?.open?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).setting?.openTabById?.("atoms");
    });

    header.createEl("h1", { cls: "atoms-home-title", text: "Atoms" });
    header.createEl("p", {
      cls: "atoms-home-subtitle",
      text: shouldShowWaitCard(this.unprocessedCount)
        ? "Process when ready · library below"
        : "Latest from your vault",
    });

    const scroll = root.createDiv({ cls: "atoms-home-scroll" });

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

    // Filters
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

    scroll.createDiv({
      cls: "atoms-home-section",
      text: "Recently added",
    });

    const visible = this.visibleEntries();
    if (!visible.length) {
      const empty = scroll.createDiv({ cls: "atoms-home-empty" });
      empty.createEl("p", {
        text: this.entries.length
          ? "No linked atoms yet. Process captures that mention people or notes you link."
          : "No atoms yet. Capture in Daily, then Preview or Process when ready.",
      });
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

    scroll.createEl("p", {
      cls: "atoms-home-footnote",
      text: shouldShowWaitCard(this.unprocessedCount)
        ? "Preview before write. Library below is already in Atoms/."
        : "Atom notes only. Capture stays in Daily.",
    });
  }

  private showMoreMenu(ev: MouseEvent): void {
    const menu = new Menu();
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
