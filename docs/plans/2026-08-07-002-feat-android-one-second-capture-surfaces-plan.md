# feat: Android one-second capture surfaces

**Date:** 2026-08-07  
**Lane:** full feature  
**Depends on:** Android Capture hub POC (`companion/android/`, PR #362 / #166 inbox contract)  
**Research:** `docs/research/2026-08-07-companion-capture-app.md`  
**Design:** `docs/design-handoff/tokens/README.md` (AtomsTheme already on hub)  
**Status:** implementation-ready — **await human approval before code**

---

## Goal capsule

**Objective.** Make capture a **one-second habit** on Android. The installed app is the **hub** (vault link, checklist, settings). Everyday capture happens from **home-screen / launcher surfaces** that open a minimal compose path and write the same inbox wire contract — without browsing the hub.

**Product hierarchy (load-bearing):**

| Priority | Surface | Role |
|---|---|---|
| **P0** | One-second capture | Get text into `Atoms System/Inbox.md` with minimal taps |
| **P1** | Hub app | Pair vault once, status, switch vault, dogfood |
| **P2** | Polish / later | Share sheet, QS tile, voice, lock screen |

**Stop when.**

1. User can add a **home-screen widget** that starts capture in ≤2 taps from home (ideally 1 tap → keyboard).
2. Long-press app icon shows **Capture** shortcut → same quick path.
3. Quick path is a **dedicated minimal activity** (not the full hub checklist), keyboard focused, Capture/save primary.
4. Unlinked vault → clear handoff into hub setup (never silent fail).
5. Same stamp/write path as hub (`CaptureLine` + `InboxWriter`); unit tests unchanged or extended.
6. AtomsTheme styling; dogfood on physical device + screenshots.
7. Hub copy reframed: setup once, capture from widget/shortcut day-to-day.

**Out.**

- iOS companion / iOS widgets  
- Plus capture cloud queue  
- Inline-on-widget text field that saves without opening an activity (Glance limitations + OEM pain — deferred)  
- Persistent notification capture bar  
- Voice-first / Wear OS  
- Play Store listing  
- Changing plugin drain or inbox path  

---

## Problem frame

POC hub works: all-files scan finds vaults, write lands in inbox, UI matches plugin tokens. **That is not the daily loop.** Opening a full app, scrolling past checklist, then typing is multi-second friction. iOS sells “five seconds / Siri / share”; Android needs an equivalent **placement product** (widget + launcher shortcut), not a better settings screen.

User direction (2026-08-07): *the app is the hub; one-second capture is the most important thing.*

---

## Product contract

### One sentence

> **From the home screen: tap → type → saved — vault already linked in the hub.**

### Jobs

| Job | Bar |
|---|---|
| J1. Home widget | Resizable widget; primary affordance **Capture** (or empty field chrome that opens quick compose) |
| J2. Launcher shortcut | Static shortcut **Capture** on long-press icon |
| J3. Quick compose | Minimal activity: serif prompt optional, field focused, keyboard up, one primary **Capture**, dismiss on success |
| J4. Cold start | If process dead, still opens quick compose; write path works if vault linked |
| J5. Not linked | Quick compose shows one screen: “Link a vault in Atoms Capture” + Open hub — no fake save |
| J6. Success feedback | Toast or brief snackbar “Saved”; activity finishes (back to home) unless user stays |
| J7. Hub remains | MainActivity keeps vault chooser / checklist / last status |

### Non-goals (constitution)

- No classify, titles, atoms, library in quick path  
- Body sacred — no rewrite  
- No second brain  
- No em dashes in app chrome copy  

### Wire contract (unchanged)

```text
- 2026-08-07T14:30:45-04:00 capture text
```

Path: `{vault}/Atoms System/Inbox.md` via existing file-path or SAF writer.

---

## UX spec

### A. QuickCaptureActivity (new)

| Element | Spec |
|---|---|
| Theme | AtomsTheme; edge-to-edge; dark default |
| Layout | Compact: optional kicker `CAPTURE`, serif line “What’s on your mind?”, field, primary Capture, quiet Cancel |
| Focus | `requestFocus` + `SHOW_IMPLICIT` IME on start |
| Window | `adjustResize`; optional `windowSoftInputMode=stateVisible` |
| Success | Write → toast “Saved” → `finish()` |
| Error | Inline banner (status card style); stay open |
| Unlinked | No field enable for save; primary becomes **Open Atoms Capture** → MainActivity |
| Intent | `ACTION_VIEW` or custom `app.tryatoms.capture.QUICK_CAPTURE`; extras none required |
| Task | `android:excludeFromRecents="true"` optional so home stack stays clean; singleTop |

### B. Home widget

| Decision | Choice | Why |
|---|---|---|
| Framework | **Glance** (Jetpack) | Compose-like, maintained; good enough for button widget |
| v1 content | **Tap target**, not full IME-in-widget | Reliable across OEMs; one-second = tap widget → keyboard in QuickCapture |
| Look | Black/card surface, blue “Capture” or large “+ Capture”, small vault name if linked | Match tokens; no purple fills |
| Sizes | Default ~2×1 or 2×2; resize OK | |
| Update | Periodic/on-click only; refresh label when vault link changes (broadcast or glance update from hub) | |

**Explicit non-goal for v1:** multi-line text field *inside* the widget that saves without an activity. Revisit only if Glance + OEM testing proves solid.

### C. Launcher shortcut (static)

`shortcuts.xml`:

- id `capture`  
- short label **Capture**  
- long label **Capture to Atoms**  
- intent → QuickCaptureActivity  

Dynamic shortcut optional later (e.g. vault name).

### D. Hub reframing (small copy/structure)

- Title area stays Atoms hub  
- First-run checklist unchanged  
- After linked: quieter hero — “Add the Capture widget for one-tap capture” with **How** (long-press home → widgets → Atoms Capture)  
- Do not force widget pin API if flaky; Android 8+ `requestPinAppWidget` where available as optional button  

### E. Deferred surfaces (named, not built)

| Surface | When |
|---|---|
| Share target (`SEND` text/plain) | Immediately after widget if cheap; else next PR |
| Quick Settings tile | After widget dogfood |
| App Actions / Assistant | Later |
| Lock screen | OEM-specific; skip |

---

## Technical decisions

| KTD | Decision |
|---|---|
| KTD1 | **QuickCaptureActivity** separate from MainActivity — cold path must not inflate hub checklist |
| KTD2 | **Shared write core** — extract or call existing `InboxWriter` + `VaultStore.current()` from a small `CaptureRepository` used by hub VM and quick activity (no duplicated stamp logic) |
| KTD3 | **Glance App Widget** + `ACTION` callback → start QuickCaptureActivity (new task) |
| KTD4 | **Static shortcuts** via `res/xml/shortcuts.xml` + manifest meta-data |
| KTD5 | **VaultStore** remains single SSOT for link; widget reads vault name for subtitle via Glance state or SharedPreferences |
| KTD6 | Version bump `0.1.0-poc` → `0.2.0-poc` (user-visible surfaces) |
| KTD7 | Stay on current minSdk 26; Glance needs check — use Glance 1.1.x compatible with compile 35 |

### Module layout (additions)

```text
companion/android/app/src/main/
  java/app/tryatoms/capture/
    QuickCaptureActivity.kt
    data/CaptureRepository.kt          # thin: isLinked, vaultName, append(text)
    widget/CaptureWidgetReceiver.kt
    widget/CaptureWidget.kt            # Glance
    ui/QuickCaptureScreen.kt
  res/xml/shortcuts.xml
  res/xml/capture_widget_info.xml
  res/layout/ (only if Glance needs placeholder — prefer Glance-only)
```

### Intent contract

```text
action: app.tryatoms.capture.action.QUICK_CAPTURE
component: QuickCaptureActivity
```

Widget + shortcut + optional future tile all fire this action.

### CaptureRepository (sketch)

```kotlin
class CaptureRepository(ctx: Context) {
  private val store = VaultStore(ctx)
  private val writer = InboxWriter(ctx)
  fun isLinked(): Boolean
  fun vaultLabel(): String?
  fun append(body: String): InboxWriter.WriteResult  // file or SAF branch from store
}
```

Hub `CaptureViewModel.capture()` should call the same repository (amend, not fork).

---

## Implementation units

| Unit | Deliverable | Verify |
|---|---|---|
| **U1** | `CaptureRepository` + hub VM uses it | `./gradlew test`; hub capture still works on device |
| **U2** | `QuickCaptureActivity` + `QuickCaptureScreen` | adb start activity → keyboard; save; finish |
| **U3** | Static shortcut | long-press icon → Capture → quick activity |
| **U4** | Glance widget + provider XML | pin widget → tap → quick activity; unlinked state label |
| **U5** | Hub “Add widget” hint + optional `requestPinAppWidget` | copy only if pin API awkward |
| **U6** | QA screenshots + README dogfood for widget/shortcut | `docs/qa/screenshots/android-capture-surfaces/` |

**Suggested order:** U1 → U2 → U3 → U4 → U5 → U6 (shortcut before widget so intent path is proven).

---

## Acceptance examples

| # | Example |
|---|---|
| AE1 | Vault linked. Tap widget → QuickCapture opens with keyboard → type “hi” → Capture → activity closes → Inbox.md has stamped line |
| AE2 | Vault linked. Long-press icon → Capture → same as AE1 |
| AE3 | Vault unlinked. Widget tap → message to open hub; no write |
| AE4 | Process death. Widget tap cold-starts QuickCapture; save still works |
| AE5 | Multiline paste → tab continuations (existing CaptureLine tests) |
| AE6 | Hub Capture button still works after repository extract |

---

## Test plan

| Layer | What |
|---|---|
| Unit | Existing CaptureLine/VaultPath; repository branches if pure-enough |
| Device | Widget pin, shortcut, cold start, unlinked |
| Visual | QuickCapture + widget screenshot under AtomsTheme |
| Regression | Hub all-files link + capture |

---

## Risks

| Risk | Mitigation |
|---|---|
| OEM kills widget process / stale UI | Widget is launch-only; state is “Capture” + vault name refresh on hub save |
| User never pins widget | Hub hint + pin request; shortcut still works without pin |
| Duplicate write logic | U1 repository mandatory before U2 |
| Glance dependency / AGP friction | Spike U4 early if build breaks; fallback AppWidget RemoteViews button-only |
| All-files revoked mid-flight | Write errors surface in quick UI; point to hub |
| Scope creep to share/QS | Parked in deferred table |

---

## Issue / claim

- Prefer **new GitHub Issue**: `feat(android): one-second capture widget + launcher shortcut`  
- Do **not** overload #166 if already closed by hub POC merge  
- STATUS row: branch `feat/android-one-second-capture`, plan this file, hot files `companion/android/**`  
- Draft PR before implementation  

---

## Success metric (product)

Dogfood bar: **capture from home without opening the hub checklist** becomes the default path for the human owner within one day of install. Hub opens only for setup or vault switch.

---

## Open questions (defaults if no reply)

| # | Question | Default |
|---|---|---|
| Q1 | Finish activity on every successful save? | **Yes** |
| Q2 | Share target in same PR? | **No** — follow-up if U4 clean |
| Q3 | Widget shows last capture snippet? | **No** — privacy + clutter; vault name only |
| Q4 | Voice button on quick compose? | **No** — system keyboard mic is enough for v1 |

---

## Approval gate

**Do not implement until a human says go** (and hard claim exists).  

Approval means: this plan’s P0 (QuickCapture + shortcut + widget tap-to-compose) ships; deferred list stays out.
