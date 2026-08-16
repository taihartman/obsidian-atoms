/**
 * Ask mirror + outbox plugin glue — single owner of debounce / dirty /
 * notice / flight flags, vault watchers, layout-ready catch-up, and the
 * Obsidian host wiring for `runAskMirrorSync` + `runAskOutboxApply`.
 *
 * Pure planners stay in `platform/askMirror` + `platform/askOutbox`.
 * Single-flight + outbox loop stay in `catchUp.ts` (testable without main).
 * This module is the residual peel of what still sat on `AtomsPlugin` after #226.
 *
 * AtomsPlugin keeps thin public wrappers for stable call sites.
 * Do not import home/. Secrets stay on the plugin (session via filingAuth).
 */
import { Notice, TFile } from "obsidian";
import type AtomsPlugin from "./main";
import { clampAtomFolder } from "../pipeline/render";
import { fireAndForgetAsk } from "../shared/fireAndForget";
import { askMirrorPermitted, askWriteAckIsCurrent } from "../shared/askAck";
import {
  isAskMirrorWatchPath,
  readAskMirrorHashes,
  truncateMessage,
} from "../platform/askMirror";
import {
  applyOutboxItemToVault,
  runAskOutboxApply,
  runMirrorSingleFlight,
  type AskOutboxHost,
  type AskOutboxOutcome,
  type MirrorSingleFlightState,
  type OutboxVaultPort,
} from "./catchUp";
import type { MirrorSyncOutcome } from "../shared/mirrorOutcome";

/** Why a push stopped when consent is not in place. One string, two gates. */
const MIRROR_OFF = "Ask mirror is off";

/**
 * Single owner of Ask orchestration state still living on the plugin after #226.
 * Construct once per plugin instance; do not split flight flags across modules.
 */
export class AskCoordinator {
  private askOutboxInFlight = false;
  /** Owned by runMirrorSingleFlight — never flip these fields by hand. */
  private readonly askMirrorFlight: MirrorSingleFlightState = {
    inFlight: false,
    followUp: false,
    forceFollowUp: false,
  };
  private askMirrorNoticeShown = false;
  private askMirrorDebounceTimer: number | null = null;
  private askMirrorDirty = false;

  constructor(private readonly plugin: AtomsPlugin) {}

  /**
   * Layout-ready vault events + catch-up sync/outbox, and 60s outbox poll.
   * Call once from plugin onload after settings load.
   */
  registerLifecycle(): void {
    const p = this.plugin;
    p.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      fireAndForgetAsk(this.applyOutbox());
      fireAndForgetAsk(this.sync({ force: false }));
    });
    p.registerInterval(
      window.setInterval(() => {
        fireAndForgetAsk(this.applyOutbox());
      }, 60_000),
    );
  }

  /**
   * Debounced vault watch for Ask mirror parity.
   * Flat Atoms/*.md + hubs already in this device's hash evidence
   * (not every vault .md — dailies would storm-sync). New hubs seed via
   * end-of-run Process/Update/invite push.
   */
  private registerVaultEvents(): void {
    const p = this.plugin;
    const schedule = () => this.scheduleSync();
    const watch = (path: string) => {
      const folder = p.settings.atomFolder || "Atoms";
      const hashes = readAskMirrorHashes(
        (k) => p.app.loadLocalStorage(k) as unknown,
      );
      return isAskMirrorWatchPath(path, folder, hashes);
    };
    p.registerEvent(
      p.app.vault.on("create", (f) => {
        if (watch(f.path)) schedule();
      }),
    );
    p.registerEvent(
      p.app.vault.on("modify", (f) => {
        if (watch(f.path)) schedule();
      }),
    );
    p.registerEvent(
      p.app.vault.on("delete", (f) => {
        if (watch(f.path)) schedule();
      }),
    );
    p.registerEvent(
      p.app.vault.on("rename", (f, oldPath) => {
        if (watch(f.path) || watch(oldPath)) schedule();
      }),
    );
  }

  /**
   * Whether the mirror may push *right now*, delegated to `askMirrorPermitted` in
   * `shared/askAck.ts` — the actual home of the egress predicate, and where a new condition
   * belongs. Kept as a method because the coordinator's own call sites read it dozens of
   * times; it adds no condition of its own, and must not start.
   *
   * Read live at every call rather than captured, because `data.json` syncs — a withdrawal on
   * another device replaces `plugin.settings` underneath a pass already running (#323).
   */
  mirrorPermitted(): boolean {
    return askMirrorPermitted(this.plugin.settings);
  }

  /** Forget the debounced push this device owes itself; keeps no timer alive. */
  private clearDebouncedPush(): void {
    if (this.askMirrorDebounceTimer != null) {
      window.clearTimeout(this.askMirrorDebounceTimer);
      this.askMirrorDebounceTimer = null;
    }
    this.askMirrorDirty = false;
  }

  /**
   * Drop every push this device still owes itself. Called when the external-settings
   * hook lands a state the mirror may not push under.
   *
   * The single-flight flags are documented as owned by `runMirrorSingleFlight`, and
   * they are — but clearing them is monotonic in the safe direction: it can only
   * cancel work, never start it, and the run's own `finally` clears them again.
   * Setting either one from outside would be the violation.
   */
  cancelPendingSync(): void {
    this.askMirrorFlight.followUp = false;
    this.askMirrorFlight.forceFollowUp = false;
    this.clearDebouncedPush();
  }

  /** Debounced best-effort push after vault or pipeline writes. */
  scheduleSync(): void {
    if (!this.mirrorPermitted()) {
      return;
    }
    // Coalesce into the in-flight run instead of a second post-run debounce.
    if (this.askMirrorFlight.inFlight) {
      this.askMirrorFlight.followUp = true;
      return;
    }
    this.askMirrorDirty = true;
    if (this.askMirrorDebounceTimer != null) {
      window.clearTimeout(this.askMirrorDebounceTimer);
    }
    this.askMirrorDebounceTimer = window.setTimeout(() => {
      this.askMirrorDebounceTimer = null;
      if (!this.askMirrorDirty) return;
      this.askMirrorDirty = false;
      fireAndForgetAsk(this.sync({ force: false }));
    }, 2000);
  }

  /**
   * Pull Ask outbox and create atoms under Atoms/ (best-effort).
   * Requires Ask mirror enabled + Allow filing ack.
   */
  async applyOutbox(): Promise<AskOutboxOutcome> {
    const p = this.plugin;
    const idle: AskOutboxOutcome = { kind: "worked", landed: 0, rejected: 0 };
    // The shared half asked through `mirrorPermitted()`, not re-derived: a hand-written
    // second copy is exactly how the next condition added to the gate misses this path.
    // The write ack is this path's own — it authorizes cloud data landing in the vault.
    if (!this.mirrorPermitted() || !askWriteAckIsCurrent(p.settings)) {
      return idle;
    }
    const host = await this.createOutboxHost();
    if (!host) return idle;
    return runAskOutboxApply(host);
  }

  /**
   * #508 — was this session issued by the base we are about to push atoms to?
   *
   * Asked where the config is *built*, not where each request goes out, so one
   * pass asks once however many upserts, deletes and reconciles it then makes.
   * That is already the "once per run, not once per atom" bound, which is why
   * there is no verdict cache here: a longer-lived memo would leave a briefly
   * unreachable host refused until the plugin reloaded. `plusClient` holds the
   * egress backstop for the requests themselves.
   */
  private async verifyBase(
    session: import("../platform/filingAuth").PlusSession,
    base: string,
  ): Promise<import("../platform/plusBaseVerify").PlusBaseVerdict> {
    const p = this.plugin;
    const { verifyPlusBase } = await import("../platform/plusBaseVerify");
    const { plusFetchRequest } = await import("../platform/plusClient");
    return verifyPlusBase(
      { storage: p.app, request: plusFetchRequest },
      {
        session,
        resolvedBase: base,
        // The raw field, not the resolved base: an empty one means the plugin
        // has no address it can trust, not the hosted default (KTD1 carve-out).
        configuredBase: p.settings.plusBaseUrl,
      },
    );
  }

  /** Vault + Plus wiring for the outbox loop; null when there is no session. */
  private async createOutboxHost(): Promise<AskOutboxHost | null> {
    const p = this.plugin;
    const { readPlusSession } = await import("../platform/filingAuth");
    const session = readPlusSession(p.app);
    if (!session) return null;
    const {
      DEFAULT_PLUS_BASE_URL,
      askOutboxPull,
      askOutboxAck,
      plusFetchRequest,
    } = await import("../platform/plusClient");
    const base = p.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    // #508. The ack is not id-and-status: `askOutboxAck` also sends `error`,
    // which is `plan.reason` — free text from the vault, not a fixed literal.
    // Sorting it as content-free was the wrong axis, and that is the #500
    // learning. Silent like the other refusals on this path; the user finds out
    // through the classify Notice, which fires for the same reason.
    const verdict = await this.verifyBase(session, base);
    if (verdict.kind !== "verified") return null;
    const cfg = { baseUrl: base, request: plusFetchRequest, verifiedBase: verdict.base };
    const token = session.sessionToken;
    const folder = clampAtomFolder(p.settings.atomFolder);
    const vault: OutboxVaultPort = {
      readIfExists: async (path) => {
        const f = p.app.vault.getAbstractFileByPath(path);
        return f instanceof TFile ? p.app.vault.read(f) : null;
      },
      ensureFolder: async (path) => {
        if (!p.app.vault.getAbstractFileByPath(path)) {
          await p.app.vault.createFolder(path);
        }
      },
      create: (path, content) => p.app.vault.create(path, content).then(),
      modify: async (path, content) => {
        const f = p.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) {
          throw new Error("missing");
        }
        await p.app.vault.modify(f, content);
      },
    };

    return {
      beginPass: () => {
        if (this.askOutboxInFlight) return false;
        this.askOutboxInFlight = true;
        return true;
      },
      endPass: () => {
        this.askOutboxInFlight = false;
      },
      pullOne: async () => {
        const pull = await askOutboxPull(cfg, token, 1);
        if (!pull.ok || pull.items.length === 0) return null;
        return pull.items[0]!;
      },
      ack: async (id, ack) => {
        await askOutboxAck(cfg, token, { id, ...ack });
      },
      // Read live off `plugin.settings`, never captured: `data.json` syncs, so a withdrawal
      // made on another device replaces the object underneath a pass that is already running.
      // Same two halves the entry gate asks, asked again per item.
      writePermitted: () =>
        this.mirrorPermitted() && askWriteAckIsCurrent(p.settings),
      applyToVault: (payload, kind) =>
        applyOutboxItemToVault(vault, folder, payload, kind),
      syncMirror: () => this.sync({ force: false }),
      notice: (message) => new Notice(message),
      onLanded: () => {
        void p.refreshAtomsHomeLeaves();
      },
    };
  }

  /**
   * Push Atoms/ to Plus Ask mirror (best-effort). Returns a four-way outcome —
   * `joined` is not `worked` with a zero count, because nothing reached the
   * cloud yet, and `refused` is not success (R7, R15).
   * force: full reconcile (keepPaths orphan delete). Never early-return before delete/reconcile.
   */
  async sync(opts?: { force?: boolean }): Promise<MirrorSyncOutcome> {
    if (!this.mirrorPermitted()) {
      if (opts?.force) new Notice("Enable Ask and acknowledge privacy first");
      return { kind: "failed", message: MIRROR_OFF };
    }
    return runMirrorSingleFlight(
      {
        state: this.askMirrorFlight,
        // Absorb pending debounce into this run (avoids Process + 2s double push).
        onBegin: () => this.clearDebouncedPush(),
        once: (force) => this.runSyncOnce(force),
      },
      Boolean(opts?.force),
    );
  }

  private async runSyncOnce(
    force: boolean,
  ): Promise<Exclude<MirrorSyncOutcome, { kind: "joined" }>> {
    const p = this.plugin;
    // The only gate a *follow-up* pass ever crosses: `runMirrorSingleFlight` loops back
    // into `once()`, never into `sync()`, so the check at the top of `sync()` answers
    // for the first pass alone. Without this one, a consent withdrawn mid-run was
    // followed by a second pass uploading note bodies under it (#323 F1). Silent —
    // `sync()` owns the notice for the forced gesture, and a follow-up has no user
    // behind it.
    //
    // Not the last check before the upload — the upload is several awaits further on. The host
    // below carries `stillPermitted`, which asks this same predicate again between chunks, so a
    // withdrawal or a sign-out landing mid-pass stops it there.
    if (!this.mirrorPermitted()) {
      return { kind: "failed", message: MIRROR_OFF };
    }
    const { readPlusSession } = await import("../platform/filingAuth");
    const session = readPlusSession(p.app);
    if (!session) {
      if (force) new Notice("Sign in to Atoms Plus first");
      return { kind: "failed", message: "Not signed in to Atoms Plus" };
    }
    const {
      DEFAULT_PLUS_BASE_URL,
      askMirrorUpsert,
      askMirrorDelete,
      askMirrorReconcile,
      askMirrorStatus,
      plusFetchRequest,
    } = await import("../platform/plusClient");
    const { runAskMirrorSync, isHubMirrorPath } = await import(
      "../platform/askMirror"
    );
    const { AskMirrorDeleteConfirmModal } = await import("../settings/settings");

    // Retained so a timed-out confirm can be withdrawn. confirmWithTimeout
    // abandons the promise after 2 minutes; a dialog left on screen would keep
    // offering "Delete from cloud" against an already-settled promise, so the
    // user would authorise an irreversible delete and nothing would happen.
    let pendingConfirmModal: InstanceType<
      typeof AskMirrorDeleteConfirmModal
    > | null = null;

    const folder = "Atoms";
    const base = p.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    // #508. This config reaches upsert (atom bodies), mirror/delete (vault
    // paths) and mirror/reconcile (the whole vault path list), so gating where
    // it is built covers all three. A cleared field resolves to the hosted
    // default and passes every #500 check, which is how a self-hoster's atom
    // bodies would reach production.
    const verdict = await this.verifyBase(session, base);
    if (verdict.kind !== "verified") {
      // The verdict's own copy: "couldn't be reached" and "needs its address"
      // ask the reader for different things, and flattening them to one line
      // would tell a briefly offline user to edit a field that is fine.
      if (force) new Notice(`Atoms: ${verdict.message}`);
      return { kind: "failed", message: verdict.message };
    }
    const cfg = { baseUrl: base, request: plusFetchRequest, verifiedBase: verdict.base };
    const token = session.sessionToken;
    const read = async (f: TFile) => ({
      path: f.path,
      basename: f.basename,
      content: await p.app.vault.read(f),
    });

    const result = await runAskMirrorSync(
      {
        atomFolder: folder,
        scanAtoms: async () => {
          const { isFlatAtomPath } = await import("../platform/askMirror");
          return Promise.all(
            p.app.vault
              .getMarkdownFiles()
              .filter((f) => isFlatAtomPath(folder, f.path))
              .map(read),
          );
        },
        resolveHubs: async (titles) => {
          const hubFiles: TFile[] = [];
          const seen = new Set<string>();
          for (const title of titles) {
            const dest = p.app.metadataCache.getFirstLinkpathDest(title, "");
            if (!dest || dest.extension !== "md") continue;
            if (!isHubMirrorPath(dest.path, folder)) continue;
            if (seen.has(dest.path)) continue;
            seen.add(dest.path);
            hubFiles.push(dest);
          }
          return Promise.all(hubFiles.map(read));
        },
        load: (k) => p.app.loadLocalStorage(k) as unknown,
        save: (k, v) => p.app.saveLocalStorage(k, v),
        // The same live predicate, asked between the pass's own awaits. Sign out disarms and
        // *then* empties the baseline, so without this a chunk landing in between persists the
        // snapshot it took at pass start and hands the next account a baseline it never pushed.
        stillPermitted: () => this.mirrorPermitted(),
        upsert: (atoms) => askMirrorUpsert(cfg, token, atoms),
        deletePaths: (paths) => askMirrorDelete(cfg, token, paths),
        reconcile: (opts) => askMirrorReconcile(cfg, token, opts),
        status: () => askMirrorStatus(cfg, token),
        // The only gesture that can mint a DeletionConfirmation.
        confirm: (request) =>
          new Promise((resolve) => {
            try {
              pendingConfirmModal = new AskMirrorDeleteConfirmModal(
                p.app,
                request,
                (choice) => {
                  pendingConfirmModal = null;
                  resolve(choice);
                },
              );
              pendingConfirmModal.open();
            } catch {
              // A modal that cannot open must not park the sync forever.
              // "dismissed" already means leave the mirror untouched.
              pendingConfirmModal = null;
              resolve("dismissed");
            }
          }),
        cancelConfirm: () => {
          pendingConfirmModal?.close();
          pendingConfirmModal = null;
        },
        notice: (message) => new Notice(message),
      },
      { force },
    );

    if (result.kind === "failed") {
      const msg = result.failureMessage ?? "";
      // Stopped rather than broken: the user turned the mirror off (or signed out) while this
      // pass was in the air. Telling them their push failed reads as an error report for
      // something they just asked for, so this arm is silent — same as the entry gate's.
      if (!this.mirrorPermitted()) return { kind: "failed", message: MIRROR_OFF };
      const snip = truncateMessage(msg, 72);
      // The dedupe flag exists to stop *background* passes from nagging after
      // the first failure. It must never silence a push the user just asked
      // for: "Sync now" is the one gesture that always reports its outcome.
      if (force || !this.askMirrorNoticeShown) {
        this.askMirrorNoticeShown = true;
        new Notice(
          snip
            ? `Ask: push failed (${snip}) · Sync now to retry`
            : "Ask: last push failed · Sync now to retry",
        );
      }
      return { kind: "failed", ...(msg ? { message: msg } : {}) };
    }
    this.askMirrorNoticeShown = false;
    // The gate withheld deletion (U1). Dropping this here is what let the
    // loudest channel — Settings' Sync now toast — say "reconciled".
    if (result.refused) {
      return {
        kind: "refused",
        uploaded: result.uploaded,
        ...(result.refusalReason ? { reason: result.refusalReason } : {}),
      };
    }
    // Best-effort: fill search-expansion phrases for rows that still lack them
    // (first deploy / soft-fail). Never block Sync success on expand quality —
    // so it is fired, never awaited. Awaiting it held "Sync now" open for the
    // whole server-side expand pass (one model call per missing row), which on
    // a first sync is minutes and reads to the user as a hung Sync.
    fireAndForgetAsk(
      import("../platform/plusClient").then(({ askMirrorExpandBackfill }) =>
        askMirrorExpandBackfill(cfg, token, { limit: 50 }),
      ),
    );
    return {
      kind: "worked",
      uploaded: result.uploaded,
      deleted: result.deleted,
    };
  }
}
