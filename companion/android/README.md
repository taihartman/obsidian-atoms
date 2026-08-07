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

1. On the phone, create or pick a **throwaway vault folder** (not personal Remote Vault for agent tests).
2. Open **Atoms Capture** → **Link vault folder** → select that folder.
3. Type a capture → **Capture**.
4. Confirm `Atoms System/Inbox.md` contains:
   ```text
   - 2026-…T…:…:…±HH:MM your text
   ```
5. Open the same folder as a vault in Obsidian with Atoms installed → drain should file the line into the daily for the stamp’s date.

## Checklist (in-app)

| Step | Evidence |
|---|---|
| Link vault | Persistable SAF tree URI stored |
| Save a capture | Successful append once |

## Out of POC

Widgets, share sheet, iOS, Plus capture queue, Play Store release.
