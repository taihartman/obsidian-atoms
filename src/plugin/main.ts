import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";
import { ATOMS_HOME_VIEW_TYPE, AtomsHomeView } from "../home/atomsHomeView";
import {
  drainInbox,
  ensureInboxBookmark,
  ensureInboxNote,
  INBOX_NOTE_PATH,
  type InboxBookmarkResult,
  type InboxDrainResult,
} from "../pipeline/inbox";
import {
  LS_INBOX_BOOKMARK_NOTICE_ACK,
  shouldShowBookmarkSetupNotice,
} from "./inboxBootstrap";
import { clampAtomFolder } from "../pipeline/render";
import { registerAtomsCommands } from "./commands";
import type { AskOutboxOutcome } from "./catchUp";
import type { MirrorSyncOutcome } from "../shared/mirrorOutcome";
import { AskCoordinator } from "./askCoordinator";
import { fireAndForgetAsk } from "../shared/fireAndForget";
import { runOpenAtomGraph } from "../graph/openAtomGraph";

/** Injected by esbuild: true in watch/dev, false in production Community builds. */
declare const ATOMS_DEV_COMMANDS: boolean;

/** Dev diagnostics hook — no-op (Community plugin scan forbids console). */
function devLog(..._args: unknown[]): void {
  void _args;
  void ATOMS_DEV_COMMANDS;
}
import {
  classifyCapture,
  logClassifyOutcome,
  buildMessagesRequest,
  buildDayBatchRequest,
  buildContextUserMessage,
  parseUsage,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
} from "../pipeline/classify";
import {
  MetadataContextProvider,
  shortlistOptionsFromSettings,
} from "../pipeline/context";
import {
  DailyNotesDisabledError,
  getPastDailyNotesWithUnmarkedCaptures,
} from "../pipeline/daily";
import { AtomsSettingTab } from "../settings/settings";
import {
  API_KEY_SECRET_ID_DEFAULT,
  DEFAULT_SETTINGS,
  LOCAL_STORAGE_API_KEY,
  SPIKE_CAPTURE,
  SPIKE_CONTEXT,
  type ClassifyOutcome,
  type LinkerSettings,
} from "../shared/types";
import {
  DryRunPreviewModal,
  mergeProposedFromReport,
  renderPreviewMarkdown,
  runDryRun,
  showDryRunNotice,
  type DryRunReport,
} from "../pipeline/preview";
import {
  applyReconsiderWrite,
  atomRefuseNotice,
  dailyDateForFile,
  findCaptureAtLine,
  filedNotice,
  forceKeepAtomResult,
  collisionNotice,
  gateReconsiderTarget,
  missNotice,
} from "../pipeline/reconsider";
import { ReconsiderModal } from "../pipeline/reconsiderModal";
import { resolveSkippedCapture } from "../pipeline/reconsider";
import { runWritePath, type WritePathReport } from "../pipeline/write";
import type { ClassificationResult } from "../shared/types";
import { mergeProposedTags } from "../pipeline/vocabulary";
import {
  formatRunSummary,
  summaryFromDryRun,
  summaryFromWrite,
} from "../home/runProgress";
import {
  buildLandPeak,
  landAtomsFromRefreshItems,
  landAtomsFromWriteEntries,
  type LandPeak,
} from "../home/landPeak";
import {
  canBuildContext,
  enableAutomaticFiling,
  localDateString,
  PER_LAUNCH_CAP,
  readDeviceAutoRunState,
  shouldRunAutoProcess,
  shouldStampLastRunDay,
  waitForVaultIndexReady,
  writeLastRunDay,
  type DeviceAutoRunState,
} from "../platform/autorun";
import {
  appendFilingBudgetStamps,
  backlogGateCleared,
  decideResumeStages,
  formatLastCatchupLine,
  readBacklogGate,
  readEgressNoticeAcked,
  readFilingBudgetStamps,
  readLastCatchup,
  readResumeEnabled,
  readStageTiming,
  writeBacklogGate,
  writeEgressNoticeAcked,
  writeLastCatchup,
  writeResumeEnabled,
  writeStageTiming,
  BACKLOG_GATE_THRESHOLD,
  type ResumeStage,
  type StageTimingState,
} from "../platform/resume";
import {
  readPlusSession,
  resolveFilingAuth,
  writePlusSession,
  type FilingAuth,
} from "../platform/filingAuth";
import { resolveClassifyAuth } from "../platform/classifyAuth";
import { CURRENT_ATOMS_QUALITY } from "../pipeline/atomQuality";
import {
  formatConnectivityConsole,
  runConnectivityTest,
  type ConnectivityReport,
} from "../platform/connectivity";
import {
  applyBackfillResults,
  BackfillConfirmModal,
  DEFAULT_BACKFILL_MODEL,
  fetchBatchResultsJsonl,
  parseBatchResultsJsonl,
  prepareBackfillEstimate,
  runBackfillChunks,
  submitMessageBatch,
  waitForBatchEnded,
  type ApplyBackfillReport,
  type CostEstimate,
} from "../pipeline/backfill";
import {
  listLinkerAtoms,
  runRefreshEligibleAtoms,
  type RefreshReport,
} from "../pipeline/refreshAtoms";
import { isEligibleForUpdate } from "../pipeline/atomQuality";
import { formatUpdateSummary } from "../home/runProgress";
import { stripLegacyAskMirrorHashes } from "../platform/askMirror";

export default class AtomsPlugin extends Plugin {
  settings!: LinkerSettings;
  contextProvider!: MetadataContextProvider;
  /** Ask mirror + outbox orchestration (single owner of inFlight state). */
  ask!: AskCoordinator;
  /** Last classify outcome for CLI/dev inspection (no secrets). */
  lastClassifyOutcome: ClassifyOutcome | null = null;
  /** Last dry-run report for CLI inspection (no vault writes). */
  lastDryRunReport: DryRunReport | null = null;
  lastDryRunMarkdown: string | null = null;
  /** Last write-path report for CLI inspection. */
  lastWriteReport: WritePathReport | null = null;
  /** Last connectivity test (no secrets). */
  lastConnectivityReport: ConnectivityReport | null = null;
  /** Last backfill estimate / apply report (CLI). */
  lastBackfillEstimate: CostEstimate | null = null;
  lastBackfillReport: ApplyBackfillReport | null = null;
  lastBackfillBatchId: string | null = null;
  /** Last Update notes refresh report (CLI). */
  lastRefreshReport: RefreshReport | null = null;
  /** Guards double-fire of onload + interval auto-run. */
  private autoRunInFlight = false;
  private backfillInFlight = false;
  /**
   * Shared in-flight drain (F1). Both entry points — bootstrapInbox (unawaited
   * from onLayoutReady) and runDrainInbox (command) — go through drainInboxOnce,
   * so a concurrent caller JOINS the running pass instead of racing it into a
   * duplicate append.
   */
  private drainInFlight: Promise<InboxDrainResult> | null = null;
  /** Set true only after waitForVaultIndexReady (U9 cold-start gate). */
  private vaultIndexReady = false;
  /** Resume catch-up coalescing / cooldown state (in-memory). */
  private lastResumePassAt: number | null = null;
  private resumeCoalesceTimer: number | null = null;
  private waiverUsedThisSignal = false;
  private waivedFilingStamps: number[] = [];
  private catchUpInFlight = false;
  /** Drain filed count not yet consumed by a successful filing pass. */
  private pendingNewDrainWork = 0;
  /** Real start times for in-flight stages (liveness). */
  private drainStartedAt: number | null = null;
  private filingStartedAt: number | null = null;
  /** Suppress resume until cold-start bootstrap + index settle (U5). */
  private resumeListenersArmed = false;
  /** One deferred pass after vaultIndexReady if focus arrived early. */
  private pendingResumeWhenReady = false;

  async onload() {
    await this.loadSettings();
    this.contextProvider = new MetadataContextProvider(
      this.app,
      () => this.settings.activeVocabulary,
    );
    this.addSettingTab(new AtomsSettingTab(this.app, this));

    this.registerView(ATOMS_HOME_VIEW_TYPE, (leaf) => new AtomsHomeView(leaf, this));
    this.addRibbonIcon("library", "Open Atoms", () => {
      void this.activateAtomsHome();
    });

    this.registerCommands();

    // Pin Atoms home in the left sidebar (Files / Search / Tags strip) on
    // enable and cold start — same pattern as core sidebar plugins.
    this.app.workspace.onLayoutReady(() => {
      void this.ensureAtomsHomeSidebar({ reveal: false });
    });

    // U5: ensure the capture inbox note + bookmark exist, then drain any
    // pending captures into their dailies. Best-effort — never blocks launch.
    this.app.workspace.onLayoutReady(() => {
      void this.bootstrapInbox();
    });

    // U9: never block launch — schedule auto-run after layout + metadata.
    void this.scheduleAutoRunLifecycle();

    // Plus: resume entitlement poll after Stripe Checkout (awaitingCheckout).
    const { schedulePlusCheckoutResume } = await import(
      "../platform/plusResume"
    );
    schedulePlusCheckoutResume(this);

    // Ask outbox + mirror catch-up when vault is open (coordinator owns state).
    this.ask = new AskCoordinator(this);
    this.ask.registerLifecycle();

    // Resume listeners armed after vault index ready (avoids vault_not_ready drop).
    // U0: plusResume already ships these signals on mobile webviews.
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) return;
      this.onResumeSignal();
    });
    this.registerDomEvent(window, "focus", () => {
      this.onResumeSignal();
    });
  }

  /**
   * Ensure the capture inbox note + bookmark exist, then drain pending captures
   * into their dailies (U5). Every step is best-effort: a missing Bookmarks
   * plugin, a daily-notes hiccup, or a drain error must never throw into load.
   */
  private async bootstrapInbox(): Promise<void> {
    // Gate on the same signal cold-start auto-run uses (F2). onLayoutReady does
    // not mean the vault is indexed: ensureInboxNote could create a fresh inbox
    // before Sync delivers the real one, and ensureDailyForDate reads
    // getAllDailyNotes() against a half-built index. Non-blocking — this whole
    // method runs unawaited from onLayoutReady.
    await waitForVaultIndexReady(this.app);

    try {
      await ensureInboxNote(this.app);
    } catch (e) {
      // best-effort — inbox capture degrades to a manual note create
      devLog("[atoms] inbox ensure-note failed", {
        message: e instanceof Error ? e.message : "error",
      });
    }
    try {
      const bookmark = await ensureInboxBookmark(this.app);
      this.maybeShowBookmarkSetupNotice(bookmark);
    } catch (e) {
      // best-effort — user can bookmark the note by hand
      devLog("[atoms] inbox ensure-bookmark failed", {
        message: e instanceof Error ? e.message : "error",
      });
    }
    try {
      const r = await this.drainInboxOnce();
      devLog("[atoms] inbox bootstrap drain", {
        filed: r.filed,
        held: r.held,
        pending: r.pending,
        inferred: r.inferred,
      });
      await this.refreshAtomsHomeLeaves();
    } catch (e) {
      // best-effort — pending captures wait for the next drain
      devLog("[atoms] inbox bootstrap drain failed", {
        message: e instanceof Error ? e.message : "error",
      });
    }
  }

  /**
   * Serialize drains (F1): a concurrent caller joins the running pass rather
   * than kicking off a second read-modify-write that would double-append the
   * same capture. Cleared in finally so the next drain starts fresh.
   */
  private drainInboxOnce(): Promise<InboxDrainResult> {
    if (this.drainInFlight) return this.drainInFlight;
    this.drainStartedAt = Date.now();
    const pass = drainInbox(this.app).finally(() => {
      this.drainInFlight = null;
      this.drainStartedAt = null;
    });
    this.drainInFlight = pass;
    return pass;
  }

  /**
   * One-time setup notice (F3): when the Bookmarks core plugin is unavailable
   * the bookmark is never created, so the iOS Shortcut has no target. Name the
   * exact path to bookmark by hand, then ack so a permanently-disabled Bookmarks
   * plugin does not nag on every load.
   */
  private maybeShowBookmarkSetupNotice(result: InboxBookmarkResult): void {
    const acked =
      this.app.loadLocalStorage(LS_INBOX_BOOKMARK_NOTICE_ACK) === true;
    if (!shouldShowBookmarkSetupNotice(result, acked)) return;
    new Notice(
      `Atoms: bookmark "${INBOX_NOTE_PATH}" by hand — the Bookmarks core plugin is off, so iOS capture has no target until you do.`,
      10000,
    );
    this.app.saveLocalStorage(LS_INBOX_BOOKMARK_NOTICE_ACK, true);
  }

  /** Manual drain (command). Surfaces a count so a stuck drain is visible. */
  async runDrainInbox(): Promise<void> {
    try {
      const r = await this.drainInboxOnce();
      const parts = [`${r.filed} filed`];
      if (r.held) parts.push(`${r.held} held (future)`);
      if (r.pending) parts.push(`${r.pending} pending`);
      new Notice(`Atoms inbox: ${parts.join(", ")}`);
      await this.refreshAtomsHomeLeaves();
    } catch (e) {
      new Notice(
        `Atoms: inbox drain failed — ${e instanceof Error ? e.message.slice(0, 80) : "error"}`,
      );
    }
  }

  /** Debounced best-effort push after vault or pipeline writes. */
  scheduleAskMirrorSync(): void {
    this.ask.scheduleSync();
  }

  /**
   * Ensure an Atoms home leaf exists in the left sidebar.
   * @param reveal When true, focus the leaf (ribbon / command). When false,
   *   only create the tab if missing so first install gets the panel without
   *   stealing focus from the open note on every launch.
   */
  private async ensureAtomsHomeSidebar(opts?: {
    reveal?: boolean;
  }): Promise<WorkspaceLeaf> {
    const reveal = opts?.reveal ?? false;
    const leaf = await this.app.workspace.ensureSideLeaf(
      ATOMS_HOME_VIEW_TYPE,
      "left",
      {
        // Only force-select when the user asked (ribbon / command).
        active: reveal,
        reveal,
      },
    );
    if (reveal) {
      const view = leaf.view;
      if (view instanceof AtomsHomeView) {
        await view.refresh();
      }
    }
    return leaf;
  }

  async activateAtomsHome(): Promise<void> {
    await this.ensureAtomsHomeSidebar({ reveal: true });
  }

  /** Called from Atoms home Preview — same dry-run as command. */
  async runDryRunFromHome(opts?: { includeToday?: boolean }): Promise<void> {
    await this.runDryRunPreview(opts);
  }

  /** Called from Atoms home Process — same write path as command. */
  async runProcessFromHome(opts?: { includeToday?: boolean }): Promise<void> {
    // finishHomeRun already refreshes open home leaves
    await this.runProcessUnprocessed(opts);
  }

  /** Reload every open Atoms home leaf (after process / dry-run writes). */
  async refreshAtomsHomeLeaves(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(ATOMS_HOME_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AtomsHomeView) {
        await view.refresh();
      }
    }
  }

  /** Broadcast progress to every open Atoms home leaf (no-op if none open). */
  private forEachAtomsHome(fn: (view: AtomsHomeView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ATOMS_HOME_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AtomsHomeView) fn(view);
    }
  }

  private beginHomeRun(phase: "preview" | "process" | "update"): void {
    this.forEachAtomsHome((v) => v.beginRun(phase));
  }

  private updateHomeProgress(
    done: number,
    total: number,
    captureText?: string,
  ): void {
    this.forEachAtomsHome((v) =>
      v.updateRunProgress(done, total, captureText),
    );
  }

  private finishHomeRun(
    summaryText: string,
    landPeak?: LandPeak | null,
  ): void {
    this.forEachAtomsHome((v) => v.finishRun(summaryText, landPeak));
  }

  private hasOpenAtomsHome(): boolean {
    return this.app.workspace.getLeavesOfType(ATOMS_HOME_VIEW_TYPE).length > 0;
  }

  private landPeakFromWrite(
    report: WritePathReport,
    source: "process" | "autorun",
  ): LandPeak {
    const atoms = landAtomsFromWriteEntries(report.entries);
    return buildLandPeak({
      source,
      atoms,
      markersAppended: report.markersAppended,
    });
  }

  private failHomeRun(message?: string): void {
    this.forEachAtomsHome((v) => v.failRun(message));
  }

  /** Called from Atoms home ⋯ menu. */
  async runTestConnectionFromHome(): Promise<void> {
    await this.runTestConnection();
  }

  /** Called from Atoms home ⋯ menu. */
  async runBackfillFromHome(): Promise<void> {
    await this.runBackfillFlow();
  }

  /**
   * Update notes — refresh eligible older atoms to Process parity (Issue #29).
   * User-initiated only; never from auto-run.
   */
  async runUpdateNotes(opts?: {
    fixtureResults?: import("../shared/types").ClassificationResult[];
    limit?: number;
  }): Promise<void> {
    const usingFixtures = !!(opts?.fixtureResults && opts.fixtureResults.length);
    const linker = await listLinkerAtoms(this.app, this.settings.atomFolder);
    const needsApi =
      usingFixtures || linker.some((a) => isEligibleForUpdate(a.content));
    let apiKey = usingFixtures
      ? this.getApiKey() || "fixture"
      : this.getApiKey() || "polish-only";
    let plusDeps: import("../pipeline/classify").ClassifyDeps["plus"];
    if (needsApi && !usingFixtures) {
      const classifyAuth = this.requireClassifyAuth();
      if (!classifyAuth) return;
      apiKey = classifyAuth.apiKey || "plus";
      plusDeps = classifyAuth.plus;
    } else if (needsApi && !apiKey) {
      return;
    }

    this.beginHomeRun("update");
    new Notice(
      needsApi
        ? "Atoms: updating older notes…"
        : "Atoms: cleaning up link wording…",
    );
    try {
      const report = await runRefreshEligibleAtoms({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey: apiKey || "polish-only",
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        // Retrieval size only — refresh forces `expandGraph: false` for itself (KTD7).
        shortlistK: shortlistOptionsFromSettings().shortlistK,
        limit: opts?.limit,
        fixtureResults: opts?.fixtureResults,
        enableHubProjection: this.settings.enableHubProjection === true,
        classifyDeps: {
          maxAttempts: 2,
          plus: plusDeps,
          onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
        },
        onProgress: (done, total, meta) => {
          this.updateHomeProgress(done, total, meta?.captureText);
        },
      });
      this.lastRefreshReport = report;
      const polished = report.polished ?? 0;
      const summary = formatUpdateSummary(
        report.updated,
        report.failed,
        polished,
      );
      const refileAtoms = landAtomsFromRefreshItems(
        report.updatedItems ?? [],
      );
      const polishAtoms = landAtomsFromRefreshItems(
        report.polishedItems ?? [],
      );
      const landPeak = buildLandPeak({
        source: "update",
        atoms: refileAtoms.length > 0 ? refileAtoms : polishAtoms,
        failedCount: report.failed,
        polishedCount: polished,
        updatedCount: report.updated,
      });
      this.finishHomeRun(summary, landPeak);
      new Notice(
        report.failed > 0 && report.updated <= 0 && polished <= 0
          ? `Atoms: couldn't update ${report.failed} note${report.failed === 1 ? "" : "s"} — check model id and API key`
          : `Atoms: polished ${polished}, updated ${report.updated}, renamed ${report.renamed}, failed ${report.failed}`,
      );
      // After projection + atom writes settle — end-of-run push (hubs included).
      fireAndForgetAsk(this.syncAskMirror({ force: false }));
      fireAndForgetAsk(this.applyAskOutbox());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "update failed";
      this.failHomeRun(msg);
      new Notice(`Atoms: ${msg.slice(0, 100)}`);
    }
  }

  /** Open/create today's daily and show it in the editor. */
  async openTodaysDailyFromHome(): Promise<void> {
    try {
      const { openTodaysDaily } = await import("../pipeline/daily");
      const file = await openTodaysDaily(this.app);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(
        e instanceof Error ? e.message : "Could not open today's daily note",
      );
    }
  }

  onunload() {
    this.autoRunInFlight = false;
    this.catchUpInFlight = false;
    this.drainInFlight = null;
    if (this.resumeCoalesceTimer != null) {
      window.clearTimeout(this.resumeCoalesceTimer);
      this.resumeCoalesceTimer = null;
    }
  }

  private onResumeSignal(): void {
    if (!this.resumeListenersArmed || !this.vaultIndexReady) {
      this.pendingResumeWhenReady = true;
      return;
    }
    this.scheduleResumeCatchUp();
  }

  /** Leading-edge coalesce for visibility+focus (KTD4). */
  private scheduleResumeCatchUp(): void {
    if (this.resumeCoalesceTimer != null) return;
    this.waiverUsedThisSignal = false;
    this.resumeCoalesceTimer = window.setTimeout(() => {
      this.resumeCoalesceTimer = null;
      void this.runCatchUpPass({ manual: false, silent: true });
    }, 750);
  }

  private stageInput(
    load: (k: string) => unknown,
    opts: { manual: boolean; now: number },
  ) {
    const timing = readStageTiming(load);
    const backlog = this.lastInboxPendingCount;
    return {
      now: opts.now,
      resumeEnabled: readResumeEnabled(load),
      manual: opts.manual,
      vaultIndexReady: this.vaultIndexReady,
      egressNoticeAcked: readEgressNoticeAcked(load),
      lastResumePassAt: this.lastResumePassAt,
      lastStageRunAt: timing.lastRun,
      lastStageFailAt: timing.lastFail,
      inFlightStartedAt: {
        drain: this.drainStartedAt,
        filing: this.filingStartedAt,
      },
      filingBudgetStamps: readFilingBudgetStamps(load, opts.now),
      waivedFilingStamps: this.waivedFilingStamps,
      hasNewDrainedWork: this.pendingNewDrainWork > 0,
      waiverUsedThisSignal: this.waiverUsedThisSignal,
      backlogStrandedCount: backlog,
      backlogGateCleared: backlogGateCleared(readBacklogGate(load)),
    };
  }

  private stampStage(
    save: (k: string, v: unknown) => void,
    load: (k: string) => unknown,
    stage: ResumeStage,
    kind: "run" | "fail",
    at: number = Date.now(),
  ): void {
    const t = readStageTiming(load);
    const next: StageTimingState =
      kind === "run"
        ? { lastRun: { ...t.lastRun, [stage]: at }, lastFail: t.lastFail }
        : { lastRun: t.lastRun, lastFail: { ...t.lastFail, [stage]: at } };
    writeStageTiming(save, next);
  }

  /** Cached for backlog gate; refreshed on catch-up. */
  private lastInboxPendingCount = 0;

  /**
   * Full catch-up chain: drain → outbox → mirror → optional filing.
   * Manual path is chatty and bypasses auto-run enable + filing cooldown (R6/KTD11).
   */
  async runCatchUpPass(opts: {
    manual: boolean;
    silent: boolean;
  }): Promise<{ ran: boolean; reason: string }> {
    const load = (k: string): unknown =>
      this.app.loadLocalStorage(k) as unknown;
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const now = Date.now();

    if (this.catchUpInFlight) {
      if (opts.manual) {
        new Notice("Atoms: catch-up already running — try again in a moment");
      }
      return { ran: false, reason: "in_flight" };
    }

    try {
      const { countInboxPending } = await import("../pipeline/inbox");
      this.lastInboxPendingCount = await countInboxPending(this.app);
    } catch {
      /* keep last */
    }

    const decision = decideResumeStages(this.stageInput(load, { ...opts, now }));

    if (
      !decision.stages.drain.run &&
      !decision.stages.outbox.run &&
      !decision.stages.mirror.run &&
      !decision.stages.filing.run
    ) {
      const reason =
        (!decision.stages.drain.run &&
          "reason" in decision.stages.drain &&
          decision.stages.drain.reason) ||
        "blocked";
      if (opts.manual && reason === "vault_not_ready") {
        new Notice("Atoms: vault still loading — try Sync everything now again");
      }
      return { ran: false, reason: String(reason) };
    }

    this.catchUpInFlight = true;
    let drained = 0;
    let outbox = 0;
    let mirrored = 0;
    let filed = 0;
    try {
      if (decision.stages.drain.run) {
        try {
          const r = await this.drainInboxOnce();
          drained = r.filed;
          if (r.filed > 0) this.pendingNewDrainWork += r.filed;
          this.stampStage(save, load, "drain", "run");
        } catch (e) {
          this.stampStage(save, load, "drain", "fail");
          devLog("[atoms] catch-up drain failed", e);
        }
      }

      const afterDrain = decideResumeStages(
        this.stageInput(load, { manual: opts.manual, now: Date.now() }),
      );

      if (decision.stages.outbox.run && this.ask) {
        try {
          const o = await this.ask.applyOutbox();
          if (o.kind === "worked" || o.kind === "joined") {
            outbox = o.landed;
          }
          if (o.kind === "failed") this.stampStage(save, load, "outbox", "fail");
          else this.stampStage(save, load, "outbox", "run");
        } catch (e) {
          this.stampStage(save, load, "outbox", "fail");
          devLog("[atoms] catch-up outbox failed", e);
        }
      }

      if (decision.stages.mirror.run && this.ask) {
        try {
          const m = await this.syncAskMirror({ force: opts.manual });
          if (m.kind === "worked") {
            mirrored = m.uploaded + m.deleted;
            this.stampStage(save, load, "mirror", "run");
          } else if (m.kind === "failed") {
            this.stampStage(save, load, "mirror", "fail");
          } else {
            this.stampStage(save, load, "mirror", "run");
          }
        } catch (e) {
          this.stampStage(save, load, "mirror", "fail");
          devLog("[atoms] catch-up mirror failed", e);
        }
      }

      if (afterDrain.stages.filing.run) {
        if (afterDrain.grantWaiver) {
          this.waiverUsedThisSignal = true;
          this.waivedFilingStamps = [
            ...this.waivedFilingStamps,
            Date.now(),
          ];
        }
        const auto = await this.maybeAutoRun(
          opts.manual ? "manual" : "resume",
          {
            // KTD11: manual catch-up files even when auto-run toggle is off.
            bypassEnabled: opts.manual,
            silentHome: opts.silent,
          },
        );
        if (auto.ran && this.lastWriteReport) {
          filed = this.lastWriteReport.markersAppended;
          if (filed > 0) {
            appendFilingBudgetStamps(load, save, Date.now(), filed);
            this.pendingNewDrainWork = Math.max(
              0,
              this.pendingNewDrainWork - filed,
            );
          }
          this.stampStage(save, load, "filing", "run");
        } else if (auto.reason === "error" || auto.reason === "missing_key") {
          this.stampStage(save, load, "filing", "fail");
        }
      } else if (opts.manual) {
        const fr = afterDrain.stages.filing;
        if ("reason" in fr && fr.reason === "egress_notice") {
          new Notice(
            "Atoms: acknowledge the catch-up notice on Atoms home before filing can spend API",
          );
        } else if ("reason" in fr && fr.reason === "budget") {
          new Notice("Atoms: filing budget full for this hour — try later");
        }
      }

      // Only burn min-interval when something actually ran cheap stages
      if (!opts.manual && (drained > 0 || outbox > 0 || mirrored > 0 || filed > 0)) {
        this.lastResumePassAt = Date.now();
      } else if (!opts.manual && decision.stages.drain.run) {
        // Empty successful pass still counts as a resume pass for debounce
        this.lastResumePassAt = Date.now();
      }

      const budgetHour = readFilingBudgetStamps(load, Date.now()).length;
      writeLastCatchup(save, {
        at: Date.now(),
        drained,
        filed,
        mirrored,
        outbox,
      });
      // stash hour count on the line via format overload
      this._lastCatchupHourFiled = budgetHour;
      await this.refreshAtomsHomeLeaves();

      if (opts.manual) {
        const bits = [
          drained && `drained ${drained}`,
          filed && `filed ${filed}`,
          outbox && `outbox ${outbox}`,
          mirrored && `mirror ${mirrored}`,
        ].filter(Boolean);
        new Notice(
          bits.length
            ? `Atoms: ${bits.join(" · ")}`
            : "Atoms: catch-up finished (nothing new)",
        );
      }

      return { ran: true, reason: "ok" };
    } finally {
      this.catchUpInFlight = false;
    }
  }

  private _lastCatchupHourFiled = 0;

  /** Manual escape hatch (R6). */
  async runSyncEverythingNow(): Promise<void> {
    const r = await this.runCatchUpPass({ manual: true, silent: false });
    if (!r.ran && r.reason === "in_flight") {
      /* already noticed */
    }
  }

  getLastCatchupLine(): string | null {
    const load = (k: string) => this.app.loadLocalStorage(k) as unknown;
    const now = Date.now();
    const hour =
      this._lastCatchupHourFiled ||
      readFilingBudgetStamps(load, now).length;
    return formatLastCatchupLine(readLastCatchup(load), now, hour);
  }

  getBacklogGatePending(): number {
    const load = (k: string) => this.app.loadLocalStorage(k) as unknown;
    if (backlogGateCleared(readBacklogGate(load))) return 0;
    return this.lastInboxPendingCount >= BACKLOG_GATE_THRESHOLD
      ? this.lastInboxPendingCount
      : 0;
  }

  answerBacklogGate(allow: boolean): void {
    writeBacklogGate(
      (k, v) => this.app.saveLocalStorage(k, v),
      allow ? "allow" : "defer",
    );
    void this.refreshAtomsHomeLeaves();
    if (allow) void this.runCatchUpPass({ manual: true, silent: false });
  }

  isEgressNoticePending(): boolean {
    const load = (k: string) => this.app.loadLocalStorage(k) as unknown;
    return !readEgressNoticeAcked(load);
  }

  ackEgressNotice(): void {
    writeEgressNoticeAcked((k, v) => this.app.saveLocalStorage(k, v));
    void this.refreshAtomsHomeLeaves();
  }

  getResumeEnabled(): boolean {
    return readResumeEnabled(
      (k) => this.app.loadLocalStorage(k) as unknown,
    );
  }

  setResumeEnabled(on: boolean): void {
    writeResumeEnabled((k, v) => this.app.saveLocalStorage(k, v), on);
  }

  private async scheduleAutoRunLifecycle() {
    try {
      await waitForVaultIndexReady(this.app);
      this.vaultIndexReady = true;
    } catch {
      // If wait fails, still mark ready after a beat so we aren't stuck forever.
      this.vaultIndexReady = true;
    }

    // Arm resume after cold-start settle so startup focus does not double-run.
    this.resumeListenersArmed = true;
    if (this.pendingResumeWhenReady) {
      this.pendingResumeWhenReady = false;
      // Defer slightly so onload auto-run wins the first filing slot.
      window.setTimeout(() => this.scheduleResumeCatchUp(), 2000);
    }

    // Primary: once index is ready (app open).
    void this.maybeAutoRun("onload");

    // Hourly date check for long-lived sessions (registerInterval, not raw setInterval).
    this.registerInterval(
      window.setInterval(
        () => {
          void this.maybeAutoRun("interval");
        },
        60 * 60 * 1000,
      ),
    );
  }

  /** Device-local auto-run snapshot for home (no secrets). */
  getAutoRunSnapshot(): DeviceAutoRunState & {
    inFlight: boolean;
    hasKey: boolean;
  } {
    const load = (k: string): unknown =>
      this.app.loadLocalStorage(k) as unknown;
    const state = readDeviceAutoRunState(load);
    return {
      ...state,
      inFlight: this.autoRunInFlight,
      // Treat active/trialing Plus as "has filing credentials" for auto-run readiness.
      hasKey: (() => {
        const a = this.resolveFilingAuth();
        if (a.mode === "byok") return true;
        if (a.mode === "plus" && a.status !== "exhausted" && a.status !== "inactive")
          return true;
        return false;
      })(),
    };
  }

  /**
   * One-tap enable from home: egress ack + auto-run on (device-local).
   * Optionally tries an immediate silent run.
   */
  async enableAutomaticFilingFromHome(): Promise<void> {
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    enableAutomaticFiling(save);
    new Notice("Atoms: automatic filing on for this device");
    await this.refreshAtomsHomeLeaves();
    void this.maybeAutoRun("manual");
  }

  /**
   * Device-local auto-run gate + silent failure (R13, U9).
   * Does not invoke buildContext until vaultIndexReady.
   * Stamps last-run day only when past queue is drained (not on attempt/failure).
   */
  async maybeAutoRun(
    source: "onload" | "interval" | "manual" | "resume",
    catchUp?: { bypassEnabled?: boolean; silentHome?: boolean },
  ): Promise<{
    ran: boolean;
    reason: string;
  }> {
    const load = (k: string): unknown =>
      this.app.loadLocalStorage(k) as unknown;
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);
    const today = localDateString();

    if (!canBuildContext(this.vaultIndexReady)) {
      return { ran: false, reason: "cache_not_ready" };
    }

    const pastRemaining = await this.countPastUnprocessed();

    // Catch-up manual: bypass auto-run enable (KTD11). Still need privacy ack
    // (auto-run egress) OR catch-up egress notice is gated earlier in decideResumeStages.
    const enabled =
      catchUp?.bypassEnabled === true ? true : state.enabled;
    // For catch-up filing, egress notice already gated; treat auto-run ack OR
    // catch-up notice as sufficient privacy for the paid path.
    const egressOk =
      state.egressAcked ||
      (catchUp != null && readEgressNoticeAcked(load));

    if (
      !shouldRunAutoProcess({
        enabled,
        lastRunDay:
          catchUp?.bypassEnabled === true ? null : state.lastRunDay,
        today,
        egressAcked: egressOk,
        pastUnprocessedRemaining: pastRemaining,
      })
    ) {
      return {
        ran: false,
        reason: !enabled
          ? "disabled"
          : !egressOk
            ? "no_egress_ack"
            : pastRemaining > 0
              ? "blocked"
              : "same_day",
      };
    }

    if (this.autoRunInFlight) {
      return { ran: false, reason: "in_flight" };
    }

    const filing = this.resolveFilingAuth();
    const classifyAuth = resolveClassifyAuth(filing, {
      plusBaseUrl: this.settings.plusBaseUrl,
    });
    if (!classifyAuth.ok) {
      // Silent for auto path — manual commands still Notice. Do not stamp.
      devLog("[atoms] auto-run skipped: no filing auth", classifyAuth.reason);
      return { ran: false, reason: "missing_key" };
    }

    // Nothing to do — stamp day so hourly interval does not re-scan forever.
    if (pastRemaining === 0) {
      writeLastRunDay(save, today);
      devLog("[atoms] auto-run empty success", { source });
      return { ran: true, reason: "empty" };
    }

    this.autoRunInFlight = true;
    this.filingStartedAt = Date.now();
    try {
      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey: classifyAuth.apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        ...shortlistOptionsFromSettings(),
        maxCaptures: PER_LAUNCH_CAP,
        enableHubProjection: this.settings.enableHubProjection === true,
        // never includeToday on auto-run
        classifyDeps: {
          maxAttempts: 2,
          plus: classifyAuth.plus,
          // Auto-run: no auth spam Notices every hour — log only.
          onAuthFailure: (msg) => {
            devLog("[atoms] auto-run auth failure", msg);
          },
        },
      });
      this.lastWriteReport = report;

      if (report.proposedTagsMerged.length) {
        this.settings.proposedTags = mergeProposedTags(
          this.settings.proposedTags,
          report.proposedTagsMerged,
          this.settings.activeVocabulary,
        );
        await this.saveSettings();
      }

      const pastAfter = await this.countPastUnprocessed(
        Math.max(0, pastRemaining - report.markersAppended),
      );
      const stamped = shouldStampLastRunDay({
        threw: false,
        pastRemainingAfter: pastAfter,
      });
      if (stamped) writeLastRunDay(save, today);

      const filed = report.markersAppended;
      if (filed > 0) {
        // Resume path stays silent (R5); no land-peak fanfare either.
        if (source !== "resume" && !catchUp?.silentHome) {
          new Notice(
            `Atoms: filed ${filed} capture${filed === 1 ? "" : "s"} (${report.atomsCreated} atom${report.atomsCreated === 1 ? "" : "s"})`,
          );
        }
        if (this.hasOpenAtomsHome() && source !== "resume" && !catchUp?.silentHome) {
          const summary = formatRunSummary(summaryFromWrite(report));
          this.finishHomeRun(
            summary,
            this.landPeakFromWrite(report, "autorun"),
          );
        } else {
          await this.refreshAtomsHomeLeaves();
        }
      }
      // Offline / all-failed without stamp: silent; retry same day on next open.
      devLog("[atoms] auto-run complete", {
        source,
        filed,
        atoms: report.atomsCreated,
        failed: report.failed,
        scanned: report.scanned,
        pastAfter,
        stamped,
      });
      return { ran: true, reason: "ok" };
    } catch (e) {
      // Never crash launch; never stamp on throw (retry same day).
      devLog("[atoms] auto-run error", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      return { ran: false, reason: "error" };
    } finally {
      this.autoRunInFlight = false;
      this.filingStartedAt = null;
    }
  }

  /** Past-only unmarked count; on list failure use fallback (default 0). */
  private async countPastUnprocessed(fallback = 0): Promise<number> {
    try {
      const listed = await getPastDailyNotesWithUnmarkedCaptures(this.app);
      return listed.totalUnprocessed;
    } catch {
      return fallback;
    }
  }

  private registerCommands() {
    registerAtomsCommands(this);
  }

  /** CLI/helper: estimate only (never submits a batch). */
  async prepareBackfillEstimateOnly(): Promise<CostEstimate | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      new Notice("Atoms: set your API key in settings");
      return null;
    }
    const prepared = await prepareBackfillEstimate({
      app: this.app,
      contextProvider: this.contextProvider,
      apiKey,
      model: DEFAULT_BACKFILL_MODEL,
      atomFolder: this.settings.atomFolder,
      shortlistK: shortlistOptionsFromSettings().shortlistK,
    });
    // Estimate-only: nothing will be submitted, so the corpus is released now.
    prepared.run.end();
    this.lastBackfillEstimate = prepared.estimate;
    return prepared.estimate;
  }

  /**
   * U10 — estimate (count_tokens) → confirm modal → batch submit → poll → write path.
   * No batch is submitted until the user confirms the gate.
   */
  async runBackfillFlow() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;
    if (this.backfillInFlight) {
      new Notice("Atoms: backfill already in progress");
      return;
    }

    new Notice("Atoms: counting tokens for backfill estimate…");
    try {
      const model = DEFAULT_BACKFILL_MODEL;
      const prepared = await prepareBackfillEstimate({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey,
        model,
        atomFolder: this.settings.atomFolder,
        shortlistK: shortlistOptionsFromSettings().shortlistK,
      });
      this.lastBackfillEstimate = prepared.estimate;

      devLog("[atoms] backfill estimate", {
        ...prepared.estimate,
        workItems: prepared.work.length,
        chunkCount: prepared.chunks.length,
      });

      if (prepared.work.length === 0) {
        prepared.run.end();
        new Notice("Atoms: nothing to backfill (no unmarked past captures)");
        return;
      }

      new Notice(
        `Atoms: ${prepared.estimate.summaryLine} — confirm in the dialog`,
      );

      let confirmed = false;
      const modal = new BackfillConfirmModal(this.app, prepared.estimate, async () => {
        confirmed = true;
        try {
          await this.executeBackfillBatch({
            apiKey,
            model,
            work: prepared.work,
            run: prepared.run,
            // Chunk one was priced against this same corpus with nothing yet written; resolving it
            // again would be byte-for-byte the same answer.
            firstChunk: prepared.chunks[0],
          });
        } finally {
          prepared.run.end();
        }
      });
      // Declining the gate must not leave a whole vault's corpus pinned.
      const closeHook = modal.onClose.bind(modal);
      modal.onClose = () => {
        closeHook();
        if (!confirmed) prepared.run.end();
      };
      modal.open();
    } catch (e) {
      devLog("[atoms] backfill estimate failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      new Notice(
        `Atoms: backfill estimate failed — ${e instanceof Error ? e.message.slice(0, 80) : "error"}`,
      );
    }
  }

  /**
   * One batch per calendar chunk, oldest first (U5).
   *
   * Chunk N+1's shortlist is derived only after chunk N's atoms are on disk and in the run's corpus,
   * which is the only way a catch-up can link an atom it wrote itself.
   */
  private async executeBackfillBatch(opts: {
    apiKey: string;
    model: string;
    work: import("../pipeline/backfill").BackfillWorkItem[];
    run: import("../pipeline/context").ContextRun;
    firstChunk?: import("../pipeline/backfill").ResolvedBackfillChunk;
  }) {
    if (this.backfillInFlight) return;
    this.backfillInFlight = true;
    try {
      const hubCtx = opts.run.vaultContext;
      const report = await runBackfillChunks({
        run: opts.run,
        work: opts.work,
        model: opts.model,
        firstChunk: opts.firstChunk,
        activeVocabulary: this.settings.activeVocabulary,
        runChunk: async (chunk, body, pos) => {
          new Notice(
            `Atoms: submitting ${chunk.key} (${pos.index + 1}/${pos.total}, ${chunk.work.length} request(s))…`,
          );
          const { batchId, requestCount } = await submitMessageBatch({
            apiKey: opts.apiKey,
            body,
          });
          this.lastBackfillBatchId = batchId;
          devLog("[atoms] batch submitted", {
            batchId,
            requestCount,
            chunk: chunk.key,
          });

          await waitForBatchEnded({
            apiKey: opts.apiKey,
            batchId,
            intervalMs: 8000,
            maxWaitMs: 60 * 60 * 1000,
            onTick: (status) => {
              devLog("[atoms] batch status", status);
            },
          });

          const jsonl = await fetchBatchResultsJsonl({
            apiKey: opts.apiKey,
            batchId,
          });
          return applyBackfillResults({
            app: this.app,
            work: chunk.work,
            lines: parseBatchResultsJsonl(jsonl),
            atomFolder: this.settings.atomFolder,
            activeVocabulary: this.settings.activeVocabulary,
            personHubDetails: hubCtx.personHubDetails,
            enableHubProjection: this.settings.enableHubProjection === true,
            // Feeds this chunk's atoms to the next chunk's shortlist (KTD4a).
            run: opts.run,
          });
        },
      });
      this.lastBackfillReport = report;

      if (report.proposedTags.length) {
        this.settings.proposedTags = mergeProposedTags(
          this.settings.proposedTags,
          report.proposedTags,
          this.settings.activeVocabulary,
        );
        await this.saveSettings();
      }

      devLog("[atoms] backfill applied", report);
      new Notice(
        `Atoms backfill: ${report.applied} applied, ${report.atomsCreated} atom(s), ${report.markersAppended} marker(s), ${report.failed} failed`,
      );
      if (report.atomsCreated > 0 || report.applied > 0) {
        this.scheduleAskMirrorSync();
      }
    } catch (e) {
      devLog("[atoms] backfill execute failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      new Notice(
        `Atoms: backfill failed — ${e instanceof Error ? e.message.slice(0, 100) : "error"}`,
      );
    } finally {
      this.backfillInFlight = false;
    }
  }

  /** Public so Settings can trigger the same path as the command. */
  async runTestConnection() {
    new Notice("Atoms: testing connection…");
    try {
      const report = await runConnectivityTest({
        apiKey: this.getApiKey(),
      });
      this.lastConnectivityReport = report;
      devLog(
        "[atoms] connectivity",
        formatConnectivityConsole(report),
      );
      new Notice(`Atoms: ${report.userMessage}`);
    } catch (e) {
      devLog("[atoms] connectivity test failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message.slice(0, 160) : "unknown",
      });
      new Notice("Atoms: connection test failed unexpectedly (see console)");
    }
  }

  /** Global Graph filtered to atoms + 1-hop connections (Issue #83). */
  async runOpenAtomGraph(): Promise<void> {
    await runOpenAtomGraph(this.app, this.settings.atomFolder);
  }

  async showAutoRunStatus() {
    const snap = this.getAutoRunSnapshot();
    const today = localDateString();
    const pastRemaining = await this.countPastUnprocessed();
    const would = shouldRunAutoProcess({
      enabled: snap.enabled,
      lastRunDay: snap.lastRunDay,
      today,
      egressAcked: snap.egressAcked,
      pastUnprocessedRemaining: pastRemaining,
    });
    const payload = {
      ...snap,
      today,
      vaultIndexReady: this.vaultIndexReady,
      pastRemaining,
      wouldRunNow: would,
      perLaunchCap: PER_LAUNCH_CAP,
      // Prove flag is not in synced settings object
      inDataJsonSettings: "autoRun" in (this.settings as object),
    };
    devLog("[atoms] auto-run status", payload);
    new Notice(
      `Atoms auto-run: ${snap.enabled ? "on" : "off"} · ack=${snap.egressAcked} · last=${snap.lastRunDay ?? "never"} · ready=${this.vaultIndexReady} · past=${pastRemaining}`,
    );
  }

  async loadSettings() {
    const raw = ((await this.loadData()) ?? {}) as Partial<LinkerSettings>;
    // One-time strip of the retired synced hash map: mirror evidence is
    // device-local (CLAUDE.md non-negotiable 12), and `data.json` syncs. This
    // is deletion, not migration — the value is never read back as evidence,
    // and dropping it fails safe (no evidence plans no deletes).
    const stripped = stripLegacyAskMirrorHashes(raw);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    this.settings.atomFolder = clampAtomFolder(this.settings.atomFolder);
    if (stripped) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Pull Ask outbox and create atoms under Atoms/ (best-effort).
   * Thin wrapper — orchestration lives on AskCoordinator.
   */
  async applyAskOutbox(): Promise<AskOutboxOutcome> {
    return this.ask.applyOutbox();
  }

  /**
   * Push Atoms/ to Plus Ask mirror (best-effort). Four-way outcome (worked /
   * joined / refused / failed). Thin wrapper — orchestration on AskCoordinator.
   */
  async syncAskMirror(opts?: { force?: boolean }): Promise<MirrorSyncOutcome> {
    return this.ask.sync(opts);
  }

  getApiKey(): string | null {
    // Prefer configured secret id, then default id (users often store under the tip name
    // without saving the id field). Secret values are vault+device local — not data.json.
    const ids = [
      this.settings.apiKeySecretId?.trim(),
      API_KEY_SECRET_ID_DEFAULT,
    ].filter((id): id is string => !!id);
    const tried = new Set<string>();
    if (this.app.secretStorage) {
      for (const secretId of ids) {
        if (tried.has(secretId)) continue;
        tried.add(secretId);
        try {
          const fromSecret = this.app.secretStorage.getSecret(secretId);
          if (fromSecret) return fromSecret;
        } catch {
          /* try next */
        }
      }
    }

    if (this.settings.useDeviceLocalKeyFallback) {
      const local = this.app.loadLocalStorage(LOCAL_STORAGE_API_KEY);
      if (typeof local === "string" && local.trim()) return local.trim();
    }

    return null;
  }

  /**
   * BYOK vs Atoms Plus session (U1). Plus preferred when entitlement active/trialing/exhausted.
   * Session token is device-local — never data.json.
   */
  resolveFilingAuth(): FilingAuth {
    return resolveFilingAuth({
      byokApiKey: this.getApiKey(),
      plusSession: readPlusSession(this.app),
    });
  }

  private requireApiKey(): string | null {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      new Notice("Atoms: set your API key in settings");
      return null;
    }
    return apiKey;
  }

  /**
   * BYOK or Plus credentials for Process/Preview/Update/auto-run (U3).
   * Returns null after Notice when blocked.
   */
  private requireClassifyAuth():
    | import("../platform/classifyAuth").ClassifyAuthOk
    | null {
    const auth = this.resolveFilingAuth();
    const resolved = resolveClassifyAuth(auth, {
      plusBaseUrl: this.settings.plusBaseUrl,
      onRemaining: (remaining) => {
        const session = readPlusSession(this.app);
        if (!session) return;
        const status =
          remaining <= 0 ? "exhausted" : session.status === "trialing" ? "trialing" : "active";
        writePlusSession(this.app, {
          ...session,
          remaining,
          status,
          refreshedAt: Date.now(),
        });
      },
    });
    if (!resolved.ok) {
      new Notice(`Atoms: ${resolved.message}`);
      return null;
    }
    return resolved;
  }

  runLogContextPrefix() {
    const ctx = this.contextProvider.buildContext();
    const prefix = buildContextUserMessage(ctx);
    const prefix2 = buildContextUserMessage(
      this.contextProvider.buildContext(),
    );
    devLog("[atoms] context prefix", {
      titleCount: ctx.titles.length,
      tagCount: ctx.tags.length,
      vocabulary: ctx.vocabulary,
      byteLength: prefix.length,
      stableAcrossTwoBuilds: prefix === prefix2,
      // Preview only — not full dump if huge
      head: prefix.slice(0, 400),
    });
    new Notice(
      `Atoms: context ${ctx.titles.length} titles, ${ctx.tags.length} tags — stable=${prefix === prefix2}`,
    );
  }

  /**
   * U8 — classify + write atoms/markers for unprocessed captures.
   * includeToday: manual force for testing on phone (never used by auto-run).
   */
  async runProcessUnprocessed(opts?: { includeToday?: boolean }) {
    const classifyAuth = this.requireClassifyAuth();
    if (!classifyAuth) return;

    this.beginHomeRun("process");
    new Notice(
      opts?.includeToday
        ? "Atoms: processing (including today)…"
        : "Atoms: processing (writing)…",
    );
    try {
      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey: classifyAuth.apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        ...shortlistOptionsFromSettings(),
        maxCaptures: 15,
        includeToday: opts?.includeToday,
        enableHubProjection: this.settings.enableHubProjection === true,
        classifyDeps: {
          maxAttempts: 2,
          plus: classifyAuth.plus,
          onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
        },
        onProgress: (done, total, meta) => {
          this.updateHomeProgress(done, total, meta?.captureText);
        },
      });
      this.lastWriteReport = report;
      if (report.proposedTagsMerged.length) {
        this.settings.proposedTags = mergeProposedTags(
          this.settings.proposedTags,
          report.proposedTagsMerged,
          this.settings.activeVocabulary,
        );
        await this.saveSettings();
      }
      devLog("[atoms] write report", {
        atomsCreated: report.atomsCreated,
        markersAppended: report.markersAppended,
        collisions: report.collisions,
        failed: report.failed,
        scanned: report.scanned,
        failures: report.failures,
        entries: report.entries.map((e) => ({
          date: e.date,
          verdict: e.verdict,
          title: e.title,
          atom: e.write.atomCreated,
          marker: e.write.markerAppended,
        })),
      });
      const summary = formatRunSummary(summaryFromWrite(report));
      this.finishHomeRun(summary, this.landPeakFromWrite(report, "process"));
      {
        let notice = `Atoms: wrote ${report.atomsCreated} atom(s), ${report.markersAppended} marker(s), ${report.collisions} collision(s), ${report.failed} failed`;
        if (report.personHubMisses > 0) {
          notice += `, ${report.personHubMisses} no person hub${report.personHubMisses === 1 ? "" : "s"}`;
        }
        if (report.failures.length > 0) {
          const f = report.failures[0]!;
          const snip = f.captureText.replace(/\s+/g, " ").trim().slice(0, 48);
          notice += ` — ${f.reason}: ${snip}${f.captureText.length > 48 ? "…" : ""}`;
        }
        new Notice(notice);
      }
      // After projection + atom writes settle — end-of-run push (hubs included).
      fireAndForgetAsk(this.syncAskMirror({ force: false }));
      fireAndForgetAsk(this.applyAskOutbox());
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        this.failHomeRun(e.message);
        new Notice(e.message);
        return;
      }
      devLog("[atoms] write path failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      this.failHomeRun("Write path failed");
      new Notice("Atoms: write path failed (see console)");
    }
  }

  /**
   * U8 verification without Anthropic: process first few unprocessed captures
   * with deterministic fixture verdicts (atom / task / noise).
   */
  async runProcessFixtureSample() {
    // No API key required — fixtures only.
    const fixtures: ClassificationResult[] = [
      {
        verdict: "atom",
        title: "Multi-line ideas deserve atomic notes",
        tags: ["idea"],
        proposed_tags: ["writing"],
        links: [
          {
            note: "Capture is cheap; review is the scarce resource",
            reason: "relates because both concern capture vs review",
          },
        ],
      },
      {
        verdict: "task",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      {
        verdict: "noise",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      },
      {
        verdict: "atom",
        title: "Morning focus blocks compound",
        tags: ["observation"],
        proposed_tags: [],
        links: [],
      },
    ];

    this.beginHomeRun("process");
    new Notice("Atoms: fixture write sample…");
    try {
      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey: "fixture", // unused when fixtureResults set
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        ...shortlistOptionsFromSettings(),
        maxCaptures: fixtures.length,
        fixtureResults: fixtures,
        enableHubProjection: this.settings.enableHubProjection === true,
        onProgress: (done, total, meta) => {
          this.updateHomeProgress(done, total, meta?.captureText);
        },
      });
      this.lastWriteReport = report;
      if (report.proposedTagsMerged.length) {
        this.settings.proposedTags = mergeProposedTags(
          this.settings.proposedTags,
          report.proposedTagsMerged,
          this.settings.activeVocabulary,
        );
        await this.saveSettings();
      }
      devLog("[atoms] fixture write report", {
        atomsCreated: report.atomsCreated,
        markersAppended: report.markersAppended,
        collisions: report.collisions,
        entries: report.entries,
      });
      const summary = formatRunSummary(summaryFromWrite(report));
      this.finishHomeRun(summary, this.landPeakFromWrite(report, "process"));
      new Notice(
        `Atoms fixture: ${report.atomsCreated} atom(s), ${report.markersAppended} marker(s)`,
      );
      this.scheduleAskMirrorSync();
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        this.failHomeRun(e.message);
        new Notice(e.message);
        return;
      }
      devLog("[atoms] fixture write failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      this.failHomeRun("Fixture write failed");
      new Notice("Atoms: fixture write failed (see console)");
    }
  }

  /**
   * U7 — full pipeline dry-run. Modal + lastDryRun* for CLI.
   * Never creates atoms or appends markers (AE5).
   */
  async runDryRunPreview(opts?: { includeToday?: boolean }) {
    const classifyAuth = this.requireClassifyAuth();
    if (!classifyAuth) return;

    this.beginHomeRun("preview");
    new Notice(
      opts?.includeToday
        ? "Atoms: dry-run (including today)…"
        : "Atoms: dry-run starting…",
    );
    try {
      const report = await runDryRun({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey: classifyAuth.apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        ...shortlistOptionsFromSettings(),
        // Bound work for interactive use; remainder stays unmarked for next run.
        maxCaptures: 15,
        includeToday: opts?.includeToday,
        previewCacheQualityStamp: CURRENT_ATOMS_QUALITY,
        classifyDeps: {
          // Fail fast on network blips during preview (still retries once).
          maxAttempts: 2,
          plus: classifyAuth.plus,
          onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
        },
        onProgress: (done, total, meta) => {
          this.updateHomeProgress(done, total, meta?.captureText);
          if (done === total || done % 5 === 0) {
            devLog(`[atoms] dry-run progress ${done}/${total}`);
          }
        },
      });

      this.lastDryRunReport = report;
      const md = renderPreviewMarkdown(report);
      this.lastDryRunMarkdown = md;

      // Collect proposed tags only (never auto-apply).
      this.settings.proposedTags = mergeProposedFromReport(
        this.settings.proposedTags,
        report,
        this.settings.activeVocabulary,
      );
      await this.saveSettings();

      devLog("[atoms] dry-run report", {
        classified: report.classified,
        failed: report.failed,
        scanned: report.totalUnprocessedScanned,
        entries: report.entries.length,
        wroteNothing: report.wroteNothing,
        sample: report.entries.slice(0, 3).map((e) => ({
          date: e.date,
          ok: e.outcome.ok,
          verdict: e.outcome.ok ? e.outcome.result.verdict : e.outcome.reason,
          marker: e.wouldWriteMarker,
        })),
      });
      devLog("[atoms] dry-run markdown\n" + md);

      const summary = formatRunSummary(summaryFromDryRun(report));
      this.finishHomeRun(summary);
      showDryRunNotice(report);
      const includeToday = opts?.includeToday === true;
      new DryRunPreviewModal(this.app, report, {
        report,
        onProcess: async () => {
          // begin/finish/fail handled inside runProcessUnprocessed
          await this.runProcessUnprocessed({ includeToday });
        },
      }).open();
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        this.failHomeRun(e.message);
        new Notice(e.message);
        return;
      }
      devLog("[atoms] dry-run failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      this.failHomeRun("Dry-run failed");
      new Notice("Atoms: dry-run failed (see console)");
    }
  }

  async runListUnprocessed() {
    try {
      const { notes, totalUnprocessed } =
        await getPastDailyNotesWithUnmarkedCaptures(this.app);
      devLog("[atoms] unprocessed captures", {
        days: notes.length,
        totalUnprocessed,
        notes: notes.map((n) => ({
          path: n.path,
          date: n.date,
          unprocessed: n.unprocessed.map((c) => ({
            text: c.text.slice(0, 80),
            timestamp: c.timestamp,
            startLine: c.startLine,
          })),
        })),
      });
      new Notice(
        `Atoms: ${totalUnprocessed} unprocessed capture(s) across ${notes.length} past day(s) — see console`,
      );
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        new Notice(e.message);
        return;
      }
      devLog("[atoms] list-unprocessed failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: failed to list captures (see console)");
    }
  }

  async runClassifyFirstUnprocessed() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

    try {
      const { notes, totalUnprocessed } =
        await getPastDailyNotesWithUnmarkedCaptures(this.app);
      if (totalUnprocessed === 0) {
        new Notice("Atoms: no unprocessed captures");
        return;
      }
      const first = notes[0]!.unprocessed[0]!;
      const ctx = this.contextProvider.buildContext();
      new Notice("Atoms: classifying first unprocessed…");
      const outcome = await classifyCapture(first.text, ctx, {
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
      });
      this.lastClassifyOutcome = outcome;
      logClassifyOutcome("first-unprocessed", outcome);
      if (outcome.ok) {
        if (outcome.result.proposed_tags?.length) {
          this.settings.proposedTags = mergeProposedTags(
            this.settings.proposedTags,
            outcome.result.proposed_tags,
            this.settings.activeVocabulary,
          );
          await this.saveSettings();
        }
        new Notice(
          `Atoms: ${outcome.result.verdict}${
            outcome.result.title ? ` — ${outcome.result.title}` : ""
          } (cache_read=${outcome.usage.cache_read_input_tokens})`,
        );
      } else {
        new Notice(`Atoms: ${outcome.message}`);
      }
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        new Notice(e.message);
        return;
      }
      devLog("[atoms] classify-first failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: classify failed (see console)");
    }
  }

  async runSpikeClassify() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

    new Notice("Atoms: classifying spike capture…");
    const outcome = await classifyCapture(SPIKE_CAPTURE, SPIKE_CONTEXT, {
      apiKey,
      model: this.settings.model,
      activeVocabulary: this.settings.activeVocabulary,
      onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
    });
    this.lastClassifyOutcome = outcome;
    logClassifyOutcome("spike-classify", outcome);

    if (outcome.ok) {
      new Notice(
        `Atoms: ${outcome.result.verdict}${
          outcome.result.title ? ` — ${outcome.result.title}` : ""
        }`,
      );
    } else {
      new Notice(`Atoms: ${outcome.message}`);
    }
  }

  async runSpikeCacheAndBatch() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

    const captures = [
      SPIKE_CAPTURE,
      "buy oat milk and eggs on the way home",
      "reminded me of [[Sleep debt doesn't accumulate linearly]] — maybe the plateau is just denial",
    ];

    new Notice("Atoms: measuring per-capture cache + day-batch…");
    devLog("[atoms] === KTD3 fork measurement start ===");

    const perCaptureUsages = [];
    for (let i = 0; i < captures.length; i++) {
      const outcome = await classifyCapture(captures[i]!, SPIKE_CONTEXT, {
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
      });
      logClassifyOutcome(`per-capture #${i + 1}`, outcome);
      if (outcome.ok) {
        perCaptureUsages.push(outcome.usage);
      } else if (outcome.reason === "auth") {
        return;
      }
    }

    const cacheReads = perCaptureUsages.map((u) => u.cache_read_input_tokens);
    devLog("[atoms] per-capture usage summary", {
      calls: perCaptureUsages.length,
      cache_read_input_tokens: cacheReads,
      secondCallCacheRead: cacheReads[1] ?? 0,
    });

    const batchBody = buildDayBatchRequest({
      model: this.settings.model,
      captures,
      context: SPIKE_CONTEXT,
    });

    try {
      const res = await requestUrl({
        url: ANTHROPIC_MESSAGES_URL,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(batchBody),
        throw: false,
      });
      const json = (res.json ?? {}) as Record<string, unknown>;
      devLog("[atoms] day-batch", {
        status: res.status,
        usage: parseUsage(json.usage),
      });
    } catch {
      devLog("[atoms] day-batch network error (details redacted)");
    }

    const shape = buildMessagesRequest({
      model: this.settings.model,
      capture: SPIKE_CAPTURE,
      context: SPIKE_CONTEXT,
    });
    const msgs = shape.messages as Array<{
      content: Array<{ cache_control?: unknown }>;
    }>;
    devLog("[atoms] request shape (safe)", {
      captureAfterBreakpoint:
        Boolean(msgs[0]?.content?.[0]?.cache_control) &&
        !msgs[1]?.content?.[0]?.cache_control,
    });

    new Notice("Atoms: KTD3 measurement logged to console");
  }

  /**
   * Soft-unfreeze: reclassify one noise/task capture under the cursor.
   * Command palette path — same behaviour as Library long-press Try filing….
   */
  async runReconsiderCapture() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !(view.file instanceof TFile)) {
      new Notice(missNotice());
      return;
    }

    const file = view.file;
    const content = view.editor.getValue();
    const line0 = view.editor.getCursor().line;
    const capture = findCaptureAtLine(content, line0);
    await this.runReconsiderForCapture(file, capture);
  }

  /**
   * Library Skipped row: try filing now (same Reconsider modal).
   * Always available from home — no experimental flag (deliberate list gesture).
   */
  async runReconsiderFromSkipped(opts: {
    path: string;
    startLine: number;
    snippet: string;
    text?: string;
  }): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(opts.path);
    if (!(file instanceof TFile)) {
      new Notice(missNotice());
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    const capture = resolveSkippedCapture(content, {
      startLine: opts.startLine,
      snippet: opts.snippet,
      text: opts.text,
    });
    await this.runReconsiderForCapture(file, capture);
  }

  /** Shared classify → modal → Apply / Keep anyway for one skipped capture. */
  private async runReconsiderForCapture(
    file: TFile,
    capture: ReturnType<typeof findCaptureAtLine>,
  ): Promise<void> {
    const gate = gateReconsiderTarget(capture);
    if (!gate.ok) {
      if (gate.reason === "atom") {
        new Notice(atomRefuseNotice());
      } else {
        new Notice(missNotice());
      }
      return;
    }

    // Same auth as Process: BYOK or Atoms Plus (not BYOK-only).
    const classifyAuth = this.requireClassifyAuth();
    if (!classifyAuth) return;

    const nowKind = gate.capture.markerKind!;
    const loading = new ReconsiderModal(this.app, {
      capture: gate.capture,
      nowKind,
      result: null,
      loading: true,
    });
    loading.open();

    try {
      const ctx = this.contextProvider.buildContext();
      const shortlist = shortlistOptionsFromSettings();
      const outcome = await classifyCapture(gate.capture.text, ctx, {
        apiKey: classifyAuth.apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        maxAttempts: 2,
        plus: classifyAuth.plus,
        ...shortlist,
        onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
      });

      loading.close();

      if (!outcome.ok) {
        new Notice(`Atoms: ${outcome.message || outcome.reason}`);
        return;
      }

      const result = outcome.result;
      if (result.proposed_tags?.length) {
        this.settings.proposedTags = mergeProposedTags(
          this.settings.proposedTags,
          result.proposed_tags,
          this.settings.activeVocabulary,
        );
        await this.saveSettings();
      }

      const commitResult = async (r: typeof result) => {
        const report = await applyReconsiderWrite({
          app: this.app,
          dailyPath: file.path,
          dailyDate: dailyDateForFile(this.app, file),
          capture: gate.capture,
          result: r,
          atomFolder: this.settings.atomFolder,
        });
        if (!report.ok) {
          if (report.reason === "collision") {
            new Notice(collisionNotice());
          } else if (report.reason === "stale") {
            new Notice("Capture changed — open the daily and try again");
          } else if (report.reason === "no_change") {
            /* Apply should have been disabled */
          } else {
            new Notice("Atoms: could not reconsider (see console)");
            devLog("[atoms] reconsider apply failed", report);
          }
          return;
        }
        new Notice(filedNotice(report.title ?? r.title));
        this.forEachAtomsHome((v) => {
          void v.refresh();
        });
      };

      new ReconsiderModal(this.app, {
        capture: gate.capture,
        nowKind,
        result,
        onApply: async () => {
          await commitResult(result);
        },
        onKeepAnyway: async () => {
          await commitResult(forceKeepAtomResult(gate.capture.text));
        },
      }).open();
    } catch (e) {
      loading.close();
      devLog("[atoms] reconsider failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: reconsider failed (see console)");
    }
  }

  runSecretStorageProbe() {
    const probeId = "atoms-spike-probe";
    const probeValue = `probe-${Date.now()}`;

    if (!this.app.secretStorage) {
      new Notice(
        "Atoms: SecretStorage API missing — use device-local fallback",
      );
      return;
    }

    try {
      this.app.secretStorage.setSecret(probeId, probeValue);
      const readBack = this.app.secretStorage.getSecret(probeId);
      const ok = readBack === probeValue;
      try {
        this.app.secretStorage.setSecret(probeId, "");
      } catch {
        /* ignore */
      }
      new Notice(
        ok
          ? "Atoms: SecretStorage read/write OK"
          : "Atoms: SecretStorage mismatch — consider device-local fallback",
      );
    } catch (e) {
      devLog("[atoms] SecretStorage probe FAILED", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice(
        "Atoms: SecretStorage failed — enable device-local key fallback",
      );
    }
  }
}
