# Runbook: Atoms Capture — beta vs prod

Owner-facing. Fastlane lives next to each app. Plugin releases stay on [`plugin-release-beta-stable.md`](plugin-release-beta-stable.md).

## Commands

From `companion/android` (`bundle install` once):

| Command | GitHub tag | Prerelease | Store |
|---|---|---|---|
| `bundle exec fastlane android beta` | `capture-android-X.Y.Z-beta.N` | yes | Play Internal, if `PLAY_STORE_JSON_KEY` is set |
| `bundle exec fastlane android prod` | `capture-android-X.Y.Z` | no | Play production **draft**, if the key is set |
| `bundle exec fastlane android build` | none | — | none |

From `companion/ios`:

| Command | GitHub tag | Prerelease | Store |
|---|---|---|---|
| `bundle exec fastlane ios beta` | `capture-ios-X.Y.Z-beta.N` | yes | TestFlight, if ASC env is set |
| `bundle exec fastlane ios prod` | `capture-ios-X.Y.Z` | no | App Store, no submit, if ASC env is set |
| `bundle exec fastlane ios build` | none | — | none |

Companion stables always pass `--latest=false`. They must not become GitHub Latest (that button is the plugin).

Never `git tag 0.3.0` for a companion build. The plugin workflow matches unprefixed `X.Y.Z`.

## Fail modes

| Missing | Lane result |
|---|---|
| `companion/android/keystore.properties` | **Fails** before an AAB exists |
| `PLAY_STORE_JSON_KEY` unset | GitHub Release still created; Play skipped; prints `PLAY_STORE_JSON_KEY` |
| `PLAY_STORE_JSON_KEY` set but unreadable | **Fails** after the Release |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_PATH` unset | GitHub Release still created; store skipped; prints those three names |
| `ASC_KEY_PATH` set but unreadable | **Fails** after the Release |

Version file edits stay in the working tree. Commit them on the claim branch after a successful lane.

## Secrets (never in git)

Put files under `~/keystores/`, not inside the repo.

```bash
export PLAY_STORE_JSON_KEY="$HOME/keystores/play-atoms-capture.json"
export ASC_KEY_ID="..."
export ASC_ISSUER_ID="..."
export ASC_KEY_PATH="$HOME/keystores/AuthKey_XXXX.p8"
```

`keystore.properties` is already gitignored. Copy `keystore.properties.example` and fill it. Blank passwords fail the Gradle release task.

Do not attach keystore, Play JSON, or `.p8` to a GitHub Release. Do not paste `fastlane/report.xml` into issues.

CI must not reuse these upload lanes until a separate plan defines secret storage.

## First tracking Release from an existing AAB

If a signed `app-release.aab` already exists and you only want history:

```bash
gh release create capture-android-0.3.0 path/to/app-release.aab \
  --repo taihartman/obsidian-atoms \
  --title "Atoms Capture Android 0.3.0" \
  --notes "Atoms Capture Android 0.3.0 (versionCode 3)" \
  --latest=false
```
