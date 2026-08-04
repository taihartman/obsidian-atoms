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

/**
 * The single-flight state one mirror push runs inside. The plugin owns the
 * object; this module owns every transition on it, because the bug the shape
 * exists to prevent (H2) is a flag outliving the run that set it.
 */
export type MirrorSingleFlightState = {
  inFlight: boolean;
  /** Another push was requested while this one held the lock. */
  followUp: boolean;
  /** ...and at least one of those requests was forced. */
  forceFollowUp: boolean;
};

export type MirrorSingleFlightHost = {
  state: MirrorSingleFlightState;
  /** Runs once this call owns the lock, before the first pass. */
  onBegin(): void;
  /** One push. `force` is the pass's effective force, follow-ups folded in. */
  once(force: boolean): Promise<Exclude<MirrorSyncOutcome, { kind: "joined" }>>;
};

/**
 * Run a mirror push under single-flight, absorbing concurrent requests into
 * the running pass instead of racing a second one.
 *
 * A joining caller can *upgrade* the run to forced, which is the whole reason
 * the force flag is shared state and not a parameter — and the whole reason it
 * is dangerous. `force` authorises a full keepPaths reconcile: every cloud row
 * this scan does not name is deleted. So the flag is consumed on entry to each
 * pass and cleared again on every exit, including the early returns — see the
 * `finally`.
 */
export async function runMirrorSingleFlight(
  host: MirrorSingleFlightHost,
  force: boolean,
): Promise<MirrorSyncOutcome> {
  const s = host.state;
  if (s.inFlight) {
    s.followUp = true;
    if (force) s.forceFollowUp = true;
    return { kind: "joined" };
  }
  s.inFlight = true;
  host.onBegin();
  let uploaded = 0;
  let deleted = 0;
  try {
    do {
      s.followUp = false;
      const runForce = force || s.forceFollowUp;
      s.forceFollowUp = false;
      const once = await host.once(runForce);
      if (once.kind === "failed") return once;
      if (once.kind === "refused") {
        // A refusal will refuse again this pass; surface it now rather than
        // looping, and never as a zero-work success.
        return { ...once, uploaded: uploaded + once.uploaded };
      }
      uploaded += once.uploaded;
      deleted += once.deleted;
    } while (s.followUp);
    return { kind: "worked", uploaded, deleted };
  } finally {
    // Both follow-up flags belong to the run that owns them, so neither may
    // outlive it (H2). A forced call joining mid-run sets `forceFollowUp`
    // during an `await` above; the `failed` and `refused` early returns exit
    // without consuming it, and the next unforced push — the vault watcher
    // fires one on any edit — would then compute `runForce` true and reconcile
    // with no user gesture behind it. Dropping a force is safe: nothing is
    // deleted and Sync now is one tap away. Carrying one into an unforced run
    // is not.
    s.forceFollowUp = false;
    s.followUp = false;
    s.inFlight = false;
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
  | {
      kind: "refused";
      landed: number;
      rejected: number;
      /** Which threshold refused, carried through from the mirror push. */
      reason?: MirrorDeletionRefusal;
    }
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
            : mirror.kind === "refused"
              ? {
                  kind: "refused",
                  landed,
                  rejected,
                  ...(mirror.reason ? { reason: mirror.reason } : {}),
                }
              : { kind: "joined", landed, rejected },
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
