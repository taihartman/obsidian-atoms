# Scoped QA — #490 first-day Daily Notes wall

**Date:** 2026-08-13 (second live drive)  
**Verdict:** Pass for the claimed wall. Not merge-ready until the branch is pushed.  
**Vault:** `test vault` · **Build:** 0.7.11  
**Proof kind:** ui-chrome-only. First-day forced by hiding `Atoms/` and disabling Daily Notes. Restored.

## Preflight

Product dogfood honesty ✅ · Learnings ✅ ➕ (Daily Notes `enable()` throw) · Nav map ✅ (Settings two-eval)

## Stories

| Story | Result | Evidence |
|---|---|---|
| Daily Notes off names the switch | Pass | subtitle `Daily Notes is off`, title `Turn on Daily Notes`, body names Settings → Core plugins, one button `Open Core plugins`, no example, no “Write one bullet” |
| Primary button opens Core plugins | Pass | Click → `activeTab` `{id:"plugins", name:"Core plugins"}` |
| Opposite state: DN on, Atoms hidden | Pass | DN-off copy gone. Subtitle `33 thoughts ready to file`. Wait/filing card, not the setup card |
| Restore: library home | Pass | 436 atoms back. Filters All/Skipped present. 100 library rows. No “Turn on Daily Notes” |
| `/setup` names the switch | Pass | `www/dist/setup.html` |
| DN-on first-day copy | Pass (unit only) | `firstDaySetupCopy(true)` byte-match. This vault has unmarked dailies, so live first-day+DN-on cannot appear |

## Restore

`Atoms.bak-490` → `Atoms` (436). Daily Notes enabled.

## Not tested

Phone viewport. A naturally empty vault. `Open today` Notice text (button clicked while DN off; Notice not scraped).

## Craft

Desktop sidebar. Button contrast is the existing quiet style, not a new defect. Catch-up banner sits above the setup card on this vault; a brand-new vault will not have that banner.
