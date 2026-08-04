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
import {
  isAskMirrorWatchPath,
  readAskMirrorHashes,
} from "../platform/askMirror";
import {
  applyOutboxItemToVault,
  runAskOutboxApply,
  runMirrorSingleFlight,
  type AskOutboxHost,
  type AskOutboxOutcome,
  type MirrorSingleFlightState,
  type MirrorSyncOutcome,
  type OutboxVaultPort,
} from "./catchUp";

/** Process/Update must never fail because mirror/outbox failed. */
export function fireAndForgetAsk(task: Promise<unknown>): void {
  void task.catch(() => {
    /* best-effort — vault write already committed */
  });
}

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

  /** Debounced best-effort push after vault or pipeline writes. */
  scheduleSync(): void {
    const p = this.plugin;
    if (!p.settings.askEnabled || !p.settings.askPrivacyAckAt) {
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
    if (
      !p.settings.askEnabled ||
      !p.settings.askPrivacyAckAt ||
      !p.settings.askWriteAckAt
    ) {
      return idle;
    }
    const host = await this.createOutboxHost();
    if (!host) return idle;
    return runAskOutboxApply(host);
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
    const cfg = { baseUrl: base, request: plusFetchRequest };
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
      applyToVault: (payload) => applyOutboxItemToVault(vault, folder, payload),
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
    const p = this.plugin;
    if (!p.settings.askEnabled || !p.settings.askPrivacyAckAt) {
      if (opts?.force) new Notice("Enable Ask and acknowledge privacy first");
      return { kind: "failed", message: "Ask mirror is off" };
    }
    return runMirrorSingleFlight(
      {
        state: this.askMirrorFlight,
        onBegin: () => {
          // Absorb pending debounce into this run (avoids Process + 2s
          // double push).
          if (this.askMirrorDebounceTimer != null) {
            window.clearTimeout(this.askMirrorDebounceTimer);
            this.askMirrorDebounceTimer = null;
          }
          this.askMirrorDirty = false;
        },
        once: (force) => this.runSyncOnce(force),
      },
      Boolean(opts?.force),
    );
  }

  private async runSyncOnce(
    force: boolean,
  ): Promise<Exclude<MirrorSyncOutcome, { kind: "joined" }>> {
    const p = this.plugin;
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
    const cfg = { baseUrl: base, request: plusFetchRequest };
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
      const snip = msg.replace(/\s+/g, " ").trim().slice(0, 72);
      // The dedupe flag exists to stop *background* passes from nagging after
      // the first failure. It must never silence a push the user just asked
      // for: "Sync now" is the one gesture that always reports its outcome.
      if (force || !this.askMirrorNoticeShown) {
        this.askMirrorNoticeShown = true;
        new Notice(
          snip
            ? `Ask: push failed — ${snip} · Sync now to retry`
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
    return {
      kind: "worked",
      uploaded: result.uploaded,
      deleted: result.deleted,
    };
  }
}
