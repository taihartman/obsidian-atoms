# Plan — Automatic filing files forward; backfill becomes a separate, asked-for job

**Date:** 2026-08-10 · **Lane:** full (gate change, spends money, touches consent surfaces)
**Why this lane:** the change alters what unattended filing is allowed to touch across a user's
entire vault history, and gets the count/file coupling wrong in a way that silently rescans forever.
**Doc-review:** round 1 complete (coherence, feasibility, product, design, security, adversarial).
**Status:** Ready. KTD1 and KTD7 settled by the user 2026-08-10 (`session-settled: user-directed`).
**Claim:** not yet claimed. Issue + STATUS row + draft PR required before any implementation.

---

## Problem

Turning on **automatic filing** today is, in effect, an unbounded backfill of the user's entire
daily-note history. Nothing says so, nothing prices it, and nothing asks.

Verified in the current code:

- `getPastDailyNotesWithUnmarkedCaptures` enumerates `getAllDailyNotes()` with no lower date
  bound (`src/pipeline/daily.ts:72-81`). Every unmarked capture ever written is work.
- `runWritePath` slices that work to `maxCaptures` (`src/pipeline/write.ts:128-129`), which
  auto-run sets to `PER_LAUNCH_CAP = 15` (`src/platform/autorun.ts:32`).
- `shouldRunAutoProcess` deliberately re-runs within the same calendar day while
  `pastUnprocessedRemaining > 0` (`src/platform/autorun.ts:56-60`), and `maybeAutoRun` is
  driven by load, an hourly interval, and every resume signal (`src/plugin/main.ts:958-969`).

So one toggle drips ~15 captures per pass until an entire archive has been classified and every
matching daily line has gained a `↳ [[…]] <!--linker-->` marker. For a multi-year vault that is
thousands of API calls the user never approved, spread thin enough to be invisible.

The inversion is the tell. The **explicit** batch backfill prices the job and blocks on
`BackfillConfirmModal` before spending anything (`src/plugin/main.ts:1238-1250`). The **implicit**
drip path — strictly more expensive, because it is per-capture rather than Batch API — shows
nothing at all. The cheap, confirmed road is gated; the expensive, silent one is not.

This is also a product-honesty problem ahead of a public launch post. "Install it and nothing
happens to your notes until you opt in" is true today only up to the toggle; after the toggle, the
scope of what gets rewritten is unbounded and undisclosed.

**Trial spend is a related but weaker argument than round 1 assumed — see KTD7.** Review
established that the batch backfill bills the user's own Anthropic key, not Plus filings, and that
the Plus `remaining` field is a per-period allowance rather than a one-shot trial pot
(`src/platform/filingAuth.ts:22-27`). The unattended drip path *does* spend Plus filings, so the
core claim survives — an unbounded sweep can consume a trial on years-old notes before the user
sees Atoms work on a note they remember — but any copy about "your trial" must be written against
what the code actually meters.

## Outcome

**Automatic filing means: file what I capture from now on.**
**Backfill means: go get my history — priced, confirmed, and asked for.**

After this change:

- Enabling automatic filing touches only recent dailies (the *filing window*).
- Everything older is unreachable from any unattended path.
- The older work is surfaced as an offer with a count, routed to the existing estimate + confirm
  batch flow.
- Turning the toggle on and walking away can no longer rewrite a year of notes.

## Non-goals

- **Widening** what the egress disclosure covers. The rule is directional: *narrowing* what an
  unattended path reaches never requires re-consent, so **no `EGRESS_ACK_VERSION` bump here**, and
  `egressConsentParity.test.ts` stays green untouched. Any later change that *widens* an unattended
  path's reach — raising `GRACE_DAYS`, re-opening the manual catch-up — must be re-checked against
  `EGRESS_DISCLOSURE` (clause (3) is already a reach limit) and bumped if the text no longer
  describes what the device does. If a unit finds itself editing `EGRESS_DISCLOSURE`, that unit has
  left this plan's scope — stop and escalate.
- Reworking the Anthropic Batch API backfill itself. This plan bounds its input and gives it a home
  surface; the BYOK flow is otherwise as-is. Plus users get a second engine over the existing
  classify route (KTD7 / U8), not a change to this one, and no plus-service work.
- The attended `Process unprocessed captures` command. It stays unbounded and unpriced by design
  (explicit user force, non-negotiable #3). Review flagged that a first-time user on a multi-year
  vault can still spend heavily in one tap there — filed as a follow-up, not scoped here.
- Changing marker semantics, the flat-folder rule, or anything about how atoms are rendered.
- Today's daily note. It stays excluded from every unattended path, exactly as now.

---

## Key technical decisions

### KTD1 — Strict enable-date window, with an attended first run · `session-settled: user-directed`

**Decision:** the filing window starts on the day automatic filing is enabled. **No lookback.**
Nothing before that day is ever touched by an unattended path. Deeper history is reachable only
through the backfill offer (KTD7), which the user taps when and if they want it.

Round 1 proposed a 7-day grace because a strict window files nothing on day one — auto-run never
includes today (`src/plugin/main.ts:1094`), so the user accepts a disclosure and sees nothing until
tomorrow. **Rejected:** two reviewers independently identified the grace as itself an unasked
backfill of a week — no count, no price, no confirm — the same shape as the problem this plan
exists to fix, only smaller, and the shape a launch-post commenter finds.

**Day one comes from an attended run instead.** The enable tap fires one run with
`includeToday: true`. The call site already exists: `enableAutomaticFilingFromHome` calls
`maybeAutoRun("manual")` immediately after enabling (`src/plugin/main.ts:998-1003`). A run triggered
by the user's own tap is explicit user force, which non-negotiable #3 permits for today's daily.
This buys literal honesty *and* a visible result on day one.

This also retires the round-1 scale error — a time window bounds days, not spend; seven days at 30
captures/day is ~210 filings, and `PER_LAUNCH_CAP` is a per-launch throttle, not a ceiling
(`src/platform/autorun.ts:56-60`). With no lookback there is no first-pass bulk to cap: the window
starts empty and fills one day at a time. The count-ceiling question KTD8 raises is therefore moot
for the window and lives entirely with backfill, which is confirm-gated.

### KTD2 — One bound, resolved once, and it fails closed

`maybeAutoRun` couples the count and the work: it counts before the run, subtracts
`markersAppended`, re-counts, and stamps the calendar day only when `shouldStampLastRunDay` sees
zero remaining (`src/plugin/main.ts:1115-1122`).

**If the count keeps scanning all history while the write path files only the window, the count
never reaches zero, the day is never stamped, and auto-run rescans the whole vault every hour
forever.** Feasibility confirmed this failure is real against the live control flow. It is silent —
the cost is vault reads and a `beginRun` per pass, not API spend, so nothing surfaces it.

Therefore: one bound, resolved once, passed to *both* `countPastUnprocessed` and `runWritePath` in
the same call. A test freezes the coupling (V2).

**And the bound must fail closed.** Round 1 made `since` optional with "absent keeps today's
behavior" — which means any device that cannot resolve a start day silently reverts to scanning all
history. Security and adversarial both landed on this independently, and it is the original bug
wearing the new plan's clothes.

`resolveAutoFilingSince(load, save, today)` in `src/platform/autorun.ts` returns a `YYYY-MM-DD`
**unconditionally**: the stored stamp when it parses as a well-formed date, otherwise it stamps and
returns the window start for today. It is a **non-optional** parameter on every unattended path —
`maybeAutoRun`, the U6 manual catch-up, the U5 complement. `since?: string` stays optional only on
the attended commands, where unbounded is the documented intent.

This closes the hole adversarial found: a device that **never enabled** automatic filing can still
reach filing through "Sync everything now" (`bypassEnabled: manual`, `src/plugin/main.ts:812-819`,
permitted by the catch-up notice alone). U3 stamps only on enable and U4 migrates only enabled
devices, so that device has no stamp — and under the round-1 rule it would sweep everything.

### KTD3 — Backfill is the complement, per device, and only while filing is on

The backfill estimate covers captures **strictly before** the window start — not "all past", which
would double-count work auto-run will do for free and quote a price for work that vanishes first.

Two qualifications review forced, both of which round 1 stated too absolutely:

- **Per device.** KTD6 makes windows diverge across devices by design, so a phone enabled Aug 10
  will offer backfill for work a desktop enabled Aug 1 is already filing. The partition is
  per-device; it is not a global invariant.
- **Only while enabled.** Disable preserves the stamp (KTD6), so a device that enabled Aug 1 and
  disabled Aug 2 would leave everything after Jul 25 in neither set — no unattended path files it
  and the offer card excludes it. When the toggle is **off**, the stored start day is ignored and
  the backfill offer covers all past captures.

### KTD4 — "Sync everything now" is scoped to the window too

The manual catch-up passes `bypassEnabled: manual` and files even with the toggle off
(`src/plugin/main.ts:812-819`). Left unscoped it becomes the new silent full-history sweep — one
tap, no estimate — and the name invites exactly that.

It resolves its bound through `resolveAutoFilingSince` (KTD2), so an unstamped device is bounded
rather than unbounded. History stays behind the priced backfill offer.

The name is not changed here (out of scope, and it appears verbatim in `EGRESS_DISCLOSURE` clause
(2), which stays literally true). Security noted the residual: a control disclosed as "Sync
everything now" will no longer sync everything, which errs toward the user expecting *more* than
happens — the safe direction, but worth a rename follow-up.

### KTD5 — Already-enabled devices are re-stamped, and told why

Devices with automatic filing already on carry no start day. On first load after upgrade, stamp the
window start and surface the remainder as an explicit backfill offer.

This deliberately **pauses in-progress silent sweeps**. That is the point, and it is the honest
default: nobody consented to the sweep.

But release notes are the wrong and only channel round 1 chose — a BRAT or Community auto-update
never shows them, so a paying user watches filing stop and concludes the plugin broke. **U4 records
a migrated-device flag** alongside the stamp, and **U5 renders distinct copy on those devices** that
names the pause rather than reading as a new upsell. Release note stays as well.

### KTD6 — The start day is device-local, and re-enabling re-stamps

It sits beside `LS_AUTO_RUN_ENABLED` in `localStorage`, never `data.json` — same rule as every
other auto-run gate.

Consequences, accepted:

- Two devices enabled on different days have different windows. The union is filed. Markers
  deduplicate **once a device has synced the marker** — round 1 claimed idempotency unqualified,
  but two devices classifying the same capture before Sync propagates can produce different titles,
  which the collision guard (`src/pipeline/render.ts:545-560`, keyed on title plus body) reads as
  no collision: two atoms, two markers, double spend. V4 covers the concurrent case.
- A gap only one device could have covered stays unfiled if that device never runs. That gap is
  backfill territory, and the offer names it.
- Disable → re-enable stamps a **new, later** start day. The stamp only ever moves forward, which
  fails closed.
- `LS_AUTO_RUN_START_DAY` is writable by any other plugin or a devtools session. Same property as
  `LS_AUTO_RUN_ENABLED`, so not a regression — but `resolveAutoFilingSince` rejects anything that
  does not parse as `YYYY-MM-DD` rather than passing it through.

### KTD7 — Backfill has two engines behind one gate · `session-settled: user-directed`

**Decision:** both Plus and BYOK users can backfill. **No plus-service change is required.**

Round 1's version of this KTD was factually wrong and is withdrawn. It priced the confirm modal in
"filings remaining against your trial" while assuming the existing batch flow could serve a Plus
user. Feasibility disproved that:

- `runBackfillFlow` opens with `requireApiKey()` (`src/plugin/main.ts:1206`) and Notices "set your
  API key in settings" for any Plus-only device — a Plus user cannot reach it at all.
- Every backfill request goes direct to Anthropic with `x-api-key`
  (`src/pipeline/backfill.ts:207, 492, 522, 612`), because it uses the **Anthropic Batch API**,
  which Plus does not proxy. It spends no Plus filings.

The fix is a second engine, not a server endpoint. The Plus classify route already exists and
already meters: `classifyViaProxy` posts `/v1/classify` and returns `remaining`
(`src/platform/plusClient.ts:644-682`), and `classify.ts` accepts a `plus` dep and reports the meter
back through `plus.onRemaining` (`:817`). That is the same path the unattended drip already uses.

| Auth | Engine | Priced in |
|---|---|---|
| **BYOK** | Anthropic Batch API — the existing `runBackfillFlow`, unchanged | dollars (existing `CostEstimate`) |
| **Plus** | the existing Plus classify path over the complement, bounded and confirm-gated | filings, from the live `remaining` meter |

One gate, one offer card, one confirm modal; the engine and the currency are chosen from
`resolveFilingAuth()`. Trade accepted: the Plus engine is per-capture rather than Batch API, so it
is slower and less efficient per capture — but the user is spending metered filings, not paying
Anthropic directly, and the meter is authoritative and live rather than cached.

Three constraints hold regardless of engine:

- **Never state a count it cannot source, or one that is stale.** `PlusSession.remaining` is a
  cached snapshot with a `refreshedAt` sibling (`src/platform/filingAuth.ts:22-27`); the modal uses
  a value read when it opens, and falls back to the cost line on a failed, unauthenticated, or
  stale read. A confidently wrong "more than your plan covers" is worse than no claim.
- **`remaining` is a per-period allowance, not a one-shot pot.** Copy must not imply a permanent
  loss. It refills; the cost of over-spending is a wait, not a foreclosure.
- **The over-budget branch states the aftermath, not just the arithmetic** — that confirming spends
  the remaining allowance and forward filing pauses until it resets or the user upgrades.

### KTD8 — Why a date window and not the existing count gate

The repo already ships a count-based gate on this exact filing stage: `BACKLOG_GATE_THRESHOLD`,
`readBacklogGate` / `backlogGateCleared` (`src/platform/resume.ts:23, 191-199, 375-390`), which
blocks unattended filing and asks once when pending work is large. Round 1 never named it, and
adversarial correctly flagged that this plan otherwise builds a second, parallel bounding mechanism
with different semantics on the same stage.

**Rejected: extending the backlog gate to cover `pastUnprocessedRemaining`.** A count gate asks
"is this a lot?" and, once cleared, still authorizes the entire archive — one tap and the sweep
resumes unbounded. The user's objection is not that the sweep is *large*, it is that history is
*not what they asked for*. Only a date axis expresses "from here on"; a count axis expresses "not
too much at once", which is a throttle, not consent.

**Accepted as a complement:** if KTD1 keeps any lookback, the count gate is the right mechanism for
the capture-count ceiling that lookback needs (see KTD1). The two gates then compose — date bounds
*what*, count bounds *how much at once* — rather than duplicating.

### KTD9 — Backfill spends a period budget, and the reserve shrinks as the period ends · `session-settled: user-directed`

Commercial numbers come from `plus-pricing.json`, the SSOT — never restate them in code or copy:
`includedFilingsPerPeriod` **150**, `trialDays` **14**, top-up **50 for $2**, **`rollover: false`**.

`rollover: false` drives the whole design: **unspent filings expire at period end.** A user who
"saves" filings throws them away, so a conservative cap does not protect them — it destroys value
they already paid for and costs the conversion it was meant to protect.

So backfill does not get one shot at the whole allowance, and it does not get a timid slice either:

```
reserve = fresh ? clamp(daysRemaining × DAILY_BURN, 0, RESERVE_BASELINE) : RESERVE_BASELINE
budget  = max(0, remaining - reserve)
```

**`clamp`, not `min` — the reserve needs a floor as well as a ceiling.** `daysRemaining` is signed
and derived from a date that can be in the past: an expired period the refresh has not replaced, a
skewed device clock, the rollover moment itself. With a bare `min`, `daysRemaining = -3` gives
`min(50, -12) = -12` and `budget = remaining + 12` — the offer spends filings the user does not have
and the modal states a count the meter cannot honour, breaking KTD7's "never state a count it cannot
source" from inside the mechanism written to protect it. A non-positive `daysRemaining` means
expired or unknown, which takes the **full baseline**, never a zero reserve.

`RESERVE_BASELINE` **50**, `DAILY_BURN` **4** (midpoint of a realistic 3–5 captures/day). At the
start of a 14-day trial that reserves 50 and offers ~100 — 14 days at 3–5/day is 40–70 filings of
ongoing use, so 50 keeps the daily loop genuinely observable while ~100 buys a real backlog demo.

**The open question from the round-1 handoff is answered: yes, the reserve shrinks.** On day 12 of
14, reserving 50 for two days of use strands ~42 filings that expire days later, and the daily loop
those 50 were protecting has already been observed for twelve days. The reserve has done its job;
holding it past that point is pure waste under `rollover: false`.

Two guards make the shrink safe:

- **It only ever shrinks, never grows.** The `clamp` ceiling means a long or unknown period lands on
  the baseline, never above it.
- **Uncertainty keeps the full reserve.** Failing closed here means reserving **more**, because the
  harm to avoid is a user spending their forward filing on history.

**Read the meter with `getEntitlement`, not with a classify call.** `classifyViaProxy` is a POST to
`/v1/classify` (`src/platform/plusClient.ts:644-686`) — it returns `remaining` only as a side effect
of actually classifying a capture, so "read the meter when the modal opens" through it would spend a
filing and write an atom to price an offer the user has not accepted. The pre-run source is
`getEntitlement` (GET `/v1/me`, `:600-612`) via `refreshPlusEntitlementRecord`
(`src/platform/plusRefresh.ts:92-135`).

That also settles freshness as **one** question rather than two. `parseEntitlement` (`:287-311`)
returns `status`, `remaining` **and** `periodEnd` from the same response and refuses the record
unless status and remaining are both present, so on modal open all three are equally fresh. The
fallback trigger is therefore "the entitlement refresh failed or was rejected" — then use the cached
session and take the baseline reserve.

**Do not use `refreshedAt` as the staleness input for `periodEnd`.** `requireClassifyAuth`'s
`onRemaining` (`src/plugin/main.ts:1908-1919`) rewrites `{ ...session, remaining, status,
refreshedAt: Date.now() }` on every classify call — carrying the **old** `periodEnd` forward while
stamping `refreshedAt` fresh. So `refreshedAt` measures `remaining`'s freshness and never
`periodEnd`'s, and a user who files daily while their entitlement refresh has been failing for weeks
carries a months-old `periodEnd` that any `refreshedAt` check reports as seconds old. That is the
exact input this guard exists to catch, and `refreshedAt` cannot see it.

**`daysRemaining` arithmetic.** Both operands are UTC midnights built from `YYYY-MM-DD` substrings:

```
daysRemaining = max(0, floor((Date.UTC(...periodEnd.slice(0,10).split("-"))
                            - Date.UTC(...localDateString().split("-"))) / 86_400_000))
```

The Risks-table ban is on subtracting raw ISO **instants**, not on UTC-anchored day arithmetic — a
day *difference* cannot be computed lexically, so this is the DST-safe form, and neither operand
carries a local offset that could shift it. `periodEnd.slice(0,10)` is the same substring Settings
renders as `Renews <YYYY-MM-DD>` (`src/settings/settings.ts:1254-1255`), so the two can never
disagree on screen. Unparseable or past `periodEnd` → treat as unknown → baseline reserve.

**Call it a period reserve, not a trial reserve.** A paid user has the identical `rollover: false`
problem, so the same budget applies after conversion and the card re-offers each period until the
complement drains. Nothing here is trial-only.

**BYOK has no meter and needs no budget** — it is priced in dollars against the user's own key. It
still takes KTD10's recent-first default range, for the product reason given there rather than a
cost one. Going beyond that default stays the existing unbounded `Atoms: Backfill estimate confirm`
command; no new UI, no added scope.

### KTD10 — The default range is recent-first, not oldest-first · `session-settled: user-directed`

Walk **backwards from the window start**, not forward from the oldest daily.

The reason is product, not cost. A user can only judge filing quality on notes they remember
writing. An atom built from a three-year-old capture is interesting; an atom from last month is
*verifiable* — they recognize the links and can tell whether the reasons are right. The launch post
explicitly asks for feedback on filing quality, so the demo has to land where the user can judge it.
Oldest-first spends the entire budget on the least legible notes in the vault.

This changes the scan. U5 as originally written bounds `prepareBackfillEstimate` by `before` alone —
one shot at the whole complement. A recent-first bounded range needs **both** bounds, which
`GetUnprocessedOpts` already carries (`src/pipeline/daily.ts:57-59`; `before` was built in U2 and
has no production caller yet — this is its first).

Three implementation points that are easy to get wrong:

- **The budget bounds what is classified, not what is read.** Derive `since` by listing the
  complement, ordering dailies newest-first from the window start, and accumulating captures until
  the budget is reached. The vault read stays full-history and that is correct — it costs vault
  reads, not API spend, on an attended confirm-gated path. This is not a reintroduced sweep; nothing
  unattended reaches it, and KTD2's fail-closed rule binds unattended callers only.
- **Sort explicitly; the scan does not.** `getPastDailyNotesWithUnmarkedCaptures` returns
  `Object.values(getAllDailyNotes())` order with no sort, so "newest-first" is an ordering this
  design must impose, not one it can assume. Every ordering claim in KTD10 and U8 depends on it.
- **Whole dailies only.** Stop *before* the daily that would exceed the budget, so the offer is
  never over budget and `since` stays a clean date. Never split a daily's captures across the bound.
- **A single daily larger than the budget is not a dead end** — it routes to KTD11's over-budget
  branch, which offers a top-up rather than an empty offer.

### KTD11 — Over budget offers a top-up, never a dead end · `session-settled: user-directed`

When the complement exceeds what the user can spend, the modal must not say "you don't have enough".
It says how much it will do now, and that more is available: 50 filings for $2, or the next period.

KTD7's constraint stands and is sharpened here — **the over-budget branch states the aftermath, not
just the arithmetic.** Confirming spends the allowance and forward filing pauses until it resets or
the user upgrades. A modal that quotes only a number lets a user approve a pause they did not know
they were buying.

**The pause compounds, and that is the real argument for the reserve.** When `remaining` hits zero
`onRemaining` writes status `exhausted` and unattended filing stops — but capturing does not.
Everything written during the pause lands *inside* the filing window, unmarked, and is filed out of
the **next** period's allowance at `PER_LAUNCH_CAP` per pass. Under `rollover: false` that can
sustain itself: each period pays for the previous period's pause. So "filing pauses until it resets"
understates it — the cost is a gap *plus* a backlog. This is why the reserve exists at all, rather
than being pure conversion friction, and it is why the reserve's floor matters more than its
ceiling.

**After a top-up, re-derive before re-offering.** The range, budget, and counts were all computed
against the pre-top-up `remaining`. On a successful top-up, re-read the meter, recompute the reserve
and budget, and re-derive the range before showing the modal again — otherwise the user pays $2 and
sees the same offer, which is the dead end this KTD exists to eliminate, reached one purchase later.
The single-oversized-daily case is the worst version: it must not still show an empty offer after
payment.

**Name the cheaper road for very large histories.** Top-up is $0.04 per filing; a multi-year vault
runs to thousands of captures, so draining it in $2 increments costs many multiples of the $6/month
subscription — while KTD7 already ships a strictly cheaper engine for exactly this job behind the
same gate. When the complement is large (order of 5× the top-up or more), the over-budget branch
names the BYOK Batch route alongside the top-up. Offering only the expensive incremental path to the
user with the largest history is the read a launch-post commenter will reach for, and it is the
opposite of the honesty posture this amendment exists to establish.

**Give the aftermath its own visual block.** The modal's existing pattern is a flat list of
same-weight paragraphs; an aftermath sentence added to that list reads like the arithmetic around it
and gets skimmed, defeating the purpose stated above. Settings' exhausted-state block
(`src/settings/settings.ts:1268-1276`) is the tone precedent — plain, no guilt, names the
alternative.

Prices come from `plus-pricing.json`. Copy goes through `atoms-voice`; `docs/voice.md` is authority.

---

## Units

Each unit is independently reviewable and leaves the tree green.

**Launch-blocking subset:** U1–U4 and U6 resolve the honesty problem the launch post depends on —
after them, no unattended path can reach history. U5 (home card), U7 (copy) and U8 (Plus engine)
make backfill *good*; they do not gate the claim. Do not hold the post for them.

### U1 — Window primitive and fail-closed resolver (pure, tests first)

`src/platform/autorun.ts`:

- `LS_AUTO_RUN_START_DAY = "atoms-auto-run-start-day"`
- `readAutoFilingStartDay(load)` / `writeAutoFilingStartDay(save, day)` — `YYYY-MM-DD`, validated
- **`resolveAutoFilingSince(load, save, today)`** — returns a date string unconditionally: the
  stored stamp when it parses, otherwise it stamps `today` and returns it (KTD2)
- extend `DeviceAutoRunState` with `startDay: string | null`

KTD1's strict window means there is no grace arithmetic — the bound *is* the stored enable day, so
the DST and month-boundary hazards round 1 worried about disappear with the subtraction. Keep the
date-string discipline anyway: comparisons stay lexical on `YYYY-MM-DD`, never `Date` math.

**Tests:** missing key stamps and returns today; **stored-but-malformed value is re-stamped, never
read as "no bound"**; a valid stamp is returned unchanged and not re-stamped; the resolver never
returns undefined; lexical comparison holds across a month boundary.

### U2 — Thread the bound through scan, count, write, and every count surface

- `src/pipeline/daily.ts`: `GetUnprocessedOpts` gains `since?: string` (filters `date >= since`)
  **and `before?: string`** (filters `date < before`) — the complement in KTD3 needs the opposite
  bound, which round 1 never provided.
- `src/pipeline/write.ts`: `RunWritePathOptions` gains `since`, forwarded to the scan.
- `src/plugin/main.ts`: `countPastUnprocessed` takes the bound. **Note it already has a positional
  `fallback = 0` argument passed positionally at `:1115`** — say where the new parameter goes or the
  fallback silently becomes the bound.
- `maybeAutoRun` resolves the bound **once** via `resolveAutoFilingSince` and passes it to both.

**Every other count surface must agree or the screen contradicts itself.** Design and feasibility
both caught that `atomsHomeView.ts` computes its own `unprocessedCount` from an unbounded call
(`:668`) and renders "`N` past thoughts will file automatically" (`:1974`) — after this change that
is a promise no unattended path keeps, and it double-counts against U5's new card. Also bound
`showAutoRunStatus`'s count (`:1404`), which V3 reads as evidence and which would otherwise report
`wouldRunNow: true` on a drained window. `runListUnprocessed` (`:2130`) stays explicitly unbounded
as a diagnostic.

**Tests:** pre-window captures neither counted nor filed; boundary date included; absent bound on
attended paths is byte-identical to current behavior; home hero count equals what auto-run will file.

### U3 — Every enable path stamps the start day

One helper, and **all** call sites — round 1 listed three and missed the one every re-enable takes:

- `enableAutomaticFiling` (`src/platform/autorun.ts:169`) — home card
- the Settings toggle **consent branch** (`src/settings/settings.ts:1750-1754`)
- the Settings toggle **already-acked branch** (`src/settings/settings.ts:1743-1747`) — this
  short-circuits before the consent branch and is the path taken whenever the ack is current
- stamp only when `on === true`, so disable preserves the previous day

**And the enable tap fires one attended run (KTD1).** `enableAutomaticFilingFromHome` already calls
`maybeAutoRun("manual")` (`src/plugin/main.ts:998-1003`); that call gains `includeToday: true` so
day one produces a visible result from a strict window. The Settings toggle enable paths get the
same treatment, so enabling from Settings is not a worse first run than enabling from home.

This is the only path on which `includeToday` is ever true outside the existing explicit test
commands. It is user-initiated, one run, at the moment of consent — non-negotiable #3's "explicit
user force". It must never be reachable from `onload`, `interval`, or `resume`.

**Tests:** each path stamps; the already-acked re-enable stamps; disable preserves; re-enable
overwrites with the later day; the enable tap runs once with `includeToday`; **no unattended source
(`onload`/`interval`/`resume`) can set `includeToday`**.

### U4 — Migration for already-enabled devices

On load — after `waitForVaultIndexReady` and before the first `maybeAutoRun`, i.e. inside
`scheduleAutoRunLifecycle` (`src/plugin/main.ts:940-958`) — if `enabled === true` and no start day
is stored, stamp the window start **and record a migrated-device flag** (KTD5).

**Tests:** migrates exactly once, does not re-stamp next load; existing stamp untouched; disabled
device gets no stamp; migrated flag persists for U5's copy.

### U5 — Backfill is the complement, and gets a gated surface

- `prepareBackfillEstimate` bounded to the complement via the new `before` option — the single
  unbounded scan is `src/pipeline/backfill.ts:408`.
- **`prepareBackfillEstimate` keeps its required `apiKey` — do not loosen it.** It is BYOK-only by
  construction: the key feeds `countTokensForClassifyRequest` (`:181-215`, called at `:443-446`),
  which POSTs to Anthropic's count_tokens with `x-api-key` and throws on non-2xx. Making it optional
  yields a function that throws or returns a meaningless zero for exactly the Plus device it was
  loosened for. **The Plus branch never calls it.** Both branches take their capture count from one
  bounded `getPastDailyNotesWithUnmarkedCaptures({ since, before })` scan (per-note
  `unprocessed.length` is already on the result); only the BYOK branch feeds that range into
  `prepareBackfillEstimate` for a dollar estimate. The single real BYOK gate to move is
  `runBackfillFlow`'s `requireApiKey()`.
- **The card's headline number is the budgeted range, never the raw complement.** The non-zero check
  reads the complement, but the figure shown must be what confirming actually files. "1,847 past
  captures" above a flow that files ~100 is the broken promise, and on any real vault it is the
  common case, not an edge. If the total is surfaced at all it is subordinate — "your 100 most
  recent captures, of 1,847".
- **`BackfillConfirmModal` takes an engine discriminant, not just a widened estimate.** Its body is
  hardcoded to the Batch engine on every line (`src/pipeline/backfill.ts:869-900`) — the Batches API
  intro, the chunk sentence, token counts, and critically *"Privacy: this sends historical captures
  and your title graph to Anthropic's Batch API (server-retained for a window)"*. Shown to a Plus
  user whose captures go through the Atoms Plus proxy, that privacy sentence is **factually wrong at
  the moment of consent**. Every Batch-specific line lives in the BYOK branch; the Plus branch names
  the Plus proxy as the destination. This is a larger unit than "widen `CostEstimate`" — budget for
  it.
- **The default range is recent-first and budget-bounded (KTD9 + KTD10)** — derive `since` by
  walking dailies backwards from the window start until the budget is reached, whole dailies only,
  and pass `{ since, before }`. The complement beyond that range stays reachable, not filed.
- A home card when that count is non-zero. On migrated devices (KTD5) the copy names the pause
  rather than reading as an upsell.
- **The card is egress-ack gated.** `runBackfillFlow` gates only on an API key and the cost modal
  (`src/plugin/main.ts:1205`) — tolerable while the flow is buried in a menu, not once it is a
  prominent one-tap card. The card renders only when `readEgressPermitted(load, {catchUp: false})`
  is true; otherwise its button raises the existing `egressConsentSpec` sheet and proceeds only on
  `accepted`.
- **The card is dismissible**, persisted device-locally beside the start day. Otherwise it is a
  permanent unread-count on the home of a product whose posture is a gentle stream, not a guilt
  queue — and on a large vault the complement never reaches zero without paying. Backfill stays
  reachable from Settings and the command palette.
- The card is shown to **both** Plus and BYOK devices (KTD7); the engine and currency are resolved
  from `resolveFilingAuth()`, not from the card.
- `BackfillConfirmModal`'s constructor is `(app, estimate: CostEstimate, onConfirm)`
  (`src/pipeline/backfill.ts:855-864`); carrying a filings line needs a widened signature or a
  widened `CostEstimate`. Design flagged that the modal already renders six same-weight facts —
  lead with the currency that matters to the current user and demote token/chunk detail to the
  `setting-item-description` styling already used there.

**Tests:** complement excludes in-window captures; enable→disable makes the offer cover all past
(KTD3); zero → no card; stale/absent egress ack cannot reach `prepareBackfillEstimate` from the
card; dismissal persists; migrated-device copy differs; a Plus device sees the card and the filings
currency, a BYOK device sees the cost currency.

**Tests (KTD9/KTD10):** the derived range is the *newest* dailies before the window, not the oldest;
a daily that would exceed the budget is excluded whole rather than split; a single over-budget daily
routes to the top-up branch instead of producing an empty offer; the reserve shrinks with
`daysRemaining` on a fresh `periodEnd`; an absent, unparseable, or stale `periodEnd` falls back to
the full baseline reserve and never above it; `budget` floors at 0 rather than going negative when
`remaining` is already below the reserve.

### U8 — The Plus backfill engine (KTD7)

Run the existing Plus classify path over the complement, bounded by `before`, gated by the same
confirm modal:

- Reuse `runWritePath` with the complement bound and `classifyDeps.plus` — the path
  `maybeAutoRun` already uses (`src/plugin/main.ts:1082-1100`) — rather than `backfill.ts`, which is
  Batch-API-and-BYOK by construction.
- **`RunWritePathOptions` gains `before?: string`, forwarded to the scan alongside `since`.** It
  carries only `since` today and the scan call at `src/pipeline/write.ts:116-119` forwards only
  `{ includeToday, since }` — U2 added `before` to `GetUnprocessedOpts` but deliberately never
  threaded it into the write path, so the one bound U8's correctness depends on does not exist on
  the function U8 names. The Plus backfill passes **both** bounds. Passing `since` alone files
  everything from the derived start day to today, **including the whole filing window auto-run
  already owns** — metered double-spend on exactly the captures KTD3 exists to exclude.
- **Order dailies newest-first before any slice.** `runWritePath` sorts work by
  `note.path.localeCompare` ascending and then takes `work.slice(0, max)`
  (`src/pipeline/write.ts:129-137`); daily paths are date-named, so ascending is **oldest-first** and
  the slice keeps the oldest. Left alone, a paced or interrupted run files the least legible end of
  the range and KTD10's whole product bet inverts at the first cap. Either reverse the daily order
  before slicing — preserving the bottom-up line ordering *within* each daily, which is what keeps
  marker insertion from shifting later line numbers — or run the derived range with no `maxCaptures`
  at all, since the range is already budget-bounded and the cap adds nothing.
- **Move the auth gate off the API key.** `runBackfillFlow` opens with `requireApiKey()`
  (`src/plugin/main.ts:1206`), which is why a Plus or trial device cannot backfill at all today.
  The entry point branches on `resolveFilingAuth()`; only the BYOK branch requires a key.
- Estimate in filings: the recent-first range's capture count against the **KTD9 budget**, not
  against raw `remaining`. On modal open, refresh the meter with `refreshPlusEntitlementRecord`
  (`getEntitlement`, GET `/v1/me`) — it returns `status`, `remaining` and `periodEnd` together. A
  failed or rejected refresh falls back to the cached session and the baseline reserve per KTD9
  rather than blocking the run.
- **Over budget routes to KTD11's top-up branch**, never to a refusal or an empty offer.
- **Build the `exhausted` abort — it does not exist.** `runWritePath` accumulates per-capture
  failures via `pushFail` and continues through the whole slice (`src/pipeline/write.ts:147-175`),
  and the Plus 402 is a per-capture error in `classify.ts:859`. A 100-capture run that exhausts at
  capture 30 would make 70 further doomed proxy round-trips and report `failed: 70` with no way to
  tell exhaustion from a network or schema failure — the opposite of "stops cleanly, reports what
  filed", and the Risks-table mitigation depends on behaviour that is not there. Add an opt-in stop
  signal (a `stopOnAuthExhausted` flag, or a `classifyDeps.plus.onExhausted` callback setting a
  run-scoped flag the loop checks before each capture) so the run halts on the first `exhausted` and
  the report distinguishes it from ordinary failures. Markers make the resume idempotent.
- **Claim an in-flight guard.** `backfillInFlight` is set only inside `runBackfillFlow` and
  `autoRunInFlight` only by `runAutoFilingCycle`, so a Plus backfill routed through `runWritePath`
  takes neither and the hourly `maybeAutoRun` can start a concurrent run against a second pinned
  context corpus. The Plus backfill holds `backfillInFlight` for its duration and refuses to start
  while `autoRunInFlight` is held, and vice versa.
- BYOK devices keep `runBackfillFlow` untouched.

**Tests:** a Plus device backfills the budgeted range and no in-window capture; **a `runWritePath`
call carrying `{ since, before }` touches no daily on or after `before`**; **a paced or truncated run
files the newest dailies in the range, not the oldest**; the filings estimate matches the **budgeted
range** count, not the whole complement; a Plus device with no API key reaches the flow at all (the
`requireApiKey()` regression); **the Plus confirm branch renders no Batch-API or Anthropic-direct
privacy string**; a failed entitlement refresh falls back to the baseline reserve and blocks no run;
mid-run `exhausted` **halts on the first exhausted response with no further proxy calls**, reports an
accurate filed count, and re-running resumes without double-filing.

### U6 — Scope the manual catch-up (KTD4)

"Sync everything now" resolves its bound through `resolveAutoFilingSince` before calling
`maybeAutoRun`.

**Tests:** manual catch-up with the toggle off files inside the window only; **manual catch-up on a
device that never enabled automatic filing is bounded, not unbounded** — pre-window dailies
byte-identical.

### U7 — Copy, version, release notes

- Settings auto-run description and home filing card name the window.
- **One line at enable time saying filing starts tomorrow.** Day one is now deliberately silent —
  the window starts today and every pass excludes today — so a launch-post visitor who enables and
  sees nothing concludes it is broken. Direction: *"Filing starts with tomorrow's note. Older notes
  stay untouched until you ask for them."*
  - **It must not point at `Process unprocessed captures`.** That is the one path this plan leaves
    deliberately unbounded and unpriced — no window, no estimate, no recent-first ordering, no
    budget — so recommending it at enable time hands a trial user a single tap that can spend the
    whole 150-filing allowance on years-old notes, the exact harm KTD9 and KTD10 exist to prevent.
    It would also make the launch post's "shows a cost estimate before processing a big history"
    false *for the path the product itself recommends*. Point at the backfill offer (U5) instead.
  - This is copy only: it must **not** reintroduce a today-including run, which `EGRESS_DISCLOSURE`
    clause (3) forbids (see Non-goals).
  - Settings' toggle uses a persistent inline `setting-item-description` line, not a transient
    Notice — the user is already reading the panel and a toast is easy to miss there.
- Release notes state that existing devices' sweeps pause and reappear as an offer (KTD5).
- Bump `manifest.json` + `package.json` + `versions.json`.

Copy goes through the `atoms-voice` skill; `docs/voice.md` is authority.

---

## Verification

**V1 — Unit.** Per-unit tests above.

**V2 — The termination regression (highest value), and it needs a seam.** Feasibility flagged that
this test has nowhere to live: no test references `maybeAutoRun`, which needs an `App`, a context
provider, resolved filing auth, and a live `runWritePath` to complete one cycle — so the test would
quietly degrade into another pure-predicate test at exactly the level where KTD2's drift is
invisible.

**Extract the cycle first:** resolve-bound → count → file → recount → stamp becomes a pure function
in `src/platform/autorun.ts` taking injected count and file callbacks; `maybeAutoRun` and the test
both drive it. Then assert that a history far larger than `PER_LAUNCH_CAP` terminates and stamps.

Known limit to state in the test file: termination also depends on every in-window capture being
fileable. Quarantined captures and an `exhausted` Plus status can leave unmarked captures inside
the window forever, reproducing the loop. Pre-existing, not closed here.

**V3 — Live CLI, throwaway vault only** (`test_vault/`, never Remote Vault):

1. `npm run seed:vault` for dailies spanning well beyond the window
2. `./scripts/install-to-vault.sh`
3. Enable automatic filing, `obsidian command id=atoms:auto-run-now`
4. Markers appear only inside the window; pre-window dailies byte-identical
5. `atoms:auto-run-status` reports a window count consistent with what filed
6. `atoms:backfill-estimate-confirm` covers only the complement; cancel writes nothing

**V4 — Adversarial** (`adversarial-qa`, required tail of `world-class-qa`): enable → disable →
re-enable across a day boundary; migration mid-sweep; **"Sync everything now" on a never-enabled
device**; **corrupt `LS_AUTO_RUN_START_DAY`**; oldest daily inside the window (empty complement, no
card); no dailies at all; two devices with different start days, including **concurrent unsynced
filing of the same capture** (KTD6).

**V5 — Product honesty.** Prove it through the user loop, not fixtures: append capture bullets to
dailies, toggle on, observe. Seeded fixtures are plumbing evidence only (non-negotiable #9).

---

## Risks

| Risk | Mitigation |
|---|---|
| Count/file drift → auto-run never stamps, rescans hourly forever | KTD2 single bound + V2 freezes it |
| Unresolvable start day reverts to a full-history sweep | KTD2 `resolveAutoFilingSince` fails closed; U1 malformed-value test |
| "Sync everything now" on a never-enabled device sweeps everything | KTD4 + U6 route through the same resolver |
| Home hero promises a backlog auto-run will never drain | U2 binds every count surface |
| Backfill estimate double-counts or prices vanishing work | KTD3 complement, qualified per-device and per-toggle-state |
| Newly-prominent backfill card sends history without a current ack | U5 egress gate |
| Existing users' sweeps pause and they think it broke | KTD5 migrated-flag copy + release notes |
| A unit edits the disclosure and strands every device's consent | Non-goals: directional rule, stop and escalate |
| Plus backfill exhausts the period mid-run and looks broken | U8 stops cleanly, reports what filed, markers make resume idempotent |
| Modal quotes a stale `remaining` and a Plus user over-commits | KTD7: read on open, fall back to the cost line, never assert a stale count |
| `includeToday` leaks from the enable tap to an unattended source | U3 test asserts onload/interval/resume can never set it |
| DST/timezone off-by-one at the boundary | Date-string math, never millisecond subtraction |
| A stale `periodEnd` shrinks the reserve and a user spends their forward filing on history | KTD9: shrink only on a fresh `periodEnd`, `min` against the baseline, uncertainty reserves more |
| Backfill spends the budget on three-year-old notes the user cannot judge, and the launch post asks to be judged on exactly that | KTD10 recent-first default, derived by walking back from the window start |
| Deriving the range reads the whole vault and reads as a reintroduced sweep | KTD10: the budget bounds what is *classified*; the read is attended, confirm-gated, and costs no API spend |
| Over-budget modal reads as a wall and kills the conversion | KTD11 top-up branch, stating the aftermath rather than the arithmetic |
| A Plus/trial user still cannot backfill | U8 moves the auth gate off `runBackfillFlow`'s `requireApiKey()` — the single real BYOK gate; the Plus branch never calls `prepareBackfillEstimate`. Test asserts a keyless Plus device reaches the flow |
| U8 passes `since` without `before` and re-files the whole filing window at Plus rates | `RunWritePathOptions` gains `before`; test asserts no daily on or after `before` is touched |
| `runWritePath`'s oldest-first sort inverts the recent-first bet at the first cap | U8 orders newest-first before slicing, or drops `maxCaptures` entirely; test asserts a truncated run filed the newest |
| The Plus confirm modal shows BYOK's "sends to Anthropic's Batch API" privacy line | Engine-discriminated modal body; test asserts the Plus branch renders no Batch-API string |
| Enable-time copy sends a trial user into the unbounded `Process` command | U7 points at the backfill offer instead; `Process` is never recommended from a first-run surface |
| A far-past `LS_AUTO_RUN_START_DAY` (#429) empties the complement, so the card never renders and the whole history runs unbudgeted through the *unattended* per-capture path | Open — the budget must not be the only spend bound. Either bound the unattended Plus path by the same reserve, or add a plausibility floor on the stamp and close #429 |
| Two devices on one account each offer a full budget against one shared meter | Open — meter is account-wide, bounds are device-local (KTD6). Re-read `remaining` immediately before the run and stop when it drops below what the range needs; V4 case |
| The meter is read at modal open and spent after confirm, with forward filing running in between | Re-check at confirm and recompute the range rather than starting a run priced against a stale allowance |
| Enable-time copy fix quietly reintroduces a today-including run | U7 is copy only; the `includeToday` assertion in U3 still binds |

## Deferred follow-ups (not scoped here)

- A true Batch-API path for Plus (U8's engine is per-capture, so a very large complement is slow
  and less efficient than BYOK's batch). Needs plus-service work; deliberately not scoped here.
- Rename "Sync everything now" (KTD4) — requires an `EGRESS_DISCLOSURE` review.
- The attended `Process unprocessed captures` command remains unbounded and unpriced.
- No signal is defined that would confirm or refute the conversion bet (trial-to-paid,
  atoms-in-first-week, backfill acceptance rate).

## Shipping tail (not optional)

`ce-simplify-code` → `ce-code-review` (P0/P1 fixed) → `ce-compound` → `world-class-qa` ending in
`adversarial-qa` → PR with `Closes #<issue>`, core user stories, edge cases, and screenshots of the
live throwaway-vault smoke committed under `docs/qa/screenshots/`.

## Review coverage

Round 1: coherence, feasibility, product-lens, design-lens, security-lens, adversarial — six
dispatched contexts, all returned. **Not run:** scope-guardian (7 units, no priority tiers — below
threshold) and the cross-model peer pass, skipped for turnaround. No finding here carries
independent cross-model corroboration; the three P0s each have 2–3 same-model reviewers agreeing,
which is convergence within one family, not independent confirmation.

Round 1 covered U1–U7 as written then, and **U1–U4 + U6 shipped as 0.6.99**. It did **not** cover
U8 (designed after that review) or KTD9–KTD11 (settled with the user 2026-08-10, after it).

Round 2 **ran** over U5-amended + U8 + KTD9–KTD11: coherence, feasibility, product-lens, design-lens,
adversarial — five dispatched contexts, all returned. Full report:
[`docs/reviews/2026-08-10-backfill-offer-round2-doc-review.md`](../reviews/2026-08-10-backfill-offer-round2-doc-review.md).
**Not run:** scope-guardian (below threshold for a scoped round), security-lens (no new surface — the
egress gate and untouched disclosure are unchanged), and the cross-model peer, skipped for
turnaround. As in round 1, agreement here is convergence within one model family, not independent
confirmation.

Round 2 found six P0s, all of them in the amendment's *code claims* rather than its product
direction. The load-bearing corrections now folded in above: `runWritePath` never carried `before`;
its pacing slice is oldest-first and would have inverted KTD10; the meter cannot be read from
`classifyViaProxy` without spending a filing; the reserve needed a floor, not just a ceiling; the
confirm modal's privacy line is Batch-API-specific and would be wrong for a Plus user at the moment
of consent; and U7's enable-time copy pointed at the one unbounded, unpriced path in the product.
Five product decisions remain open — see the report's *Decisions needed* table.
