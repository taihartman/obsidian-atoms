---
handoff_date: 2026-08-06
branch: fix/342-proposed-tags-dismiss-row
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/342
status: in-progress
---

# Handoff — #342: each proposed tag renders a whole second row just for Dismiss

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

> **Do not `git add -A` in this worktree.** It carries two untracked paths — `.gitattributes` and
> `.opencode/` — that are **not part of this work**, left from an unrelated stash pop long ago.
> Stage explicit paths, always.

## Goal

In Settings → Atoms → Tag vocabulary, every proposed tag renders **two** full-width setting cards:
one carrying `#tag` + an **Approve** button, and a second whose entire content is the name
`Dismiss #tag` and a **Dismiss** button. The second row's name is its own button label. Three
proposed tags means six cards. Fix it so the section reads like a review queue instead of a
grammar exercise.

## Current status

**Nothing is implemented yet.** This branch is `master` (0.6.81) plus this doc. The diagnosis below
is complete and was verified against live code — do not re-derive it.

The split is deliberate, and the reason is in the code at
[`src/settings/settings.ts:1862`](src/settings/settings.ts:1862): *"Approve and dismiss were two
buttons on one row; same split, same reason as above."* #304's row grammar says no row wears two
kinds and each row gets one right edge. Approve is an `action` (accent button); Dismiss is
`destructive` (warning button). Two kinds, so they were split.

**That precedent is not the same case.** The split it points at (a text field + an Add button, a few
lines above) preserved two genuinely different affordances — splitting *kept both* rather than
dropping one. Here both rows act on the same object and the second carries no information. The rule
was applied mechanically to a surface that is not really a setting: a proposed tag is an **inbox
item**. "One right edge" is a settings-row rule.

It also was not much of a choice. The primitives in
[`src/settings/rows.ts`](src/settings/rows.ts) are `settingRow`, `destinationRow`, `backRow`,
`actionRow`, `destructiveRow`, `statusRow` — **none carries two actions**.

## Next steps

1. **Claim it first — this repo requires a hard claim before implementation** (`docs/collab.md`):
   assign yourself [#342](https://github.com/taihartman/obsidian-atoms/issues/342), add a
   `STATUS.md` in-flight row, and open a **draft** PR. Only then write code.
   **Watch for a conflict:** [PR #344](https://github.com/taihartman/obsidian-atoms/pull/344) also
   edits `STATUS.md` (it clears #329's row) and is blocked on CI. Add your row without disturbing
   its edit, and expect to resolve a `STATUS.md` conflict at merge — keep both rows, never pick a
   side.
2. **Implement option A** (decided — see Decisions): delete the per-tag `destructiveRow` at
   [`src/settings/settings.ts:1880`](src/settings/settings.ts:1880) and add a single section-level
   `destructiveRow` — "Dismiss all proposed" — after the loop. The Approve row keeps its existing
   `desc` ("From classify runs — not applied until approved").
   Consider adding a `dismissAllProposedTags` (or similar) helper next to `approveProposedTag` in
   [`src/pipeline/vocabulary.ts:73`](src/pipeline/vocabulary.ts:73) rather than clearing the array
   inline, so the logic is unit-testable the way approval already is.
3. **Add the tests that do not exist yet.** `approveProposedTag` is covered at
   [`test/context.test.ts:235`](test/context.test.ts:235), but **nothing tests the proposed-tag rows
   themselves** — no row-count assertion, no dismiss assertion. Use the `settingTab` helpers in
   `test/helpers/settingsTab.ts` (see `test/consentGate.adversarial.test.ts` for the idiom:
   `settingTab({...})`, `rowNames(tab)`, `press(tab, name, label)`). At minimum: N proposed tags
   render N rows plus one dismiss-all row, Approve moves a tag to active, dismiss-all empties the
   queue and the section disappears.
4. **Bump the version** — `manifest.json`, `package.json`, `versions.json`. Master is **0.6.81**, so
   this takes **0.6.82** unless someone lands first. Re-derive from `master` at merge time; never
   resolve a version conflict by picking a side.
5. **Shipping tail**: `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa`
   (ending in its `adversarial-qa` gate). This is an amend-lane change, so scope QA to the changed
   surface — but the tail itself is not optional.
6. **PR body** needs `Closes #342`, distilled Core user stories, Edge cases & testing, and — because
   this is UI — **screenshots** committed under `docs/qa/screenshots/342-proposed-tags/` and linked
   with absolute `https://raw.githubusercontent.com/taihartman/obsidian-atoms/fix/342-proposed-tags-dismiss-row/…`
   URLs. Repo-relative image paths render broken in PR descriptions.

## Key files

- [`src/settings/settings.ts:1857-1894`](src/settings/settings.ts:1857) — the whole proposed-tags
  block. `:1863` is the Approve `actionRow`, `:1880` is the `destructiveRow` to delete, `:1860` is
  the `settingHeading("Proposed (approve to activate)")`.
- [`src/settings/rows.ts`](src/settings/rows.ts) — the six row primitives. None takes two actions;
  that constraint is the reason the bug exists.
- [`src/pipeline/vocabulary.ts:73`](src/pipeline/vocabulary.ts:73) — `approveProposedTag`. The
  dismiss counterpart does not exist; dismissal is currently an inline `.filter()` in `settings.ts`.
- [`test/context.test.ts:225-240`](test/context.test.ts:225) — existing vocabulary unit tests.
- `CONCEPTS.md` → **Row grammar (settings)** — the rule you are working within. Read it before
  arguing with it.

## Decisions & constraints

Do **not** relitigate these:

- **Option A is chosen**: drop the per-tag Dismiss row; move dismissal to one section-level
  "Dismiss all proposed" destructive row. Rationale: an unapproved tag is **already inert** — it is
  never applied until approved — so per-tag dismissal buys very little for doubling the section's
  height. The rejected alternative (make the section a `destinationRow`, `Proposed tags — 3 waiting ›`,
  with its own screen) is recorded in #342 if option A turns out badly, but start with A.
- **Do not weaken the row grammar to fix this.** Do not add a two-action primitive. The grammar is
  right; this surface was the wrong thing to apply it to mechanically.
- **Amend lane** — one file of real logic, no model widening, no security surface. No
  `ce-brainstorm` / `ce-plan` / `ce-doc-review`. It **auto-escalates** to the full loop if it grows
  past that.
- **Vault lanes:** dogfood in `test_vault/test vault` only (its real path is
  `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault` — it lives in the **main
  checkout**, not this worktree). **Never** `~/Documents/Remote Vault`.
  Install with `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`.
- **No AI attribution** in commits, PR bodies, or review replies.
- **Releases only when the user explicitly asks.**
- **No lint exists in this repo** — `npx eslint` fails on missing config, there is no `lint` script.
  Verification is typecheck + build + vitest. Do not report lint as passing.

## Open questions / blockers

- **CI cannot run — this is the big one.** GitHub has failed to allocate a hosted runner for this
  repo since ~15:20 on 2026-08-06. Five consecutive rounds queued and were cancelled with
  `The job was not acquired by Runner of type hosted even after multiple attempts`; one rerun sat
  queued 1h35m untouched. `master` requires two checks (`test`, `test + build`) with
  `enforce_admins: true`, so **no PR can merge normally until this clears.**
  The user was asked to check github.com/settings/billing for a spending cap — the signature fits
  one exactly. **Check whether that was resolved before you promise a merge.**
  #329 was merged on 2026-08-06 by temporarily clearing the two required contexts and restoring them
  immediately (verified byte-identical afterwards) — that was an explicit one-off user decision.
  **Do not repeat that bypass on your own initiative.** Ask.
- **Two unrelated issues are open and unclaimed** if you want cheap follow-on work:
  [#341](https://github.com/taihartman/obsidian-atoms/issues/341) (extract the shared ack-version
  helper) and [#343](https://github.com/taihartman/obsidian-atoms/issues/343) (`npm test` deletes
  `docs/field-notes/published/2026-08-01-sample-loop.json` — a real footgun, easy to sweep into an
  unrelated commit).

## Git state

- Branch `fix/342-proposed-tags-dismiss-row`, cut from `origin/master` at `00f7946`, pushed to
  `origin`. No code changes yet.
- Last real commit on base: `00f7946 Merge pull request #329 from taihartman/fix/consent-wording-parity`
- WIP snapshot commit: `2d6d698 wip: handoff snapshot — proposed-tags-dismiss-row` (this doc only;
  no code). The tip will differ by one amend that backfilled this SHA.
- Diff since base: this doc only.
- **Worktree note:** the directory is named `obsidian_plugin-settings-row-grammar` but the branch is
  `fix/342-proposed-tags-dismiss-row` — leftover naming from an earlier feature. Harmless; do not
  move it.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch fix/342-proposed-tags-dismiss-row && git pull --ff-only
npm install
npm run build && npm test
```

Then continue from **Next steps** above — start with step 1, the hard claim.
