import { Notice, Plugin, WorkspaceLeaf, requestUrl } from "obsidian";
import { ATOMS_HOME_VIEW_TYPE, AtomsHomeView } from "./atomsHomeView";
import {
  classifyCapture,
  logClassifyOutcome,
  buildMessagesRequest,
  buildDayBatchRequest,
  buildContextUserMessage,
  parseUsage,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
} from "./classify";
import { MetadataContextProvider } from "./context";
import {
  DailyNotesDisabledError,
  getPastDailyNotesWithUnmarkedCaptures,
} from "./daily";
import { AtomsSettingTab } from "./settings";
import {
  DEFAULT_SETTINGS,
  LOCAL_STORAGE_API_KEY,
  SPIKE_CAPTURE,
  SPIKE_CONTEXT,
  type ClassifyOutcome,
  type LinkerSettings,
} from "./types";
import {
  DryRunPreviewModal,
  mergeProposedFromReport,
  renderPreviewMarkdown,
  runDryRun,
  showDryRunNotice,
  type DryRunReport,
} from "./preview";
import { runWritePath, type WritePathReport } from "./write";
import type { ClassificationResult } from "./types";
import { mergeProposedTags } from "./vocabulary";
import {
  canBuildContext,
  localDateString,
  PER_LAUNCH_CAP,
  readDeviceAutoRunState,
  shouldRunAutoProcess,
  waitForVaultIndexReady,
  writeLastRunDay,
} from "./autorun";
import {
  formatConnectivityConsole,
  runConnectivityTest,
  type ConnectivityReport,
} from "./connectivity";
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
} from "./backfill";

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

    // U9: never block launch — schedule auto-run after layout + metadata.
    void this.scheduleAutoRunLifecycle();
  }

  async activateAtomsHome(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(ATOMS_HOME_VIEW_TYPE);
    if (existing.length) {
      leaf = existing[0]!;
    } else {
      leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf(false);
      await leaf.setViewState({ type: ATOMS_HOME_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof AtomsHomeView) {
      await view.refresh();
    }
  }

  /** Called from Atoms home Preview — same dry-run as command. */
  async runDryRunFromHome(): Promise<void> {
    await this.runDryRunPreview();
  }

  /** Called from Atoms home Process — same write path as command. */
  async runProcessFromHome(): Promise<void> {
    await this.runProcessUnprocessed();
  }

  /** Called from Atoms home ⋯ menu. */
  async runTestConnectionFromHome(): Promise<void> {
    await this.runTestConnection();
  }

  /** Called from Atoms home ⋯ menu. */
  async runBackfillFromHome(): Promise<void> {
    await this.runBackfillFlow();
  }

  /** Open/create today's daily and show it in the editor. */
  async openTodaysDailyFromHome(): Promise<void> {
    try {
      const { openTodaysDaily } = await import("./daily");
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

  /**
   * Device-local auto-run gate + silent failure (R13, U9).
   * Does not invoke buildContext until vaultIndexReady.
   */
  async maybeAutoRun(source: "onload" | "interval" | "manual"): Promise<{
    ran: boolean;
    reason: string;
  }> {
    const load = (k: string) => this.app.loadLocalStorage(k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);
    const today = localDateString();

    if (!canBuildContext(this.vaultIndexReady)) {
      return { ran: false, reason: "cache_not_ready" };
    }

    if (
      !shouldRunAutoProcess({
        enabled: state.enabled,
        lastRunDay: state.lastRunDay,
        today,
        egressAcked: state.egressAcked,
      })
    ) {
      return {
        ran: false,
        reason: !state.enabled
          ? "disabled"
          : !state.egressAcked
            ? "no_egress_ack"
            : "same_day",
      };
    }

    if (this.autoRunInFlight) {
      return { ran: false, reason: "in_flight" };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      // Silent for auto path — manual commands still Notice.
      console.log("[atoms] auto-run skipped: no API key");
      return { ran: false, reason: "missing_key" };
    }

    this.autoRunInFlight = true;
    try {
      // Stamp the day when we *attempt* so onload+interval don't double-fire
      // the same calendar day even if processing fails mid-way (markers still
      // make partial progress safe; remainder drains next successful day or manual).
      writeLastRunDay(save, today);

      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        maxCaptures: PER_LAUNCH_CAP,
        classifyDeps: {
          maxAttempts: 2,
          // Auto-run: no auth spam Notices every hour — log only.
          onAuthFailure: (msg) => {
            console.log("[atoms] auto-run auth failure", msg);
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

      const filed = report.markersAppended;
      if (filed > 0) {
        new Notice(
          `Atoms: filed ${filed} capture${filed === 1 ? "" : "s"} (${report.atomsCreated} atom${report.atomsCreated === 1 ? "" : "s"})`,
        );
      }
      // Offline / all-failed: silent (retry next launch / next day).
      console.log("[atoms] auto-run complete", {
        source,
        filed,
        atoms: report.atomsCreated,
        failed: report.failed,
        scanned: report.scanned,
      });
      return { ran: true, reason: "ok" };
    } catch (e) {
      // Never crash launch.
      console.log("[atoms] auto-run error", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      return { ran: false, reason: "error" };
    } finally {
      this.autoRunInFlight = false;
    }
  }

  private registerCommands() {
    this.addCommand({
      id: "open-atoms-home",
      name: "Open Atoms home",
      callback: () => {
        void this.activateAtomsHome();
      },
    });

    this.addCommand({
      id: "spike-classify-hardcoded",
      name: "Spike: classify hardcoded capture",
      callback: () => {
        void this.runSpikeClassify();
      },
    });

    this.addCommand({
      id: "spike-cache-and-batch-fork",
      name: "Spike: measure cache + per-day batch fork (KTD3)",
      callback: () => {
        void this.runSpikeCacheAndBatch();
      },
    });

    this.addCommand({
      id: "spike-secret-storage-probe",
      name: "Spike: probe SecretStorage read/write",
      callback: () => {
        this.runSecretStorageProbe();
      },
    });

    this.addCommand({
      id: "list-unprocessed-captures",
      name: "List unprocessed captures (log only)",
      callback: () => {
        void this.runListUnprocessed();
      },
    });

    this.addCommand({
      id: "log-context-prefix",
      name: "Log vault context prefix (stable cache bytes)",
      callback: () => {
        this.runLogContextPrefix();
      },
    });

    this.addCommand({
      id: "classify-first-unprocessed",
      name: "Classify first unprocessed capture (log only)",
      callback: () => {
        void this.runClassifyFirstUnprocessed();
      },
    });

    this.addCommand({
      id: "dry-run-preview",
      name: "Dry-run: preview classifications (no writes)",
      callback: () => {
        void this.runDryRunPreview();
      },
    });

    this.addCommand({
      id: "process-unprocessed",
      name: "Process unprocessed captures (write atoms + markers)",
      callback: () => {
        void this.runProcessUnprocessed();
      },
    });

    /** Fixture write for CLI/dev when API is offline — still real vault writes. */
    this.addCommand({
      id: "process-fixture-sample",
      name: "Dev: write path with fixture classifications (test vault)",
      callback: () => {
        void this.runProcessFixtureSample();
      },
    });

    this.addCommand({
      id: "auto-run-status",
      name: "Auto-run: show device-local status",
      callback: () => {
        this.showAutoRunStatus();
      },
    });

    this.addCommand({
      id: "auto-run-now",
      name: "Auto-run: try now (respects device gates)",
      callback: () => {
        void this.maybeAutoRun("manual").then((r) => {
          new Notice(`Atoms auto-run: ${r.ran ? "ran" : "skipped"} (${r.reason})`);
        });
      },
    });

    this.addCommand({
      id: "test-connection",
      name: "Test connection (HTTPS + Anthropic)",
      callback: () => {
        void this.runTestConnection();
      },
    });

    this.addCommand({
      id: "backfill-estimate-confirm",
      name: "Backfill: estimate cost & confirm batch",
      callback: () => {
        void this.runBackfillFlow();
      },
    });
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
  private async runBackfillFlow() {
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

      console.log("[atoms] backfill estimate", {
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
      console.log("[atoms] backfill estimate failed", {
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
    work: import("./backfill").BackfillWorkItem[];
    context: import("./types").VaultContext;
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
      console.log("[atoms] batch submitted", { batchId, requestCount });

      new Notice("Atoms: batch submitted — waiting for results…");
      await waitForBatchEnded({
        apiKey: opts.apiKey,
        batchId,
        intervalMs: 8000,
        maxWaitMs: 60 * 60 * 1000,
        onTick: (status) => {
          console.log("[atoms] batch status", status);
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

      console.log("[atoms] backfill applied", report);
      new Notice(
        `Atoms backfill: ${report.applied} applied, ${report.atomsCreated} atom(s), ${report.markersAppended} marker(s), ${report.failed} failed`,
      );
    } catch (e) {
      console.log("[atoms] backfill execute failed", {
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
      console.log(
        "[atoms] connectivity",
        formatConnectivityConsole(report),
      );
      new Notice(`Atoms: ${report.userMessage}`);
    } catch (e) {
      console.log("[atoms] connectivity test failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message.slice(0, 160) : "unknown",
      });
      new Notice("Atoms: connection test failed unexpectedly (see console)");
    }
  }

  private showAutoRunStatus() {
    const load = (k: string) => this.app.loadLocalStorage(k);
    const state = readDeviceAutoRunState(load);
    const today = localDateString();
    const would = shouldRunAutoProcess({
      enabled: state.enabled,
      lastRunDay: state.lastRunDay,
      today,
      egressAcked: state.egressAcked,
    });
    const payload = {
      ...state,
      today,
      vaultIndexReady: this.vaultIndexReady,
      inFlight: this.autoRunInFlight,
      wouldRunNow: would,
      perLaunchCap: PER_LAUNCH_CAP,
      // Prove flag is not in synced settings object
      inDataJsonSettings: "autoRun" in (this.settings as object),
    };
    console.log("[atoms] auto-run status", payload);
    new Notice(
      `Atoms auto-run: ${state.enabled ? "on" : "off"} · ack=${state.egressAcked} · last=${state.lastRunDay ?? "never"} · ready=${this.vaultIndexReady}`,
    );
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<LinkerSettings>,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getApiKey(): string | null {
    const secretId = this.settings.apiKeySecretId?.trim();
    if (secretId && this.app.secretStorage) {
      try {
        const fromSecret = this.app.secretStorage.getSecret(secretId);
        if (fromSecret) return fromSecret;
      } catch {
        /* fall through */
      }
    }

    if (this.settings.useDeviceLocalKeyFallback) {
      const local = this.app.loadLocalStorage(LOCAL_STORAGE_API_KEY);
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

  private runLogContextPrefix() {
    const ctx = this.contextProvider.buildContext();
    const prefix = buildContextUserMessage(ctx);
    const prefix2 = buildContextUserMessage(
      this.contextProvider.buildContext(),
    );
    console.log("[atoms] context prefix", {
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
   * U8 — classify + write atoms/markers for past unprocessed captures.
   */
  private async runProcessUnprocessed() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

    new Notice("Atoms: processing (writing)…");
    try {
      const report = await runWritePath({
        app: this.app,
        contextProvider: this.contextProvider,
        apiKey,
        model: this.settings.model,
        activeVocabulary: this.settings.activeVocabulary,
        atomFolder: this.settings.atomFolder,
        maxCaptures: 15,
        classifyDeps: {
          maxAttempts: 2,
          onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
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
      console.log("[atoms] write report", {
        atomsCreated: report.atomsCreated,
        markersAppended: report.markersAppended,
        collisions: report.collisions,
        failed: report.failed,
        scanned: report.scanned,
        entries: report.entries.map((e) => ({
          date: e.date,
          verdict: e.verdict,
          title: e.title,
          atom: e.write.atomCreated,
          marker: e.write.markerAppended,
        })),
      });
      new Notice(
        `Atoms: wrote ${report.atomsCreated} atom(s), ${report.markersAppended} marker(s), ${report.collisions} collision(s), ${report.failed} failed`,
      );
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        new Notice(e.message);
        return;
      }
      console.log("[atoms] write path failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: write path failed (see console)");
    }
  }

  /**
   * U8 verification without Anthropic: process first few unprocessed captures
   * with deterministic fixture verdicts (atom / task / noise).
   */
  private async runProcessFixtureSample() {
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
      console.log("[atoms] fixture write report", {
        atomsCreated: report.atomsCreated,
        markersAppended: report.markersAppended,
        collisions: report.collisions,
        entries: report.entries,
      });
      new Notice(
        `Atoms fixture: ${report.atomsCreated} atom(s), ${report.markersAppended} marker(s)`,
      );
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        new Notice(e.message);
        return;
      }
      console.log("[atoms] fixture write failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: fixture write failed (see console)");
    }
  }

  /**
   * U7 — full pipeline dry-run. Modal + lastDryRun* for CLI.
   * Never creates atoms or appends markers (AE5).
   */
  private async runDryRunPreview() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

    new Notice("Atoms: dry-run starting…");
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
        classifyDeps: {
          // Fail fast on network blips during preview (still retries once).
          maxAttempts: 2,
          onAuthFailure: (msg) => new Notice(`Atoms: ${msg}`),
        },
        onProgress: (done, total) => {
          if (done === total || done % 5 === 0) {
            console.log(`[atoms] dry-run progress ${done}/${total}`);
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

      console.log("[atoms] dry-run report", {
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
      console.log("[atoms] dry-run markdown\n" + md);

      showDryRunNotice(report);
      new DryRunPreviewModal(
        this.app,
        md,
        `${report.classified} ok · ${report.failed} failed · ${report.entries.length} shown of ${report.totalUnprocessedScanned} unprocessed · zero vault writes`,
      ).open();
    } catch (e) {
      if (e instanceof DailyNotesDisabledError) {
        new Notice(e.message);
        return;
      }
      console.log("[atoms] dry-run failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: dry-run failed (see console)");
    }
  }

  private async runListUnprocessed() {
    try {
      const { notes, totalUnprocessed } =
        await getPastDailyNotesWithUnmarkedCaptures(this.app);
      console.log("[atoms] unprocessed captures", {
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
      console.log("[atoms] list-unprocessed failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: failed to list captures (see console)");
    }
  }

  private async runClassifyFirstUnprocessed() {
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
      console.log("[atoms] classify-first failed", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice("Atoms: classify failed (see console)");
    }
  }

  private async runSpikeClassify() {
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

  private async runSpikeCacheAndBatch() {
    const apiKey = this.requireApiKey();
    if (!apiKey) return;

    const captures = [
      SPIKE_CAPTURE,
      "buy oat milk and eggs on the way home",
      "reminded me of [[Sleep debt doesn't accumulate linearly]] — maybe the plateau is just denial",
    ];

    new Notice("Atoms: measuring per-capture cache + day-batch…");
    console.log("[atoms] === KTD3 fork measurement start ===");

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
    console.log("[atoms] per-capture usage summary", {
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
      console.log("[atoms] day-batch", {
        status: res.status,
        usage: parseUsage(json.usage),
      });
    } catch {
      console.log("[atoms] day-batch network error (details redacted)");
    }

    const shape = buildMessagesRequest({
      model: this.settings.model,
      capture: SPIKE_CAPTURE,
      context: SPIKE_CONTEXT,
    });
    const msgs = shape.messages as Array<{
      content: Array<{ cache_control?: unknown }>;
    }>;
    console.log("[atoms] request shape (safe)", {
      captureAfterBreakpoint:
        Boolean(msgs[0]?.content?.[0]?.cache_control) &&
        !msgs[1]?.content?.[0]?.cache_control,
    });

    new Notice("Atoms: KTD3 measurement logged to console");
  }

  private runSecretStorageProbe() {
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
      console.log("[atoms] SecretStorage probe FAILED", {
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message : "unknown",
      });
      new Notice(
        "Atoms: SecretStorage failed — enable device-local key fallback",
      );
    }
  }
}
