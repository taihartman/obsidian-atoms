---
handoff_date: 2026-08-06
branch: ci/root-suite-pr-gate
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/326
status: in-progress
---

# Handoff — #325 CI gate is green and waiting on the user; #304 has shipped

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Two things, one shipped and one nearly. **#304 (settings row grammar) is merged** — that work is
done. What remains is **#325**: the repo's root test suite had no `pull_request` gate, so plugin PRs
merged on a check scoped to `plus-service/` that never looked at them. [PR #326](https://github.com/taihartman/obsidian-atoms/pull/326)
fixes that and is green, rebased, and ready. **It is not yours to merge** — see Next steps.

## Current status

**Shipped and closed out — do not redo any of this:**

- **#304 merged** as `cb08567`, version **0.6.79**. Settings screen went 48 rows → 15 across 11
  implementation units, the full `ce-*` loop (`ce-work` → `ce-simplify-code` → `ce-code-review` →
  `ce-compound` → `world-class-qa` → `adversarial-qa`), and six review passes that found nine
  defects including a P0 renderer freeze and a money bug. Full record:
  `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md`.
- **#324 merged** as `5a1e34f` — cleared #304's STATUS row.
- **`STATUS.md` on master now shows only #307** (someone else's `www/**` work).

**In flight on this branch (3 commits ahead of `origin/master`, +197 lines, 3 files):**

- `.github/workflows/root-tests.yml` — new. `npm ci` → `npm test` → `npm run build` on
  `pull_request` and on `master`.
- `STATUS.md` — your #325 claim row.
- Two `docs/solutions/` entries (see Key files).
- **PR #326 is OPEN, `MERGEABLE`, `CLEAN`.** Both checks pass: `test + build` 46s, `test` 37s.
- Local `npm test` = **1228 passing**, `npm run build` clean.

**Another session holds #320 (multi-device sessions) and #323.** They are in `plus-service/` and
`src/settings/`; no overlap with `.github/workflows/**`. They have asked for #326 to land before they
open their #320 draft.

## Next steps

1. **Ask the user whether to merge #326, and do not merge it unilaterally.** It is green and ready,
   and the other session has asked for it first — but a peer's sequencing request is not the repo
   owner's merge authorization, and this session already told the user it would leave the decision
   with them. Surface it as a one-word decision; do not re-argue it.
2. **Remind the user of the required-check flip.** Merging #326 does *not* close the gap. Until
   someone with repo admin adds `test + build` to the required set (Settings → Branches → require
   status checks on `master`), the workflow reports without blocking — which is the advisory failure
   mode `docs/solutions/architecture-patterns/a-green-check-about-a-different-subtree.md` explicitly
   names. Saying "the CI gap is fixed" after merging #326 alone would be wrong.
3. **Surface the release decision for 0.6.79.** Still unresolved. This session's recommendation,
   unchanged: **beta first**, because the change touches consent gates and six review passes found
   nine defects in it, two severe. Master's automation already cuts betas (`0.6.78-beta.1` was cut by
   `github-actions[bot]` from `release.yml` on a version tag). **Do not cut a release unless the user
   asks** — that is a hard project rule.
4. **After #326 merges:** clear its #325 row from `STATUS.md` on a small branch + PR, exactly as
   #324 did for #304. That is the project's mandated post-merge step.

## Key files

- `.github/workflows/root-tests.yml` — the fix. Its header comment carries the reasoning; keep it if
  you edit the file.
- `.github/workflows/plus-service-tests.yml:22` — `on: pull_request`, but `working-directory:
  plus-service`. This is the check that was green on every plugin PR.
- `.github/workflows/release.yml:8` — `on: push: tags:` only. This is where root `npm test` /
  `npm run build` lived, and why failures first appeared at release time.
- `docs/solutions/architecture-patterns/a-green-check-about-a-different-subtree.md` — the learning.
  Distinct from its two neighbours: the check *can* fail and *does* report honestly; it is simply
  wired to a subtree the diff never touched.
- `docs/solutions/logic-errors/an-obsidian-component-is-a-thenable.md` — the #304 P0. Every Obsidian
  component is a thenable, so a concise arrow returning one into a promise chain starves the
  microtask queue. **Read this before touching `src/settings/rows.ts`.**
- `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md` — the #304 QA record.

## Decisions & constraints

Do **not** relitigate any of these.

- **No `paths:` filter on `root-tests.yml`.** Decided by the user. A scoping assumption created this
  bug; `src/**` would rebuild it one level down, because `pretest` runs `build:www` and the suite
  legitimately spans plugin *and* `www/`.
- **`npm run build` is a separate step**, not folded into the tests — a typecheck-only failure has the
  identical tag-time-only hole.
- **Releases only when the user explicitly asks.** Hard project rule in `CLAUDE.md`.
- **Vault lanes.** Dogfood only in `test_vault/test vault` or `docs/media/demo-vault/`. **Never**
  touch `~/Documents/Remote Vault` — it is real personal data and it is open in the same Obsidian
  instance.
- **Never add AI attribution** to commits, PR bodies, or review replies.
- **Stay out of `src/settings/`** beyond what the other session's Account row needs — #320 and #323
  are theirs.

## Open questions / blockers

- **#323 — cross-device consent divergence. Unproven, and the highest-value open risk.** The Ask
  acknowledgments live in `data.json` (Obsidian Sync replicates it) while `plugin.settings` is read
  once at load, so withdrawing consent on one device may leave another still mirroring under a
  revoked consent. Needs a two-device rig. **Owned by the other session**, who will have the rig for
  #320. If it holds it is a live consent bypass on already-shipped code, and it bears on the 0.6.79
  release channel decision.
- The three decisions in Next steps 1–3 are all the user's, not yours.

## Housekeeping wart — read before staging anything

This worktree has two **untracked** paths that are **not part of this work**: `.gitattributes` and
`.opencode/`. They arrived when an earlier session accidentally popped an unrelated user stash, and
they were deliberately left uncommitted.

**Do not `git add -A` in this worktree.** Stage explicit paths. The user's original stash
(`stash@{0}`, *"On master: wip graphify+process docs"*) is intact and must stay that way.

## Git state

- Branch `ci/root-suite-pr-gate` (base `master`), pushed to `origin`, tracked by **PR #326**.
- This is a **linked worktree** on the shared `obsidian_plugin` git dir — it already exists, reuse it.
- Commits ahead of `origin/master` (3):
  - `a6f7b0c docs(solutions): name the advisory-gate trap in the green-check doc`
  - `9d0ce73 docs(solutions): compound the green-check-wrong-subtree variant`
  - `60a5d83 ci: gate the root suite on pull_request`
- Recently merged to master: `5a1e34f` (#324), `cb08567` (#304).
- Diff vs `origin/master`: 3 files, +197 / -0.
- WIP snapshot commit: `88f75e9` — `wip: handoff snapshot — ci-root-suite-pr-gate`

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch ci/root-suite-pr-gate && git pull --ff-only
npm install
npm test
```

Then continue from **Next steps** above — step 1 is asking the user about merging #326.
