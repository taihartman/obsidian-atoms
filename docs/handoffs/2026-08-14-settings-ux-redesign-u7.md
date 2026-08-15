---
handoff_date: 2026-08-14
branch: claude/settings-ux-redesign-69acd6
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/493
pr: https://github.com/taihartman/obsidian-atoms/pull/494
status: in-progress
supersedes: docs/handoffs/2026-08-14-settings-ux-redesign-u4.md
---

# Handoff — Settings three-leg overhaul, U1-U6 landed, start at U7

You are picking up this work in a fresh session. Read this file top to bottom, run **How to
resume**, then **start U7 immediately**. Do not re-plan what the plan already decided and do not
summarize this doc back to the user.

The plan at `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md` is still the
implementation authority. This file records only what changed since it was written, plus the
things that bit and should not bite you again.

## Goal

Restructure the Atoms settings tab around the product's three legs (Capture, File, Resurface),
moving passive records and dev plumbing onto destination screens so the main screen answers
"is Atoms filing, and what will it do with my notes" without scrolling. Eleven units; six have
landed.

## Current status

Seven commits on `origin/claude/settings-ux-redesign-69acd6`, all green:

| Commit | What |
|---|---|
| `a38e29f` | **U1** — `group()` primitive in `rows.ts`, keyboard-activatable `destinationRow`/`backRow`, `groupHeaders()` helper |
| `6b4e70d` | **U2** — status group, two variants; `firstDaySetupCopy` single-sourced with Atoms home |
| `fd38314` | **U3** — Capture and File groups |
| `6b3c65b` | Simplify pass over U1-U3 |
| `ddb764e` | **U4** — engine destination + the engine-row rename |
| `06c61a6` | **U5** — Resurface leg as two groups, honest Ask copy |
| `9c0cc65` | **U6** — Privacy destination, records moved, `recordRow` primitive |

**Gates at HEAD:** `npm test` **1835 tests / 97 files**; `npm run lint` clean; `npm run build`
clean; `npm run typecheck:test` clean; `git status` clean after test (no `www/dist` drift).
`DIRECT_SETTING_BUDGET` still **5**, raw `new Setting(` count in `settings.ts` still **6** (one is
inside a comment, which is why the guard strips comments before counting).

**Routes now in `SettingsRoute`:** `main`, `engine`, `account`, `vocabulary`, `connect`,
`privacy`, `advanced`. Both routes KTD9 asked for exist.

**Main screen as it now renders (signed in):** status group → `1 · Capture` → `2 · File` →
`3 · Resurface` → `Ask` → the transitional `Sync` heading → `Your data` group (Privacy, Advanced).

**Remaining:** U7, U8, U9, then U11, then the shipping tail per `CLAUDE.md` (`ce-simplify-code`,
`ce-code-review`, `ce-compound`, `world-class-qa` including the adversarial half). PR #494 is
still draft; mark it ready only after that.

## Next steps

1. **U7 — Advanced destination.** Plan § U7 (line 313). Absorb what is left under the
   transitional `Sync` heading plus the self-host rows. Groups per the plan: model; sync
   (`Sync when you return to Obsidian`, `Sync everything now`); this device (last auto-run day,
   last catch-up); run Ask yourself (service URL, self-host guide) whose footer carries the guide's
   two emphatic constraints — set the URL *before* sign-in, and the server needs a public HTTPS
   address. Escape hatches hold the custom shortcut link and paste-a-session. The device-local key
   pair stays on the engine screen (U4) — do not move it.
   - **Rename `renderAutoRunSection`.** It is still called that and now renders a heading called
     `Sync`. U6 took its consent record; U7 takes the rest, so the method should not survive under
     either name.
   - **Rewrite the internal vocabulary.** `drain → outbox → mirror → filing` appears verbatim in
     the `Sync everything now` description (`src/settings/settings.ts`, search `"drain → outbox"`).
     The plan's test scenario is "Advanced prose contains no internal pipeline stage names".
   - Update the exact ordered Advanced list at `test/settings.test.ts` — search for
     `"Plus service URL override"` inside the `advanced()` block.
2. **U8 — Account screen, restyle only** (plan line 325). The regression bar is that *nothing
   moved*: snapshot the nine row lists before the change and assert equality after. KTD14 is
   explicit about what is **not** in this unit.
3. **U9 — Capture-on-phone sheet** (plan line 341). Note the 768px defect below.
4. **U11 — copy lockstep, tests, version** (plan line 356).
5. **Device evidence.** Nothing has been captured since U1. See "Device evidence status" below —
   this is a real gap, not a formality.
6. **Shipping tail**, then mark PR #494 ready.

## Key files

- `src/settings/settings.ts` — the whole tab. `renderMainScreen` (~line 1310) is the map of what
  renders in what order.
- `src/settings/rows.ts` — the row grammar. Four button kinds now: `actionRow` (accent),
  `destructiveRow`, `recordRow` (plain, added in U6), plus `settingRow`/`destinationRow`/
  `backRow`/`statusRow`/`formRow`/`formActionsRow`/`group`.
- `src/settings/settings.ts:2440`-ish `renderAutoRunSection` — **U7's target**. Renders the
  `Sync` heading, the resume toggle, `Sync everything now`, and two `statusRow` run records.
- `test/settings.test.ts` — `expectedRows(filingChosen, askRows, privacy)` is the pinned
  main-screen list; three length assertions follow it. Every unit U2-U9 mutates this.
- `test/settingsRows.test.ts` — `DESTINATIONS` (the walk table) and `MAIN_DESTINATION_ROWS`
  (every chevron on main, in order) are separate lists now; see below.
- `test/helpers/settingsTab.ts` — `openPrivacy(tab)` added in U6.
- `docs/design-handoff/settings/overhaul.html` — mock SSOT.
- `docs/design-handoff/settings/README.md` § Coverage audit — the 34-row list U11 reconciles.

## Decisions & constraints

Do not relitigate these.

- **The mock is not always right, and three of its claims were rejected on purpose.**
  - `"Nothing here unlocks features"` (engine screen) is **false**: Ask needs a session from the
    Atoms service (R13), so the choice is not purely about who pays. The footer says only that
    *filing* is identical either way.
  - `"$6 a month"` is real but is **never a literal in the plugin**. `plus-pricing.json` is the
    SSOT and `src/shared/plusPricing.ts` is the only thing allowed to format it, which is why
    `ENGINE_SCREEN.pickOne.footer` is a function. A test pins that exactly one `$` amount appears
    on that screen. (I initially planned to drop the price as invented, then found the SSOT — the
    price is legitimate, the hardcoding would not have been.)
  - The signed-out Ask footer does **not** name self-hosting or the DIY guide, though the mock
    does. R13 puts that route on the Advanced screen, which is where U7 keeps it.
- **The three egress-record standing strings are frozen (KTD5) and were not touched.** One reads
  "Acknowledged on this device for Sync everything now" about a consent that is really for
  unattended *filing*. That reads oddly and **cannot be fixed by rewording**: the strings name
  wording a stored ack version was recorded against, so editing them without an
  `EGRESS_ACK_VERSION` bump leaves every existing device holding a record for text it never saw
  (#315). U6 fixed the placement, which was the fixable half. Two tests pin both variants
  verbatim — if you find yourself "cleaning up" that sentence, stop.
- **`recordRow` is a kind, not a flag.** `actionRow` sets `.setCta()`, so a granted consent was
  rendering louder than the switch that granted it (R17, #364 C2). The button's weight *is* the
  meaning. Do not add a `quiet: true` to `actionRow`.
- **The Privacy entry row renders under the full six-way union** (KTD6): egress ack, catch-up
  notice, Ask privacy ack, Ask vault-write ack, live Plus session, known cloud copy. Each
  disjunct outlives the others. Narrowing it re-creates
  `docs/solutions/logic-errors/narrowing-one-grant-removed-the-only-way-to-revoke-the-other.md`
  one level up. `Wipe cloud copy` lives behind it for exactly this reason — on Connect it
  vanished with the mirror it deletes.
- **`statusRow`'s `value` is optional** since U4 (a name-only read-only statement). Same grammar,
  nothing to report on the right edge.
- **KTD12 forbids parallelism.** U7/U8/U9 all mutate `expectedRows()`. Serial only.
- **KTD10 is live and has already caught two stale docs.** Any label renamed *or moved to another
  screen* needs the matching `www/src/setup.html.tmpl` edit **and** a committed `npm run
  build:www` in the same change. U4 fixed "the API key is on the same screen as the version
  number"; U5 fixed a `Settings → Atoms → Capture` heading U3 had renamed to `1 · Capture`.
  U9 will empty `buttonLabels(tab, "Capture Atom shortcut")`, which `test/wwwSetupLabels.test.ts`
  asserts — that one is flagged in the plan.
- **`DIRECT_SETTING_BUDGET` has zero headroom.** Any new chrome goes in `rows.ts`, never as a
  `new Setting(` in `settings.ts`.

## What bit during U4-U6 — do not relearn these

- **A back row is a `.setting-item` named for its own destination.** So `rowNames(tab)` on the
  Privacy screen contains `"Privacy and consents"`, and a naive "walk in if the entry row is
  present" helper matches the *back row* and then cannot click it. `openPrivacy()` and the
  local `records()` helper in `consentGate.adversarial.test.ts` both `hide()` first for this
  reason. Same trap applies to any row-name check run on a destination.
- **Two tests were using the Anthropic probe count as a proxy for "did anything re-render".**
  That witness left the main screen with the key row in U4. They now stamp a marker element that
  any `display()` would empty — strictly stronger, and no longer coupled to where the key row is.
  If you move a row and a "nothing re-renders" test goes green for free, check what it is
  actually witnessing.
- **Moving a row costs five test files, not one.** U6's record move touched
  `settings.test.ts`, `askConsentVersion.test.ts`, `askAckAdversarial.test.ts`,
  `consentGate.adversarial.test.ts`, and `askMirrorConsentTruth.test.ts`. Budget for that before
  starting a move, and add the navigation to `test/helpers/settingsTab.ts` rather than inlining
  it per site.
- **`eslint-plugin-obsidianmd` requires `createFragment()` over
  `document.createDocumentFragment()`.** The test DOM mock had neither; U5 added `createFragment`
  as a global plus the element-building sugar on `DocumentFragment.prototype`
  (`test/mocks/domAugmentations.ts`). If you build markup for a row `desc`, that is the path.
- **The worktree has no `test_vault/`.** The QA vault lives in the main checkout. Install with the
  path passed explicitly, from this worktree:
  ```bash
  ./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
  ```
  It must print `Reloaded plugin via CLI (vault=test vault): atoms`. Any `REFUSING to report
  success` line means the CLI answered for a different vault — stop, do not work around it.
- **The Obsidian CLI's `dev:screenshot` takes no viewport argument, and AppleScript cannot see the
  window.** Resize via `obsidian eval` calling
  `require("electron").remote.getCurrentWindow().setSize(w,h)`, then re-toggle
  `app.emulateMobile()` so the body class recomputes. Verify you actually got `is-phone` at 390
  and **`is-tablet`** at 768 — `is-tablet` is the #347/#348 class where Obsidian's own phone rules
  never fire.
- **`npx vitest run <path>` finds no files here.** Use `npm test --silent -- test/<file>` or
  `npx vitest run -t "<test name>"`. The full suite is about 6 seconds.

## Device evidence status

**Only U1's container is proven on device** (`docs/qa/screenshots/settings-ux-redesign/`, at
390×844 and 768×1024). Nothing from U2 onward has been captured.

**Still unproven, and now overdue:** the between-row hairline
(`.atoms-setting-group .setting-item + .setting-item`). Every group captured so far had exactly
one row. U3, U4, U5, and U6 all added multi-row groups, so four units are riding on a rule nobody
has looked at. Capture this before U8's "only grouping and tokens changed" screenshot claim.

**Known, pre-existing, and not caused by the grouping:** at 768px, `Capture Atom shortcut` and
`Custom shortcut link` render badly — labels ellipse into a ~50px column while the input takes
276px. U3 put both inside a group, which adds 14px padding per side, so expect it slightly worse
until U9 moves the procedure into a sheet.

## Open questions / blockers

- None blocking. The device-evidence gap is work to do, not a decision to make.

## Git state

- Branch `claude/settings-ux-redesign-69acd6` (base `master`), pushed to `origin`,
  **0 ahead / 0 behind**.
- Working tree was **clean** at handoff. There is no WIP snapshot commit — every change is a real
  commit.
- Last code commit: `9c0cc65` — `feat(settings): give the passive consent records a screen of their own`
- Diff since base: **28 files, +5247 / -325** (`git diff --stat master...HEAD`)

## How to resume

The branch is checked out in a **non-durable harness worktree**, which is why `git worktree add`
will refuse the branch. Work in it:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-pasteur-1c6642
git fetch origin && git switch claude/settings-ux-redesign-69acd6 && git pull --ff-only
npm install
npm test && npm run lint && npm run build && npm run typecheck:test
```

All four must pass and the test count must read **1835**. Then start **Next steps** step 1.

## Execution shape that has been working

Per unit: read the unit's plan section and the mock, make the source change, run the four gates,
fix the tests the move breaks, add the plan's named test scenarios, then commit. Simplify at every
second or third unit rather than after each one. Commit messages carry the *why* for anything a
reader would otherwise want to undo — the rejected mock claims and the frozen strings especially.
