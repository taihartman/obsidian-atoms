---
title: "iOS companion Capture POC - Plan"
date: 2026-08-07
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
type: feat
issue: 379
pr: 380
branch: feat/379-ios-companion-capture
module: companion/ios
tags:
  - companion
  - ios
  - capture
  - live-activity
  - inbox
---

# iOS companion Capture POC - Plan

## Goal Capsule

**Objective.** Ship an iOS **Atoms Capture** companion that matches the Android POC (#166 / #362): one-second capture into `Atoms System/Inbox.md` with the same wire contract, without opening Obsidian for write. Live Activities / Dynamic Island carry **status and actions**, not typing.

**Product authority.** Constitution (body sacred, second brain not task app, desktop+iOS+Android consumers). Research: `docs/research/2026-08-07-companion-capture-app.md`. Android shipped surface set is the UX north star, not a pixel clone.

**Execution profile.** Full feature lane on branch `feat/379-ios-companion-capture`, worktree sibling path, draft PR #380 (`Closes #379`). Implement under `companion/ios/` only for product code; plugin drain stays SSOT for parse.

**Stop conditions.** POC ships when dogfood from widget or App Intent lands a parseable Inbox line with honest status, unit stamp tests green, and screenshots under `docs/qa/screenshots/ios-capture-poc/`. Stop and escalate if Files bookmark write cannot be proven on a real device for any Files-visible vault (not Sync-sandbox).

**Tail ownership.** Shipping tail: device dogfood, screenshots, PR evidence, STATUS clear after merge. No agent install into personal Remote Vault.

**Open blockers.** None product-side. Technical: Files-visible vault dogfood path must be proven on a real device; Sync-sandbox users wait for Plus relay (out of POC).

---

## Product Contract

### Summary

A free iOS companion app (hub for setup + one-second surfaces) appends stamped capture lines to the vault inbox via a security-scoped Files bookmark. Day-to-day capture never requires opening the hub. Live Activity shows listening/delivery state and Stop/Save; the capture sheet owns type + live voice partials. If the vault is not writable, status is honest *Failed* — no Shortcut handoff and no Plus relay in this POC.

**Product Contract preservation:** changed R5, R6, K1, Non-goals, Success Criteria — delivery simplified to Files-only (user-directed 2026-08-07); removed Shortcut fallback status arm.

### Problem Frame

iOS already has a working Shortcut path, but it is fragile to install and weak for “one second from lock screen / island.” Android now has hub + overlay + widget + shade + live voice. iOS needs a first-class companion without lying about Sync-sandbox filesystem limits, and without a dual delivery chain that reintroduces Shortcut complexity.

### Users

- Atoms users on iPhone who can keep a vault folder visible in Files (iCloud Drive, On My iPhone, or other Files providers the app can bookmark).
- Setup happens once (link vault + permissions + place widget / Intent); daily path is widget / Intent / Action Button / Live Activity actions.

### Requirements

| ID | Requirement |
|----|-------------|
| R1 | Capture body is never rewritten beyond the shared multiline whitespace rule (body sacred). |
| R2 | Every successful write produces a line the plugin drain accepts: `- YYYY-MM-DDTHH:mm:ss±HH:MM text` with tab continuations for newlines (same as Android / `src/pipeline/inbox.ts`). |
| R3 | Path target is `Atoms System/Inbox.md` under the linked vault (create folder/file if missing, same template spirit as Android). |
| R4 | **Delivery:** security-scoped bookmark to a Files-visible vault; append when writable. |
| R5 | When the vault is not linked or not writable, do **not** silent no-op and do **not** hand off to Shortcuts; surface *Failed* with a clear re-link / Files-visible vault reason. |
| R6 | **Honest status** after each attempt: *In vault* · *Failed* (with reason). No fake success. |
| R7 | Hub is **setup only**: link vault, permissions, checklist for widget / Intent / Live Activity, one test capture. |
| R8 | Day-to-day entry does not require opening the hub. |
| R9 | Capture sheet supports type + **live voice partials** into the field; stop keeps what is already shown (Android parity). |
| R10 | **Live Activity / Dynamic Island** shows capture-in-progress (Listening, last partial preview read-only) and short post-save delivery state; Stop/Save via App Intents. Not a typing surface. |
| R11 | **POC floor surfaces:** Home Screen widget, App Intent (system launcher for Action Button / Shortcuts app — not the Capture Atom append recipe), capture sheet, Live Activity. |
| R12 | **Stretch in same ship if cheap:** Lock Screen widget, Share extension, Control Center control — not merge blockers. |
| R13 | Brand mark is the ↵ sentinel (tryatoms.com / Android), used for app icon and primary chrome. |
| R14 | Companion never classifies, never files atoms, never becomes a task app. |
| R15 | Plus/self-host capture relay and Shortcut handoff are **out of POC**; document as follow-ups (Sync-sandbox / closed-app parity). |

### Key Decisions

| ID | Decision | Notes |
|----|----------|--------|
| K1 | Files-only delivery in POC | session-settled: user-directed (2026-08-07). Chosen over Shortcut URL handoff and App Group+recipe. Plus relay later for Sync-sandbox. |
| K2 | Live Activity = status + actions only | session-settled: user-approved. Sheet owns input. |
| K3 | POC floor = widget + Intent + sheet + LA | session-settled: user-approved. Full surface list is end-state. |
| K4 | Live voice partials required | session-settled: user-approved. |
| K5 | Hub = setup, not daily home | session-settled: user-approved. Android checklist pattern. |
| K6 | Same inbox wire as Android/plugin | No iOS-only stamp shape. |

### Non-goals

- App Store listing polish / ASO.
- Plus capture queue / cloud enqueue in this POC.
- Shortcut handoff (URL or App Group) in this POC.
- Classify, Library, Home, Ask on phone.
- Pixel-perfect Android overlay clone (iOS has no pass-through overlay strip).
- Supporting Obsidian Sync sandbox as a free writable target (document limitation; Plus later).

### Success Criteria

- [ ] Dogfood: from Home widget or App Intent, type or speak a capture, get *In vault* with a real Inbox line Obsidian Process can drain (Files-visible throwaway vault).
- [ ] Unlinked / revoked bookmark yields *Failed* with re-link guidance — never silent success.
- [ ] Live Activity appears while listening/saving and clears after success or user dismiss.
- [ ] Fresh install checklist teaches widget + Intent + LA the way Android teaches shade + widget.
- [ ] Unit tests pin stamp/multiline/path constants against the same fixtures spirit as Android `CaptureLineTest`.
- [ ] Screenshots under `docs/qa/screenshots/ios-capture-poc/`.

### Acceptance Signals (UX)

- User never wonders if the note was lost (status is explicit).
- Voice feels like a live feed, not “press stop then dump.”
- Island glance answers “am I still listening / did it save?”
- Hub copy never promises Sync-sandbox free write.

### Key Flows

- F1. First-run setup
  - **Trigger:** Fresh install opens hub.
  - **Steps:** Grant mic (and notifications if required for LA) → pick vault folder via document picker → persist security-scoped bookmark → optional test capture → checklist items for widget / Intent.
  - **Outcome:** Vault linked; test line *In vault* or clear *Failed*.
  - **Covered by:** R4, R5, R6, R7

- F2. One-second type capture
  - **Trigger:** Widget or App Intent / Action Button.
  - **Steps:** Capture sheet (or equivalent) → type → Save → write path → status.
  - **Outcome:** *In vault* with stamped line, or *Failed*.
  - **Covered by:** R1–R6, R8, R11

- F3. Live voice capture
  - **Trigger:** Mic on capture sheet.
  - **Steps:** Start listening → partials stream into field → Live Activity shows Listening + preview → Stop keeps text → Save writes.
  - **Outcome:** Body is what the user saw; no dump-on-stop surprise.
  - **Covered by:** R9, R10

- F4. Bookmark failure
  - **Trigger:** Save with missing/expired/unwritable bookmark.
  - **Steps:** Attempt write → detect failure → *Failed* + open hub / re-link CTA.
  - **Outcome:** No truncated Inbox; no fake success.
  - **Covered by:** R5, R6

### Acceptance Examples

- AE1. Golden stamp
  - **Given:** Fixed clock `2026-07-28T17:23:34-04:00` and body `hello`
  - **When:** Format capture line
  - **Then:** `- 2026-07-28T17:23:34-04:00 hello` (colon offset + seconds)
  - **Covers:** R2, K6

- AE2. Multiline
  - **Given:** Body with newlines
  - **When:** Format
  - **Then:** Continuations are tab-indented (`\n\t`)
  - **Covers:** R1, R2

- AE3. Empty vault inbox
  - **Given:** Linked vault with no `Atoms System/Inbox.md`
  - **When:** First successful save
  - **Then:** Folder + file created with inbox template spirit + one stamped line
  - **Covers:** R3, R4

- AE4. Failed write never wipes
  - **Given:** Existing Inbox content and a read/access failure on save
  - **When:** Save attempted
  - **Then:** Existing content unchanged; status *Failed*
  - **Covers:** R5, R6

### Outstanding Questions

None blocking. Deferred:

- Plus capture relay design for Sync-sandbox / closed-app (follow-up issue).
- Whether a future optional Shortcut path returns after free Files path is solid (not this POC).
- Control Center / iOS 18 controls as stretch after floor ships.

### References

- Issue #379 · Draft PR #380 · Branch `feat/379-ios-companion-capture`
- Android: #166 #369 · PR #362 · `companion/android/**`
- Research: `docs/research/2026-08-07-companion-capture-app.md`
- Wire: `src/pipeline/inbox.ts`, `docs/solutions/documentation-gaps/ios-shortcut-capture-wire-format-traps.md`
- Voice discipline analogue: `docs/solutions/logic-errors/android-overlay-fgs-must-declare-microphone-for-speech.md`
- Prior inbox drain: `docs/plans/2026-07-28-002-feat-ios-capture-inbox-drain-plan.md`
- Screenshot precedent: `docs/qa/screenshots/android-capture-poc/`

---

## Planning Contract

### Assumptions

- Implementer has Xcode capable of iOS 17 SDK, a physical iPhone preferred for LA dogfood, and a throwaway vault folder in Files.
- Bundle id family `app.tryatoms.capture` (iOS may use `app.tryatoms.capture.ios` if needed to coexist with Android package naming); display name **Atoms Capture**.
- No CocoaPods/SPM third-party network stack required for POC (system frameworks only).
- Plugin `STAMP_RE` remains the consumer SSOT; iOS is a strict producer (seconds + colon offset), matching Android.

### Key Technical Decisions

- KTD1. **Native SwiftUI multi-target app under `companion/ios/`** — app + widget extension + ActivityKit attributes shared via a small local package or shared folder. (Chosen over Capacitor/PWA: widgets and Live Activities need native.)
- KTD2. **Deployment target iOS 17.0** — Live Activities need 16.1+; 17 reduces availability noise. Control Center controls (18+) remain stretch only. (session-settled: user-approved default)
- KTD3. **Pure `CaptureLine` port** of `companion/android/.../domain/CaptureLine.kt` — path constants, stamp formatter (`yyyy-MM-dd'T'HH:mm:ssXXXXX` / ISO8601 with colon offset), `normalizeMultiline`, `mergeAppend`, inbox template spirit. Unit-test twin of `CaptureLineTest.kt` with the same fixed-clock vectors.
- KTD4. **Security-scoped bookmark SSOT shared by app + extensions** — persist bookmark data + vault display name where the main app, widget, and intents can all read them (typically an App Group container used only for that shared state — not a Shortcut recipe or Obsidian handoff). Start security scope for each write; stop after. Re-link only from hub (and deep link from *Failed*).
- KTD5. **Single write façade `InboxWriter` / `CaptureRepository`** — all surfaces call one append API. Algorithm: start scope → ensure `Atoms System` + `Inbox.md` → read existing (failure ⇒ Err, never treat as empty) → `mergeAppend` → atomic replace (temp + replace) → stop scope. Process-wide write serialization (actor/lock).
- KTD6. **Delivery status enum** — `inVault` | `failed(reason)`. No Shortcut arm in POC.
- KTD7. **Capture UI entry** — `CaptureSheet` (or full-screen cover) presented from App Intent / widget URL / hub test button. Owns TextField + live partials. Not Main hub.
- KTD8. **Live Activity = ActivityKit status chrome** — attributes: phase (`listening` | `saving` | `inVault` | `failed`), read-only preview snippet, timestamps. App Intents on the activity: Stop listening, Save (when text non-empty), Dismiss. Not a text editor.
- KTD9. **Speech: on-device when `supportsOnDeviceRecognition`, else network** — live partials into the field; stop commits visible text (no dump-on-stop). Offline without on-device ⇒ failed listen with reason, field keeps prior text. (session-settled: user-approved default)
- KTD10. **Home Screen widget** — tappable ↵ chip / “Capture” launches capture entry (widget URL or App Intent). Subtitle may show vault name when linked.
- KTD11. **App Intent `CaptureThought`** (name flexible) — opens capture UI or accepts a dialog parameter so Action Button / the system Shortcuts app can *launch* capture. This is not the legacy Capture Atom append recipe and does not write via Shortcuts. Does not require hub.
- KTD12. **Brand** — ↵ mark, tint `#0A84FF`, dark chip language aligned with Android / tryatoms.com. App label **Atoms Capture**.
- KTD13. **No network product features** in POC (speech may use Apple network recognition as OS service; no Atoms backend).
- KTD14. **Stretch gate** — Lock Screen widget, Share extension, Control Center only after floor units green and only if incremental cost is small; never block merge.

### High-Level Technical Design

```text
┌─────────────────────────────────────────────────────────┐
│  Surfaces                                                │
│  Widget ──┐                                              │
│  App Intent ──┼──► Capture entry (sheet) ──► Repository │
│  Hub test ──┘         │                      │          │
│  LA Stop/Save ────────┘                      ▼          │
│                                    InboxWriter + bookmark│
│                                              │          │
│                                              ▼          │
│                               Files: vault/Atoms System/ │
│                                      Inbox.md            │
│  Live Activity ◄── status updates (listening/save/result)│
└─────────────────────────────────────────────────────────┘
```

Suggested layout (implementer may adjust names):

```text
companion/ios/
  README.md
  AtomsCapture.xcodeproj   (or .xcworkspace)
  AtomsCapture/            # main app — hub + sheet + speech
  AtomsCaptureWidget/      # WidgetKit
  AtomsCaptureActivity/    # Live Activity UI (if separate target)
  Shared/                  # CaptureLine, InboxWriter, VaultStore, models
  AtomsCaptureTests/       # XCTest pure + file write tests
```

### Implementation Constraints

- Body sacred; never classify or write `<!--atoms:filed-->`.
- Never treat failed read as empty before write (wipe hazard — Android learning).
- Path constants fixed: `Atoms System` / `Inbox.md` — not user settings.
- Dogfood and screenshots: throwaway / demo vault only; never unattended personal Remote Vault.
- No AI attribution trailers on commits/PRs.
- Constitution changes only via PR.

### Sequencing

1. Scaffold + pure `CaptureLine` + tests (unblocks all surfaces).
2. Bookmark store + InboxWriter + hub link/test capture.
3. Capture sheet + speech partials + status.
4. App Intent + widget entry.
5. Live Activity + Stop/Save intents.
6. Polish checklist copy, README, screenshots; stretch only if cheap.
7. Shipping tail on PR #380.

### Risks

| Risk | Mitigation |
|------|------------|
| Sync-sandbox users expect free write | Hub copy + Failed reason; research already documents Plus later |
| Bookmark expires / moves | Failed + re-link CTA; never wipe |
| Speech flaky / OEM audio | Session generation; soft restart; keep visible partials |
| LA/simulator gaps | Prefer device dogfood; document simulator limits |
| Scope creep to Share/Controls | KTD14 stretch gate |
| Stamp drift from plugin | Golden tests twin Android; optional drain smoke on `test_vault/` |

---

## Implementation Units

### U1. Xcode scaffold + shared CaptureLine

- **Goal:** Create `companion/ios/` project skeleton and pure stamp/path module with Android-parity tests.
- **Requirements:** R1, R2, R3, R13, K6
- **Files:**
  - Create: `companion/ios/**` (xcodeproj, app target shell, test target, shared `CaptureLine.swift`)
  - Create: `companion/ios/README.md`
  - Reference: `companion/android/app/src/main/java/app/tryatoms/capture/domain/CaptureLine.kt`
  - Reference: `companion/android/app/src/test/java/app/tryatoms/capture/domain/CaptureLineTest.kt`
- **Approach:** Port constants, format, normalizeMultiline, mergeAppend, template spirit. Inject clock for tests. Fixed vectors from Android test (`2026-07-28T17:23:34-04:00`, multiline, `+09:00`, empty reject, mergeAppend cases, path constants).
- **Test scenarios:**
  - Happy path: format `hello` at fixed -04:00 → exact stamp and line strings.
  - Edge: empty/whitespace body throws/returns error.
  - Edge: multiline → tab continuations.
  - Edge: positive offset uses colon form, not `+0900`.
  - Edge: mergeAppend empty → template + line + trailing newline.
  - Edge: mergeAppend missing trailing newline inserts one.
  - Integration: path constants equal plugin strings.
- **Verification:** `xcodebuild test` (or documented scheme) for the iOS test target — all CaptureLine tests green.

### U2. Vault bookmark store + InboxWriter

- **Goal:** Persist security-scoped bookmark; append stamped lines safely; honest errors.
- **Requirements:** R3, R4, R5, R6
- **Dependencies:** U1
- **Files:**
  - Create: shared `VaultStore`, `InboxWriter` / `CaptureRepository`, delivery status types
  - Test: temp-directory write tests (create path, append twice, read-fail does not wipe)
  - Reference: `companion/android/.../data/InboxWriter.kt`, `InboxAtomicWriteTest.kt`
- **Approach:** Document picker grants URL → store bookmark Data. Writer starts security scope, ensures folder/file, read-or-err, mergeAppend, atomic write, stop scope. Serialize concurrent writers. Map errors to *Failed* reasons (not linked, access denied, I/O).
- **Test scenarios:**
  - Happy path: write into temp vault creates `Atoms System/Inbox.md` with template + line.
  - Happy path: second write preserves first line + appends second.
  - Edge: simulated read failure → content unchanged + error.
  - Edge: empty body rejected before I/O.
  - Edge: missing bookmark → failed without creating random paths.
- **Verification:** Unit/file tests green; manual: link throwaway folder once in simulator or device.

### U3. Hub setup UI

- **Goal:** Setup-only hub: link vault, permissions, checklist, test capture.
- **Requirements:** R7, R8, R13, R15
- **Dependencies:** U2
- **Files:**
  - Create: main app hub views/view-models
  - Update: Info.plist usage strings (mic, optional notifications; document browser)
- **Approach:** Mirror Android checklist spirit: (1) Link vault (2) Permissions (3) Test capture (4) Add widget (5) Enable Intent / Action Button hint. Copy states hub is setup, not daily home. Explicit note that Obsidian Sync sandbox may not be Files-writable — use a Files-visible vault. Test capture calls repository and shows *In vault* / *Failed*.
- **Test scenarios:**
  - Happy path: linked state shows vault name and inbox path hint.
  - Edge: unlinked test capture → *Failed* with re-link guidance.
  - UX: checklist does not claim Sync-sandbox free write.
- **Verification:** Build + run hub; test capture on throwaway vault.

### U4. Capture sheet + live voice

- **Goal:** Day-to-day capture UI with type + live partials + save/status.
- **Requirements:** R1, R6, R8, R9
- **Dependencies:** U2, U3
- **Files:**
  - Create: `CaptureSheet` (or equivalent), speech session helper
  - Reference discipline: Android `InAppSpeech.kt` + mic FGS learning doc (session generation, keep partials)
- **Approach:** Text field is source of truth. Speech streams partials into field; Stop freezes visible text. Save → repository → banner/status *In vault* / *Failed*. Dismiss returns to prior context (home/widget). Privacy strings present before first mic use.
- **Test scenarios:**
  - Happy path: typed save produces line (unit via repository mock or file).
  - Edge: stop-with-partial keeps field text (logic test or UI test if cheap).
  - Edge: speech unavailable offline without on-device → error; no empty overwrite of field.
  - Edge: save while empty disabled or *Failed* empty body.
- **Verification:** Device/simulator type path; device preferred for speech.

### U5. App Intent + Home Screen widget

- **Goal:** One-second entry without opening hub.
- **Requirements:** R8, R11, R13
- **Dependencies:** U4
- **Files:**
  - Create: App Intent(s), WidgetKit extension, deep link / open capture entry
- **Approach:** Widget tap and Intent both present capture entry. Widget shows ↵ branding; optional vault subtitle when linked (read VaultStore via shared app/extension storage from KTD4). Intent is a launcher only (Action Button / system Shortcuts app) — document in hub checklist; never the Capture Atom bookmark-append recipe.
- **Test scenarios:**
  - Happy path: Intent opens capture entry (manual).
  - Happy path: Widget installed and opens capture entry (manual).
  - Edge: Intent while unlinked still opens UI; save → *Failed* (no crash).
- **Verification:** Manual on device/simulator; checklist copy updated.

### U6. Live Activity status chrome

- **Goal:** Island/LA shows listening and delivery; Stop/Save actions; not typing.
- **Requirements:** R10, R11
- **Dependencies:** U4, U5
- **Files:**
  - Create: ActivityKit attributes, LA UI, App Intents for Stop/Save/Dismiss wired to shared state/repository
- **Approach:** Start LA when listening or saving begins; update preview snippet (read-only, truncated); end or show short success/failure then dismiss. Actions call same speech stop / save paths as sheet. If LA unavailable, capture still works (degrade, don’t block).
- **Test scenarios:**
  - Happy path: listening shows Listening + preview (device).
  - Happy path: save updates to *In vault* then clears.
  - Edge: Save from LA with empty text no-ops or fails honestly.
  - Edge: Capture works when LA cannot start.
- **Verification:** Physical device dogfood preferred; screenshots include Island/LA if hardware allows.

### U7. README, hub polish, stretch optional, QA evidence

- **Goal:** Ship-ready docs and evidence; optional stretch only if cheap.
- **Requirements:** R12, R13, success criteria screenshots
- **Dependencies:** U1–U6
- **Files:**
  - Update: `companion/ios/README.md`
  - Create: `docs/qa/screenshots/ios-capture-poc/*`
  - Optional: Lock Screen widget / Share / Control Center only under KTD14
  - Update: PR #380 body evidence links (absolute raw URLs)
- **Approach:** README mirrors Android dogfood (build, test, link vault, widget, confirm line shape). Screenshots: hub, link, sheet, widget, status, LA if available. Stretch explicitly skipped or minimal.
- **Test scenarios:**
  - Dogfood script in README produces parseable Inbox line.
  - Screenshot set covers setup + one-second path + failure state.
- **Verification:** Human device pass; PR checklist boxes only after real runs.

---

## Verification Contract

| Gate | Command / action | Applies |
|------|------------------|---------|
| iOS unit tests | `cd companion/ios && xcodebuild test -scheme AtomsCapture -destination 'platform=iOS Simulator,name=iPhone 16' ` (adjust scheme/destination in README) | U1, U2, logic in U4 |
| iOS build | `xcodebuild build` for app + extensions | All units |
| Android regression (optional sanity) | `cd companion/android && ./gradlew test` | Only if Android tree touched (should not be) |
| Plugin tests | Not required unless `src/pipeline/inbox.ts` touched | Default N/A |
| Device dogfood | Throwaway Files-visible vault; widget or Intent → capture → inspect Inbox line; Obsidian drain optional | U3–U7 |
| Failure dogfood | Unlink vault or revoke access → save → *Failed*, inbox unchanged | U2, U3, U4 |
| Screenshots | `docs/qa/screenshots/ios-capture-poc/` linked in PR #380 | U7 |
| Product QA skills | `world-class-qa` then `adversarial-qa` when shipping if skills installed | Pre-merge |

---

## Definition of Done

**Global**

- [ ] `artifact_readiness` work complete for claimed scope; PR #380 has `Closes #379`
- [ ] CaptureLine tests match Android golden spirit and are green
- [ ] Files bookmark write proven on device or simulator with real folder
- [ ] Widget or App Intent path works without opening hub
- [ ] Live Activity decision implemented (status chrome) or explicitly degraded with reason in PR
- [ ] No Shortcut handoff code path claiming success
- [ ] Screenshots committed and linked with absolute raw GitHub URLs
- [ ] README dogfood steps work
- [ ] Abandoned spike code removed from diff
- [ ] STATUS.md cleared only after merge (human/agent shipping tail)

**Per unit**

| Unit | Done when |
|------|-----------|
| U1 | Project builds; CaptureLine tests green |
| U2 | Writer tests green; temp vault append safe |
| U3 | Hub links vault + test capture status honest |
| U4 | Type + speech partials save path works |
| U5 | Widget + Intent open capture without hub |
| U6 | LA updates on device or documented degrade |
| U7 | README + screenshots + PR evidence |

---

## Appendix

### Android → iOS map

| Android | iOS POC |
|---------|---------|
| SAF / path append | Security-scoped bookmark append |
| Overlay strip | Capture sheet |
| QS tile + widget | App Intent + Home widget |
| FGS listening notification | Live Activity |
| Hub checklist | Hub checklist (Files-visible caveat) |
| `CaptureLine` + tests | Swift port + XCTest |

### Follow-ups (not this PR)

- Plus / self-host capture relay for Sync-sandbox and closed-app parity
- Optional Shortcut path only if product revisits after Files path is solid
- App Store listing polish
- Share extension / Control Center as dedicated issues if not absorbed as stretch
