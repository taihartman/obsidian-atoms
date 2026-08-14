---
handoff_date: 2026-08-14
branch: claude/settings-ux-redesign-69acd6
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/494
status: in-progress
supersedes: docs/handoffs/2026-08-14-settings-overhaul-shipping-tail-part-2.md
---

# Handoff — Settings three-leg overhaul: two shipping-tail steps left

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did.

Three of the five shipping-tail steps are **done and pushed**. Two remain: finish the QA report, and
get PR #494 out of draft. Nothing is blocked.

## Goal

Restructure the Atoms settings tab around the product's three legs (Capture, File, Resurface), so
the main screen answers "is Atoms filing, and what will it do with my notes" without scrolling. All
eleven plan units landed in earlier sessions. Your job is the last two shipping-tail steps.

## Current status

Working tree **clean**, branch **0 ahead / 0 behind `origin`**, nineteen commits.

**Gates green at HEAD:** `npm test` **1880 tests / 99 files**, `npm run lint`, `npm run build`,
`npm run typecheck:test`. Version **0.8.0** across `package.json` / `manifest.json` /
`versions.json`, pinned by a test.

This session added three commits, all pushed:

| Commit | What |
|---|---|
| `3e002b6` | `ce-simplify-code` — resolve filing auth once a render, name two duplicated formulas |
| `9d1d7dc` | `ce-code-review` fixes — two screens stating things that are not true, plus four smaller |
| `f562685` | `ce-compound` — five learnings into `docs/solutions/`, two into `CONCEPTS.md` |

**Steps 1-3 of the previous handoff are complete.** Do not redo them:

- **`ce-simplify-code`** ran. Six findings applied. The `setupIncomplete` seam the old handoff asked
  about was examined and **deliberately left alone** — deriving it once in the caller and handing it
  to both renderers *is* the shared derivation; making each recompute it would duplicate the formula.
- **`ce-code-review`** ran with six local reviewers plus an independent cross-model adversarial pass
  on **Grok** (`grok-cli`, `independence_verified: true`). **No P0 or P1 from anyone.** Seven P2/P3
  findings; six applied with regression tests, one left as a documented decision. Verdict: ready.
- **`ce-compound`** ran. Five docs under `docs/solutions/`, `CONCEPTS.md` gained `Setting group` and
  `Setup step`.

## Next steps

1. **Finish `world-class-qa`.** The report at
   `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md` already has its device
   evidence, measurements, frames, route walk and findings halves. Two halves are **missing**:
   **story coverage** (the pass scoped as user stories) and the **adversarial** half. **Append to
   that file — do not start a new report.** `adversarial-qa` is that skill's hard gate, so the pass
   is not finished without it.
   Note the two behavior changes this session made, both of which the adversarial half should try to
   break: the "Your data" footer now varies with whether the Privacy row rendered, and the
   File-group filing toggle's subtitle now varies with whether a run is on the books.
2. **PR #494.** Still **draft**, and both its title and body are stale — the title is
   `docs(plan): settings three-leg overhaul` and the body still says *"Draft — plan and design spec
   only, no implementation yet"*, which stopped being true nineteen commits ago. Rewrite both:
   - `Closes #493` (the body currently says "Claims #493", which does **not** auto-close)
   - distilled **Core user stories** and **Edge cases & testing**
   - an **Evidence** table linking the sixteen screenshots with **absolute**
     `https://raw.githubusercontent.com/taihartman/obsidian-atoms/claude/settings-ux-redesign-69acd6/docs/qa/screenshots/settings-ux-redesign/...`
     URLs — repo-relative paths render as broken images in a PR body
   - Test plan boxes ticked **only** for what actually ran
   - then mark ready for review.

## Key files

- `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md` — the report you extend.
  Its `## Findings` section already has `### Fixed`, `### Fixed on request`, and
  `### Recorded, not fixed`.
- `docs/qa/screenshots/settings-ux-redesign/` — sixteen frames at 390x844 (`is-phone`) and 768x1024
  (`is-tablet`), all verified by a reviewer who opened them.
- `src/settings/settings.ts` — the whole tab. `renderMainScreen` is the map of what renders in what
  order.
- `scripts/qa/settings-{shot,nav,sweep}.sh` — the capture harness. Read `settings-shot.sh`'s header
  before capturing anything.
- `docs/design-handoff/settings/overhaul.html` + `account.html` — mock SSOT.
- `docs/solutions/workflow-issues/a-capture-guard-only-catches-what-it-was-told-to-look-for.md` —
  written this session; read it before you trust any capture run.

## Decisions & constraints — do not relitigate

Everything in the superseded handoff's decisions list still stands (group fill is
`--background-primary`, rows inside a group are transparent/square/margin-free, the name column
grows harder than the field, `consent.ts` keeps its em dashes, the nine account renders are pinned
by name and order, `Paste a session` is single-sourced through `PASTE_SESSION_ROUTE`). Plus, from
this session:

- **`renderAccountFacts` / `renderAccountActions` keep taking `setupIncomplete` as a parameter.**
  Examined and kept. This was the old handoff's open question; it is now closed.
- **`settings.ts` is not being split.** KTD3. The review raised it and the reviewer itself declined
  to relitigate; only the ratchet half was mechanical and that was applied.
- **The day-one filing promise retires on `lastRunDay`, not on the toggle going on.** A first
  attempt at that fix used "filing is on" and broke an existing U7 test that deliberately pins
  "Filing starts with tomorrow's note" after an enable. That test was right — nothing has landed
  yet, so the promise is still true. Do not re-widen the condition.
- **`AccountState` has no `trialing` member.** Its members are `active`, `exhausted`,
  `trialIncomplete`, `subscribeIncomplete`, `periodEnded`, plus `signedOut` (excluded where the
  facts renderer takes it). `tsc` caught an invented `trialing` case; the switches are now exhaustive
  with no catch-all, so adding a state is a compile error until every consumer handles it.

## Open questions / blockers

- **None blocking.**
- The version is **0.8.0** and unreleased, so these fixes did not bump it. If the user wants a beta
  before merge, that is a `0.8.0-beta.N` bump per
  `docs/runbooks/plugin-release-beta-stable.md` — **do not cut a release unless asked.**
- A separate session is running the plugin-wide em-dash sweep outside `src/settings/`. If you hit a
  conflict there, theirs is the newer intent for those files; this branch owns only the
  `src/settings/` half.
- One follow-up was filed as a separate task and is **out of scope here**: `plusBaseUrl` accepts any
  scheme while the session bearer token is sent to it. Pre-existing; this branch only reworded the
  row. Do not fix it on this branch.

## Git state

- Branch `claude/settings-ux-redesign-69acd6` (base `master`), pushed to `origin`, **0 ahead / 0
  behind**.
- Working tree **clean**. There is **no WIP snapshot commit** — every change is a real commit whose
  message carries the *why*.
- Last real commit: `f562685` — `docs(solutions): five learnings from the settings overhaul, and two
  concepts`. Everything after it is this handoff doc.
- Diff since base: **67 files, +8,961 / -660** (`git diff --stat master...HEAD`).
- You are in a **linked worktree**, not the main checkout. `git worktree add` will refuse this
  branch; work in the path below. The QA vault lives in the **main** checkout at
  `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault`.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
git fetch origin && git switch claude/settings-ux-redesign-69acd6 && git pull --ff-only
npm test && npm run lint && npm run build && npm run typecheck:test
```

All four must pass and the test count must read **1880**. Then start **Next steps** step 1.

If you need to re-capture frames, Obsidian must be open on the throwaway test vault and the plugin
installed from this worktree:

```bash
./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
```

It must print `Reloaded plugin via CLI (vault=test vault): atoms`. Any `REFUSING to report success`
line means the CLI answered for a different vault — stop, do not work around it.
