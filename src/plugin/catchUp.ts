/**
 * Catch-up orchestration (KTD15).
 *
 * The Ask outbox apply loop and the shared busy/result vocabulary live here,
 * against an **injected host**, rather than in `main.ts` (already ~2000 lines
 * and named in `CLAUDE.md` as "not a dumping ground") or in `platform/`
 * (which would drag the plugin instance across the module boundary). The host
 * is also what makes the loop testable at all: no test in this repo imports
 * `main.ts`, because the shared Obsidian mock stubs `Plugin` as an empty class.
 */

import type { MirrorDeletionRefusal } from "../platform/askMirror";
import {
  planAskOutboxApply,
  type AskOutboxPayload,
} from "../platform/askOutbox";
import { atomPathForTitle } from "../pipeline/render";

/**
 * What a mirror push actually did. Four outcomes, not a number:
 *
 * - `worked` — the push ran; `uploaded` may legitimately be 0.
 * - `joined` — an in-flight pass absorbed this request. **Nothing has reached
 *   the cloud yet.** This is the state the old `0` return collapsed into
 *   "uploaded nothing, all good", which is what acked outbox entries the cloud
 *   never received (R15).
 * - `refused` — the completeness gate withheld deletion (R8). Some atoms may
 *   still have been uploaded before the gate, but the mirror did not converge,
 *   and a caller must not report this as success.
 * - `failed` — hard failure; the old `-1`.
 */
export type MirrorSyncOutcome =
  | { kind: "worked"; uploaded: number; deleted: number }
  | { kind: "joined" }
  | { kind: "refused"; uploaded: number; reason?: MirrorDeletionRefusal }
  | { kind: "failed"; message?: string };

/** True only when the cloud confirmed receipt — the sole ack condition (R15). */
export function mirrorConfirmedReceipt(outcome: MirrorSyncOutcome): boolean {
  return outcome.kind === "worked";
}

/** One-line, user-facing reason a forced sync was refused (never "success"). */
export function describeMirrorRefusal(reason?: MirrorDeletionRefusal): string {
  switch (reason) {
    case "no-server-count":
      return "Ask mirror: sync refused — this device has never seen the cloud count; nothing was deleted";
    case "server-count-tripwire":
      return "Ask mirror: sync refused — this vault holds far fewer atoms than the cloud; nothing was deleted";
    default:
      return "Ask mirror: sync refused — vault scan looks incomplete; nothing was deleted";
  }
}

/**
 * The toast Settings' "Sync now" shows. All four outcomes read differently.
 * `failed` is the one that returns null, because a *forced* push always shows
 * its own failure Notice first — every failing path in `syncAskMirror` toasts
 * unconditionally when `force` is set, bypassing the background dedupe flag.
 * A second toast here would double up, not fill a silence.
 */
export function syncNowNotice(outcome: MirrorSyncOutcome): string | null {
  switch (outcome.kind) {
    case "joined":
      return "Ask mirror: a sync is already running — joined it";
    case "refused":
      return describeMirrorRefusal(outcome.reason);
    case "worked":
      return outcome.uploaded === 0
        ? "Ask mirror reconciled"
        : `Ask mirror: uploaded ${outcome.uploaded} atom(s)`;
    case "failed":
      return null;
  }
}

/** An outbox row as pulled from Plus. */
export type AskOutboxItem = {
  id: string;
  payload?: Partial<AskOutboxPayload> | null;
};

/** What the vault write did with one item. */
export type OutboxApplyResult =
  | { kind: "applied" }
  | { kind: "rejected"; error: string };

/**
 * What an outbox pass did. `landed` counts only entries whose atom the cloud
 * confirmed; anything not acked stays pending for the next pass.
 *
 * `joined` covers both ways another pass can own the work: this pass never
 * started (the single-flight lock was held), or it stopped because the mirror
 * push was absorbed into an in-flight one.
 */
export type AskOutboxOutcome =
  | { kind: "worked"; landed: number; rejected: number }
  | { kind: "joined"; landed: number; rejected: number }
  | { kind: "refused"; landed: number; rejected: number }
  | { kind: "failed"; landed: number; rejected: number; message?: string };

export type AskOutboxHost = {
  /** Claim the single-flight lock. False when a pass is already running. */
  beginPass(): boolean;
  endPass(): void;
  /** Next pending item, or null when the outbox is empty or unreachable. */
  pullOne(): Promise<AskOutboxItem | null>;
  ack(
    id: string,
    ack: { status: "applied" | "rejected"; error?: string },
  ): Promise<void>;
  /** Write the atom into the vault (create-only; never rewrites a body). */
  applyToVault(payload: AskOutboxPayload): Promise<OutboxApplyResult>;
  /** Push the vault so the atom just written is actually in the cloud. */
  syncMirror(): Promise<MirrorSyncOutcome>;
  notice(message: string): void;
  /** Something landed — refresh surfaces that count atoms. */
  onLanded(): void;
};

/** The vault operations the outbox apply needs, without `obsidian` types. */
export type OutboxVaultPort = {
  /** File content, or null when nothing readable is at that path. */
  readIfExists(path: string): Promise<string | null>;
  ensureFolder(path: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
};

/**
 * Create-only atom write for one outbox item: never rewrites an existing body,
 * and re-plans against the winner when two devices race the same path.
 */
export async function applyOutboxItemToVault(
  vault: OutboxVaultPort,
  folder: string,
  payload: AskOutboxPayload,
): Promise<OutboxApplyResult> {
  const existing = await vault.readIfExists(
    atomPathForTitle(folder, payload.title),
  );
  let plan = planAskOutboxApply(payload, folder, existing);
  if (plan.action === "create") {
    const parent = plan.path.includes("/")
      ? plan.path.slice(0, plan.path.lastIndexOf("/"))
      : folder;
    if (parent) await vault.ensureFolder(parent);
    try {
      await vault.create(plan.path, plan.content);
    } catch {
      // Lost the race, or the path is unwritable. Re-plan against what is
      // actually there; only a truly missing file is a rejection.
      const content = await vault.readIfExists(plan.path);
      if (content == null) return { kind: "rejected", error: "create_failed" };
      plan = planAskOutboxApply(payload, folder, content);
    }
  }
  if (plan.action === "reject") return { kind: "rejected", error: plan.reason };
  return { kind: "applied" };
}

/** One item per pull (P0), capped so a pass cannot run away. */
const MAX_ITEMS_PER_PASS = 10;

export function formatAskOutboxNotice(
  landed: number,
  rejected: number,
): string {
  const parts: string[] = [];
  if (landed > 0) parts.push(`landed ${landed} atom(s)`);
  if (rejected > 0) parts.push(`${rejected} write(s) rejected`);
  return `Ask: ${parts.join(", ")}`;
}

/**
 * Pull Ask outbox items and create atoms, acking each only once the cloud has
 * confirmed the atom (R15).
 */
export async function runAskOutboxApply(
  host: AskOutboxHost,
): Promise<AskOutboxOutcome> {
  if (!host.beginPass()) return { kind: "joined", landed: 0, rejected: 0 };
  let landed = 0;
  let rejected = 0;
  try {
    /** Announce what actually landed, then report it. */
    const finish = <T extends AskOutboxOutcome>(outcome: T): T => {
      if (landed > 0 || rejected > 0) {
        host.notice(formatAskOutboxNotice(landed, rejected));
        host.onLanded();
      }
      return outcome;
    };
    for (let i = 0; i < MAX_ITEMS_PER_PASS; i++) {
      const item = await host.pullOne();
      if (!item) break;
      const payload = item.payload;
      if (!payload?.title || payload.body == null) {
        await host.ack(item.id, {
          status: "rejected",
          error: "invalid_payload",
        });
        rejected++;
        continue;
      }
      const applied = await host.applyToVault({
        title: payload.title,
        body: String(payload.body),
        ...(payload.tags ? { tags: payload.tags } : {}),
        ...(payload.links ? { links: payload.links } : {}),
      });
      if (applied.kind === "rejected") {
        await host.ack(item.id, { status: "rejected", error: applied.error });
        rejected++;
        continue;
      }
      const mirror = await host.syncMirror();
      // The ack rule (R15): an entry is retired only when the cloud confirmed
      // receipt. A `joined` push has moved nothing yet — acking it drops the
      // write on the floor, since the outbox never serves it again. Stop and
      // leave the entry pending; the next pass re-pulls it.
      if (!mirrorConfirmedReceipt(mirror)) {
        return finish(
          mirror.kind === "failed"
            ? {
                kind: "failed",
                landed,
                rejected,
                ...(mirror.message ? { message: mirror.message } : {}),
              }
            : { kind: mirror.kind, landed, rejected },
        );
      }
      await host.ack(item.id, { status: "applied" });
      landed++;
    }
    return finish({ kind: "worked", landed, rejected });
  } finally {
    host.endPass();
  }
}
