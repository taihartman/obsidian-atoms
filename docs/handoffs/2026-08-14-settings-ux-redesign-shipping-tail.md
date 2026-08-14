---
handoff_date: 2026-08-14
branch: claude/settings-ux-redesign-69acd6
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/493
pr: https://github.com/taihartman/obsidian-atoms/pull/494
status: implementation-complete
supersedes: docs/handoffs/2026-08-14-settings-ux-redesign-u7.md
---

# Handoff — Settings three-leg overhaul: all units landed, start the shipping tail

You are picking up this work in a fresh session. Read this file top to bottom, run **How to
resume** to land on the right branch and worktree, then **start Next steps step 1 immediately** —
capturing device evidence is your current task. Do not ask the user what to work on, do not
re-plan what the plan already decided, and do not summarize this doc back to them. Start working
and report what you did.

Every unit in `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md` is implemented
and pushed. What is left is **device evidence** and the **shipping tail**, in that order. Do not
re-open the design: the plan is still the authority and every rejected alternative is recorded in
a commit message rather than only in a doc.

## Goal

Restructure the Atoms settings tab around the product's three legs (Capture, File, Resurface), so
the main screen answers "is Atoms filing, and what will it do with my notes" without scrolling.
Passive consent records, diagnostics, and escape hatches move onto destination screens. Eleven
units; all eleven have landed. Your job is to prove it on a device and ship it.

## Current status

Eleven commits on `origin/claude/settings-ux-redesign-69acd6`, all green.

| Commit | What |
|---|---|
| `a38e29f` | **U1** — `group()` primitive, keyboard-activatable `destinationRow`/`backRow` |
| `6b4e70d` | **U2** — status group; `firstDaySetupCopy` single-sourced with Atoms home |
| `fd38314` | **U3** — Capture and File groups |
| `6b3c65b` | Simplify pass over U1-U3 |
| `ddb764e` | **U4** — engine destination + engine-row rename |
| `06c61a6` | **U5** — Resurface as two groups, honest Ask copy |
| `9c0cc65` | **U6** — Privacy destination, records moved, `recordRow` |
| `346ea28` | **U7** — Advanced takes the diagnostics, the sync and the escape hatches |
| `7410e9d` | **U8** — account screen grouped, nothing re-shaped |
| `f3e60c8` | **U9** — capture procedure into a sheet, row carries a status |
| `db89129` | **U11** — copy lockstep, audit reconciled, **0.8.0** |

**Gates at HEAD:** `npm test` **1862 tests / 97 files**; `npm run lint`, `npm run build`,
`npm run typecheck:test` all clean; `git status` clean after test (no `www/dist` drift).
`DIRECT_SETTING_BUDGET` still **5**; raw `new Setting(` in `settings.ts` still **6** (one inside a
comment, which is why the guard strips comments first).

**Diff since base:** 36 files, +6613 / -579.

**Version is 0.8.0** across `package.json`, `manifest.json`, `versions.json`. Minor, not patch:
every screen in the tab moved. A test pins the three together.

**Main screen now:** status group → `1 · Capture` → `2 · File` → `3 · Resurface` → `Ask` →
`Your data`. **13 rows signed in, 11 signed out.** Seven routes: `main`, `engine`, `account`,
`vocabulary`, `connect`, `privacy`, `advanced`, plus one sheet (`CaptureShortcutSheetModal`).

## Next steps

1. **Device evidence. This is the real gap and it blocks the QA report.** Nothing has been
   captured since U1. See "Device evidence" below for exactly what is unproven and how to capture
   it. Do this first: `world-class-qa` cannot produce a fidelity verdict without it, and U8's
   whole claim is "only grouping and tokens changed", which is a screenshot claim.
2. **`ce-simplify-code`** over the branch diff. `src/settings/settings.ts` grew four render
   methods in U7 and two in U8; look for the seam where `renderAccountFacts` /
   `renderAccountActions` could share their `setupIncomplete` derivation instead of both taking it
   as a parameter.
3. **`ce-code-review`.** Cross-model peer routes to **grok**, not codex — create
   `.compound-engineering/config.local.yaml` with `cross_model_peer: grok` if it is not there, and
   give the peer a brief naming two or three files rather than the whole 6.6k-line diff. It has 40
   turns and 600s, and a run that dies before its final step returns literally nothing.
4. **`ce-compound`** — at least two durable learnings are sitting in this branch, both written up
   in commit messages already and neither yet in `docs/solutions/`:
   - *A property test that says "this screen touches nothing" stops being true when the screen
     gains a row whose job is to act.* Narrow the claim to what survives ("grants nothing") rather
     than deleting the guard or quietly widening its allowlist. U7's Advanced R5 rewrite.
   - *An "exercise every control" walk keyed by element identity loops forever the moment one of
     those controls calls `redisplay()`.* Key by row name: that is what "touched" means, and the
     set of names is finite.
5. **`world-class-qa`** per `docs/qa/`, ending with `adversarial-qa`. Report under
   `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md`.
6. **Re-measure the signed-out root at 390px** against the plan's 3,444px / 30-term baseline and
   record both in that report. This is U11 step 5, the one item of U11 that needs a device.
7. **PR #494** — still draft. Fill the Test plan boxes from real evidence, attach screenshots with
   absolute `raw.githubusercontent.com` URLs, confirm the body carries `Closes #493`, then mark
   ready.

## Device evidence

**Only U1's container is proven on device** (`docs/qa/screenshots/settings-ux-redesign/`, 390×844
and 768×1024). Nothing from U2 onward.

**Unproven and overdue:**

- **The between-row hairline** (`.atoms-setting-group .setting-item + .setting-item`). Every group
  captured so far had exactly one row. U3 through U9 all added multi-row groups, so seven units
  ride on a rule nobody has looked at.
- **`.atoms-capture-steps`** (new in U9, `styles.css`). An `<ol>` inside a sheet, never rendered
  on a device.
- **`formActionsRow` at 390px, now nested inside a group** (U8). Its rules are descendant
  selectors so nesting should not break them, but the group adds 14px padding per side and the
  three commit buttons have to stay stacked (KTD8).
- **The Advanced screen at 768px.** U7 moved `Custom shortcut link` there, and that row is half of
  the known 768px defect below.

**Known, pre-existing, not caused by the grouping:** at 768px `Custom shortcut link` renders badly
— the label ellipses into a ~50px column while the input takes 276px. It is `.is-tablet`, the
#347/#348 class where Obsidian's own phone rules never fire. U9 removed its neighbour
(`Capture Atom shortcut`) from that group, so it is now alone under Escape hatches; expect it
about the same, not worse.

**How to capture, from this worktree** (it has no `test_vault/` of its own):

```bash
./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
```

It must print `Reloaded plugin via CLI (vault=test vault): atoms`. Any `REFUSING to report
success` line means the CLI answered for a different vault — stop, do not work around it.

`dev:screenshot` takes no viewport argument and AppleScript cannot see the window. Resize with
`obsidian eval` calling `require("electron").remote.getCurrentWindow().setSize(w,h)`, then
re-toggle `app.emulateMobile()` so the body class recomputes. Verify you actually got `is-phone`
at 390 and **`is-tablet`** at 768.

## What changed this session, and the things not to undo

Each of these is a decision with a cost, recorded here because a reviewer's first instinct will be
to reverse it.

- **Advanced holds acting rows now, and its property test says so.** `Sync everything now` and the
  resume toggle live there. The old test claimed no row on Advanced could reach money, egress, or
  vault writes; that claim is false for a button whose job is to run the pass. It was narrowed to
  "grants nothing" — no ack written or cleared, no `askEnabled`, no device-local key, no consent
  sheet — plus a second test pinning the exact set of plugin entry points the screen reaches. If
  you move another acting row onto Advanced, that list trips. **Widening it is the decision, not
  the fix.**
- **`Paste a session` is two screens from the sign-in form.** Both notices that name the route
  (`accountEmailDesc`, `sendPlusMagicLink`) single-source it through `PASTE_SESSION_ROUTE`. If you
  rename the row, rename it there.
- **The account screen's group eyebrow does not name the state**, though `account.html` does. The
  mock has already replaced the `Status` row with the facts under it; here that row still exists
  carrying exactly those words, so a state-named eyebrow says the same thing twice one line apart.
  This is a KTD14 consequence, not an oversight.
- **Two account groups, not the mock's three.** The third is its sign-out block, whose shape is
  one red row with `Sign out all devices` demoted to a footer link, and that demotion is on
  KTD14's deferred list for the buy-now plan.
- **The nine account renders are pinned by name, in order** (`test/settings.test.ts`, "account
  screen holds the same rows through the restyle"). That list passed unchanged on the first run
  after the restyle, which is the evidence U8 exists to produce. Do not "simplify" it into a
  membership check.
- **The three egress-record standing strings stay frozen (KTD5).** One reads "Acknowledged on this
  device for Sync everything now" about a consent that is really for unattended *filing*. That
  reads oddly and **cannot be fixed by rewording**: the strings name wording a stored ack version
  was recorded against, so editing them without an `EGRESS_ACK_VERSION` bump leaves every existing
  device holding a record for text it never saw (#315). U11 now pins all three ack versions by
  value.
- **The renames carry doc lockstep (KTD10), already paid.** `Plus service URL override` →
  `Plus service URL`, `DIY Ask guide` → `Self-host guide`, `Capture Atom shortcut` →
  `Capture on your phone`. `docs/ask-self-host.md` and `www/src/setup.html.tmpl` were edited and
  `www/dist` rebuilt in the same commits, and `test/wwwSetupLabels.test.ts` gained two cases that
  assert the guide names each control **and the route to it** — a button named with no route is
  not a followable instruction.
- **The coverage audit was wrong in three places and now says so** (`docs/design-handoff/
  settings/README.md` § Coverage audit). The device-local key pair shipped on the engine screen,
  not Advanced; `Last catch-up` kept its name because `LAST_CATCHUP_LABEL` is single-sourced with
  Atoms home; the capture procedure shipped as three steps, not six.

## Traps this session hit

- **`exerciseEveryControl` keyed by element identity loops forever** once a control on the screen
  calls `redisplay()`. It is keyed by row name now. If you add a screen with two rows of the same
  name, that walk silently skips one.
- **Passing a narrowed boolean as a parameter destroys the narrowing.** `setupIncomplete` arrives
  at `renderAccountFacts` as a plain `boolean`, so the email read had to go back to a
  `state.kind === …` check. `tsc` catches it; a quick refactor will re-introduce it.
- **A guide sentence assertion splits on `.` + whitespace.** Putting the row name and the button
  name in different sentences makes "the sentence naming the button also names the route" fail,
  which is a real signal, not a test bug.
- **`npx vitest run <path>` finds no files here.** Use `npm test --silent -- test/<file>` or
  `npx vitest run -t "<test name>"`. Full suite is about 14 seconds.
- **`fakeTab` in `test/settings.test.ts` predates most of the tab.** It needed
  `getResumeEnabled` and `getLastCatchupLine` stubs the moment Advanced started reading them. Any
  new plugin read on a screen that fake renders needs one too.

## Key files

- `src/settings/settings.ts` — the whole tab. `renderMainScreen` is the map of what renders in
  what order; `renderAdvancedDestination` and `renderAccountDestination` are the two screens this
  session rewrote.
- `src/settings/rows.ts` — the row grammar. `group`, `settingRow`, `destinationRow`, `backRow`,
  `statusRow`, `formRow`, `formActionsRow`, `actionRow`, `destructiveRow`, `recordRow`,
  `confirmSheet`.
- `src/settings/captureSheet.ts` — **new in U9.** The procedure sheet. Kept out of `settings.ts`
  partly so its `new Setting(` does not eat the budget.
- `src/settings/captureShortcut.ts` — `CAPTURE_SHORTCUT_STEPS` and `captureShortcutStatus` are new.
- `test/settings.test.ts` — `expectedRows()` is the pinned main-screen list (13/11). The U8 nine-
  render table and the U11 copy lockstep are near the top.
- `test/helpers/settingsTab.ts` — `openAdvanced`, `openPrivacy`, `sheetButtons` are the walkers.
- `docs/design-handoff/settings/overhaul.html` + `account.html` — mock SSOT.
- `docs/design-handoff/settings/README.md` § Coverage audit — reconciled at U11.

## Open questions / blockers

- None blocking. The device evidence is work to do, not a decision to make.

## Git state

- Branch `claude/settings-ux-redesign-69acd6` (base `master`), pushed to `origin`,
  **0 ahead / 0 behind**.
- Working tree was **clean** at handoff. There is **no WIP snapshot commit** — every change on
  this branch is a real commit with a real message, and those messages carry the *why* for
  anything a reviewer would otherwise want to undo.
- Last code commit: `db89129` — `feat(settings): close the copy lockstep, reconcile the audit,
  bump to 0.8.0`. Everything after it is this handoff doc. (No SHA is quoted for the handoff
  commit itself: it would have to name the commit it is inside, and amending to backfill it just
  changes the SHA again. `git log --oneline -3` is the answer.)
- Diff since base: **37 files, +6825 / -579** (`git diff --stat master...HEAD`)
- You are in a **linked worktree**, not the main checkout. `git worktree add` will refuse this
  branch; work in the path below.

## How to resume

The branch is checked out in a **non-durable harness worktree**, which is why `git worktree add`
will refuse the branch. Work in it:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
git fetch origin && git switch claude/settings-ux-redesign-69acd6 && git pull --ff-only
npm install
npm test && npm run lint && npm run build && npm run typecheck:test
```

All four must pass and the test count must read **1862**. Then start **Next steps** step 1.
