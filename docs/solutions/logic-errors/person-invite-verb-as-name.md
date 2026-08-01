---
title: "Person invite treated the leading verb as the person (\"Add Likes?\")"
date: 2026-08-01
category: logic-errors
module: person-invite
problem_type: logic_error
component: personInvite
severity: medium
status: solved
tags:
  - person-hub
  - invite
  - atoms-home
  - heuristics
  - subject-elision
applies_when:
  - "an Add {word}? card names a verb, determiner, or weekday instead of a person"
  - "atoms get same person — related claim peer links that share no person"
  - "a name heuristic is gated by a signal the candidate token itself produces"
---

# Person invite treated the leading verb as the person ("Add Likes?")

## Problem

Atoms home offered **"Add Likes?" — "You filed a note about Likes, but there's no
person note yet"** for the atom `Likes Annie's fruit tape snack`. Accepting would
have created a `Likes.md` person hub and collected backlinks under it.

## Symptoms

- People invite card naming a verb (`Likes`, `Loves`, `Prefers`) or a determiner
  (`The new spot Nichita likes` → `Add The?`).
- Unrelated atoms cross-linked with `same person — related claim` because
  `write.ts` groups peers by the same resolved label.

## Root cause

`resolvePersonInviteName` takes the **first capitalised token of the atom title**
as the candidate name and gates it on `isPersonShapedCapture`:

```ts
const titleName = t.match(/^([A-Z][a-z]{1,24})(?:\s|'s\b|’s\b)/);
if (titleName?.[1] && isPersonShapedCapture(text, fakeResult(t, tags))) { … }
```

Two things collide:

1. **Captures elide the subject.** People type "likes Annie's fruit tape snack"
   while thinking of a person they never name, so the leading token of the
   generated title is a verb, not a name.
2. **The gate is circular.** `isPersonShapedCapture` is satisfied by
   `PREFERENCE_OR_RELATION_RE` — which matches the *same* word that was captured
   as the name. `Likes` qualified itself as a person.

A signal that the candidate token itself produces can never validate that token.

## Fix

A shared non-name word set (`PERSON_INVITE_NON_NAME_WORDS` +
`isNonNameWord`) consulted from `isDeniedPersonName` — the single choke point
every branch of `resolvePersonInviteName` already routes through, so the card,
`write.ts` peer links, and `atomsHomeView.upgradePathSet` are all covered by one
edit. It denies determiners, pronouns, the preference verbs mirrored from
`PREFERENCE_OR_RELATION_RE`, other common subject-less leading verbs, and
weekday/time words.

## Deliberate non-goals

- **No fallback to a later capitalised token.** `Annie` in the reported title is
  a possessive owner, not the subject of the claim, and `Loves Trader Joe's`
  would invite `Trader`. Under-invite beats a fake person hub — the whole point
  of the invite is that hub creation stays the user's call.
- **`Will` and `May` stay allowed** despite being modals: they are common first
  names, and a modal in that position is followed by a bare verb that the
  `Name is/was/likes/…` branches do not match.

## The durable fix (0.6.61)

The word list was containment. Measured against the shipped `0.6.60`, unlisted verbs still resolved:
`Skipped`, `Swapped`, `Ordered`, `Craving`. English outnumbers any hand-typed array.

`classify` now emits `people[{name, role}]` (`subject` | `mentioned` | `recommender`), guarded by
`normalizePeople` — a name must appear **verbatim** in the capture, and `isDeniedPersonName` still
runs as a backstop. `render` persists it to `atoms-people` frontmatter, and all three consumers read
that field through one helper, `resolveAtomPersonName`. Atoms without the field keep `0.6.60`
behaviour until `atoms:update-notes` refreshes them (`CURRENT_ATOMS_QUALITY` 7 → 8).

The role enum is the part that matters. `Annie` in the reported capture is `mentioned` — a possessive
owner — and `mentioned` never invites. That distinction is not expressible as a regex, which is why
the previous recommender branch had already degenerated into a dead `/* fall through */` arm.

## Two traps this implementation hit

**A guarded parser is not a guarded pipeline.** `normalizePeople` was first wired only into the live
classify parser. But `backfill.ts:600` parses **Batch API** output on its own path and reaches
frontmatter through `applyClassificationQuality` — as does smart refresh. Model output had three
doors and the guard was on one. Fix: guard inside the shared quality pass, which every path
traverses. Before adding a boundary check, enumerate the *parse sites*, not the callers.

**Absent ≠ empty.** `atoms-people: []` (the model found nobody) and a missing key (an atom written
before the field existed) must stay distinguishable, so `parseAtomsPeople` returns `[]` vs `null`.
Collapsing them would silently route every legacy atom back to the buggy guesser — the fix would
have looked complete and changed nothing for the existing library.

## Lesson

When a heuristic extracts a value *and* validates it with a signal derived from
the same text span, check that removing the candidate would still leave the
signal standing. If not, the rule is self-confirming. Guard shared heuristics at
their one deny choke point rather than at each call site — three surfaces here
consumed the same bad name.
