# Code review — #433 backfill offer (U5 + U7 + U8)

Branch `claude/backfill-offer-u5-u8` against `origin/master` (base `ac89f3c`, head `b017ba2`).
31 files, 4,651 insertions, 3,350 executable changed lines. Report-only; nothing was applied by
the review itself.

Plan: [`docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`](../plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md)
(`plan_source: explicit`).

## Intent

Before this branch a Plus or trial device could not backfill at all — the entry point demanded a
BYOK Anthropic key and dead-ended. This branch gives the backlog a priced, confirm-gated offer that
works for both engines: a pure budget/range core, an engine-discriminated confirm modal, a
dismissible home card, and opt-in write-path bounds whose defaults preserve unattended auto-run.

## Reviewer team

Always-on: correctness, project-standards (root `CLAUDE.md` + `AGENTS.md` govern the whole tree).

| Conditional | Why it was added |
|---|---|
| security | The confirm modal is a consent surface for real metered spend, and the card stamps the egress ack |
| reliability | A checkout poll loop, an in-flight guard held across a whole flow, and a new mid-run abort |
| performance | Whole-vault daily scans on every home render, and an extra fan-out is money, not just latency |
| testing | 1,600 lines of new tests, and behavior changes on paths that spend money |
| maintainability | ~3,350 executable changed lines, a new module, and ~470 new lines in `main.ts` |
| frontend races | A card, a modal, timers, and a double-tap window on a paid action |
| learnings | `docs/solutions/` has direct matches for home rendering, marker drift, and check-and-set guards |
| adversarial | Payments, persistence writes, concurrency, and external APIs — run cross-model (see Coverage) |

## Triage groups

| Group | Findings | Context | Preferred resolution | Kind |
|---|---|---|---|---|
| One offer, derived three times | #1, #5, #8 | Home, the Plus flow, and every top-up round each re-derive the offer from scratch, from the same inputs, with no shared code | Extract the shared pure helpers (#1) first, then decide what the card may promise while the meter is stale (#5); #8 falls out once the scan is hoisted out of the round loop | Decision gate (contains #5) |
| Nothing bounds a confirmed run | #3, #6 | A confirmed Plus run has no capture cap, and no other writer is told it is running | Do #3 first — it is a one-line `maxCaptures` — then #6, which needs the same `backfillBusy()` guard on `runProcessUnprocessed` | Apply queue |
| Lifecycle guards are incomplete | #4, #2 | The BYOK flow never takes the in-flight flag, and the top-up poll never gives its timers back | #4 first (take the flag where the Plus flow already does), then #2 (store the handle and clear it in `onunload`) | Apply queue |

## P1 — High

### #1 — The complement bound and the period mapping are written twice

`src/plugin/main.ts:1361` — `AtomsPlugin.backfillComplementBefore` and the inline ternary in
`AtomsHomeView.backfillOfferModel` (`atomsHomeView.ts:2630`) independently implement the same KTD3
rule, and the `trialing -> "trial"` mapping is duplicated at `main.ts:1460` and
`atomsHomeView.ts:2614`. Neither call site delegates to the other.

**Why it matters.** These two derivations decide what the card offers and what the flow actually
runs. An edit to one and not the other makes home and the flow silently disagree about what counts
as backfillable, and both test suites still pass because each builds its own harness. This is the
"fixed it here, forgot the twin" class the project's own standards call out.

**Fix.** Add `complementBefore(enabled, since, today)` and a `periodFor(mode, status)` to
`src/pipeline/backfillOffer.ts` beside the existing pure functions, and reduce both call sites to
their `loadLocalStorage` reads.

Confidence 100. maintainability; independently validated.

### #2 — The top-up poll never gives its timers back

`src/plugin/main.ts:1586` — `buyBackfillTopUp` awaits a bare `window.setTimeout` 24 times at 5s
with no stored handle and no unload teardown, unlike `resumeCoalesceTimer`, which `onunload`
already clears.

**Why it matters.** Disable or reload the plugin while "finish checkout in the browser" is on
screen and the dead instance keeps refreshing entitlements and firing Notices for up to two
minutes — and can write session state that races the freshly loaded instance.

**Fix.** Store the handle in a field, clear it in `onunload` beside `resumeCoalesceTimer`, and
check a teardown flag after each wake so the loop returns instead of calling the network again.

Confidence 100. reliability + frontend-races + cross-model agreement.

### #3 — A confirmed Plus run is not capped to the count the user agreed to

`src/plugin/main.ts:1628` — `executePlusBackfill` passes `since`/`before` but deliberately no
`maxCaptures`, and `runWritePath` re-scans by date. The comment argues the range is already
budget-bounded; the range was bounded at pricing time, not at write time.

**Why it matters.** Captures that land inside `[since, before)` between the confirm tap and the
write pass — a phone Sync landing bullets on a mid-range daily, an inbox drain appending to a past
note — are filed with no count ceiling. The user confirms "files 20 captures" and the run can spend
well past that, eating the period reserve the whole budget model exists to protect. Only the
server's 402 stops it.

**Fix.** Add `maxCaptures: range.captures`. With `order: "newest-first"` the slice comes off the
front, so the cap drops the oldest end — the end the range already treats as spillover.

Confidence 100. security + correctness + cross-model agreement.

### #4 — BYOK holds no in-flight flag across its estimate and confirm window

`src/plugin/main.ts:1710` — `runByokBackfillFlow` calls `backfillBusy()` and then runs a long
`count_tokens` estimate and opens a modal without ever taking `backfillInFlight`. The Plus flow
holds the flag for its whole duration; BYOK does not. The home card's button compounds it: it is
disabled on `this.busy`, which only the phases this card is suppressed under ever set, so it is
always enabled here.

**Why it matters.** Two taps produce two estimates, two pinned corpora, and two gates. The user
confirms the second one, `executeBackfillBatch` finds the flag already held, returns early with no
Notice, and a consented paid Batch submit silently does nothing. Auto-run can also file the same
dailies during the unguarded estimate.

**Fix.** Move `this.backfillInFlight = true` to immediately after the `backfillBusy()` check at the
top of `runByokBackfillFlow` and release it in `finally`, mirroring `runPlusBackfillFlow`. Give the
card its own `backfillCardBusy` re-entrancy field and bind the button's `disabled` to that.

Confidence 100. frontend-races + cross-model agreement.

### #5 — The card prices against a stale reserve; the modal spends against a live one

`src/home/atomsHomeView.ts:2621` — home passes `fresh: false` unconditionally and deliberately, so
it always takes the full baseline reserve. `derivePlusBackfillOffer` prices after a live `/v1/me`
and takes the smaller earned reserve.

**Why it matters.** With paid `remaining: 120` and two days left in the period, the card offers 20
captures and the modal offers 50. The user taps one number and confirms another, on a surface that
spends real filings. Near period end the card can also hide entirely while the flow would have had
budget.

**This is a design call, not a mechanical fix.** The `fresh: false` choice is deliberate and
documented — home must not make a network call to render. The options are to make the card
qualitative when freshness is unknown (drop the count, keep "Older captures"), or to cache the last
successful `periodEnd`/`remaining` with an explicit freshness flag and price from that. Do not
silently keep showing a count derived under one reserve when the modal will re-price under another.

Confidence 75. cross-model only; independently validated.

### #6 — Process can run concurrently with a Plus backfill and drop its markers

`src/plugin/main.ts:1605` — `runProcessUnprocessed` and `runUpdateNotes` pass only
`requireClassifyAuth`, which has no concurrency check, before `beginHomeRun`. `executePlusBackfill`
runs inside `backfillInFlight` but never calls `beginHomeRun`, so `AtomsHomeView.busy` stays false
and the Process button stays enabled for the whole run.

**Why it matters.** `render.ts` does a whole-file `vault.modify` from each run's own daily cache, so
a Process started during a backfill can write back a snapshot that predates the backfill's appended
sentinels. Those markers are what makes the pipeline idempotent — losing them means captures get
filed twice, on a metered path. The backfill also shows no progress anywhere, which is exactly what
makes a user reach for Process while one is running.

**Fix.** Add `if (this.backfillBusy()) return;` before `requireClassifyAuth()` in both entries, and
wrap `executePlusBackfill` in `beginHomeRun("process")` / `finishHomeRun(...)` so home is visibly
busy.

Confidence 75. correctness; independently validated.

## P2 — Moderate

### #7 — Newest-first orders dailies by path, not by date

`src/pipeline/write.ts:160` — the comparator flips `a.note.path.localeCompare(b.note.path)`, while
the offer derivation it is paired with sorts on the normalized `date` that `daily.ts` gets from
format-aware `getDateFromFile`.

**Why it matters.** A user whose Daily Notes format is not lexically sortable (`MMM D, YYYY`) gets
an order that is not newest-first. That only matters because the sole `newest-first` caller also
passes `stopOnAuthExhausted: true` — when the meter runs out mid-run, the captures that got filed
are the wrong end of the range, and recent-first was the entire point. The new fixtures all use
`Daily/2026-07-0N.md`, so no current test can fail on this.

**Fix.** Sort on `note.date` first and keep `path` as the secondary key.

Confidence 75. correctness; independently validated.

### #8 — Every top-up round re-reads and re-parses the whole backlog

`src/plugin/main.ts:1515` — `plusBackfillRounds` runs up to four passes, and each one calls
`derivePlusBackfillOffer`, which unconditionally re-scans the full pre-window complement against a
`before` the loop never changes.

**Why it matters.** On a multi-year vault that is four full vault reads plus capture parsing, in a
loop the user is already waiting inside, to recompute a number that only changed because the meter
changed.

**Fix.** Hoist the scan out of the loop (or memoize it on `before`) and re-run only
`resolveBackfillBudget` + `deriveRecentFirstRange` per round.

Confidence 75. performance; independently validated.

## Requirements completeness

The plan is legacy-shaped: it has no `## Requirements` or `## Requirements Trace` section, so there
are no R-IDs to trace. Unit-level, for the three units this branch claims:

| Unit | State |
|---|---|
| U5 — backfill is the complement, and gets a gated surface | Met |
| U8 — the Plus backfill engine (KTD7) | Met |
| U7 — copy, version, release notes | **Partially addressed** — see #9 |

### #9 — U7's release-notes item has no home and is unwritten

U7 requires that "release notes state that existing devices' sweeps pause and reappear as an
offer (KTD5)". The repo has no changelog or release-notes file — CI cuts the GitHub Release from
the version bump — so this line has to be written into the 0.7.0 Release body. Nothing on this
branch carries it, and the migrated-device copy on the card is the only place a user could learn
it. A BRAT or Community auto-update shows no release notes at all, which is precisely the case
KTD5 was written for.

Release-owned: no code change satisfies it. Write it when 0.7.0 is cut.

## Actionable findings

Mechanical work — a concrete fix exists and no product decision blocks it:

| # | Sev | Where | What | Fix proposed | Confidence |
|---|---|---|---|---|---|
| 3 | P1 | `src/plugin/main.ts:1628` | A confirmed Plus run has no capture ceiling | yes | 100 |
| 4 | P1 | `src/plugin/main.ts:1710` | BYOK takes no in-flight flag; a consented batch can silently no-op | yes | 100 |
| 6 | P1 | `src/plugin/main.ts:1605` | Process can run during a backfill and overwrite its markers | yes | 75 |
| 2 | P1 | `src/plugin/main.ts:1586` | Top-up poll timers survive plugin unload | yes | 100 |
| 1 | P1 | `src/plugin/main.ts:1361` | Complement bound and period mapping written twice | yes | 100 |
| 7 | P2 | `src/pipeline/write.ts:160` | Newest-first orders by path, not date | yes | 75 |
| 8 | P2 | `src/plugin/main.ts:1515` | Every top-up round re-scans the whole backlog | yes | 75 |

Decision gates — do not code these until the call is made:

| # | Sev | Where | The decision |
|---|---|---|---|
| 5 | P1 | `src/home/atomsHomeView.ts:2621` | What may the card promise while the meter is stale — a count, or no count? |
| 9 | -- | release | Write KTD5's paused-sweep line into the 0.7.0 GitHub Release body |

## Pre-existing

Neither counts toward the verdict.

- **P0 — `src/plugin/main.ts:1784`. Confirming a BYOK backfill ends its own context run before the
  batch uses it.** `BackfillConfirmModal` calls `close()` before `onConfirm()`, so the close hook
  runs `prepared.run.end()` while `confirmed` is still false, and the batch is then submitted
  against an ended run. On master, and already filed as separate work by the #433 handoff. The new
  Plus path fixed exactly this shape with a microtask defer in `confirmBackfill`
  (`main.ts:1409`) — the same fix applies here. Worth noting the new card gives this bug a second,
  more discoverable door.
- **P3 — `src/home/atomsHomeView.ts:2699`. The egress sheet names Anthropic, but a Plus backfill
  goes to the proxy.** Do not fix by rewording: `EGRESS_DISCLOSURE` is version-stamped and
  rewording strands every device's stored consent (#315). Fold it in at the next required bump.

## Learnings and past solutions

The learnings pass found five directly relevant entries in `docs/solutions/`, all of them dated
2026-08-10 against #427 — the same plan this branch implements — and the diff honors every one:

- `logic-errors/a-bound-resolved-once-must-reach-both-consumers-by-construction.md` — honored:
  `filingAuth` is resolved once per render pass and threaded to both consumers.
- `logic-errors/a-read-only-surface-that-calls-a-resolver-with-a-real-save-mints-device-state.md` —
  honored: `backfillOfferModel` uses `readAutoFilingSince`, not the persisting resolver.
- `logic-errors/extracting-a-cycle-behind-an-await-un-atomizes-its-check-and-set.md` — honored, and
  extended: the check-and-set stays synchronous and the flag is held for the whole flow.
- `logic-errors/marker-line-drift-batch-process.md` — honored: `newest-first` flips only the daily
  key, never the intra-daily line order.
- `architecture-patterns/ask-before-you-spend-when-the-server-revokes-first.md` — honored: the
  offer is priced from a non-consuming `GET /v1/me`, and Cancel is a free return.

One flagged as unchanged rather than violated:
`logic-errors/read-modify-write-lost-update-synced-file.md`. Backfill walks many dailies with a
longer await window than any existing caller, which raises the probability of the documented,
still-unclaimed `vault.process` hazard without introducing a new instance of it. Finding #6 is the
in-plugin half of the same exposure.

## Coverage

- **Cross-model adversarial pass:** ran. `cross_model_route: grok-cli`, `model_requested:
  grok-4.5`, `effort_requested: high`, `receipt_supported: false`, `model_actual: unverified`,
  `effort_actual: unverified`, `independence_verified: true`. Host family `claude`, serving family
  `grok` — attestably different, so its agreement counts as independent corroboration. It returned
  four findings, three of which merged with local reviewers (#2, #3, #4) and one of which is the
  only source for #5.
- **Validation:** 3 findings (#2, #3, #4) skipped the validator under the documented shortcut —
  each has `first_evidence` plus both an ordinary reviewer and the independence-verified
  cross-model peer. The remaining 5 (#1, #5, #6, #7, #8) went through one validator batch; all 5
  returned `validated: true`. No findings dropped, no degraded blockers.
- **Reviewers:** 9 local personas dispatched, 9 returned. `project-standards` returned no findings.
- **Suppression and demotion:** 0 suppressed by confidence after reconciliation. 2 narrow
  testing-coverage findings demoted to `testing_gaps` under the umbrella rule. 5 semantic
  duplicates reconciled into 3 findings (#2, #3, #4).
- **Untracked files:** none.
- **Baseline:** 1,662 tests across 91 files pass; build and lint clean.
- **Not covered:** no live-vault or product QA ran here — that is `world-class-qa`, still
  outstanding. Filing *quality* remains unproven; the local Plus service has no
  `ANTHROPIC_API_KEY`, so `/v1/classify` returns 503 and no atom has been produced by a real model
  on this branch.

### Residual risks

- A device holding both an exhausted Plus session and a BYOK key can no longer reach the unbounded
  Batch-API backfill: `runBackfillFlow` routes on Plus, `remaining: 0` yields budget 0, and the
  dialog offers only "Get more filings". The Plus-preferred routing is intentional and tested, but
  the exhausted-plus-BYOK shape is not.
- The BYOK over-budget card says "You see the cost before anything starts", but tapping it produces
  a Notice pointing at the command palette and never shows a cost — `meterLine` returns the cost
  string before it consults `overBudget`.
- Between confirm and `executePlusBackfill` the range is never re-priced. Only
  `stopOnAuthExhausted` bounds server quota; nothing bounds the client reserve if `remaining` drops
  on another device while the modal is open.
- The BYOK command path stays unbounded while the card is capped, so a user following the
  over-budget Notice into the palette can consent to a far larger Batch cost than the card showed.
- Card dismissal is device-local, so a multi-device user re-sees the offer elsewhere. By design,
  but it reads as a failed dismiss.
- `addDays` (`atomsHomeData.ts`) does `new Date((base ?? NaN) + ...).toISOString()`, which throws
  on a null base. Unreachable today — its only caller passes `localDateString()` — but the
  null-coalesce reads as a handled case when it is not.
- `window.open(checkout.url, "_blank")` has no scheme allowlist and no `noopener`, and the base URL
  comes from `data.json`, which travels with a synced vault. Verbatim the pre-existing pattern at
  three other call sites; worth one hardening pass across all four rather than here.
- `main.ts` is now ~3,035 lines and took ~470 of them from this branch. `CLAUDE.md` calls it a thin
  shell. The plan does specify these methods at `main.ts`, so this is a reviewed placement rather
  than an oversight — but it is the surface to extract from next.

### Testing gaps

- No test asserts the executed Plus run is bounded to the count the modal quoted (add an in-range
  capture between derivation and confirm, then assert the filed count).
- No test starts Process, Preview, or Update notes while a backfill holds `backfillInFlight`; the
  new in-flight block covers only backfill-to-backfill and backfill-to-auto-run.
- No test drives two rapid card taps before the confirm dialog opens.
- No test exercises the top-up poll to exhaustion, or `plusBackfillRounds` exhausting all rounds
  over budget, despite the harness already carrying a fast `backfillTopUpPoll` config built for it.
- No test covers the `meterKnown: false` "Refresh status" branch at flow level; it is proven at the
  copy layer only.
- No test drives the poll against plugin unload mid-poll.
- The `newest-first` fixtures are all lexically sortable filenames, so #7 cannot fail any current
  test. A `MMM D, YYYY`-style fixture would pin the contract.
- No test drives `AtomsHomeView.backfillOfferModel` and the flow's derivation against one fixture
  to assert they agree — the divergence #1 warns about would pass both suites.
- No test forces `refreshPlusEntitlementRecord` to `rejected` and asserts what the offer does with
  a known-invalid session.

---

## Verdict

**Ready with fixes.** No P0 in new code. The design is sound and the pure core is genuinely well
tested; what the review found is a consistent shape — the offer is *priced* carefully and then
*spent* without the same care. Three findings (#3, #4, #6) are cases where a run can exceed, drop,
or race what the user confirmed, and all three are small, local edits.

Fix order: #3 (one line), then #4, then #6 — that closes the money-and-markers group. Then #2 and
#1. #5 needs a product decision before it can be coded, and #9 is a release step, not code.
