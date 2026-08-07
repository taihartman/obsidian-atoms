# Code review — Android companion capture POC (PR #362)

**Branch:** `feat/166-android-companion-capture`  
**Date:** 2026-08-07  
**Lane:** amend (review → fix ship-blockers)  
**Scope:** `companion/android/**`

## Verdict

**Conditional ship for internal dogfood** after the P0/P1 fixes landed in this pass. Wire format + widget→overlay path are solid. Remaining risk is OEM variance (overlay/mic/ASR) and SAF append provider quirks — acceptable for sideload POC, not Play store yet.

## What was fixed in this pass

| ID | Fix |
|----|-----|
| P0-1 | Mic runtime permission from hub (`MainActivity`) + trampoline (`QuickCaptureActivity`) |
| P0-2 | Process-wide write lock; file-mode atomic temp+rename; SAF prefers `"wa"` append |
| P0-3 | `lifecycleScope` for submit; guard UI after destroy |
| P1-1 | `InAppSpeech.stopNow()` for sync teardown on destroy |
| P1-2 | `ComposeTreeOwner` attach/idempotent destroy; `disposeComposition` before removeView |
| P1-5 | `QuickCaptureActivity` `exported=false` (explicit component only) |
| P1-8 | Notification Stop is an **action**, not content tap (avoids accidental kill) |
| P1-9 | Hub widget refresh uses `lifecycleScope` |
| P2-5 | `allowBackup=false` (no zombie vault prefs after restore) |
| test | `InboxAtomicWriteTest` for atomic write + merge preserve |

## Remaining (not blocking dogfood)

| Sev | Item |
|-----|------|
| P1-3 | Full-width top window may eat status-bar adjacent touches |
| P1-6 | Re-validate all-files grant at write time |
| P2 | Dual widget receivers; unused datastore dep; README drift |
| P2 | Play `MANAGE_EXTERNAL_STORAGE` / specialUse FGS justification later |
| Test | No instrumented overlay/FGS tests; widget intent component assertion |

## What's solid

- `CaptureLine` matches plugin `inbox.ts` (stamp + tab multiline + path) with unit tests  
- Widget → `QuickCaptureActivity` only (never hub)  
- Overlay FGS + `FLAG_NOT_TOUCH_MODAL` (IME works; outside pass-through)  
- SAF `.obsidian` discovery scar tissue  
- Body sacred — no rewrite beyond whitespace rule  

## Dogfood checklist (human / adb)

1. Open hub once → grant **mic** (+ notifications on 13+)  
2. Link vault (all-files or SAF)  
3. Pin **Atoms Capture** widget (v2 label)  
4. Tap widget → strip on home → type → Save → check `Atoms System/Inbox.md`  
5. Mic on strip → partials appear → Save  
6. Notification **Stop** dismisses strip without wiping prior inbox lines  
7. Use phone under strip (home icons still tappable outside card)  

## Next CE steps

- [ ] Commit review fixes + push PR #362  
- [ ] Device smoke screenshots under `docs/qa/screenshots/android-capture-poc/`  
- [ ] `ce-simplify-code` on companion Kotlin if still noisy  
- [ ] `ce-compound` learnings (overlay ComposeView lifecycle, inbox atomic write)  
- [ ] Mark PR ready when dogfood green  
