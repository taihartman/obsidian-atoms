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
 * Names `ASK_PRIVACY_DISCLOSURE` as of the seven-clause wording authored 2026-08-07 (#339/#340).
 *
 * That wording adds clause (4) — Atoms Plus may send title, tags, and body slices to Anthropic to
 * build search-expansion phrases — mid-list, shifting the old (4)(5)(6) down, and adds
 * `search expansions` to what Wipe removes. The previous six-clause wording (2026-08-06, #304)
 * stays frozen in `askConsentVersion.test.ts` as the record of what shipped devices agreed to.
 *
 * Dated from the commit that authored the *exact* string, established by hashing it at each
 * candidate commit — not by `git log -S`, which keyed on a substring that survived while other
 * clauses changed and named a wording two weeks older than the one this build ships.
 */
export const ASK_PRIVACY_ACK_VERSION = "2026-08-07";

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
  // Typed `string`, but the value arrives from `data.json`, which a hand edit, a restored
  // backup, or a third-party sync client can make any shape at all. A `0` or a `{}` reaching
  // `.trim()` would throw *inside a consent predicate* — and these run while Settings paints, so
  // the throw takes the withdrawal rows down with it and leaves no surface to shut the gate.
  if (typeof acked !== "string") return false;
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

/**
 * A stamp that is actually a moment.
 *
 * `Boolean(at)` was too weak in both directions a hand-edited `data.json` can be wrong: `true`
 * is not a string, and `"yes"` is a string that is not a time. Either one read as live consent,
 * and `"yes"` then reached `record.at.slice(0, 10)` in the row that would have withdrawn it. A
 * consent record's *when* has to be a when.
 */
export function ackStampIsReal(at: unknown): at is string {
  return typeof at === "string" && at.trim() !== "" && !Number.isNaN(Date.parse(at));
}

/** Whether the Ask privacy consent on record is consent to the wording this build shows. */
export function askPrivacyAckIsCurrent(
  s: Pick<AskAckRecord, "askPrivacyAckAt" | "askPrivacyAckVersion">,
): boolean {
  return (
    ackStampIsReal(s.askPrivacyAckAt) &&
    askAckIsCurrent(s.askPrivacyAckVersion, ASK_PRIVACY_ACK_VERSION)
  );
}

/**
 * Whether the mirror may push. The one home for the egress predicate: a second copy is how a
 * future condition gets added to one gate and missed at the other.
 *
 * Here rather than on `AskCoordinator` because Settings has to ask it too, to say whether the
 * mirror is running (#374), and a settings screen reaching into the coordinator to find out
 * would be a second way for the sentence and the gate to disagree. Both callers pass the live
 * `plugin.settings` at call time, so a withdrawal that arrives by Sync still lands mid-pass
 * (#323).
 */
export function askMirrorPermitted(
  s: Pick<AskAckRecord, "askPrivacyAckAt" | "askPrivacyAckVersion"> & {
    askEnabled: boolean;
  },
): boolean {
  return s.askEnabled && askPrivacyAckIsCurrent(s);
}

/** Whether the vault-write consent on record is consent to the wording this build shows. */
export function askWriteAckIsCurrent(
  s: Pick<AskAckRecord, "askWriteAckAt" | "askWriteAckVersion">,
): boolean {
  return (
    ackStampIsReal(s.askWriteAckAt) &&
    askAckIsCurrent(s.askWriteAckVersion, ASK_WRITE_ACK_VERSION)
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
  // Shape-tolerant for the same reason its sibling is: this runs while Settings renders, so a
  // value `data.json` should not have held must degrade to a word, never to a throw.
  return typeof acked === "string" && acked.trim() ? "other" : "legacy";
}

/**
 * Normalise the two ack records as they land from disk, before anything reads them.
 *
 * Two jobs, both of which have to happen *at the boundary* rather than inside the predicates.
 *
 * **Coerce the shapes.** `data.json` is typed but not trusted — a hand edit or a restored backup
 * can put `true` in a timestamp, and `Boolean(true)` reads as a live grant while
 * `record.at.slice(0, 10)` throws in the row that would have withdrawn it. Guarding inside
 * `askAckIsCurrent` alone does not help the renderer; coercing here fixes both at once.
 *
 * **Keep the narrower consent from outliving the broader one.** The write ack authorises the
 * cloud to create files here, and it is only ever granted on top of the privacy ack. Settings
 * enforces that when the user withdraws privacy *locally* — but a privacy ack can also stop
 * being current by going stale, which is what happens to every device the next time
 * `ASK_PRIVACY_ACK_VERSION` moves. Without this, that device keeps a current write ack, and the
 * moment the user re-accepts the new privacy wording the write gate reopens with no write sheet
 * ever re-posed — filing from Claude resumes under a consent granted against superseded terms.
 * Clearing here is safe in the only direction that matters: it can revoke, never grant.
 */
export function settleAckRecords(s: AskAckRecord): void {
  const stamp = (v: unknown): string => (ackStampIsReal(v) ? v : "");
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  s.askPrivacyAckAt = stamp(s.askPrivacyAckAt);
  s.askPrivacyAckVersion = str(s.askPrivacyAckVersion);
  s.askWriteAckAt = stamp(s.askWriteAckAt);
  s.askWriteAckVersion = str(s.askWriteAckVersion);
  if (askPrivacyAckIsCurrent(s)) return;
  s.askWriteAckAt = "";
  s.askWriteAckVersion = "";
}
