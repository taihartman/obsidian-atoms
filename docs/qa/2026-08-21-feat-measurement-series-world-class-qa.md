# World-class QA — Measurement series (#589) — 2026-08-21

**Status: BLOCKED for merge-ready.** The automated half ran in full and is
green; the live-vault half cannot run in this environment (remote session, no
Obsidian, no CLI, no vault). This report states exactly what was proven and
what remains. Per `docs/qa/README.md`, a code-read is not world-class QA and
this report does not claim it is.

## Environment

- Remote agent session (claude.ai/code container). `npm` toolchain only.
- No Obsidian CLI, no `test_vault/`, no screenshots possible.
- Plus service prompt updated in-repo (`plus-service/src/classifyTemplate.mjs`);
  **Fly deploy needed before Plus-routed classify sees the new prompt.**
  BYOK classify ships the prompt with the plugin.

## What ran (evidence)

| Check | Result |
|---|---|
| `npm run build` (tsc + esbuild production) | green |
| `npm run lint` (eslint-plugin-obsidianmd, max-warnings 0) | green |
| `npx vitest run` full suite | **2282 passed / 0 failed** (was 2270 pre-branch; +42 new, no regressions) |
| Prompt parity (plugin vs plus-service), phrase-locked | green (`classificationContract.test.ts`, new phrase locked) |
| Enrich order contracts (live + offline, call-site aligned) | green |
| Copy voice (no em dashes in `src/**` literals) | green |

## Product claims proven at unit level (pure logic, live captures verbatim)

- AE1 (partial): the 73042 capture opens a loop (`looksLikeOpenLoop` verbatim
  test) and is measurement-shaped; no hub invite fires from one reading.
- AE2 (partial): 73089 rescues from a noise verdict to atom; with `My car` in
  titles it files linked (island-never regression); two readings produce the
  `Track My car?` invite (`Series` kicker, exact copy asserted); the loop-close
  offer pairs the live captures verbatim.
- AE3 (partial): snoozed label stays quiet; chain-through-shortlist is
  model-side and needs live Process to observe.
- AE4: told pair never re-offers (collector honors told-set; decline stamps it).
- AE5: `buy milk`, `buy 2 gallons of milk`, `call dentist at 3`,
  `pay $1200 rent tomorrow`, lone timestamp all stay non-readings; activity
  distances (`Ran 6 miles`, `Drove 300 miles today`) excluded.
- AE7: weight and rent shapes recognized and keyed (`weight`, `rent`).
- AE8: forced Keep with a same-thread hub in context files linked, never
  `links: []` (the exact regression from the live vault).
- AE6 machinery: quality bump 8→9 flips eligibility; refresh infers a loop when
  frontmatter has none and never invents one for substance; rename + marker
  retarget + alias already covered by existing refresh tests.
- Redeem correctness: `applyRedeemsLink` upgrades an existing series link's
  reason in place (title-dedup append would have written nothing), appends when
  absent, no-ops when already redeeming.

## Code review (built-in `code-review` skill, high effort — ce-code-review unavailable)

Seven findings, all fixed and regression-locked in the same session:

- **P0 (body is sacred):** `applyRedeemsLink` / `applyHardLinkToAtomContent`
  treated a trailing body paragraph as the link region and replaced it —
  verified destroying "Also the brakes squeak a bit when cold". Replace now
  requires the region to parse to links; append keeps the whole body (the old
  append also re-sliced to the first paragraph). Fixed at the source, so
  person/list invite accepts inherit the fix.
- **P1:** bare "miles"/"weighs" counted as durable things ("Half marathon is
  13.1 miles" keyed as a car reading). THING_RE narrowed to real things; the
  weigh-in idiom and whole-capture bare odometer kept as explicit arms.
- **P1:** two loop patterns lacked the intent lead their comment claimed
  ("Customers come back to brands…" opened a loop) — amplified by the quality
  sweep now stamping inferred loops on refresh. Patterns now require an intent
  lead or line-initial imperative.
- **P1:** declining the newest pair let the same loop re-offer with each older
  reading. Collector now offers one pair per loop (newest reading only); told
  silences the loop until genuinely new evidence arrives.
- **P2:** mixed date-only/date-time created stamps mis-ordered same-day pairs
  (raw string compare); now day-granularity.
- **P2:** error paths left the close card stranded on disabled "Closing…"
  buttons; render moved to `finally`.
- **P3:** per-loop body/stamp recomputed inside the readings loop; precomputed.

Residual (pre-existing, out of scope): a trailing body paragraph that itself
contains a wikilink still parses as link prose across the whole
parse/format-roundtrip family (refresh, invites) — the region convention's
known ambiguity, not introduced here.

## Simplify pass (4 parallel cleanup agents: reuse / simplification / efficiency / altitude)

Applied (behavior-preserving unless noted):

- **Altitude:** pure loop logic moved out of the shell — `plugin/openLoops.ts` →
  `pipeline/openLoopState.ts`, removing the `home → plugin` value import the
  architecture doc forbids. Keep-as-note composition moved into
  `pipeline/reconsider.ts` (`keepAsNoteResult`); main.ts is one call again, and
  the override now forwards `continueParentTitle` like every other quality-chain
  caller (small behavior improvement). Loop-inference policy has one home
  (`inferredLoopFm` beside the recognizer); both refresh builders call it.
- **Reuse:** the redeems write is an `upgradeReason` option on
  `applyHardLinkToAtomContent` — one home for the body-safety rule;
  loop-close told rides the existing snooze map (permanent horizon) instead of
  a third localStorage shape; card bodies render through `claimQuote`
  (8-line clamp, shared styling); `exactVaultTitle` replaces two hand-rolled
  title lookups; `normalizeCaptureText` replaces an inline copy; the accept
  path gained the `isGeneratedAtomContent` guard its peers have.
- **Simplification:** one grouping engine for the list-flavoured invite
  collectors (kills the ~35-line clone and its snooze-normalization drift);
  `hubInviteLinkReason` owns the person/series/list reason choice (the view's
  two ternaries gone); loop-close card copy is a pure function like every
  other card's; dead `readingTitle` field, no-op hub-title branch,
  unreachable guards, and the `_stamp` strip removed.
- **Efficiency:** `collectLoopCloseOffers` early-exits before the full-content
  redeem scan when no loop is open (the common case), derives each row once,
  and skips readings no loop wants; `measuredThingKey`/`isMeasurementReading`
  share one scrub+scan (`readingMentions`) instead of doubling the priciest
  regexes; the measured invite collector resolves hub labels against a
  prebuilt lowercase map instead of scanning all vault titles per atom.
- **Robustness from reuse review:** created-stamp parsing now tolerates
  space-separated times and timezone suffixes (previously those atoms were
  silently excluded from offers); pair ids are lowercased for the shared map.

Skipped, with reasons: unifying `CHORE_LEAD_RE` with ideaRescue's `CHORE_RE`
(intentionally different shapes, both tested); sharing the four private
`hasLinkTo` copies across enrichers and a repo-wide `qualityOptsFromContext`
(outside this diff); a data-table rewrite of `hubAssociationInviteCopy`
(explicit copy blocks are this file's house style); `mindChangePairKey` reuse
for pair ids (it sorts; loop/reading roles are directional); folding
`render.ts`/`askOutbox.ts` loop inference into the new helper (their guards
differ deliberately; candidates for a follow-up).

## Adversarial pass (what I tried to break)

- Chore-with-quantity leakage through the rescue: blocked by chore-lead,
  time/place value floors, activity-distance scrub — all locked in tests.
- The "rent" split: `pay $1200 rent tomorrow` (errand) vs `Rent is $1450 now`
  (reading) — both asserted.
- False loop-pairing: unrelated open loop (newsletter) x car reading, weight
  reading x car loop, older reading x newer loop — all refuse.
- Silent no-op close: the model's own taught behavior (link the prior reading
  with a series reason) collided with title-dedup in the accept path; found in
  self-review, fixed (`applyRedeemsLink`), regression-locked.

## NOT proven (live-vault gap — blocking merge-ready)

1. **Live Process end-to-end** (AE1/AE2/AE3 full): capture → Process on the
   throwaway vault; model actually emits atom verdicts and series links under
   the new prompt. Unit tests exercise the rescue/enrich chain, not the model.
2. **Home cards on a real vault**: loop-close card and Track invite rendered,
   accepted, declined; `.atoms-home-loop-close-leg` has no bespoke CSS and
   needs a visual check on desktop + phone width.
3. **AE6 owner run**: Update notes on the personal vault repairing the real
   73042/73089 pair (owner-run only; agents never touch that vault).
4. **Screenshots** for the PR Evidence table (requires 1-2).
5. **Fly deploy** of plus-service before Plus-routed filing uses the new prompt.

## Handoff checklist (local session with Obsidian CLI)

```bash
./scripts/verify.sh                          # tests + seed + install + CLI
# seed two mileage captures on past dailies, then:
obsidian command id=atoms:process-unprocessed
# expect: two atoms, series link on the second, loop FM on the first
# Home: loop-close card → decline → never re-asks; Track My car? → accept
obsidian command id=atoms:update-notes       # after quality bump: old atoms re-title/link
obsidian vault="test vault" dev:screenshot path=docs/qa/screenshots/589-measurement-series/
```
