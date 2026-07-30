---
title: "\"Never guessed at\" degrades to \"never arrives\" when the repair surface is machinery"
date: 2026-07-29
category: architecture-patterns
module: inbox
problem_type: design_error
component: capture-inbox
severity: high
status: solved
tags:
  - inbox
  - capture
  - drain
  - dead-end-ui
  - conservative-default
  - plugin-owned-file
  - body-is-sacred
applies_when:
  - "a conservative 'hold rather than guess' rule was written for a file the user never opens"
  - "a home/status surface reports a state the user has no action for"
  - "a previously-filtered state is being made reachable and non-null assertions guard the old filter"
related:
  - "#191"
  - "#177"
  - "#202"
  - "#203"
---

# "Never guessed at" degrades to "never arrives" when the repair surface is machinery

## Problem

`Atoms System/Inbox.md` is the iOS Shortcut's capture target. The drain files each
stamped line into the daily for the day it was captured. A line whose leading ISO
stamp did not parse was **held** — never guessed at, never filed — and surfaced on
Atoms home as `N captures need a fix`.

The user saw `4 captures need a fix` on their home screen, with no explanation and
no way to act. A capture appeared to have gone missing.

## Root cause

Two failures compounding, and only the second one looks like a bug.

**1. A conservative default that had quietly stopped being conservative.**

The rule `held, never guessed at` was correct *under an assumption that had never
been written down*: that a human could open the inbox and repair the line. That
assumption was false. The user's own framing settled it:

> "I don't ever expect the user to actually manually change this inbox file.
> This should only be what we do to it with our plugin."

Once the file is plugin-owned machinery, "never guess" does not mean "stay safe."
It means **"never arrives."** Holding looks like the careful choice and is in fact
silent data loss, because there is no one on the other end of the hold.

**2. A dead-end card.** The home surface faithfully reported a state whose only
remedy lived in a file the user must never touch. Two `<p>`s and no click handler
([`atomsHomeView.ts`](../../src/home/atomsHomeView.ts)). No amount of better copy
fixes this — a card offering an action the user cannot take is worse than silence,
because it converts an invisible problem into a visible unsolvable one.

The tempting fix — *make the card open the inbox note, scrolled to the bad line* —
is the wrong direction. It routes the user into internal plumbing to perform a
repair they should never perform.

## Solution

Make the state unreachable rather than better-explained.

- **The drain heals.** A capture with body text is never held for a bad stamp. The
  date inherits from the nearest **stamped** neighbour (preceding → following →
  today), because the inbox is append-ordered. Filing a three-day-old thought into
  today reads as a thought you had today — wrong in a way that is hard to notice later.
- **Clamp the inherited date to today**, on *every* inference path. A future date
  raises `FutureDailyNoteError` and strands the capture — the exact outcome the
  change exists to prevent. A first attempt clamped the neighbour path and not the
  marker-restored path, which was strictly worse than the original bug: the marker
  re-supplied the bad date forever, so it could never heal.
- **Do not fabricate what you do not know.** The date is inferable; the moment is
  not. `time` stays `null` and the daily bullet carries no time prefix. The missing
  time *is* the honesty tell, and untimed bullets are already a normal daily shape.
- **Record the guess durably.** `<!--atoms:inferred-date:YYYY-MM-DD-->` above the
  filed marker makes the guess auditable in the plugin-owned file, and makes the
  date a pure function of note content on re-read rather than of when the drain ran.
- **The replacement signal names the repair, not the button.** The card now points
  at the misconfigured capture shortcut with the fix stated inline. "Install or
  update Capture Atom" would only re-open the user's own pasted iCloud link and
  reinstall the same misconfiguration.

## Three things worth carrying forward

**A conservative rule inherits the assumptions of the surface it was written for.**
When a surface's ownership changes — user-editable becomes plugin-owned — every
"we'll hold and let a human decide" rule silently becomes "we'll drop it." Audit
those rules at the moment ownership changes, not when a user reports a missing capture.

**When you make a filtered-out state reachable, the non-null assertions that were
only safe because of the filter become live bugs — and they compile clean.**
`drainInbox` called `inboxDailyBulletLines(c.time!, …)` behind `!`, safe only
because `pendingInboxCaptures` filtered every unparseable capture out. Making those
captures pending without deciding the time question ships a literal `- null buy milk`
bullet with a clean typecheck. Grep for `!` on the fields the removed filter guarded
*before* removing it. The fix that makes this honest is a type predicate on the
filter (`DatedInboxCapture`), which deletes the assertions rather than re-checking them.

**Stripping junk from a sacred body is a one-way door, so narrow beats broad.**
Mechanic: when a leading token is stamp-shaped but unreadable, strip it so the junk
does not land in the atom. The first pattern was one loose regex whose comment
claimed "three date components" as the guard; it actually ate
`12/25/26 10:00 dentist appointment` down to `dentist appointment`. The asymmetry
decides it every time: **a junk stamp left in the body is ugly but visible and
recoverable; stripped user text is gone silently and forever.** The pattern is now
three deliberately narrow alternations, each matching one documented shortcut
misconfiguration, with the residual over-matches pinned by tests so a future
widening trips a test instead of quietly eating more.

## Upgrade hazard this created

Healing previously-stuck captures means **the first drain after upgrading files
everything currently stuck in the inbox** — into real dailies, where the pipeline
then classifies them into atoms. Not reversible without hand-deleting.

Any change that makes a held state flow again inherits this. Say so in the PR body
and the release note, and let the user clear the backlog first.
