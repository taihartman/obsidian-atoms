# Atoms Capture (Android)

Thin companion: type or speak a thought; it lands as a stamped line in
`Atoms System/Inbox.md`. The Obsidian plugin files it later.

**On Play:** [Atoms Capture](https://play.google.com/store/apps/details?id=app.tryatoms.capture)
(`app.tryatoms.capture`).

- Overlay strip, home widget, shade tile
- No network, no Plus, no classify
- minSdk 26 · targetSdk 36
- One SAF-only build: pick the vault folder, or Documents

## From the plugin

On Android Obsidian: **Settings → Atoms → 1 · Capture → Atoms Capture → Get Atoms Capture**.

On desktop: the same row sits under Capture, next to the iPhone shortcut.

## Localization

User-facing copy lives in `app/src/main/res/values/strings.xml`. Never a
literal in Kotlin or layout XML. See [`docs/localization.md`](../../docs/localization.md).

## Build & test

```bash
cd companion/android
./gradlew test
./gradlew assembleDebug
```

Needs JDK 17+ and an Android SDK (API 26+).

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.tryatoms.capture/.MainActivity
```

## Release

The upload keystore lives on the owner's machine and never in git. Copy
`keystore.properties.example` to `keystore.properties`, point it at the keystore,
then:

```bash
bundle install
bundle exec fastlane android beta   # GitHub prerelease + Play Internal if PLAY_STORE_JSON_KEY is set
bundle exec fastlane android prod   # GitHub Release (not Latest) + Play production draft
bundle exec fastlane android build  # signed AAB only
```

Without `keystore.properties` the bundle task fails rather than quietly producing
an unsigned AAB. Runbook: [`docs/runbooks/companion-release-beta-stable.md`](../../docs/runbooks/companion-release-beta-stable.md).

## Dogfood

1. Prefer a throwaway vault for agent tests.
2. Open Atoms Capture → **Folder picker**. Pick the vault, or **Documents**.
3. Long-press home → **Widgets** → **Atoms Capture**, or the shade tile, or the overlay.
4. Confirm a stamped line in `Atoms System/Inbox.md`.
5. Open Obsidian with Atoms so the inbox drains into the daily for that stamp.

```bash
adb shell am start -a app.tryatoms.capture.action.QUICK_CAPTURE
```
