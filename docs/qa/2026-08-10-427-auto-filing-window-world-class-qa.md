# World-class QA — #427 auto-filing window / backfill split

- **Date:** 2026-08-10
- **Branch:** `claude/backfill-opt-in-709c23` (worktree `community-store-split-settings-21e7d8`), HEAD `4fa7cef`
- **Build under test:** Atoms **v0.6.98**, installed via `./scripts/install-to-vault.sh`
- **Vault lane:** throwaway `test_vault/test vault` **only**. No personal / Remote Vault access at any point.
- **Obsidian:** 1.13.4 (installer 1.12.7), CLI `/opt/homebrew/bin/obsidian`
- **Unit suite:** 87 files / 1567 tests green (reported by the branch; not re-run here)

## Verdict

**Merge-ready with one confirmed defect and two honesty gaps to decide on.**

The filing window holds where it matters. Every unattended path — onload, hourly interval,
manual, resume, catch-up, and the enable tap — is bounded to the window, never reaches today,
and never reaches pre-window history. Concurrency, migration, forward-only stamping, and
malformed-stamp fail-closed all behave as designed under live driving.

The one real hole is the one the plan's own KTD2 comment half-anticipates: the stamp is validated
for **calendar shape but not plausibility**, so a far-past-but-well-formed value is accepted and
restores the full-history sweep the window exists to end.

---

## Test environment and honesty labels

Two things about this run must be read before the evidence:

1. **No Anthropic API key is present on this device** (`getApiKey()` → empty). Filing auth resolves
   to `mode:"plus", status:"active"` against `plusBaseUrl = http://127.0.0.1:8799`, a **localhost dev
   endpoint**, which was down.
2. To get a *real* end-to-end filing pass without spending API credits, I stood up a **deterministic
   local stub** on `127.0.0.1:8799` answering `POST /v1/classify` with a well-formed
   `ClassificationResult` whose title is derived from the capture text
   (`scratchpad/classify-stub.mjs`, not committed).

**What that means for the claims below.** Everything except the model's *judgement* is the real
production path: `maybeAutoRun` → `runAutoFilingCycle` → `resolveAutoFilingSince` → real
`getPastDailyNotesWithUnmarkedCaptures(since)` → real `runWritePath` → real atom files → real
marker appends → real `writeLastRunDay`. Only the classify **response** is stubbed. The window
bound, the scan, the count/recount, the stamp, the concurrency lock and the marker writes are all
untouched production code. **No live classify ran; no API credits were spent.** This is labelled
plumbing-grade proof of the *window*, which is what this change is; it is not a claim about
classification quality.

Captures were authored the user way — `- text` bullets appended to daily notes — not seeded via
`npm run seed:vault`.

### Vault fixture

- 46 dailies: `2026-06-01` … `2026-07-31` (pre-existing), plus `2026-08-03` … `2026-08-10` created
  for this run.
- Simulated enable day for the window stories: **2026-08-06**, written directly to
  `atoms-auto-run-start-day`. That is a *device-state simulation* (the plugin can only ever stamp
  "today"), and is labelled as such wherever it is load-bearing.
- Starting state: **56** unprocessed captures across 31 past days; **0** inside a window starting today.

---

## Pass / fail table

| # | Story | Verdict | One-line evidence |
|---|---|---|---|
| 1 | The window holds | **PASS** | Exactly 4 dailies changed (`2026-08-06..09`); 42 byte-identical, incl. all pre-window and today |
| 2 | Day one is silent, and honest | **PASS** (post-enable) / **gap pre-enable** | Enable stamped `2026-08-10`, zero dailies changed; post-enable card says "Process when you are ready". Pre-enable CTA still pairs 56 with an automatic-filing promise — see F2 |
| 3 | Status agrees with reality | **PASS** | Notice `past=0`; window count 0; `wouldRunNow` false on a drained, stamped day |
| 4 | Diagnostic stays honest | **PASS** | `list-unprocessed-captures` → "56 unprocessed capture(s) across 31 past day(s)" while window count is 0 |
| 5 | Today is never touched | **PASS** | Today byte-identical across onload / interval / manual / resume / catch-up / enable tap, with 2 unprocessed captures sitting in it |
| 6 | "Sync everything now" on a never-enabled device | **PASS** | Refused `no_egress_ack`; **no** start day written; all 46 dailies byte-identical |
| 7 | Corrupt `LS_AUTO_RUN_START_DAY` | **PARTIAL — junk PASS, far-past FAIL** | 7 junk shapes all fail closed to today (window 0); `1970-01-01` accepted → window 48 → **15 captures filed across 11 June/July dailies**. See **F1** |
| 8 | Enable → disable → re-enable across a day boundary | **PASS** | Future stamp survives an enable-today; past stamp moves forward to today; disable preserves; re-enable idempotent |
| 9 | Migration | **PASS** | Stamps once + sets `window-migrated`, with 3 home leaves open; second reload no-op; home refresh and status command both mint nothing; disabled device not migrated |
| 10 | Two passes at once | **PASS** | 3 concurrent passes → 1 `ok`, 2 `in_flight`; exactly 6 classify calls for 6 window captures |
| 11 | Empty and degenerate vaults | **PASS** (in scope) | Drained → `same_day`; future-dated window → `empty`, stamps, 0 calls; oldest-daily-in-window → bounded, no crash; no-dailies-at-all → filing graceful, but home view throws (**pre-existing**, see F4) |
| 12 | Free-form adversarial | **2 findings** | See F2 (enable CTA copy) and F3 (migration copy has no consumer) |

---

## Findings

### F1 — CONFIRMED DEFECT: a well-formed far-past stamp restores the full-history sweep

**Where:** `src/platform/autorun.ts:62-71` (`isFilingDay`), consumed by
`readAutoFilingStartDay` → `resolveAutoFilingSince` (`src/platform/autorun.ts:179-188`).

`isFilingDay` validates `YYYY-MM-DD` shape and calendar validity. It does not validate
plausibility. `"1970-01-01"` and `"0001-01-01"` are both real days, so both are accepted verbatim
as the filing-window start.

Observed live:

```
window count with since="1970-01-01"  → 48   (the entire vault history)
maybeAutoRun("interval")              → {ran:true, reason:"ok"}, markers:15, atoms:15
dailies mutated: 2026-06-26, 2026-07-09, 07-10, 07-11, 07-12,
                 07-13, 07-14, 07-15, 07-16, 07-17, 07-18
```

That is exactly the unbounded backfill this change exists to end — 15 per pass, and because
`shouldStampLastRunDay` only stamps on a **drained** window, the hourly interval keeps re-entering
until all of history is filed and paid for.

**Why it is not merely theoretical.** The doc comment directly above `isFilingDay`
(`autorun.ts:56-60`) states the threat model itself: *"the stamp lives in localStorage, which any
other plugin or a devtools session can write (KTD6)"*. The defence written for that threat model
stops at lexical-sort safety and never covers plausibility, so the stated attacker wins. The plan's
own risk row — "Unresolvable start day reverts to a full-history sweep" (line 449) — is closed for
*unresolvable* values and open for *resolvable implausible* ones.

**Severity: P2.** It needs local write access to this device's `localStorage` (another plugin,
devtools, or a synced-config mishap), and the blast radius is unwanted filing plus API spend, not
data loss — markers are additive and idempotent. But it silently spends a paying user's quota on
work they never asked for, which is the exact harm the window was built to prevent.

**Suggested fix:** clamp the resolved bound rather than trusting the stored value, e.g. record a
device first-seen day at install/migration and return `max(stored, firstSeen)`, or floor the bound
at `today - N` days. Either keeps the forward-only invariant and removes plausibility from the
trust surface.

### F2 — Honesty gap: the enable CTA promises automatic filing next to a count it will never file

**Where:** `src/home/atomsHomeData.ts:745-756` (`filingHeroCopy`, `enable_auto` branch), plus
`src/settings/consent.ts:24` (`EGRESS_DISCLOSURE`).

Before enabling, home reads (verbatim, live):

> **56 Captures Waiting** — "Turn on automatic filing so past days file when you open Obsidian. Or
> Process now." → **[Turn on automatic filing]**

Tapping it raises the consent sheet, whose four numbered clauses disclose TLS, unattended sends,
`Sync everything now` spend, "today's daily note is never auto-touched", and device-locality —
**and say nothing about the window**. Accepting it files **zero** of those 56, now or ever, from any
unattended path.

The commit `313f83d` ("only the window count may promise automatic filing") fixed the *post*-enable
card correctly — after enabling, the card flips to "Ready / 56 Captures Waiting / **Process when you
are ready.**", and `waitingSubtitle` correctly says "56 thoughts ready to file" rather than "will file
automatically". Verified live. The rule just was not applied to the branch that *sells* the feature,
which is the one the user reads while deciding.

This is a copy/disclosure decision, not a code bug, and it is arguably U7's job. Flagging it because
this build ships the CTA today and U7 is deferred.

### F3 — `LS_AUTO_RUN_WINDOW_MIGRATED` is written correctly but nothing reads it

`readAutoFilingWindowMigrated` (`src/platform/autorun.ts:151-155`) has **zero production
consumers** — only tests. The flag's own doc comment says it exists because the migration
"deliberately pauses an in-progress silent sweep" and "without this flag a paying user watches
filing stop and concludes the plugin broke". `atomsHomeView.ts:685` similarly refers to "the copy
explaining why the sweep paused". **That copy does not exist anywhere in `src/`.**

The plan explicitly defers it: U5/U7 "make backfill *good*; they do not gate the claim. Do not hold
the post for them." So this is planned, not accidental. But as shipped, a migrated device gets its
history silently removed from automatic filing with no in-product explanation. **This belongs in the
release notes for this version**, or the migration lands as the exact "the plugin broke" experience
the flag was created to prevent.

### F4 — Pre-existing: Atoms home throws when the daily-notes folder is missing

With `Daily/` renamed away, `countPastUnprocessed`, `maybeAutoRun`, `auto-run-status` and
`list-unprocessed-captures` all degrade gracefully (`count:0`, `reason:"empty"`, no spend). The
home view refresh throws `Error: Failed to find daily notes folder` — the `catch` at
`src/home/atomsHomeView.ts:715` only special-cases `DailyNotesDisabledError` and rethrows anything
else.

`git diff master...HEAD -- src/home/atomsHomeView.ts` shows **no change** to any `try`/`catch`/
`throw` line, so this is pre-existing on master and out of scope for this PR.

### F5 — Minor: a future-dated stamp silently disables filing until that day

Story 8 case A: with `start-day = 2026-08-20`, enabling today correctly refuses to drag the stamp
back (that is the invariant working), but the resulting window is empty for 10 days and the pass
reports `empty` and stamps the day. Filing appears on, does nothing, and says nothing. Fail-closed
direction, so safe — but it is a silent state with no surface. Worth a status line if F1's clamp is
implemented.

---

## Evidence — exact commands

All run from `cwd = test_vault/test vault`. `obsidian eval` snippets abbreviated to the assertion.

### Setup

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
# → Installed Atoms v0.6.98 → …/.obsidian/plugins/atoms ; Reloaded plugin via CLI: atoms
```

Capture bullets appended by hand to `Daily/2026-06-26`, `2026-07-10`, `2026-07-29` (pre-window
controls) and to newly created `Daily/2026-08-03 … 2026-08-10`.

### Story 6 — catch-up on a never-enabled device

```bash
obsidian command id=atoms:sync-everything-now
obsidian eval 'code=(async()=>{const p=app.plugins.plugins["atoms"];
  const r=await p.maybeAutoRun("manual",{bypassEnabled:true,silentHome:true});
  return JSON.stringify({r, unbounded:await p.countPastUnprocessed({}),
    win:await p.countPastUnprocessed({since:"2026-08-10"}),
    start:app.loadLocalStorage("atoms-auto-run-start-day")})})()'
# → {"catchUpRun":{"ran":false,"reason":"no_egress_ack"},
#    "unboundedPastCount":56,"todayWindowCount":0,"startDayAfter":null}
diff baseline.txt after-story6.txt   # → identical (46/46 dailies)
```

### Story 4 — unbounded diagnostic

```bash
obsidian command id=atoms:list-unprocessed-captures
# Notice: "Atoms: 56 unprocessed capture(s) across 31 past day(s) — see console"
```

### Story 2 / 5 — enable tap

Driven through the real DOM path: clicked **Turn on automatic filing** → `ConsentSheetModal` →
clicked **I understand**.

```
consent sheet text (live): "…(2) tapping \"Sync everything now\" classifies even when automatic
filing is turned off; (3) today's daily note is never auto-touched; (4) this setting stays on this
device only."

localStorage after: {enabled:true, last-run-day:"2026-08-10",
                     egress-ack:"2026-08-06", start-day:"2026-08-10", window-migrated:null}
diff pre-enable.txt post-enable.txt  → identical (46/46)
home after enable: "Ready / 56 Captures Waiting / Process when you are ready. / Process now / Preview"
```

### Story 3 — status

```bash
obsidian command id=atoms:auto-run-status
# Notice: "Atoms auto-run: on · ack=true · last=2026-08-10 · ready=true · past=0"
# snapshot: {enabled:true,lastRunDay:"2026-08-10",egressAcked:true,startDay:"2026-08-10"}
#           windowCount:0  unboundedCount:56   → wouldRunNow=false
```

### Story 1 — the window holds (headline)

```bash
# device-state simulation: this device "enabled filing on 2026-08-06"
app.saveLocalStorage("atoms-auto-run-start-day","2026-08-06")
# → windowCount 8, unboundedCount 56

# (a) with the classify endpoint DOWN — proves the bound reaches the write path
maybeAutoRun("manual") → {ran:true,reason:"ok"}, failed:8, markers:0, lastRunDay:null
  failures[].dailyPath ∈ {Daily/2026-08-06.md, Daily/2026-08-07.md}   # in-window only
  local stub received exactly 8 requests
  all 46 dailies byte-identical; failed pass did not burn the day

# (b) with the deterministic stub UP — the real write path completes
maybeAutoRun("interval") → {ran:true,reason:"ok"}, markers:8, atoms:8, failed:0,
                            lastRunDay:"2026-08-10"

diff s1-before.txt s1-after.txt →
  CHANGED: Daily/2026-08-06.md  Daily/2026-08-07.md  Daily/2026-08-08.md  Daily/2026-08-09.md
  UNCHANGED: 42 / 46   (all pre-window dailies + Daily/2026-08-10.md)
  changes outside 2026-08-06..09: NONE
```

Pre-window control line, after the pass, unchanged and unmarked:

```
Daily/2026-07-29.md:  - 2026-07-29 pre-window capture: the filing window must never reach this line
```

In-window daily, after the pass:

```
Daily/2026-08-06.md:
  - 2026-08-06 capture one: window probe alpha
  	↳ [[Stub filing 2 2026-08-06 capture one window probe alpha]] <!--linker-->
```

### Story 7 — corrupt stamp

```
wrote → read back → snapshot.startDay → window count if used
"yesterday"   → "yesterday"   → null         → 0      fail closed
""            → (dropped)     → null         → 0      fail closed
null          → (dropped)     → null         → 0      fail closed
"2026-02-31"  → "2026-02-31"  → null         → 0      fail closed
"20260810"    → "20260810"    → null         → 0      fail closed
"2026-8-1"    → "2026-8-1"    → null         → 0      fail closed
{}            → {}            → null         → 0      fail closed
"1970-01-01"  → "1970-01-01"  → "1970-01-01" → 48     ** OPEN **
"0001-01-01"  → "0001-01-01"  → "0001-01-01" → 48     ** OPEN **
"2026-08-06"  → "2026-08-06"  → "2026-08-06" → 0      ok
```

Junk re-stamp confirmed live: with `start-day="yesterday"`, `maybeAutoRun("interval")` →
`{ran:true,reason:"empty"}`, `start-day` re-stamped to `"2026-08-10"`, **zero** new classify calls.

Far-past confirmed live: with `start-day="1970-01-01"`, `maybeAutoRun("interval")` →
`{ran:true,reason:"ok"}, markers:15, atoms:15`, 11 June/July dailies mutated.

### Story 8 — forward-only stamp

```
future stamp 2026-08-20 + enableAutomaticFilingFromHome() → start-day stays "2026-08-20", enabled:true
disable                                                    → start-day preserved "2026-08-20"
past stamp 2026-08-01 + enable                             → start-day moves forward to "2026-08-10"
re-enable same day                                         → "2026-08-10" (idempotent)
```

### Story 9 — migration

```
prepare: enabled=true, start-day=null, window-migrated=null,  3 atoms-home leaves OPEN
obsidian plugin:reload id=atoms
  → {start:"2026-08-10", migrated:true, enabled:true, lastRun:"2026-08-10"}   # migration won the race
obsidian plugin:reload id=atoms   (second)
  → {start:"2026-08-10", migrated:true}                                       # no re-stamp

# reads must not mint state
start-day=null, migrated=null, enabled=true
  home view refresh()      → {start:null, migrated:null}    # fix holds
  showAutoRunStatus()      → {start:null}                   # diagnostic mints nothing

# disabled device
enabled=false, start-day=null, migrated=null → reload → {start:null, migrated:null}
```

### Story 10 — concurrency

```
window before: 6 unprocessed
Promise.all([maybeAutoRun("interval"),
             maybeAutoRun("manual",{bypassEnabled:true}),
             maybeAutoRun("onload")])
  → [{ran:true,reason:"ok"}, {ran:false,reason:"in_flight"}, {ran:false,reason:"in_flight"}]
stub classify calls: 23 → 29   (exactly 6, one per window capture — no double spend)
```

### Story 11 — degenerate

```
drained window, day stamped          → {ran:false, reason:"same_day"},  0 classify calls
start-day="2027-01-01" (future)      → count 0, {ran:true,reason:"empty"}, day stamped, 0 calls
start-day="2026-06-01" (oldest daily)→ count 33, bounded, no crash
Daily/ renamed away                  → count 0, {ran:true,reason:"empty"}, status OK, list OK
                                        home view refresh THROWS (F4, pre-existing)
```

### Story 12 — attended commands stay unbounded

`runProcessUnprocessed` (`src/plugin/main.ts:1964`) and the dry-run preview
(`src/plugin/main.ts:2161`) pass `includeToday` but **no `since`**. Verified the user's escape hatch
to their own history is intact — unbounded count 33 vs window count 0 at the same moment.

---

## Screenshots

Committed under `docs/qa/screenshots/backfill-opt-in-709c23/`. Each is paired with a live text
assertion read out of the DOM in the same step, because `dev:screenshot` has returned pre-render
frames in this project.

| File | Shows | Paired assertion |
|---|---|---|
| `01-home-auto-on-window-empty.png` | Filing on, window empty, 33 waiting | DOM: "33 thoughts ready to file", "33 Captures Waiting" |
| `02a-home-before-enable.png` | Pre-enable CTA (F2) | DOM: "56 Captures Waiting … Turn on automatic filing so past days file when you open Obsidian" |
| `02b-consent-sheet.png` | Egress consent sheet (F2) | DOM: 4 clauses, no window disclosure |
| `02c-home-after-enable.png` | Post-enable honest card | DOM: "Ready 56 Captures Waiting Process when you are ready." |
| `03-auto-run-status.png` | Status Notice | Notice: "on · ack=true · last=2026-08-10 · ready=true · past=0" |
| `04-list-unprocessed-notice.png` | Unbounded diagnostic | Notice: "56 unprocessed capture(s) across 31 past day(s)" |

---

## What I could NOT prove

1. **Live classification quality.** No API key on this device and the Plus endpoint is a dead
   localhost URL. Every filing pass that produced markers was served by a local deterministic stub.
   The window, scan, count, stamp, lock and marker-write logic are real; the model's verdicts and
   titles are not. **No live classify ran; zero API credits spent.**
2. **A genuine calendar day boundary.** `localDateString()` reads the system clock, which I did not
   change. Story 8's "across a day boundary" was proved by *stored-stamp* manipulation
   (future-dated and past-dated stamps against a real today), not by advancing the machine clock.
   The forward-only invariant is proved; a real midnight rollover is not.
3. **The real enable-day window.** The plugin can only ever stamp "today", so Story 1's
   `start-day = 2026-08-06` was written directly to `localStorage`. That simulates a device that
   enabled 4 days ago; it is not a device that actually did.
4. **The priced backfill surface.** Deliberately not built (U5/U8). Not tested, and its absence is
   intended per the plan.
5. **Mobile (iOS/Android).** Desktop-only pass. Auto-run flags are device-local, so phone behaviour
   is unverified here.
6. **Multi-device window union / marker dedupe across Sync** (KTD6's accepted consequence). Single
   device only.
7. **The unit suite** was not re-run in this session; the 87/1567-green figure is carried from the
   branch report.

---

## Recommendation

Merge, with F1 tracked as a follow-up (clamp the resolved bound so plausibility is not part of the
trust surface) and **F3 written into the release notes for this version** — a migrated device stops
filing its history with no in-product explanation, and U7 is deferred. F2 is a copy decision worth
resolving before the CTA reaches Community users. F4 is pre-existing and unrelated.
