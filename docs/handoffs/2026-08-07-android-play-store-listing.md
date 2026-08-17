---
handoff_date: 2026-08-07
branch: claude/atoms-capture-play-store-24f197
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c
base: master
tracking: none — no GitHub Issue exists for Play publishing yet (see Next steps 3)
status: in-progress
---

# Handoff — Publish Atoms Capture to Google Play

You are picking up this work in a fresh session. Read this file top to bottom, run the
**How to resume** commands to land on the right branch and worktree, then **start executing
Next steps immediately** — step 1 is your current task. Do not ask the user what to work on
and do not summarize this doc back to them; just begin, and report what you did.

## Goal

Get the Android companion **Atoms Capture** (`app.tryatoms.capture`) onto Google Play, starting
at internal testing. The app itself is already merged to master (PR #362, commit `24237f9`,
closes #166 #369). This work is the *store* half: Play Console listing, policy declarations, and
the code changes Play requires before an AAB can be uploaded.

This is **not** the Obsidian plugin's BRAT release. Separate artifact, separate lane.

## Current status

### Play Console — real, verified state

The developer account exists and is healthy. It is **not** the Google account Chrome defaults to.

| | |
|---|---|
| Account | Tai Hartman, **Personal**, ID `7765710383538347405`, under **`/u/2/`** (not `/u/0/`) |
| Policy status | "No issues found with your developer account" |
| Other apps | Aploma (`com.taitopia.aploma`, Production, 5.0★) · Human Nature (`com.taitopia.human_nature.beta`, Draft/Internal testing) |
| **Atoms Capture** | **Created.** App ID `4973703899952460961` |

Console URL base:
`https://play.google.com/console/u/2/developers/7765710383538347405/app/4973703899952460961/`

**Saved already** (all confirmed "Change saved"; nothing has been sent for review):

- App created: name `Atoms Capture`, package `app.tryatoms.capture`, App (not game), **Free**
- Main store listing **draft**: app name, short description (63/80), full description (1596/4000)
- Store settings → App category: **Productivity**
- Store settings → Contact details: `taihartmandevelopment@gmail.com`, website `https://tryatoms.app`, phone blank

### Assets — generated and committed

Everything the listing needs is in `companion/android/store/` (see its `README.md`). They are
**not yet uploaded** — the Chrome upload tool could not pass file paths through, so uploading is
a manual step for the user.

### Verified facts about the app (do not re-derive)

- **The app has no `INTERNET` permission.** No analytics, no Firebase, no HTTP client, no network
  code anywhere in `companion/android/app/src/main/java`. It physically cannot exfiltrate captures.
  This is the strongest privacy claim available and the listing already makes it.
- **Dictation is the exception.** `speech/InAppSpeech.kt:110` uses `SpeechRecognizer.createSpeechRecognizer()`
  — *not* `createOnDeviceSpeechRecognizer()`, and no `EXTRA_PREFER_OFFLINE`. Audio goes to Android's
  system recogniser, which may send it to Google. The listing discloses this honestly. **Data safety
  must say the same thing.**
- The full capture loop works end to end on an emulator: typed → saved → landed in
  `Atoms System/Inbox.md` as a stamped line.

## Next steps

1. **Ask the user to upload the listing assets**, then Save the main store listing. You cannot do
   this yourself — the Chrome `file_upload` tool rejects the `paths` array through this harness.
   Files are at `companion/android/store/` (icon, feature graphic) and
   `companion/android/store/screenshots/` (upload 01–04; 05 is weak, mostly empty black).
   Save is currently blocked *only* by missing icon + feature graphic. If Play rejects the
   screenshots on aspect ratio (they are 2.226:1, Play caps at 2:1), pad each to 1496×2992 on its
   own background colour — do not crop.

2. **Fill the App content forms that do not depend on the AAB.** Under
   `.../app/4973703899952460961/app-content`: App access (all features available, no login) ·
   Ads (no ads) · Content rating questionnaire (utility/productivity, no UGC, no social) ·
   Target audience (18+ / 13+, notes app, not for kids) · News app (no) · Government apps (no) ·
   Financial features (no). Privacy policy URL is `https://tryatoms.app/privacy`.
   **Hold Data safety and the sensitive-permission declarations** — they describe the shipped
   build, and the build is about to change (step 4).

3. **Make the hard claim before touching repo code.** This repo requires it (`docs/collab.md`):
   assigned GitHub Issue + a `STATUS.md` row + a draft PR, *then* implement. No Issue exists for
   Play publishing yet — #379 is the separate iOS companion. Create one.

4. **Add a SAF-only `play` product flavor.** This is the single biggest rejection risk.
   `companion/android/app/src/main/AndroidManifest.xml:5` declares `MANAGE_EXTERNAL_STORAGE`
   (plus `android:requestLegacyExternalStorage="true"` on `<application>`). Play rejects all-files
   access for anything that is not a file manager / backup / antivirus. Ship a `play` flavor with
   no `MANAGE_EXTERNAL_STORAGE` (SAF folder-picker only) and keep all-files as a sideload flavor.
   There are currently **no `productFlavors` at all** in `app/build.gradle.kts`.

5. **Wire release signing.** There is **no `signingConfig` anywhere** in the Gradle files, so
   `./gradlew bundleRelease` would produce an unsigned AAB. Scaffold it against a gitignored
   `keystore.properties`. **The user generates and holds the keystore — never commit a keystore
   or passwords.**

6. **Bump the version off `-poc`.** `app/build.gradle.kts:14-15` is `versionCode = 2`,
   `versionName = "0.2.0-poc"`. Store builds should not carry `-poc`.

7. **Add a companion-app section to the privacy policy.** `https://tryatoms.app/privacy` (source in
   `www/`) is written entirely for the Obsidian plugin — vault reads, Anthropic classification, Ask
   mirror, Plus billing, Field notes. It says **nothing** about the Android app: no microphone, no
   speech recognition, no vault file access, no "this app has no backend". Play requires the policy
   to cover the listed app, and Data safety will assert audio collection the policy never discloses.

8. Build the AAB, upload to **Internal testing**, add license testers, start rollout.

## Key files

- `companion/android/store/README.md` — what every asset is, and why the mark is drawn not typed
- `companion/android/app/src/main/AndroidManifest.xml:5` — the `MANAGE_EXTERNAL_STORAGE` line to remove in the `play` flavor
- `companion/android/app/build.gradle.kts:11-26` — applicationId, version, `buildTypes`; no flavors, no signing
- `companion/android/app/src/main/java/app/tryatoms/capture/speech/InAppSpeech.kt:110` — the recogniser choice that Data safety must match
- `docs/handoffs/2026-08-07-android-play-store-publish.md` — the earlier handoff that started this. **Two of its facts are wrong:** the privacy URL is `tryatoms.app`, not `tryatoms.com` (`.com` serves an error page), and `docs/qa/screenshots/android-capture-poc/` is not usable for the store.
- `docs/voice.md` — authority for all store copy. Invoke the `atoms-voice` skill before editing listing prose.

## Decisions & constraints

- **`app.tryatoms.capture` is permanently bound.** Play never allows reuse or rename. Same for the
  developer account owner. Do not relitigate the name.
- **Free is one-way.** A published free app can never become paid.
- **Store copy follows `docs/voice.md`:** no em dashes, no guilt or task-app framing, no "use case",
  honest limits stated plainly. The current draft says outright that the app needs Obsidian + the
  Atoms plugin and that on its own it just writes lines to a file. Keep that honesty.
- **Never claim speech is on-device.** It is not. See InAppSpeech above.
- **Do not upload identity documents.** An "Upload documents to verify your organization" modal is
  pending on the app list. That is the user's to complete, not yours — and it is odd enough
  (an *organization* prompt on a *Personal* account) that they should look before feeding it anything.
- **Do not create accounts, accept agreements, or pay fees** on the user's behalf.
- **Vault lanes.** Emulator/demo vaults only. Never touch `~/Documents/Remote Vault`.
- **No AI-attribution trailers** on commits or PRs. Not ever, in this repo or any other.

## Open questions / blockers

- **Screenshot aspect ratio is unresolved.** 1344×2992 = 2.226:1 vs Play's 2:1 cap. Let the Console
  adjudicate rather than pre-correcting; the fix is one ImageMagick command either way.
- **`app.tryatoms.capture` is not registered** under Android developer verification
  (`.../android-developer-verification`). Both existing packages are Registered. Console says
  *"Starting in September 2026, all Android apps must be registered by verified developers"* —
  roughly a month out from this handoff. User-facing step.
- **Whether the user wants the `play` flavor and privacy-policy change in one PR or two.** The
  policy change touches `www/`, everything else touches `companion/android/`. Unanswered.

## Git state

- Branch `claude/atoms-capture-play-store-24f197` (base `master`), pushed to `origin`.
- This is a **linked worktree nested under `.claude/worktrees/`**, which violates the usual
  sibling-worktree convention. It was created by the harness, not by hand. Reuse it; do not
  create another, and do not "fix" the location mid-flight.
- Last real commit on base: `bf8d45c` Merge pull request #378 from taihartman/claude/field-notes-dom-visuals
- WIP snapshot commit: the branch tip, subject `wip: handoff snapshot — android-play-store-listing`.
  Not pinned to a SHA here: this doc is *inside* that commit, so backfilling its own hash would
  change the hash. Run `git log --oneline -1` after resume.
- Diff since base: **10 files, +234** (`git diff --shortstat origin/master...HEAD`)
- **Compare against `origin/master`, not `master`.** The local `master` ref is stale at `04dce6f`
  (behind `origin/master` at `bf8d45c`), so `git diff master...HEAD` reports a misleading
  *185 files changed, +11244* — that is the stale ref, not this branch's work.
- `companion/android/local.properties` was created locally to point Gradle at the SDK. It is
  gitignored and intentionally not committed — recreate it with
  `echo "sdk.dir=$HOME/Library/Android/sdk" > companion/android/local.properties` if you build.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c
git fetch origin && git switch claude/atoms-capture-play-store-24f197 && git pull --ff-only
```

To build or re-shoot screenshots on the emulator:

```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > companion/android/local.properties
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
emulator -avd Copy_of_Pixel_8_Pro_API_35 -no-snapshot-load -no-boot-anim &
cd companion/android && ./gradlew assembleDebug
```

Then continue from **Next steps** above.
