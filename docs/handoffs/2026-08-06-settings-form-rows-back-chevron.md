---
handoff_date: 2026-08-06
branch: claude/settings-form-rows-back-chevron
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: none yet — you file the issues (see Next steps 2). Related: https://github.com/taihartman/obsidian-atoms/pull/345
status: in-progress
---

# Handoff — a field and its button are one row; the back chevron sits at the leading edge

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

> **Do not `git add -A` in this worktree.** It carries two untracked paths — `.gitattributes` and
> `.opencode/` — that are **not part of this work**, left from an unrelated stash pop long ago.
> Stage explicit paths, always. (The `/handoff` skill's template says `git add -A`; this repo
> overrides it.)

> **`npm test` deletes `docs/field-notes/published/2026-08-01-sample-loop.json`.** That is
> [#343](https://github.com/taihartman/obsidian-atoms/issues/343), a real open footgun. Prefer
> `npx vitest run`, which does not (it skips the `pretest` hook). If you do run `npm test`,
> `git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json` before staging anything.

## Goal

The user looked at Settings → Atoms → **Account** on a phone and reported two things. You are fixing
both, on this branch:

1. **The back row's chevron is not lined up with anything** — it floats mid-row instead of sitting at
   the row's leading edge.
2. **The account screen is all separated** — `Start free trial` is its own card away from the Email
   field, `Send sign-in link` away from its field, `Save session` away from its field. Their explicit
   ask: *"we should create some common components for these buttons so that doesn't occur in the
   future."*

**Your plan is already written and it is the authority for this work:**
[`docs/plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md`](../plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md).
It is committed on this branch. Read it after this file — it carries the measurements, the KTDs, and
the unit breakdown. Do not re-derive any of it.

## Current status

**Nothing is implemented.** This branch holds the plan and this handoff, and nothing else. It is cut
from `origin/master` at `00f7946`.

What *is* done, and what you must not redo:

- **The live investigation.** Both complaints were measured in `test vault` on plugin 0.6.82 /
  Obsidian 1.13.4, at phone 390×844 with `is-phone` asserted and at desktop. Numbers are in the plan.
- **The back chevron is diagnosed.** Obsidian's `.setting-item-control` is `flex: 1 1 auto` with
  `justify-content: flex-end`; in the `row-reverse` back row it grows to fill and parks its 28px
  chevron at the far end of the grown box — **104px in on phone, 236px in on desktop**. It is
  **pre-existing and cross-platform**, not a #346 regression: #346 fixed the *axis* (the chevron used
  to sit below the name), never how far in it sits. The fix belongs in the **base**
  `.atoms-setting-back` rule, not the `.is-phone` block.
- **The split rows are diagnosed, and there are four pairs, not three.** The fourth is
  `Add a custom tag` / `Add to Active` on Tag vocabulary. The code already admits the cause at
  [`src/settings/settings.ts:1832`](../../src/settings/settings.ts:1832): *"Field and button were one
  row, which the grammar allows only one right edge for."* 8 rows → 4.
- **The primitive is designed** — `formRow`, a sixth row kind in `src/settings/rows.ts`. See KTD1.

## Next steps

1. **Check whether [PR #345](https://github.com/taihartman/obsidian-atoms/pull/345) merged, and
   finish it if not.** It is the immediately blocking dependency — it touches
   `src/settings/rows.ts`, `src/settings/settings.ts`, `styles.css`, `test/settingsRows.test.ts` and
   `docs/qa/app-navigation-map.md`, which is **all** of this plan's surface. See
   **PR #345 — what is left** below; the CI situation there is the one thing that may genuinely be
   blocked. If it is still blocked, do everything in step 2 onward that does not touch those files,
   and say so.
2. **Claim the work** per [`docs/collab.md`](../collab.md) — hard claim before any implementation.
   File **two** GitHub Issues (form row; back chevron), add a `STATUS.md` row, and open a **draft
   PR**. Two issues on one branch is the shape #342 + #346 used and it worked well. The user was
   asked to confirm this and to confirm KTD3 (dropping the duplicated row names) and had not answered
   before the session ended — if they still have not, **proceed with two issues and with KTD3**, and
   flag both in the PR body as decisions taken rather than blocking on them.
3. **Light `ce-doc-review`** on the plan (`mode:headless`, coherence + feasibility, add the design
   lens since UI moves) — the repo's plan quality gate requires it before `ce-work`. The plan was
   written but never reviewed.
4. **`ce-work` the units** U1–U5 in the plan. Dispatch implementation units to `impl-worker`
   (Opus 5, medium effort) per the standing model policy.
5. **Shipping tail, in full:** `ce-simplify-code` → `ce-code-review` (cross-model peer is **grok**,
   not codex — see the note under Decisions) → `ce-compound` → `world-class-qa` ending in its
   `adversarial-qa` gate → PR with `Closes #<n>` for both issues, core user stories, edge-case table,
   and phone screenshots under `docs/qa/screenshots/<feature>/` linked by **absolute**
   `raw.githubusercontent.com` URLs.

## PR #345 — what is left

Not your feature, but it blocks yours and it is nearly done. Branch
`fix/342-proposed-tags-dismiss-row`, fully pushed, **out of draft**, version 0.6.82.

- **Everything is finished except the merge.** `world-class-qa` ran (ten stories, desktop + real
  390×844 phone width) and ended in `adversarial-qa` (fourteen scenarios). Report:
  [`docs/qa/2026-08-06-342-proposed-tags-world-class-qa.md`](../qa/2026-08-06-342-proposed-tags-world-class-qa.md)
  — **on that branch, not this one.** One hole was found and fixed there (`582a928`: the row counted
  the raw stored array while the confirm counted the normalized set it dismisses). Build clean,
  1281 tests pass.
- **CI is the blocker, and it is not this branch's fault.** `root tests` and `plus-service tests`
  both went **green on `a0c7665`**, but nothing has fired for the four commits since — `gh pr checks
  345` still says "no checks reported", and flipping out of draft did not wake it. It is not the
  workflow config (`root-tests.yml` has no `paths:` filter and runs on `pull_request`). Something
  upstream is wedged: `fix/consent-wording-parity` has runs sitting **queued for 2h21m**. Suspect
  Actions minutes / billing on the repo. `master` requires two checks with `enforce_admins: true`,
  so **do not promise a merge until checks actually report.** Tell the user if it is still stuck.
- **After it merges:** clear the `STATUS.md` row, then rebase this branch onto the new `master`.
  Do **not** cut a release unless the user asks — humans pull via BRAT.
- **One open item on #345, non-blocking and the user's call:** finding **H2** in that QA report. The
  dismiss sheet says tags "will not be offered again", but a dismissed tag that is *also used in the
  vault* still appears one section down under **Found in your vault** with an Activate button. The
  behaviour is right; only the word "offered" over-reaches. "Will not come back" would be exactly
  true. Left unchanged deliberately — it is a voice call.

## Key files

- [`docs/plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md`](../plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md)
  — **your authority.** Measurements, KTD1–KTD5, units U1–U5, risks.
- `src/settings/rows.ts` — the row grammar and its five kinds; `formRow` is the sixth. The
  doc-comment table at the top of the file must gain its row. `InFlightActions` and `ButtonRowSpec`
  are what `formRow`'s submit half composes; do not reimplement the in-flight guard.
- `src/settings/settings.ts:1199`, `:1216`, `:1245` — the three account pairs (field row then button
  row). `:1834` — the fourth pair, `Add a custom tag` / `Add to Active`, on Tag vocabulary.
- `src/settings/settings.ts` — `accountInput(containerEl, key)` and the three
  `inputEl.dataset.plusEmail` / `plusMagicEmail` / `plusSession` markers. **All of this deletes**
  once `formRow`'s `onSubmit` receives the value directly.
- `styles.css` — the `.atoms-setting-back` block, and the `.is-phone` block added by #346 (whose
  comment carries the `is-phone` vs `is-tablet` testing trap).
- `test/settingsRows.test.ts` — the row-grammar repository guard, including the direct `new Setting(`
  budget of 5. Grow it a `formRow` case; never weaken it.
- `docs/qa/app-navigation-map.md` — the Account destination row list changes when 8 rows become 4.
  Heal that row in the same PR.

## Decisions & constraints

Do **not** relitigate these:

- **`formRow` is a sixth row kind, not a `button` flag on `settingRow`.** A field and the one button
  that commits it is *one* grammar — the button is meaningless without the field beside it. An
  optional `button` on the shared preference row is the god-widget the user's standing rule forbids,
  and is one PR from a button on a toggle row. Compose; do not configure.
- **The back-chevron fix goes in the base rule, not `.is-phone`.** Desktop has the same 236px gutter.
- **Not every adjacent settingRow/actionRow is a pair.** `Device-local key fallback` (toggle) beside
  `Device-local API key` (commits on change, no button), and `Sync when you return to Obsidian`
  beside `Sync everything now` (an unrelated action), are correctly separate. Four pairs only.
- **`Skip the API key` / `See plans` stays a plain `actionRow`** — a real standalone action with no
  field.
- **The row grammar is not being weakened.** #304 established it and #342 reaffirmed it. You are
  naming a grammar it never had a kind for, not adding a two-action row.
- **Shared substrate ⇒ pay the blast-radius tax in the same change** (the user's standing rule):
  `formRow` ships with full state coverage — empty value, whitespace-only, in-flight double-tap,
  redisplay mid-flight, password-typed fields.
- **`startTrial` / `sendPlusMagicLink` / `savePastedSession` are money and identity paths.** Moving
  where the string comes from is the whole change; keep each one's existing validation and Notice
  copy verbatim.
- **Cross-model peer is grok, not codex** (codex is a broken install on this machine). Create
  `.compound-engineering/config.local.yaml` with `cross_model_peer: grok` in this worktree if it is
  absent, and gitignore it.
- **No AI attribution** in commits, PR bodies, or review replies.
- **Vault lane: `test vault` only** — `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault`,
  which lives in the **main checkout**, not this worktree. Pin every CLI call with
  `vault="test vault"` and assert `app.vault.getName() === "test vault"` before measuring or writing.
  Install with
  `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`.

## Driving Obsidian — facts this session paid for

These are committed on the #345 branch's `docs/qa/app-navigation-map.md` but **not on this branch
yet**, so they are repeated here:

- **Desktop Settings opens in a separate popout window** in 1.13.4.
  `document.querySelector(".modal")` in the main window finds nothing — go through
  `app.setting.modalEl.ownerDocument`.
- **On phone there is no popout:** the settings tab *is* a `.modal-container .modal` in the main
  document, so a sheet opened from it is the **second** modal. Select it with
  `[...doc.querySelectorAll(".modal-container .modal")].find((m) => m !== app.setting.modalEl)`,
  never `querySelector`.
- **`dev:screenshot` captures the main window only**, so desktop settings cannot be screenshotted
  this way — take settings frames at phone width. Its `path=` is **vault-relative**: write into the
  vault, then copy out.
- **Reaching `is-phone`:** `app.emulateMobile(true)` at a desktop-width window resolves to
  **`is-tablet`**, where these bugs do not reproduce. Do `emulateMobile(true)`, wait ~6s for the app
  to reload, then
  `require("@electron/remote").getCurrentWindow()` → `unmaximize()` → `setSize(390, 844)`, and assert
  `document.body.classList.contains("is-phone")`. Calling `emulateMobile` a second time toggles it
  back **off** and reloads; `eval` briefly answers "command not found" while it does.
- **Measure geometry a beat after `app.setting.open()`** — rects read in the same call are
  pre-layout and will lie to you (a 390-wide modal reported a 733px control edge).
- Long `eval` payloads: write the JS to a file and pass `code="$(cat file)"`.

## Open questions / blockers

- **Two issues or one, and KTD3.** The user was asked and had not answered. Default recorded in
  Next step 2: two issues, one branch, and drop the duplicated row names.
- **PR #345's CI.** Genuinely blocked from this side; likely repo-level Actions billing/runner.

## Git state

- Branch `claude/settings-form-rows-back-chevron` (base `master`), pushed to `origin`.
- Base: `00f7946 Merge pull request #329 from taihartman/fix/consent-wording-parity`
- WIP snapshot commit: `797c88e` — `wip: handoff snapshot — settings-form-rows-back-chevron`
- Diff since base: 2 files, +309/-0 (the plan and this doc).
- **Separately:** `fix/342-proposed-tags-dismiss-row` is pushed at
  `e5a86fc docs(handoff): #342 QA gate cleared; merge is what is left`, out of draft as PR #345,
  awaiting CI. Nothing there is uncommitted.
- **Worktree note:** the directory is named `obsidian_plugin-settings-row-grammar` — leftover naming
  from an earlier feature, and it now holds a third branch. Harmless; do not move it.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch claude/settings-form-rows-back-chevron && git pull --ff-only
npm install
npm run build && npx vitest run
```

Then continue from **Next steps** above, starting at step 1.
