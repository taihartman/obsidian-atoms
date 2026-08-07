# Atoms Capture (Android POC)

Thin companion app: **type → save** appends a stamped line to  
`Atoms System/Inbox.md` in your Obsidian vault via the Storage Access Framework.

- Spec: [`docs/plans/2026-08-07-001-feat-android-companion-capture-poc-plan.md`](../../docs/plans/2026-08-07-001-feat-android-companion-capture-poc-plan.md)
- Issue: [#166](https://github.com/taihartman/obsidian-atoms/issues/166)
- No network, no Plus, no classify — plugin still files.

## Requirements

- JDK 17+
- Android SDK (`ANDROID_HOME` or `local.properties` `sdk.dir`)
- Device or emulator (API 26+)

## Build & test

```bash
cd companion/android
./gradlew test
./gradlew assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.tryatoms.capture/.MainActivity
```

## Dogfood

1. Prefer a **throwaway vault** for agent tests (not personal Remote Vault).
2. Open **Atoms Capture**. The app scans for folders with `.obsidian` (Documents / Downloads / storage).
3. If it finds one: tap **Use {name}** → system picker opens on that folder → **Use this folder** once.
4. If none: **Browse for vault** opens the picker starting in Documents.
5. Type a capture → **Capture**.
6. Confirm `Atoms System/Inbox.md` contains:
   ```text
   - 2026-…T…:…:…±HH:MM your text
   ```
7. Open the same folder as a vault in Obsidian with Atoms installed → drain should file the line into the daily for the stamp’s date.

**Note:** Android 13+ may hide shared folders from automatic scan without broader storage access. In that case the picker still starts in Documents — one confirmation, not a scavenger hunt.

## Checklist (in-app)

| Step | Evidence |
|---|---|
| Link vault | Persistable SAF tree URI stored |
| Save a capture | Successful append once |

## Out of POC

Widgets, share sheet, iOS, Plus capture queue, Play Store release.
