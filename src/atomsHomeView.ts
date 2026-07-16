import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  WorkspaceLeaf,
  type TFile,
} from "obsidian";
import type AtomsPlugin from "./main";
import {
  bodyAfterFrontmatter,
  filingHeroCopy,
  filterLinkedOnly,
  formatRelativeTime,
  isAutomaticFilingReady,
  listAtomLibraryEntries,
  queuePeekTexts,
  shouldShowWaitCard,
  type AtomLibraryEntry,
  type FilingHeroCopy,
} from "./atomsHomeData";
import {
  calendarDateToday,
  citatorChipsForAtom,
  cueLabel,
  formatCueDate,
  indexAtomFile,
  listResurfaceCandidates,
  LS_MIND_CHANGE_DAY,
  LS_MIND_CHANGE_PAIR_THROTTLE,
  LS_RESURFACE_THROTTLE,
  markResurfaceShown,
  mindChangeLaterLine,
  mindChangePairKey,
  parseThrottleJson,
  pickResurface,
  pruneThrottle,
  serializeThrottle,
  type ResurfaceCandidate,
  type ResurfaceThrottleMap,
} from "./resurface";
import {
  CAPTURE_SHORTCUT_VERSION,
  labelInstallOrUpdate,
  needsShortcutCta,
  openShortcutInstallUrl,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "./captureShortcut";
import {
  DailyNotesDisabledError,
  getPastDailyNotesWithUnmarkedCaptures,
  openTodaysDaily,
} from "./daily";
import {
  progressLabel,
  progressPercent,
  snippetCapture,
  type RunPhase,
} from "./runProgress";

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
  /** Unprocessed bullets on today's daily only (for force-test UI). */
  private todayUnprocessedCount = 0;
  private peek: Array<{ text: string; date: string }> = [];
  private busy = false;
  private rootEl: HTMLElement | null = null;
  private shortcutAcked: string | null = null;
  private refreshTimer: number | null = null;
  /** Session-only skips for From-the-brain Next (not durable). */
  private resurfaceSkipPaths = new Set<string>();
  private resurfaceCandidates: ResurfaceCandidate[] = [];
  private resurfaceCard: ResurfaceCandidate | null = null;
  /** Raw atom files for resurface re-pick without re-read when possible. */
  private atomFileInputs: Array<{
    path: string;
    content: string;
    mtime?: number;
  }> = [];
  private resurfaceThrottle: ResurfaceThrottleMap = {};
  /** Calendar day when a mind-change hero was last shown (1/day). */
  private mindChangeDayShown: string | null = null;
  /** Pair keys throttled after mind-change Open / Next / recovery. */
  private mindChangePairThrottle: ResurfaceThrottleMap = {};
  /** In-home atom detail (citator) — null when showing main home. */
  private homeOpen:
    | {
        path: string;
        title: string;
        body: string;
        chips: Array<{ label: string; peerPath: string; peerTitle: string }>;
      }
    | null = null;

  /** Live Preview/Process progress (not cleared by library refresh). */
  private runPhase: RunPhase = "idle";
  private runDone = 0;
  private runTotal = 0;
  private runSnippet = "";
  private runSummaryText = "";
  private progressMount: HTMLElement | null = null;

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
    // Keep library in sync when process writes atoms / markers elsewhere
    const scheduleRefresh = () => {
      if (this.busy) return; // onProcess finally refreshes
      if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null;
        void this.refresh();
      }, 400);
    };
    this.registerEvent(this.app.vault.on("create", scheduleRefresh));
    this.registerEvent(this.app.vault.on("modify", scheduleRefresh));
    this.registerEvent(this.app.vault.on("delete", scheduleRefresh));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer != null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.rootEl = null;
  }

  async refresh(): Promise<void> {
    await this.loadData();
    this.render();
  }

  /** Start a home-visible run (Preview or Process). */
  beginRun(phase: "preview" | "process"): void {
    this.busy = true;
    this.runPhase = phase;
    this.runDone = 0;
    this.runTotal = 0;
    this.runSnippet = "";
    this.runSummaryText = "";
    this.render();
  }

  /** In-place progress tick — avoid full library reload. */
  updateRunProgress(
    done: number,
    total: number,
    captureText?: string,
  ): void {
    this.runDone = done;
    this.runTotal = total;
    if (captureText !== undefined) {
      this.runSnippet = snippetCapture(captureText);
    }
    if (this.progressMount && this.rootEl?.isConnected) {
      this.patchProgressMount();
      return;
    }
    this.render();
  }

  finishRun(summaryText: string): void {
    this.busy = false;
    this.runPhase = "done";
    this.runSummaryText = summaryText;
    this.runSnippet = "";
    void this.refresh();
  }

  failRun(message?: string): void {
    this.busy = false;
    this.runPhase = "error";
    this.runSummaryText = message?.trim() || "Something went wrong";
    this.render();
  }

  clearRunUi(): void {
    this.runPhase = "idle";
    this.runDone = 0;
    this.runTotal = 0;
    this.runSnippet = "";
    this.runSummaryText = "";
    this.progressMount = null;
  }

  private patchProgressMount(): void {
    const el = this.progressMount;
    if (!el) return;
    el.empty();
    this.fillProgressContent(el);
  }

  private fillProgressContent(el: HTMLElement): void {
    if (this.runPhase === "done" || this.runPhase === "error") {
      el.createEl("h2", {
        text: this.runPhase === "error" ? "Error" : "Done",
      });
      el.createEl("p", { text: this.runSummaryText });
      return;
    }
    const phase = this.runPhase === "preview" ? "preview" : "process";
    el.createEl("h2", {
      text: progressLabel(phase, this.runDone, this.runTotal || 1),
    });
    if (this.runSnippet) {
      el.createEl("p", {
        cls: "atoms-home-progress-snippet",
        text: this.runSnippet,
      });
    }
    const track = el.createDiv({ cls: "atoms-home-progress-track" });
    const fill = track.createDiv({ cls: "atoms-home-progress-fill" });
    fill.style.width = `${progressPercent(this.runDone, this.runTotal)}%`;
  }

  private isFirstDay(): boolean {
    return (
      this.entries.length === 0 &&
      this.unprocessedCount === 0 &&
      this.todayUnprocessedCount === 0
    );
  }

  private installUrl(): string {
    return resolveCaptureShortcutInstallUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
  }

  private showShortcutBanner(): boolean {
    if (!this.installUrl()) return false;
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
    this.atomFileInputs = inputs.map((i) => ({
      path: i.path,
      content: i.content,
      mtime: i.mtime,
    }));
    this.resurfaceThrottle = pruneThrottle(
      parseThrottleJson(
        this.app.loadLocalStorage(LS_RESURFACE_THROTTLE) as string | null,
      ),
    );
    this.mindChangeDayShown =
      (this.app.loadLocalStorage(LS_MIND_CHANGE_DAY) as string | null) ?? null;
    this.mindChangePairThrottle = pruneThrottle(
      parseThrottleJson(
        this.app.loadLocalStorage(LS_MIND_CHANGE_PAIR_THROTTLE) as
          | string
          | null,
      ),
    );
    this.refreshResurfacePick(folder);

    this.shortcutAcked = readShortcutAck((k) => this.app.loadLocalStorage(k));

    try {
      const past = await getPastDailyNotesWithUnmarkedCaptures(this.app);
      this.unprocessedCount = past.totalUnprocessed;
      this.peek = queuePeekTexts(past.notes, 3);

      const withToday = await getPastDailyNotesWithUnmarkedCaptures(this.app, {
        includeToday: true,
      });
      const todayStr = new Date();
      const y = todayStr.getFullYear();
      const m = String(todayStr.getMonth() + 1).padStart(2, "0");
      const d = String(todayStr.getDate()).padStart(2, "0");
      const iso = `${y}-${m}-${d}`;
      const todayNote = withToday.notes.find((n) => n.date === iso);
      this.todayUnprocessedCount = todayNote?.unprocessed.length ?? 0;
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        this.unprocessedCount = 0;
        this.todayUnprocessedCount = 0;
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

  private refreshResurfacePick(folder?: string): void {
    const atomFolder =
      folder ?? (this.plugin.settings.atomFolder || "Atoms");
    const today = calendarDateToday();
    this.resurfaceCandidates = listResurfaceCandidates(
      this.atomFileInputs,
      today,
      atomFolder,
    );
    this.resurfaceCard = pickResurface(
      this.resurfaceCandidates,
      this.resurfaceSkipPaths,
      this.resurfaceThrottle,
      Date.now(),
      undefined,
      {
        mindChangeDayShown: this.mindChangeDayShown,
        todayYmd: today,
        pairThrottle: this.mindChangePairThrottle,
      },
    );
  }

  private persistThrottle(): void {
    this.app.saveLocalStorage(
      LS_RESURFACE_THROTTLE,
      serializeThrottle(this.resurfaceThrottle),
    );
  }

  private persistMindChangeMeta(): void {
    if (this.mindChangeDayShown) {
      this.app.saveLocalStorage(LS_MIND_CHANGE_DAY, this.mindChangeDayShown);
    }
    this.app.saveLocalStorage(
      LS_MIND_CHANGE_PAIR_THROTTLE,
      serializeThrottle(this.mindChangePairThrottle),
    );
  }

  private noteResurfaceShown(path: string): void {
    this.resurfaceThrottle = markResurfaceShown(path, this.resurfaceThrottle);
    this.persistThrottle();
  }

  private noteMindChangeInteraction(card: ResurfaceCandidate): void {
    const today = calendarDateToday();
    this.mindChangeDayShown = today;
    if (card.laterPath) {
      const pk = mindChangePairKey(card.path, card.laterPath);
      this.mindChangePairThrottle = markResurfaceShown(
        pk,
        this.mindChangePairThrottle,
      );
    }
    this.noteResurfaceShown(card.path);
    if (card.laterPath) this.noteResurfaceShown(card.laterPath);
    this.persistMindChangeMeta();
  }

  private pickNextResurface(): void {
    this.resurfaceCard = pickResurface(
      this.resurfaceCandidates,
      this.resurfaceSkipPaths,
      this.resurfaceThrottle,
      Date.now(),
      undefined,
      {
        mindChangeDayShown: this.mindChangeDayShown,
        todayYmd: calendarDateToday(),
        pairThrottle: this.mindChangePairThrottle,
      },
    );
  }

  private renderResurfaceCard(scroll: HTMLElement): void {
    const card = this.resurfaceCard;
    if (!card) return;

    scroll.createDiv({
      cls: "atoms-home-section atoms-home-section-for-you",
      text: "For you",
    });

    if (card.cue === "mind-change") {
      this.renderMindChangeCard(scroll, card);
      return;
    }

    const el = scroll.createDiv({
      cls: "atoms-home-resurface-card",
      attr: { role: "button", tabindex: "0" },
    });
    el.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest(".atoms-home-resurface-another")) return;
      void this.onOpenResurface(card);
    });

    el.createEl("p", {
      cls: "atoms-home-resurface-kicker",
      text: cueLabel(card.cue),
    });
    el.createEl("p", {
      cls: "atoms-home-resurface-snippet",
      text: card.bodySnippet,
    });
    const foot = el.createDiv({ cls: "atoms-home-resurface-foot" });
    foot.createEl("span", {
      cls: "atoms-home-resurface-title",
      text: card.title,
    });
    if (card.matchDate) {
      foot.createEl("span", {
        cls: "atoms-home-resurface-meta",
        text: formatCueDate(card.matchDate),
      });
    }
    const another = el.createEl("button", {
      cls: "atoms-home-resurface-another",
      text: "Another",
      attr: { type: "button", "aria-label": "Show another memory" },
    });
    another.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.resurfaceSkipPaths.add(card.path);
      this.noteResurfaceShown(card.path);
      this.pickNextResurface();
      this.render();
    });
  }

  private renderMindChangeCard(
    scroll: HTMLElement,
    card: ResurfaceCandidate,
  ): void {
    const el = scroll.createDiv({
      cls: "atoms-home-resurface-card atoms-home-mind-change-card",
    });
    el.createEl("p", {
      cls: "atoms-home-resurface-kicker atoms-home-mind-change-kicker",
      text: cueLabel("mind-change"),
    });
    el.createEl("p", {
      cls: "atoms-home-resurface-snippet",
      text: card.bodySnippet,
    });
    if (card.laterTitle) {
      el.createEl("p", {
        cls: "atoms-home-mind-change-later",
        text: mindChangeLaterLine(
          card.laterTitle,
          card.relation ?? "revises",
        ),
      });
    }
    const actions = el.createDiv({ cls: "atoms-home-mind-change-actions" });
    const openBtn = actions.createEl("button", {
      cls: "atoms-home-mind-change-open",
      text: "Open",
      attr: { type: "button" },
    });
    openBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.noteMindChangeInteraction(card);
      void this.openAtomInHome(card.path);
    });
    const nextBtn = actions.createEl("button", {
      cls: "atoms-home-mind-change-next",
      text: "Next",
      attr: { type: "button" },
    });
    nextBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.resurfaceSkipPaths.add(card.path);
      this.noteMindChangeInteraction(card);
      this.pickNextResurface();
      this.render();
    });
    const rejectBtn = actions.createEl("button", {
      cls: "atoms-home-mind-change-reject",
      text: "Not a mind-change",
      attr: { type: "button" },
    });
    rejectBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.resurfaceSkipPaths.add(card.path);
      this.noteMindChangeInteraction(card);
      this.pickNextResurface();
      this.render();
    });
  }

  private async openAtomInHome(path: string): Promise<void> {
    const folder = this.plugin.settings.atomFolder || "Atoms";
    const file = this.atomFileInputs.find((f) => f.path === path);
    if (!file) {
      new Notice("Atoms: note not found");
      return;
    }
    const indexed = this.atomFileInputs
      .map((f) => indexAtomFile(f.path, f.content, folder, f.mtime ?? 0))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const self = indexed.find((a) => a.path === path);
    if (!self) {
      new Notice("Atoms: note not found");
      return;
    }
    const chips = citatorChipsForAtom(self, indexed);
    this.homeOpen = {
      path: self.path,
      title: self.title,
      body: bodyAfterFrontmatter(file.content).trim() || self.bodySnippet,
      chips,
    };
    this.render();
  }

  private renderHomeOpen(scroll: HTMLElement): void {
    const open = this.homeOpen;
    if (!open) return;
    const back = scroll.createEl("button", {
      cls: "atoms-home-back",
      text: "‹ For you",
      attr: { type: "button" },
    });
    back.addEventListener("click", () => {
      this.homeOpen = null;
      this.render();
    });
    scroll.createEl("h2", {
      cls: "atoms-home-open-title",
      text: open.title,
    });
    if (open.chips.length) {
      const ribbon = scroll.createDiv({
        cls: "atoms-home-citator-ribbon",
        attr: { "aria-label": "Belief history" },
      });
      for (const c of open.chips) {
        const chip = ribbon.createEl("button", {
          cls: "atoms-home-citator-chip",
          text: c.label,
          attr: { type: "button" },
        });
        chip.addEventListener("click", () => {
          void this.openAtomInHome(c.peerPath);
        });
      }
    }
    scroll.createEl("p", {
      cls: "atoms-home-open-body",
      text: open.body.slice(0, 1200),
    });
    const vaultBtn = scroll.createEl("button", {
      cls: "atoms-home-open-vault",
      text: "Open in vault",
      attr: { type: "button" },
    });
    vaultBtn.addEventListener("click", async () => {
      const file = this.app.vault.getAbstractFileByPath(open.path);
      if (file && "extension" in file) {
        await this.app.workspace.getLeaf(false).openFile(file as TFile);
      }
    });
  }

  private async onOpenResurface(card: ResurfaceCandidate): Promise<void> {
    this.noteResurfaceShown(card.path);
    if (card.cue === "mind-change") {
      this.noteMindChangeInteraction(card);
      await this.openAtomInHome(card.path);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(card.path);
    if (file && "extension" in file) {
      await this.app.workspace.getLeaf(false).openFile(file as TFile);
    } else {
      new Notice("Atoms: note not found");
    }
  }

  private render(): void {
    const root = this.rootEl;
    if (!root) return;
    root.empty();

    if (this.homeOpen) {
      const scroll = root.createDiv({ cls: "atoms-home-scroll" });
      this.renderHomeOpen(scroll);
      return;
    }

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

    // One calm subtitle per state — no product jargon
    const subtitle = firstDay
      ? "Capture starts in your daily note"
      : this.runPhase !== "idle"
        ? this.runPhase === "preview"
          ? "Previewing…"
          : this.runPhase === "process"
            ? "Filing…"
            : this.runPhase === "done"
              ? this.runSummaryText
              : this.runSummaryText
        : shouldShowWaitCard(this.unprocessedCount)
          ? isAutomaticFilingReady(this.plugin.getAutoRunSnapshot())
            ? this.unprocessedCount === 1
              ? "1 past thought will file automatically"
              : `${this.unprocessedCount} past thoughts will file automatically`
            : this.unprocessedCount === 1
              ? "1 thought ready to file"
              : `${this.unprocessedCount} thoughts ready to file`
          : this.entries.length
            ? "Your second brain"
            : "Nothing filed yet";

    header.createEl("h1", { cls: "atoms-home-title", text: "Atoms" });
    header.createEl("p", {
      cls: "atoms-home-subtitle",
      text: subtitle,
    });

    const scroll = root.createDiv({ cls: "atoms-home-scroll" });

    // Progress — full-bleed calm bar, not a third competing card type
    if (this.runPhase !== "idle") {
      const prog = scroll.createDiv({
        cls:
          "atoms-home-progress-card" +
          (this.runPhase === "error" ? " is-error" : "") +
          (this.runPhase === "done" ? " is-done" : ""),
      });
      this.progressMount = prog;
      this.fillProgressContent(prog);
    } else {
      this.progressMount = null;
    }

    // Work first when past captures wait — automatic filing story (not homework-only)
    if (shouldShowWaitCard(this.unprocessedCount)) {
      const snap = this.plugin.getAutoRunSnapshot();
      const hero =
        filingHeroCopy({
          pastUnprocessed: this.unprocessedCount,
          hasKey: snap.hasKey,
          autoEnabled: snap.enabled,
          egressAcked: snap.egressAcked,
          inFlight: snap.inFlight,
        }) ??
        ({
          mode: "enable_auto",
          eyebrow: "Ready",
          title: `${this.unprocessedCount} past captures waiting`,
          body: "Process when you are ready.",
          primaryLabel: "Process",
          primaryAction: "process",
          secondaryLabel: "Preview",
          secondaryAction: "preview",
        } satisfies FilingHeroCopy);

      const card = scroll.createDiv({ cls: "atoms-home-wait-card" });
      card.createEl("p", {
        cls: "atoms-home-card-eyebrow",
        text: hero.eyebrow,
      });
      card.createEl("h2", { text: hero.title });
      card.createEl("p", { text: hero.body });
      const actions = card.createDiv({ cls: "atoms-home-wait-actions" });

      const bindAction = (
        label: string | null,
        action: FilingHeroCopy["primaryAction"] | FilingHeroCopy["secondaryAction"],
        primary: boolean,
      ) => {
        if (!label || !action) return;
        const btn = actions.createEl("button", {
          cls:
            "atoms-home-btn " +
            (primary ? "atoms-home-btn-primary" : "atoms-home-btn-secondary"),
          text: this.busy ? "…" : label,
        });
        btn.disabled = this.busy;
        btn.addEventListener("click", () => {
          if (action === "open_settings") {
            (this.app as { setting?: { openTabById?: (id: string) => void } })
              .setting?.openTabById?.("atoms");
            return;
          }
          if (action === "enable_auto") {
            this.confirmEnableAutomaticFiling();
            return;
          }
          if (action === "preview") void this.onPreview(false);
          if (action === "process") void this.onProcess(false);
        });
      };

      bindAction(hero.primaryLabel, hero.primaryAction, true);
      bindAction(hero.secondaryLabel, hero.secondaryAction, false);

      // enable_auto already has Process secondary — also offer Preview
      if (hero.mode === "enable_auto" && hero.secondaryAction !== "preview") {
        const previewBtn = actions.createEl("button", {
          cls: "atoms-home-btn atoms-home-btn-secondary",
          text: this.busy ? "…" : "Preview",
        });
        previewBtn.disabled = this.busy;
        previewBtn.addEventListener("click", () => void this.onPreview(false));
      }

      if (this.peek.length) {
        scroll.createDiv({
          cls: "atoms-home-queue-label",
          text: "In your dailies",
        });
        const peekList = scroll.createDiv({
          cls: "atoms-home-list atoms-home-list-peek",
        });
        for (const p of this.peek) {
          const row = peekList.createDiv({ cls: "atoms-home-qcell" });
          row.createSpan({ text: p.text || "(empty)" });
          row.createEl("em", { text: p.date });
        }
      }
    }

    // One hero: Ready when pending; For you only when calm (home-v2)
    const workPending = shouldShowWaitCard(this.unprocessedCount);
    if (!firstDay && this.runPhase === "idle" && !workPending) {
      this.renderResurfaceCard(scroll);
    }

    if (this.showShortcutBanner()) {
      const banner = scroll.createDiv({ cls: "atoms-home-update-banner" });
      const text = banner.createDiv();
      text.createEl("strong", {
        text:
          this.shortcutAcked == null
            ? "Capture shortcut"
            : "Shortcut update",
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

    if (firstDay) {
      const setup = scroll.createDiv({ cls: "atoms-home-setup-card" });
      setup.createEl("p", {
        cls: "atoms-home-card-eyebrow",
        text: "Get started",
      });
      setup.createEl("h2", { text: "Write one bullet today" });
      setup.createEl("p", {
        text: "Atoms files thoughts from past days. Capture stays in Daily — this list shows what was filed.",
      });
      setup.createDiv({
        cls: "atoms-home-mono",
        text: "- Alex likes periwinkle\n- watch Past Lives",
      });

      const actions = setup.createDiv({ cls: "atoms-home-setup-actions" });
      const openBtn = actions.createEl("button", {
        cls: "atoms-home-btn atoms-home-btn-primary",
        text: "Open today",
      });
      openBtn.addEventListener("click", () => void this.onOpenToday());

      const installLabel = labelInstallOrUpdate(this.shortcutAcked);
      const installBtn = actions.createEl("button", {
        cls: "atoms-home-btn atoms-home-btn-secondary",
        text: installLabel,
      });
      if (!this.installUrl()) {
        installBtn.disabled = true;
        installBtn.setAttr(
          "title",
          "Paste an iCloud link in Settings → Capture first",
        );
      }
      installBtn.addEventListener("click", () => this.onInstallShortcut());
    }

    // Library — secondary surface
    if (!firstDay || this.entries.length > 0) {
      const libHead = scroll.createDiv({ cls: "atoms-home-lib-head" });
      libHead.createDiv({
        cls: "atoms-home-section",
        text: "Library",
      });
      const filters = libHead.createDiv({
        cls: "atoms-home-filters",
        attr: { role: "tablist", "aria-label": "Filter library" },
      });
      for (const mode of ["all", "linked"] as FilterMode[]) {
        const b = filters.createEl("button", {
          cls:
            "atoms-home-filter" + (this.filter === mode ? " is-active" : ""),
          text: mode === "all" ? "All" : "Linked",
          attr: {
            role: "tab",
            "aria-selected": this.filter === mode ? "true" : "false",
          },
        });
        b.addEventListener("click", () => {
          this.filter = mode;
          this.render();
        });
      }
    } else if (!firstDay) {
      scroll.createDiv({
        cls: "atoms-home-section",
        text: "Library",
      });
    }

    const visible = this.visibleEntries();
    if (!visible.length) {
      const empty = scroll.createDiv({ cls: "atoms-home-empty" });
      if (this.entries.length) {
        empty.createEl("p", {
          text: "Nothing linked in this filter.",
        });
      } else if (shouldShowWaitCard(this.unprocessedCount)) {
        empty.createEl("p", {
          text: isAutomaticFilingReady(this.plugin.getAutoRunSnapshot())
            ? "Library fills after automatic filing (or Process now)."
            : "Library fills after you Process.",
        });
      } else if (!firstDay) {
        empty.createEl("p", {
          text: "Filed atoms will show up here.",
        });
      }
    } else {
      const list = scroll.createDiv({ cls: "atoms-home-list" });
      const now = Date.now();
      for (const e of visible) {
        const row = list.createDiv({
          cls: "atoms-home-cell",
          attr: { role: "button", tabindex: "0" },
        });
        row.addEventListener("click", () => {
          void this.app.workspace.openLinkText(e.title, e.path, false);
        });
        const main = row.createDiv({ cls: "atoms-home-cell-main" });
        main.createDiv({ cls: "atoms-home-cell-title", text: e.title });
        const meta = main.createDiv({ cls: "atoms-home-cell-meta" });
        for (const chip of e.displayChips) {
          meta.createSpan({
            cls:
              "atoms-home-link-chip" +
              (chip.role === "person"
                ? " is-person"
                : " is-work"),
            text: chip.label,
          });
        }
        if (e.sourceDay) {
          meta.createSpan({
            cls: "atoms-home-cell-source",
            text:
              (e.displayChips.length ? " · " : "") +
              formatCueDate(e.sourceDay),
          });
        }
        row.createDiv({
          cls: "atoms-home-cell-time",
          text: formatRelativeTime(e.mtime, now),
        });
      }
    }
  }

  private showMoreMenu(ev: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle("Open today's note").onClick(() => void this.onOpenToday()),
    );
    if (this.todayUnprocessedCount > 0) {
      menu.addItem((i) =>
        i
          .setTitle(
            `Preview today (${this.todayUnprocessedCount})`,
          )
          .onClick(() => void this.onPreview(true)),
      );
      menu.addItem((i) =>
        i
          .setTitle(`Process today (${this.todayUnprocessedCount})`)
          .onClick(() => void this.onProcess(true)),
      );
    }
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
    const url = this.installUrl();
    if (!url) {
      new Notice(
        "Paste an iCloud shortcut link in Settings → Capture (Shortcuts → Share → Copy iCloud Link).",
      );
      return;
    }
    const ok = openShortcutInstallUrl(url);
    if (!ok) {
      new Notice(
        "Shortcut link must be an https://www.icloud.com/shortcuts/… URL",
      );
      return;
    }
    writeShortcutAck(
      (k, v) => this.app.saveLocalStorage(k, v),
      CAPTURE_SHORTCUT_VERSION,
    );
    this.shortcutAcked = CAPTURE_SHORTCUT_VERSION;
    new Notice(
      `Opened capture shortcut v${CAPTURE_SHORTCUT_VERSION} — add it in Shortcuts`,
    );
    this.render();
  }

  /** Privacy confirm then device-local ack + enable (U3). */
  private confirmEnableAutomaticFiling(): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText("Automatic filing");
    modal.contentEl.createEl("p", {
      text: "When you open Obsidian, Atoms can send past daily captures and vault titles to Anthropic over TLS to file them. Today’s daily note is never auto-touched. This setting stays on this device only.",
    });
    new Setting(modal.contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => modal.close()),
      )
      .addButton((b) =>
        b
          .setButtonText("Enable")
          .setCta()
          .onClick(() => {
            modal.close();
            void this.plugin.enableAutomaticFilingFromHome();
          }),
      );
    modal.open();
  }

  private async onPreview(includeToday: boolean): Promise<void> {
    if (this.busy) return;
    await this.plugin.runDryRunFromHome({ includeToday });
  }

  private async onProcess(includeToday: boolean): Promise<void> {
    if (this.busy) return;
    await this.plugin.runProcessFromHome({ includeToday });
  }
}
