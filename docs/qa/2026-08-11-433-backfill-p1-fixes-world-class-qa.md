# QA — #433 backfill offer, three P1 fixes (2026-08-11)

**Branch:** `claude/backfill-offer-u5-u8` · **Commit:** `af719bd` · **PR:** [#434](https://github.com/taihartman/obsidian-atoms/pull/434) · **Version:** 0.7.0
**Vault:** `test_vault/test vault` (agent QA lane) · **Obsidian:** 1.13.4 (installer 1.12.7)
**Auth in vault:** Plus, `trialing`, 150 filings, **no API key** — the #433 headline scenario exactly.

**Verdict: merge-ready on fixes #2 and #3. Fix #1 is unproven in a live vault** and rests on a unit
test. See § Gap before merging; that gap is the one thing on this page a reviewer should weigh.

## What was under test

Three P1s from [the code review](../reviews/2026-08-10-433-backfill-offer-code-review.md), fixed in `af719bd`:

1. A confirmed Plus run takes a `maxCaptures` ceiling from the priced offer, so late-arriving
   captures cannot be filed past the number the gate quoted.
2. BYOK holds `backfillInFlight` across its estimate, confirm gate, and submit; the home offer card
   holds its own `backfillCardBusy`.
3. Process and Update notes refuse while another filing pass is in flight, **and** claim
   `manualFilingInFlight` so a backfill or auto-run starting after them sees it too.

## How this was run

Two passes, both driven through the Obsidian CLI against the live vault, both delegated off the
main thread per `docs/qa/README.md`. The first used synthetic flag state; the second re-ran the
same probes against a **genuine open confirm gate**, which is the stronger form and the one
recorded below where the two overlap.

The plugin under test was verified loaded before any check: `version: "0.7.0"` and
`manualFilingInFlight` present on the instance. This mattered — the first install went to a
second vault of the same name inside the worktree, while Obsidian was open on the main checkout's
copy still running **0.6.99**. Every check below ran only after that was corrected. If you take one
process lesson from this page, take that one: probe the running instance for a field the new code
introduces, never trust that an install landed where Obsidian is looking.

## Results

| # | Check | Verdict |
|---|---|---|
| C0 | Control: an unguarded call does reach the inner run (proves the net can fail) | PASS |
| T1 | Loaded plugin reports 0.7.0 | PASS |
| T2 | Process refuses while a backfill holds its flag | PASS |
| T3 | Update notes refuses likewise | PASS |
| T4 | **Backfill refuses while a manual pass holds its flag** (the newly closed direction) | PASS — no gate opened, inner flow never entered |
| T5 | `maybeAutoRun("interval")` under `manualFilingInFlight` | PASS — `{ran:false, reason:"in_flight"}` |
| T6 | No flag left held after all of the above | PASS |
| T7 | Offer card renders on Atoms home | PASS |
| G1 | **Against a real open gate:** Process refuses | PASS |
| G2 | **Against a real open gate:** Update notes refuses | PASS |
| G3 | **Against a real open gate:** auto-run refuses | PASS |
| G4 | Flags actually held across the open gate (`backfillInFlight`, `backfillCardBusy`) | PASS |
| G5 | Cancel releases every flag and re-renders the card | PASS |
| A1 | Both flags set: all four entries refuse cleanly, nothing wedges | PASS |
| A2 | Same-tick double Process (in-process, the real race) — 3 calls, 1 inner entry | PASS |
| A3 | Reload recovers a wedged instance | PASS (see § Incidental) |
| A4 | A throw inside each run leaks no flag — process / update / Plus / BYOK | PASS |
| A5 | Card button: refuses under manual filing; 3 rapid clicks produce 1 flow call | PASS |
| **#1** | **`maxCaptures` ceiling on a confirmed run** | **NOT EXERCISED — see § Gap** |

### Notice strings observed

- `Atoms: backfill already in progress` — T2, T3, G1, G2, A1
- `Atoms: filing already in progress` — T4, A2, A5
- `Atoms: Set an Anthropic API key in Settings, or try Atoms Plus.` — the control signature, i.e.
  what a **failed** guard looks like
- T5 / G3 emit nothing, correctly: the automatic path stays silent

## Evidence

| Screenshot | Shows |
|---|---|
| `screenshots/433-backfill-p1-fixes/atoms-home-backfill-offer-card.png` | The offer card on Atoms home: "Older captures / Atoms can file all 33 sitting further back. Newest first. / Uses 33 of the 150 filings left this period." |
| `screenshots/433-backfill-p1-fixes/backfill-confirm-gate.png` | The gate quoting "Files 33 captures from 17 earlier days, newest first" and "Uses 33 of the 150 filings left in this period". Also evidences the round-2 P0: the privacy line reads "the Atoms Plus proxy", not the Batch-API wording that was wrong for a Plus user at the moment of consent. |
| `screenshots/433-backfill-p1-fixes/atoms-home-after-gate-cancel.png` | Home after cancelling. Named for what it is — there was no run. |

The 33-vs-37 gap is coherent and is itself the KTD3 bound working: 4 captures sit inside the
auto-filing window and are correctly excluded from the backfill complement.

## Gap — fix #1 is not proven live

The `maxCaptures` ceiling lives **past** the confirm gate, so proving it requires a run that
actually classifies. That could not be done honestly here:

`plusBaseUrl` is `http://127.0.0.1:8799`, which is not a mock. It is the real `plus-service`, and
`plus-service/src/config.mjs:68` points it at the real `https://api.anthropic.com/v1/messages`. It
is inert only because `ANTHROPIC_API_KEY` is unset, so `proxyClassify` returns 503 at
`plus-service/src/anthropic.mjs:316` before the outbound fetch:

```
POST /v1/classify -> HTTP 503
{"message":"Plus service missing ANTHROPIC_API_KEY","remaining":150}
```

So crossing the gate was pointless in both directions. Without a key every classify 503s, the run
files 0 of 33, and "filed <= quoted" passes vacuously while proving nothing. With a key it spends
real money against production Anthropic. Neither is the test, so the gate was cancelled.

**What stands in for it:** `test/backfillEntry.test.ts:384` — *"never files past the count the gate
quoted, even if captures land while it is open"*. It opens the real gate, appends five bullets to a
mid-range daily **while the gate is open** (the phone-Sync scenario the fix exists for), confirms,
and asserts 20 filed rather than 25. Confirmed able to fail: it was written before the fix and
failed on 25.

**Unproven live, therefore:** quoted-vs-filed in a real vault, sentinel integrity on the filed
lines, and "no daily on or after `before` was touched" for this specific run.

**To close it** without spending: stub the classify responder in `plus-service`, or point
`ANTHROPIC_MESSAGES_URL` at a local echo. Do **not** close it by exporting a key.

## Hazard worth recording

`plus-service` defaults to the **production** Anthropic URL and is separated from live-fire by a
single unset environment variable. Anyone who exports `ANTHROPIC_API_KEY` and restarts it converts
this QA vault into a real-money path with no further signal — the plugin, the meter, and the gate
all look identical either way. A local-echo default for the dev/QA config would remove a whole
class of expensive accident.

## Incidental findings (pre-existing, not from these fixes)

1. **`onload` starts a filing pass.** `maybeAutoRun("onload")` claims `autoRunInFlight` within ~4s
   of `plugin:reload`, which confounded the first attempt at A3. So "reload to recover from a stuck
   flag" is not an inert action; on a real Plus vault it may begin filing on landing.
2. **The cycle reports success while filing nothing.** That onload pass returned
   `{ran:true, reason:"ok"}` with 4 eligible captures and `ready=true`, yet filed zero, stamped
   nothing, and left 37 unprocessed — because every classify 503s. A run that files zero because
   the service is broken should not report `ok`.

Both are unrelated to these three fixes and neither blocks this PR.

## Vault state

**Unmutated.** 434 atoms, zero files modified, meter still 150, no capture bullets appended, no
atom written. All in-flight flags false at the end of both passes.
