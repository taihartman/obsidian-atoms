---
handoff_date: 2026-08-06
branch: fix/consent-wording-parity
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/329
status: in-progress
---

# Handoff — #315 + #314 claimed and planned; next step is `ce-doc-review`, then five units

You are picking this up in a fresh session. Read this top to bottom, run **How to resume**, then
start at **Next steps** — step 1 is your task. Do not re-plan what the plan already decided and do
not summarize this back to the user.

## Goal

Home's "Enable automatic filing" and the Settings egress consent sheet write **the same device-local
boolean** behind **different text**. Settings later renders it as *"Acknowledged on this device"*
regardless of which surface wrote it, so a user can grant from home, never open Settings, and hold a
consent record for wording they never saw. Fix both surfaces onto one disclosure, and rewrite the two
jargon row labels #304 deferred.

Issues: **#315** (the mismatch) and **#314** (the labels). Both assigned. Draft **PR #329**.

## Current status

- **Claim complete.** #315 and #314 assigned to `taihartman`; STATUS row up; draft PR #329 open.
- **Plan written and reviewed once by its author, not yet doc-reviewed.**
  `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md`.
- **No implementation code exists.** Two commits on the branch, both docs.
- Lane: **light, escalated** — small diff, but a consent/access-control surface, which per
  `CLAUDE.md` auto-escalates out of the amend lane.

## The finding that changes the fix — do not undo this

**#315's own framing is half wrong.** It says home is strictly weaker and the fix is to point home at
`EGRESS_DISCLOSURE`. Read both strings on master at `19bc489`; each carries what the other lacks:

| | foreground-resume runs | "Sync everything now" classifies even when filing is off | today's daily never auto-touched | device-local only |
|---|---|---|---|---|
| `EGRESS_DISCLOSURE` | ✅ | ✅ | ❌ | ❌ |
| home modal | ❌ | ❌ | ✅ | ✅ |

A swap therefore **weakens home on two points** and leaves Settings still missing the other two. The
plan unions the string instead. If a reviewer suggests "just import `EGRESS_DISCLOSURE`", that is the
issue's wording, not the plan's, and it is wrong.

## Next steps

1. **Run a light `ce-doc-review`** on `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md`
   (`mode:headless`, coherence + feasibility; add the product/design lens for the U4 label rewrite).
   Mandated by `CLAUDE.md` before implementation. Cross-model peer routes to **grok**, never codex —
   see the global rule; give it a narrow brief naming only `settings.ts` and `atomsHomeView.ts`, or
   it burns its whole turn budget reading.
2. **Then the five units** in the plan: U1 extract → U2 union the disclosure → U3 home uses the
   primitive → U4 the two labels → U5 parity test. U5 is the one that matters — without it this is a
   one-time correction rather than a guarantee that the two surfaces can't drift again.
3. **Shipping tail, in full:** `ce-simplify-code` → `ce-code-review` → `ce-compound` →
   `world-class-qa` (ending in `adversarial-qa`) → PR. UI change, so the PR body needs **vault
   screenshots** under `docs/qa/screenshots/`, linked with absolute
   `https://raw.githubusercontent.com/...` URLs — repo-relative paths render broken.
4. **After merge:** clear the STATUS row on a small branch + PR.

## Decisions & constraints

- **Union, not swap** (KTD1 above). The whole reason this isn't a one-line import.
- **The `settings.ts` split is ungated** (KTD2). Measured, not assumed: `feat/320-multi-device-sessions`
  is 56 insertions / 0 deletions with every hunk between lines 31 and 511. Our block move at 2182+
  cannot conflict. Only the constants at 295–300 sit near their `+304,52` insertion.
  **Rebase onto master after #320 lands** — that was offered to the other session in writing.
- **#314 is exactly two strings** — `EGRESS_ACK_TITLE` and `ASK_PRIVACY_ACK_TITLE`. #304's QA
  (`docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md:140`) says explicitly: do not
  re-review the screen. Anything beyond those two labels goes back on #314.
- **Each sheet writes exactly its own field.** The comment at `settings.ts:290` explains why merging
  any two consents is a bug: agreeing to one would silently authorize another. The extraction must
  not blur this.
- **Vault lanes** — dogfood in `test_vault/test vault` only. Never `~/Documents/Remote Vault`.
- **No AI attribution** in commits, PR bodies, or review replies.
- **Releases only when the user explicitly asks.**

## Key files

- `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md` — the plan. Authority for this work.
- `src/settings/settings.ts:295-300` — `EGRESS_ACK_TITLE`, `EGRESS_DISCLOSURE`,
  `ASK_PRIVACY_ACK_TITLE`. U2 and U4 both land here.
- `src/settings/settings.ts:2182` — `ConsentSheetModal`. Moves to `src/settings/consent.ts` in U1.
  Note `onClose` already treats an unanswered close as `declined` — U3 must assert that, not rebuild it.
- `src/home/atomsHomeView.ts:2638` — `confirmEnableAutomaticFiling()`, the raw `new Modal(app)` that
  U3 replaces. Line numbers in issue #315 predate #304 and are wrong; these are current.
- `src/platform/autorun.ts:85` — `writeEgressAck`; `:111` — `enableAutomaticFiling`. The shared write
  path both surfaces reach, via `src/plugin/main.ts:980`.

## Open questions / blockers

- **Awaiting the #320 session's reply** to three questions sent 2026-08-06 ~10:52: whether their
  `settings.ts` diff is settled, whether **#328 and #322 are stacked or one is stale** (both are open
  and both titled for #320), and where the two-device rig stands. None of this blocks steps 1–2.
- **Not ours, still open:** the required-check flip (`test + build` is not in master's required set,
  so it reports without blocking); the 0.6.79 release, which is **beta-or-nothing** because the
  human-only #240 iOS/Android device test has never run and `crypto.subtle` on the mobile webview is
  unverified; #316 and its scan for other vacuously-passing tests; #323, owned by the other session.
- **Untracked verification debt from #304** with no issue behind it: Escape/click-outside were driven
  with synthetic DOM events and want one manual confirmation; the Plus destination rows, the
  signed-in 15-row count, and the Account async rows were never driven live. The user was offered a
  single "0.6.79 pre-release verification" issue for these and has not answered.

## Housekeeping wart

This worktree has two **untracked** paths that are **not part of this work**: `.gitattributes` and
`.opencode/`, left from an unrelated stash pop. **Do not `git add -A` here** — stage explicit paths.
The user's stash (`stash@{0}`, *"On master: wip graphify+process docs"*) must stay intact.

## Git state

- Branch `fix/consent-wording-parity`, base `master` (`19bc489`), pushed, tracked by **PR #329** (draft).
- Commits (2, both docs, no code):
  - `53c2b4e docs(plan): consent wording parity — union the egress disclosure (#315, #314)`
  - `23a2ee1 docs(plan): measure the settings.ts conflict — split is safe, ungate U1`
- Landed on master earlier today: `cb08567` (#304, 0.6.79), `7bfaaf2` (#326 CI gate), `19bc489` (#327).

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch fix/consent-wording-parity && git pull --ff-only
npm install
npm test
```

Then start at **Next steps** step 1 — the `ce-doc-review` on the plan.
