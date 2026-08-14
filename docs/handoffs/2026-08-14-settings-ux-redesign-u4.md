---
handoff_date: 2026-08-14
branch: claude/settings-ux-redesign-69acd6
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/493
pr: https://github.com/taihartman/obsidian-atoms/pull/494
status: in-progress
supersedes: docs/handoffs/2026-08-14-settings-ux-redesign.md
---

# Handoff — Settings three-leg overhaul, U1-U3 landed, start at U4

Read this file top to bottom, then **start U4 immediately**. Do not re-plan what the plan already
decided and do not summarize this doc back to the user. The plan at
`docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md` is still the implementation
authority; this file records only what changed since it was written.

## Where the work stands

Four commits on `origin/claude/settings-ux-redesign-69acd6`, all green:

| Commit | What |
|---|---|
| `a38e29f` | **U1** — `group()` primitive in `rows.ts`, keyboard-activatable `destinationRow`/`backRow`, `groupHeaders()` harness helper |
| `6b4e70d` | **U2** — status group, two variants; `firstDaySetupCopy` single-sourced with Atoms home |
| `ff363b6` | Device evidence at 390×844 and 768×1024 |
| `fd38314` | **U3** — Capture and File groups; fixed the chrome U2 orphaned |
| `6b3c65b` | Simplify pass over U1-U3 |

**Gates at HEAD:** `npm test` 97 files / **1801 tests**; `npm run lint` clean; `npm run build` clean;
`git status` clean after test (no `www/dist` drift). `DIRECT_SETTING_BUDGET` still 5, raw
`new Setting(` count in `settings.ts` still **6** (one is inside a comment).

**Remaining:** U4, U5, U6, U7, U8, U9, then U11, then the shipping tail per `CLAUDE.md`
(`ce-simplify-code`, `ce-code-review`, `ce-compound`, `world-class-qa` including the adversarial
half). PR #494 is still draft; mark it ready only after that.

## Start here: U4, and pay one debt with it

U3 deliberately left the engine row half-done, because finishing it cheaply would have cost twice.

- The engine row currently wires to the **existing `account` route**. The `engine` route does not
  exist yet — U4 builds it (KTD9).
- The row is **not renamed**. The plan wants it to name the engine decision, but its current name
  appears in `test/settingsRows.test.ts`'s `DESTINATIONS` table, `test/plusSignInAccountRefresh.test.ts`,
  `test/askMirrorConsentTruth.test.ts`, and a dozen sites in `test/settings.test.ts`. **Do the rename
  in the same change as the route**, so that blast radius is paid once.
- What U3 *did* add is the half that was missing regardless: the row now declares `Not chosen` /
  `Your own key` / `Plus` instead of being silent about which engine is active.

## Carry-forwards found during U1-U3 — each belongs to a specific later unit

**U5 (Resurface).** The Ask section still reads *"Sign in to Atoms Plus **above**"*, which pointed at
an `Atoms Plus` heading U3 retired. Still spatially true, but it names a heading that is gone.

**U6 / U7 (privacy, Advanced).** U3 had to re-home the rows orphaned when it deleted the
`Automatic filing (this device)` heading. They now sit under a **transitional `Sync` heading** that
never says "filing" — and the **egress consent record is under it**, which is a mislabel: that record
is the consent for unattended *filing*, and one of its own branches reads "Acknowledged on this
device for Sync everything now." U6 moves the record to Privacy; U7 takes the rest to Advanced.
Do not inherit the label. The method is still named `renderAutoRunSection` and now renders a
heading called `Sync`; rename it when you move it.

**U9 (capture sheet).** At 768px, `Capture Atom shortcut` and `Custom shortcut link` render badly:
labels ellipse into a ~50px column while the input takes 276px. This is pre-existing, not caused by
the grouping, but U3 put both inside a group which adds 14px padding per side — expect it slightly
worse, not better, until U9 moves the procedure into a sheet.

**U11 (copy lockstep).** `firstDaySetupCopy(dailyNotesLoaded, filingChosen = true)` has a
**default-true boolean**: a caller that forgets the second argument silently reports "nothing
outstanding". Two callers today and both are deliberate, but a third would inherit the wrong answer
by omission. Worth closing when the copy pass touches it.

Also: the plan says the two groups retire **five** headings. It is **four**. `Your API key (optional)`
survives U3 on purpose — its rows belong on the engine destination U4 builds, and folding a
credential under a footer about what Atoms writes is the wrong promise. The test is named for four.

## What bit during U1-U3 — do not relearn these

- **Two guarantees were nearly lost in a footer sweep, and both had to be restored by review.**
  The `top-level` bullet rule was deleted from the Capture copy and the test guarding it was
  rewritten to assert the new sentence — removing the one word it had ever protected.
  `isContinuationLine` (`src/pipeline/parse.ts:41`) folds an indented bullet into the capture above
  it *silently*, so that word is the only thing letting a user predict why two thoughts became one
  atom. Separately, a `U7` anchor was loosened from an exact prefix to `.includes("backfill")`.
  **R19 is not advice.** When a unit moves prose, diff the *guarantees*, not the sentences.
- **Every unit's diff got an independent scope review before commit** (a read-only subagent
  answering fixed questions: settings lost, frozen strings, gates moved, `new Setting(` added, tests
  weakened, Obsidian conventions, duplication). It caught the two above. Keep doing it; it is cheap
  and it is the only thing that found them.
- **The worktree has no `test_vault/`.** The QA vault lives in the main checkout. Install with the
  path passed explicitly, from the worktree:
  ```bash
  ./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
  ```
  It must print `Reloaded plugin via CLI (vault=test vault): atoms`. Any `REFUSING to report success`
  line means the CLI answered for a different vault — stop, do not work around it.
- **The Obsidian CLI's `dev:screenshot` takes no viewport argument, and AppleScript cannot see the
  window.** Resize via `obsidian eval` calling `require("electron").remote.getCurrentWindow().setSize(w,h)`,
  then re-toggle `app.emulateMobile()` so the body class recomputes. Verify you actually got
  `is-phone` at 390 and **`is-tablet`** at 768 — `is-tablet` is the #347/#348 class where Obsidian's
  own phone rules never fire.
- **`npx vitest run <path>` finds no files here.** Use `npx vitest run -t "<test name>"`, or just
  `npm test` — the full suite is about 8 seconds.

## Device evidence status

U1's container is **proven on device at both widths** (`docs/qa/screenshots/settings-ux-redesign/`).
The group holds: eyebrow above, 14px radius, inset 16px, 14px side padding inside, 72px rows against
a 44px floor, and the unprefixed selector carries tablet correctly.

**Still unproven:** the between-row hairline. Every group captured so far had exactly one row. U3's
groups are multi-row, so the next capture finally exercises `.atoms-setting-group .setting-item +
.setting-item`. Look at it.

Also expected and not a defect: the group card currently looks identical to the ungrouped rows below
it, so grouping signals nothing yet. That resolves as U5-U7 convert the rest of the screen.

## How to resume

The branch is checked out in a harness worktree. If it is gone, recreate a sibling:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
git fetch origin
git worktree add ../obsidian_plugin-settings-ux-redesign claude/settings-ux-redesign-69acd6
cd ../obsidian_plugin-settings-ux-redesign && npm install
npm test && npm run lint && npm run build
```

If `worktree add` says the branch is already checked out, run `git worktree list | grep settings-ux-redesign`
and `cd` to the path it names.

## Execution shape that has been working

`ce-work`, native inline/subagent engine, **serial** — KTD12 forbids parallelism because U2-U9 all
mutate `expectedRows()`. Per unit: dispatch one fresh `impl-worker` with a bounded packet (the unit
section, its cited R/KD/KTD verbatim, the scope boundaries, the carry-forwards above, and an explicit
"do not commit"), then orchestrator-side run the four gates, dispatch the read-only scope review,
fix what it finds, and commit. Simplify at every second or third unit, not after each one.
