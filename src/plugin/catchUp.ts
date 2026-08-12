/**
 * Catch-up orchestration (KTD15).
 *
 * The Ask outbox apply loop and the single-flight busy state live here, against
 * an **injected host**, rather than in `main.ts` (already ~2000 lines and named
 * in `CLAUDE.md` as "not a dumping ground") or in `platform/` (which would drag
 * the plugin instance across the module boundary). The host is also what makes
 * the loop testable at all: no test in this repo imports `main.ts`, because the
 * shared Obsidian mock stubs `Plugin` as an empty class.
 *
 * The *result* vocabulary — `MirrorSyncOutcome`, `mirrorConfirmedReceipt`,
 * `describeMirrorRefusal`, `syncNowNotice` — lives in `shared/mirrorOutcome.ts`,
 * because `settings/` needs it too and must not import a value out of `plugin/`.
 */

import {
  planAskOutboxApply,
  planSetLoopApply,
  type AskOutboxPayload,
} from "../platform/askOutbox";
import { atomPathForTitle } from "../pipeline/render";
import type { MirrorDeletionRefusal } from "../shared/confirm";
import {
  mirrorConfirmedReceipt,
  type MirrorSyncOutcome,
} from "../shared/mirrorOutcome";

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
  kind?: string;
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
  /**
   * Whether this pass may still create files, asked **live** before every item.
   *
   * One pass hands up to ten network round trips to this loop, and consent can be withdrawn
   * during any of them — locally, or by Sync landing another device's withdrawal. Checking once
   * at the entry gate leaves items 2..N landing in the vault under a consent that is already
   * gone. The mirror push has carried its own second gate for exactly this reason since #323;
   * the outbox, which is the path that actually writes files, had none.
   */
  writePermitted(): boolean;
  /**
   * Write the outbox item into the vault.
   * create/continue: create-only body. set_loop: FM-only modify.
   */
  applyToVault(
    payload: AskOutboxPayload,
    kind?: string,
  ): Promise<OutboxApplyResult>;
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
  /** Overwrite existing file content (set_loop FM patch). */
  modify(path: string, content: string): Promise<void>;
};

/**
 * Apply one outbox item: create/continue are create-only; set_loop patches FM.
 */
export async function applyOutboxItemToVault(
  vault: OutboxVaultPort,
  folder: string,
  payload: AskOutboxPayload,
  kind?: string,
): Promise<OutboxApplyResult> {
  if ((kind || "").toLowerCase() === "set_loop") {
    const existing = await vault.readIfExists(
      atomPathForTitle(folder, payload.title),
    );
    const plan = planSetLoopApply(payload, folder, existing);
    if (plan.action === "reject") {
      return { kind: "rejected", error: plan.reason };
    }
    if (plan.action === "modify") {
      try {
        await vault.modify(plan.path, plan.content);
      } catch {
        return { kind: "rejected", error: "modify_failed" };
      }
    }
    return { kind: "applied" };
  }

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
      // Before the pull, so a withdrawal that lands mid-pass costs the user nothing further:
      // no item is claimed, none is acked, and what already landed stays landed.
      if (!host.writePermitted()) break;
      const item = await host.pullOne();
      if (!item) break;
      const kind = (item.kind || "create").toLowerCase();
      const raw = item.payload;
      if (!raw?.title?.trim()) {
        await host.ack(item.id, {
          status: "rejected",
          error: "invalid_payload",
        });
        rejected++;
        continue;
      }
      if (kind === "set_loop") {
        if (!raw.state?.trim()) {
          await host.ack(item.id, {
            status: "rejected",
            error: "invalid_payload",
          });
          rejected++;
          continue;
        }
      } else if (raw.body == null || !String(raw.body).trim()) {
        await host.ack(item.id, {
          status: "rejected",
          error: "invalid_payload",
        });
        rejected++;
        continue;
      }
      // Full payload through — do not strip open_loop / relation / close_answer.
      const payload: AskOutboxPayload = {
        title: String(raw.title).trim(),
        ...(raw.body != null ? { body: String(raw.body) } : {}),
        ...(raw.tags ? { tags: raw.tags } : {}),
        ...(raw.links ? { links: raw.links } : {}),
        ...(raw.parent_title ? { parent_title: raw.parent_title } : {}),
        ...(raw.relation ? { relation: raw.relation } : {}),
        ...(raw.open_loop === true ? { open_loop: true } : {}),
        ...(raw.close_answer ? { close_answer: raw.close_answer } : {}),
        ...(raw.state ? { state: raw.state } : {}),
        ...(raw.client_request_id
          ? { client_request_id: raw.client_request_id }
          : {}),
      };
      const applied = await host.applyToVault(payload, kind);
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
        // Exhaustive switch, not a ternary chain with a trailing else. The
        // else-arm meant "anything that is not failed or refused is joined",
        // which is exactly the reading the ack rule exists to forbid: a fifth
        // outcome would compile silently and be reported as a push that moved
        // nothing. `never` makes adding one a type error here first.
        return finish(
          ((): AskOutboxOutcome => {
            switch (mirror.kind) {
              case "failed":
                return {
                  kind: "failed",
                  landed,
                  rejected,
                  ...(mirror.message ? { message: mirror.message } : {}),
                };
              case "refused":
                return {
                  kind: "refused",
                  landed,
                  rejected,
                  ...(mirror.reason ? { reason: mirror.reason } : {}),
                };
              case "joined":
                return { kind: "joined", landed, rejected };
              default: {
                const unreachable: never = mirror;
                throw new Error(
                  `unhandled mirror outcome: ${JSON.stringify(unreachable)}`,
                );
              }
            }
          })(),
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
