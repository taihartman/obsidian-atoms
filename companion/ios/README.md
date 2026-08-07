# Atoms Capture (iOS POC)

Setup hub + widget for phone capture. **Day-to-day capture on iOS** prefers the
**Capture Atom** system Shortcut (overlay-style card). This app installs that
path and optional Files write.

**Install links SSOT:** repo-root [`mobile-install.json`](../../mobile-install.json)
(plugin + companion). When you ship a new iCloud shortcut link, **prepend** it
there and mirror `atomsCaptureAppend.urls[0]` / name in
`DeliverySettings.swift`.

- Spec: [`docs/plans/2026-08-07-003-feat-ios-companion-capture-poc-plan.md`](../../docs/plans/2026-08-07-003-feat-ios-companion-capture-poc-plan.md)
- Issue: [#379](https://github.com/taihartman/obsidian-atoms/issues/379)
- No Shortcut handoff, no Plus queue, no classify — plugin still files.

## Requirements

- Xcode 15+ (tested with Xcode 26 / iOS 17 deployment)
- Physical iPhone preferred for Live Activities + speech dogfood
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) to regenerate the project: `brew install xcodegen`

## Layout

| Path | Role |
|------|------|
| `Sources/AtomsCaptureCore/` | Pure stamp/write library (shared) |
| `Tests/AtomsCaptureCoreTests/` | XCTest goldens (macOS `swift test`) |
| `AtomsCapture/` | Hub + capture sheet + speech + App Intent |
| `AtomsCaptureWidget/` | Home Screen widget |
| `AtomsCaptureActivity/` | Live Activity / Dynamic Island UI |
| `project.yml` | XcodeGen project definition |

## Build & test

```bash
cd companion/ios

# Core unit tests (macOS — stamp + writer)
swift test

# Regenerate Xcode project after project.yml changes
xcodegen generate

# Simulator build
xcodebuild -project AtomsCapture.xcodeproj -scheme AtomsCapture \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.2' build
```

Open `AtomsCapture.xcodeproj` in Xcode to run on a device. Set your **Team** under Signing for the app + extensions (App Group `group.app.tryatoms.capture`).

## Dogfood

### Hub (once)

1. Prefer a **throwaway vault folder** visible in the Files app (iCloud Drive or On My iPhone). Obsidian Sync’s private sandbox is often **not** writable — the hub says so.
2. Open **Atoms Capture** → **Link vault folder…** → pick the vault root (the folder that contains `.obsidian` or will hold `Atoms System/`).
3. **Save test capture** → status **In vault**.
4. Confirm a line in `Atoms System/Inbox.md`:

```text
- 2026-…T…:…:…±HH:MM …
```

### One-second path (daily)

1. Long-press Home → **Widgets** → **Atoms Capture** → place widget.
2. Tap widget → type or Listen → **Save** → **In vault** or **Failed**.
3. Optional: Settings → Action Button → Shortcut → **Capture thought** (App Intent launcher — not the old Capture Atom append recipe).

### Confirm in Obsidian

Open Obsidian with Atoms → Process / drain files the stamped line into the daily for the stamp’s date.

## Checklist (in-app)

1. Link a Files-visible vault  
2. Save a test capture  
3. Add the Home Screen widget  
4. Optional Action Button  

Copy: *This hub is for setup. Day to day, don’t open the app.*

## Wire contract

Same as Android / plugin (`src/pipeline/inbox.ts`):

- Path: `Atoms System/Inbox.md`
- Line: `- YYYY-MM-DDTHH:mm:ss±HH:MM text`
- Multiline: newlines → tab-indented continuations
- Body sacred beyond that whitespace rule
