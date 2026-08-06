---
handoff_date: 2026-08-06
branch: fix/342-proposed-tags-dismiss-row
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/345
status: in-progress
---

# Handoff — #342 + #346: the code is done; QA is not

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

> **Do not `git add -A` in this worktree.** It carries two untracked paths — `.gitattributes` and
> `.opencode/` — that are **not part of this work**, left from an unrelated stash pop long ago.
> Stage explicit paths, always.

> **`npm test` deletes `docs/field-notes/published/2026-08-01-sample-loop.json`.** That is
> [#343](https://github.com/taihartman/obsidian-atoms/issues/343), a real open footgun. After any
> test run, `git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json` before you stage
> anything, or you will sweep a deletion into an unrelated commit.

## Goal

Two fixes ride on this branch, both in the Atoms settings screen, both already implemented, reviewed,
and pushed. **Your job is the QA pass and the merge, not the code.**

- **[#342](https://github.com/taihartman/obsidian-atoms/issues/342)** — every proposed tag rendered
  two full-width cards, the second one carrying nothing but its own `Dismiss #tag` button label.
  Replaced by one section-level `N proposals waiting` · **Dismiss all** row.
- **[#346](https://github.com/taihartman/obsidian-atoms/issues/346)** — found from a real phone
  screenshot while reviewing the above: on `is-phone`, Obsidian stacked every Atoms settings row
  whose right edge is not a toggle, orphaning chevrons and trailing text onto a second line.

Both are on [PR #345](https://github.com/taihartman/obsidian-atoms/pull/345), which is **draft** and
carries `Closes #342` + `Closes #346`. Version **0.6.82**.

## Current status

Everything below is **done and pushed**. Do not redo it.

- **#342 implemented.** Per-tag `destructiveRow` deleted; one section-level destructive row added,
  scoped to the proposals it rendered, behind a confirm sheet.
- **#346 implemented and measured.** `.is-phone`-gated CSS in `styles.css`; verified live at 390×844
  by A/B (deleting exactly the three new rules in the running window and re-inserting them).
  Destination rows 149→105 / 95→60 / 95→60, status 88→53, back 95→60 with its chevron moving from
  below the name to beside it. At desktop width the same A/B produced an **empty diff**.
- **Shipping tail run:** `ce-simplify-code` (three reviewers, no findings) → `ce-code-review`
  (correctness / project-standards / testing / learnings + an independent cross-model adversarial
  pass on grok-4.5) → `ce-compound`.
- **Verification:** `npm run build` clean, `npx vitest run` 78 files / **1280 tests** pass.
- **Learning written:** `docs/solutions/architecture-patterns/a-bulk-action-inherits-none-of-the-per-item-actions-bounds.md`.
  `CONCEPTS.md` gained **Confirm sheet** and **Proposed tag**, and its **Row grammar (settings)**
  entry was refined.
- **Docs refreshed:** `docs/qa/app-navigation-map.md` no longer describes the deleted row.
- **Five phone screenshots committed** under `docs/qa/screenshots/342-proposed-tags/` and linked in
  the PR body with absolute `raw.githubusercontent.com` URLs.
- **STATUS.md** carries the in-flight row for both issues.

## Next steps

1. **Run `world-class-qa` on this branch**, scoped to the changed surface — the Tag vocabulary
   destination and the settings row chrome. It must end in its **`adversarial-qa`** gate; that is a
   hard requirement of the skill, not optional polish. Write the report to
   `docs/qa/2026-08-06-342-proposed-tags-world-class-qa.md` and link it from the PR body.
   Read `docs/qa/README.md` first — especially **§ Product dogfood honesty**. Prove behavior through
   the real user loop, not by seeding state and screenshotting the result.
   **Vault lane: `test_vault/test vault` only.** Its real path is
   `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault` — it lives in the **main
   checkout**, not this worktree. A `Remote Vault` window was open on this machine as of the last
   session, so pin every CLI call with `vault="test vault"` and assert
   `app.vault.getName() === "test vault"` before you measure or write anything.
   Install with:
   `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`
2. **Cover these specifically** — they are where the risk actually is:
   - Approve one proposal, then dismiss the rest. Confirm the count in the row name and in the sheet
     title both track.
   - Decline the confirm three ways — **Keep**, Escape, click outside — and confirm the queue survives
     all three.
   - **The render-vs-live case.** Open Tag vocabulary, then let a Process or auto-run merge new
     proposals while the tab sits open, then press **Dismiss all**. Only the rendered ones may go.
     This is the P1 the cross-model peer found and it is the single most valuable thing to prove in a
     live vault, because the unit test proves the filter, not the real merge path.
   - Phone width, per the trap in step 3.
3. **The `is-phone` testing trap — read this before testing #346.** `app.emulateMobile(true)` at a
   desktop-width window resolves to **`is-tablet`** and the bug **does not reproduce**. You must
   shrink the Electron window:
   `require("electron").getCurrentWindow().setSize(390, 844)`, then assert
   `document.body.classList.contains("is-phone")`. Also note desktop settings opens in a **separate
   popout window** in 1.13.4, so `document.querySelector(".modal")` finds nothing in the main window —
   go through `app.setting.modalEl.ownerDocument`. On phone emulation there is no popout.
   The invariant to assert is **not** an absolute pixel number: it is that a fixed row's control right
   edge equals the plain toggle row's control right edge. That number moved between two runs
   (327 vs 343) for reasons nobody pinned down, while the equality held both times.
4. **Then flip PR #345 out of draft** and merge once checks pass. The body already has `Closes #342`,
   `Closes #346`, core user stories, an edge-case table, and the screenshot evidence — add the QA
   report link and tick the last Test-plan box, but only after it actually ran.
5. **After merge to `master`:** clear the STATUS.md row. **Do not cut a release** unless the user
   explicitly asks — humans pull via BRAT.

## Key files

- [`src/settings/settings.ts:1869`](src/settings/settings.ts:1869) — the proposed-tags block: the
  Approve loop, the `rendered` snapshot set, and the section-level destructive row.
- [`src/settings/settings.ts:1976`](src/settings/settings.ts:1976) — `confirmDismissProposedTags()`.
- [`src/settings/rows.ts:232`](src/settings/rows.ts:232) — `confirmSheet()`, the new shared primitive.
- [`styles.css:1912`](styles.css:1912) — the `.is-phone` block for #346, with the trap in its comment.
- [`test/settings.test.ts`](test/settings.test.ts) — the `tag vocabulary` describe; `proposedSection()`
  is the helper that makes the row-count assertion exact.
- [`test/settingsRows.test.ts`](test/settingsRows.test.ts) — the row-grammar repository guard, incl.
  the `new Setting(` budget of 5.
- `docs/qa/screenshots/342-proposed-tags/` — the five committed phone captures.

## Decisions & constraints

Do **not** relitigate these:

- **Per-tag dismissal is gone on purpose.** The rejected alternative (a `destinationRow` opening a
  dedicated proposals screen) is recorded in #342.
- **The row grammar was not weakened and must not be.** No two-action primitive. The grammar is right;
  it was applied mechanically to an inbox item, which was the actual mistake.
- **`Dismiss all` confirms — the user chose this explicitly.** Rationale: dismissal is near-permanent,
  because a processed capture carries a sentinel and is never classified twice.
- **`confirmWipeCloudCopy` was deliberately left un-refactored.** The user rejected routing it through
  the new `confirmSheet()`. It still has its own hand-rolled modal, and the two will drift. Leave it
  unless the user asks.
- **The cross-model peer's third finding was rejected on the merits** — a claimed read-modify-write
  race between Approve and Dismiss. Both handlers read and write synchronously before their first
  `await`, so they cannot interleave. Do not re-raise it.
- **#346 shipped the measured CSS override, not the elegant untested one.** Adding `mod-navigable`
  would need zero CSS but is unverified and would not cover the status row. Recorded in #346.
- **Button rows still stack full-width on phone.** That is Obsidian's native treatment of every
  settings button and is out of scope.
- **No lint exists in this repo.** `npx eslint` fails on missing config; there is no `lint` script.
  Verification is typecheck + build + vitest. Do not report lint as passing.
- **No AI attribution** in commits, PR bodies, or review replies.

## Open questions / blockers

- **No CI run has ever fired on this branch.** `gh pr checks 345` says "no checks reported" and
  `gh run list --branch fix/342-proposed-tags-dismiss-row` is empty, across several pushes. The
  repo-wide runner outage from earlier on 2026-08-06 **has cleared** (a `root tests` run succeeded at
  20:44Z), so this is something else — most likely the draft state or a `paths` filter on the
  workflow. `master` requires two checks (`test`, `test + build`) with `enforce_admins: true`, so
  **find out why before you promise a merge.** Flipping the PR out of draft may be all it takes.
- **`STATUS.md` will conflict at merge.** [PR #344](https://github.com/taihartman/obsidian-atoms/pull/344)
  also edits it. Keep both rows; never resolve by picking a side. Same for `versions.json` — re-derive
  from `master` at merge time.
- **Version 0.6.82 assumes nothing lands first.** Re-check `master` before merging.
- **#341 is still open and unclaimed** (extract the shared ack-version helper) if you want cheap
  follow-on work. **#343** (the `npm test` fixture deletion above) is the one actually worth fixing.

## Git state

- Branch `fix/342-proposed-tags-dismiss-row` (base `master`), pushed to `origin`.
- Base: `00f7946 Merge pull request #329 from taihartman/fix/consent-wording-parity`
- Last real commit: `0d315a2 fix(settings): keep a row's right edge on the row, on phones too`
- Diff since base: 18 files, +601/-28 (this doc's own update lands on top).
- **Worktree note:** the directory is named `obsidian_plugin-settings-row-grammar` but the branch is
  `fix/342-proposed-tags-dismiss-row` — leftover naming from an earlier feature. Harmless; do not
  move it.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch fix/342-proposed-tags-dismiss-row && git pull --ff-only
npm install
npm run build && npx vitest run
git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json
```

That last line is not optional — see the `npm test` warning at the top.

Then continue from **Next steps** above, starting at step 1.
