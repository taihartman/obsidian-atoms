---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
issue: 168
date: 2026-07-28
lane: full
---

# Plus Vault Catch-up - Plan

## Goal Capsule

**Objective.** Let a Plus subscriber file their existing backlog of daily-note captures without
ever holding an Anthropic API key — free up to an allowance that depends on their plan, paid by
the thousand beyond it.

**Product authority.** This document for product behaviour and scope. `docs/architecture.md` for
the system map. `CLAUDE.md` non-negotiables override both. Prices come from `plus-pricing.json`
and nowhere else.

**Open blockers.** Four questions remain open (see Outstanding Questions); three are product-level
and one is a planning question. Question 1 (delivery) does change the shape of the work — it
decides whether `plus-service` gains a durable server-held result queue.

**Not active scope.** The paid landing-page story for power users (queued behind this), the
BYOK backfill path (stays as-is), and Ask/mirror changes.

---

## Product Contract

### The problem

Backfill is BYOK-only. `runBackfillFlow` calls `requireApiKey()` (`src/plugin/main.ts:851`), so
the person who paid for Plus specifically to avoid managing an API key is told to go get an API
key — at the highest-intent moment the product has, when they install and look at years of
unfiled notes.

This is an onboarding failure, not a missing feature. A new user with a three-year vault is at
peak motivation, we can already count their backlog (`getPastDailyNotesWithUnmarkedCaptures`,
`src/pipeline/daily.ts:58`), and the only thing standing in the way is a credential they do not
have and did not expect to need. Most Obsidian users we are targeting do not arrive with an
empty vault.

### Who it is for

Someone installing Atoms with an existing daily-note habit — months to years of captures already
written, none of them filed. Secondarily, an existing subscriber who never got around to the
backlog.

### Key decisions

**KD1 — Catch-up is priced as a product, not as filings.** The meter's established rate is 4¢ a
filing ($6/150 included, $2/50 marginal). Applied to a backlog that collapses: 2,000 notes would
be $80, more than a year of the product. Catch-up therefore needs its own price and its own field
in `plus-pricing.json`; it must not reuse `topUpFilings`.

**KD2 — The allowance ladder.**

| Plan | Free catch-up | Beyond that |
|---|---|---|
| Trial (14 days) | 100 notes | — |
| Monthly, $6 | 100 notes | $10 per 1,000 |
| Yearly, $60 | 3,000 notes | $10 per 1,000 |

Overflow is billed in whole blocks of 1,000, rounded up.

**KD3 — Catch-up must use the same quality model as normal filing.** Today's backfill defaults to
Haiku (`DEFAULT_BACKFILL_MODEL`, `src/pipeline/backfill.ts:31`) while Plus files day-to-day work
with a Sonnet-class model (`ATOMS_PLUS_MODEL`, `plus-service/src/config.mjs:54`). That is
backwards: catch-up is the largest batch a user will ever run and forms their entire first
impression, so it must not be the worst output they ever see. This roughly triples cost per note
and every number in KD2 and KD4 already accounts for it.

**KD4 — Yearly is capped at 3,000, not higher.** Costed across a yearly customer's whole first
year — catch-up plus twelve months of their 150-a-month allowance — a 5,000-note cap leaves
under $6 on a $60 plan in the worst case, and that worst case lands on the heaviest, most
likely-to-renew customer. At 3,000 the same worst case leaves about $18. Issue #168's own figures
put a three-year daily vault at roughly 2,000 notes, so 3,000 still covers the target user.

**KD5 — A purchase grants an entitlement measured in notes; there is no refund flow.** This
mirrors the shipped one-time top-up grant (`plus-service/src/stripe.mjs:310-318`,
`store.addTopUp`), including its existing safety: duplicate-event checks, price allowlist,
`payment_status` guard, and claim-before-grant. Charging and filing become separate events, so a
resumed run consumes remaining entitlement rather than re-charging, and a partial failure simply
leaves entitlement unspent. This closes issue #168's "failure/refund" and "must not
double-charge" questions without new machinery.

**KD6 — Sample first, then continue.** Catch-up files a small batch, shows the user the real
atoms it produced, and only then proceeds. This is a trust requirement before it is anything
else: three thousand mediocre atoms landing at once, at the moment of maximum trust, is not
recoverable in the way markers make it technically recoverable.

**KD7 — Show the whole number before starting.** "We found 2,997 unfiled captures, and we will
file 100 of them now" — never a count revealed after the free portion is spent.

**KD8 — Allowance counts notes actually filed, not notes promised.** A run that dies halfway must
not have burned the user's allowance for work that did not happen.

**KD9 — File most-recent-first.** Recent captures are the ones the user can still recognise, so
they carry the most conviction per note filed. Oldest-first would spend the free allowance on the
material the user is least able to judge.

**KD10 — `plus-service` has to own the batch job.** It has no Batches API usage, no cron, no
worker, and no job runner today; all long-running work currently sits client-side inside Obsidian
(`waitForBatchEnded`, `src/pipeline/backfill.ts:365`). This is the largest single piece of work in
the feature and the main reason this is a full-lane change.

### Requirements

**R1.** A Plus subscriber (trial, monthly, or yearly) can run catch-up without an Anthropic API
key. Backfill resolves credentials through the Plus-aware path already used by Process, Preview
and Update (`requireClassifyAuth`, `src/plugin/main.ts:1449`), not `requireApiKey()`.

**R2.** Before anything is filed or charged, the user sees: the total number of unfiled captures
found, how many their plan covers for free, how many remain, and what those remaining cost.

**R3.** Catch-up files a sample first and shows the resulting atoms. The user chooses whether to
continue. Declining costs nothing beyond the sample.

**R4.** Free allowance is consumed by notes successfully filed. An interrupted or failed run
leaves the unfiled remainder available.

**R5.** Overflow beyond the free allowance is a one-time purchase, priced from `plus-pricing.json`,
sold in blocks of 1,000 notes rounded up. It is not a subscription change and does not touch the
monthly filing meter.

**R6.** A purchase grants an entitlement in notes. Re-running catch-up after a failure, a restart,
or a closed vault consumes remaining entitlement and never charges again.

**R7.** Catch-up survives Obsidian being closed. The user is not required to sit and watch; work
in progress lands when the vault is next open.

**R8.** Results go through the existing write path (`planWrite` / `applyWrite`,
`src/pipeline/render.ts:466,543`), so the body stays verbatim, markers behave as they do today,
and collision policy is unchanged.

**R9.** Catch-up never touches today's daily note.

**R10.** Catch-up uses the same model quality as normal Plus filing.

**R11.** Every price displayed comes from `plus-pricing.json`. New fields are added there; no
price is computed or hardcoded anywhere else.

**R12.** The BYOK backfill path continues to work unchanged for users who prefer it.

### Flows

**First run, vault smaller than the free allowance.** User installs, signs in to Plus, opens
catch-up. Sees "2,400 unfiled captures found — your plan covers 3,000." Samples, approves, the
whole vault files. No purchase, no price shown beyond the reassurance that it is covered.

**First run, vault larger than the free allowance.** Monthly subscriber, 2,997 captures. Sees the
full count, that 100 are free, and that the remaining 2,897 cost $30 as three blocks of a
thousand. Samples the free 100 first, sees real atoms, then decides. If they decline, they keep
the 100 and owe nothing.

**Interrupted run.** A run stops partway — closed vault, failed batch, lost connection. Reopening
shows what was filed, what remains, and how much entitlement is left. Continuing charges nothing.

**Upgrade mid-flow.** A monthly subscriber facing a $30 overflow switches to yearly. Their
allowance becomes 3,000 and the overflow shrinks or disappears. This is the intended pull toward
yearly and must be legible, not hidden.

### Acceptance examples

| Situation | Expected |
|---|---|
| Trial user, 1,000 captures | 100 filed free; 900 remain; overflow quoted at $10 |
| Monthly, 2,997 captures | 100 free, 2,897 overflow → 3 blocks → $30 |
| Yearly, 2,400 captures | all 2,400 free, no purchase offered |
| Yearly, 4,200 captures | 3,000 free, 1,200 overflow → 2 blocks → $20 |
| Paid 3 blocks, run dies after 1,400 notes | 1,600 notes of entitlement remain; resuming charges $0 |
| User declines after the sample | sample kept, allowance debited only for what was filed, no charge |
| Captures in today's daily note | excluded from the count and never filed |

### Out of scope

Changing subscription prices · replacing the BYOK backfill path · Ask and mirror changes ·
capture UI · AI folder placement · anything that writes into user notes beyond the existing
marker-and-atom contract.

### Outstanding questions

1. **Delivery.** Does the plugin poll `plus-service` for finished results, or does the service
   push through the Ask outbox? The outbox is the only durable server-held queue today but caps
   at 50 open items (`OUTBOX_MAX_OPEN`, `plus-service/src/store/askHelpers.mjs:640`) against a
   catch-up of thousands. Planning decides; it does not change the product contract.
2. **Cancellation mid-entitlement.** A yearly subscriber cancels with unspent catch-up
   entitlement. Does it survive to the end of the paid period, or immediately?
3. **Block granularity.** Rounding 1,100 notes up to two full blocks of 1,000 may feel coarse.
   Blocks of 500 at $5 would be gentler at identical rates.
4. **Trial abuse.** 100 free notes per trial costs roughly 63¢ to someone who signs up, takes
   them, and leaves. Acceptable at 100; the number should not grow, and repeat-signup behaviour
   is worth watching.

### Assumptions

- Cost per note at Sonnet-class quality with the batch discount: about 0.63¢ worst case (full
  prompt priced on every request, no cache credit) and about 0.2¢ realistically. Derived from
  `estimateBatchCost` (`src/pipeline/backfill.ts:91`) scaled for the model-rate difference.
  **Unverified against a real batch — worth measuring before the prices ship.**
- A three-year daily-note vault runs roughly 2,000 captures (issue #168's own figure).
- Normal Plus filing costs roughly 1.26¢ per note — realtime, no batch discount.

### How this work fits together

The landing page currently describes catch-up as BYOK-only, deliberately, and
`test/wwwPricing.test.ts` fails if the copy pairs Plus with catch-up. Both the test and the
`#backfill` copy in `www/src/index.html.tmpl` change in the same PR that ships this.

The power-user story for tryatoms.app is queued behind this feature on purpose: its premise is a
deep, well-linked vault, and catch-up is what produces one on day one.

Two corrections to inherited documents, so planning does not chase ghosts: there is no
`BackfillGateModal` — the confirm gate is `BackfillConfirmModal`, invoked inline from
`runBackfillFlow`. And the cost-honesty rule changes character here: a fixed per-thousand price is
more honest to the user than a range, because we absorb the variance instead of narrating it.
