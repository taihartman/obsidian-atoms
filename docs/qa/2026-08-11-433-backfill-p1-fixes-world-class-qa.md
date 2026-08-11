# QA — #433 backfill offer, three P1 fixes (2026-08-11)

**Branch:** `claude/backfill-offer-u5-u8` · **Commit:** `af719bd` · **PR:** [#434](https://github.com/taihartman/obsidian-atoms/pull/434) · **Version:** 0.7.0
**Vault:** `test_vault/test vault` (agent QA lane) · **Obsidian:** 1.13.4 (installer 1.12.7)
**Auth in vault:** Plus, `trialing`, 150 filings, **no API key** — the #433 headline scenario exactly.

**Verdict: all three fixes proven.** #2 and #3 were verified against a genuine open confirm gate on
2026-08-11. #1 was the one gap on this page at merge time and was closed later the same day by a
**live metered run against the real Anthropic API** — see § Fix #1, proven live.

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

## Fix #1, proven live (added 2026-08-11, after merge)

The gap below was closed by running the real thing. A dedicated vault, `test_vault/atoms-qa-433`,
was seeded and pointed at a local `plus-service` carrying a **real Anthropic key**, so every
classify was a real, metered call. Owner's call: development should sit as close to production as
possible.

The vault is deliberately *not* named `test vault`. `scripts/install-to-vault.sh` resolves its CLI
target by vault **basename**, and this machine carries ten-plus worktrees that can each mint a
`test vault` — which is exactly how an earlier attempt at this run ended up driving a stale 0.6.100
build installed by a different session. A distinct name makes that class of mistake impossible.

**Setup:** 20 past dailies, 29 unmarked captures, auto-run off, meter 146.

**The run.** The gate quoted *"Files 29 captures from 20 earlier days, newest first. Uses 29 of the
146 filings left in this period."* While it sat open, five bullets were appended to
`Daily/2026-08-01.md` — a mid-range daily inside the offered window, standing in for a phone Sync
landing mid-gate. Then confirm.

| Assertion | Expected | Actual | |
|---|---|---|---|
| Write path re-scans and sees the late arrivals | 34 | `scanned: 34` | PASS |
| Files only what the gate quoted | 29, not 34 | `entries: 29` | **PASS** |
| Markers appended for every filed capture | 29 | `markersAppended: 29` | PASS |
| Failures | 0 | `failed: 0` | PASS |
| Meter spend matches the quote | 146 → 117 | 117 | PASS |
| The cap drops the *oldest* end | 5 unmarked on 07-22…07-25 | 1+1+1+2 = 5 | PASS |
| Newest-first keeps the late arrivals | 5 sentinels on the new bullets | 5 | PASS |
| Today's daily never touched | 0 markers | 0 | PASS |
| Flags released | all false | all false | PASS |

Without the fix this run files 34 against an offer of 29 — five captures of unagreed metered spend,
taken out of the period reserve the budget model exists to protect.

`atomsCreated` was 6, which looks low against 29 filed and is not a shortfall: most seeded captures
classify as noise or task, which take a marker and no atom.

Evidence: `screenshots/433-backfill-p1-fixes/live-gate-quoting-29.png` (the gate, before confirming)
and `live-home-after-backfill.png`.

## Gap as it stood at merge time (historical)

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

## The dev configuration, and what it costs

An earlier draft of this report filed the production-Anthropic default as a hazard. The owner's
position is the opposite and is the reason fix #1 could be proven at all: dev should sit as close
to production as possible, real key included. Recorded here as the intended setup rather than a
warning against it.

What that means in practice, for whoever reads this next:

- **A local run spends real money.** The 29-capture run above cost 29 filings. Nothing in the
  plugin, the meter, or the gate distinguishes a local dev service from production, so treat every
  confirmed backfill in a QA vault as billable.
- **Use a dedicated key with a console spend cap, not the key the Fly deployment holds.** Identical
  fidelity, rotatable without touching production, and a runaway loop is bounded.
- **Keep the key out of `.env`.** It lives in the macOS Keychain and is read at launch:
  `ANTHROPIC_API_KEY=$(security find-generic-password -s atoms-plus-anthropic -w) node src/server.mjs`.
  `plus-service/.env` holds non-secrets only. Agents run shell commands in this repo, so a plaintext
  key on disk is one stray `cat` from a transcript.
- **The key buys the classify path and nothing else.** Entitlement still comes from
  `DOGFOOD_AUTO_GRANT`, not Stripe. Billing has its own real-fidelity option — test mode plus
  `stripe listen`, documented in `plus-service/README.md` — and it is the half where #230 shipped a
  production bug. A real Anthropic key does not cover it.

## Hazard worth recording

Sessions are revoked more eagerly than the UI admits. During this work a session that had verified
`200` against `/v1/me` later returned `401 Invalid session`, and the plugin surfaced that as
**`status: "exhausted", remaining: 0`** — "you have used all your filings" — rather than as a
sign-in problem. A paying user hitting that state would reasonably go buy a top-up they do not
need. Same family as #230 and worth its own issue.

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
