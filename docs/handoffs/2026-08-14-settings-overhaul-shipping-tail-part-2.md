---
handoff_date: 2026-08-14
branch: claude/settings-ux-redesign-69acd6
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/493
pr: https://github.com/taihartman/obsidian-atoms/pull/494
status: in-progress
supersedes: docs/handoffs/2026-08-14-settings-ux-redesign-shipping-tail.md
---

# Handoff — Settings three-leg overhaul: evidence done, finish the shipping tail

You are picking up this work in a fresh session. Read this file top to bottom, run **How to
resume** to land on the right branch and worktree, then **start Next steps step 1 immediately**.
Do not ask the user what to work on, do not re-plan what the plan already decided, and do not
summarize this doc back to them. Start working and report what you did.

The previous handoff's one job — device evidence — is **done**. Three defects turned up during it
and are fixed, reviewed and pushed. What remains is the rest of the shipping tail and the PR.

## Goal

Restructure the Atoms settings tab around the product's three legs (Capture, File, Resurface), so
the main screen answers "is Atoms filing, and what will it do with my notes" without scrolling.
All eleven plan units landed in an earlier session. Your job is to finish the shipping tail and
get PR #494 out of draft.

## Current status

Sixteen commits on `origin/claude/settings-ux-redesign-69acd6`, working tree clean, 0 ahead.
**Gates green at HEAD: `npm test` 1869 / 97 files, `npm run lint`, `npm run build`,
`npm run typecheck:test`, and `git status` clean after the suite.** Version **0.8.0** across
`package.json` / `manifest.json` / `versions.json`, pinned by a test.

The eleven plan units are `a38e29f` through `db89129` — see the superseded handoff for that table.
This session added four:

| Commit | What |
|---|---|
| `96a6862` | The group block, and a width floor under text rows |
| `bcf1438` | Developer copy off the who-pays screen; the em-dash sweep and its guard |
| `acd9ef5` | Device evidence, the QA report, three healed drive-map rows |
| `9212fa7` | The capture harness under `scripts/qa/` |

**Device evidence is complete and reviewed.** Sixteen frames at 390×844 (`is-phone`) and 768×1024
(`is-tablet`) under `docs/qa/screenshots/settings-ux-redesign/`, all verified by a reviewer who
opened them. Full report: `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md`.
Verdict was ship; everything left in it is cosmetic.

**U11 step 5, the measurement the plan asked for:** signed-out root at 390px is **2,121px / 2.51
phone screens** against the 3,444px / 4.1-screen baseline, −38%. Tallest row 150px (was 211px),
rows over 144px down 6→2, undefined terms **11** (was 30) with **2** before the first control (was
9). The terms are enumerated in the report. It does **not** reach the mock's 1,081px and the
report says so — 653px of what remains is the `2 · File` group alone.

## Next steps

1. **`ce-simplify-code`** over the branch diff. Known seam, still unaddressed: `src/settings/
   settings.ts` grew four render methods in U7 and two in U8 — look at whether `renderAccountFacts`
   and `renderAccountActions` can share their `setupIncomplete` derivation instead of both taking
   it as a parameter. Read the trap about that in **Traps** below before you try.
2. **`ce-code-review`.** `.compound-engineering/config.local.yaml` already exists with
   `cross_model_peer: grok` — do not create it again, and do not let anything route to codex.
   Give the peer a brief naming two or three files, not the 7.5k-line diff: it gets 40 turns and
   600s, and a run that dies before its final step returns literally nothing for the same money.
3. **`ce-compound`.** At least four durable learnings are sitting in this branch, all written up in
   commit messages and none yet in `docs/solutions/`. They are listed under **Learnings to
   compound** below so you do not have to mine the log for them.
4. **Finish `world-class-qa`.** The device-evidence and findings halves are written; the
   **story-coverage** and **adversarial** halves are not. Append to the existing report rather
   than starting a new one. `adversarial-qa` is that skill's hard gate.
5. **PR #494.** Still **draft**, and its body is stale — it currently says *"Draft — plan and
   design spec only, no implementation yet"*, which stopped being true eleven units ago. Rewrite
   it: `Closes #493` (it currently says "Claims #493", which does **not** auto-close), distilled
   Core user stories, Edge cases & testing, an Evidence table linking the screenshots with
   **absolute** `https://raw.githubusercontent.com/taihartman/obsidian-atoms/claude/settings-ux-redesign-69acd6/docs/qa/screenshots/...`
   URLs (repo-relative paths render as broken images in a PR body), Test plan boxes ticked only
   for what actually ran, then mark ready.

## Do not duplicate: a sweep is running elsewhere

A **separate local session** is running the plugin-wide em-dash sweep (finding F5's remainder):
about **102 non-comment lines across 28 files outside `src/settings/`**, led by
`src/plugin/main.ts` at 24. Do not start that work here.

Expect it to touch `src/plugin/`, `src/home/`, `src/pipeline/`, `src/platform/`, and possibly to
widen `test/settingsCopyVoice.test.ts` into a whole-plugin guard. If you hit a conflict there,
theirs is the newer intent for those files; this branch only owns the `src/settings/` half.

## Learnings to compound

1. **A CSS assertion is not a fidelity verdict.** `getComputedStyle` said the between-row hairline
   was there, and it was — painted onto rows Obsidian had already turned into detached floating
   cards, where nothing could see it. Seven units rode on that rule and the automated check passed
   the whole time. Somebody has to look at the picture.
2. **A capture guard only catches what it was told to look for.** Three separate guards were added
   to the screenshot harness, each after a reviewer found the class of bad evidence the guards in
   place at the time had passed: a mis-navigated sweep filing four frames of the wrong screen, a
   settled *pair* that was the previous screen, and a modal left open over 14 of 16 frames. Every
   run reported success.
3. **A property test that says "this screen touches nothing" stops being true when the screen
   gains a row whose job is to act.** Narrow the claim to what survives ("grants nothing") rather
   than deleting the guard or quietly widening its allowlist. U7's Advanced R5 rewrite.
4. **An "exercise every control" walk keyed by element identity loops forever** the moment one of
   those controls calls `redisplay()`. Key by row name: that is what "touched" means, and the set
   of names is finite.

## Decisions & constraints — do not relitigate

Each of these has a cost behind it and a reviewer's first instinct will be to reverse it.

- **The group's fill is `--background-primary`, not the mock's `--background-secondary`.** The mock
  draws a full-screen page where the ground is primary. Obsidian's settings modal inverts that: the
  pane *is* `--background-secondary` (measured `rgb(246,246,246)` for pane, modal and group alike,
  against `#ffffff`). A secondary block there has no edge, and text fields — also secondary — stop
  looking like fields. The rule moves the fill Obsidian already painted behind each row card onto
  the one block those rows belong to.
- **Rows inside a group are transparent, square and margin-free**, overriding Obsidian's per-item
  mobile card. Without that the group is a string of pills and the hairline is invisible.
- **The name column grows far harder than the field** on wrapped text rows (`flex: 100 1 0`).
  Letting the field take the surplus shrank `Atom folder`'s desktop name from 371px to 240px and
  added 16px of height — a tablet fix charging desktop for it. Verified at 390, 768 and desktop.
- **The key-naming rule lives in the engine group's footer**, under *both* key rows. It has had
  three homes; the invariant in all three is that it stays reachable and does not come *between*
  the key row and the fallback toggle, which answer for the same key. A comment at
  `src/settings/settings.ts:2646` used to defend the row placement — that comment is gone, the
  reasoning is in `ENGINE_SCREEN.pickOne`.
- **`src/settings/consent.ts` keeps its em dashes and is exempt from the voice guard.** Those
  strings name the exact wording a stored acknowledgment was recorded against; rewording them
  without an `EGRESS_ACK_VERSION` bump leaves every existing device holding a record for text it
  never saw (KTD5, #315). The guard asserts the exemption is still *needed*, so it cannot outlive
  its reason.
- **Advanced holds acting rows, and its property test says so.** `Sync everything now` and the
  resume toggle live there; the old "reaches nothing" claim was narrowed to "grants nothing" plus a
  second test pinning the exact plugin entry points the screen reaches. Moving another acting row
  there trips that list. **Widening it is the decision, not the fix.**
- **The nine account renders are pinned by name, in order** (`test/settings.test.ts`, "account
  screen holds the same rows through the restyle"). Do not simplify it into a membership check.
- **`Paste a session` is two screens from the sign-in form**, single-sourced through
  `PASTE_SESSION_ROUTE`. Rename the row, rename it there.
- **Renames carry doc lockstep (KTD10), already paid.** `Plus service URL`, `Self-host guide`,
  `Capture on your phone`. `docs/ask-self-host.md` and `www/src/setup.html.tmpl` were edited and
  `www/dist` rebuilt in the same commits.

## Traps this branch hit

- **Passing a narrowed boolean as a parameter destroys the narrowing.** `setupIncomplete` arrives
  at `renderAccountFacts` as a plain `boolean`, so the email read had to go back to a
  `state.kind === …` check. This is exactly the seam step 1 asks you to look at — `tsc` will catch
  you, but know why it is shaped that way before you "fix" it.
- **`is-tablet` is a narrower pane than its window.** At 768px the settings pane keeps its nav
  sidebar: modal 691px, pane 489px, group **410px**, row content line ~366px. Any `@media` query on
  window width is the wrong tool for a row-layout problem.
- **A back tap is not reliably one tap.** Off the Account screen the first click on the back row is
  routinely swallowed. Loop until the screen you want renders; `scripts/qa/settings-nav.sh --home`
  does this.
- **A JS `.click()` navigates underneath an open sheet's scrim** — a real tap cannot
  (`elementFromPoint` returns `modal-bg`), so this is a harness hazard, not a product bug. It
  poisoned 14 of 16 frames once.
- **`npx vitest run <path>` finds no files here.** Use `npm test --silent -- test/<file>` or
  `npx vitest run -t "<test name>"`. Full suite about 8 seconds.
- **`fakeTab` in `test/settings.test.ts` predates most of the tab.** Any new plugin read on a
  screen it renders needs a stub added.

## Key files

- `src/settings/settings.ts` — the whole tab. `renderMainScreen` is the map of what renders in what
  order. `ENGINE_SCREEN` (`:530`) carries the engine screen's copy including the key-naming footer.
- `src/settings/rows.ts` — the row grammar. `settingRow` marks text rows `atoms-setting-text`.
- `styles.css:1971` — `.atoms-setting-group` and the per-row card override; `:2134` the text-row
  width floors. Both blocks carry the measurements that justify them.
- `test/settingsCopyVoice.test.ts` — the em-dash guard and its documented exemption.
- `test/settings.test.ts` — `expectedRows()` is the pinned main-screen list (13/11).
- `scripts/qa/settings-{shot,nav,sweep}.sh` — the capture harness. Read `settings-shot.sh`'s header
  before capturing anything.
- `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md` — the report you extend.
- `docs/design-handoff/settings/overhaul.html` + `account.html` — mock SSOT.

## Open questions / blockers

- **None blocking.** Everything left is work, not a decision.
- One judgement call you will meet in step 5: the version is **0.8.0** and unreleased, so these
  fixes did not bump it. If the user wants a beta out before merge, that is a `0.8.0-beta.N` bump
  per `docs/runbooks/plugin-release-beta-stable.md` — do not cut a release unless asked.

## Git state

- Branch `claude/settings-ux-redesign-69acd6` (base `master`), pushed to `origin`, **0 ahead / 0
  behind** at handoff.
- Working tree **clean**. There is **no WIP snapshot commit** — every change is a real commit whose
  message carries the *why* for anything a reviewer would want to undo.
- Last code commit: `9212fa7` — `chore(qa): commit the settings capture harness, guards and all`.
  Everything after it is this handoff doc.
- Diff since base: **59 files, +7,928 / -612** (`git diff --stat master...HEAD`).
- You are in a **linked worktree**, not the main checkout. `git worktree add` will refuse this
  branch; work in the path below. The QA vault lives in the **main** checkout at
  `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault`.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
git fetch origin && git switch claude/settings-ux-redesign-69acd6 && git pull --ff-only
npm install
npm test && npm run lint && npm run build && npm run typecheck:test
```

All four must pass and the test count must read **1869**. Then start **Next steps** step 1.

If you need to re-capture frames, Obsidian must be open on the throwaway test vault and the plugin
installed from this worktree:

```bash
./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
```

It must print `Reloaded plugin via CLI (vault=test vault): atoms`. Any `REFUSING to report success`
line means the CLI answered for a different vault — stop, do not work around it.
