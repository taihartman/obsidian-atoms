---
title: "feat: Land, then remember (post-write peak + named connected)"
date: 2026-07-17
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
issue: 71
lane: light
doc_review: "2026-07-17 light headless (coherence + feasibility + design; ce-doc-review skill unreachable in this harness)"
---

# feat: Land, then remember (post-write peak + named connected)

## Goal Capsule

After Process, Update notes, or auto-run (when home is open), the home **peak is proof of filing**, not a vague resurface card. While that peak is up, **no resurface card** competes. Connected resurface later may appear only when it can **name its reason** (seed title or real person hub). Soft hubs alone (e.g. `People`) do not invent kinship. Empty resurface is preferred over opaque “Related to something recent.”

**Authority hierarchy**

1. This plan (implementation)
2. Interactive mock `docs/design-handoff/atoms-view/land-then-remember.html` (visual + product locks)
3. Session-settled decisions (below)
4. Constitution: second brain not feed; one hero; quiet by default

**Stop when:** AE1–AE8 pass in unit tests + demo/test vault smoke; version bumped; Issue #71 closable via PR.

**Product Contract preservation:** Product Contract assembled in this bootstrap from session-settled decisions + mock locks. Unchanged relative to mock unless noted under KTDs.

---

## Product Contract

### Actors

| ID | Actor |
|---|---|
| A1 | Vault owner on Atoms home (desktop or phone) after manual Process / Update |
| A2 | Owner with automatic filing who has home open when auto-run completes |
| A3 | Owner who later opens a calm home (no write peak) |

### Requirements

| ID | Requirement |
|---|---|
| R1 | **Write peak sources:** Process, Update notes, and auto-run completion share the same land-peak product law when Atoms home can show it. |
| R2 | **Land card content:** Done status card with headline (0 / 1 / many atoms), short body, optional landed title rows (max 3 + “and N more in Recent”), primary dismiss control **Done**. |
| R3 | **0 atoms:** Markers-only (or “Nothing new filed”) copy; no empty title list. Still a land peak if the run finished with markers or a clear done state; no resurface under that peak. |
| R4 | **1 atom:** Singular copy (“Filed 1 note”). **Many:** first 3 titles + “and N more in Recent.” |
| R5 | **Freeze during Done:** While land peak / `runPhase === "done"` with land payload is showing, **no resurface card at all** (not only connected). One hero. |
| R6 | **Dismiss:** Tap **Done**, or open a landed title (open atom in vault or home-open). Clears land peak for this visit → calm home; resurface may pick only after dismiss (or on a later calm open of home). |
| R7 | **Named bridge or silence:** Connected cue kicker always has an object. Never ship opaque sole kicker “Related to something recent.” Soft index hubs alone (`People` and same class) do not qualify a connected card. |
| R8 | **Kicker forms:** Prefer **Because of {seedTitle}** when the edge is seed-title strength; **Also about {hub}** when the strongest honest edge is a real person hub chip. |
| R9 | **Bridge line (v1):** Optional whisper under snippet (`Same thread · via {X}`). Card body opens the memory atom. Bridge line opens seed or hub when path resolvable; if not resolvable, omit tappable bridge (kicker still names). |
| R10 | **Priority after dismiss:** Unchanged: mind-change → on-this-day → named connected → quiet. Freeze does not demote mind-change after dismiss. |
| R11 | **No section shelf label:** No “For you” heading (already #68 / shipped path). Cue kicker only. |
| R12 | **Version + tests:** User-visible version bump; pure unit tests for land copy, connected match floor + kickers, dismiss does not require network. |
| R13 | **Vault lanes:** Agent dogfood only on demo/test vault. No unattended Remote Vault process. |

### Key flows

| ID | Flow |
|---|---|
| F1 | Home → Process → land peak (titles) → Done → calm; optional named connected later |
| F2 | Home → Update notes → land peak (updated titles) → Done |
| F3 | Auto-run completes with home leaf open → land peak (same shell) + existing Notice ok |
| F4 | Auto-run with home closed → Notice only; next home open is calm (no forced land peak) |
| F5 | Calm home: connected only if named; else silence or other cue |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Process creates 2 atoms → land card “Filed 2 notes” + both titles; no resurface card while Done up. |
| AE2 | Process all noise/task → “Nothing new filed” (or markers-only) + no title list; no resurface under Done. |
| AE3 | Process 12 atoms → 3 title rows + “and 9 more in Recent.” |
| AE4 | Dismiss Done → resurface may appear; if connected, kicker is not “Related to something recent.” |
| AE5 | Shared only `[[People]]` → no connected candidate. |
| AE6 | Older atom shares person hub Alex with a recent seed → kicker names seed or “Also about Alex.” |
| AE7 | Update notes finishes → land card “Updated N notes” (not Process wording); freeze holds. |
| AE8 | Auto-run with home open + atoms filed → land peak shown; without home open → Notice only. |

### Scope boundaries

**In**

- Land peak model + home UI for done phase
- Wire Process / Update / auto-run (home open) to pass land payload
- Connected match floor + named kickers (+ optional bridge line)
- Tests, version, STATUS/Issue #71, light architecture note if needed

**Out**

- Body prose fallback `Related to [[X]].` in `formatLinkProse` (separate quality claim)
- Person hub invite (#60)
- Renaming section to Memories/Recall (label already dropped)
- Graph UI, settings for relatedness
- Changing mind-change / on-this-day selection logic beyond freeze during Done

### Session-settled decisions

| Decision | Class | Rejected | Why |
|---|---|---|---|
| No “For you” shelf; kicker only | session-settled: user-directed — chosen over Memories/Recall rename | Social-feed smell; Apple bar = no shelf | Already shipping via #68 path; this plan assumes no shelf |
| Peak-end: land filing, not resurface | session-settled: user-approved — chosen over copy-only kicker fix | Timing is the “weird times” bug | Mock *Land, then remember* |
| Freeze = no For you/resurface during Done (all cues) | session-settled: user-approved — chosen over freeze connected+quiet only | One hero; Done is the peak | Mock locks |
| Dismiss = Done or open landed title | session-settled: user-approved | Auto-timeout only | Explicit control |
| Named connected or silence; deny People-only | session-settled: user-approved — chosen over keep “Related to something recent” | Trust | Apple / Music “Because you…” |
| Same law for Process, Update, auto-run (home open) | session-settled: user-approved | Process-only | Parity |

---

## Planning Contract

### Key technical decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | Pure `LandPeak` + copy helpers in `src/home/landPeak.ts` (or extend `runProgress.ts` if tiny). View holds `landPeak: LandPeak \| null` while `runPhase === "done"`. | Testable copy; home stays thin |
| KTD2 | `finishRun(summary, landPeak?)` sets done + landPeak then `refresh()`. Resurface already gated on `runPhase === "idle"` — keep that; land UI lives in done progress card. Dismiss calls `clearRunUi()` + clear landPeak + `render()`/`refresh()`. | Minimal change to existing phase machine |
| KTD3 | Build land rows from write report: atom entries with `write.atomCreated` (and collision-skipped optional: **v1 = created only**). Path from `planned.action` when kind is create_atom / skip_existing. Meta: first person-like link chip or “Linked · {note}” short. | Matches “what just landed” |
| KTD4 | Update notes: extend `RefreshReport` with `updatedItems: { title, path }[]` (or titles only). Land source `"update"`. | AE7 |
| KTD5 | Auto-run: if any Atoms home leaf open and `atomsCreated > 0` (or markers > 0), call same `finishHomeRun` with landPeak; else Notice only (existing). | F3/F4 |
| KTD6 | Connected: enrich `listConnectedCandidates` to attach `connectedSeedTitle?`, `connectedVia?`, `connectedKind?: "seed" \| "person"`. Drop candidates with no nameable non-soft edge. Soft denylist: `people` (+ case-insensitive). Prefer title-strength edges over chip-only. | R7–R8 |
| KTD7 | UI kicker: if `cue === "connected"`, use `connectedKicker(card)` not bare `cueLabel("connected")`. Remove or repurpose string “Related to something recent” so it never ships as sole kicker. | Opacity fix |
| KTD8 | Bridge line v1: render if `connectedVia` or seed title present; open via `openLinkText` / path lookup best-effort; failures → Notice “note not found” (existing pattern). | Mock bridge tap |
| KTD9 | Preview dry-run **does not** use land peak (still preview modal / done summary only). | Preview writes nothing |
| KTD10 | Long titles: CSS ellipsis on land rows + connected kicker (one line). | Mock long state |

### Technical design (directional)

```
Process/Update/auto-run (home)
  → buildLandPeak(report, source)
  → finishRun(summary, landPeak)
  → render: statusCard done + land rows + Done button
  → (resurface suppressed: runPhase !== idle)

Dismiss Done | open landed title
  → clear landPeak + clearRunUi
  → idle render → pickResurface (named connected only)
```

**Connected edge rank (implementer guidance, not code):**

1. Candidate title appears on seed chips, or seed title on candidate chips → seed-strength → kicker `Because of {seedTitle}`
2. Shared chip not soft-hub → person-strength if chip looks like person hub title in vault hubs set when available; else still name via + seed → `Also about {via}` or `Because of {seedTitle}` with whisper via
3. Soft hub only → exclude

Hubs set: prefer existing person hub titles from context when cheap; else denylist soft titles only.

### Assumptions

- A1. `runPhase === "done"` already suppresses resurface (`atomsHomeView` idle gate). Land peak is primarily **richer done UI + dismiss**, not a new freeze bit — unless idle is cleared unexpectedly; if vault refresh clears done, **preserve landPeak across refresh until dismiss** (loadData must not wipe landPeak).
- A2. #68 drop section label is on branch or master; do not reintroduce “For you” heading.
- A3. Issue #71 is the claim; PR body `Closes #71`.

### Sequencing

U1 pure land copy → U2 connected pure → U3 home wire + main → U4 styles → U5 version + STATUS

### Risks

| Risk | Mitigation |
|---|---|
| refresh() wipes landPeak | Store landPeak on view; loadData must not clear it; only dismiss/clearRunUi |
| Auto-run double UI (Notice + land) | Allowed per mock; keep Notice short |
| Connected over-filtering → always quiet | Prefer seed-title hits; unit tests with Alex hub fixture |
| Update report lacks paths | Extend report in same PR |

### Open questions

| Q | Blocking? | Default if deferred |
|---|---|---|
| Include collision-skipped atoms in land list? | deferred | **No** — created only (KTD3) |
| Auto-run land when 0 atoms but markers > 0? | deferred | **Yes** show markers-only land if home open and markers > 0 |
| Bridge open vs home-open atom | deferred | Open in vault leaf (existing `openPathInVault`) |

---

## Implementation Units

### U1. Land peak pure helpers

**Goal:** Copy + payload shaping for 0/1/many and sources.

**Files:** `src/home/landPeak.ts` (new), `test/landPeak.test.ts` (new)

**Patterns:** `src/home/runProgress.ts` pure helpers style

**Requirements:** R2–R4, R12

**Test scenarios:**

- 0 atoms → headline/body with no list rows; markers count in body when provided
- 1 atom → singular “Filed 1 note”
- 12 atoms → 3 display rows + moreCount 9
- source `update` → “Updated N notes” wording
- source `autorun` reuses process wording or “Automatic filing finished” body line from mock

**Execution note:** test-first for pure functions.

---

### U2. Named connected match floor

**Goal:** Connected candidates name seed/via or are dropped; soft hubs alone never qualify.

**Files:** `src/resurface/resurface.ts`, `test/resurface.test.ts`

**Patterns:** existing `listConnectedCandidates`, `cueLabel`

**Requirements:** R7–R8, R10, AE4–AE6

**Test scenarios:**

- Shared only `People` → no connected
- Seed title on older atom chips → connected with `connectedSeedTitle`
- Shared `Alex` (not soft) → connected with via and/or seed
- `connectedKicker` / render helper never returns “Related to something recent” as sole label when candidate is shown
- Priority order still mind-change → on-this-day → connected → quiet

---

### U3. Home land UI + plugin wiring

**Goal:** Done card shows land peak; dismiss; Process/Update/auto-run pass payload; landPeak survives refresh.

**Files:** `src/home/atomsHomeView.ts`, `src/plugin/main.ts`, `src/pipeline/write.ts` (export helpers if needed), `src/pipeline/refreshAtoms.ts` (updatedItems), maybe thin `landPeakFromWriteReport` in landPeak.ts

**Patterns:** `statusCard` / `button` / `actionRow` UI kit; existing `finishRun` / `beginRun`

**Requirements:** R1, R5–R6, R9, R11, F1–F4, AE1–AE3, AE7–AE8

**Test scenarios:**

- Pure: landPeakFromWriteReport maps created atoms only
- Pure: landPeakFromRefreshReport maps updated items
- If view unit tests exist, optional; else demo vault manual in verification

**Execution note:** When opening landed title, dismiss peak then open path (or open then dismiss).

---

### U4. Styles for land list + kicker ellipsis

**Goal:** Land rows match mock (grouped list inside done card); long title ellipsis.

**Files:** `styles.css`

**Requirements:** R2, KTD10

**Test scenarios:** visual on demo vault / mock parity glance (no pixel test required)

---

### U5. Version, claim, architecture one-liner

**Goal:** 0.6.14 (or next after master), STATUS #71, short architecture note under home resurface.

**Files:** `package.json`, `manifest.json`, `versions.json`, `STATUS.md`, `docs/architecture.md` (one sentence)

**Requirements:** R12

---

## Verification Contract

```bash
npm test
npm run typecheck
npm run build
```

**Manual (demo/test vault only):**

1. Process 2 captures → land card + no resurface → Done → calm
2. Process 0-atom batch if available → markers-only land
3. Update notes strip → land Updated N
4. Confirm connected either silent or named after dismiss (seed vault with shared person hub)

**QA:** Scoped world-class-qa after implement (home write peak + calm connected). Screenshots under `docs/qa/screenshots/land-then-remember/` if UI PR.

---

## Definition of Done

- [ ] All U1–U5 complete
- [ ] AE1–AE8 covered by tests and/or manual smoke
- [ ] No “Related to something recent” as sole connected kicker in ship UI
- [ ] No resurface under land Done peak
- [ ] `Closes #71` on PR; STATUS cleared on merge
- [ ] Phone install after master (`npm run phone`) when user-visible

---

## Appendix

### Origin / design

- Mock: `docs/design-handoff/atoms-view/land-then-remember.html`
- Diagnosis: connected cue + post-write home refresh felt like opaque “related” at wrong peak
- Related chrome: #68 drop For you section label

### Issue

- GitHub #71
