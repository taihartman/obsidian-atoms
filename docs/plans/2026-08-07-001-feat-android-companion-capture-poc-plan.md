# feat: Android companion capture POC

**Date:** 2026-08-07  
**Lane:** full feature (POC-scoped)  
**Issue:** #166 (Android capture against inbox contract)  
**Research:** `docs/research/2026-08-07-companion-capture-app.md`  
**Status:** implementation-ready for **POC only**

---

## Goal capsule

**Objective.** Ship a thin Android app that is Atoms’ own quick-capture action: type → save lands a correctly stamped line in `Atoms System/Inbox.md` with Obsidian closed, plus a live setup checklist so Obsidian noobs know what happened.

**Stop when.**

1. App installs on a physical Android device (or emulator).
2. User picks vault folder once (SAF); permission survives restart.
3. Capture appends wire-correct lines; plugin drain would accept them (golden stamp tests).
4. Setup checklist updates from evidence (vault linked, first capture saved).
5. Documented dogfood steps; no Plus/server required.

**Out of POC.** iOS app, Plus capture queue, widgets, share sheet, classify, library, voice-to-cloud, App Store listing polish, Play Store release pipeline (local sideload OK).

---

## Product contract

### One sentence

> **Get a thought into Atoms without learning Shortcuts or opening Obsidian first.**

### Jobs (POC)

| Job | POC bar |
|---|---|
| Own quick capture | One screen: field + Capture; toast/status on success |
| Vault write without Obsidian open | SAF tree URI → append `Atoms System/Inbox.md` |
| Wire contract | Same as iOS Shortcut / `src/pipeline/inbox.ts` |
| Setup clarity | Checklist: link vault → first capture (evidence-based) |
| Never lossy on device | Local success = bytes on disk under vault; Sync lag disclosed |

### Non-goals (constitution)

- No classify, titles, atoms, markers, or drain logic in the app
- No rewrite of capture body
- No second brain UI
- Do not open/manage inbox as a user document surface beyond “saved”

### Wire contract (load-bearing)

```text
- 2026-08-07T14:30:45-04:00 capture text here
```

| Rule | Detail |
|---|---|
| Path | `Atoms System/Inbox.md` (create folder + note if missing) |
| Stamp | ISO-8601 local datetime + **colon offset** + **seconds** |
| Multiline | `\n` → `\n\t` in body before write |
| Append | EOF; ensure file ends with `\n` before append; never truncate |
| New inbox | Use same spirit as `INBOX_NOTE_TEMPLATE` (header + empty body area) |
| Markers | App never writes `<!--atoms:filed-->` |

### Setup checklist (POC)

| Step id | Label | Green when |
|---|---|---|
| `vault` | Link your Obsidian vault | Durable SAF tree URI stored |
| `capture` | Save a capture | ≥1 successful append this install |

Optional copy under checklist (static): “Open Obsidian later — Atoms files captures into your daily notes.”

Do **not** fake plugin-install detection in POC.

---

## Technical decisions

| KTD | Decision |
|---|---|
| KTD1 | **Native Kotlin + Jetpack Compose** single-module app under `companion/android/` |
| KTD2 | **SAF** (`OpenDocumentTree` + `takePersistableUriPermission`) — not raw paths |
| KTD3 | **Stamp + line builder** in pure Kotlin with JVM unit tests; golden vectors aligned with plugin stamp rules |
| KTD4 | **No network** in POC |
| KTD5 | Application id `app.tryatoms.capture` (or `app.tryatoms.capture.android`); label **Atoms Capture** |
| KTD6 | Min SDK 26; target SDK 35 |
| KTD7 | Repo path: `companion/android/` — separate from plugin build; root README pointer only if needed |

### Module layout

```text
companion/android/
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  app/
    build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/java/app/tryatoms/capture/
      MainActivity.kt
      CaptureApp.kt
      ui/CaptureScreen.kt
      data/VaultStore.kt          # DataStore preferences for tree URI
      data/InboxWriter.kt         # SAF append
      domain/CaptureLine.kt       # stamp + format (pure)
    src/test/java/.../CaptureLineTest.kt
```

### InboxWriter algorithm

1. Resolve tree URI → `DocumentFile.fromTreeUri`
2. Find or create directory `Atoms System`
3. Find or create file `Inbox.md` (MIME `text/markdown` or `text/plain`)
4. Read existing bytes (or empty); if non-empty and not ending in `\n`, append `\n`
5. Append one or more lines from `formatCaptureLine(text, now)`
6. Write via `ContentResolver.openOutputStream(uri, "wt")` **only if** we re-write full content, OR use append mode if available — **prefer read-modify-write of full file** under a short critical section because SAF append support is uneven. POC: read full → concatenate → write truncate. Document race: two devices offline still OK at Sync merge; two writers on same device rare for POC.
7. On success update checklist + last status timestamp/snippet

### First-run inbox create body

If creating `Inbox.md`, write `INBOX_NOTE_TEMPLATE`-equivalent (Android companion mentioned instead of shortcut), then blank line, then first capture.

---

## Acceptance examples

| # | Example |
|---|---|
| AE1 | Fresh install → checklist shows vault incomplete → pick vault → vault green |
| AE2 | Capture “hello from android” → file contains `- <iso> hello from android\n` |
| AE3 | Obsidian force-stop → capture still succeeds → open Obsidian → drain files to daily (human or dogfood vault) |
| AE4 | Multiline capture → continuation lines tab-indented under bullet |
| AE5 | Unit tests: offset has colon; seconds present; golden strings |

---

## Test plan

| Layer | What |
|---|---|
| Unit | `CaptureLine` format (offset, seconds, multiline, empty reject) |
| Device | Install debug APK; SAF to a throwaway folder mimicking vault; inspect `Inbox.md` |
| Plugin contract | Optional: copy `Inbox.md` into test vault and run drain — human/agent if Obsidian available |
| QA | world-class-qa scoped to capture+checklist; screenshots under `docs/qa/screenshots/android-capture-poc/` |

---

## Risks

| Risk | Mitigation |
|---|---|
| SAF read-modify-write loses concurrent append | POC single-writer; document; later file-lock or append API |
| User picks wrong folder | Copy: “Pick the folder that contains your notes (the vault root)” |
| OEM storage quirks | Test on connected device; fail with plain error |
| Scope creep to iOS/Plus | Out of POC list is binding |

---

## Done / shipping tail (POC)

- [ ] Code in `companion/android/`
- [ ] `./gradlew test` green
- [ ] Debug APK builds
- [ ] Device smoke + screenshot of checklist + Inbox.md content
- [ ] STATUS + draft PR
- [ ] Short `companion/android/README.md` dogfood steps

Play Store release is **not** required for POC merge/draft.

---

## Open follow-ups (not this PR)

- iOS companion
- Plus capture outbox
- Widget + share target
- Voice capture UI
- Detect “open Obsidian once” / plugin present
- Shared golden JSON consumed by plugin + Android tests
