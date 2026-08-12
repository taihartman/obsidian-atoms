---
title: "Hub list preview - Plan"
date: 2026-08-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
type: feat
issue: 422
branch: feat/hub-list-preview
module: pipeline/hub-projection
tags:
  - hub-projection
  - preview
  - settings
  - unsorted
mock: docs/design-handoff/hub-list-preview/mock.html
---

# Hub list preview - Plan

## Goal Capsule

**Objective.** When the user turns on **List atoms on hub notes** (or asks to refresh), show a calm **preview** of which hub notes would get atom lists and how many atoms land under each heading — including a toggle to include or skip **Unsorted** — before any bulk vault write.

**Product authority.** Hub projection (0.6.89+): managed block, hard links, human prose sacred, default off. Constitution write-type (d). Voice: `docs/voice.md` (plain, no guilt). Mock: `docs/design-handoff/hub-list-preview/mock.html`.

**Open blockers.** None.

**Product Contract preservation:** unchanged. OQ1–OQ3 resolved as KTD7–KTD9.

**Lane.** Light feature (modal + dry-run split of existing fullRegen).

---

## Product Contract

### Summary

Replace the silent full regen on toggle-on with a **dry-run preview modal**. The user sees hub titles, section counts, and an **Include Unsorted** control, then chooses **Update lists** or **Not now**. Normal Process/Update after the setting is on stays quiet (no preview every run).

### Problem Frame

Toggle-on full regen can rewrite many hub notes at once with only a Notice after the fact. Users want to see impact first and choose whether messy uncategorized atoms should appear under Unsorted or stay off the shelf.

### Users

- People turning on list-on-hubs for the first time (old vault with Movies / person hubs).
- People who want a deliberate refresh without Process.

### Requirements

| ID | Requirement |
|----|-------------|
| R1 | Turning **List atoms on hub notes** from off → on opens a **preview** before bulk write (not only a Notice after). |
| R2 | Preview is a **dry-run**: no hub `vault.modify` until the user confirms **Update lists**. |
| R3 | Preview lists each hub that would change: title, total linked atoms in the plan, breakdown by section (including Unsorted when included). |
| R4 | **Include Unsorted** toggle (default **on**): when off, atoms that would only land under Unsorted are omitted from the write plan for that pass; hubs that would only gain Unsorted with no sectioned atoms are not written. |
| R5 | When Include Unsorted is on, behavior matches today’s placement (section match + Unsorted fallback). |
| R6 | Primary actions: **Update lists** (run write) and **Not now** (close without bulk write). |
| R7 | **Not now:** setting stays **on** so Process/Update can still project going forward; only the one-shot bulk fill is skipped. Copy must say lists will fill as you file, or they can refresh later. |
| R8 | Empty dry-run (nothing to write): calm empty state + **Done** (no fake Update). |
| R9 | Settings gains a secondary control **Refresh hub lists…** (only meaningful when setting is on) that opens the same preview. |
| R10 | Normal Process / Update / backfill / invite projection paths do **not** open the preview. |
| R11 | Already-on upgrade Notice (list hubs disclosure) stays separate; it does not replace this preview. |
| R12 | Copy is plain language (no “projection,” “regen,” “managed block”). Human writing above the list stays yours. |
| R13 | Mobile-usable: scrollable list, ≥44px targets, works on phone Settings. |
| R14 | Body sacred; no change to atom bodies; delimiter rules unchanged. |

### Key Decisions

| ID | Decision | Notes |
|----|----------|-------|
| K1 | Preview modal on off→on, not silent full regen | session-settled: user-approved — chosen over bare confirm and over always-silent magic. |
| K2 | One global **Include Unsorted** for the pass | session-settled: user-directed (categorize control) — chosen over per-atom checkboxes v1. |
| K3 | Include Unsorted defaults **on** | Matches current product; opt-out for clean shelves only. |
| K4 | Not now keeps setting on | Avoids fight with the toggle; bulk is optional. |
| K5 | Same preview for Refresh hub lists | One surface. |
| K6 | No per-hub or per-atom include in v1 | YAGNI; task gravity. |

### Scope Boundaries

**In**

- Dry-run summary from existing plan machinery.
- Modal + Include Unsorted + Update / Not now.
- Wire toggle-on + Refresh entry.
- Voice-safe copy.

**Deferred**

- Per-atom or per-hub checkboxes.
- Live preview of full markdown block (wikilink dump).
- Background/cancel mid-write progress UI beyond a simple Notice after confirm.
- Changing ongoing Process defaults for Unsorted (preview toggle is pass-only unless we later add a setting).

**Outside product identity**

- Task/checklist gravity; forcing users to triage every atom.
- Rewriting hub human prose.

### Acceptance Examples

| ID | Example |
|----|---------|
| AE1 | Off → on with pre-linked Movies atoms → modal shows Movies + section counts → Update → managed block written; Notice optional. |
| AE2 | Same, Include Unsorted off → only section-matched atoms written; pure-Unsorted-only hubs skipped. |
| AE3 | Not now → no hub files changed; setting remains on; later Process still projects. |
| AE4 | Nothing to write → empty state, no Update. |
| AE5 | Setting already on → Refresh hub lists opens same modal. |
| AE6 | Process with setting on does not open modal. |

### Success Criteria

- [ ] AE1–AE6 on throwaway vault.
- [ ] Unit tests for dry-run filter (Unsorted off) and empty plan.
- [ ] Settings copy plain; no jargon in modal.
- [ ] Phone-width usable.

### Dependencies / Assumptions

- `planHubProjection` / fullRegen planning can feed a summary without write.
- Pass-only Unsorted filter does not require a permanent settings field unless we later want “never Unsorted” as default.

### Outstanding Questions

| ID | Question | Status |
|----|----------|--------|
| OQ1 | Persist Include Unsorted | **Resolved → KTD7** pass-only |
| OQ2 | Hub list cap in modal | **Resolved → KTD8** scroll all; soft cap 40 rows then “and N more” |
| OQ3 | After Update UX | **Resolved → KTD9** close modal + Notice |

### Risks

| Risk | Mitigation |
|------|------------|
| Large vault slow dry-run | Modal opens with “Preparing…” then fills; same cost as today’s fullRegen compute |
| User confuses Not now with off | Copy: setting stays on; lists fill as you file |
| Double Unsorted heading | Already fixed; filter must use same section keys as `renderGeneratedBlock` |

### Constitution / CONCEPTS

- No constitution change required (still opt-in managed block).
- CONCEPTS: add **Hub list preview** when implementing.

---

## Planning Contract

### Technical Approach

Split today’s `runHubProjectionForHubs({ fullRegen: true })` into:

1. **`buildHubProjectionFullPlan`** (or `dryRunHubProjectionFull`) — load atoms + hubs, return pure `planHubProjection` result **plus** a **summary DTO** for the UI (no `vault.modify`).
2. **`applyHubProjectionPlan`** — take planned writes and modify files (existing write loop).
3. **`filterPlanExcludeUnsortedOnly`** — pure: when Include Unsorted is off, drop entries that would only land in Unsorted; drop hub writes that become no-op / empty after filter.

UI: `HubListPreviewModal` patterned on `PlusSignInConfirmModal` (safe action first = Not now; confirm = Update lists). Copy extracted for unit tests without DOM.

Settings: replace direct `runHubProjectionFullRegenNotice` on off→on with `openHubListPreview({ reason: "toggle-on" })`. Add **Refresh hub lists…** button row when setting is on.

### Key Technical Decisions

| ID | Decision | Notes |
|----|----------|-------|
| KTD1 | Dry-run reuses fullRegen membership + hub load; summary derived from `plan.writes` + entry sections | No second discovery stack |
| KTD2 | Unsorted-off filter is pure on plan entries / next content, not a permanent setting | KTD7 |
| KTD3 | Modal owns toggle state; on Update, pass `includeUnsorted` into apply | |
| KTD4 | Not now: no writes; setting already saved on by toggle handler before modal | Order: save on → open modal |
| KTD5 | Refresh entry only when `enableHubProjection === true` | R9 |
| KTD6 | Visual fidelity to mock: title, body, hub rows, chips, checkbox, foot actions | `docs/design-handoff/hub-list-preview/mock.html` |
| KTD7 | Include Unsorted is pass-only (not `data.json`) | OQ1 |
| KTD8 | List hubs in modal scroll; if >40 hubs, show first 40 + “and N more” | OQ2 |
| KTD9 | Close modal then Notice on success | OQ3 |
| KTD10 | Plugin version bump on ship | user-visible |

### Codebase Patterns

- Modal: `src/settings/plusSignInConfirmModal.ts` (copy extract + Not now first)
- Full regen today: `main.ts` `runHubProjectionFullRegenNotice` + `runHubProjectionForHubs`
- Plan pure: `planHubProjection` / `HubProjectionPlan`
- Settings rows: `settingRow` in `settings.ts`
- Tests: `test/hubProjection.test.ts`, `test/runHubProjection.test.ts`

### Dependencies and Risks

| Item | Handling |
|------|----------|
| Toggle saves before modal | If user Not now, setting stays on (R7) — intentional |
| Dry-run cost | Same as current fullRegen; optional later cache |
| `kind` / R3c skips | Summary should distinguish “would write” vs brake-skipped (optional chip “not ready”) |

---

## Implementation Units

### U1. Pure dry-run summary + Unsorted filter

**Goal.** Build preview DTO and filter without vault writes.

**Requirements.** R2–R5, R8, AE2, AE4

**Files.**
- Modify: `src/pipeline/runHubProjection.ts` — extract load+plan; export dry-run + apply + filter
- Create: `test/hubListPreview.test.ts` (or extend `runHubProjection.test.ts`)

**Approach.**
- `export type HubListPreviewRow = { hubTitle: string; path: string; total: number; sections: Array<{ name: string; count: number }> }`
- `export type HubListPreviewSummary = { rows: HubListPreviewRow[]; empty: boolean }`
- `summarizeHubProjectionPlan(plan, hubs): HubListPreviewSummary` from changed writes + entry buckets (reuse section keys from plan entries / projected content parse, or pass buckets from plan stage)
- `filterPlanIncludeUnsorted(plan, hubs, includeUnsorted: boolean): HubProjectionPlan` — when false, remove Unsorted-only atoms from entries and re-`projectHubMarkdown`, or filter writes whose only new bullets are under Unsorted
- `buildFullHubProjectionPlan(app, opts): Promise<{ plan; summary }>` — today’s fullRegen load path without modify
- `applyHubProjectionPlan(app, plan): Promise<{ wrote; errors }>` — modify loop

**Execution note.** Test-first on filter + summarize with fixture plan/hubs.

**Test scenarios.**
- Happy: plan with Gift Ideas + Unsorted → summary counts both.
- Happy: includeUnsorted false → Unsorted counts gone; hub with only Unsorted dropped from writes.
- Edge: empty plan → `empty: true`.
- Edge: section-only hub unchanged when Unsorted off.

**Verification.** `npx vitest run test/hubListPreview.test.ts test/runHubProjection.test.ts`

---

### U2. HubListPreviewModal + copy

**Goal.** Calm modal matching mock; assertable copy.

**Requirements.** R3, R6–R8, R12–R13, AE1–AE4

**Dependencies.** U1 (summary type)

**Files.**
- Create: `src/settings/hubListPreviewModal.ts`
- Create: `test/hubListPreviewModal.test.ts` (copy helpers only if DOM-free)
- Optional CSS: `styles.css` only if needed beyond Obsidian defaults

**Approach.**
- `hubListPreviewCopy`: title “Update hub lists?”; body lines per R12; empty body; Include Unsorted label/desc; Not now / Update lists / Done
- `HubListPreviewModal extends Modal`: constructor `(app, summary, opts: { onConfirm: (includeUnsorted: boolean) => void; onDismiss: () => void })`
- Render hub rows + chips; checkbox default on; re-render counts when toggled **or** accept that toggle only affects apply (simpler: recompute summary client-side from two precomputed summaries, or filter live)
- Prefer: modal receives full plan+hubs or dual summaries; toggle switches displayed summary
- Safe first: Not now → `onDismiss`; Update → `onConfirm(includeUnsorted)`; empty → Done only
- `onClose` without answer → dismiss

**Test scenarios.**
- Copy strings stable (no jargon).
- Manual: mock visual parity (implementer checks mock).

**Verification.** Unit copy tests; typecheck.

---

### U3. Wire Settings toggle + Refresh + main apply

**Goal.** Replace silent full regen; add Refresh.

**Requirements.** R1, R7, R9–R11, AE1, AE3, AE5, AE6

**Dependencies.** U1, U2

**Files.**
- Modify: `src/plugin/main.ts` — `openHubListPreview`, rewrite full regen path
- Modify: `src/settings/settings.ts` — toggle + Refresh row
- Modify: `test/settings.test.ts` — row name if new control appears in grammar list
- Bump: `package.json`, `manifest.json`, `versions.json`

**Approach.**
- `openHubListPreview({ source: "toggle-on" | "refresh" })`: if setting off and source refresh, no-op; show Preparing Notice or empty modal body until `buildFullHubProjectionPlan` resolves; open modal with summary
- On confirm: `filter` if needed → `applyHubProjectionPlan` → Notice (KTD9) + errors
- On dismiss: nothing else
- Toggle off→on: save settings true → `openHubListPreview({ source: "toggle-on" })` (not `runHubProjectionFullRegenNotice`)
- Keep `maybeShowHubProjectionListDisclosure` separate (R11)
- Refresh: `settingRow` name “Refresh hub lists” / button “Preview…” only when enabled; or always visible disabled when off — prefer show only when on to reduce noise

**Test scenarios.**
- Settings grammar includes Refresh when applicable (or document as dynamic).
- Integration: optional light test that open path does not call modify until confirm (mock).

**Verification.** `npm test` settings subset; `npm run build`

---

### U4. QA + CONCEPTS

**Goal.** Dogfood AE1–AE6; vocabulary.

**Requirements.** Success criteria

**Dependencies.** U3

**Files.**
- Create: `docs/qa/2026-08-10-feat-hub-list-preview-qa.md`
- Modify: `CONCEPTS.md` — Hub list preview
- Screenshots optional under `docs/qa/screenshots/hub-list-preview/`

**Approach.** Throwaway vault: Movies + linked atoms; toggle on → preview → Update / Not now / Unsorted off.

**Verification.** QA doc + AE checklist.

---

## Verification Contract

| Gate | Action |
|------|--------|
| Unit | filter, summarize, copy, existing hub projection tests |
| Build | `npm run build` |
| Manual | mock + AE1–AE6 test_vault |
| Ship | version bump; PR `Closes #<issue>` if claimed |

---

## Definition of Done

- [ ] U1–U4 complete
- [ ] AE1–AE6 evidence
- [ ] No silent full regen on toggle-on
- [ ] Process path unchanged (no modal)
- [ ] Voice-safe copy
- [ ] Hard claim if shipping PR

---

## Execution notes for ce-work

- Test-first U1 filter/summarize.
- Do not change Process/Update projection call sites except shared apply helper if extracted.
- Match mock structure; Obsidian theme vars where easy.
