# World-Class QA: update-notes-once-then-settings

## Verdict

Ready for owner merge with labeled gaps. Live vault proved Home news, spend confirm, Not now quiet, Process-wait hide, and Settings File-group waves (including `Up to date` no-op) on plugin **0.8.16**. A successful paid wave (`updated > 0`) and leftover-key Plus confirm were **Not Tested** live (no Plus session, no API key). Those paths are unit-locked.

## Charter

Apple-shaped Update notes: Home names what got smarter once per quality; confirm is the spend; Home goes quiet; more waves live on Settings `Update notes › Readings can link`. Adjacent risk: wait card hiding news, leftover BYOK spending on Update, ranker preferring just-written `mtime`, Settings popout unscapturable on desktop.

**Product loop vs fixture:** Process-hide used the throwaway vault's real unprocessed backlog (29 captures waiting). Home news / confirm / Not now / Settings used planted `atoms-quality: 8` linker atoms (labeled UI-chrome — Process at CURRENT 9 cannot mint this news). Seeded dailies were marked `<!--linker:noise-->` so the wait card would not steal the hero; that marking is fixture, not product dogfood. Paid classify was not run.

**Authority:** `docs/plans/2026-08-21-002-feat-update-notes-once-settings-plan.md` KD1–KD8, R1–R16, AE1–AE9, F1–F6. Mock `docs/design-handoff/atoms-view/update-notes-once-then-settings.html`. Settings grammar: a row is a noun and its state is the answer.

## Preflight

- **Product dogfood honesty** ✅
- **Learnings** ✅ then ➕ (loadLocalStorage prefix; screenshot-after-wait stale pair; markers vs eval-zero)
- **Navigation map** ✅ followed; QA bullet healed this change (do not eval-zero the wait card)
- **Run command:** `./scripts/install-to-vault.sh` then `obsidian eval` / `dev:screenshot` / `obsidian command`
- **Fixture:** throwaway `test_vault/test vault/`; planted QA linker atoms + marked seed dailies (labeled)
- **Viewport:** Home frames at desktop; Settings frames at `is-phone` 390×844 (installer 1.13.7)
- **Auth:** none-engine (confirm copy `Sign in to Atoms Plus or add an API key in Settings first.`). Plus leftover-key: unit only
- **Vault lock:** held (`QA #596 live Update notes`); released after this pass
- **Build fingerprint:** installed `main.js` contains `Readings can link`, `projectPlusIdentityAuth`, `resolveUpdateNotesAuth`, `atoms-home-update-notes`. `app.plugins.plugins.atoms.manifest.version` = `0.8.16`

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story |
|---|---|---|---|
| Home news | R1, R3, AE1 | Title `Update notes`; body q9 reason; no count | US-news |
| Home Update | R4, AE2 (none-engine live) | Modal `Update N notes?`; spend copy; no quality pitch | US-confirm |
| Home Not now | R5, R7, AE4 | Heard key CURRENT; strip gone; Settings still offers waves | US-not-now |
| Process wait | R10, AE5 | Wait card in hero; `.atoms-home-update-notes` absent | US-process-hide |
| Settings row | R8, R9, AE6 | File group, immediately after Filing; `Readings can link` | US-settings |
| Settings tap | R9, F4 | Same confirm; recount; Cancel free | US-settings-confirm |
| Settings current | R9, AE7 | `Up to date`; tap does not open confirm | US-uptodate |
| Confirm Cancel / Escape / outside | R16 | No `runUpdateNotes`; heard unchanged | US-cancel |
| Command | R14 | Named `Update notes`; no Modal; still claims in-flight | US-command |
| Spent Plus leftover key | R4, AE9 | Confirm keeps Plus identity; classify does not spend the key | US-plus-identity (unit) |
| Ranker | R12, AE8 | Source daily then `created`; never mtime | US-ranker (unit) |

## Targets (§3a)

Interactive: Home **Update**, Home **Not now**, confirm **Cancel** / **Update** / Escape / outside, Settings **Update notes** row, palette `atoms:update-notes`.

Informational: Home title/body (no count), confirm title `Update N notes?` + billing sentence, Settings answer `Readings can link` / `Up to date`, File footer catch-up sentence, command name.

## User Stories Tested

1. As a vault with q&lt;CURRENT linker atoms and no Process wait, I open Atoms home and see one news card. Acceptance: title `Update notes`; body `Readings of the same thing can link now. Your original text stays.`; no eligible count. Evidence: `docs/qa/screenshots/update-notes-once-then-settings/news.png` (paired `news-c2`/`news-c3`). Status: Passed. Proof kind: ui-chrome-only (planted q8 atoms).
2. As a reader who taps Update with no engine, I get a spend confirm. Acceptance: `Update 4 notes?`; body asks to sign in or add a key; Cancel / Update; no “Readings” / “Filing got smarter” in the modal. Evidence: `confirm.png`; eval `confirmTitle:"Update 4 notes?"`. Status: Passed. Proof kind: ui-chrome-only.
3. As a reader who taps Not now, Home goes quiet until the next quality. Acceptance: `app.loadLocalStorage("atoms-update-notes-dismissed-q") === "9"`; strip absent; library remains. Evidence: `quiet.png`; eval `hasUpdate:false`, `heard:"9"`. Status: Passed. Proof kind: ui-chrome-only (Not now is a real tap; news itself was planted).
4. As a vault with unprocessed past captures, Process waiting hides Update. Acceptance: hero is `29 Captures Waiting`; no `.atoms-home-update-notes`. Evidence: `process.png` taken **before** dailies were marked. Status: Passed. Proof kind: user-loop (seeded backlog, not planted hubs).
5. As a reader whose Home is already quiet with debt remaining, Settings File group holds the rest. Acceptance: row immediately after Filing; answer `Readings can link`; File footer contains `Older notes catch up when you ask. Same AI as filing. New days still come first.` Evidence: `settings.png`, `settings-footer.png`; eval `next:"Update notes"`. Status: Passed. Proof kind: ui-chrome-only.
6. As a reader who taps that Settings row, I get the same spend confirm. Acceptance: `Update 4 notes?` + none-engine body; extra modal count 1. Evidence: `settings-confirm.png`; eval. Status: Passed.
7. As a vault with every linker atom at CURRENT, Settings says `Up to date` and a tap is a no-op. Acceptance: description `Up to date`; extra modal stays 0 after two taps. Evidence: `settings-uptodate.png`; eval. Status: Passed. Proof kind: ui-chrome-only (qualities bumped then restored).
8. Cancel / Escape / click-outside do not spend and do not write heard. Acceptance: after each dismiss, extra=0, heard still `"9"`, `manualFilingInFlight` false. Evidence: CLI JSON. Status: Passed. (Cancel close is not same-tick; wait one CLI round-trip.)
9. A second tap while confirm is open does not stack. Acceptance: extra stays 1. Evidence: eval `extraAfter:1`, titles `["Update 4 notes?"]`. Status: Passed.
10. Palette `atoms:update-notes` during an open confirm does not open a second Modal and does not write heard. Acceptance: one confirm remains; Notice names missing engine; heard `"9"`. Evidence: eval + Notice observer. Status: Passed. Proof kind: live CLI (auth abort, no spend).

## Risk Matrix

| Class | Check | Result |
|---|---|---|
| Happy | News once, confirm spend, Settings more | Passed (live frames) |
| Negative | No engine confirm; command auth abort | Passed (live) |
| Edge | `Up to date` tap no-op | Passed (live, restored) |
| Edge | Confirm N = min(debt, 15); here debt 4 | Passed (live `Update 4 notes?`) |
| Edge | Second tap / command during confirm | Passed (no stack) |
| Regression | Wait card still wins the hero | Passed (`process.png`) |
| Perception | No count on Home; confirm is spend-only | Passed (craft read of `news.png` / `confirm.png`) |
| Perception | Settings noun + answer | Passed (`Readings can link` / `Up to date`) |
| Ranker | source daily then `created`; never mtime | Passed (unit; inverted Alpha/Zulu fixture) |
| Plus leftover key | Update stays Plus, Process may fall through | Passed (unit `projectPlusIdentityAuth`); **Not Tested live** |
| Paid wave | `updated > 0` writes heard | Passed (unit `rememberUpdateNotesHeard`); **Not Tested live** |

## Evidence

- `npm test`: 114 files / 2324 passed (head `1813c78`)
- `npm run lint` / `npm run build`: passed; version 0.8.16
- CI on PR #595: `test` and `test + build` success at `1813c78`
- Obsidian 1.13.7 CLI; plugin loaded; vault lock held during drive
- Screenshots: `docs/qa/screenshots/update-notes-once-then-settings/`
  - `news.png` — Home news (desktop)
  - `confirm.png` — Home spend confirm, N=4, none-engine
  - `quiet.png` — after Not now
  - `process.png` — 29 Captures Waiting, no Update strip
  - `settings.png` — File group, Filing then Update notes › Readings can link (`is-phone`)
  - `settings-confirm.png` — same spend confirm from Settings
  - `settings-uptodate.png` — Update notes › Up to date
  - `settings-footer.png` — File footer catch-up sentence visible
- Demo clip: Settings confirm at phone width (`Update 4 notes?`, none-engine copy). Static for ~27s, then an Obsidian reload at the end (not part of the product path).
- Vault mutations (throwaway only, labeled): planted `Atoms/QA same reading {morning,evening}.md`, `Atoms/QA older reading.md` (q8 linker); appended `<!--linker:noise-->` to 29 unmarked past-daily captures; temporarily set all four linker qualities to 9 for AE7 then restored 8/8/8/5
- Heard key read via `app.loadLocalStorage("atoms-update-notes-dismissed-q")` → `"9"` (not `window.localStorage`)

## Findings

1. **P3 — Capture shortcut banner sits under Home news.** Pre-existing Home chrome. Not overlapping the Update / Not now CTAs. Out of this claim.
2. **P3 — `dev:screenshot` after a long wait can freeze on the pre-scroll Settings frame** for every shot in a burst (byte-identical to the previous written hash). Scroll then capture immediately; keep frames 2 and 3 when they differ from the last file. Not a product bug.
3. **Lead, unproven — two Notices from one `atoms:update-notes` during an open confirm.** Observer recorded the same missing-engine sentence twice. Could be DOM duplication of `.notice`. Confirm did not stack. Not filed as a hole.

No P0/P1/P2 product defects in this pass.

## Adversarial QA

| Scenario | Result |
|---|---|
| Not now then Settings still offers waves | solid — heard `"9"`, Settings `Readings can link` |
| Cancel from Settings confirm | solid — extra 0 after a wait; heard unchanged |
| Escape from Settings confirm | solid — extra 0; heard unchanged |
| Click-outside (modal-bg) | solid — extra 0; heard unchanged |
| Second tap while confirm open | solid — extra stays 1 |
| Palette command during confirm | solid — no second Modal; auth abort; heard unchanged |
| `Up to date` double-tap | solid — extra stays 0 |
| In-flight second Settings tap | solid (unit `filingPassInFlight`); live in-flight not driven (would need a classify) |
| Paid Update then Home quiet with debt remaining | blocked: no Plus session / API key; do not spend to hide the strip |
| Exhausted Plus leftover key confirm | blocked: no session; unit `filingAuth.test.ts` + settings U4 |
| Ranker after polish `mtime` bump | solid (unit); not re-driven live |
| Phone / iOS WebView | Not Tested — desktop `is-phone` emulation only |
| Delete / rewrite an atom mid-confirm | solid at code (`openConfirm` is the sheet; Cancel does not call `onConfirm`); not live-deleted |

No proven product hole. Destructive classes that need classify spend remain Not Tested live.

## Not Tested

- Live Plus confirm copy (`Uses Atoms Plus (N of this month's filings)…`) and leftover-key Plus identity on the Modal
- A wave with `report.updated > 0` (heard write from the run, land peak, Settings answer after a real refile)
- Clamping confirm N when debt &gt; 15 (vault had 4)
- Real phone / Android WebView
- Palette command happy path with an engine (force path skips confirm by design)

## Learnings

Consulted. Appended three rows: markers vs eval-zero for the wait card; `app.loadLocalStorage` vault prefix; `dev:screenshot` after a Settings re-render/wait.

## Merge Decision

Owner can merge. Automated suite and CI green. Live frames cover news, confirm, quiet, Process-hide, Settings more, Settings confirm, `Up to date`. Residual: no paid wave and no leftover-key Plus Modal on this vault — both unit-locked; do not treat unlabeled planted atoms as day-one product proof.
