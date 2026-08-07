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

### Hub (once)

1. Prefer a **throwaway vault** for agent tests when possible.
2. Open **Atoms Capture** → **Allow file access** (all files) so vaults are found automatically.
3. Pick **Remote Vault** (or your vault) if more than one appears.
4. Optional hub capture to confirm write.

### One-second path (daily)

1. Long-press home → **Widgets** → **Atoms Capture** → place widget.
2. Tap widget → type → **Capture** (or keyboard Done) → returns home; line in `Atoms System/Inbox.md`.
3. Or long-press app icon → **Capture**.

```bash
# Quick path without widget
adb shell am start -a app.tryatoms.capture.action.QUICK_CAPTURE
```

### Confirm

```text
- 2026-…T…:…:…±HH:MM your text
```

Open Obsidian with Atoms → drain files into the daily for the stamp’s date.

## Checklist (in-app)

| Step | Evidence |
|---|---|
| Link vault | Persistable SAF tree URI stored |
| Save a capture | Successful append once |

## Out of POC

Widgets, share sheet, iOS, Plus capture queue, Play Store release.
