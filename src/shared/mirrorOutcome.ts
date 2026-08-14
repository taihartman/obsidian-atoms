/**
 * The mirror push result vocabulary, and the user-facing lines derived from it.
 *
 * This lives in `shared/` rather than `plugin/catchUp.ts` because `settings/`
 * needs `syncNowNotice` for the "Sync now" toast, and a settings module
 * importing a *value* out of `plugin/` inverts the module map: `plugin/` is the
 * Obsidian-facing shell, and the layers below it must not reach up into it.
 * Nothing here touches Obsidian or the plugin instance — it is pure vocabulary
 * plus two switch statements, so every layer may import it.
 */

import type { MirrorDeletionRefusal } from "./confirm";

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

/**
 * True only when the cloud confirmed receipt — the sole ack condition (R15).
 *
 * A type predicate, not a `boolean`, so a caller that guards on it actually
 * narrows. Without that, `!mirrorConfirmedReceipt(x)` left `worked` in the
 * union and any exhaustiveness check downstream had to pretend the impossible
 * arm was reachable — which is how the outbox ended up with a catch-all that
 * would have reported a future outcome as `joined`.
 */
export function mirrorConfirmedReceipt(
  outcome: MirrorSyncOutcome,
): outcome is Extract<MirrorSyncOutcome, { kind: "worked" }> {
  return outcome.kind === "worked";
}

/**
 * One-line, user-facing reason a forced sync was refused (never "success").
 *
 * No `default` arm on purpose. A catch-all here does not fall back, it *lies*:
 * `baseline-unreadable` used to be reported as "vault scan looks incomplete"
 * while the modal for the same refusal correctly said the baseline could not be
 * read. Listing every reason makes the next one a compile error instead.
 */
export function describeMirrorRefusal(reason?: MirrorDeletionRefusal): string {
  switch (reason) {
    case "no-server-count":
      return "Ask mirror: sync refused, this device has never seen the cloud count; nothing was deleted";
    case "server-count-tripwire":
      return "Ask mirror: sync refused, this vault holds far fewer atoms than the cloud; nothing was deleted";
    case "baseline-unreadable":
      return "Ask mirror: sync refused, this device's sync baseline is unreadable; nothing was deleted";
    case "scan-incomplete":
    case undefined:
      return "Ask mirror: sync refused, vault scan looks incomplete; nothing was deleted";
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
      // Not "joined it". A joining caller's request is absorbed into the
      // running pass, and if that pass exits on `failed` or `refused` the
      // absorbed work — including a forced reconcile and the confirmation
      // dialog only the forced path can reach — never runs. Dropping it is the
      // fail-closed direction and deletes nothing; claiming it happened is the
      // part that misleads. Say what is true and name the recovery.
      return "Ask mirror: a sync was already running. Press Sync now again when it finishes";
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
