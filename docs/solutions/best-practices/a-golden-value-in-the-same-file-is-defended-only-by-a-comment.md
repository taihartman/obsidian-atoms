---
title: "A golden value living in the same file as its test is defended only by a comment, and one PR can edit it green"
date: 2026-08-06
category: best-practices
module: testing/golden-values
problem_type: best_practice
component: plugin
applies_when: "You add a frozen/golden constant that is supposed to be append-only — a version-to-wording map, a schema snapshot, a migration ledger — and the freeze is enforced by a test that reads the same literal it is protecting."
resolution_type: process_change
severity: medium
tags:
  - testing
  - golden-test
  - freeze-test
  - consent
  - versioned-ack
  - residual-risk
---

# A golden value in the same file is defended only by a comment

## Context

Version-stamping the egress consent (issue #315) meant a disclosure rewrite had to invalidate every
acknowledgment granted against the old text. The mechanism that enforces it is a freeze test in
`test/egressConsentParity.test.ts`: a `FROZEN_CONSENT` map from ack-version to the exact title and
disclosure shipped under it, plus a test that looks up the *current* version and asserts the live
constants still match it.

That catches the failure it was built for — edit the disclosure, forget to bump the version, the test
goes red. The testing reviewer then demonstrated the hole live: the same test also goes **green** if
you edit the existing entry's frozen string instead of adding a new one.

## Guidance

**Treat a golden value as append-only only when something mechanical makes it append-only.** A
comment saying "add a new entry, never edit an existing one" is documentation, not enforcement — and
in review the two edits produce diffs of identical shape.

The freeze test as written:

```ts
const FROZEN_CONSENT = {
  "2026-08-06": { title: "…", disclosure: "…" },
};

it("names the wording currently shipped", () => {
  const frozen = FROZEN_CONSENT[EGRESS_ACK_VERSION];
  expect(frozen).toBeDefined();
  expect(EGRESS_ACK_TITLE).toBe(frozen.title);
  expect(EGRESS_DISCLOSURE).toBe(frozen.disclosure);
});
```

Both paths to green:

| Change | Effect | Test |
|---|---|---|
| Bump `EGRESS_ACK_VERSION`, add a new entry | Old acks retire; users re-consent | green ✅ |
| Edit the `"2026-08-06"` entry's `disclosure` in place | Old acks stay "current" against wording nobody saw | green ❌ |

The second is the whole bug the stamp exists to prevent, and the freeze test waves it through.

If you need real enforcement, the mechanism has to live outside the file being edited:

- Assert every **historical** entry, not just the current one, against a digest committed elsewhere.
- Keep the golden in its own snapshot artifact, so an edit shows up in review as a snapshot change
  rather than a line inside a test.
- Add a CI check that entries for already-shipped versions are byte-identical to the previous commit.

## Why This Matters

A freeze test buys a specific, narrow guarantee, and the danger is that the team reads it as a
broader one. "The wording is frozen" is what everybody remembers; "the wording is frozen against
one class of edit, by a value the same author can rewrite" is what shipped. Once a guard is believed
to be stronger than it is, nobody adds the guard that would actually hold.

Accepted here as **residual risk**, deliberately. The realistic threat is an honest mistake by
someone rewriting copy, and against that the test does work — the version key is right there in the
diff, and the reviewer sees a consent string change. It does not defend against someone who has
decided to keep the version. That trade was worth naming rather than paying for a digest ledger on a
map with one entry.

## When to Apply

Reach for a stronger mechanism when any of these is true:

- Editing an old golden entry has **user-visible consequences** (a retired consent silently staying
  current, a migration that stops running, a schema version that stops meaning what it meant).
- The golden is expected to grow past a handful of entries, so a reviewer can no longer eyeball the
  whole map.
- The people editing the source constant and the people maintaining the golden are not the same
  people.

Leave it as a same-file comment when the map is small, the reviewer sees both sides in one diff, and
the failure mode is forgetfulness rather than intent — but write the limit down, as here, so the next
person does not inherit a guarantee that was never made.

## Examples

The general shape, independent of this repo: any test of the form

```ts
expect(LIVE_CONSTANT).toBe(GOLDEN[CURRENT_KEY]);
```

where `GOLDEN` and `LIVE_CONSTANT` are both editable in the change under review, enforces
*consistency between two things a single author controls* — not *immutability of history*. The
question to ask of any freeze test: **can one PR make this green while doing the thing the freeze
exists to prevent?** If yes, the freeze is a convention.

## See also

- `docs/solutions/logic-errors/narrowing-one-grant-removed-the-only-way-to-revoke-the-other.md` —
  the other half of the same version-stamp work; that one is a real defect, this one a named limit.
- `docs/solutions/logic-errors/a-property-test-is-only-as-strong-as-its-observers.md` — same family:
  a test whose reach is narrower than the confidence it inspires.
- Issue #315, PR #329.
