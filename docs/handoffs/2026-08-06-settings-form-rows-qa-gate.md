---
handoff_date: 2026-08-06
branch: claude/settings-form-rows-back-chevron
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: fix/342-proposed-tags-dismiss-row (stacked — see below)
tracking: https://github.com/taihartman/obsidian-atoms/issues/347 · https://github.com/taihartman/obsidian-atoms/issues/348 · https://github.com/taihartman/obsidian-atoms/pull/349
status: code complete; QA is the only gate left
---

# Handoff — #347 + #348 code is done; world-class-qa is what remains

Read this top to bottom, run **How to resume**, then start at **Next steps 1**. Do not re-plan what
the plan already decided and do not summarize this back to the user — just work.

> **Do not `git add -A` in this worktree.** It carries two untracked paths — `.gitattributes` and
> `.opencode/` — that are **not part of this work**. Stage explicit paths, always.

> **Do not run `npm test`.** Its `pretest` hook deletes
> `docs/field-notes/published/2026-08-01-sample-loop.json` ([#343](https://github.com/taihartman/obsidian-atoms/issues/343)).
> Use `npx vitest run`. **New this session:** `npx vitest run` *and* `npm run build` delete that
> fixture too — the `build:www` step does it, so it is not only the `pretest` hook. #343 is wider
> than it is written. Restore with `git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json`
> before staging anything.

## What shipped

Both of the user's complaints, fixed. Plan (the authority, and now corrected):
[`docs/plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md`](../plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md).

Six commits, `5cb1cff..c605a3d`, all pushed. Version **0.6.83**. Build clean, **1298 tests pass**.

| Commit | What |
|---|---|
| `5cb1cff` | `formRow` — a sixth row kind. Extracted `addGuardedButton` so `buttonRow`/`actionRow`/`destructiveRow`/`formRow` share **one** in-flight guard |
| `aa9061d` | Back chevron moves to the row's leading edge (base rule, not `.is-phone`); form row's phone width rule |
| `127b246` | Three Account pairs → three rows; `accountInput` and the three `dataset.plus*` markers **deleted** |
| `2f635a9` | Tag vocabulary's fourth pair → one row; `customTagDraft` **kept** |
| `d7b3729` | 0.6.83 + `docs/qa/app-navigation-map.md` healed |
| `a812264` | Simplify pass: `FormRowSpec` exported beside `ButtonRowSpec`; the duplicated email refusal became `requireEmail()` |
| `c605a3d` | Compound: `docs/solutions/architecture-patterns/a-rule-that-keeps-producing-an-ugly-shape-is-missing-a-kind.md` + `CONCEPTS.md` |

## Shipping tail — where it stands

- ✅ **`ce-doc-review`** (headless; coherence + feasibility + design). Found six real errors in the
  plan; all folded in at `28958b0`. It is why the trim, the class hook, and `customTagDraft` survived.
- ✅ **`ce-simplify-code`** — `a812264`.
- ✅ **`ce-code-review`** — clean, no findings. Plus a separate adversarial pass that diffed the money
  and identity paths against `5cb1cff~1` and confirmed **every Notice string and every validation is
  byte-identical**, the trim survives on all four call sites, and no side effect crossed a validation
  boundary.
- ✅ **`ce-compound`** — `c605a3d`.
- ❌ **`world-class-qa` + its `adversarial-qa` gate — NOT RUN. This is your job.**
- ❌ **Cross-model peer (grok) — NOT RUN.** See Next steps 2.

## Next steps

1. **`world-class-qa`, ending in `adversarial-qa`.** This is the merge gate and the reason this
   handoff exists — it needs live Obsidian, which is too tool-dense for the session that wrote the
   code. Vault lane is **`test vault` only**:
   `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault` — it lives in the **main
   checkout**, not this worktree. Pin every CLI call with `vault="test vault"` and assert
   `app.vault.getName() === "test vault"` before measuring or writing. Install with
   `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`.

   What must be proven, beyond the happy path:
   - All four pairs render as **one card** — three on Account, one on Tag vocabulary.
   - **The back chevron's left edge equals the row's content-box left edge, at phone 390 AND at
     desktop.** Same invariant #346 used. Desktop A/B: every other row unmoved.
   - The merged control at **desktop** width — the field and button share one control box for the
     first time, which is the exact shape that once squeezed the reset-icon input to ~54px.
   - **Type-then-toggle on Tag vocabulary:** type a partial tag, toggle another tag off, confirm the
     draft survives. There is a unit test, but see it live.
   - Adversarial: in-flight double-tap on each of the three account buttons; whitespace-padded
     `sess_…` token; an email without `@`; a redisplay landing mid-request.

2. **Cross-model peer pass (grok), on a tight brief.** `ce-code-review` ran in-process only. If you
   run the peer, **name the two or three files that matter** (`src/settings/rows.ts`,
   `src/settings/settings.ts`) rather than pointing it at the diff — the standing note is explicit
   that the grok route is all-or-nothing and a 57KB diff burns the whole turn discovering nothing.
   `.compound-engineering/config.local.yaml` with `cross_model_peer: grok` already exists in this
   worktree (gitignored). Do **not** raise `CROSS_MODEL_HARD_SECS`.

3. **Finish the PR body and take #349 out of draft.** The **Core user stories** and **Edge cases &
   testing** sections are placeholders awaiting the QA pass, and every Test-plan checkbox is still
   unchecked — tick them only against real evidence. Phone screenshots go under
   `docs/qa/screenshots/settings-form-rows/` and are linked by **absolute**
   `https://raw.githubusercontent.com/taihartman/obsidian-atoms/claude/settings-form-rows-back-chevron/…`
   URLs; repo-relative paths render as a broken icon in a PR description.

4. **After #345 merges:** `git rebase origin/master`, force-push with lease. GitHub retargets #349 to
   `master` on its own. Then clear the `STATUS.md` rows.

## The two blockers that are the user's, not yours

- **PR #345's CI is dead and it is repo-level.** No workflow run has been created for **any** commit
  after `a0c7665`. I pushed a commit to that branch (a `synchronize` event) and nothing fired;
  `gh pr checks 345` still reports nothing. It is not the workflow config — `root-tests.yml`
  deliberately carries no `paths:` filter. Earlier runs on `fix/consent-wording-parity` sat queued
  for 2h46m. This reads as Actions minutes / billing on the repo and needs the owner. `master`
  requires two checks with `enforce_admins: true`, so **#345 cannot merge until that is fixed** —
  and therefore neither can this. Do not promise a merge date.
- **Because of that, this branch is stacked**, not cut from `master`. #345 touches all four of this
  work's files, so building on `master` meant conflicts on every one. PR #349's base is
  `fix/342-proposed-tags-dismiss-row`.

## Decisions taken rather than blocked on

The user was asked and had not answered. All four are recorded in the plan's *Decisions taken* section
and flagged in PR #349's body as decisions, so any of them reverses cheaply before merge.

1. **Two issues, one branch** — #347 (form row), #348 (back chevron).
2. **KTD3 goes ahead** — three duplicated row names deleted.
3. **In flight, the button is guarded and the field stays editable** — a user who mistyped can fix it
   while a request is out.
4. **A typed email is not preserved across `startTrial`'s `redisplay()`** — it is not preserved today
   either. `customTagDraft` is the exception, and only because it already worked that way.

Also still open, unrelated, from #345's QA: the **H2** copy nuance on the dismiss sheet ("will not be
offered again" vs "will not come back"). The behaviour is right; only the word over-reaches. It is a
voice call and it is the user's.

## Driving Obsidian — facts already paid for

- **Desktop Settings opens in a separate popout window** in 1.13.4. `document.querySelector(".modal")`
  in the main window finds nothing — go through `app.setting.modalEl.ownerDocument`.
- **On phone there is no popout:** the settings tab *is* a `.modal-container .modal` in the main
  document, so a sheet opened from it is the **second** modal. Select it with
  `[...doc.querySelectorAll(".modal-container .modal")].find((m) => m !== app.setting.modalEl)`,
  never `querySelector`.
- **`dev:screenshot` captures the main window only**, so desktop settings cannot be screenshotted that
  way — take settings frames at phone width. Its `path=` is **vault-relative**: write into the vault,
  then copy out.
- **Reaching `is-phone`:** `app.emulateMobile(true)` at desktop width resolves to **`is-tablet`**,
  where these bugs do not reproduce. Do `emulateMobile(true)`, wait ~6s for the reload, then
  `require("@electron/remote").getCurrentWindow()` → `unmaximize()` → `setSize(390, 844)`, and assert
  `document.body.classList.contains("is-phone")`. Calling `emulateMobile` again toggles it back off.
- **Measure geometry a beat after `app.setting.open()`** — rects read in the same call are pre-layout
  and will lie (a 390-wide modal once reported a 733px control edge).
- Long `eval` payloads: write the JS to a file and pass `code="$(cat file)"`.
- **New:** the installed Obsidian's phone stacking gate is really
  `:not(:is(.mod-toggle, .setting-item-heading))` — narrower than the
  `:not(:is(.mod-toggle, .mod-navigable, .mod-action, .setting-item-heading))` that `styles.css` and
  the plan both quote. Conclusion unchanged (form rows carry neither, so they stack), but the comment
  in `styles.css` is wrong and someone may want to reconcile it. Verified by unpacking `app.css` from
  `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` — which is also how the chevron
  specificity question got settled, and is the cheapest way to answer any "does Obsidian's own CSS
  set this property" question.

## Key files

- `src/settings/rows.ts` — the grammar, now six kinds. `formRow`, `FormRowSpec`, and
  `addGuardedButton` (the one in-flight guard — never fork it).
- `src/settings/settings.ts` — `renderSignedOutAccount` (three form rows),
  `renderVocabularyDestination` (the fourth), `requireEmail()`, the `this.formRow` wrapper.
- `styles.css` — the base `.atoms-setting-back` control rule and the `.is-phone`
  `.atoms-setting-form` rules.
- `test/settingsRows.test.ts` — the repository guard. `DIRECT_SETTING_BUDGET` is 5; never lower it.
- `test/settings.test.ts` — the Account and Tag vocabulary rows asserted as **exact lists**, so a
  regression that re-splits a pair fails.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch claude/settings-form-rows-back-chevron && git pull --ff-only
npm install
npm run build && npx vitest run   # expect 78 files / 1298 tests
git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json
```

Then start at **Next steps 1**.
