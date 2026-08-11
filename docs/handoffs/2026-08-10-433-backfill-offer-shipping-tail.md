---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-11T03:05:00Z"
title: "#433 backfill offer — implemented and simplified; shipping tail remains"
summary: "U5+U8+U7 are built, tested and committed across seven commits; code review, compound, world-class QA and the PR remain."
keywords: ["backfill", "u5", "u8", "u7", "plus", "trial", "budget", "433", "434", "shipping-tail", "atoms"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8"
resume_focus: "Run ce-code-review, fix P0/P1, then ce-compound and world-class-qa, then mark PR #434 ready"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "claude/backfill-offer-u5-u8"
head: "efc057d"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8"
---

# Handoff — #433 backfill offer: built and simplified, tail not run

## Objective

Give the backlog a visible, priced, confirm-gated offer that works for **both** BYOK and
Plus/trial. Before this work a Plus or trial user could not backfill at all.

## Current state

| Piece | State |
|---|---|
| U5, U7, U8 implementation | **Complete.** Seven commits, `7674ddc..efc057d` |
| Unit tests | **1662 passing across 91 files** (baseline was 1568/87). Build and lint clean at every commit |
| `ce-simplify-code` | **Complete.** Three reviewers; findings applied in `efc057d` |
| `ce-code-review` | **Not run** |
| `ce-compound` | **Not run** |
| `world-class-qa` + `adversarial-qa` | **Not run** |
| PR #434 | Still draft. Body has `Closes #433` and an all-unchecked Test plan |
| Version | Bumped to **0.7.0** in manifest/package/versions/package-lock |

Working tree is clean. Everything is committed. Nothing is fragile.

## What was built

`7674ddc` **offer core** — new pure module `src/pipeline/backfillOffer.ts`. Period reserve, spend
cap, and the recent-first budget-bounded range. Reserve uses `clamp`, not `min`, so a `periodEnd`
in the past reserves the full baseline instead of going negative and inventing budget. Freshness is
an explicit input because `refreshedAt` tracks `remaining`, never `periodEnd`.

`1fc5fc3` **write path** — `runWritePath` gained `before`, `order`, and `stopOnAuthExhausted`, all
opt-in with defaults matching prior behavior so unattended auto-run is untouched. The ordering flips
**only the daily sort key**, so captures within a note keep descending line order and an appended
marker never shifts an unreached line.

`61b670e` **confirm modal** — engine discriminant. The Batch-API privacy sentence was factually
wrong for a Plus user at the moment of consent; Batch lines now live in the BYOK branch only.

`ac4fa2a` **entry wiring** — `runBackfillFlow` branches on `resolveFilingAuth()` instead of opening
with `requireApiKey()`. Plus reads the meter with `getEntitlement`, never a classify call.

`d586d1f` **home card** — renders on `complement > 0 && budget > 0`, period-scoped dismissal,
migrated-device copy, egress-ack gated button.

`7fd9137` **U7 copy + 0.7.0** — persistent settings line saying filing starts tomorrow, pointing at
the backfill offer and never at the unbounded `Process` path.

`efc057d` **simplify + guard fix** — see the bug note below.

## Decisions made during implementation that the plan did not settle

1. **Entry source decides BYOK's bound.** `runBackfillFlow(source: "card" | "command")`. The plan
   said BYOK "takes the same cap (50)" *and* that going beyond it "stays the existing unbounded
   command" — but there is exactly one backfill command and it routes through the same function, so
   capping it removed BYOK's only path past 50 captures. Card is capped; command is unbounded as on
   master; Plus is budget-bounded from either entry. **This was caught pre-commit, not shipped.**

2. **The card renders in the over-budget case.** `budget === 0` → no card (a tap leads nowhere).
   `budgeted === 0` with budget available → card renders with copy naming the situation rather than
   a count, because that tap leads to KTD11's top-up branch. Suppressing it would make that branch
   unreachable from home, which is the only discoverable surface.

3. **BYOK dismissal is scoped to 30 days** from dismissal, mirroring the paid-period cadence, since
   BYOK has no `periodEnd`. Stored as a day string, so one comparison serves both cases.

4. **`daysRemaining` non-positive means unknown → baseline reserve.** The plan's prose says this
   twice; the plan's *code block* wraps it in `max(0, …)`, which would yield a zero reserve on an
   expired period — the exact failure the clamp discussion warns against. Prose won. **The plan's
   code block at line ~353 should be corrected**; it was not edited (progress lives in git).

## One bug found and fixed, one filed, three left open

**Fixed in `efc057d`:** `backfillInFlight` was taken only inside `executePlusBackfill`, so a second
tap while the confirm modal or top-up poll was open started a fully concurrent flow — duplicate
vault scan, duplicate meter read, duplicate checkout tab. U8 required the flag to be held "for its
duration". It now spans offer derivation through the write pass, released in a `finally`. Regression
test drives a second tap while the first is parked at the modal.

**Filed as a separate task (do not fix here):** the BYOK path's `modal.onClose` calls
`prepared.run.end()` while `confirmed` is still false, so the confirmed path ends the context run
and then submits the batch against it. Pre-existing on master.

**Left open, surfaced by the efficiency reviewer:**

- `backfillTopUpPoll` runs `window.setTimeout` in a loop with **no unload cancellation**. A flow
  parked in the poll when the plugin unloads keeps its timers for up to ~2 minutes. Real, bounded.
  Likely a `ce-code-review` P1/P2 — worth fixing before merge.
- The home card's button never sets `this.busy`, so during a live flow it stays visually enabled.
  The tap is correctly refused with a Notice, but there is no visual affordance.
- The complement scan runs once for the card gate and again when the flow opens. Deliberately not
  fixed: caching across those surfaces risks staleness on an attended path where the cost is vault
  reads, not API spend.
- `prepareBackfillEstimateOnly` (`src/plugin/main.ts`) has zero callers project-wide. Dead **before**
  this branch, so left alone.

## The QA rig is already standing, and its findings are committed

A local Plus service runs in dogfood mode — no Stripe, no card, no database:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/plus-service && PORT=8799 ATOMS_PLUS_STORE=memory node src/server.mjs
curl -s -X POST http://127.0.0.1:8799/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"you@example.com"}'
# token prints to the server's stdout as: [plus] magic link for … token=mt_…
curl -s -X POST http://127.0.0.1:8799/v1/auth/exchange -H 'content-type: application/json' -d '{"token":"mt_…"}'
```

The throwaway vault at `test_vault/test vault` (in the **main checkout**, not this worktree) already
has `plusBaseUrl = http://127.0.0.1:8799` and no BYOK key. Sign in via the plugin's
`installPlusSession`. Trial mints as `status: trialing, remaining 150, periodEnd +14d`.

**Baseline evidence of the gap this closes** is committed at
[`docs/qa/screenshots/433-trial-backfill-gap/`](../qa/screenshots/433-trial-backfill-gap/) —
three screenshots taken before implementation: the "set your API key" dead end, Settings showing
the live trial, and home with no backfill affordance. Useful in the PR body as before/after.

Note: the memory store is ephemeral; restarting the service voids the session. The trial is one-shot
per email, so use a fresh address if re-minting.

## Next steps

One sequential path:

1. **`ce-code-review`** — `mode:agent plan:docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md base:origin/master depth:full`.
   The cross-model peer routes to **grok** per `.compound-engineering/config.local.yaml`; keep the
   brief short (name the two or three files that matter) or the peer burns its window reading a
   3,200-line diff and returns nothing. Fix P0/P1.
2. **`ce-compound`** — the durable learnings are worth writing: the entry-source lesson (a cap that
   also captures the escape hatch is a capability regression), and the `refreshedAt`-is-not-freshness
   trap.
3. **`world-class-qa`** ending in **`adversarial-qa`**, against `test_vault/` only. The plan's V3/V4
   lists the cases. Live-drive the card: trial with history, `budget === 0`, over-budget single
   daily, dismissal across a period boundary, migrated device.
4. **PR #434** — fill Core user stories and Edge cases, check Test plan boxes only as each runs,
   commit new screenshots under `docs/qa/screenshots/` and link them with absolute
   `raw.githubusercontent.com` URLs. Mark ready.
5. After merge: clear the `STATUS.md` row. **0.7.0 will auto-Release on merge** — CI cuts a stable
   GitHub Release from the version bump. If a beta is wanted instead, change to `0.7.0-beta.1`
   across manifest/package/versions **before** merging.

## Constraints that still bind

- **Never edit `EGRESS_DISCLOSURE` or bump `EGRESS_ACK_VERSION`** — version-stamped; rewording
  strands every device's consent (#315). Nothing in this work touched it.
- **Vault lane:** `test_vault/` or `docs/media/demo-vault/` only, never `~/Documents/Remote Vault`.
- **No AI attribution** in commits, PR bodies, or PR comments.
- **Filing quality is still unverified** — the local service has no `ANTHROPIC_API_KEY`, so
  `/v1/classify` returns 503. Nothing has proven the atoms are good on a live model. The launch post
  asks for feedback on exactly that. Owner-only: a real classify pass on their own vault and key.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
git switch claude/backfill-offer-u5-u8 && git pull --ff-only
npm install && npm test && npm run build && npm run lint
```

Expect 1662 passing across 91 files, clean build, clean lint. Anything else is drift.
