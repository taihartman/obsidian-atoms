import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";
import { ATOMS_HOME_VIEW_TYPE, AtomsHomeView } from "../home/atomsHomeView";
import { clampAtomFolder } from "../pipeline/render";
import { registerAtomsCommands } from "./commands";
import { runOpenAtomGraph } from "../graph/openAtomGraph";

/** Injected by esbuild: true in watch/dev, false in production Community builds. */
declare const ATOMS_DEV_COMMANDS: boolean;

/** Dev-only console logging — ATOMS_DEV_COMMANDS is false in production (esbuild DCE). */
function devLog(...args: unknown[]): void {
  if (typeof ATOMS_DEV_COMMANDS === "undefined" || !ATOMS_DEV_COMMANDS) return;
  // eslint-disable-next-line no-console -- dev/watch builds only
  console.log(...args);
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
import { MetadataContextProvider } from "../pipeline/context";
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
  flagOffNotice,
  filedNotice,
  collisionNotice,
  gateReconsiderTarget,
  missNotice,
} from "../pipeline/reconsider";
import { ReconsiderModal } from "../pipeline/reconsiderModal";
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
  formatConnectivityConsole,
  runConnectivityTest,
  type ConnectivityReport,
} from "../platform/connectivity";
import {
  applyBackfillResults,
  BackfillConfirmModal,
  buildBatchCreateBody,
  DEFAULT_BACKFILL_MODEL,
  fetchBatchResultsJsonl,
  parseBatchResultsJsonl,
  prepareBackfillEstimate,
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

export default class AtomsPlugin extends Plugin {
  settings!: LinkerSettings;
  contextProvider!: MetadataContextProvider;
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
  /** Set true only after waitForVaultIndexReady (U9 cold-start gate). */
  private vaultIndexReady = false;

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

    // U9: never block launch — schedule auto-run after layout + metadata.
    void this.scheduleAutoRunLifecycle();
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
    const apiKey = usingFixtures
      ? this.getApiKey() || "fixture"
      : needsApi
        ? this.requireApiKey()
        : this.getApiKey() || "polish-only";
    if (needsApi && !apiKey) return;

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
        limit: opts?.limit,
        fixtureResults: opts?.fixtureResults,
        classifyDeps: {
          maxAttempts: 2,
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
  }

  private async scheduleAutoRunLifecycle() {
    try {
      await waitForVaultIndexReady(this.app);
      this.vaultIndexReady = true;
    } catch {
      // If wait fails, still mark ready after a beat so we aren't stuck forever.
      this.vaultIndexReady = true;
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
      hasKey: !!this.getApiKey(),
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
  async maybeAutoRun(source: "onload" | "interval" | "manual"): Promise<{
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

    if (
      !shouldRunAutoProcess({
        enabled: state.enabled,
        lastRunDay: state.lastRunDay,
        today,
        egressAcked: state.egressAcked,
        pastUnprocessedRemaining: pastRemaining,
      })
    ) {
      return {
        ran: false,
        reason: !state.enabled
          ? "disabled"
          : !state.egressAcked
            ? "no_egress_ack"
            : pastRemaining > 0
              ? "blocked"
              : "same_day",
      };
    }

    if (this.autoRunInFlight) {
      return { ran: false, reason: "in_flight" };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      // Silent for auto path — manual commands still Notice. Do not stamp.
      devLog("[atoms] auto-run skipped: no API key");
      return { ran: false, reason: "missing_key" };
    }

    // Nothing to do — stamp day so hourly interval does not re-scan forever.
    if (pastRemaining === 0) {
      writeLastRunDay(save, today);
      devLog("[atoms] auto-run empty success", { source });
      return { ran: true, reason: "empty" };
    }

    this.autoRunInFlight = true;
    try {
      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        maxCaptures: PER_LAUNCH_CAP,
        // never includeToday on auto-run
        classifyDeps: {
          maxAttempts: 2,
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
        new Notice(
          `Atoms: filed ${filed} capture${filed === 1 ? "" : "s"} (${report.atomsCreated} atom${report.atomsCreated === 1 ? "" : "s"})`,
        );
        if (this.hasOpenAtomsHome()) {
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
    });
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
      });
      this.lastBackfillEstimate = prepared.estimate;

      devLog("[atoms] backfill estimate", {
        ...prepared.estimate,
        workItems: prepared.work.length,
      });

      if (prepared.work.length === 0) {
        new Notice("Atoms: nothing to backfill (no unmarked past captures)");
        return;
      }

      new Notice(
        `Atoms: ${prepared.estimate.summaryLine} — confirm in the dialog`,
      );

      new BackfillConfirmModal(this.app, prepared.estimate, async () => {
        await this.executeBackfillBatch({
          apiKey,
          model,
          work: prepared.work,
          context: prepared.context,
        });
      }).open();
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

  private async executeBackfillBatch(opts: {
    apiKey: string;
    model: string;
    work: import("../pipeline/backfill").BackfillWorkItem[];
    context: import("../shared/types").VaultContext;
  }) {
    if (this.backfillInFlight) return;
    this.backfillInFlight = true;
    try {
      const body = buildBatchCreateBody(opts.work, opts.model, opts.context);
      new Notice(
        `Atoms: submitting batch (${opts.work.length} request(s))…`,
      );
      const { batchId, requestCount } = await submitMessageBatch({
        apiKey: opts.apiKey,
        body,
      });
      this.lastBackfillBatchId = batchId;
      devLog("[atoms] batch submitted", { batchId, requestCount });

      new Notice("Atoms: batch submitted — waiting for results…");
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
      const lines = parseBatchResultsJsonl(jsonl);
      const hubCtx = this.contextProvider.buildContext();
      const report = await applyBackfillResults({
        app: this.app,
        work: opts.work,
        lines,
        atomFolder: this.settings.atomFolder,
        activeVocabulary: this.settings.activeVocabulary,
        personHubDetails: hubCtx.personHubDetails,
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
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<LinkerSettings>,
    );
    this.settings.atomFolder = clampAtomFolder(this.settings.atomFolder);
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

  private requireApiKey(): string | null {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      new Notice("Atoms: set your API key in settings");
      return null;
    }
    return apiKey;
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
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

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
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        maxCaptures: 15,
        includeToday: opts?.includeToday,
        classifyDeps: {
          maxAttempts: 2,
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
        maxCaptures: fixtures.length,
        fixtureResults: fixtures,
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
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

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
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        // Bound work for interactive use; remainder stays unmarked for next run.
        maxCaptures: 15,
        includeToday: opts?.includeToday,
        classifyDeps: {
          // Fail fast on network blips during preview (still retries once).
          maxAttempts: 2,
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
   * Gated by settings.enableReconsiderCapture (default off).
   */
  async runReconsiderCapture() {
    if (!this.settings.enableReconsiderCapture) {
      new Notice(flagOffNotice());
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !(view.file instanceof TFile)) {
      new Notice(missNotice());
      return;
    }

    const file = view.file;
    const content = view.editor.getValue();
    const cursor = view.editor.getCursor();
    const line0 = cursor.line;

    const capture = findCaptureAtLine(content, line0);
    const gate = gateReconsiderTarget(capture);
    if (!gate.ok) {
      if (gate.reason === "atom") {
        new Notice(atomRefuseNotice());
      } else {
        new Notice(missNotice());
      }
      return;
    }

    const apiKey = this.requireApiKey();
    if (!apiKey) return;

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
      const outcome = await classifyCapture(gate.capture.text, ctx, {
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        maxAttempts: 2,
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

      new ReconsiderModal(this.app, {
        capture: gate.capture,
        nowKind,
        result,
        onApply: async () => {
          const report = await applyReconsiderWrite({
            app: this.app,
            dailyPath: file.path,
            dailyDate: dailyDateForFile(this.app, file),
            capture: gate.capture,
            result,
            atomFolder: this.settings.atomFolder,
          });
          if (!report.ok) {
            if (report.reason === "collision") {
              new Notice(collisionNotice());
            } else if (report.reason === "no_change") {
              /* Apply should have been disabled */
            } else {
              new Notice("Atoms: could not reconsider (see console)");
              devLog("[atoms] reconsider apply failed", report);
            }
            return;
          }
          new Notice(filedNotice(report.title ?? result.title));
          this.forEachAtomsHome((v) => {
            void v.refresh();
          });
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
