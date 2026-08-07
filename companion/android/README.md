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
2. Open **Atoms Capture** → **Find my vaults**.
3. In the system picker, choose **Documents** (or the parent folder that contains your vaults) → **Use this folder**.
4. The app lists every folder with a `.obsidian` directory. Tap the vault you want.
   - One vault → auto-selected.
   - None → **Use this folder as vault** if you pointed at the vault itself.
5. Type a capture → **Capture**.
6. Confirm `Atoms System/Inbox.md` contains:
   ```text
   - 2026-…T…:…:…±HH:MM your text
   ```
7. Open Obsidian with Atoms → drain files into the daily for the stamp’s date.

**Why one folder grant?** Android won’t let apps silently list all storage. Granting Documents once lets us list *all* vaults under it and switch in-app with no more pickers.

## Checklist (in-app)

| Step | Evidence |
|---|---|
| Link vault | Persistable SAF tree URI stored |
| Save a capture | Successful append once |

## Out of POC

Widgets, share sheet, iOS, Plus capture queue, Play Store release.
