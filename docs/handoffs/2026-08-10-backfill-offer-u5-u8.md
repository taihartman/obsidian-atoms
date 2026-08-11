---
handoff_date: 2026-08-10
branch: claude/backfill-offer-u5-u8
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
base: master
tracking: none — the hard-claim Issue has NOT been filed yet; filing it is your step 2
status: in-progress
---

# Handoff — Backfill gets a visible, priced, trial-aware offer (U5 + U8)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Make the backlog reachable again, on purpose this time. Automatic filing shipped bounded this
morning (0.6.99), so nothing unattended touches history any more — which is correct, and which
left the product with **no in-app route to a user's past captures at all**. You are building the
offer that replaces the sweep: a visible home card, priced, confirm-gated, working for **both**
BYOK and Atoms Plus, and bounded so a trial user cannot spend their whole allowance on it.

This gates a public launch post. See **Why this is urgent** below — the post's text promises
behavior 0.6.99 does not currently deliver.

## Why this is urgent — read the post text

The user has a Reddit launch post drafted. Two of its claims are **currently false**:

> "Already keep daily notes with bullets? thats all it needs. It finds your dailies on its own and
> **files the backlog into atoms**. It never rewrites your daily lines (just creates new notes and
> appends a small marker), theres a dry run preview before anything is written, and it **shows a
> cost estimate before processing a big history**."

- **"files the backlog into atoms"** — false as of 0.6.99. Automatic filing is bounded to the day
  the user enables it and will never reach the backlog. This sentence described 0.6.98, where the
  unbounded auto-run swept history silently. That sweep is exactly what was removed.
- **"shows a cost estimate before processing a big history"** — true only for BYOK users, and only
  if they find `Atoms: Backfill estimate confirm` in the command palette. There is no UI for it.

And the two combine into the worst case: `runBackfillFlow` opens with `requireApiKey()`
(`src/plugin/main.ts:1206`), so a **Plus/trial user cannot backfill at all** — they get "set your
API key in settings". The post steers exactly those people to the hosted option ("if thats too much
hassle theres a hosted option with a free trial"). Someone reads it, installs, starts a trial,
points at three years of dailies, and the one thing the post sold is the one thing they cannot do.

The post also says: *"Feedback welcome, especially on the filing quality."* That is what the
audience will judge. It is why the backfill default must land on **recent** notes (see KTD-A2).

## Current status

- **0.6.99 is released and on master.** Stable, not prerelease:
  https://github.com/taihartman/obsidian-atoms/releases/tag/0.6.99
  It shipped the launch-blocking subset U1–U4 + U6 of the filing-window plan. `STATUS.md` is clear,
  nothing in flight.
- **Nothing of U5/U8 is written.** This branch is a fresh cut off `master` with only this doc.
- **The plan already specifies U5, U7, U8** — you are amending U5, not inventing it:
  `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`
- **Round 1 `ce-doc-review` covered U5 as originally written.** It did **not** cover U8 (designed
  after that review) and did not cover the trial-reserve amendment you are about to write. The
  project rule is that a material plan change gets at least a light doc-review before implementation.

## Next steps

1. **Write the U5 amendment into the plan**, then **run one light `ce-doc-review` over U5-amended
   and U8 together** (they now share a gate, a card, and a confirm modal, so reviewing them
   separately wastes a pass). Do this *before* any implementation. The amendment content is fully
   specified in **The amendment to write** below — it is settled design, not open scope.
2. **File the hard claim.** This repo is multiplayer: assigned GitHub Issue + `STATUS.md` row +
   draft PR before implementation. Process is `docs/collab.md`. PR body needs `Closes #<issue>`.
3. **Build U5 + U8 together.** They are one surface. Work from the plan's unit definitions.
4. **Also land, in the same push:** U7's enable-time copy (below) and
   [#431](https://github.com/taihartman/obsidian-atoms/issues/431). Both are small and both are
   true under every scenario.
5. **Run the shipping tail** — it is part of the work: `ce-simplify-code` → `ce-code-review`
   (fix P0/P1) → `ce-compound` → `world-class-qa` ending in `adversarial-qa`.
6. **Release** as the next version, then the user posts.

### U7's enable-time copy (small, do not skip)

Day one is now deliberately silent — the window starts today and every pass excludes today, so
enabling files nothing until tomorrow. A launch-post visitor who enables and sees nothing will
conclude it is broken. **One line at enable time** saying filing starts tomorrow and that Process
handles what is already waiting fixes it. This must NOT reintroduce a today-including run — see
the hard constraint about `EGRESS_DISCLOSURE` clause (3) below.

## The amendment to write

Settled with the user this session. **Do not relitigate; write it up and review it.**

### KTD-A1 — Backfill is bounded by a trial reserve, not offered as one shot

Real numbers, from `plus-pricing.json` (the SSOT — never invent prices elsewhere):

| | |
|---|---|
| `includedFilingsPerPeriod` | **150** |
| `trialDays` | **14** |
| `topUpFilings` / `topUpUsd` | **50 for $2** |
| `monthlyUsd` / `yearlyUsd` | 6 / 60 |
| **`rollover`** | **`false`** |

`rollover: false` is the fact that drives the design: **unspent filings expire at period end.** A
user who "saves" filings is throwing them away, so a conservative cap actively destroys value and
costs the conversion. Do not reserve more than the loop actually needs.

The split: **reserve ~50 for ongoing daily filing, offer the rest (~100) to backfill.** 14 days at
a realistic 3–5 captures/day is 40–70 filings of ongoing use, so ~50 leaves the daily loop
genuinely observable while the remaining ~100 buys a real backlog demo.

Resolve the offer against the **live** `remaining` meter, not a hardcoded 100 —
`classifyViaProxy` returns it (`src/platform/plusClient.ts:644-682`) and `PlusSession.remaining` is
a cached snapshot with a `refreshedAt` sibling (`src/platform/filingAuth.ts:22-27`). KTD7's existing
constraint still binds: **never state a count it cannot source or one that is stale** — read on
open, fall back to the cost line on a failed/unauthenticated/stale read.

Decide and write down: does the reserve shrink as the period nears its end? With `rollover: false`
it arguably should — reserving filings that are about to expire is pure waste — but that is added
complexity and you may reasonably defer it. **Make the call explicitly in the amendment rather than
leaving it implied.**

### KTD-A2 — The default range is recent-first, not oldest-first

Walk **backwards from the window start**, not forward from the oldest daily. ~100 filings is
roughly the last month of dailies for a typical user.

The reason is product, not cost: a user can only judge filing quality on notes they remember
writing. An atom built from a three-year-old capture is interesting; an atom from last month is
*verifiable* — they recognize the links and can tell whether the reasons are right. The launch post
explicitly asks for feedback on filing quality, so the demo has to land where the user can judge it.

This is a real change to the scan: the plan's U5 currently bounds `prepareBackfillEstimate` by
`before` alone (one shot at the whole complement). A recent-first bounded range needs **both**
bounds — `since` and `before` — which `GetUnprocessedOpts` already supports (`before` was built in
U2 and currently has no production caller; this is its first one).

### KTD-A3 — Over budget offers a top-up, never a dead end

When the complement exceeds what the user can spend, the modal must not say "you don't have
enough". It says how much it will do now and that more is available — 50 filings for $2, or the
next period. KTD7's existing constraint stands: **the over-budget branch states the aftermath, not
just the arithmetic** — that confirming spends the allowance and forward filing pauses until it
resets or the user upgrades.

### Unchanged from the plan's existing U5/U8

Do not re-derive these; they are already written and already reviewed:

- The card is **egress-ack gated** — renders only when `readEgressPermitted(load, {catchUp:false})`,
  otherwise its button raises `egressConsentSpec` and proceeds only on `accepted`.
- The card is **dismissible**, persisted device-locally beside the start day. A permanent unread
  count contradicts the product's stream-not-guilt-queue posture.
- **Two engines behind one gate** (KTD7): BYOK keeps the Anthropic Batch API (`runBackfillFlow`,
  priced in dollars); Plus reuses the **existing** `/v1/classify` route via `runWritePath` with
  `classifyDeps.plus`, priced in filings. **No plus-service work is required** — this was verified,
  not assumed.
- Mid-run `exhausted` stops cleanly, reports what filed, and markers make the resume idempotent.
- Migrated devices (KTD5) get copy naming the pause rather than reading as an upsell — this also
  closes [#430](https://github.com/taihartman/obsidian-atoms/issues/430).

## Key files

- `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md` — **your authority.**
  U5, U7, U8, KTD3, KTD5, KTD7 are the sections you need.
- `plus-pricing.json` — the commercial SSOT. Read prices from here; never hardcode them.
- `src/plugin/main.ts:1205-1250` — `runBackfillFlow`: the existing BYOK batch flow, its
  `requireApiKey()` gate at `:1206`, and the `BackfillConfirmModal` block.
- `src/pipeline/backfill.ts:408` — the single unbounded scan inside `prepareBackfillEstimate`; this
  is what gains the bounds.
- `src/pipeline/backfill.ts:855-864` — `BackfillConfirmModal(app, estimate: CostEstimate, onConfirm)`.
  Carrying a filings line needs a widened signature or a widened `CostEstimate`. Design flagged the
  modal already renders six same-weight facts — lead with the currency that matters to the current
  user and demote token/chunk detail to the `setting-item-description` styling already used there.
- `src/platform/plusClient.ts:644-682` — `classifyViaProxy` and the live `remaining` meter.
- `src/platform/filingAuth.ts:22-27` — `PlusSession.remaining` + `refreshedAt` (a cached snapshot).
- `src/pipeline/daily.ts` / `src/pipeline/parse.ts` — `GetUnprocessedOpts` carries `since` **and**
  `before`, lexical `YYYY-MM-DD`. `before` has no production caller yet; U5 is its first.
- `src/home/atomsHomeData.ts` — `filingHeroCopy` and `waitingSubtitle`. Home already carries **two
  counts**: `unprocessedCount` (all past, what Process files) and `windowUnprocessedCount` (what
  auto-run files). **The complement U5 needs is exactly the difference** — no new scan required.
- `src/platform/autorun.ts` — `resolveAutoFilingSince` (persists only when enabled),
  `readAutoFilingSince` (never persists — use this from any read-only surface),
  `LS_AUTO_RUN_WINDOW_MIGRATED` + `readAutoFilingWindowMigrated` (written by the migration, still
  has **zero** production consumers — U5's migrated-device copy is its first).

## Decisions & constraints

**Settled by the user this session — do NOT relitigate:**

- **Backfill must work on the trial and on paid Plus**, not BYOK-only. The user was explicit:
  "I don't want them to have an API key."
- **~100 backfill / ~50 ongoing** out of 150, resolved against the live meter (KTD-A1).
- **Recent-first default** (KTD-A2).
- **Top-up as the escape valve, not a wall** (KTD-A3).
- **Day one stays silent.** The enable tap must NOT file today's note. This reverses the plan's
  original KTD1, on the user's explicit call — see the hard constraint below for why.

**Hard constraints:**

- **Never edit `EGRESS_DISCLOSURE` (`src/settings/consent.ts`) and never bump `EGRESS_ACK_VERSION`.**
  Clause (3) reads *"today's daily note is never auto-touched"*. The enable tap used to file today
  and was removed in `4fa7cef` precisely because of this. The disclosure is version-stamped, so
  rewording it strands every existing device's consent until each user re-accepts (the #315 bug).
  If a unit finds itself editing the disclosure, **stop and escalate**.
  Note the lesson this produced: `egressConsentParity.test.ts` froze the *words* and the *keys an
  accept writes*, not the behavior, so it stayed green while the enable path started touching
  today. Writing a new consent-adjacent behavior? It needs a behavioral test, not a text freeze.
  ([the learning](../solutions/security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md))
- **The bound fails closed.** `since` is non-optional on every unattended path; an absent or
  malformed stamp must never mean "scan everything".
- **`includeToday` no longer exists as a threaded option** — `runWritePath` is called with a
  literal `false` from `maybeAutoRun`. Do not reintroduce the parameter.
- **Reads never stamp.** Any read-only surface uses `readAutoFilingSince`, never
  `resolveAutoFilingSince` with a real `save` — three reviewers caught home's refresh minting device
  state and stealing the migration's one-shot stamp.
- **Vault lane.** All verification against `test_vault/` or `docs/media/demo-vault/`. **Never** run
  classify, Process, or Update notes against `~/Documents/Remote Vault`.
  The throwaway vault lives in the **main checkout**, not this worktree:
  `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault` — pass it explicitly:
  `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`
- **No AI attribution** in any commit message, PR body, or PR comment.
- **Prices come from `plus-pricing.json` only.** Do not invent or duplicate them.
- Body is sacred; atoms stay flat in the configured folder; nothing destroyed. See `CLAUDE.md`.

## Open questions / blockers

- **Does the trial reserve shrink near period end?** With `rollover: false` an unspent filing is a
  wasted one, so a static ~50 reserve leaves value on the table in the last days of a trial. Decide
  in the amendment; do not leave it implied.
- **Filing quality is unverified and it is what the post asks to be judged on.** The 0.6.99 QA pass
  ran against a deterministic local classify stub with **no live API**, so nothing in this project
  has recently proven the atoms are actually good. Recommend the user run a real classify pass over
  their own vault on their own key before posting. This is not something you can settle for them.
- **[#429](https://github.com/taihartman/obsidian-atoms/issues/429) is open and out of scope here** —
  a well-formed far-past `LS_AUTO_RUN_START_DAY` (e.g. `1970-01-01`) passes validation and re-opens
  a full-history sweep; QA proved it live. Accepted residual per KTD6 (the key is writable, same as
  the enable flag beside it). Not launch-blocking, but it is the one bug that defeats the claim the
  post makes, so raise it if the user has spare appetite.
- **This worktree is nested inside the repo** (`.claude/worktrees/…`), against the user's
  sibling-worktree convention. Pre-existing; reused rather than recreated. Not a blocker.

## Git state

- Branch `claude/backfill-offer-u5-u8`, cut fresh from `origin/master`, pushed to `origin`.
- Base commit: `ac89f3c chore(status): clear #427 after auto-filing window merge (#432)`
- The filing-window work that preceded this: `27908f8`, released as **0.6.99**.
- WIP snapshot commit: the branch tip, `wip: handoff snapshot — backfill-offer-u5-u8` (its SHA is
  not written here — amending to record it would change it).
- Diff since base: 1 file, +264 — this doc. **No source changes.**

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
git fetch origin && git switch claude/backfill-offer-u5-u8 && git pull --ff-only
npm install
npm test          # vitest — 87 files / 1568 tests, green before you start
npm run build     # typecheck + bundle
npm run lint      # eslint-plugin-obsidianmd, --max-warnings 0 (also a required CI check)
```

Then continue from **Next steps** above.
