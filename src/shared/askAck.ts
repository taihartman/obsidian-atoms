import type { LinkerSettings } from "./types";

/**
 * Which disclosure a stored Ask ack was granted against (#360).
 *
 * `askPrivacyAckAt` and `askWriteAckAt` are bare timestamps: they record *when* someone agreed
 * and never *what* they agreed to. Every read of them used to be `Boolean(timestamp)`, so
 * rewording a disclosure left every existing device holding a non-empty timestamp, still
 * reading as granted, never re-prompted — consenting to text it had not seen. That is #315
 * again, one ack over.
 *
 * The fix is the one `EGRESS_ACK_VERSION` (src/platform/autorun.ts) already uses: the record
 * names its wording, and anything else is not consent. A pre-#360 grant carries an empty
 * version, which fails the same predicate a mismatched one does — which is why there is no
 * migration here and why the timestamps never change meaning.
 *
 * Losing Ask silently at the upgrade boundary is expected release behavior. Nothing raises a
 * sheet on its own; the re-prompt is the next time the user turns the mirror on, and the
 * withdrawal rows stay keyed to the *timestamp* so a stale grant is still revocable.
 *
 * **Bump the matching constant whenever the disclosure it names changes what it discloses.**
 * `askConsentVersion.test.ts` freezes each version against its exact wording, so forgetting the
 * bump fails there rather than silently shipping new text under an old stamp.
 */

/** Names `ASK_PRIVACY_DISCLOSURE` as of the six-clause wording authored 2026-07-27. */
export const ASK_PRIVACY_ACK_VERSION = "2026-07-27";

/** Names `ASK_WRITE_DISCLOSURE` as of the wording authored 2026-08-06 (#304). */
export const ASK_WRITE_ACK_VERSION = "2026-08-06";

/**
 * Acked against the disclosure this build actually shows. Anything else is not consent.
 *
 * Mirrors `egressAckIsCurrent`. Empty is the legacy grant — it names no wording at all — and a
 * mismatch is either an older stamp or a downgrade; neither is agreement to what is on screen
 * now, so both read the same way.
 *
 * One deliberate divergence from the two predicates it mirrors: a stored value is trimmed
 * before it is judged, so a whitespace-only stamp reads as the legacy grant rather than as a
 * version literally named " ". Whoever collapses these three into one helper (#341) should keep
 * the trim rather than assume the difference was an accident.
 */
export function askAckIsCurrent(
  acked: string | null | undefined,
  shipped: string,
): boolean {
  if (acked == null) return false;
  const stored = acked.trim();
  if (!stored) return false;
  return stored === shipped;
}

/**
 * The two acks, as the only shape a caller needs to ask about them.
 *
 * Deliberately not `LinkerSettings`: every gate in the plugin reads live off
 * `plugin.settings`, and narrowing the parameter keeps a test from having to build a whole
 * settings object to assert a predicate.
 */
export type AskAckRecord = Pick<
  LinkerSettings,
  "askPrivacyAckAt" | "askPrivacyAckVersion" | "askWriteAckAt" | "askWriteAckVersion"
>;

/** Whether the Ask privacy consent on record is consent to the wording this build shows. */
export function askPrivacyAckIsCurrent(s: Pick<AskAckRecord, "askPrivacyAckVersion">): boolean {
  return askAckIsCurrent(s.askPrivacyAckVersion, ASK_PRIVACY_ACK_VERSION);
}

/** Whether the vault-write consent on record is consent to the wording this build shows. */
export function askWriteAckIsCurrent(s: Pick<AskAckRecord, "askWriteAckVersion">): boolean {
  return askAckIsCurrent(s.askWriteAckVersion, ASK_WRITE_ACK_VERSION);
}

/**
 * How a stored ack stands against the shipped one, for the sentence the review row shows.
 *
 * `"current"` is agreement to what this build says. `"legacy"` is a pre-#360 grant, which named
 * no wording at all — "earlier" is honest there. `"other"` is a stamp that exists but is not
 * ours: on a downgrade the wording it names is *later* than this build's, so calling it earlier
 * would be its own small lie.
 */
export type AckStanding = "current" | "legacy" | "other";

export function askAckStanding(acked: string, shipped: string): AckStanding {
  if (askAckIsCurrent(acked, shipped)) return "current";
  return acked.trim() ? "other" : "legacy";
}
