---
title: "A green check about a different subtree is not coverage of your change"
date: 2026-08-06
category: architecture-patterns
module: ci
problem_type: architecture_pattern
component: github-actions
severity: high
applies_when:
  - "Reading a green CI check as evidence that a diff was verified"
  - "Adding a workflow scoped to a subdirectory in a repo with more than one deliverable"
  - "Deciding whether a `paths:` filter is a safe optimization"
  - "A test failure first appears at release time on a clean checkout"
tags:
  - ci
  - github-actions
  - fake-green
  - coverage-claims
  - release-process
---

# A green check about a different subtree is not coverage of your change

## Context

This repo ships two things from one tree: the Obsidian plugin at the root, and `plus-service/`.
CI matched only one of them.

- `.github/workflows/plus-service-tests.yml` — `on: pull_request`, `working-directory: plus-service`
- `.github/workflows/release.yml` — root `npm test` and `npm run build`, `on: push: tags:` **only**

So every plugin-side PR displayed a green check named `test` that had executed a suite with **no
relation to the diff**. The plugin's own ~1200 tests — including a `DIRECT_SETTING_BUDGET` ratchet, a
sealed-account-state guard, and a mutation-verified setup-guide lockstep — first ran at **tag time**.

[#304](https://github.com/taihartman/obsidian-atoms/pull/305) merged on that green check having run
**zero** of its own 1228 tests. The work was genuinely verified — locally, at every step — but the
agent reported "CI green" as though it meant the diff had been checked, and a human caught the claim
rather than the machinery.

## Guidance

**A check is evidence about the thing it ran, not about the PR it is attached to.** Before treating
green as coverage, answer two questions:

1. **Which workflow produced this check, and what does it actually execute?** A check name like
   `test` says nothing about scope. `working-directory:` and `paths:` are where scope lives.
2. **Does its scope intersect my diff?** If the diff touches no file the workflow would run against,
   the check is truthful and irrelevant simultaneously. That combination is what makes it dangerous —
   there is nothing red to notice.

**Do not add a `paths:` filter to "make it fast."** This is the specific trap, because the filter
*is* the bug in miniature. Here, a plausible `src/**` filter would have rebuilt the same hole one
level down: `pretest` runs `build:www`, so the root suite legitimately spans the plugin **and**
`www/`, and a `src/**`-filtered run would have gone green on a broken `www` build. A scoping
assumption created the gap; a narrower scoping assumption relocates it.

**Gate the build separately from the tests.** Root build here is
`tsc -noEmit -skipLibCheck && esbuild production`. A typecheck-only failure passes `npm test` and has
exactly the same tag-time-only hole, so `npm run build` earns its own step rather than riding along.

**`npm ci` from a clean checkout is a different claim than a warm working tree.** When you finally
add the gate, expect the first run to be informative rather than green — that is the accumulated gap
being measured, not a fresh regression.

## Why This Matters

The cost is not a missed bug in the abstract; it is *where* the bug surfaces.

[#317](https://github.com/taihartman/obsidian-atoms/pull/317) is the concrete precedent. Three tests
in `test/personInvite.test.ts` pinned fixtures dated `2026-07-20` / `2026-07-22` and called
`collectPersonInvites` without injecting `now`, so they were measured against the wall clock. With
`PERSON_INVITE_RECENT_DAYS = 14` they aged out at UTC midnight on 2026-08-06 and went **permanently**
red — a one-way expiry, not a flake.

They surfaced during the **0.6.78-beta.1 release**. A `pull_request` gate would have caught them on
the PR that introduced them, weeks of wall-clock earlier, at zero release cost. Instead the failure
appeared in the one workflow whose failure blocks shipping.

One of those three had also been passing **vacuously** for its whole life: its fixture was filtered
out by the recency cutoff before the snooze check it was named for ever ran. Nothing would have
caught that either, because nothing ran it outside a release.

## When to Apply

- **Before citing CI as verification.** Name the workflow and its scope, or say "verified locally" and
  mean it. "CI is green" and "my change was tested" are different sentences.
- **Whenever a repo grows a second deliverable.** The moment a subdirectory gets its own scoped
  workflow, the root stops being covered by default and nothing announces it.
- **When a failure first appears at release time.** That is the signature. Ask what would have had to
  run earlier, and why it didn't.
- **When tempted by `paths:`.** Ask what the suite transitively touches — `pretest`, `prebuild`, and
  generated artifacts routinely reach outside the directory you are filtering on.

## Examples

The distinguishing feature of this variant, against its two neighbours already in this directory:

| Doc | Shape |
|---|---|
| [a-signal-nobody-receives-is-not-a-signal](a-signal-nobody-receives-is-not-a-signal.md) | The signal fires; no one is listening |
| [a-test-harness-that-cannot-fail-reports-coverage-that-never-ran](a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md) | The mechanism is incapable of going red |
| **this doc** | The mechanism **can** fail and **does** report honestly — it is simply wired to a subtree the diff never touched |

That third shape is the hardest to notice, because every local property of the check is correct.
There is no broken assertion to find and no silent skip in the log. The defect is entirely in the
*relationship* between the check and the change, which lives nowhere in either.

**Adding the workflow is the easy half.** A workflow that runs but is not in the branch's
**required-check** set is advisory: it goes red, the merge proceeds anyway, and within a few PRs
people stop reading it. That is not a smaller version of this bug — it is the *neighbouring* one
([a-signal-nobody-receives-is-not-a-signal](a-signal-nobody-receives-is-not-a-signal.md)), and
shipping the workflow without the flip trades one failure for the other while feeling finished.

The flip needs repo admin (Settings → Branches → require status checks). If you cannot do it
yourself, the gap is not closed when your PR merges — it is closed when someone with admin adds the
check. Say that out loud rather than letting a merged workflow imply otherwise.

The fix (#325) is unremarkable — the value was in noticing:

```yaml
name: root tests
on:
  pull_request:          # deliberately no `paths:`
  push:
    branches: [master]
# ...
      - run: npm ci      # clean checkout, the install a release performs
      - run: npm test    # `pretest` drives build:www, so this spans www/ too
      - run: npm run build   # separate: a typecheck-only failure has the same hole
```
