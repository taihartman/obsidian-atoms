# Atoms Capture (iOS)

**Setup hub** for phone capture. Day-to-day capture is the **Capture Atom** system Shortcut (floating card over your current app) — not this app’s UI.

| Piece | Role |
|--------|------|
| This app | Install guide, checklist, widget entry |
| **Capture Atom** shortcut | Type / voice → `Atoms System/Inbox.md` via Obsidian bookmark |
| Atoms plugin (Obsidian) | Creates Inbox + bookmark; Process files lines into dailies |

## Install links (SSOT)

Repo root [`mobile-install.json`](../../mobile-install.json):

- `captureAtom` — name + iCloud URLs (newest first)
- Companion mirrors `captureAtom.name` + `urls[0]` in `DeliverySettings.swift`

When you ship a new shortcut link: **prepend** the URL, bump `version`, update Swift constants to match.

## Requirements

- Xcode 15+ (tested Xcode 26 / iOS 17+)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
- Physical iPhone for dogfood
- Obsidian with **Atoms** plugin (BRAT: `taihartman/obsidian-atoms`)

## Layout

| Path | Role |
|------|------|
| `Sources/AtomsCaptureCore/` | Stamp/write helpers + shortcut handoff |
| `Tests/` | XCTest (macOS `swift test`) |
| `AtomsCapture/` | Setup hub |
| `AtomsCaptureWidget/` | Home widget → opens Capture Atom |
| `project.yml` | XcodeGen |

## Build & test

```bash
cd companion/ios
swift test
xcodegen generate
xcodebuild -project AtomsCapture.xcodeproj -scheme AtomsCapture \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.2' build
```

Open `AtomsCapture.xcodeproj`, set **Team**, run on device.  
App Group: `group.app.tryatoms.capture.tai`

## Dogfood (device)

1. **Obsidian:** install Atoms plugin → open vault once (creates Inbox + **Atoms Inbox** bookmark).
2. **Atoms Capture hub:** **Install Capture Atom** → Add Shortcut → **I’ve added it**.
3. **Try Capture Atom now** → type or speak → confirm line in `Atoms System/Inbox.md`.
4. Pin **Action Button** / **Control Center** / **widget** to Capture Atom (see hub).
5. Day to day: **don’t open this app** — use Capture Atom.

### Confirm line shape

```text
- 2026-08-07T17:25:25-04:00 your text
```

## Out of this app

- Live Activity / in-app type field (removed — Shortcut is the capture UI)
- App Store listing
- Plus capture relay
