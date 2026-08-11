---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-11T01:05:00Z"
title: "#433 backfill offer — planning done, implementation not started"
summary: "U5+U8 backfill offer is fully planned, round-2 doc-reviewed, and hard-claimed (Issue #433 / draft PR #434); no source code has been written yet."
keywords: ["backfill", "u5", "u8", "plus", "trial", "filings", "budget", "433", "434", "atoms"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8"
resume_focus: "Implement U5 + U8 + U7's copy from the amended plan, then run the shipping tail"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "claude/backfill-offer-u5-u8"
head: "c6fbf101c8260d480464970ea6cdf9993d580f83"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8"
---

# Handoff — #433 backfill offer (U5 + U8): planned and claimed, not built

## Objective

Give the backlog a visible, priced, confirm-gated offer that works for **both** BYOK and
Plus/trial. Today a Plus or trial user cannot backfill at all: `runBackfillFlow` opens with
`requireApiKey()` (`src/plugin/main.ts:1206`) and Notices "set your API key in settings".

This gates a public launch post whose text currently makes two false claims — that the product
"files the backlog into atoms" (0.6.99 bounded filing forward; nothing unattended reaches history)
and that it "shows a cost estimate before processing a big history" (true only for BYOK, and only
from the command palette).

## Current state — read this before planning anything

| Piece | State |
|---|---|
| Plan (U5, U7, U8 + KTD9–KTD11) | **Complete and reviewed** |
| Round-2 `ce-doc-review` | **Complete** — 5 reviewers, 6 P0s, all folded in |
| Product decisions (reserve, cap, dismissal, zero-budget, BYOK rule) | **Settled by the owner** |
| Hard claim (Issue + STATUS row + draft PR) | **Complete** |
| **Implementation** | **Not started. Zero source changes on this branch.** |

The branch contains four commits, all documentation:

- `f9cb6f4` plan amendment — KTD9/KTD10/KTD11
- `de1b8e1` round-2 doc-review P0s folded in
- `8fc9288` round-2 decisions settled
- `c6fbf10` STATUS claim

Working tree is clean and the branch is pushed. Nothing is fragile or uncommitted.

## Authoritative references

- **`docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md` — your authority.**
  The sections you need are KTD3, KTD5, KTD7, **KTD9, KTD10, KTD11**, and units **U5, U7, U8**.
  U1–U4 and U6 already shipped as 0.6.99; do not re-implement them.
- `docs/reviews/2026-08-10-backfill-offer-round2-doc-review.md` — the round-2 findings with their
  source citations, the *Decisions resolved* table, and the *Still open* list.
- `plus-pricing.json` — commercial SSOT. Read prices from here; never restate them in code or copy.
- [Issue #433](https://github.com/taihartman/obsidian-atoms/issues/433) ·
  [draft PR #434](https://github.com/taihartman/obsidian-atoms/pull/434) — PR body already carries
  `Closes #433` and an unchecked Test plan.
- `docs/collab.md`, `STATUS.md` — multiplayer process. The claim is already filed; do not re-file.

## The six things round 2 caught, because they are traps you will otherwise re-enter

Every one of these is a place where the plan's *earlier* draft asserted something about the codebase
that is false. The plan text is now correct — but if you reason from intuition rather than reading
it, you will land back on the wrong answer.

1. **`RunWritePathOptions` has no `before`.** It carries only `since`, and the scan call at
   `src/pipeline/write.ts:116-119` forwards `{ includeToday, since }`. U2 added `before` to
   `GetUnprocessedOpts` (`src/pipeline/daily.ts:57-58`) but never threaded it into the write path.
   **Passing `since` alone re-files the entire filing window at Plus rates.** Add `before` and pass
   both bounds.
2. **`runWritePath`'s pacing slice is oldest-first.** It sorts by `note.path.localeCompare`
   ascending then takes `work.slice(0, max)` (`src/pipeline/write.ts:129-137`); daily paths are
   date-named. Left alone, a paced or interrupted run files the *oldest* end of a recent-first range
   and KTD10's product bet inverts. Order newest-first before slicing — preserving the bottom-up
   line ordering *within* each daily, which is what keeps marker insertion from shifting later lines.
3. **The meter cannot be read from `classifyViaProxy`.** It is a POST to `/v1/classify`
   (`src/platform/plusClient.ts:644-686`) that returns `remaining` only as a side effect of
   classifying a capture — pricing an offer through it would spend a filing to quote a filing. Use
   `refreshPlusEntitlementRecord` / `getEntitlement` (GET `/v1/me`), which returns `status`,
   `remaining` and `periodEnd` together.
4. **`refreshedAt` is not a freshness signal for `periodEnd`.** `requireClassifyAuth`'s
   `onRemaining` (`src/plugin/main.ts:1908-1919`) rewrites the session on every classify call,
   carrying the old `periodEnd` forward while stamping `refreshedAt` fresh.
5. **The confirm modal is Batch-API-specific down to its privacy sentence**
   (`src/pipeline/backfill.ts:869-900`): *"sends historical captures and your title graph to
   Anthropic's Batch API"*. Shown to a Plus user that is **factually wrong at the moment of
   consent**. The modal needs an engine discriminant, not just a widened `CostEstimate` — budget for
   a larger unit than "add a filings line".
6. **`prepareBackfillEstimate` must keep its required `apiKey`.** An earlier draft said to make it
   optional; that is wrong. The key feeds `countTokensForClassifyRequest` (`:181-215`, called at
   `:443-446`), which POSTs to Anthropic's count_tokens. **The Plus branch simply never calls it.**
   The single real BYOK gate to move is `runBackfillFlow`'s `requireApiKey()`.

Two more that do not exist and must be built: the **`exhausted` abort** (`runWritePath` pushes a
failure per capture and continues — `write.ts:147-175`), and an explicit **newest-first sort**
(`getPastDailyNotesWithUnmarkedCaptures` returns `Object.values(getAllDailyNotes())` order, unsorted).

## Settled decisions — do not relitigate

- **Two bounds, not one leftover:** `budget = min(BACKFILL_CAP, max(0, remaining - reserve))`. The
  reserve protects forward filing; the cap makes the backlog drain across periods so the
  subscription keeps earning. Owner-directed.
- **Constants are period-specific**, because `grantPeriod` uses `opts.remaining ??
  config.includedFilings` with no trial override (`plus-service/src/store/memory.mjs:118-127`) — a
  trial gets the same **150 filings over 14 days** the paid plan gets over 30.
  Trial: `RESERVE_BASELINE` 70, `BACKFILL_CAP` 75. Paid: 100 / 50.
- **`DAILY_BURN` = 5**, not the midpoint — a reserve is a floor for the worst plausible case.
- **BYOK takes the same cap (50), no reserve** — one card, one modal, one code path.
- **Dismissal is period-scoped**, compared against `periodEnd`; permanent dismissal would collapse
  the multi-period drain into one shot.
- **Card renders only when `complement > 0 AND budget > 0`.**
- **Recent-first** default range, derived by walking back from the window start, whole dailies only.

## Constraints that will bite

- **Never edit `EGRESS_DISCLOSURE` (`src/settings/consent.ts`) and never bump `EGRESS_ACK_VERSION`.**
  Clause (3) says today's daily is never auto-touched. The disclosure is version-stamped, so
  rewording strands every device's consent (#315). If a unit finds itself editing it, **stop and
  escalate**. The related lesson:
  [`docs/solutions/security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md`](../solutions/security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md)
- **U7's enable-time copy must not point at `Process unprocessed captures`** — the one deliberately
  unbounded, unpriced path. It is copy only and must not reintroduce a today-including run.
- **Reads never stamp.** Read-only surfaces use `readAutoFilingSince`, never
  `resolveAutoFilingSince` with a real `save`.
- **Vault lane.** Verify against `test_vault/` or `docs/media/demo-vault/` only — **never**
  `~/Documents/Remote Vault`. The throwaway vault lives in the **main checkout**, not this worktree
  (machine-local path):
  `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`
- **No AI attribution** in any commit, PR body, or PR comment.

## Open, not blocking

Recorded in the plan's Risks table and the review's *Still open* list:

- The meter is **account-wide** but every budget input is **device-local** (KTD6), so two devices can
  each offer a full budget against one meter.
- [#429](https://github.com/taihartman/obsidian-atoms/issues/429): a well-formed far-past
  `LS_AUTO_RUN_START_DAY` **empties the complement**, so the card never renders and the whole history
  runs through the *unattended* per-capture path unbudgeted. The budget is not the only spend bound.
- Whether the Plus meter is enforced server-side per request — if so, several client-side budget
  hazards degrade from overspend to bad copy.
- **The paid plan has no slack at the assumed burn rate.** 150 over 30 days *is* 5/day, so a paid
  reserve of 100 bets that real burn is nearer 3.3. If it comes in high the lever is
  `includedFilingsPerPeriod` in `plus-pricing.json` — a pricing decision, the owner's — **not** a
  smaller reserve.

## Owner-only items this session could not settle

- **Filing quality is unverified.** The 0.6.99 QA pass ran against a deterministic local classify
  stub with no live API, so nothing has recently proven the atoms are good. The launch post
  explicitly asks for feedback on filing quality. Recommend a real classify pass over the owner's own
  vault on their own key before posting.
- The launch post's "files the backlog into atoms" becomes true as a **bounded, priced, opt-in
  slice** — roughly the newest ~100 captures before the window. Worth deciding whether the sentence
  should say so.

## Verification performed

Documentation only — no code ran, so no test evidence exists yet. `npm test` / `npm run build` /
`npm run lint` have **not** been run on this branch; the tree is unchanged from `master` apart from
docs, so they should be green, but that is inference, not evidence.

## Next steps

One sequential path, not a menu:

1. Build **U5 + U8 together** — they are one surface (one gate, one card, one confirm modal). Work
   from the plan's unit definitions and the six traps above.
2. Land **U7's enable-time copy** and [#431](https://github.com/taihartman/obsidian-atoms/issues/431)
   in the same push. Copy goes through the `atoms-voice` skill; `docs/voice.md` is authority.
3. Run the shipping tail — it is part of the work, not polish: `ce-simplify-code` →
   `ce-code-review` (fix P0/P1) → `ce-compound` → `world-class-qa` ending in `adversarial-qa`.
4. Fill the PR's Core user stories / Edge cases sections and check the Test plan boxes **only** as
   each item actually runs. UI changes need vault screenshots committed under
   `docs/qa/screenshots/` and linked with absolute `raw.githubusercontent.com` URLs.
5. Mark PR #434 ready. After merge: clear the `STATUS.md` row. Release only when the owner asks.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
git fetch origin && git switch claude/backfill-offer-u5-u8 && git pull --ff-only
npm install
npm test && npm run build && npm run lint
```

Note: this worktree is nested inside the repo (`.claude/worktrees/…`), against the sibling-worktree
convention. Pre-existing; reused rather than recreated. Not a blocker.
