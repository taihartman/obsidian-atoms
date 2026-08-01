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

## Lesson

When a heuristic extracts a value *and* validates it with a signal derived from
the same text span, check that removing the candidate would still leave the
signal standing. If not, the rule is self-confirming. Guard shared heuristics at
their one deny choke point rather than at each call site — three surfaces here
consumed the same bad name.
