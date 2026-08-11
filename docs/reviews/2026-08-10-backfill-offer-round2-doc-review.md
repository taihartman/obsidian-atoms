# Round 2 doc-review — backfill offer (U5-amended + U8 + KTD9–KTD11)

**Date:** 2026-08-10 · **Plan:** [`docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`](../plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md)
**Branch:** `claude/backfill-offer-u5-u8` · **Reviewed commit:** `f9cb6f4`
**Mode:** headless · **Scope:** only what is new since round 1 — KTD9, KTD10, KTD11, U5, U8, U7's
enable-time bullet, the new Risks rows. U1–U4 + U6 shipped as 0.6.99 and were out of scope.

## Coverage

| Reviewer | Ran | Notes |
|---|---|---|
| coherence | yes | |
| feasibility | yes | highest-value lens this round — verified every code claim against source |
| product-lens | yes | |
| design-lens | yes | |
| adversarial | yes | activated on the billing/allowance surface + no upstream `product_contract_source` |
| scope-guardian | **no** | scoped round-2, below threshold |
| security-lens | **no** | no new surface — egress gate and `EGRESS_DISCLOSURE` unchanged from round 1 |
| cross-model peer (grok) | **no** | skipped for turnaround, same as round 1 |

**Independence caveat.** All five reviewers ran as separately dispatched contexts, so their
agreement is real convergence — but within one model family. No finding here carries independent
cross-model corroboration. Where two reviewers agree below, that is noted as convergence, not
confirmation.

**No `safe_auto` fixes were applied.** The one finding a reviewer classed `safe_auto` (card
dismissal lifetime) turned out to be a live disagreement between two reviewers, so it was escalated
to a user decision rather than applied silently.

## Headline

The amendment's product direction survived. Its **code claims did not** — several assertions I wrote
about the existing implementation are wrong, and two of them would have shipped as spend bugs. The
recent-first bet, the shrinking reserve, and the top-up branch all stand; the mechanism described for
delivering them does not match `write.ts`, `plusClient.ts`, or the confirm modal as they actually
exist.

---

## P0 — must fix before implementation

### 1. `runWritePath` has no `before` bound, so U8 cannot express the complement
**Convergent: feasibility (100) + adversarial (100).** `RunWritePathOptions` carries only `since`,
and the scan call at `src/pipeline/write.ts:116-119` forwards `{ includeToday, since }`. U2 added
`before` to `GetUnprocessedOpts` (`src/pipeline/daily.ts:57-58`) but deliberately never threaded it
into the write path. U8 says "reuse `runWritePath` with the complement bound" — the bound it needs
does not exist on the function it names.

Implemented literally, a Plus backfill passes the derived `since` with no upper bound and files
**everything from that date to today**, including the entire filing window auto-run already owns.
That is metered double-spend on exactly the captures KTD3 exists to exclude. U8's own test cannot
pass against the current signature.

**Fix:** `RunWritePathOptions` gains `before?: string`, forwarded alongside `since`. State that the
Plus backfill passes **both** bounds and that `since` alone is the double-spend. Add the test.

### 2. `runWritePath`'s pacing slice is oldest-first, inverting KTD10
**Convergent: adversarial (100) + feasibility (75).** `runWritePath` sorts work by
`note.path.localeCompare` ascending, then takes `work.slice(0, max)`
(`src/pipeline/write.ts:129-137`). Daily paths are date-named, so ascending is **oldest-first**, and
the slice keeps the oldest.

So a user who taps the recent-first offer gets the oldest dailies in the range filed first, and any
paced or `exhausted`-truncated run leaves the notes they can actually judge unfiled. KTD10's entire
product bet silently reverses at the first cap. No unit or test in the plan mentions ordering
*inside* the range.

**Fix:** the Plus engine orders dailies newest-first before slicing (preserving the bottom-up
line ordering *within* a daily — that is what keeps marker insertion from shifting later lines), or
runs the derived range without `maxCaptures` at all, since the range is already budget-bounded.

### 3. The meter cannot be read the way KTD9/U8 describe
**Convergent: feasibility (100) + adversarial (100), from different directions.**

`classifyViaProxy` is a **POST to `/v1/classify`** (`src/platform/plusClient.ts:644-686`) — it
returns `remaining` only as a side effect of actually classifying a capture. There is no way to
"read the meter when the modal opens" from it without spending a filing and writing an atom, which
is the unasked spend this plan exists to prevent. The real pre-run source is `getEntitlement`
(GET `/v1/me`, `:600-612`) via `refreshPlusEntitlementRecord`.

That also **invalidates KTD9's "mixed freshness" framing.** `parseEntitlement` (`:287-311`) returns
`status`, `remaining` **and** `periodEnd` from the same response and refuses the record unless status
and remaining are both present — so at modal-open time all three are equally fresh. The split I
described is a property of the in-run classify response, not of the confirm modal.

And the freshness guard as written cannot fire at all: `requireClassifyAuth`'s `onRemaining`
(`src/plugin/main.ts:1908-1919`) rewrites `{ ...session, remaining, status, refreshedAt: Date.now() }`
on **every** classify call — spreading the old `periodEnd` forward while stamping `refreshedAt`
fresh. `refreshedAt` therefore measures `remaining`'s freshness, never `periodEnd`'s. A user who
files daily but whose entitlement refresh has been failing for weeks carries a months-old `periodEnd`
that every freshness check reports as seconds old.

**Fix:** on modal open, refresh with `refreshPlusEntitlementRecord`; all three values arrive
together. Rewrite KTD9's guard so the fallback trigger is "the entitlement refresh failed or was
rejected", not "`periodEnd` is the stale half". State explicitly that `refreshedAt` must **not** be
the staleness input for `periodEnd`.

### 4. The reserve has no lower bound, so a past `periodEnd` inflates budget above `remaining`
**adversarial (100).** The formula floors `budget` at 0 but never floors `reserve`. `daysRemaining`
is signed and computed from a date that can be in the past — an expired period, a skewed clock, the
rollover moment itself. At `daysRemaining = -3`: `min(50, -12) = -12`, so
`budget = max(0, remaining + 12)`.

The plan offers to spend twelve filings the user does not have, and the modal states a count the
meter cannot honor — violating KTD7's own "never state a count it cannot source" from inside the
mechanism written to protect it. My stated guard ("`min` … never above it") bounds the reserve above
and nothing bounds it below.

**Fix:** `reserve = fresh ? clamp(daysRemaining × DAILY_BURN, 0, RESERVE_BASELINE) : RESERVE_BASELINE`,
and treat non-positive `daysRemaining` as expired/unknown → full baseline, not zero. Test: `budget`
never exceeds `remaining`.

### 5. The confirm modal's privacy line is Batch-API-specific and would be wrong for Plus
**feasibility (100).** The modal body is hardcoded to the BYOK Batch engine on every line
(`src/pipeline/backfill.ts:869-900`): "Uses the Anthropic Message Batches API (async, ~50% off)",
the per-chunk sentence, and critically **"Privacy: this sends historical captures and your title
graph to Anthropic's Batch API (server-retained for a window)"**.

Shown to a Plus user whose captures go through the Atoms Plus proxy, that sentence is **factually
wrong at the exact moment of consent**. "One confirm modal" therefore requires an engine-mode split
of the whole body, not a widened `CostEstimate` — materially more work than U5 budgets, and a
consent-accuracy defect if missed.

**Fix:** the modal takes an engine discriminant. Every Batch-API-specific line, including the privacy
sentence, lives in the BYOK branch. The Plus branch names the Plus proxy as the destination. Test:
the Plus branch renders no Batch-API or Anthropic-direct privacy string.

### 6. U7's enable-time copy routes new users into the unbounded, unpriced sweep
**product-lens (75).** My new bullet tells the user, at the moment they enable filing, that "Process
handles what is already waiting". `Process unprocessed captures` is the **one path this plan
explicitly leaves unbounded and unpriced** — no window, no estimate, no recent-first ordering, no
budget.

On a Plus trial that single recommended tap can spend the entire 150-filing allowance on years-old
notes — precisely the harm KTD9 and KTD10 exist to prevent — and it makes the launch post's claim
that the product "shows a cost estimate before processing a big history" false *for the path the
product itself recommends*. The amendment promoted a deliberately-buried hazard to a first-run call
to action.

**Fix:** point the enable-time line at the backfill offer, not at Process. e.g. "Filing starts with
tomorrow's note. Older notes stay untouched until you ask for them."

---

## P1 — fix before implementation, or record as an accepted residual

7. **`prepareBackfillEstimate` must keep its required `apiKey`** — feasibility (100). My U5 bullet and
   the matching Risks row say to make it optional. That is wrong and harmful: the key is passed to
   `countTokensForClassifyRequest`, which POSTs to Anthropic's count_tokens with `x-api-key` and
   throws on non-2xx (`backfill.ts:181-215`, called at `:443-446`). Loosening it produces a function
   that throws or returns a meaningless zero for exactly the Plus device it was loosened for. The
   Plus branch should never call it — U8 already resolves this correctly (a capture count, not a
   `CostEstimate`). Retarget the Risks row at `runBackfillFlow`'s `requireApiKey()` as the single
   real BYOK gate. *(Coherence independently flagged the same gap without the resolution.)*

8. **BYOK's recent-first range has no stopping rule** — convergent: feasibility (100) + adversarial
   (100) + product (75). KTD10 derives the range by "accumulating captures until the budget is
   reached"; KTD9 says BYOK has no budget but still takes the range. With no budget there is no
   accumulator ceiling, so U5 has no value for `since` on the BYOK branch. Needs a decision (see
   Decisions below).

9. **`RESERVE_BASELINE` 50 was sized for a 14-day trial and applied to a 30-day month** —
   product (75). Settings already says "This month's included filings are used up", so the paid
   period is monthly: 150 filings ≈ 5/day, and 50 reserved covers only 10–17 of 30 days. The shrink
   guard does not help — `min(50, daysRemaining × 4)` equals 50 for the first ~18 days of a monthly
   period, i.e. it is at its most undersized exactly when the card is most likely to be tapped.

10. **`DAILY_BURN` 4 is the midpoint of its own range** — convergent: product (75) + adversarial
    (75). A reserve is a floor for the worst plausible case; sizing it on the midpoint guarantees it
    is too small for roughly half of users by construction. At the doc's own upper bound of 5/day a
    14-day trial needs 70 and the formula reserves at most 50 — so the heaviest capturer, the best
    conversion prospect, is the one whose loop goes dark first. The amendment applies fail-closed
    reasoning correctly to stale `periodEnd` and then abandons it in the constant that matters most.

11. **Card dismissal and the per-period re-offer specify opposite lifetimes** — convergent: product
    (75) + adversarial (75) + design (50). KTD9 says the card re-offers each period until the
    complement drains; U5 says it is dismissible and device-persisted. Neither says which wins.
    Needs a decision (see below).

12. **Zero-budget is a common state with no defined behavior** — convergent: product (75) + design
    (75) + feasibility (75). `budget = 0` whenever `remaining` is at or below the reserve — roughly
    the last third of every month for a 4/day user, and permanently for a heavy user. U5 gates the
    card on the *complement* being non-zero, so the card renders and invites a tap into a flow that
    files nothing. Needs a decision (see below).

13. **The card's headline count can promise the complement while the flow files the budget** —
    convergent: design (75) + adversarial (75). U5 gates on the complement count, and nothing says
    the headline number must be the budgeted figure. "1,847 past captures" on a card that files ~100
    is the broken promise — and it is the common case on any real vault, not an edge case.

14. **The budget is device-local; the meter is account-wide** — adversarial (75). Two devices signed
    into one account each read `remaining`, each subtract their own reserve, and each offer a full
    budget over overlapping ranges (KTD6 makes the windows diverge by design). Accept on both and
    the account spends up to 2× the intended budget, consuming the reserve KTD9 exists to protect.

15. **U8 cites `exhausted` handling in the write path that does not exist** — feasibility (75).
    `runWritePath` accumulates per-capture failures via `pushFail` and continues through the whole
    slice (`write.ts:147-175`); the Plus 402 is a per-capture error in `classify.ts:859`. A
    100-capture backfill that exhausts at capture 30 makes 70 further doomed proxy round-trips and
    reports `failed: 70` with no way to distinguish exhaustion from network failure — the opposite of
    "stops cleanly, reports what filed". The Risks-table mitigation depends on behavior that is not
    there.

16. **#429's far-past stamp deletes the priced road entirely** — adversarial (75). A well-formed
    `1970-01-01` stamp makes the complement **empty**: U5's card never renders, no estimate is
    computed, no reserve is held, and KTD9's budget — which binds only the backfill path — applies to
    nothing. The whole history then flows through the *unattended* per-capture Plus path at
    `PER_LAUNCH_CAP` per pass, which the plan's own Problem section calls strictly more expensive
    than Batch. The one condition that reopens the sweep is the condition that removes the priced
    alternative, and no Risks row names it.

---

## P2 — worth fixing, not blocking

17. **The `daysRemaining` rule forbids the only correct arithmetic** — feasibility (75). A day
    *difference* cannot be computed lexically from `YYYY-MM-DD`; the DST-safe implementation is
    `Date.UTC(...)` subtraction over 86_400_000 — millisecond subtraction, which my rule bans with no
    alternative offered. Name the algorithm instead: both operands are UTC midnights derived from
    `YYYY-MM-DD` substrings, so no local offset can enter, and `periodEnd.slice(0,10)` is the same
    substring Settings renders. The ban is on subtracting raw ISO instants, not on UTC-anchored day
    arithmetic.

18. **The scan returns unsorted notes** — adversarial (residual). `getPastDailyNotesWithUnmarkedCaptures`
    returns `Object.values(getAllDailyNotes())` order with no sort. KTD10's "ordering dailies
    newest-first" assumes an ordering the scan does not guarantee. Cheap to fix, easy to omit.

19. **The meter is read at open and spent after confirm** — adversarial (75). Forward filing does not
    stop while the modal is open — `maybeAutoRun` fires on load, hourly, and on every resume. A user
    who confirms an hour later approves a range priced against an allowance that has since shrunk.

20. **The pause compounds into the next period** — adversarial (75). When `remaining` hits 0,
    unattended filing stops but *capturing does not*: everything written during the pause lands
    inside the filing window, unmarked, and is filed out of the **next** period's allowance. Under
    `rollover: false` that can sustain itself. This is the strongest argument for the reserve
    existing at all, and KTD11's aftermath sentence describes only a gap, not a compounding backlog.

21. **A top-up does not recompute the range** — adversarial (75). Nothing says what happens after the
    user pays $2: most likely implementation shows the same offer, which is the dead end KTD11 exists
    to eliminate, arrived at one purchase later.

22. **Repeated $2 top-ups are the only road through a multi-year vault** — product (75). $0.04/filing
    against a $6/month subscription, when the plan already ships a strictly cheaper engine (BYOK
    Batch) behind the same gate. Worth naming the batch route for very large complements rather than
    letting the offer read as farming the heaviest users.

23. **No conversion signal, though the server already has one** — product (75). The plus-service
    already meters filings per account and knows trial-to-paid outcomes, so two signals need no new
    client telemetry and no privacy-posture change: (a) trial-to-paid split by whether the account
    ran a backfill, (b) share of accounts hitting `exhausted` before period end, split the same way.

24. **KTD11's aftermath needs visual separation, not another paragraph** — design (75). The modal's
    existing pattern is a flat list of same-weight `<p>` tags; an aftermath sentence added to that
    list reads like the arithmetic around it and gets skimmed — defeating the purpose KTD11 states.
    Settings' existing exhausted-state block (`settings.ts:1268-1276`) is the tone precedent.

25. **Concrete modal hierarchy is unspecified** — design (75). The live modal already renders 7–8
    undemoted paragraphs plus 2 demoted asides; the amendment adds three more elements. Proposed
    order: (1) budgeted count in the current currency, (2) the range covered, (3) aftermath callout
    when over budget, (4) everything else collapsed into one details tier.

26. **Plus backfill takes no in-flight guard** — feasibility (75). `backfillInFlight` is set only
    inside `runBackfillFlow`; `autoRunInFlight` only by `runAutoFilingCycle`. A Plus backfill routed
    through `runWritePath` takes neither, so the hourly `maybeAutoRun` can start a concurrent run and
    pin a second context corpus.

---

## Decisions needed from the owner

These are genuine forks where reviewers disagreed or the plan has no defensible default.

| # | Decision | Options |
|---|---|---|
| A | **BYOK's stopping rule** | Same ~100-capture cap as Plus (symmetric demo) · 30 days back from the window · no artificial range at all — show the full complement's dollar estimate and let the confirm modal do the work |
| B | **`RESERVE_BASELINE`** | Keep 50 · make it `daysInPeriod × DAILY_BURN` (~56 trial / ~120 month) so the shrink actually does work on both period lengths |
| C | **`DAILY_BURN`** | Keep 4 · raise to 5 (fail closed at the range's top) · derive from this device's observed recent capture rate, falling back to 4 |
| D | **Dismissal lifetime** | Permanent per device (product-lens: protects the quiet posture) · period-scoped, returns at reset (adversarial: otherwise the multi-period design collapses to one shot) |
| E | **Zero-budget card** | Suppress the card entirely, explain in Settings · render with the top-up as the only action |

## Residual risks carried

- Home is becoming a commerce surface (offer card, filings currency, $2 top-up) on a product
  positioned as quiet by default. Each element is defensible; the accumulation is a positioning
  drift no single KTD owns.
- A heavy capturer (~15/day) exhausts a monthly allowance on forward filing alone, so backfill is
  permanently unreachable for them regardless of the arithmetic. The plan never states who the
  allowance is sized for.
- Period rollover mid-run is unhandled: a long backfill crossing `periodEnd` sees `remaining` reset
  upward mid-flight and neither the quoted range nor the reserve is recomputed.
- `resolveFilingAuth` returns `remaining` and `periodEnd` but not `refreshedAt`
  (`filingAuth.ts:139-150`), so a budget computed "from `resolveFilingAuth()`" as U5 specifies cannot
  see any freshness signal without a second read of the session.
- Nothing bounds how often the offer can be accepted within one period.
- KTD10's full-history read is safe for *money* but is an unbounded `cachedRead` loop on an attended
  tap with no progress surface; U4 already had to sequence behind `waitForVaultIndexReady`.

## Deferred questions

- Is the Plus meter enforced server-side per request? If the server refuses past zero, several
  client-side budget hazards degrade from overspend to bad copy — worth stating in KTD9.
- Is the trial allowance also 150 filings, or a different number? Every magnitude in KTD9 assumes the
  same pot across a 14-day and a 30-day period.
- A user with **both** a Plus session and a BYOK key: `resolveFilingAuth` prefers Plus, so the
  cheaper unmetered Batch engine becomes unreachable for exactly the users with the largest backlogs.
  Deliberate?
- Is one capture always one filing? KTD9's arithmetic assumes 1:1 but never says so.
- Does the Plus service rate-limit `/v1/classify` in a way a ~100-capture sequential run would trip?

---

## Decisions resolved (2026-08-10, owner)

| # | Decision | Resolution |
|---|---|---|
| A | BYOK stopping rule | Same cap as Plus (**50**). One card shape, one modal, one code path; recent-first stays meaningful for BYOK. Unbounded command remains the escape. |
| B | Reserve sizing | **Reframed by the owner.** Backfill gets a deliberate per-period cap on trial *and* paid, so the backlog drains over periods and the subscription keeps earning. `budget = min(BACKFILL_CAP, max(0, remaining - reserve))`. Trial: reserve 70, cap 75. Paid: reserve 100, cap 50. |
| C | `DAILY_BURN` | **5**, not the midpoint 4 — applied without asking, since fail-closed at the top of the range is the plan's own doctrine and two reviewers converged on it. |
| D | Dismissal lifetime | **Period-scoped.** Returns at reset while the complement is non-empty; permanent dismissal would collapse the multi-period drain into one shot. Bounded by voice rules — quiet home card, never a notification or a growing count. |
| E | Zero budget | **Suppress the card.** Render condition is `complement > 0 AND budget > 0`. Backfill stays in Settings where the state is explained. |

### Fact established while resolving B

`grantPeriod` uses `opts.remaining ?? config.includedFilings` with no trial override
(`plus-service/src/store/memory.mjs:118-127`), so **a trial gets the same 150 filings over 14 days
that the paid plan gets over 30**. That answers the review's open question and forces the
period-specific constants: the trial has ~10.7 filings/day of headroom, the paid plan has exactly
5.0 — the top of the assumed burn range.

**Consequence the owner should hold onto:** the paid plan has no slack at the assumed burn rate. A
paid `RESERVE_BASELINE` of 100 is a bet that sustained real burn is nearer 3.3/day than 5. If the
observed rate comes in high, the lever is `includedFilingsPerPeriod` in `plus-pricing.json` — a
pricing decision — not a smaller reserve, which would trade a visible upsell for an invisible outage
in the daily loop the user is paying for.

### Still open

Not blocking implementation, but unresolved and recorded in the plan:

- The account-wide meter vs device-local budget (two devices each offer a full budget).
- #429's far-past stamp emptying the complement and routing the whole history through the
  unattended path unbudgeted.
- Whether the Plus meter is enforced server-side per request, which would downgrade several
  client-side budget hazards from overspend to bad copy.
