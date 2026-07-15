---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/design-handoff/atoms-view/README.md
title: "feat: Atoms home view (mobile-first ItemView)"
date: 2026-07-15
type: feat
---

# feat: Atoms home view (mobile-first ItemView)

## Goal Capsule

Ship a single **Atoms** workspace leaf that is the product home on mobile and desktop: browse **recent atoms** with link chips when the queue is clear, and a **dominant waiting card + Preview-first sheet** when past captures need processing. Reuse existing dry-run and write pipelines; no second file browser, no Links/People tab, no API console as home.

**Canonical mock:** `docs/design-handoff/atoms-view/index.html`  
**Settled design:** `docs/design-handoff/atoms-view/README.md`

---

## Problem Frame

Commands + Notices + modals make Atoms feel like a batch tool, not a place. Users need to **see what landed** and **act when work is waiting** without hunting Backlinks or the command palette—especially on phone.

Architecture already names **zero-guilt UI** and **mobile-primary** (`docs/architecture.md`). This plan is that surface.

---

## Product Contract

### Requirements

| ID | Requirement |
|---|---|
| R1 | One home surface titled **Atoms** (not Inbox / Recent / four tabs) |
| R2 | **Queue clear:** list recent atom notes from the configured atom folder, newest first |
| R3 | Each library row is **Atoms-native**: title, link chips (if any), source-day meta, relative time; tap opens the atom |
| R4 | **All \| Linked** filter on the library (Linked = rows with ≥1 link chip) |
| R5 | **Work pending:** dominant card with unprocessed past-capture count, Preview primary, Process secondary; optional short queue peek |
| R6 | Preview reuses existing dry-run classification path; Process reuses existing write path; Preview before write remains the trust default |
| R7 | ⋯ / settings affordances for secondary actions (backfill, test connection, open plugin settings)—not equal home tabs |
| R8 | Mobile-first layout (thumb-safe targets, single column); desktop = same view in a sidebar leaf + editor |
| R9 | Never rewrite person hub bodies; never invent AI folders; library is **atoms only** (no task/noise as primary rows) |

### Acceptance Examples

| ID | Example |
|---|---|
| AE1 | Open Atoms view with 0 unprocessed → sees recent atom titles; no waiting card |
| AE2 | 3 unprocessed past captures → waiting card “3 captures waiting”; Preview opens dry-run results; Process writes and refreshes library |
| AE3 | Atom linked to Nichita shows chip **Nichita**; Linked filter hides unlinked atoms |
| AE4 | Tap atom row → leaf opens that note in the editor |

### Scope Boundaries

**In**

- `ItemView` registration, ribbon and/or command “Open Atoms”
- Pure helpers for library + unprocessed summary
- CSS in `styles.css` aligned with mock (grouped lists, waiting card, sheet-like preview host)
- Wire Preview → existing dry-run; Process → existing write (or open existing modal flows if sheet parity is too heavy for v1—see KTD-V4)

**Out / deferred**

- Links / People / Status as tabs  
- Graph explorer  
- Live capture UI (Daily remains capture)  
- Collapsed “also processed task/noise” section  
- “This week” filter (implement-time optional; not required)  
- Redesigning backfill UX beyond deep-link to existing command  

**Outside product identity**

- CRM, auto-create hubs, folder routing (unchanged from people-linking plan)

---

## Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD-V1 | **One `ItemView` type**, view type id e.g. `atoms-home` | Matches mock; Obsidian-native leaf on mobile drawer and desktop sidebar `(session-settled: user-approved — chosen over multi-tab admin shell)` |
| KTD-V2 | **No Links tab in v1** — chips + Linked filter only | Adversarial review; avoid dead tab / mini-CRM `(session-settled: user-directed — chosen over dual Recent/Links tabs)` |
| KTD-V3 | **Library = files in `settings.atomFolder` with `generated-by: linker` (or fallback: all markdown under folder)** sorted by `mtime` desc | Atoms already stamp `generated-by: linker` in frontmatter; avoids listing manual notes dropped in folder by accident |
| KTD-V4 | **Preview UI:** prefer embedding dry-run summary **inside the view** (list of verdict/title/chips); if time-box slips, call existing `DryRunPreviewModal` from Preview button without regressing trust order | Mock wants sheet; modal is acceptable v1 if view-hosted preview is incomplete—still Preview-before-Process |
| KTD-V5 | **Link chips:** extract `[[wikilinks]]` from atom body after frontmatter (link prose from `formatLinkProse`); dedupe; exclude self-title | Links are not in YAML today—body parse is the SSOT without format migration |
| KTD-V6 | **Source day meta:** from frontmatter `source: "[[YYYY-MM-DD]]"` when present | Already written by `buildAtomMarkdown` |
| KTD-V7 | **Unprocessed count:** reuse `getPastDailyNotesWithUnmarkedCaptures` (never today) | Same as process/dry-run—no second parser |
| KTD-V8 | **Version 0.4.0** | User-visible product surface |

**Product Contract preservation:** Contract taken from design handoff + adversarial lock; no R-ID renumber from a prior brainstorm file.

---

## Assumptions

- Design handoff mock is visual authority for spacing/hierarchy; Obsidian CSS variables preferred over hard-coded pure-black iOS tokens where they clash with themes.
- Opening plugin settings from the view uses the standard Obsidian settings API / command.
- Implementer may use `WorkspaceLeaf` `setViewState` to reveal the leaf on first open after command.

---

## High-Level Technical Design

```text
┌─────────────────────────────────────┐
│  AtomsHomeView (ItemView)           │
│  ┌───────────────────────────────┐  │
│  │ Header: Atoms · ⋯ · ⚙         │  │
│  ├───────────────────────────────┤  │
│  │ [WaitCard if count>0]         │  │ ──► Preview → dryRun pipeline
│  │ [QueuePeek optional]          │  │ ──► Process → write pipeline
│  │ All | Linked                  │  │
│  │ Recent atom rows              │  │ ──► workspace.openLinkText
│  └───────────────────────────────┘  │
└──────────────▲──────────────────────┘
               │ refresh()
    ┌──────────┴──────────┐
    │ atomsHomeData.ts    │  pure: listAtoms, parseChips, countUnprocessed
    │ daily.ts / render   │  existing
    └─────────────────────┘
```

**Data refresh triggers:** view open, after Preview/Process completes, optional vault `modify`/`create`/`delete` on atom folder (debounced).

---

## Implementation Units

### U1. Home data layer (pure + tests)

**Goal:** Deterministic helpers for library rows and pending count—no Obsidian UI.

**Requirements:** R2, R3, R4, R5, R9, KTD-V3, KTD-V5, KTD-V6, KTD-V7

**Dependencies:** none

**Files:**
- Create: `src/atomsHomeData.ts`
- Create: `test/atomsHomeData.test.ts`
- Read: `src/render.ts` (frontmatter shape), `src/daily.ts`

**Approach:**
- `listAtomLibraryEntries(files: { path, mtime, content }[], atomFolder): AtomLibraryEntry[]` — filter folder + `generated-by: linker` (tolerate missing stamp for tests with explicit flag), sort mtime desc, cap e.g. 100 for v1.
- `parseAtomLibraryEntry(path, content, mtime): entry` — title from basename; `sourceDay` from `source:` FM; `linkChips` from body wikilinks (not FM tags).
- `countUnprocessedFromNotes(notes): number` thin wrapper or pure count over already-parsed `DailyNoteWithCaptures[]`.
- Types: `AtomLibraryEntry { path, title, sourceDay, linkChips, mtime }`.

**Patterns:** pure functions like `parse.ts` / `people.ts`; vitest fixtures as markdown strings.

**Test scenarios:**
- Happy: atom with source + `[[Nichita]]` in body → chip Nichita, source day set  
- Happy: sort two files by mtime  
- Edge: no wikilinks → empty chips; Linked filter helper returns false  
- Edge: self-link to own title excluded from chips  
- Edge: file outside atom folder ignored  
- Edge: missing frontmatter still lists if under folder (define rule: require generated-by OR include all .md under folder—pick one and test it; **prefer require generated-by** for cleanliness)  
- Error: empty content / empty folder → `[]`

**Verification:** unit tests green; no UI.

---

### U2. ItemView shell + CSS (clear queue)

**Goal:** Register and render the Atoms leaf for the **queue-clear** state: header, filters, library list, empty state.

**Requirements:** R1, R2, R3, R4, R8

**Dependencies:** U1

**Files:**
- Create: `src/atomsHomeView.ts`
- Modify: `src/main.ts` (registerView, command, ribbon optional)
- Modify: `styles.css`
- Create: `test/atomsHomeView.test.ts` only if pure render helpers extracted; else verification via data layer + manual smoke

**Approach:**
- `class AtomsHomeView extends ItemView` with `getViewType`, `getDisplayText` (“Atoms”), `getIcon` (pick stable lucide/obsidian icon name available in target API).
- `onOpen` builds container DOM (prefer Obsidian `contentEl` + classes under `.atoms-home`).
- Populate from `app.vault` + `metadataCache` via U1 helpers; **All | Linked** toggles client-side filter.
- Row click → `app.workspace.openLinkText(title, "", false)` or open file by path.
- Empty library copy: short, zero-guilt (architecture).

**Patterns:** existing `Modal` DOM style in `preview.ts` / `settings.ts`; avoid React.

**Execution note:** Prefer characterization of pure list mapping in U1; view glue is smoke-tested in Obsidian (desktop + phone if available).

**Test scenarios:**
- Test expectation for pure DOM builders if extracted: given entries, filter Linked hides unlinked  
- Integration: registerView id unique; command opens leaf (manual / Obsidian CLI if project already uses it)

**Verification:** Command “Atoms: Open home” opens leaf; list matches atom folder; Linked filter works; open row focuses note.

---

### U3. Waiting card + Preview / Process wiring

**Goal:** When unprocessed past captures exist, show dominant card + queue peek; Preview and Process call existing pipelines and refresh the view.

**Requirements:** R5, R6, R7, KTD-V4, KTD-V7

**Dependencies:** U2

**Files:**
- Modify: `src/atomsHomeView.ts`
- Modify: `src/main.ts` (expose methods or callbacks the view can call: `runDryRun`, `runProcess`, `getUnprocessed`, open settings)
- Possibly thin: `src/preview.ts` (optional export of summary list for in-view preview)

**Approach:**
- On refresh: `getPastDailyNotesWithUnmarkedCaptures` → count + first N capture texts for peek (truncate).
- Waiting card visible iff count > 0; copy mirrors mock.
- **Preview:** either (a) run dry-run and render results list in a bottom sheet / modal section inside the view, or (b) invoke `DryRunPreviewModal`—both preserve Preview-first; prefer (a) if <1 day extra, else (b).
- **Process:** call existing write-path entry used by “process past” command; disable double-submit while running; Notice on failure; refresh library + count on success.
- ⋯ menu items: Backfill, Test connection, Open settings (existing commands/`setting` tab).

**Patterns:** `main.ts` command handlers; do not duplicate classify logic.

**Test scenarios:**
- Unit: card visibility pure function `shouldShowWaitCard(count)`  
- Integration (manual): seed unprocessed daily → card shows; after process, card gone and new atom in list  
- Error: process fails → Notice, card remains, no crash  

**Verification:** AE2 holds on desktop; Preview never writes; Process writes atoms/markers only via existing path.

---

### U4. Version, architecture note, install

**Goal:** Ship **0.4.0**; document the view in architecture module map; install to Remote Vault for Sync.

**Requirements:** R8, KTD-V8

**Dependencies:** U1–U3

**Files:**
- Modify: `package.json`, `manifest.json`, `versions.json`
- Modify: `docs/architecture.md` (module map + UI surface)
- Optional: one-line in settings privacy/version already shown

**Approach:** Bump versions consistently; architecture row for `atomsHomeView.ts` / `atomsHomeData.ts`.

**Test expectation:** none — version/docs; run full `npm test` regression.

**Verification:** Settings/manifest show 0.4.0; tests pass; plugin loads with view registered.

---

## Verification Contract

| Gate | Pass |
|---|---|
| Unit tests | U1 scenarios + any U2/U3 pure helpers |
| Full suite | Existing tests still green |
| Manual clear | AE1: empty waiting, library lists atoms |
| Manual pending | AE2: card → Preview (no write) → Process → library updates |
| Manual chips | AE3: Nichita chip + Linked filter |
| Manual open | AE4: row opens atom |
| Mobile | Leaf usable in phone drawer; primary buttons ≥44px hit area in CSS |

---

## Definition of Done

- [ ] U1–U4 complete  
- [ ] Design handoff R1–R9 satisfied or explicitly deferred in Open Questions  
- [ ] No Links/People/Status tabs  
- [ ] Dry-run/write still only two write types (atoms + markers)  
- [ ] Version 0.4.0 installed where the user tests Sync  

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| View is “just a file list” | Chips + source day + generated-by filter (R3, KTD-V3) |
| Preview reimplementation drift | Call shared dry-run function; single classify path |
| Theme clash with hard-coded black | Prefer CSS variables (`--background-primary`, etc.) with mock hierarchy |
| Vault event churn | Debounce refresh 200–300ms |
| Mobile leaf discoverability | Ribbon icon + command + optional open on first install once |

**Depends on:** existing `daily`, `preview`, `write`, `classify`, `render` pipelines (shipped).

---

## Open Questions (implement-time only)

1. Exact preview host: in-view sheet vs reuse `DryRunPreviewModal` (KTD-V4).  
2. Ribbon icon vs command-only on mobile.  
3. Cap library at 50 vs 100.  

---

## System-Wide Impact

- New user-facing surface; commands remain for power users.  
- Auto-run unchanged; view is observational + manual process entry.  
- People-linking chips light up naturally via body wikilinks—no new model contract.

---

## Sources & Research

- `docs/design-handoff/atoms-view/README.md` + `index.html` (product authority)  
- `docs/architecture.md` (zero-guilt UI, two write types, mobile-primary)  
- `src/main.ts`, `src/preview.ts`, `src/write.ts`, `src/render.ts`, `src/daily.ts`  
- External research skipped: local Obsidian plugin patterns + locked design; ItemView is standard Plugin API  

---

## Alternatives Considered

| Approach | Why not |
|---|---|
| Dual Recent / Links tabs | Adversarial: Links goes dead; mini-CRM risk |
| Admin-first Inbox / Dry-run / Status tabs | Feels like a console; rejects Apple-simple product identity |
| Dashboard note + Dataview only | No process affordance; not plugin-owned trust UX |
| Full custom mobile app | Out of scope; Obsidian is the host |

---

## Deferred to Follow-Up Work

- Links tab with “new backlinks this week”  
- Task/noise history section  
- Rich in-view multi-step preview editor (per-item accept/reject)  
- Workspace layout auto-save  
