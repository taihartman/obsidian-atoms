---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/design-handoff/atoms-view/first-day.html
title: "feat: First-day capture loop (open today + shortcut install/update)"
date: 2026-07-15
type: feat
lane: amend
---

# feat: First-day capture loop (open today + shortcut install/update)

## Goal Capsule

On first use (and any empty library day), Atoms home must give a clear path: **open today’s daily**, **install/update the capture shortcut**, learn **bullet format**, and understand why the library is empty — without processing today or expanding into onboarding bloat.

**Mock:** `docs/design-handoff/atoms-view/first-day.html`  
**Extends:** settled home IA in `docs/design-handoff/atoms-view/README.md` (still one leaf, no new tabs)

**Execution lane:** amend — small surface, no model/write-path contract change. Optional `ce-compound` only if we learn something durable.

---

## Problem Frame

New users open Atoms and see nothing after writing in today’s daily. Three gaps:

1. No bridge into **today’s note** from the plugin UI  
2. No in-app way to **install or refresh** the iOS capture shortcut when we change it  
3. Empty state doesn’t teach **bullet format** or **never process today**

Auto-run stays **daily / past-only** (prior decision). This plan is **UX feedback + capture distribution**, not a change to process timing.

---

## Product Contract

### Requirements

| ID | Requirement |
|---|---|
| R1 | From Atoms home, user can **open or create today’s daily note** in one tap (header control and/or first-day primary button) |
| R2 | Opening today uses Daily Notes settings (folder/format) — same as core Daily Notes; **never** classifies or marks today’s note |
| R3 | When library has **zero atoms** and past unprocessed count is **0**, show a **first-day / setup card** (not a blank void) |
| R4 | Setup card teaches: bullets (`- …`), process after day ends / Preview past, install shortcut |
| R5 | **Install capture shortcut** action opens a **versioned install URL** defined in plugin code |
| R6 | Plugin stores **last acked shortcut version** device-locally; when **acked ≠ shipped** (or acked missing after user left first-day), show **Update / Install capture shortcut** (home banner and/or Settings). Compare as **exact string equality** on the version constant — not numeric ordering |
| R7 | Ack happens when user taps Install/Update (optimistic) — we cannot verify Shortcuts.app state |
| R8 | Settings includes a small **Capture** section: version, Install/Update, one-line format tip |
| R9 | Steady state (atoms exist): setup card hidden; open-today and shortcut entry remain via header / ⋯ / Settings |

### Acceptance Examples

| ID | Example |
|---|---|
| AE1 | Empty vault home → setup card + “Open today’s note” opens `Quick Notes/YYYY-MM-DD` (or configured daily) |
| AE2 | Tap Install → system opens install URL; localStorage records `captureShortcutAckedVersion` |
| AE3 | Bump `CAPTURE_SHORTCUT_VERSION` in code → user who acked old version sees Update until they tap again |
| AE4 | After atoms exist, setup card gone; ◎ still opens today |

### Scope Boundaries

**In**

- `openTodaysDaily(app)` helper  
- Atoms home UI: header open-today, first-day card, update banner  
- Constants + device-local ack for shortcut version  
- Settings Capture block  
- Docs: how we maintain/publish the shortcut (`docs/capture-shortcut.md`)  
- One focused unit test for version-compare / ack helper  

**Out**

- Auto-processing today  
- Non-bullet capture parsing  
- Programmatic install into Shortcuts.app (impossible)  
- Building the binary `.shortcut` in CI in this amend (author publishes link; we ship URL + version)  
- Full onboarding wizard / multi-step modal tour  
- Changing dry-run/write/auto-run cadence  

**Honest constraint (product copy must match):**  
“Update” means **open the latest hosted shortcut**; user re-adds it in Shortcuts. We detect staleness only via **version constant vs acked version**, not by reading iOS.

---

## Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD-F1 | Open today via `obsidian-daily-notes-interface` (`getAllDailyNotes` + `getDailyNote` / `createDailyNote` with today’s moment) | Same SSOT as process path’s daily folder |
| KTD-F2 | Shortcut distribution = **HTTPS install URL + version string in code** (`CAPTURE_SHORTCUT_VERSION`, `CAPTURE_SHORTCUT_INSTALL_URL`); update CTA when `acked !== shipped` | Only portable mobile path; no private API; avoid fragile semver parsing for a single constant |
| KTD-F3 | Ack in **device-local** storage (same pattern as auto-run flags), not `data.json` | Install state is device-specific |
| KTD-F4 | First-day card iff `entries.length === 0 && unprocessedCount === 0` | Matches “no feedback” failure mode without nagging power users |
| KTD-F5 | Header always has open-today control (◎ or calendar icon) | Steady-state users still jump to capture surface |
| KTD-F6 | Placeholder install URL allowed until real iCloud/GitHub link exists; Settings shows warning if URL empty | Unblocks UI; publishing shortcut is parallel author task |
| KTD-F7 | Version bump **0.4.1** (patch) | UX amend, not new major surface |

---

## High-Level Technical Design

```text
Atoms home refresh()
  ├─ load library + unprocessed (existing)
  ├─ firstDay = entries.length===0 && unprocessed===0
  ├─ showShortcutCta = URL set && (acked !== shipped)
  │     // first-day card always offers Install; banner also when !firstDay && showShortcutCta
  └─ render
       ├─ header: ⋯ | Open today | ⚙
       ├─ [if !firstDay && showShortcutCta] Update/Install banner → open URL + ack
       ├─ [if firstDay] Setup card
       │     Open today → file = openTodaysDaily(app); leaf.openFile(file)
       │     Install → open URL + ack (disabled if URL empty)
       └─ library / empty

openTodaysDaily(app) → TFile only (no UI)
  Daily Notes off → DailyNotesDisabledError
  getDailyNote(today) or createDailyNote(today)
  caller opens file in workspace

Settings → Capture
  version label · Install/Update · bullet tip · empty-URL warning
```

**Shortcut maintenance (ops, not runtime):**

1. Edit shortcut in Shortcuts app on a phone  
2. Share → Copy iCloud Link (or attach to GitHub Release)  
3. Bump `CAPTURE_SHORTCUT_VERSION` + set `CAPTURE_SHORTCUT_INSTALL_URL` in repo  
4. Ship plugin; users see Update  

Document in `docs/capture-shortcut.md` (canonical steps for the human maintainer).

---

## Implementation Units

### U1. Open today’s daily (pure-ish + app helper)

**Goal:** Reliable open/create of today’s daily note.

**Requirements:** R1, R2, KTD-F1  

**Files:**
- Modify: `src/daily.ts` — add `openTodaysDaily(app): Promise<TFile>`  
- Create/modify: `test/daily.test.ts` or extend mock if needed — **one** test for date key / “uses getDailyNote when present” with mocked interface if practical; else pure date helper test + manual smoke  

**Approach:**  
- If Daily Notes core disabled → throw existing `DailyNotesDisabledError`  
- Resolve today with Obsidian’s `window.moment` (or moment from the daily-notes stack the app already loads)  
- `getDailyNote(today, getAllDailyNotes())`; if missing, `createDailyNote(today)`  
- **Return `TFile` only** — do not open the leaf inside `daily.ts`; view/plugin calls `workspace.getLeaf(false).openFile(file)` (or `openLinkText`)  
- Extend `test/mocks/obsidian-daily-notes-interface.ts` with `getDailyNote` / `createDailyNote` stubs if unit-testing the helper  

**Verification:** AE1 on device with Quick Notes folder.

---

### U2. Shortcut version + ack + open URL

**Goal:** Ship version constants, compare to ack, open install link, persist ack.

**Requirements:** R5–R7, KTD-F2, KTD-F3, KTD-F6  

**Files:**
- Create: `src/captureShortcut.ts`  
- Create: `test/captureShortcut.test.ts` (**one** regression file: version compare + ack round-trip with fake load/save)  

**Approach:**
```ts
// directional — not final API
CAPTURE_SHORTCUT_VERSION = "1.0.0"
CAPTURE_SHORTCUT_INSTALL_URL = "" | "https://…"  // empty = CTA disabled + Settings warning
LOCAL_STORAGE_SHORTCUT_ACK = "atoms-capture-shortcut-acked-version"

needsShortcutCta(acked: string | null, shipped: string): boolean
// true when acked == null || acked !== shipped

labelInstallOrUpdate(acked): "Install capture shortcut" | "Update capture shortcut"

openShortcutInstall(url): void
// Prefer Obsidian-safe open: (app as any).openWithDefaultApp?.(url)
// or window.open(url, "_blank") — verify on iOS Obsidian once
// If !url.trim() → Notice, no ack
```
Ack **only** after a successful open attempt when URL non-empty.

**Verification:** unit tests for `needsShortcutCta` / label; manual open URL on phone.

---

### U3. Atoms home first-day UI + header open today

**Goal:** Render mock states; wire buttons.

**Requirements:** R1, R3, R4, R5, R6, R9, KTD-F4, KTD-F5  

**Files:**
- Modify: `src/atomsHomeView.ts`  
- Modify: `styles.css`  
- Read: `docs/design-handoff/atoms-view/first-day.html`  

**Approach:** Match mock hierarchy; reuse wait-card button styles for primary/secondary. ⋯ menu: add “Install/Update capture shortcut”, “Open today’s note”.  

**Verification:** AE1–AE4 manual on home leaf; Linked filter unchanged.

---

### U4. Settings Capture section + docs + 0.4.1

**Goal:** Discoverable install/update outside home; maintainer docs; version bump.

**Requirements:** R8, KTD-F7  

**Files:**
- Modify: `src/settings.ts`  
- Create: `docs/capture-shortcut.md`  
- Modify: `docs/design-handoff/atoms-view/README.md` (link first-day mock; extend non-goals)  
- Modify: `package.json`, `manifest.json`, `versions.json`  
- Optional: `docs/architecture.md` one line under Product UI  

**Verification:** Settings shows Capture; install opens URL; manifest 0.4.1.

---

## Verification Contract

| Gate | Pass |
|---|---|
| Unit | `needsShortcutUpdate` / ack helpers |
| Manual first day | Empty library → setup card → open today lands in daily folder |
| Manual format | Bullet tip visible; no process of today |
| Manual shortcut | Install opens URL; second open with same version no Update banner; bump version → Update shows |
| Regression | Existing home wait card + library still work when unprocessed &gt; 0 |

---

## Definition of Done

- [ ] U1–U4 done  
- [ ] Mock states achievable in live plugin (first day / update / steady)  
- [ ] Copy never claims we auto-install into Shortcuts  
- [ ] 0.4.1 installed to Remote Vault for phone Sync  
- [ ] Real install URL can be empty with explicit Settings note until published  

---

## Risks

| Risk | Mitigation |
|---|---|
| Empty install URL ships | Settings + button disabled or Notice “link not configured yet”; docs for maintainer |
| Users ignore Update | First-day card always offers Install; after first-day, banner when `acked !== shipped` (including never-acked) |
| `openTodaysDaily` opens wrong folder | Must use daily-notes-interface only — not hardcode `Quick Notes` |
| Double CTA on first day | Setup card owns Install; suppress separate banner while `firstDay` |
| createDailyNote fails (folder missing) | Catch DailyNotesFolderMissingError; Notice to fix Daily Notes settings |
| moment dependency | Use same moment API daily-notes-interface expects from Obsidian |

---

## Alternatives Considered

| Approach | Why not |
|---|---|
| Process today on first open | Violates capture safety; prior auto-run decision |
| Embed full shortcut binary in plugin | Fragile; platform-specific; still needs user accept in Shortcuts |
| Only README for shortcut | Fails first-day in-app feedback |
| Full ce-loop multi-tab onboarding | Overkill; amend-sized problem |

---

## Open Questions (implement-time)

1. Final install URL host (iCloud vs GitHub Release) — can land after UI with empty URL  
2. Icon for open-today — use lucide name available in Obsidian (`calendar`, `calendar-days`, or `sun`) after a one-line API check  
3. Desktop: does `openWithDefaultApp` open iCloud shortcut links usefully, or only mobile? Accept desktop “opens browser” as enough for v1  

---

## Doc review (2026-07-15)

Applied: equality-based version CTA; `openTodaysDaily` returns file only; first-day vs banner CTA split; empty-URL + Notice path; mock daily-notes stubs called out.

---

## Sources

- Live vault confusion: captures in `Quick Notes/2026-07-15.md` without bullets; Atoms/ empty; never process today  
- Settled home: `docs/design-handoff/atoms-view/README.md`  
- Mock: `docs/design-handoff/atoms-view/first-day.html`  
- `obsidian-daily-notes-interface` for open/create  
