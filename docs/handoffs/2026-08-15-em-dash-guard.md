---
handoff_date: 2026-08-15
branch: chore/plugin-wide-em-dash-guard
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-em-dash-guard
base: claude/settings-ux-redesign-69acd6 (PR #494) — repo default is master
tracking: https://github.com/taihartman/obsidian-atoms/pull/496
status: in-progress
---

# Handoff — one em-dash guard for the whole plugin (#495 / PR #496)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

`docs/voice.md:54` bans em dashes in product-authored copy. Three partial guards covered slices of
that rule and the rest of the plugin was uncovered. You are finishing the change that replaces a
five-file **allowlist** test with one **default-deny** guard over all of `src/**`, and sweeps the
offenders it found. The code is done and reviewed. What is left is product QA and a merge-order
call.

## Current status

Implementation, simplify, code-review and compound are all **done**. 98/98 test files pass, build
and lint are clean, everything is committed and pushed. Do not redo any of this.

- `test/copyVoice.test.ts` is the guard. It replaces the deleted `test/settingsCopyVoice.test.ts`.
- 93 of 94 offenders swept across 27 `src` files. The 94th is deliberately exempt (see below).
- The guard uses the **TypeScript parser** (string/template/regex literal nodes), not a hand-rolled
  comment scanner. Proved equivalent before the swap: 128/128 lines on the pre-sweep tree, 35/35 on
  the swept tree.
- Mutation-checked. There is now a **committed** regression test that builds a file in a temp dir
  no exemption table has heard of and asserts the guard catches it, then clears.
- `ce-code-review` ran: 5 local reviewers plus an independent cross-model adversarial pass on Grok
  (`independence_verified: true`). Two findings, both fixed in `cfcfbe1`. One finding was dropped by
  validation (see Decisions).
- Learning written to
  `docs/solutions/best-practices/an-allowlist-guard-decays-and-a-red-baseline-proves-nothing.md`.
- Follow-ups filed and **out of scope here**: #497, #498, #499.

## Next steps

1. **Run `world-class-qa` (the live vault smoke).** This is the only unchecked box on the PR and the
   only thing between this branch and done. It is currently **blocked**: `test_vault/test vault/`
   does not exist in any checkout, so there is no throwaway vault to drive. Create/seed it first
   (`npm run seed:vault`, with Obsidian open on that vault), then `./scripts/install-to-vault.sh`,
   then exercise the surfaces whose copy changed — **Process**, **backfill**, and the **Ask mirror
   status line** — and confirm the reworded Notices render correctly. Capture screenshots to
   `docs/qa/screenshots/plugin-wide-em-dash-guard/` and link them in the PR body Evidence table
   using absolute `https://raw.githubusercontent.com/taihartman/obsidian-atoms/chore/plugin-wide-em-dash-guard/…`
   URLs — repo-relative image paths do not render in PR descriptions.
   Finish with the `adversarial-qa` half, which that skill requires as a hard gate.
   **Vault lane rule: use the throwaway vault only. Never drive Remote Vault or any personal vault.**
2. **Then tick the Test plan box** in PR #496 for the live smoke, and write the QA report to
   `docs/qa/2026-08-15-495-plugin-wide-em-dash-guard-world-class-qa.md`.
3. **Watch the merge order** (this is a real decision, not a formality — see Decisions).
4. Leave the PR as a draft until the user says otherwise. Do not merge it yourself.

## Key files

- `test/copyVoice.test.ts` — the whole deliverable. Three exemption tables (`EXEMPT_FILES`,
  `EXEMPT_REGIONS`, `EXEMPT_LINES`), each entry carrying a reason and a staleness test that fails if
  the exemption stops applying.
- `test/copyVoice.test.ts` `copyLinesWithEmDash` — the detector. Also catches `—` escape
  spellings.
- `test/copyVoice.test.ts` `regionLines` / `exemptRegionLines` — single-region vs union. Keep these
  separate; conflating them was a real bug caught during review.
- `docs/plans/2026-08-14-002-chore-plugin-wide-em-dash-guard-plan.md` — the plan, with KTD1-KTD6.
- `docs/voice.md:54` — the rule, plus the `·` separator and parenthetical-error conventions this
  sweep leaned on.
- `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md` — finding **F5**, the origin.
- `STATUS.md` — the #495 claim row. Clear it only after master merge.

## Decisions & constraints

Do **not** relitigate these.

- **This PR is stacked on #494 and cannot merge until #494 does.** Its base is
  `claude/settings-ux-redesign-69acd6`, not `master`. That was chosen deliberately: on `master` the
  settings tab still holds 25 em dashes, so a whole-plugin guard would need a 25-line
  settings-shaped hole.
- **Exempt on purpose, each for a different reason:** `consent.ts` (ack-pinned to
  `EGRESS_ACK_VERSION`); the `classify.ts` prompt/parity/schema regions and `context.ts`
  `buildContextPrefixBlock` (model-facing, parity-frozen against plus-service, and the prompt-cache
  stable prefix); `continueParent.ts`'s ` — continued` (it is an atom **filename**, not copy); the
  `askMirror` trailing-punctuation regex and `ASK_MIRROR_COUNT_UNKNOWN` (behavior and a placeholder
  glyph); and the egress catch-up card at `atomsHomeView.ts` (its consent ack is an **un-stamped
  boolean**, so rewording it would leave devices holding a grant against text they never saw —
  that is #497, and the sweep must land with the version bump, not before).
- **Version bump is a merge-order call, not a defect.** A reviewer flagged the missing
  manifest/package/versions bump; validation **refuted** it. 0.8.0 is already set on the base branch
  and unreleased (latest release is 0.7.11), so both PRs ship under one version. It becomes real
  **only if #494 merges and releases 0.8.0 before this lands** — in that case bump here. Check this
  before merge.
- **Never loosen a byte-pinned assertion to make a copy edit pass.** Four test files had assertions
  retargeted to the new copy (`askMirror`, `askMirrorConsentTruth`, `atomsHomeData`, `landPeak`).
  The #446 word-boundary regex was tightened to look inside the new parentheses rather than left to
  pass vacuously.
- **Region exemptions declare a `spanLines`.** End-marker uniqueness cannot be asserted because
  `] as const;` legitimately appears three times in `classify.ts`. If you edit a region's boundaries
  you must update its declared span.

## Open questions / blockers

- **Blocker:** no throwaway vault exists (`test_vault/test vault/`), which is why the live smoke has
  not run. Creating it is step 1.
- **Decision pending:** the version bump, contingent on merge order (see Decisions).

## Git state

- Branch `chore/plugin-wide-em-dash-guard` (base `claude/settings-ux-redesign-69acd6`), pushed to
  `origin`.
- Last real commit: `cfcfbe1 fix(review): close the three ways this guard could go quiet`
- WIP snapshot commit: the branch tip, subject `wip: handoff snapshot — em-dash-guard`.
  Not cited by sha on purpose: this doc rides in that commit, so every amend would invalidate
  the number it printed. Run `git log -1` if you need it.
- Diff since base: 37 files changed, 780 insertions(+), 174 deletions(-)
- Open: issue #495, PR #496 (draft). Follow-ups #497, #498, #499 filed and unclaimed.

## How to resume

Check out the work exactly here — this is your branch and worktree. The previous session ran inside
`.claude/worktrees/`, which is ephemeral; this sibling worktree is the durable one.

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-em-dash-guard
git fetch origin && git switch chore/plugin-wide-em-dash-guard && git pull --ff-only
npm install
npm test          # expect 98/98 test files passing
npm run build
```

Then continue from **Next steps** above.
