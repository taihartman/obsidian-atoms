import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type AtomsPlugin from "../plugin/main";
import {
  bodyAfterFrontmatter,
  countEligibleUpdateNotes,
  filingHeroCopy,
  filterLinkedOnly,
  formatRelativeTime,
  isAutomaticFilingReady,
  listAtomLibraryEntries,
  queuePeekTexts,
  shouldShowWaitCard,
  updateNotesConfirmCopy,
  updateNotesStripCopy,
  type AtomLibraryEntry,
  type FilingHeroCopy,
} from "./atomsHomeData";
import {
  CURRENT_ATOMS_QUALITY,
} from "../pipeline/atomQuality";
import { UPDATE_NOTES_BATCH_LIMIT } from "../pipeline/refreshAtoms";
import {
  calendarDateToday,
  calendarDayDelta,
  citatorLinesForAtom,
  claimBodyForDisplay,
  cueLabel,
  formatCueDate,
  indexAtomFile,
  listResurfaceCandidates,
  LS_MIND_CHANGE_DAY,
  LS_MIND_CHANGE_PAIR_THROTTLE,
  LS_RESURFACE_THROTTLE,
  markResurfaceShown,
  mindChangeConnectorLabel,
  mindChangeHeroLaterLineParts,
  mindChangePairKey,
  parseThrottleJson,
  pickResurface,
  pruneThrottle,
  serializeThrottle,
  type CitatorLine,
  type ResurfaceCandidate,
  type ResurfaceThrottleMap,
  type SupersessionRelation,
} from "../resurface/resurface";
import {
  actionRow,
  backLink,
  button,
  claimQuote,
  citatorLine,
  filterTabs,
  flatCard,
  kicker,
  linkChip,
  listGroup,
  listRow,
  sectionLabel,
  statusCard,
} from "../ui";
import {
  CAPTURE_SHORTCUT_VERSION,
  labelInstallOrUpdate,
  needsShortcutCta,
  openShortcutInstallUrl,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "../settings/captureShortcut";
import {
  DailyNotesDisabledError,
  getPastDailyNotesWithUnmarkedCaptures,
  openTodaysDaily,
} from "../pipeline/daily";
import {
  progressLabel,
  progressPercent,
  snippetCapture,
  type RunPhase,
} from "./runProgress";

export const ATOMS_HOME_VIEW_TYPE = "atoms-home";

const LS_UPDATE_NOTES_DISMISSED_Q = "atoms-update-notes-dismissed-q";

type FilterMode = "all" | "linked";

/**
 * Undocumented core settings modal — used by many plugins to deep-link.
 * Not on the public App type; keep a narrow local interface (no `any`).
 */
type SettingsModalApi = {
  open: () => void | Promise<void>;
  openTabById: (id: string) => void;
};

function openPluginSettingsTab(app: object, tabId: string): void {
  const setting = (app as { setting?: SettingsModalApi }).setting;
  if (!setting) return;
  void Promise.resolve(setting.open()).then(() => {
    setting.openTabById(tabId);
  });
}

/**
 * Mobile-first Atoms home: library when clear, wait card when pending,
 * first-day setup when empty.
 */
export class AtomsHomeView extends ItemView {
  plugin: AtomsPlugin;
  private filter: FilterMode = "all";
  private entries: AtomLibraryEntry[] = [];
  private unprocessedCount = 0;
  /** Linker atoms below CURRENT quality (for Update notes strip). */
  private eligibleUpdateCount = 0;
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
  /**
   * In-home detail — null when showing main home.
   * Discriminated: generic atom open vs mind-change pair-open (v2).
   */
  private homeOpen:
    | {
        kind: "atom";
        path: string;
        title: string;
        body: string;
        lines: CitatorLine[];
      }
    | {
        kind: "mind-change-pair";
        thenPath: string;
        thenBody: string;
        thenDate?: string;
        nowPath: string;
        nowTitle: string;
        nowBody: string;
        nowDate?: string;
        relation: SupersessionRelation;
        /** True if hero Open already called noteMindChangeInteraction. */
        interactionNoted: boolean;
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

  /** Start a home-visible run (Preview, Process, or Update notes). */
  beginRun(phase: "preview" | "process" | "update"): void {
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
    const phase: "preview" | "process" | "update" =
      this.runPhase === "preview"
        ? "preview"
        : this.runPhase === "update"
          ? "update"
          : "process";
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

  private noteMindChangePairPaths(
    thenPath: string,
    nowPath: string,
    relation: SupersessionRelation,
  ): void {
    this.noteMindChangeInteraction({
      path: thenPath,
      laterPath: nowPath || undefined,
      cue: "mind-change",
      title: "",
      bodySnippet: "",
      matchDate: "",
      relation,
    });
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
    this.eligibleUpdateCount = countEligibleUpdateNotes(
      inputs.map((i) => i.content),
    );
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

  private dismissMindChangeHero(card: ResurfaceCandidate): void {
    this.resurfaceSkipPaths.add(card.path);
    this.noteMindChangeInteraction(card);
    this.pickNextResurface();
    this.render();
  }

  private closeHomeOpen(): void {
    this.homeOpen = null;
    this.render();
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

    sectionLabel(scroll, "For you", {
      className: "atoms-home-section atoms-home-section-for-you",
    });

    if (card.cue === "mind-change") {
      this.renderMindChangeCard(scroll, card);
      return;
    }

    const el = flatCard(scroll, {
      className: "atoms-home-resurface-card",
      role: "button",
      tabIndex: 0,
    });
    el.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest(".atoms-home-resurface-another, .atoms-ui-btn")) return;
      void this.onOpenResurface(card);
    });

    kicker(el, { text: cueLabel(card.cue) });
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
    button(el, {
      grade: "quiet",
      label: "Another",
      className: "atoms-home-resurface-another",
      attrs: { "aria-label": "Show another memory" },
      onClick: () => {
        this.resurfaceSkipPaths.add(card.path);
        this.noteResurfaceShown(card.path);
        this.pickNextResurface();
        this.render();
      },
    });
  }

  private renderMindChangeCard(
    scroll: HTMLElement,
    card: ResurfaceCandidate,
  ): void {
    const el = flatCard(scroll, {
      className: "atoms-home-resurface-card atoms-home-mind-change-card",
    });
    kicker(el, {
      text: cueLabel("mind-change"),
      variant: "mind",
      className: "atoms-home-mind-change-kicker",
    });
    claimQuote(el, {
      text: claimBodyForDisplay(card.bodySnippet),
      maxLines: 4,
      className: "atoms-home-resurface-snippet",
    });
    if (card.laterTitle) {
      const dayDelta =
        card.matchDate && card.laterMatchDate
          ? calendarDayDelta(card.matchDate, card.laterMatchDate)
          : null;
      const { prefix, title } = mindChangeHeroLaterLineParts({
        laterTitle: card.laterTitle,
        relation: card.relation ?? "revises",
        dayDelta,
      });
      const laterEl = el.createEl("p", {
        cls: "atoms-home-mind-change-later",
      });
      laterEl.appendText(`${prefix}: `);
      laterEl.createSpan({
        cls: "atoms-home-mind-change-later-title",
        text: title,
      });
    }
    const actions = actionRow(el, {
      className: "atoms-home-mind-change-actions",
    });
    button(actions, {
      grade: "primary",
      label: "Open",
      className: "atoms-home-mind-change-open",
      onClick: () => {
        this.noteMindChangeInteraction(card);
        this.openMindChangePair(card, true);
      },
    });
    button(actions, {
      grade: "secondary",
      label: "Next",
      className: "atoms-home-mind-change-next",
      onClick: () => this.dismissMindChangeHero(card),
    });
    button(actions, {
      grade: "quiet",
      label: "Not a mind-change",
      className: "atoms-home-mind-change-reject",
      onClick: () => this.dismissMindChangeHero(card),
    });
  }

  private readAtomBody(path: string): string {
    const file = this.atomFileInputs.find((f) => f.path === path);
    if (!file) return "";
    return bodyAfterFrontmatter(file.content).trim();
  }

  private openMindChangePair(
    card: ResurfaceCandidate,
    interactionNoted: boolean,
  ): void {
    const thenPath = card.path;
    const nowPath = card.laterPath ?? "";
    const thenBody =
      claimBodyForDisplay(this.readAtomBody(thenPath) || card.bodySnippet);
    const nowBody = nowPath
      ? claimBodyForDisplay(this.readAtomBody(nowPath))
      : "…";
    this.homeOpen = {
      kind: "mind-change-pair",
      thenPath,
      thenBody: thenBody.slice(0, 1200),
      thenDate: card.matchDate || undefined,
      nowPath,
      nowTitle: (card.laterTitle ?? "").trim() || "Untitled",
      nowBody: nowBody.slice(0, 1200),
      nowDate: card.laterMatchDate || undefined,
      relation: card.relation ?? "revises",
      interactionNoted,
    };
    this.render();
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
    const lines = citatorLinesForAtom(self, indexed);
    this.homeOpen = {
      kind: "atom",
      path: self.path,
      title: self.title,
      body: claimBodyForDisplay(
        bodyAfterFrontmatter(file.content).trim() || self.bodySnippet,
      ),
      lines,
    };
    this.render();
  }

  private renderHomeOpen(scroll: HTMLElement): void {
    const open = this.homeOpen;
    if (!open) return;
    if (open.kind === "mind-change-pair") {
      this.renderMindChangePair(scroll, open);
      return;
    }
    backLink(scroll, {
      label: "‹ Back",
      className: "atoms-home-back",
      onClick: () => this.closeHomeOpen(),
    });
    scroll.createEl("h2", {
      cls: "atoms-home-open-title",
      text: open.title,
    });
    if (open.lines.length) {
      const ribbon = scroll.createDiv({
        cls: "atoms-home-citator-ribbon",
        attr: { "aria-label": "Belief history" },
      });
      for (const line of open.lines) {
        citatorLine(ribbon, {
          relationLabel: line.relationLabel,
          peerTitle: line.peerTitle,
          onPeerClick: () => {
            void this.openAtomInHome(line.peerPath);
          },
        });
      }
    }
    claimQuote(scroll, {
      text: open.body.slice(0, 1200),
      maxLines: 8,
      className: "atoms-home-open-body",
    });
    button(scroll, {
      grade: "secondary",
      label: "Open in vault",
      className: "atoms-home-open-vault",
      onClick: () => {
        void this.openPathInVault(open.path);
      },
    });
  }

  private renderMindChangePair(
    scroll: HTMLElement,
    open: Extract<NonNullable<AtomsHomeView["homeOpen"]>, { kind: "mind-change-pair" }>,
  ): void {
    const wrap = scroll.createDiv({ cls: "atoms-home-pair" });
    backLink(wrap, {
      label: "‹ Back",
      className: "atoms-home-back",
      onClick: () => this.closeHomeOpen(),
    });

    const thenCard = flatCard(wrap, { className: "atoms-home-pair-claim" });
    if (open.thenDate) {
      thenCard.createEl("p", {
        cls: "atoms-home-pair-date",
        text: formatCueDate(open.thenDate),
      });
    }
    claimQuote(thenCard, { text: open.thenBody || "…", maxLines: 8 });

    const connector = wrap.createDiv({ cls: "atoms-home-pair-connector" });
    connector.createSpan({
      cls: "atoms-home-pair-connector-label",
      text: mindChangeConnectorLabel(open.relation),
    });

    const nowCard = flatCard(wrap, { className: "atoms-home-pair-claim" });
    if (open.nowDate) {
      nowCard.createEl("p", {
        cls: "atoms-home-pair-date",
        text: formatCueDate(open.nowDate),
      });
    }
    nowCard.createEl("p", {
      cls: "atoms-home-pair-title",
      text: open.nowTitle,
    });
    claimQuote(nowCard, {
      text: open.nowBody || "…",
      maxLines: 8,
    });

    const actions = actionRow(wrap, { className: "atoms-home-pair-actions" });
    button(actions, {
      grade: "primary",
      label: "Open in vault",
      onClick: () => {
        void this.openPathInVault(open.thenPath);
      },
    });
    button(actions, {
      grade: "secondary",
      label: "Done",
      onClick: () => {
        if (!open.interactionNoted) {
          this.noteMindChangePairPaths(
            open.thenPath,
            open.nowPath,
            open.relation,
          );
        }
        this.closeHomeOpen();
      },
    });
    button(actions, {
      grade: "quiet",
      label: "Not a mind-change",
      onClick: () => {
        this.resurfaceSkipPaths.add(open.thenPath);
        this.noteMindChangePairPaths(
          open.thenPath,
          open.nowPath,
          open.relation,
        );
        this.homeOpen = null;
        this.pickNextResurface();
        this.render();
      },
    });
  }

  private async openPathInVault(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    } else {
      new Notice("Atoms: note not found");
    }
  }

  private async onOpenResurface(card: ResurfaceCandidate): Promise<void> {
    this.noteResurfaceShown(card.path);
    if (card.cue === "mind-change") {
      this.noteMindChangeInteraction(card);
      this.openMindChangePair(card, true);
      return;
    }
    await this.openPathInVault(card.path);
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
      openPluginSettingsTab(this.app, "atoms");
    });

    // One calm subtitle per state — no product jargon
    const subtitle = firstDay
      ? "Capture starts in your daily note"
      : this.runPhase !== "idle"
        ? this.runPhase === "preview"
          ? "Previewing…"
          : this.runPhase === "process"
            ? "Filing…"
            : this.runPhase === "update"
              ? "Updating…"
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

    if (this.runPhase !== "idle") {
      const tone =
        this.runPhase === "error"
          ? "error"
          : this.runPhase === "done"
            ? "done"
            : "progress";
      const prog = statusCard(scroll, {
        tone,
        className:
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

      const card = statusCard(scroll, {
        tone: "wait",
        className: "atoms-home-wait-card",
      });
      card.createEl("p", {
        cls: "atoms-home-card-eyebrow",
        text: hero.eyebrow,
      });
      card.createEl("h2", { text: hero.title });
      card.createEl("p", { text: hero.body });
      const actions = actionRow(card, {
        className: "atoms-home-wait-actions",
      });

      const bindAction = (
        label: string | null,
        action: FilingHeroCopy["primaryAction"] | FilingHeroCopy["secondaryAction"],
        primary: boolean,
      ) => {
        if (!label || !action) return;
        button(actions, {
          grade: primary ? "primary" : "secondary",
          label: this.busy ? "…" : label,
          disabled: this.busy,
          onClick: () => {
            if (action === "open_settings") {
              openPluginSettingsTab(this.app, "atoms");
              return;
            }
            if (action === "enable_auto") {
              this.confirmEnableAutomaticFiling();
              return;
            }
            if (action === "preview") void this.onPreview(false);
            if (action === "process") void this.onProcess(false);
          },
        });
      };

      bindAction(hero.primaryLabel, hero.primaryAction, true);
      bindAction(hero.secondaryLabel, hero.secondaryAction, false);

      // enable_auto already has Process secondary — also offer Preview
      if (hero.mode === "enable_auto" && hero.secondaryAction !== "preview") {
        button(actions, {
          grade: "secondary",
          label: this.busy ? "…" : "Preview",
          disabled: this.busy,
          onClick: () => void this.onPreview(false),
        });
      }

      if (this.peek.length) {
        sectionLabel(scroll, "In your dailies", {
          className: "atoms-home-queue-label",
        });
        const peekList = listGroup(scroll, {
          className: "atoms-home-list atoms-home-list-peek",
        });
        for (const p of this.peek) {
          const row = listRow(peekList, { className: "atoms-home-qcell" });
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

    // Show when not mid-run (idle/done/error). Hide only during preview/process/update.
    if (
      !firstDay &&
      this.runPhase !== "preview" &&
      this.runPhase !== "process" &&
      this.runPhase !== "update" &&
      this.shouldShowUpdateNotesStrip()
    ) {
      this.renderUpdateNotesStrip(scroll);
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
      button(banner, {
        grade: "secondary",
        label: this.shortcutAcked == null ? "Install" : "Update",
        className: "atoms-home-update-btn",
        onClick: () => this.onInstallShortcut(),
      });
    }

    if (firstDay) {
      const setup = flatCard(scroll, { className: "atoms-home-setup-card" });
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

      const actions = actionRow(setup, {
        className: "atoms-home-setup-actions",
      });
      button(actions, {
        grade: "primary",
        label: "Open today",
        onClick: () => void this.onOpenToday(),
      });
      button(actions, {
        grade: "secondary",
        label: labelInstallOrUpdate(this.shortcutAcked),
        disabled: !this.installUrl(),
        attrs: !this.installUrl()
          ? {
              title:
                "Paste an iCloud link in Settings → Capture first",
            }
          : undefined,
        onClick: () => this.onInstallShortcut(),
      });
    }

    // Library — secondary surface
    if (!firstDay || this.entries.length > 0) {
      const libHead = scroll.createDiv({ cls: "atoms-home-lib-head" });
      sectionLabel(libHead, "Library", {
        className: "atoms-home-section",
      });
      filterTabs(libHead, {
        className: "atoms-home-filters",
        modes: [
          { id: "all", label: "All" },
          { id: "linked", label: "Linked" },
        ],
        active: this.filter,
        onChange: (id) => {
          this.filter = id as FilterMode;
          this.render();
        },
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
      const list = listGroup(scroll, { className: "atoms-home-list" });
      const now = Date.now();
      for (const e of visible) {
        const row = listRow(list, {
          className: "atoms-home-cell",
          role: "button",
          onClick: () => {
            void this.app.workspace.openLinkText(e.title, e.path, false);
          },
        });
        const main = row.createDiv({ cls: "atoms-home-cell-main" });
        main.createDiv({ cls: "atoms-home-cell-title", text: e.title });
        const meta = main.createDiv({ cls: "atoms-home-cell-meta" });
        for (const chip of e.displayChips) {
          linkChip(meta, {
            label: chip.label,
            kind: chip.role === "person" ? "person" : "work",
            className:
              "atoms-home-link-chip" +
              (chip.role === "person" ? " is-person" : " is-work"),
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

  private dismissedUpdateQuality(): number {
    const raw = this.app.loadLocalStorage(LS_UPDATE_NOTES_DISMISSED_Q);
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      return Number.parseInt(raw, 10);
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    return -1;
  }

  private shouldShowUpdateNotesStrip(): boolean {
    if (this.eligibleUpdateCount <= 0) return false;
    if (this.dismissedUpdateQuality() >= CURRENT_ATOMS_QUALITY) return false;
    return true;
  }

  private renderUpdateNotesStrip(scroll: HTMLElement): void {
    const batch = Math.min(
      this.eligibleUpdateCount,
      UPDATE_NOTES_BATCH_LIMIT,
    );
    const copy = updateNotesStripCopy(this.eligibleUpdateCount);
    const card = flatCard(scroll, { className: "atoms-home-update-notes" });
    card.createEl("h2", { text: copy.title });
    card.createEl("p", { text: copy.body });
    const actions = actionRow(card, {
      className: "atoms-home-wait-actions",
    });
    button(actions, {
      grade: "primary",
      label: this.busy ? "…" : copy.button,
      disabled: this.busy,
      onClick: () => this.confirmUpdateNotes(batch),
    });
    button(actions, {
      grade: "quiet",
      label: "Not now",
      disabled: this.busy,
      onClick: () => {
        this.app.saveLocalStorage(
          LS_UPDATE_NOTES_DISMISSED_Q,
          String(CURRENT_ATOMS_QUALITY),
        );
        this.render();
      },
    });
  }

  private confirmUpdateNotes(batchCount: number): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText("Filing got smarter");
    modal.contentEl.createEl("p", {
      text: updateNotesConfirmCopy(batchCount),
    });
    new Setting(modal.contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => modal.close()),
      )
      .addButton((b) =>
        b
          .setButtonText("Update")
          .setCta()
          .onClick(() => {
            modal.close();
            void this.plugin.runUpdateNotes();
          }),
      );
    modal.open();
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
