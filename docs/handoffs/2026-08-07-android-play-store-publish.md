---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-07T21:00:00Z"
title: "Publish Atoms Capture Android to Google Play"
summary: "Chrome-control handoff: Play Console listing + first AAB for app.tryatoms.capture after PR #362 merge. Policy blockers called out."
keywords: ["android", "play-store", "publish", "companion", "chrome", "atoms-capture"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-166-android-companion-capture"
resume_focus: "Drive Google Play Console in browser to create listing and ship first internal/closed testing release of Atoms Capture Android; fix policy blockers (all-files access) if Console rejects"
repository: "taihartman/obsidian-atoms"
branch: "chore/android-play-store-handoff"
head: "master-based"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-166-android-companion-capture"
---

# Handoff: Publish Atoms Capture to Google Play (Chrome control)

## Who this is for

A **Claude Chrome / browser-control** session that can open Play Console, fill forms, upload builds, and click through policy questionnaires. Not a pure code session — though code fixes may be required if policy blocks.

## Goal

Get **Atoms Capture** (`app.tryatoms.capture`) onto Google Play, starting with **internal testing** (or closed testing), then promote when green.

## App identity (source of truth)

| Field | Value |
|-------|--------|
| App name | Atoms Capture |
| applicationId / package | `app.tryatoms.capture` |
| Namespace | `app.tryatoms.capture` |
| Current versionName | `0.2.1` |
| Current versionCode | `3` |
| minSdk / targetSdk | 26 / 36 |
| Play listing | https://play.google.com/store/apps/details?id=app.tryatoms.capture (live) |
| Repo path | `companion/android/` on **master** (merged PR #362) |
| Issues closed | #166, #369 |
| Website | https://tryatoms.com |
| Privacy | https://tryatoms.com/privacy (confirm live) |
| Support | Prefer tryatoms / GitHub issues — confirm with human if Console needs email |

## Product one-liner (store copy seed)

**Short:** Capture thoughts into your Obsidian vault in one second. Atoms files them later.

**Full (draft):** Atoms Capture is a thin companion for the Atoms Obsidian plugin. Type or speak a thought; it lands as a stamped line in `Atoms System/Inbox.md`. Home widget, shade tile, and floating strip keep capture fast. The plugin still files into your daily notes — this app does not classify or replace Obsidian.

**Category:** Productivity

## What already works (device dogfood)

- Hub: vault discover (all-files) + SAF fallback
- Overlay capture strip (FGS specialUse + microphone while dictating)
- Home widget, QS tile, live voice partials
- Wire format matches plugin inbox drain
- Brand ↵ icon

Code: `companion/android/`  
Learning: `docs/solutions/logic-errors/android-overlay-fgs-must-declare-microphone-for-speech.md`  
QA screenshots: `docs/qa/screenshots/android-capture-poc/`

## Hard Play policy blockers (read first)

### 1. `MANAGE_EXTERNAL_STORAGE` (All files access) — HIGH RISK

Manifest declares all-files access for vault auto-discover. **Play rejects most apps** that request this unless they are a file manager / backup / antivirus class.

**World-class path for store:**

1. **Play build flavor:** SAF-only (no `MANAGE_EXTERNAL_STORAGE`); vault pick via folder picker only.
2. Keep all-files as **sideload / debug** flavor if desired.
3. In Data safety + Permissions declaration: only claim what the **store AAB** uses.

Do **not** submit an AAB that still needs all-files without a strong core-functionality justification and approved declaration form — expect rejection.

### 2. `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`

Required form in Play Console: explain floating capture strip over other apps. Subtype string already in manifest:  
`Floating capture strip over the home screen`.

Also declare **microphone** FGS type (used while dictating).

### 3. `SYSTEM_ALERT_WINDOW` (Display over other apps)

Core to overlay strip. Justify as “quick capture without leaving current app.” User grants in system settings — document in listing.

### 4. `RECORD_AUDIO`

In-app speech. Declare mic in Data safety; runtime request already in app.

### 5. Signing & release build

POC only has **debug** assemble. Store needs:

- Release keystore (human owns secrets — **never commit keystore or passwords**)
- Prefer **AAB**: `./gradlew bundleRelease`
- R8/minify optional but recommended before production track

## Chrome session — Play Console checklist

Assume human is logged into the correct Google Play Console account (or will complete login).

### A. Create app (if missing)

1. https://play.google.com/console → **Create app**
2. Name: **Atoms Capture**
3. Default language: English (US)
4. App (not game) · Free
5. Declarations: privacy policy, export laws, etc. as prompted

### B. Dashboard setup (order Console suggests)

1. **App access** — all features available without login (no account).
2. **Ads** — No ads.
3. **Content rating** — questionnaire (utility/productivity; no user-generated social).
4. **Target audience** — 18+ or 13+ as appropriate (notes app; no kids).
5. **News app** — No.
6. **Data safety** — see section below.
7. **Government apps** — No.
8. **Financial features** — No.

### C. Store listing

| Asset | Spec | Source / action |
|-------|------|-----------------|
| App name | Atoms Capture | |
| Short description | ≤80 chars | Seed above |
| Full description | ≤4000 | Seed above + permissions honesty |
| App icon | 512×512 PNG | Export ↵ on black from brand; not adaptive XML |
| Feature graphic | 1024×500 | Simple black + ↵ + “Capture” |
| Phone screenshots | min 2 | Use/crop `docs/qa/screenshots/android-capture-poc/` + fresh hub/widget/shade shots |
| Privacy policy URL | required | https://tryatoms.com/privacy |
| Category | Productivity | |
| Contact email | required | Human provides if not in Console |

Listing must say:

- Requires **Obsidian + Atoms plugin** to file captures (companion utility).
- Optional: Display over other apps, mic, notifications.
- Vault access via **folder picker** (Play build) / document all-files only if still present.

### D. Data safety form (draft answers)

| Data type | Collected? | Shared? | Notes |
|-----------|------------|---------|--------|
| Personal info | No | No | |
| Financial | No | No | |
| Location | No | No | |
| Photos/files | **Yes — files** | No | User-selected vault files; on-device only |
| Audio | **Yes — ephemeral** | No | Mic for speech → text on device / OS recognizer; not uploaded by us |
| App activity | No analytics SDK in POC | No | Confirm no Firebase/Crashlytics added |
| Device IDs | No | No | |

**Encryption in transit:** N/A if no app backend. Speech may use Google recognizer — disclose OS speech if network path possible.  
**Deletion:** Uninstall; vault files remain user’s.  
**Account:** No account created by app.

### E. Build upload

1. On machine with SDK (not only Chrome):

```bash
cd companion/android
# After Play flavor exists (SAF-only) and signing configured:
./gradlew bundleRelease
# out: app/build/outputs/bundle/release/app-release.aab
```

2. Console → **Testing → Internal testing** → Create release → Upload AAB.
3. Release notes: “First Play build — hub, widget, shade tile, overlay capture, live voice.”
4. Add license testers (human Google accounts).
5. **Start rollout** to internal track.

### F. Permissions declaration forms

In Console **App content** / sensitive permissions:

- All files access — **prefer remove for Play AAB**; if kept, fill core functionality form (likely fail).
- Special-use FGS — paste justification.
- Foreground service mic — “speech-to-text while capture strip is open.”

### G. After internal green

- Closed testing → open testing → production when human OK.
- This is **not** the Obsidian plugin; separate from plugin BRAT release.

## Code work likely before first successful review

Track as small PR(s) if Chrome session discovers hard blocks:

1. **`play` product flavor** without `MANAGE_EXTERNAL_STORAGE`; SAF-only discover/link.
2. `versionName` / `versionCode` bump; drop `-poc` suffix for store.
3. Release signing config via `keystore.properties` (gitignored).
4. Privacy policy line in listing matches real behavior (speech network).
5. Optional: disable legacy widget receiver for cleaner store UX.
6. R8 on for release if size/review prefers.

Do **not** commit secrets. Human creates Play Console app + signing key if missing.

## Local paths (this machine)

| Path | Use |
|------|-----|
| Worktree | `/Users/a515138832/StudioProjects/obsidian_plugin-166-android-companion-capture` |
| Or pull master | main `obsidian_plugin` after `git pull` |
| Debug APK recipe | `companion/android/README.md` |
| Screenshots | `docs/qa/screenshots/android-capture-poc/` |

## Out of scope

- iOS App Store (#379 / PR #380)
- Plus capture relay
- Obsidian plugin BRAT release

## Success criteria

- [ ] Play Console app **Atoms Capture** exists
- [ ] Store listing complete enough for internal test
- [ ] Data safety + content rating completed
- [ ] AAB on **internal testing** installable by tester
- [ ] Policy declarations submitted without all-files rejection (SAF-only AAB preferred)
- [ ] Human can install from Play internal link and capture to Inbox.md

## Resume

```text
/ce-handoff resume docs/handoffs/2026-08-07-android-play-store-publish.md
```

Then: open https://play.google.com/console in Chrome, create/configure app, and only touch repo code if policy requires a SAF-only flavor or signing setup.
