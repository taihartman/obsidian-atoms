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
  // `typeof` guard: the define only exists inside an esbuild bundle, and a bare reference
  // throws a ReferenceError anywhere else — including any test that reaches this file.
  void (typeof ATOMS_DEV_COMMANDS !== "undefined" && ATOMS_DEV_COMMANDS);
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
import {
  BACKFILL_CAP,
  deriveRecentFirstRange,
  resolveBackfillBudget,
  type BackfillDaily,
  type RecentFirstRange,
} from "../pipeline/backfillOffer";
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
  migrateAutoFilingWindow,
  PER_LAUNCH_CAP,
  readAutoFilingSince,
  readDeviceAutoRunState,
  readEgressPermitted,
  runAutoFilingCycle,
  shouldRunAutoProcess,
  waitForVaultIndexReady,
  type AutoRunSource,
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
  type BackfillConfirmProps,
  type CostEstimate,
} from "../pipeline/backfill";
import {
  createCheckout,
  plusFetchRequest,
  DEFAULT_PLUS_BASE_URL,
  type PlusClientConfig,
} from "../platform/plusClient";
import { refreshPlusEntitlementRecord } from "../platform/plusRefresh";
import {
  listLinkerAtoms,
  runRefreshEligibleAtoms,
  type RefreshReport,
} from "../pipeline/refreshAtoms";
import { isEligibleForUpdate } from "../pipeline/atomQuality";
import { formatUpdateSummary } from "../home/runProgress";
import { stripLegacyAskMirrorHashes } from "../platform/askMirror";
import { askPrivacyAckIsCurrent, settleAckRecords } from "../shared/askAck";
import { createSignInHandoffQueue } from "../platform/plusSignIn";
import {
  askSignInApproval,
  createSignInStatusSurface,
} from "../settings/plusSignInConfirmModal";
import { closeOpenConsentSheet } from "../settings/consent";

/**
 * How many times the backfill offer may be re-derived behind a top-up before it stops
 * re-opening. The loop has to terminate on its own: each round costs a meter read and a vault
 * scan, and an over-budget offer can legitimately stay over budget after a purchase.
 */
const BACKFILL_TOPUP_ROUNDS = 3;

/** Meter polls after top-up checkout opens, and the gap between them. */
const BACKFILL_TOPUP_POLL = { attempts: 24, intervalMs: 5000 } as const;

export default class AtomsPlugin extends Plugin {
  settings!: LinkerSettings;
  /**
   * The settings tab while it is on screen, so `onExternalSettingsChange` can re-render what a
   * remote withdrawal just invalidated (#323). The tab registers and clears itself, so this is
   * null whenever Settings is closed and there is nothing to refresh.
   */
  settingTab: AtomsSettingTab | null = null;
  contextProvider!: MetadataContextProvider;
  /**
   * #240 KTD8 — one slot for a sign-in deep link that lands before settings
   * are loaded. Built in the field initializer so the handler registered above
   * `onload`'s first `await` has somewhere to put what it receives.
   */
  private signInHandoff = createSignInHandoffQueue({
    openStatus: () => createSignInStatusSurface(this.app),
  });
  /**
   * Ask mirror + outbox orchestration (single owner of inFlight state).
   *
   * Constructed with the instance, not in `onload`: `onExternalSettingsChange` cancels pending
   * pushes through it, and Obsidian can fire that hook against a plugin whose `onload` has not
   * finished. The constructor only stores this reference, so it is safe this early.
   */
  ask: AskCoordinator = new AskCoordinator(this);
  /**
   * Bumped before every save, so an external read that resolves after a local write can
   * tell the copy it is holding is already stale. See `onExternalSettingsChange`.
   */
  private settingsGeneration = 0;
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
  /**
   * Checkout completes in a browser, so the only signal the top-up round has is the meter
   * itself. Held as a field rather than read from the constant directly so a test does not sit
   * through two minutes of real polling.
   */
  private readonly backfillTopUpPoll: { attempts: number; intervalMs: number } =
    BACKFILL_TOPUP_POLL;
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
    // #240 KTD8 — registration needs no settings and must not race a cold open,
    // so it happens above the first `await`. The handler only captures params;
    // the flow that needs `settings` drains once `loadSettings()` resolves.
    this.registerObsidianProtocolHandler("atoms-signin", (params) => {
      void this.signInHandoff.accept(params);
    });

    // Disabling the plugin does not close a consent sheet it left on screen, and that sheet
    // still writes: accepting one after a disable armed paid unattended filing for the moment
    // the plugin came back. Settled here so no call site has to remember.
    this.register(() => closeOpenConsentSheet());

    await this.loadSettings();
    void this.maybeShowHubProjectionListDisclosure();
    void this.signInHandoff.ready(this.plusSignInHost());
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
    await this.runBackfillFlow("card");
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
  async openTodaysDailyNote(): Promise<void> {
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

    // Claimed here rather than once the stage decision is in: the two `await`s below meant a
    // same-tick double press — two taps on Sync everything now, or a manual run racing a resume
    // — both read the flag while it was still false and both ran a full pass. The `finally`
    // releases it, so the early returns between here and there stay correct.
    this.catchUpInFlight = true;
    let drained = 0;
    let outbox = 0;
    let mirrored = 0;
    let filed = 0;
    try {
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

    // U4 / KTD5: a device that had filing on before the window existed carries no start day.
    // Stamp it here, ahead of the first pass, so the migration owns the window start instead of
    // the read-side fallback writing the same day with nothing recording that it happened — and
    // flag the device, because this pauses an in-progress silent sweep and an auto-update shows
    // no release notes to explain why.
    //
    // Guarded like the index wait above: the onload pass and the hourly interval are registered
    // below it, so an unguarded throw here — a full or hostile localStorage is enough — takes
    // filing down for the whole session with nothing said. The migration is idempotent and
    // retries on the next launch; the session's filing does not.
    try {
      migrateAutoFilingWindow(
        (k) => this.app.loadLocalStorage(k) as unknown,
        (k, v) => this.app.saveLocalStorage(k, v),
      );
    } catch (e) {
      devLog("[atoms] auto-filing window migration failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
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
    const load = (k: string): unknown =>
      this.app.loadLocalStorage(k) as unknown;
    enableAutomaticFiling(save, { load });
    new Notice("Atoms: automatic filing on for this device");
    await this.refreshAtomsHomeLeaves();
    void this.runFilingAfterEnable();
  }

  /**
   * The pass the user's own enable tap fires, shared by home's filing card and the Settings
   * toggle so enabling from Settings is not a worse first run.
   *
   * It does **not** reach today's daily. The consent sheet the user accepts one second earlier
   * promises "today's daily note is never auto-touched", so day one is deliberately silent: the
   * window starts today and today is excluded, and the first atoms appear tomorrow. The call is
   * still worth making — on an empty window the cycle stamps the day, which is what stops the
   * hourly interval from rescanning the vault for the rest of the session.
   */
  async runFilingAfterEnable(): Promise<void> {
    await this.maybeAutoRun("manual");
  }

  /**
   * Device-local auto-run gate + silent failure (R13, U9).
   * Does not invoke buildContext until vaultIndexReady.
   * Stamps last-run day only when past queue is drained (not on attempt/failure).
   *
   * The pass itself lives in `runAutoFilingCycle` (KTD2): it resolves the filing-window bound
   * once and hands that same day to the count and to the write, so the two can never drift
   * into the silent forever-rescan. This method supplies the gate, the write, and the UI.
   */
  async maybeAutoRun(
    source: AutoRunSource,
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

    // Same verdict the gate reaches, taken before the claim and before the count.
    //
    // Disabling preserves the start day (KTD6), so a device with filing off still resolves a real
    // window — and the cycle used to claim the in-flight slot and scan all of it every hour only
    // to be refused for being disabled. Two costs: pointless hourly vault reads, and a lock held
    // across a long count that a concurrent catch-up or the user's own enable tap then loses to.
    // `bypassEnabled` is the manual catch-up, which files with the toggle off by design (KTD11).
    if (catchUp?.bypassEnabled !== true && !state.enabled) {
      return { ran: false, reason: "disabled" };
    }

    let auth: Extract<
      ReturnType<typeof resolveClassifyAuth>,
      { ok: true }
    > | null = null;
    // Boxed so the log after the cycle still sees the report the write callback set.
    const written: { report: WritePathReport | null } = { report: null };

    const outcome = await runAutoFilingCycle({
      load,
      save,
      today,
      count: (since, fallback) =>
        // Same bound as the write (KTD2), and past-only like it: both sides of the cycle read
        // exactly the same set of captures, so the recount can reach zero and stamp the day.
        this.countPastUnprocessed({ since, fallback }),
      gate: (pastRemaining) => {
        // Catch-up manual: bypass auto-run enable (KTD11). Still need privacy ack
        // (auto-run egress) OR catch-up egress notice is gated earlier in decideResumeStages.
        const enabled =
          catchUp?.bypassEnabled === true ? true : state.enabled;
        // For catch-up filing, egress notice already gated; treat auto-run ack OR
        // catch-up notice as sufficient privacy for the paid path.
        const egressOk = readEgressPermitted(load, { catchUp: catchUp != null });

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
            ok: false,
            reason: !enabled
              ? "disabled"
              : !egressOk
                ? "no_egress_ack"
                : pastRemaining > 0
                  ? "blocked"
                  : "same_day",
          };
        }

        const filing = this.resolveFilingAuth();
        const classifyAuth = resolveClassifyAuth(filing, {
          plusBaseUrl: this.settings.plusBaseUrl,
        });
        if (!classifyAuth.ok) {
          // Silent for auto path — manual commands still Notice. Do not stamp.
          devLog("[atoms] auto-run skipped: no filing auth", classifyAuth.reason);
          return { ok: false, reason: "missing_key" };
        }
        auth = classifyAuth;
        return { ok: true };
      },
      // The in-flight check and set are one synchronous step here, and the cycle runs it before
      // its first await — onload, the hourly interval, the manual path and the commands can all
      // land in the same tick, and a check the gate made across an await would let two of them
      // through into a paid write pass. The cycle reports the refusal as reason "in_flight".
      beginWork: () => {
        if (this.autoRunInFlight) return false;
        // The other direction of the same guard: a Plus backfill runs through `runWritePath`
        // and takes `backfillInFlight`, so without this check the hourly pass would start a
        // second paid run against a second pinned context corpus.
        if (this.backfillInFlight) return false;
        this.autoRunInFlight = true;
        return true;
      },
      endWork: () => {
        this.autoRunInFlight = false;
        this.filingStartedAt = null;
      },
      file: async (since) => {
        // Marked here, not in `beginWork`: the claim has to happen before the cycle's first
        // await, but the claim is not a filing pass — a run refused by the gate would otherwise
        // report itself as filing to `decideResumeStages` and home's filing card. `endWork`
        // clears it on every exit after the claim, this one included.
        this.filingStartedAt = Date.now();
        // The gate above is the only way here, and it always sets auth.
        const resolved = auth;
        if (!resolved) throw new Error("auto-run: filing auth unresolved");
        const report = await runWritePath({
          app: this.app,
          contextProvider: this.contextProvider,
          apiKey: resolved.apiKey,
          model: this.settings.model,
          activeVocabulary: this.settings.activeVocabulary,
          atomFolder: this.settings.atomFolder,
          ...shortlistOptionsFromSettings(),
          maxCaptures: PER_LAUNCH_CAP,
          enableHubProjection: this.settings.enableHubProjection === true,
          // Never today, from any source — onload, the hourly interval, resume, the manual
          // catch-up, and the enable tap all land here. The egress disclosure the user accepts
          // says "today's daily note is never auto-touched"; written as a literal so no caller
          // can thread a different value in. Explicit force lives on the attended commands.
          includeToday: false,
          since,
          classifyDeps: {
            maxAttempts: 2,
            plus: resolved.plus,
            // Auto-run: no auth spam Notices every hour — log only.
            onAuthFailure: (msg) => {
              devLog("[atoms] auto-run auth failure", msg);
            },
          },
        });
        written.report = report;
        this.lastWriteReport = report;

        if (report.proposedTagsMerged.length) {
          this.settings.proposedTags = mergeProposedTags(
            this.settings.proposedTags,
            report.proposedTagsMerged,
            this.settings.activeVocabulary,
          );
          await this.saveSettings();
        }
        return { markersAppended: report.markersAppended };
      },
      onFiled: async (filed) => {
        const report = written.report;
        if (filed <= 0 || !report) return;
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
      },
      onError: (e) => {
        // Never crash launch; never stamp on throw (retry same day).
        devLog("[atoms] auto-run error", {
          name: e instanceof Error ? e.name : "Error",
          message: e instanceof Error ? e.message : "unknown",
        });
      },
    });

    if (outcome.reason === "empty") {
      devLog("[atoms] auto-run empty success", { source, since: outcome.since });
    } else if (outcome.reason === "ok") {
      // Offline / all-failed without stamp: silent; retry same day on next open.
      devLog("[atoms] auto-run complete", {
        source,
        since: outcome.since,
        filed: outcome.filed,
        atoms: written.report?.atomsCreated ?? 0,
        failed: written.report?.failed ?? 0,
        scanned: written.report?.scanned ?? 0,
        pastAfter: outcome.pastRemainingAfter,
        stamped: outcome.stamped,
      });
    }
    return { ran: outcome.ran, reason: outcome.reason };
  }

  /**
   * Past-only unmarked count; on list failure use `fallback` (default 0).
   *
   * Options object on purpose: the bound and the fallback are both scalars, and the previous
   * positional `fallback` sat at exactly the index a new leading `since` would have taken —
   * a silent swap that would have made the recount count history (KTD2).
   */
  private async countPastUnprocessed(
    opts: { since?: string; fallback?: number } = {},
  ): Promise<number> {
    try {
      const listed = await getPastDailyNotesWithUnmarkedCaptures(this.app, {
        since: opts.since,
      });
      return listed.totalUnprocessed;
    } catch {
      return opts.fallback ?? 0;
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
   * The backfill entry point (U8), branched on filing auth.
   *
   * `requireApiKey()` used to be the first statement of this method, so a Plus or trial device
   * was told to set an API key it does not have and could not reach backfill at all — on the same
   * screen that reads "Plus · Trial · 150 filings left". Only the BYOK branch needs a key; the
   * Plus branch spends filings through the proxy Process already uses.
   *
   * `source` bounds the **BYOK offer only** (KTD9). The card proposes a capped, recent-first
   * range; the command stays the unbounded whole-history estimate it has always been, because it
   * is the only path a BYOK user has to file a backlog larger than one run — capping it would be
   * a capability regression, not a guardrail. Plus is budget-bounded from either entry: spending
   * a whole period's allowance on years-old notes is the harm KTD9 and KTD10 exist to prevent,
   * and the Plus escape hatch is the top-up, not an uncapped run.
   */
  async runBackfillFlow(source: "card" | "command" = "command") {
    if (this.resolveFilingAuth().mode === "plus") {
      await this.runPlusBackfillFlow();
      return;
    }
    await this.runByokBackfillFlow(source);
  }

  /**
   * The complement's exclusive upper bound (KTD3).
   *
   * With auto-filing on, backfill owns everything strictly before the window that unattended
   * filing owns. With it off no unattended pass is claiming any of it, so the stored start day
   * is ignored and the offer covers all past captures. Read-only on purpose: a diagnostic or an
   * offer that minted the window start would steal `migrateAutoFilingWindow`'s stamp.
   */
  private backfillComplementBefore(today: string): string {
    const load = (k: string): unknown => this.app.loadLocalStorage(k) as unknown;
    if (!readDeviceAutoRunState(load).enabled) return today;
    return readAutoFilingSince(load, today);
  }

  /**
   * Is another filing pass already running? Both directions, in one place.
   *
   * The check is one synchronous step on purpose: the hourly pass, the manual catch-up and a
   * backfill can all land in the same tick, and two runs against two pinned context corpora is
   * exactly what the flags exist to prevent.
   */
  private backfillBusy(): boolean {
    if (this.autoRunInFlight) {
      new Notice("Atoms: filing already in progress");
      return true;
    }
    if (this.backfillInFlight) {
      new Notice("Atoms: backfill already in progress");
      return true;
    }
    return false;
  }

  /** The one bounded scan both engines derive their counts from. */
  private async backfillComplement(bounds: {
    since?: string;
    before: string;
  }): Promise<BackfillDaily[]> {
    const listed = await getPastDailyNotesWithUnmarkedCaptures(
      this.app,
      bounds,
    );
    return listed.notes.map((note) => ({
      date: note.date,
      path: note.path,
      unprocessedCount: note.unprocessed.length,
    }));
  }

  /**
   * Open the gate and wait for the verdict.
   *
   * `BackfillConfirmModal` closes *before* it calls `onConfirm`, so the close hook defers its own
   * answer by a microtask: a confirm settles the promise first, and a genuine dismissal still
   * settles it. A close hook that answered synchronously would report every confirm as a cancel.
   */
  private confirmBackfill(
    props: BackfillConfirmProps,
  ): Promise<"confirm" | "cancel"> {
    return new Promise((resolve) => {
      const modal = new BackfillConfirmModal(this.app, props, () => {
        resolve("confirm");
      });
      const closeHook = modal.onClose.bind(modal);
      modal.onClose = () => {
        closeHook();
        void Promise.resolve().then(() => resolve("cancel"));
      };
      modal.open();
    });
  }

  private plusClientConfig(): PlusClientConfig {
    return {
      baseUrl: this.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL,
      request: plusFetchRequest,
    };
  }

  /**
   * Price the offer against a meter read taken now (GET `/v1/me`), which returns `status`,
   * `remaining` and `periodEnd` together so all three are equally fresh.
   *
   * Never `classifyViaProxy`: that is a POST to `/v1/classify` reporting `remaining` only as a
   * side effect of actually classifying, so pricing through it would spend a filing and write an
   * atom to quote an offer the user has not accepted. A failed or rejected refresh leaves the
   * stored session untouched, takes the baseline reserve, and blocks nothing.
   */
  private async derivePlusBackfillOffer(): Promise<{
    props: Extract<BackfillConfirmProps, { engine: "plus" }>;
    range: RecentFirstRange;
    meterKnown: boolean;
  } | null> {
    const today = localDateString();
    const stored = readPlusSession(this.app);
    let fresh = false;
    if (stored) {
      const record = await refreshPlusEntitlementRecord(
        this.app,
        this.plusClientConfig(),
        stored,
      );
      fresh = record.kind === "ok";
    }
    // Re-read: a confirmed refresh has rewritten the session, a failed one has not.
    const session = readPlusSession(this.app);
    const budget = resolveBackfillBudget({
      period: session?.status === "trialing" ? "trial" : "paid",
      fresh,
      today,
      periodEnd: session?.periodEnd,
      remaining: session?.remaining,
    });
    const before = this.backfillComplementBefore(today);
    const range = deriveRecentFirstRange({
      dailies: await this.backfillComplement({ before }),
      before,
      budget: budget.budget,
    });
    if (range.totalCaptures === 0) {
      new Notice("Atoms: nothing to backfill (no unmarked past captures)");
      return null;
    }
    const meterKnown = session?.remaining !== undefined;
    return {
      range,
      meterKnown,
      props: {
        engine: "plus",
        run: range,
        // Omitted when nothing came back from the meter: a confidently wrong count on a
        // consent surface is worse than no count at all.
        ...(meterKnown ? { remaining: session?.remaining } : {}),
        daysRemaining: budget.daysRemaining,
      },
    };
  }

  /**
   * Plus/trial backfill: meter read → offer → confirm → bounded write pass.
   *
   * The loop exists for KTD11's top-up: the range, budget and counts on screen were all priced
   * against the pre-top-up meter, so a purchase re-derives the whole offer rather than re-showing
   * the one the user just paid to escape. It is bounded by `BACKFILL_TOPUP_ROUNDS` because an
   * over-budget offer can still be over budget after a purchase, and every round costs a meter
   * read and a vault scan.
   */
  private async runPlusBackfillFlow(): Promise<void> {
    if (this.backfillBusy()) return;
    // Held for the whole flow, not just the write pass: the confirm gate and the top-up poll are
    // both windows a second tap lands in, and a concurrent flow there means a duplicate vault
    // scan, a duplicate meter read and a second checkout tab.
    this.backfillInFlight = true;
    try {
      await this.plusBackfillRounds();
    } finally {
      this.backfillInFlight = false;
    }
  }

  /** The gate/run loop itself. Runs only under `backfillInFlight` — see its one caller. */
  private async plusBackfillRounds(): Promise<void> {
    for (let round = 0; round <= BACKFILL_TOPUP_ROUNDS; round += 1) {
      let offer: Awaited<ReturnType<AtomsPlugin["derivePlusBackfillOffer"]>>;
      try {
        offer = await this.derivePlusBackfillOffer();
      } catch (e) {
        devLog("[atoms] backfill offer failed", {
          name: e instanceof Error ? e.name : "Error",
          message: e instanceof Error ? e.message.slice(0, 200) : "unknown",
        });
        new Notice(
          `Atoms: backfill unavailable — ${e instanceof Error ? e.message.slice(0, 80) : "error"}`,
        );
        return;
      }
      if (!offer) return;
      if ((await this.confirmBackfill(offer.props)) !== "confirm") return;

      // No count came back, so the primary button read "Refresh status" — it asks for the meter
      // again, not for a run.
      if (!offer.meterKnown) {
        await this.refreshPlusEntitlementNow();
        return;
      }
      if (!offer.range.overBudget) {
        await this.executePlusBackfill(offer.range);
        return;
      }
      if (!(await this.buyBackfillTopUp())) return;
    }
    new Notice("Atoms: open backfill again to file the rest.");
  }

  /** The "Refresh status" branch of the gate — the meter, not a run. */
  private async refreshPlusEntitlementNow(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) return;
    const record = await refreshPlusEntitlementRecord(
      this.app,
      this.plusClientConfig(),
      session,
    );
    new Notice(`Atoms Plus: ${record.message}`);
  }

  /**
   * Buy filings for the over-budget offer, then wait for them to land.
   *
   * Checkout completes in a browser tab this plugin does not own, so the meter is the only
   * signal available. The poll is bounded rather than open-ended: a user who closed the tab must
   * get the flow back, not a spinner.
   */
  private async buyBackfillTopUp(): Promise<boolean> {
    const session = readPlusSession(this.app);
    if (!session) return false;
    const before = session.remaining ?? 0;
    const checkout = await createCheckout(
      this.plusClientConfig(),
      session.sessionToken,
      "topup_50",
    );
    if (!checkout.ok) {
      new Notice(`Atoms Plus: ${checkout.message}`);
      return false;
    }
    window.open(checkout.url, "_blank");
    new Notice(
      "Atoms Plus: finish checkout in the browser — backfill reopens with the new filings.",
    );

    for (let attempt = 0; attempt < this.backfillTopUpPoll.attempts; attempt += 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, this.backfillTopUpPoll.intervalMs);
      });
      const current = readPlusSession(this.app) ?? session;
      const record = await refreshPlusEntitlementRecord(
        this.app,
        this.plusClientConfig(),
        current,
      ).catch(() => null);
      if (record?.kind !== "ok") continue;
      if ((readPlusSession(this.app)?.remaining ?? 0) > before) return true;
    }
    new Notice("Atoms: no new filings yet — open backfill again once your top-up lands.");
    return false;
  }

  /**
   * The Plus engine (KTD7): the same per-capture write path `maybeAutoRun` uses, bounded by the
   * derived range. Not `backfill.ts`, which is Batch-API-and-BYOK by construction.
   */
  private async executePlusBackfill(range: RecentFirstRange): Promise<void> {
    // No guard and no flag of its own: `runPlusBackfillFlow` already holds `backfillInFlight` for
    // the whole flow this runs inside. Taking it a second time here would clear it on the way out
    // while the top-up loop is still live.
    try {
      const classifyAuth = this.requireClassifyAuth();
      if (!classifyAuth) return;
      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey: classifyAuth.apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        ...shortlistOptionsFromSettings(),
        enableHubProjection: this.settings.enableHubProjection === true,
        // Backfill is attended, but it is still past-only: today's daily belongs to nobody's
        // automatic pass and to no offer priced off the complement.
        includeToday: false,
        // Both bounds. `since` alone would file straight through the filing window auto-run
        // already owns — metered double-spend on the captures KTD3 exists to exclude.
        since: range.since,
        before: range.before,
        // Newest-first, and no `maxCaptures`: the range is already budget-bounded, so a cap
        // would only decide which end of it a paced run drops — and the recent end is the only
        // one whose filing quality the user can still judge.
        order: "newest-first",
        stopOnAuthExhausted: true,
        classifyDeps: { maxAttempts: 2, plus: classifyAuth.plus },
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

      const filed = report.entries.length;
      devLog("[atoms] plus backfill complete", {
        since: range.since,
        before: range.before,
        offered: range.captures,
        filed,
        failed: report.failed,
        stoppedReason: report.stoppedReason,
      });
      new Notice(
        report.stoppedReason === "exhausted"
          ? `Atoms backfill: filed ${filed} of ${range.captures} — filings ran out. It picks up here when they reset.`
          : `Atoms backfill: filed ${filed} capture${filed === 1 ? "" : "s"} (${report.atomsCreated} atom${report.atomsCreated === 1 ? "" : "s"})`,
      );
      if (report.atomsCreated > 0 || report.markersAppended > 0) {
        this.scheduleAskMirrorSync();
      }
      await this.refreshAtomsHomeLeaves();
    } catch (e) {
      devLog("[atoms] plus backfill failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      new Notice(
        `Atoms: backfill failed — ${e instanceof Error ? e.message.slice(0, 100) : "error"}`,
      );
    }
  }

  /**
   * The BYOK card's bounded range: no meter and nothing to reserve, but the same per-run cap.
   * `"empty"` and `"over-budget"` are the two answers that have no range to submit.
   */
  private async deriveByokBackfillRange(): Promise<
    RecentFirstRange | "empty" | "over-budget"
  > {
    const today = localDateString();
    const before = this.backfillComplementBefore(today);
    const budget = resolveBackfillBudget({
      period: "byok",
      fresh: false,
      today,
    });
    const range = deriveRecentFirstRange({
      dailies: await this.backfillComplement({ before }),
      before,
      budget: budget.budget,
    });
    if (range.totalCaptures === 0) return "empty";
    if (range.overBudget) return "over-budget";
    return range;
  }

  /**
   * U10 — estimate (count_tokens) → confirm modal → batch submit → poll → write path.
   * No batch is submitted until the user confirms the gate.
   *
   * BYOK has no meter and nothing to reserve, but the **card** takes the same per-run cap as
   * Plus: one card shape, one modal shape, one code path, and a recent-first default that stays
   * meaningful rather than decorative. Going beyond the cap stays this same command, unbounded.
   */
  private async runByokBackfillFlow(source: "card" | "command") {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;
    if (this.backfillBusy()) return;

    new Notice("Atoms: counting tokens for backfill estimate…");
    try {
      const model = DEFAULT_BACKFILL_MODEL;
      // The command scans all history, exactly as it did before the card existed. Only the card
      // derives a bounded range.
      const range =
        source === "card" ? await this.deriveByokBackfillRange() : null;
      if (range === "empty") {
        new Notice("Atoms: nothing to backfill (no unmarked past captures)");
        return;
      }
      if (range === "over-budget") {
        // A single daily bigger than one run — nothing this card can submit, but not a dead
        // end: the unbounded command still prices and submits the whole history.
        new Notice(
          `Atoms: the next day back is larger than one backfill run (${BACKFILL_CAP.byok} captures). Run "Backfill: estimate cost & confirm batch" for the whole history.`,
        );
        return;
      }
      const prepared = await prepareBackfillEstimate({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey,
        model,
        atomFolder: this.settings.atomFolder,
        shortlistK: shortlistOptionsFromSettings().shortlistK,
        since: range?.since,
        before: range?.before,
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
      const modal = new BackfillConfirmModal(
        this.app,
        { engine: "byok", estimate: prepared.estimate },
        async () => {
          confirmed = true;
          try {
            await this.executeBackfillBatch({
              apiKey,
              model,
              work: prepared.work,
              run: prepared.run,
              // Chunk one was priced against this same corpus with nothing yet written; resolving
              // it again would be byte-for-byte the same answer.
              firstChunk: prepared.chunks[0],
            });
          } finally {
            prepared.run.end();
          }
        },
      );
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
            listHubDetails: hubCtx.listHubDetails,
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
    // The same bound the next unattended pass will resolve. Unbounded here would report work
    // remaining on a drained window and `wouldRunNow: true` on a day already stamped — and this
    // command is what the CLI smoke reads as evidence, so that number would be read as a defect.
    // Read-only: a diagnostic must not mint the window start, which would also rob
    // `migrateAutoFilingWindow` of the stamp its flag depends on.
    const since = readAutoFilingSince(
      (k) => this.app.loadLocalStorage(k) as unknown,
      today,
    );
    const pastRemaining = await this.countPastUnprocessed({ since });
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
      filingSince: since,
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

  /**
   * The host `plusSignIn` keeps for the process lifetime — it stores this object once
   * (`host = next`) and reads `plusBaseUrl` later, at token-exchange time.
   *
   * `settings` is a live getter rather than `this.settings`, because every settings load
   * *replaces* that object: handing over the object itself would pin sign-in to whichever
   * copy existed at startup, so an edited or externally-synced base URL would never be
   * seen. Aliasing `plugin.settings` is the same mistake #323 was about, one field over.
   * A named seam, so the invariant can be asserted rather than only asserted about.
   */
  plusSignInHost() {
    // Live getters (not a snapshot of `this.settings`): loadSettings replaces the object.
    const getPlusBaseUrl = (): string => this.settings.plusBaseUrl;
    return {
      app: this.app,
      settings: {
        get plusBaseUrl() {
          return getPlusBaseUrl();
        },
      },
      // The only gate in front of the exchange (#240 U10 / R4): the modal owns
      // the question, `platform/plusSignIn` owns what a "confirmed" spends.
      confirmSignIn: (request: Parameters<typeof askSignInApproval>[1]) =>
        askSignInApproval(this.app, request),
      // Identity-aware install (#393) — same boundary Settings paste/trial use.
      installSession: (session: import("../platform/filingAuth").PlusSession) =>
        this.installPlusSession(session),
    };
  }

  /**
   * Write a Plus session after disarming Ask when the identity changes (#393).
   * Same-account re-auth keeps the hash baseline.
   */
  async installPlusSession(
    session: import("../platform/filingAuth").PlusSession,
  ): Promise<void> {
    const { installPlusSession } = await import("../platform/plusSessionInstall");
    await installPlusSession(
      {
        settings: this.settings,
        saveSettings: () => this.saveSettings(),
        mirrorPermitted: () => this.ask.mirrorPermitted(),
        cancelPendingSync: () => this.ask.cancelPendingSync(),
        saveLocalStorage: (k, v) => this.app.saveLocalStorage(k, v),
        loadLocalStorage: (k): unknown => this.app.loadLocalStorage(k),
      },
      session,
    );
  }

  async loadSettings() {
    // `?? {}` belongs to startup only: on a fresh install there is no file, and
    // defaults are the right answer. Reached from the external-change hook the
    // same coalesce would read an empty `data.json` as "wipe everything", so
    // that path supplies its own `raw` and rejects the wipe shape first.
    const raw = ((await this.loadData()) ?? {}) as Partial<LinkerSettings>;
    if (this.applyLoadedSettings(raw)) await this.saveSettings();
  }

  /**
   * R11b — already-on users learn list hubs are now included (one-shot).
   */
  async maybeShowHubProjectionListDisclosure(): Promise<void> {
    if (this.settings.enableHubProjection !== true) return;
    if (this.settings.hubProjectionListDisclosureSeen === true) return;
    new Notice(
      "Atoms: List atoms on hub notes now covers list hubs too (like Movies), not only people. Your writing above the list is still never changed.",
      12000,
    );
    this.settings.hubProjectionListDisclosureSeen = true;
    await this.saveSettings();
  }

  /**
   * Preview hub list bulk update (toggle-on or Refresh), then write on confirm.
   */
  async openHubListPreview(_source: "toggle-on" | "refresh"): Promise<void> {
    if (this.settings.enableHubProjection !== true) return;
    const preparing = new Notice("Atoms: preparing hub list preview…", 0);
    try {
      const {
        buildFullHubProjectionPlan,
        applyHubProjectionPlan,
        noticeHubProjectionErrors,
      } = await import("../pipeline/runHubProjection");
      const {
        summarizeHubProjectionPlan,
        filterPlanIncludeUnsorted,
      } = await import("../pipeline/hubListPreview");
      const { openHubListPreviewModal } = await import(
        "../settings/hubListPreviewModal"
      );

      const built = await buildFullHubProjectionPlan({
        app: this.app,
        enabled: true,
        atomFolder: this.settings.atomFolder,
        personHubDetails: this.contextProvider?.buildContext()
          .personHubDetails,
      });
      preparing.hide();

      const withU = summarizeHubProjectionPlan(built.plan);
      const withoutU = summarizeHubProjectionPlan(
        filterPlanIncludeUnsorted(built.plan, false),
      );

      const result = await openHubListPreviewModal(this.app, withU, withoutU);
      if (result.action !== "confirm") return;

      const plan = filterPlanIncludeUnsorted(
        built.plan,
        result.includeUnsorted,
      );
      const applied = await applyHubProjectionPlan(this.app, plan);
      const filled = plan.writes.filter((w) => w.changed).length;
      new Notice(
        `Atoms: updated ${applied.wrote} hub list${
          applied.wrote === 1 ? "" : "s"
        }${
          filled > applied.wrote
            ? ` (${filled - applied.wrote} planned but not written)`
            : ""
        }`,
        10000,
      );
      noticeHubProjectionErrors(applied.errors, 2);
    } catch {
      preparing.hide();
      new Notice("Atoms: could not refresh hub lists", 6000);
    }
  }

  /** @deprecated use openHubListPreview — kept for any stray callers */
  async runHubProjectionFullRegenNotice(): Promise<void> {
    await this.openHubListPreview("toggle-on");
  }

  /**
   * The merge tail shared by startup and the external-change hook. Replaces
   * `this.settings` rather than mutating it — the "never alias `plugin.settings`"
   * invariant below is what makes one assignment close every gate at once.
   * Returns whether the legacy strip left disk owing a write.
   */
  private applyLoadedSettings(raw: Partial<LinkerSettings>): boolean {
    // One-time strip of the retired synced hash map: mirror evidence is
    // device-local (CLAUDE.md non-negotiable 12), and `data.json` syncs. This
    // is deletion, not migration — the value is never read back as evidence,
    // and dropping it fails safe (no evidence plans no deletes).
    const stripped = stripLegacyAskMirrorHashes(raw);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    this.settings.atomFolder = clampAtomFolder(this.settings.atomFolder);
    settleAckRecords(this.settings);
    return stripped;
  }

  /**
   * Take only the consent this external read says is gone, leaving every other field to the
   * local write that won the race. Mutates in place rather than replacing the object for that
   * reason: the winner's copy is the newer one everywhere except here.
   *
   * Only an *explicitly* falsy value counts. An absent key is the same ambiguity the blank-file
   * guards refuse to resolve — it could mean withdrawn or it could mean a partial read, and a
   * withdrawal is not something to invent. A grant never crosses this branch in either case.
   */
  private async adoptExternalWithdrawal(next: Partial<LinkerSettings>): Promise<void> {
    let changed = false;
    const revoke = <
      K extends
        | "askEnabled"
        | "askPrivacyAckAt"
        | "askPrivacyAckVersion"
        | "askWriteAckAt"
        | "askWriteAckVersion",
    >(
      key: K,
      cleared: LinkerSettings[K],
    ) => {
      if (!(key in next) || next[key] || !this.settings[key]) return;
      this.settings[key] = cleared;
      changed = true;
    };
    /**
     * An ack's two halves are one record, so its version dies with its timestamp.
     *
     * `revoke` alone is not enough for the pair. It acts only on a key that is *present and
     * falsy*, and the device most likely to send this withdrawal is one whose schema predates
     * the version field entirely — so the key is not falsy, it is absent, and a per-key revoke
     * silently keeps the version. That leaves a withdrawn ack still naming current wording: the
     * next enable on this device would find a stamp it never wrote and grant without the sheet.
     * Forcing the version here is safe because the branch has already decided this is a
     * withdrawal.
     */
    const revokePaired = (
      at: "askPrivacyAckAt" | "askWriteAckAt",
      version: "askPrivacyAckVersion" | "askWriteAckVersion",
    ) => {
      revoke(at, "");
      if (this.settings[at] || !this.settings[version]) return;
      this.settings[version] = "";
      changed = true;
    };
    revoke("askEnabled", false);
    revokePaired("askPrivacyAckAt", "askPrivacyAckVersion");
    revokePaired("askWriteAckAt", "askWriteAckVersion");
    // The write ack cannot outlive the privacy ack it was granted on top of, and this path can
    // take the broader one without the narrower one being mentioned at all.
    if (!askPrivacyAckIsCurrent(this.settings) && this.settings.askWriteAckAt) {
      this.settings.askWriteAckAt = "";
      this.settings.askWriteAckVersion = "";
      changed = true;
    }
    if (!changed) return;
    // Persist now. The save that won the race has already put the grant back on disk, so
    // leaving this in memory alone would let the next writer push it out to every device.
    await this.saveSettings();
    if (!this.ask.mirrorPermitted()) this.ask.cancelPendingSync();
    this.settingTab?.refreshFromExternalSettings();
  }

  /**
   * #323 — Obsidian fires this when `data.json` changes underneath a running plugin, which is
   * what Sync replicating another device's write looks like from here. Without it there is no
   * re-read path at all (`loadData()` is called once, above), so every consent gate keeps
   * answering to the copy loaded at startup: a withdrawal on the phone leaves this device
   * mirroring note bodies under a consent that no longer exists on disk.
   *
   * The invariant that makes this hold: never alias `plugin.settings`. Gates read it through
   * the plugin at the moment of egress, so re-pointing it here closes them all at once.
   */
  async onExternalSettingsChange(): Promise<void> {
    const before = JSON.stringify(this.settings ?? null);
    // A local save that starts while we are reading has already persisted what memory holds,
    // so applying the older copy we read would undo it. `saveSettings()` writes the whole
    // settings object, so the loser of that race loses everything, not just the field the
    // writer touched. The generation tells us the race happened; see the mismatch branch
    // below for the one thing that still crosses it.
    const generation = this.settingsGeneration;
    let raw: unknown;
    try {
      raw = await this.loadData();
    } catch (err) {
      // A file caught mid-write must not be read as a blank — that shape is indistinguishable
      // from a withdrawal, and inventing one would be its own bug. Keeping the last good copy
      // leaves the gate where the user put it until a readable file arrives. Never rethrow:
      // this runs inside Obsidian's caller.
      //
      // Deliberately not `devLog`: it is a no-op everywhere (the Community plugin scan forbids
      // `console`), so it would buy no diagnostics, and it dereferences an esbuild-injected
      // const that does not exist under vitest.
      void err;
      return;
    }
    // The non-throwing shape of the same mid-write file. `?? {}` would turn it into a full
    // reset to DEFAULT_SETTINGS at runtime — consent fails closed, but `plusBaseUrl`,
    // `atomFolder`, and the active vocabulary are gone, and the next save persists that wipe
    // everywhere. Treat it exactly like the throw: keep the last good copy.
    // `{}` and `[]` are objects, so a `typeof` test alone lets the very shape this guard exists
    // to refuse straight through — and `Object.assign` then resets every field to its default,
    // inventing a withdrawal and wiping `atomFolder` / `plusBaseUrl` / the vocabulary with it.
    // A settings file that has never been written is `null`, not empty, so a keyless object is
    // always a mid-write artifact rather than a legitimate state.
    if (raw == null || typeof raw !== "object") return;
    if (Array.isArray(raw) || Object.keys(raw).length === 0) return;
    const next = raw as Partial<LinkerSettings>;
    if (generation !== this.settingsGeneration) {
      // A local save overtook this read, so its copy is the newer one for every ordinary
      // field. Consent is not an ordinary field: the local writer persists whatever memory
      // held, which is still a *grant* if this read is the first thing carrying the remote
      // withdrawal. Dropping the read wholesale would therefore erase a withdrawal from
      // memory and from disk at once, and Sync would carry the resurrected grant back to the
      // device that just revoked it. So one thing crosses the race — the withdrawal, never
      // the grant. Consent only ever moves toward closed here.
      await this.adoptExternalWithdrawal(next);
      return;
    }
    if (this.applyLoadedSettings(next)) {
      await this.saveSettings();
    }
    // Consent may have just been withdrawn elsewhere. Closing the gates is not enough on its
    // own: a mirror pass already inside its single-flight loop owes itself a follow-up that
    // never re-enters `sync()`. Cancel what is owed. Asked through the coordinator rather
    // than re-derived here, so the egress predicate keeps exactly one home. Unconditional
    // rather than keyed on a before→after transition, so it holds whatever this device
    // previously believed.
    if (!this.ask.mirrorPermitted()) this.ask.cancelPendingSync();
    // Everything below only decides whether to rebuild an open Settings screen.
    if (!this.settingTab) return;
    // The screen was rendered against the state we just replaced; a Review row still showing a
    // consent that is gone on disk is the same defect wearing a different coat. Rebuilding it
    // costs a full `containerEl.empty()` and re-render, so skip that when the file changed in
    // ways this screen cannot show — including `loadSettings`' own legacy-hash write bouncing
    // back through this hook.
    if (JSON.stringify(this.settings) === before) return;
    this.settingTab.refreshFromExternalSettings();
  }

  async saveSettings() {
    this.settingsGeneration += 1;
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
      const local: unknown = this.app.loadLocalStorage(LOCAL_STORAGE_API_KEY);
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
      // Deliberately unbounded, unlike every filing surface: this is the diagnostic that
      // answers "what is actually unmarked in this vault", including everything outside the
      // filing window. Bounding it would hide exactly what someone runs it to see.
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
