# World-Class QA: 2026-08-24-fix-594-invite-inherits-hero

## Verdict

**Ready after F1.** Occupancy stories passed live. Adversarial P1 (double-tap Keep accepts Track My car) is fixed: Keep arms a 500ms swap guard; live re-check did not create `My car.md`.

## Charter

PR #604 Home occupancy (Apple cut). Leftover captures under auto_on stay a subtitle count; wait occupies only when filing is blocked; Process lives in More; one question (loop-close, then invite); Keep it open then Track My car even with Show list collected.

**Proof kind:** fixture-plumbing UI chrome (planted 73042/73089 pair + existing Show list + leftover dailies). Not a Process dogfood loop.

**Adjacent risk:** dual Home leaves, More vs question card, Close it redeem, snooze vs told-pair ranking.

## Preflight

- Product dogfood honesty: ✅ present in `docs/qa/README.md`
- Authority: ✅ Apple-cut mock `docs/design-handoff/atoms-view/apple-home-chrome.html`; PR #604; `shouldShowWaitHero` docstring
- Learnings: ✅ read; ➕ appended double-tap Keep this pass
- Navigation map: 🔧 healed Wait card / Home notes (auto_on never occupies; Process in More)
- Run command: `./scripts/install-to-vault.sh` then `obsidian vault="test vault" …`
- Viewport: 390×844 `is-phone` root-split leaf (visible Home 390×733)
- Auth: throwaway vault Plus/BYOK already on; key not wiped
- Fixtures: reuse `test_vault/test vault` (desktop throwaway). Did not recreate.
- Automation: Obsidian CLI eval + `dev:screenshot`. No Playwright. No phone WebView.
- Vault lock: acquired `world-class-qa #604` / `adversarial-qa #604`; released after each drive
- Build: worktree `main.js` sha256 `caf2c2444b16…` = installed plugin. Version 0.8.18.

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story |
|---|---|---|---|
| Subtitle with leftovers, auto_on | `shouldShowWaitHero`: auto_on never occupies; mock: count in chrome | No `.atoms-home-wait-card`; no `Captures Waiting`; subtitle names count | US-occupancy-auto-on |
| More `Process (n)` | Process lives in More | Menu lists Process/Preview/Sync; no quiet Process row | US-process-in-more |
| Loop-close card | One question; loop-close first | `Does this close a loop?` with both captures; Keep/Close stacked ≥44px | US-loop-close-first |
| Keep it open | Then Track My car | `Track My car?` Series kicker with Show list unsnoozed; survives `refresh()` | US-keep-track-car |
| Track My car Not now | 14-day snooze | Next question can be Show list | US-not-now |
| Close it | Redeem, body sacred | Notice loop closed; `redeems [[…]]` appended; capture text unchanged | US-close-it |

No spec/copy conflict on those rows. Live primary CTAs are gray text on the card, not the mock’s blue fill — craft note, not a promise fail.

## Product loop vs fixture

| Story | Proof kind |
|---|---|
| US-occupancy-auto-on | ui-chrome-only (leftover count already in vault) |
| US-process-in-more | ui-chrome-only |
| US-loop-close-first | fixture-plumbing |
| US-keep-track-car | fixture-plumbing |
| US-not-now | fixture-plumbing |
| US-close-it | fixture-plumbing |
| US-regression-library | ui-chrome-only |
| US-craft-stack | ui-chrome-only |

No story is unlabeled product-magic dogfood.

## User Stories Tested

As a user with leftover captures and auto on, I want Home to stay a library with one question, so that 22 waiting does not hide Track My car.
Acceptance: no wait card; subtitle `22 thoughts ready to file`; library visible.
Authority: `shouldShowWaitHero` / Apple-cut mock.
Evidence: eval + `docs/qa/screenshots/invite-inherits-hero-wcqa/01-occupancy-loop.png`.
Status: Passed. Kind: ui-chrome-only.

As a user who still wants to file leftovers, I want Process in More, so that it does not occupy the hero.
Acceptance: `Process (22)` / `Preview (22)` / `Sync everything` in ⋯; no `.atoms-home-quiet-process`.
Authority: mock; `shouldOfferProcessInMore`.
Evidence: menu eval + `02-more-menu.png`.
Status: Passed. Kind: ui-chrome-only.

As a user with an open odometer loop and a Show list invite, I want the loop question first.
Acceptance: `Does this close a loop?`; Keep/Close ≥44px stacked; Show list not painted.
Authority: occupancy order loop-close > invite.
Evidence: `01-occupancy-loop.png`; buttons 44×281.
Status: Passed. Kind: fixture-plumbing.

As a user who taps Keep it open, I want Track My car next, even if Show list is collected.
Acceptance: Series kicker `Track My car?`; snooze `{}`; `refresh()` still Track My car.
Authority: `pickHomeHubInvite` told-pair overlap.
Evidence: `03-track-my-car.png`, `04-after-refresh.png` (byte-identical).
Status: Passed on a single tap. Failed under double-tap (Finding F1). Kind: fixture-plumbing.

As a user who taps Not now on Track My car, I want that invite quiet.
Acceptance: Show list can be next; snooze `list:my car`.
Evidence: `05-close-or-not-now.png`.
Status: Passed. Kind: fixture-plumbing.

As a user who taps Close it, I want the loop marked redeemed without rewriting the capture.
Acceptance: Notice `Atoms: loop closed`; one `redeems` line; body verbatim.
Evidence: eval + 73089 file read.
Status: Passed. Kind: fixture-plumbing.

As a user scrolling Home, I still want the library.
Acceptance: Library header + rows; Older captures / shortcut under the list.
Evidence: occupancy frame + eval 100 rows.
Status: Passed.

## Risk Matrix

| Class | Check | Result |
|---|---|---|
| Happy | Occupancy, More Process, loop-close, Keep → Track My car | Pass (single tap) |
| Negative | Not now snooze; told does not override snooze | Pass |
| Edge | `refresh()` after Keep; plugin reload; All/Skipped/All | Pass |
| Regression | Library under question; extras under list | Pass |
| Perception | Subtitle count; no Captures Waiting; no quiet Process | Pass |
| Promise | Keep it open → Track My car | Fail on double-tap (F1) |
| Craft | Hero + Library adjacency; 44px stack | Pass with notes |
| Adversarial | See ledger | P1 + P2 |

## Evidence

- Commands: `./scripts/install-to-vault.sh`; `obsidian vault="test vault" eval` / `command` / `plugin:reload` / `dev:screenshot`
- Tests: `npm test` 2340 pass (prior); occupancy render + `pickHomeHubInvite` + `shouldOfferProcessInMore` units
- Screenshots: `docs/qa/screenshots/invite-inherits-hero-wcqa/`
- Craft: Read `01-occupancy-loop.png` once. Loop card breathes; LIBRARY sits below Keep it open (~25px); stacked actions 44px; Obsidian tab bar clips the first library row; live primary is gray, not mock blue.
- Fixture: throwaway vault, 22 unprocessed, auto_on, planted car pair, existing Show list.

## Findings

### F1 — P1 — Double-tap Keep accepts Track My car

`onDeclineLoopClose` renders the invite in the same click. A second tap at Keep’s slot (y=551, 44×281) hits **Track My car** and runs `onAcceptListInvite`: creates `My car.md`, hard-links both readings, hero becomes Show list.

- `src/home/atomsHomeView.ts` `onDeclineLoopClose` → immediate `render()`
- Proof: live eval `hitBtn="Track My car"` / `Creating…`; `docs/qa/screenshots/invite-inherits-hero-wcqa/adv-a1-after-double-keep.png`
- Fixed: `heroSwapGuard` disables invite CTAs for 500ms without changing the Track My car label. Unit: `Keep it open disables the swapped invite`. Live: second click while disabled, `Creating…` false, no `My car.md`; after 550ms the button is armed.

### F2 — P2 — Keep on a 0×0 Home leaf leaves Close it live on the 390 leaf

Hidden-leaf Keep stamps told and re-renders that view only. Visible Close it still redeems. Ranking after refresh is still Track My car.

- Proof: eval `visClose=true` then 73089 gained redeems
- Dual-leaf trap; click only the visible leaf in QA. Product fix is optional (sync told across leaves).

## Adversarial QA

| Id | Tag | Note |
|---|---|---|
| A1 | holed | Double-tap Keep → accept Track My car (F1) |
| A2 | solid | Keep then Not now; loop-close does not return |
| A3 | solid | Snooze beats told-pair; clear snooze restores Track My car |
| A4 | solid | Close it busy + second click no-op; one redeems line |
| A5 | solid | Already-redeems suppresses loop-close |
| A6 | solid / gap | beginRun hides question; live Process (22) not clicked (Plus localhost down) |
| A7 | solid | More overlay eats taps; after Escape, Not now works |
| A8 | holed | Dual-leaf Keep vs Close (F2) |
| A9 | solid | All → Skipped → All keeps Track My car |
| A10 | solid | Body verbatim + redeems |
| A11 | solid | plugin:reload still Track My car, no wait card |
| A12 | blocked | eval-zero unprocessed does not survive refresh |

Suspected-unproven: real Process (22) from More with Plus down; finger geometry vs synthetic click on More.

## Not Tested

- need_key / plus_limit live occupancy (would wipe the key). Units cover `shouldShowWaitHero` / `shouldOfferProcessInMore`.
- Live Process (22) from More (Plus `127.0.0.1:8799` down).
- Real phone WebView.
- Process dogfood loop (charter: fixture-plumbing).

## Learnings

Consulted. Appended: double-tap Keep lands on Track My car (not Not now). Dual-leaf Keep vs Close.

## Merge Decision

**Ready with residual F2** (Keep on a 0×0 leaf leaves Close it on the 390 leaf — dual-leaf QA trap). Occupancy and F1 hold. Draft until a human marks ready.
