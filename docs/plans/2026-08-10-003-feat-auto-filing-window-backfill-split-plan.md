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

### U8 — The Plus backfill engine (KTD7)

Run the existing Plus classify path over the complement, bounded by `before`, gated by the same
confirm modal:

- Reuse `runWritePath` with the complement bound and `classifyDeps.plus` — the path
  `maybeAutoRun` already uses (`src/plugin/main.ts:1082-1100`) — rather than `backfill.ts`, which is
  Batch-API-and-BYOK by construction.
- Estimate in filings: complement capture count against `remaining`, read when the modal opens via
  the meter `classifyViaProxy` returns (`src/platform/plusClient.ts:664-682`).
- Respect `PER_LAUNCH_CAP`-style pacing and the existing `exhausted` handling: a mid-run exhaustion
  stops cleanly, reports what filed, and leaves the rest for the next period. Markers make the
  resume idempotent.
- BYOK devices keep `runBackfillFlow` untouched.

**Tests:** a Plus device backfills the complement and no in-window capture; the filings estimate
matches the complement count; a stale/failed meter read falls back to the cost line and blocks no
run; mid-run `exhausted` stops cleanly with an accurate filed count and re-running resumes without
double-filing.

### U6 — Scope the manual catch-up (KTD4)

"Sync everything now" resolves its bound through `resolveAutoFilingSince` before calling
`maybeAutoRun`.

**Tests:** manual catch-up with the toggle off files inside the window only; **manual catch-up on a
device that never enabled automatic filing is bounded, not unbounded** — pre-window dailies
byte-identical.

### U7 — Copy, version, release notes

- Settings auto-run description and home filing card name the window.
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
