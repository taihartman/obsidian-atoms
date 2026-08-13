# Scoped QA — #490 first-day Daily Notes wall

**Date:** 2026-08-13  
**Vault:** `test vault` (Atoms folder temporarily renamed so first-day could render; restored)  
**Build:** 0.7.11

## Stories

| Story | Result | Evidence |
|---|---|---|
| Daily Notes off names the switch | Pass | DOM: subtitle `Daily Notes is off`, title `Turn on Daily Notes`, one button `Open Core plugins` |
| Primary button opens Core plugins | Pass | Click → `activeTab` `{id:"plugins", name:"Core plugins"}` |
| Guessed id `core-plugins` is wrong | Pass | Live tab list; `openTabById("core-plugins")` left `activeTab` empty |
| `/setup` names the switch after Restricted Mode | Pass | `www/dist/setup.html` + `test/wwwPricing.test.ts` |
| Daily Notes on copy unchanged | Pass | `firstDaySetupCopy(true)` byte-matches shipped strings |

## Screenshot

`docs/qa/screenshots/daily-notes-first-day/01-daily-notes-off-card.png` — first-day card after scrolling past the catch-up banner. Paired capture; kept the frame that shows the card.

## Restore

`Atoms.bak-490` → `Atoms` (436 files). Daily Notes re-enabled.

## Not run

- Phone viewport. Desktop sidebar was enough to read the card.
- A vault that is naturally empty (this pass forced first-day by hiding `Atoms/` and disabling Daily Notes).
