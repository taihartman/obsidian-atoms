---
title: "A capture guard only catches what it was told to look for, and every failed run reported success"
date: 2026-08-14
category: workflow-issues
module: qa
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Building or extending an automated screenshot sweep for PR evidence"
  - "Reviewing captured frames someone else's harness reported as successful"
  - "A capture run says OK and the evidence still looks wrong"
tags:
  - qa-evidence
  - screenshots
  - obsidian-cli
  - automation
  - guards
---

# A capture guard only catches what it was told to look for

## Context

Sixteen device frames were captured for a settings overhaul through a scripted sweep. Three
separate times a reviewer opened the images and found a whole class of bad evidence that the guards
in place at that moment had passed. Each time a new guard was added. Every one of those runs had
printed `OK` for every frame.

This is the companion to
[screenshot-capture-races-and-viewer-lies](../documentation-gaps/screenshot-capture-races-and-viewer-lies.md),
which documents three ways a *frame* lies. This one is about the ways a *guard* lies — the harness
is confident, the run is green, and the evidence is still of the wrong thing.

## Guidance

`dev:screenshot` never errors. It writes a PNG of whatever is on screen, so an unguarded sweep
cannot fail — it can only file the wrong picture under the right name. Each guard below exists
because that happened.

**1. Two consecutive shots must agree.** The first shot after any scroll or navigation is routinely
the frame from *before* the re-render. (This is failure #1 in the companion doc, met again in a new
harness — it recurs per harness, not per project.)

**2. They must differ from the last frame this run wrote.** A stale pair is perfectly stable, so
agreement alone proves nothing. Without this, a mis-navigated sweep files one screen's frame under
four different names, each internally consistent and each passing check 1.

**3. The modal count must match what the shot expects.** A sheet left open from an earlier step
greys the entire page. Worse, a JS-driven click keeps changing routes *underneath* the scrim, so the
run keeps "working" with a modal in every frame. This cost 14 of 16 frames on one pass.

**4. The caller must assert the route.** Stability says nothing about *which* screen settled.
Checking that the expected first row rendered is a different question from checking that the screen
stopped moving, and only the caller knows the answer.

Guards 1-4 are implemented in `scripts/qa/settings-shot.sh`; guard 4 is the caller's job, in
`scripts/qa/settings-nav.sh`.

## Why This Matters

The failure mode is not "the harness broke." It is "the harness succeeded at the wrong task," and
that is invisible from inside it. A guard is a hypothesis about how the evidence can be wrong, so
the set of guards can only ever cover the failures somebody already thought of. **Every one of these
was added after a human looked at the pictures and found what the current guards had passed.**

Two consequences worth internalizing:

- **Green is not evidence.** A capture run reporting sixteen successes is a claim that sixteen files
  were written, not that they show the sixteen screens you meant.
- **A guard's own failure branch needs to be reachable.** This harness had a `STALE` branch that
  could never run: the loop cleared the hash it was about to be tested against, so a settled-but-stale
  pair — the exact case that guard existed for — was reported as "two shots never agreed." A guard
  that misreports the failure it was written for is nearly as bad as not having it, because it sends
  the next person to debug the wrong thing. See
  [a-guard-with-no-reachable-input-is-worse-than-no-guard](../best-practices/a-guard-with-no-reachable-input-is-worse-than-no-guard.md).

## When to Apply

Any time an automated pass produces artifacts that a human is expected to trust without re-deriving
them — screenshots, recordings, generated fixtures, exported reports. The tell is that the tool
cannot fail: if there is no input that makes it exit non-zero, its success output carries no
information.

## Examples

**A JS `.click()` navigates underneath an open sheet's scrim; a real tap cannot.** With a modal
open, `document.elementFromPoint()` over a row returns `modal-bg` — a finger would hit the scrim and
dismiss or do nothing. The synthetic click goes straight to the row. This is a *harness* hazard, not
a product bug, and it is why a click-driven sweep can wander through an app that a user could not
have navigated the same way.

**A back tap is not reliably one tap.** Off the Account screen the first click on the back row is
routinely swallowed. Loop until the screen you want renders, rather than counting taps —
`scripts/qa/settings-nav.sh --home` does this.

**Checklist for a new capture harness.** Before trusting a sweep: two shots agree; they differ from
the previous frame; the expected route's first row is present; the modal count matches; and every
guard's failure branch has been triggered at least once on purpose.
