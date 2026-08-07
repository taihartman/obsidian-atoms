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

/**
 * Names `ASK_PRIVACY_DISCLOSURE` as of the six-clause wording authored 2026-08-06 (#304).
 *
 * Dated from the commit that authored the *exact* string, established by hashing it at each
 * candidate commit — not by `git log -S`, which keyed on a substring that survived while other
 * clauses changed and named a wording two weeks older than the one this build ships.
 */
export const ASK_PRIVACY_ACK_VERSION = "2026-08-06";

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

/**
 * Both halves, always — the timestamp as well as the version.
 *
 * Reading the version alone looks like a strict tightening and is the opposite. It stops asking
 * the question the old gate asked, and a synced vault can answer the two questions differently:
 * the shipping build clears an ack by emptying its *timestamp*, has never heard of the version
 * field, and round-trips it back to disk untouched (`applyLoadedSettings` is an
 * `Object.assign` over the raw blob). So a withdrawal made on a not-yet-upgraded phone reaches
 * an upgraded desktop as an **orphaned version**: timestamp empty, version current.
 *
 * That state is worse than a stale grant, because the surfaces disagree about whether a record
 * exists at all. A version-only gate would open. The withdrawal row — keyed to the timestamp, as
 * it must be — would not render, so nothing on screen could take it back. And the re-enable path
 * would skip the sheet, because it correctly skips it whenever consent is already current.
 *
 * The rule this encodes: **whatever field a withdrawal path clears stays part of the gate.**
 * Adding a field to a consent record never subtracts one from the predicate. See
 * `docs/solutions/security/a-versioned-consent-needs-both-halves-in-the-gate.md`.
 */

/** Whether the Ask privacy consent on record is consent to the wording this build shows. */
export function askPrivacyAckIsCurrent(
  s: Pick<AskAckRecord, "askPrivacyAckAt" | "askPrivacyAckVersion">,
): boolean {
  return (
    Boolean(s.askPrivacyAckAt) &&
    askAckIsCurrent(s.askPrivacyAckVersion, ASK_PRIVACY_ACK_VERSION)
  );
}

/** Whether the vault-write consent on record is consent to the wording this build shows. */
export function askWriteAckIsCurrent(
  s: Pick<AskAckRecord, "askWriteAckAt" | "askWriteAckVersion">,
): boolean {
  return (
    Boolean(s.askWriteAckAt) && askAckIsCurrent(s.askWriteAckVersion, ASK_WRITE_ACK_VERSION)
  );
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

export function askAckStanding(
  acked: string | null | undefined,
  shipped: string,
): AckStanding {
  if (askAckIsCurrent(acked, shipped)) return "current";
  // Null-tolerant like its sibling, and for a sharper reason than symmetry: this runs while
  // Settings renders, so a `null` arriving from a hand-edited or restored `data.json` would
  // throw and take the whole screen down — including the rows that withdraw consent.
  return (acked ?? "").trim() ? "other" : "legacy";
}
