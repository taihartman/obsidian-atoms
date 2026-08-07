---
title: "A versioned consent needs both halves in the gate, because a mixed-version fleet can orphan one"
date: 2026-08-07
category: security
module: consent/ask-mirror
problem_type: security_issue
component: consent-gate
symptoms:
  - "An ack the user withdrew on their phone still read as live consent on the upgraded desktop"
  - "Turning Ask back on enabled the mirror without ever posing the disclosure sheet"
  - "The Settings row that could have withdrawn the stale record did not render at all"
  - "The outbox kept writing cloud-queued files into the vault on its 60-second timer, with no user gesture"
  - "Every test was green, because no fixture could produce the state"
root_cause: security_issue
resolution_type: code_fix
severity: high
---

# A versioned consent needs both halves in the gate

## The pattern this is about

Version-stamping a consent record is the right fix for "the disclosure was reworded and nobody
re-consented" (#315, #360). The record grows from one field to two:

```
askPrivacyAckAt: string       // when they agreed
askPrivacyAckVersion: string  // what they agreed to
```

The obvious next move — and the wrong one — is to point the gate at the new field:

```ts
// wrong
export function askPrivacyAckIsCurrent(s: Pick<AskAckRecord, "askPrivacyAckVersion">) {
  return askAckIsCurrent(s.askPrivacyAckVersion, ASK_PRIVACY_ACK_VERSION);
}
```

It reads as a strict tightening. It is not. It silently *widened* what counts as consent, because
it stopped asking the question the old gate asked.

## Why the fleet produces the state your tests cannot

On one device the two fields are always written together, so `at: "" , version: current` looks
impossible — and a fixture author will write a comment saying so. `data.json` syncs, and the fleet
is not one device. Two properties combine:

1. **An old build round-trips a field it has never heard of.** `applyLoadedSettings` is
   `Object.assign({}, DEFAULT_SETTINGS, raw)` and `saveSettings` is `saveData(this.settings)`. A
   pre-upgrade device therefore loads the new `askPrivacyAckVersion`, carries it in memory, and
   writes it straight back — while its own withdrawal path, which predates the field, clears only
   the timestamp.
2. **A revoke keyed on key-presence skips what the payload omits.** `adoptExternalWithdrawal`'s
   `revoke()` acts only when a key is *present and falsy* in the incoming read. A withdrawal
   written by a device whose schema has no version key at all is not "version unchanged" — it is
   "version invisible", and the guard does nothing.

Either one alone is enough. Together they are the ordinary shape of a staggered BRAT rollout: the
desktop updates, the phone does not, both keep syncing the same vault.

The result is an *orphaned version*: timestamp empty, version current. It is worse than a stale
grant, because the surfaces disagree about whether a record exists. The gate reads the version and
says yes. The withdrawal row reads the timestamp and does not render — so there is nothing on
screen to take it back. And the re-enable path, which correctly skips the sheet when consent is
already current, now skips it for consent that was explicitly withdrawn.

## The rule

**Whatever field the withdrawal path clears must remain part of the gate.** Adding a field to a
consent record never subtracts one from the predicate:

```ts
export function askPrivacyAckIsCurrent(
  s: Pick<AskAckRecord, "askPrivacyAckAt" | "askPrivacyAckVersion">,
) {
  return Boolean(s.askPrivacyAckAt) && askAckIsCurrent(s.askPrivacyAckVersion, ASK_PRIVACY_ACK_VERSION);
}
```

Two consequences worth stating separately, because each was independently arrived at by a
different reviewer on the same diff:

- **The gate must be a strict subset of what some UI can revoke.** If a state can open the gate but
  renders no withdrawal surface, that is the bug — the same one
  [`narrowing-one-grant-removed-the-only-way-to-revoke-the-other`](../logic-errors/narrowing-one-grant-removed-the-only-way-to-revoke-the-other.md)
  records, reached from the opposite direction. There the row was keyed too tightly; here the gate
  was keyed too loosely. The invariant that catches both: *enabling may demand the freshest grant;
  revoking must accept the loosest grant that still permits anything.*
- **Pair the fields at the revoke, not just at the write.** A `revokePaired(atKey, versionKey)`
  that force-clears the version whenever its timestamp clears — regardless of whether the version
  key appears in the payload — stops the skew from ever landing in memory. Keep it *as well as* the
  both-halves predicate: one prevents the state, the other refuses to spend it.

## How to know you have this bug

The tell is a comment. When a fixture helper says some paired state is "a state the app cannot
produce", ask *which build* of the app. In a synced-settings product that sentence is only ever
true of the build you are looking at.

Concretely, test the inverse skew for every paired consent field:

- timestamp empty + version current → gate shut, and re-enable re-poses the sheet
- a synced payload that clears the timestamp and **omits** the version key entirely → gate shut

Neither is exotic. Both were missing here, and their absence is why four independent reviewers had
to find the hole by reading rather than by running the suite.

## Related

- [`consent-gate-must-be-checked-at-egress-not-at-entry`](consent-gate-must-be-checked-at-egress-not-at-entry.md)
  — where to ask; this doc is what to ask.
- [`narrowing-one-grant-removed-the-only-way-to-revoke-the-other`](../logic-errors/narrowing-one-grant-removed-the-only-way-to-revoke-the-other.md)
  — the mirror image, on the revoke surface.
- [`read-modify-write-lost-update-synced-file`](../logic-errors/read-modify-write-lost-update-synced-file.md)
  — the other family of bugs that exists only because `data.json` syncs.
