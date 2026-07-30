---
handoff_date: 2026-07-29
branch: claude/inbox-stuck-card-home-spacing-d5557d
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/inbox-stuck-card-home-spacing-d5557d
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/191
status: in-progress
---

# Handoff — Inbox self-healing, the stuck card, and home spacing

You are picking up this work in a fresh session. Read this file top to bottom, run
the **How to resume** commands to land on the right branch and worktree, then
**start executing Next steps immediately** — step 1 is your current task. Do not
ask the user what to work on and do not summarize this doc back to them; just
begin, and report what you did. Everything you need is below.

## Goal

The user's Atoms home showed **"4 captures need a fix"** with no explanation and
no way to act, the home header and card stack were visually cramped, and a
capture appeared to go missing. You are implementing the fix: the inbox
**self-heals** captures with bad timestamps instead of stranding them behind a
dead-end card, and the two spacing gaps get closed.

**Planning and doc-review are done.** Your job is implementation + the shipping
tail. The plan is authoritative and already survived a four-lens review — do not
re-plan it.

## Current status

- **Plan written and reviewed:** `docs/plans/2026-07-29-001-fix-inbox-stuck-card-and-home-spacing.md`.
  It is the implementation authority. Read it in full before coding — it decides
  every mechanic so you invent nothing.
- **`ce-doc-review` ran** (coherence · feasibility · design-lens · product-lens).
  All findings are folded into the plan. Two safe-auto fixes were applied. The
  review caught two 100%-confidence bugs that would otherwise have shipped — both
  are now specified in U3.
- **Hard claim is complete** (multiplayer process, `docs/collab.md`):
  Issue [#191](https://github.com/taihartman/obsidian-atoms/issues/191) created,
  `STATUS.md` row added. **A draft PR was NOT opened yet — that is your step 1.**
- **No source code has been written.** Only the plan + STATUS row exist.
- **Diagnosis is verified, not assumed.** Every claim in the plan was checked
  against live source and the live vault. The handoff question "why did the
  shortcut misbehave?" is **closed**: the user's shortcut was misconfigured during
  development, and `docs/capture-shortcut.md:55` and `:63-65` already document
  both exact traps they hit. Do not re-investigate this.
- **Two issues filed and deliberately deferred** — do not fix them here:
  [#190](https://github.com/taihartman/obsidian-atoms/issues/190) (substantive
  captures classified `noise`) and the two remaining honesty gaps inside
  [#177](https://github.com/taihartman/obsidian-atoms/issues/177).

## Next steps

1. **Push the branch and open a draft PR.** The project process requires a draft
   PR before implementation (`CLAUDE.md` → hard claim). Body should reference
   `Closes #191` and mention #177 (referenced, not closed).
2. **Implement U1 → U6 in order**, test-first, from the plan. Each unit's exact
   mechanics, file list, and test cases are already specified there. Use
   `subagent_type: "impl-worker"` for delegated units per the user's model policy
   (Opus 5 / medium effort — omit the Agent tool's `model` param so the pin wins).
3. **Run `./scripts/verify.sh`** with Obsidian open on the throwaway vault
   (`test_vault/test vault/`) and report the CLI output as evidence. Agents verify
   with the Obsidian CLI, not unit tests alone.
4. **Run the shipping tail, all of it:** `ce-simplify-code` → `ce-code-review` →
   `ce-compound` → `world-class-qa` (which must end with `adversarial-qa`).
5. **Finish the PR body:** `Closes #191`, real Test-plan checkboxes (only tick what
   actually ran), Core user stories, Edge cases & testing, and **vault
   screenshots** of the home surface before/after — committed under
   `docs/qa/screenshots/inbox-stuck-card-home-spacing/` and linked with absolute
   `https://raw.githubusercontent.com/...` URLs (repo-relative paths render broken
   in PR descriptions).
6. **After merge:** clear the `STATUS.md` row. Do **not** cut a GitHub Release
   unless the user explicitly asks.

## Key files

- `docs/plans/2026-07-29-001-fix-inbox-stuck-card-and-home-spacing.md` — **your
  implementation authority.** Read first.
- `src/pipeline/inbox.ts:44` — `STAMP_RE`, ISO-only, requires trailing text.
- `src/pipeline/inbox.ts:61` — the `"held, never guessed at"` doc comment that
  KTD1 deliberately reverses. Update it.
- `src/pipeline/inbox.ts:179` — `parsed ? parsed.text : bullet[1]!`; the source of
  the "junk stamp becomes permanent atom body" bug (U3 mechanic 4).
- `src/pipeline/inbox.ts:601-602` — `c.time!` non-null assertions that break the
  moment unparseable captures become pending (U3 mechanic 3).
- `src/pipeline/inbox.ts:492`, `:506`, `:106` — marker splice, `captureKey`, and
  the region scan that U2's absorption must not disturb.
- `src/home/atomsHomeData.ts:459` — `inboxStuckSummary`, where the copy lives.
- `src/home/atomsHomeView.ts:664` — where home reads the counts (read-time note
  content, **not** the drain result — this is why U4 needs `inferredDates` on
  `InboxCounts`).
- `src/home/atomsHomeView.ts:1866-1875` — the dead-end card: two `<p>`s, no handler.
- `src/plugin/main.ts:323` — the `"N unreadable"` Notice fragment U4 must remove.
- `styles.css:42` — `.atoms-home-title { margin: 0 }`, the cramped header.
- `styles.css:1547` — `.atoms-ui-flat-card`, which has no margin at all.
- `styles.css:1819-1826` — the `.is-repair` rules U4 deletes.
- `docs/capture-shortcut.md:55`, `:63-65` — the two documented shortcut traps.

## Decisions & constraints

**Do NOT relitigate these — they are settled with the user.**

- **The inbox note is plugin-owned machinery.** The user never opens or hand-edits
  `Atoms System/Inbox.md`. This is why the original idea of "make the card open the
  inbox note" was rejected. Do not re-propose it.
- **KTD1** — a capture with content is never held for a bad stamp (reverses
  "never guessed at").
- **KTD2** — the date is inherited from the nearest preceding stamped capture
  (then following, then today), not from today.
- **KTD3** — a bullet that is only a stamp is empty, not unreadable.
- **KTD4** — orphan column-0 lines are absorbed as continuations, not counted.
- **`STAMP_RE` is NOT widened to locale-short dates.** Rejected with three reasons
  in the plan. `7/8/26` is unresolvably ambiguous across locales.
- **U4 retires the `needsRepair` branch only** — the `.atoms-home-inbox-stuck`
  card itself survives, and so do its `held` and `pending` sub-lines.
- **Vault lanes are hard.** QA runs against `test_vault/` only. The user's
  `~/Documents/Remote Vault` is read-only for you. Never run `atoms:update-notes`,
  fixture rewrites, or unattended classify against it.
- **No AI attribution** in commits, PR bodies, or PR comments. No
  `Co-Authored-By: Claude`, no "Generated with Claude Code". This overrides the
  harness default.
- **Lane is `full`** (escalated from light during review) — the change reaches the
  drain contract, daily bullet shape, dedupe key, marker placement, and
  idempotency.

## Open questions / blockers

- **The user must clear four bullets from their live vault before installing
  0.6.52.** U3 makes previously-stuck captures pending, so the first drain after
  upgrade files the four leftover test bullets (`Test capture`, `Test again`,
  `New test`, `Test`) into real dailies and classifies them into atoms —
  irreversible without hand-deleting. This was flagged to the user in chat. It is
  **their** action, not yours. Repeat it in the PR body and release note.
- **Copy is not written yet.** U4's signal text and the retired card's replacement
  wording should go through the `voice-designer` skill.
- **Detection gap, accepted:** the new signal only catches the non-ISO-stamp trap.
  The Date-component-only trap emits a *valid* ISO stamp reading `12:00:00`, so
  nothing fires and those captures land at noon silently. Named in the plan as
  deferred — don't let U4's copy imply full coverage.
- The plan's "Risks accepted, not resolved" section lists four more (Sync
  interleaving vs append-order, the inbox losing its health signal, whether
  `unparseable` should be deleted outright, whether the inferred-date flag should
  reach the classify prompt). Read it; don't re-derive them.

## Git state

- Branch `claude/inbox-stuck-card-home-spacing-d5557d` (base `master`), pushed to
  `origin`.
- Last real commit before this work: `44e6ef4 Merge pull request #185 from taihartman/chore/status-clear-182`
- WIP snapshot commit: `8a2bebf` — `wip: handoff snapshot — inbox-stuck-card-home-spacing`
- Diff since base: 3 files changed, 507 insertions(+), 1 deletion(-) — plan doc + STATUS.md row + this handoff (no source changes yet).

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/inbox-stuck-card-home-spacing-d5557d
git fetch origin && git switch claude/inbox-stuck-card-home-spacing-d5557d && git pull --ff-only
npm install
npm test
```

Then continue from **Next steps** above.
