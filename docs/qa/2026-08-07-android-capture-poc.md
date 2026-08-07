# QA — Android Capture POC (#166)

**Date:** 2026-08-07  
**Branch:** `feat/166-android-companion-capture`  
**APK:** `companion/android/app/build/outputs/apk/debug/app-debug.apk`  
**Device:** physical (`adb devices` → `00101346H004875`)

## Automated

| Check | Result |
|---|---|
| `./gradlew test` (CaptureLine stamp + merge) | **PASS** (debug + release unit) |
| `./gradlew assembleDebug` | **PASS** |
| Plugin STAMP_RE accepts app golden line | **PASS** (node check: colon offset + seconds) |
| Colon-less `-0400` rejected by plugin regex | **PASS** |

## Device smoke

| Check | Result |
|---|---|
| `adb install -r` debug APK | **PASS** |
| Launch `app.tryatoms.capture/.MainActivity` | **PASS** |
| Screenshot launch UI | [`docs/qa/screenshots/android-capture-poc/01-launch.png`](screenshots/android-capture-poc/01-launch.png) |

### Screenshot notes (01-launch)

- Title **Atoms Capture** / subtitle **Quick capture for your vault**
- Checklist **Get Atoms going** with both steps incomplete (expected first run)
- Text field placeholder **What's on your mind?**
- **Capture** button present (disabled until text — Compose enabled rule)
- **Link vault folder** CTA
- Sync lag honesty copy visible

## Not automated this pass (human follow-up)

| Check | Why |
|---|---|
| SAF pick vault → append `Inbox.md` | Requires folder-picker UI interaction on device |
| Obsidian force-stop → capture → drain to daily | Needs vault with Atoms plugin + human Sync path |
| Multiline continuation lines on disk | Same as SAF path |

**Suggested human dogfood (throwaway vault only):**  
`companion/android/README.md` § Dogfood.

## Verdict

**POC build is installable and UI-complete for the claimed surface.** Wire-format unit tests lock the inbox contract. End-to-end SAF write on device remains the one human (or UI-automator) step before calling #166 fully done.
