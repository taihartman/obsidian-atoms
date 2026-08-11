---
handoff_date: 2026-08-10
branch: claude/backfill-opt-in-709c23
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
base: master
tracking: none — the hard-claim Issue has NOT been filed yet; filing it is your step 1
status: in-progress
---

# Handoff — Automatic filing files forward; backfill becomes a separate, asked-for job

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Enabling automatic filing in the Atoms plugin currently backfills the user's **entire daily-note
history** — silently, 15 captures per pass, forever, with no estimate and no confirmation. You are
bounding unattended filing to a window that starts the day the user enables it, and moving all
older history behind an explicit, priced, confirm-gated backfill offer.

This matters now because the user is about to make a public launch post on the Obsidian subreddit
and needs the claim *"nothing touches your old notes unless you ask"* to be literally true.

## Current status

- **The plan is written, reviewed, and ready to implement.** It is the authority for this work:
  `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`
- **No code has been written.** Not one line. The only change on this branch is the plan doc plus
  this handoff.
- **Round 1 `ce-doc-review` is complete** — six dispatched reviewers (coherence, feasibility,
  product, design, security, adversarial). All findings are already folded into the plan; you do
  not need to re-run it for U1–U7. The review caught three P0s that would otherwise have shipped:
  1. The window bound **failed open** — an unresolvable start day reverted to scanning all history,
     and "Sync everything now" on a never-enabled device had no stamp at all. Fixed by
     `resolveAutoFilingSince`, which always returns a date and stamps when it cannot read one.
  2. The original KTD7 was **factually wrong** — `runBackfillFlow` is BYOK-only (Anthropic Batch
     API, `x-api-key`) and spends zero Plus filings, so the trial-currency framing was unbuildable.
     Replaced with a two-engine design.
  3. The home hero renders *"N past thoughts will file automatically"* from an **unbounded** count
     (`src/home/atomsHomeView.ts:1974`), which after this change is a promise nothing keeps and
     double-counts against the new backfill card.
- **Not run:** scope-guardian (below threshold) and the cross-model peer pass (skipped for
  turnaround). No finding carries independent cross-model corroboration — the P0s each have 2–3
  same-model reviewers agreeing, which is convergence within one family.
- **U8 is new since the review and is unreviewed.** See Open questions.

## Next steps

1. **File the hard claim before touching code.** This repo is multiplayer and the claim is
   non-negotiable: create + assign a GitHub Issue, add a row to `STATUS.md`, and open a **draft**
   PR from this branch. Process is `docs/collab.md`. The PR body must eventually carry
   `Closes #<issue>`.
2. **Implement the launch-blocking subset: U1, U2, U3, U4, U6.** After these, no unattended path
   can reach history and the launch claim is true. Work from the plan's unit definitions — each is
   independently reviewable and leaves the tree green. Tests first on the pure logic (U1).
   - The user intends to drive this with `/lfg`. **You cannot start `/lfg` yourself** — it is
     user-invoked only. If they have not fired it, implement with `ce-work` against the plan.
3. **Do not build U5, U7, or U8 in the same pass.** They make backfill *good*; they do not gate the
   claim. U8 in particular needs its own doc-review first (see Open questions).
4. **Run the shipping tail** — it is part of the work, not optional polish: `ce-simplify-code` →
   `ce-code-review` (fix P0/P1) → `ce-compound` → `world-class-qa` ending in `adversarial-qa`.
5. **Evidence before you call it done.** V3 in the plan is a live CLI smoke against the throwaway
   vault. PR Test-plan boxes get ticked only after they actually ran; UI changes need screenshots
   committed under `docs/qa/screenshots/` and linked with absolute `raw.githubusercontent.com`
   URLs (repo-relative paths render broken in PR bodies).

## Key files

- `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md` — **your authority.**
  Units, KTDs, verification, risks.
- `src/platform/autorun.ts:32` — `PER_LAUNCH_CAP = 15`; `:56-60` — `shouldRunAutoProcess`, the
  same-day re-entry that turns a cap into a drip. New window primitives land here (U1).
- `src/plugin/main.ts:1028-1122` — `maybeAutoRun`: the count → file → recount → stamp cycle. The
  KTD2 coupling lives here; U2 threads one bound through both calls.
- `src/plugin/main.ts:958-969` — `scheduleAutoRunLifecycle`; U4's one-time migration goes here,
  after `waitForVaultIndexReady` and before the first `maybeAutoRun`.
- `src/plugin/main.ts:998-1003` — `enableAutomaticFilingFromHome`, which already fires
  `maybeAutoRun("manual")`. U3 adds `includeToday: true` here for the attended first run.
- `src/plugin/main.ts:812-819` — the manual catch-up passing `bypassEnabled: manual`. This is the
  "Sync everything now" hole; U6 scopes it.
- `src/pipeline/daily.ts:58-90` — `getPastDailyNotesWithUnmarkedCaptures`, the unbounded
  `getAllDailyNotes()` scan. U2 adds `since` **and** `before`.
- `src/settings/settings.ts:1743-1747` — the already-acked toggle branch that U3 must also stamp.
  This is the path **every re-enable takes**; round 1 missed it.
- `src/home/atomsHomeView.ts:668` and `:1974` — home's own unbounded count and the copy it feeds.
- `src/pipeline/backfill.ts:408` — the single unbounded scan inside `prepareBackfillEstimate`.
- `src/platform/plusClient.ts:644-682` — `classifyViaProxy` and the live `remaining` meter that U8
  prices against.

## Decisions & constraints

**Settled by the user this session — do NOT relitigate:**

- **KTD1 — strict enable-date window, no lookback.** A 7-day grace was proposed and **rejected**:
  it is itself an unasked backfill, just smaller. Day one comes from one **attended** run fired by
  the enable tap with `includeToday: true`, which is explicit user force under non-negotiable #3.
- **KTD7 — both Plus and BYOK users can backfill, via two engines behind one gate.** BYOK keeps the
  Anthropic Batch API priced in dollars; Plus reuses the **existing** `/v1/classify` route priced in
  filings. **No plus-service work is required** — this was verified, not assumed.

**Hard constraints:**

- **Never edit `EGRESS_DISCLOSURE`** (`src/settings/consent.ts`) and do **not** bump
  `EGRESS_ACK_VERSION`. This change only *narrows* what unattended paths reach, and a consent
  granted for a superset still covers a subset. `egressConsentParity.test.ts` must stay green
  untouched. If a unit finds itself editing the disclosure, stop and escalate — a wrong bump
  strands every existing device's consent (the #315 bug).
- **The bound fails closed.** `since` is non-optional on every unattended path. An absent or
  malformed stamp must never mean "scan everything".
- **`includeToday` is reachable only from the enable tap and the existing explicit test commands.**
  Never from `onload`, `interval`, or `resume`.
- **Vault lane.** All verification runs against `test_vault/` or `docs/media/demo-vault/`. **Never**
  run classify, Process, or Update notes against the user's personal `~/Documents/Remote Vault`.
- **No AI attribution** in any commit message, PR body, or PR comment. No `Co-Authored-By`, no
  "Generated with Claude Code" footer. This overrides the harness default.
- Body is sacred; atoms stay flat in the configured folder; nothing destroyed; markers are the
  processed sentinel. See `CLAUDE.md` non-negotiables.

## Open questions / blockers

- **U8 (the Plus backfill engine) has not been doc-reviewed.** It was designed after round 1
  completed. The project rule is that a material plan change gets at least a light `ce-doc-review`
  before implementation. U8 is not launch-blocking, so the clean sequence is: ship U1–U4 + U6,
  review U8, then build it. Do not fold U8 into the launch-blocking pass.
- **This worktree is nested inside the repo** (`.claude/worktrees/…`), which violates the user's
  sibling-worktree convention. It pre-existed this session and was reused rather than recreated.
  Not a blocker; worth knowing if tooling behaves oddly.
- No signal is defined that would confirm or refute the plan's conversion bet (trial-to-paid,
  atoms-in-first-week, backfill acceptance rate). Recorded as a deferred follow-up, not a blocker.

## Git state

- Branch `claude/backfill-opt-in-709c23` (base `master`), pushed to `origin`.
- Last real commit: `fd6eaa5 chore: run eslint-plugin-obsidianmd in CI (#425)`
- WIP snapshot commit: the branch tip, `wip: handoff snapshot — auto-filing-window-backfill-split`
  (its SHA is not written here — amending to record it would change it).
- Diff since base: 2 files, +635/-0 — the plan and this handoff. **No source changes.**

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
git fetch origin && git switch claude/backfill-opt-in-709c23 && git pull --ff-only
npm install
npm test          # vitest — should be green before you start
npm run build     # typecheck + bundle
```

Then continue from **Next steps** above.
