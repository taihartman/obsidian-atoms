# Atoms Capture (Android)

Thin companion app: **type → save** appends a stamped line to  
`Atoms System/Inbox.md` in your Obsidian vault via the Storage Access Framework.

- Spec: [`docs/plans/2026-08-07-001-feat-android-companion-capture-poc-plan.md`](../../docs/plans/2026-08-07-001-feat-android-companion-capture-poc-plan.md)
- Issue: [#166](https://github.com/taihartman/obsidian-atoms/issues/166)
- Play listing: [#382](https://github.com/taihartman/obsidian-atoms/issues/382)
- No network, no Plus, no classify — plugin still files.

## Requirements

- JDK 17+
- Android SDK (`ANDROID_HOME` or `local.properties` `sdk.dir`)
- Device or emulator (API 26+)

One build. Play will not grant all-files access to a capture app, so there is
no silent whole-phone scan. Pick the vault folder, or pick **Documents** and
the app lists every vault inside that grant.

`verify<Variant>Manifest` reads the **merged** manifest and fails the build if
broad storage or `INTERNET` comes back, from our manifest or a library's.

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

## Release build

The upload keystore lives on the owner's machine and never in git. Copy
`keystore.properties.example` to `keystore.properties`, point it at the keystore,
then:

```bash
./gradlew bundleRelease
```

Without `keystore.properties` the bundle task fails rather than quietly producing
an unsigned AAB. Output: `app/build/outputs/bundle/release/app-release.aab`.

## Dogfood

### Hub (once)

1. Prefer a **throwaway vault** for agent tests when possible.
2. Open **Atoms Capture** → **Folder picker**.
3. Pick the vault folder, or pick **Documents** if that is where the vaults live.
4. If more than one vault appears, pick yours.
5. Optional hub capture to confirm write.

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

## Not built yet

Share sheet, iOS, Plus capture queue.

Store listing assets and copy live in [`store/`](store/). Play publishing is tracked in
[#382](https://github.com/taihartman/obsidian-atoms/issues/382).
