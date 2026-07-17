---
title: "feat: Smart quality refresh (local polish + ranked refile)"
date: 2026-07-17
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/design-handoff/atoms-view/smart-quality-refresh-brief.md
lane: standard
doc_review: "pipeline mode — LFG headless; session-settled KTDs from design thread"
---

# feat: Smart quality refresh (local polish + ranked refile)

## Goal Capsule

When filing improves, older atoms catch up **without forcing the user through 800 API refiles**. One home verb (**Update**) runs **free local link polish first**, then **Process-parity AI refile only on a ranked slice** (batch cap unchanged). Capture body stays sacred. Copy never guilts with “800 outdated.”

**Authority hierarchy**

1. This plan
2. Session-settled decisions (below)
3. Design brief: `docs/design-handoff/atoms-view/smart-quality-refresh-brief.md`
4. Existing Update notes UX shell: `docs/design-handoff/atoms-view/update-linking.html` + plan 015
5. Constitution: body sacred, no auto API spend, Process queue outranks refresh

**Stop when:** AE1–AE10 pass (unit); home strip/confirm/land copy matrix covered; version bumped; existing Update path still works for refile.

**Product Contract preservation:** Bootstrap from session + brief (no requirements-only brainstorm file). Product Contract is WHAT.

**Summary:** Extend Update notes into a two-phase refresh: (A) offline prose parse → weak/junk/self repair → rewrite link region without bumping `atoms-quality`; (B) existing `classifyCapture` refile for up to `UPDATE_NOTES_BATCH_LIMIT` atoms ranked by product value among `q < CURRENT`. Honest land copy for polish-only vs mixed vs refile-only.

---

## Product Contract

### Actors

| ID | Actor |
|---|---|
| A1 | Vault owner with a large atom library (hundreds) who wants better links without a migration project |
| A2 | Phone user on Sync who taps Update once and expects calm progress, not a bill for the whole vault |

### Requirements

| ID | Requirement |
|---|---|
| R1 | **One verb:** Keep home **Update** (no rename to Refresh in v1). Same strip → light confirm → progress → land shell. |
| R2 | **Button-only:** Free polish and AI refile run only when the user confirms Update. Never on vault open / auto-run. |
| R3 | **Phase A — local polish (free):** For linker-generated atoms with weak/junk/self-link problems in the link-prose region, rewrite reasons / strip junk using existing `linkQuality` helpers. **Body (capture region) sacred.** Do **not** set `atoms-quality` to `CURRENT`. Optional stamp `links-polished: YYYY-MM-DD` when prose changes. |
| R4 | **Phase B — ranked refile (API):** Among atoms with `generated-by: linker` and `atoms-quality < CURRENT`, select up to `UPDATE_NOTES_BATCH_LIMIT` by ranker (below). Run existing Process-parity refresh (`classifyCapture` → plan/apply). Stamp `atoms-quality = CURRENT` on success only. |
| R5 | **Ranker (AI candidates):** Higher priority first: (1) zero outbound wikilinks in link region, (2) only junk/weak reasons after triage, (3) broken `[[targets]]` (basename not in vault markdown titles), (4) title appears in current resurface hard-pair / on-this-day candidate set when cheap to know — else skip this signal without blocking, (5) recently in library recents / higher mtime, (6) older mtime. Stable tie-break: path. |
| R6 | **Strip visibility:** Show Update strip when Phase A work exists **or** any `q < CURRENT` refile debt exists. **Never** show raw “800 notes” as the primary body. Large N: “Older notes can use the new linking. We’ll start with the ones that matter most.” Small N (≤15): keep near-current copy. |
| R7 | **Confirm honesty:** If Phase B will call the API this run, confirm mentions Anthropic key + batch size. If only Phase A (no refile candidates), confirm says free / no key required and must not require API key. |
| R8 | **Land honesty:** Polish-only → wording like “Cleaned up older link wording” / count polished. Refile-only → existing Updated N. Mixed → both. Failures stay eligible; never claim AI when only polish ran. |
| R9 | **No new phone mock** for v1. Reuse update-linking shell; copy-only changes. |
| R10 | **Out of v1:** Settings “Refresh all with AI” + Batches cost gate; `atoms-quality-locked`; free polish on Home open; raising batch cap; renaming Update → Refresh. |
| R11 | **Version bump** when user-visible behavior ships (`manifest.json` + `package.json` + `versions.json`). |
| R12 | **Process still wins:** Unprocessed capture wait card remains dominant; Update strip stays secondary. |

### Key flows

| ID | Flow |
|---|---|
| F1 | Large library, many weak stickers, few below CURRENT → Update → free polish many → little or no API → honest land |
| F2 | Many `q < CURRENT` → Update → polish free first → AI refile top 15 ranked → stamp those; strip may return next session |
| F3 | Only polishable, all at CURRENT → Update without API key works; key not required |
| F4 | Nothing to polish and no `q < CURRENT` → strip hidden / Nothing to update |
| F5 | API failures mid-refile → polished notes stay polished; failed refiles remain eligible |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Atom with capture + `\n\npreference about [[Alex]].` → polish rewrites reason; capture unchanged; `atoms-quality` unchanged if already set. |
| AE2 | Atom with strong `revises [[X]]` only → polish no-op on that link. |
| AE3 | Self-link reason / junk reason → stripped by polish path (same rules as `stripSelfReferentialLinks`). |
| AE4 | 20 atoms `q < CURRENT`, ranker prefers empty-link over strong-linked older notes for the 15 AI slots. |
| AE5 | Confirm copy for refile batch mentions key + N; polish-only confirm does not require key. |
| AE6 | Land after polish-only does not say “Updated … to current quality” as if full refile. |
| AE7 | Strip body for eligibleCount ≥ 50 uses large-N calm copy (no “800” fear framing). |
| AE8 | `runUpdateNotes` without key still runs when only polish work exists. |
| AE9 | Round-trip: `formatLinkProse(parseLinkProse(formatLinkProse(links)))` preserves notes + non-weak reasons for fixture links. |
| AE10 | Existing refile fixtures in `test/refreshAtoms.test.ts` still pass (or updated to dual-phase without losing Process parity on Phase B). |

### Scope boundaries

**In**

- `parseLinkProse` + local polish planner/applier
- Triage + ranker pure functions
- Orchestrator: polish then refile
- Home strip/confirm/land copy matrix
- `runUpdateNotes` key gate only when refile needed
- Unit tests + version bump
- Brief remains durable origin

**Out**

- Batches API bulk refile / Settings power path
- Quality lock frontmatter
- New design mock HTML
- Auto polish on open
- Changing Process classify path (except shared helpers already used)
- Bumping `CURRENT_ATOMS_QUALITY` solely for this feature

### Session-settled decisions

| Decision | Class | Rejected | Why |
|---|---|---|---|
| Local polish first, API only on ranked residue | session-settled: user-directed | Full refile of all eligible every time | Cost/time at ~800 atoms |
| Offline is sticker triage, not graph intelligence | session-settled: user-approved | Calling local rewrite “as smart as Process” | Honesty / trust |
| System absorbs 800; never guilt “Update 800” | session-settled: user-directed | Debt counter as primary UX | Apple bar brief |
| No new full UI mock v1 | session-settled: user-approved | New phone mock for triage UI | Shell already settled |
| Free polish only on Update confirm, not Home open | session-settled: user-approved | Silent file churn on open | Surprise / trust |
| Do not stamp `CURRENT` for pure local polish | session-settled: user-directed | Claiming Process parity without model | Plan 015 parity rule |
| Keep verb **Update** v1 | session-settled: user-approved | Rename to Refresh this ship | Continuity |
| Settings bulk Batches power path deferred | session-settled: user-approved | Ship bulk migration UI now | Scope |
| Report conflicts: if evidence invalidates a KTD, stop — do not suppress | standing | — | LFG / ce-plan contract |

---

## Planning Contract

### Key technical decisions

| Decision | Choice | Rationale |
|---|---|---|
| Prose parse strategy | Sentence/segment split on `. ` + extract `[[wikilinks]]`; each segment → `{ note, reason }` with note = primary link (prefer last embedded `[[note]]` matching formatLinkProse shape) | Matches writer; unit-tested round-trip |
| Polish apply | Rebuild body via `formatAtomBody(capture, { verdict:atom, title:old, tags:keep, links:polished })` + preserve FM except optional `links-polished` | Body sacred; titles/tags untouched in Phase A |
| Orchestrator home | Extend `refreshAtoms.ts` (`runSmartRefresh` or evolve `runRefreshEligibleAtoms`) rather than new package | Single refresh owner |
| Ranker inputs | Pure function over `{ path, title, content, quality, mtime, vaultTitles:Set, brokenLinkCount, linkStats }` | Testable; vault titles from existing list helpers |
| Resurface signal | Best-effort: if cheap import would create cycle (`home`/`resurface` → pipeline banned), **omit** resurface rank boost in v1 | Dependency rule: pipeline never imports home/resurface |
| Eligibility count for strip | `countPolishable + countBelowCurrent` (or unified “work remains”) without double-counting for display N when both | Calm large-N copy uses tier, not exact debt |
| API key gate | `runUpdateNotes`: if refile candidates after triage empty, skip `requireApiKey` | R7/AE8 |
| Progress UX | Phase A: optional fast “Polishing…” or silent; Phase B: existing N of M | Phone calm |

### Architecture / module map

```
Update confirm
  → triage library (pure scan)
  → Phase A: polish apply (vault.modify) for polishable set
  → Phase B: list ranked refile ≤ 15 → classifyCapture path (existing)
  → report { polished, updated, failed, … }
  → land + strip refresh
```

| Path | Role |
|---|---|
| `src/pipeline/enrich/linkQuality.ts` | Existing weak/junk/self helpers (reuse) |
| `src/pipeline/parseLinkProse.ts` **or** functions in `linkQuality`/`render` | `parseLinkProse` + round-trip tests |
| `src/pipeline/refreshAtoms.ts` | Orchestration, ranker, polish apply, list/count |
| `src/pipeline/atomQuality.ts` | Keep CURRENT rules; optional polish date helper |
| `src/home/atomsHomeData.ts` | Strip/confirm copy matrix |
| `src/home/landPeak.ts` / `runProgress.ts` | Honest summaries |
| `src/plugin/main.ts` | Key gate + report wiring |
| `test/parseLinkProse.test.ts` | Round-trip + weak fixtures |
| `test/smartRefresh.test.ts` **or** extend `refreshAtoms.test.ts` | Orchestration + ranker |
| `test/atomsHomeData.test.ts` / land tests | Copy matrix |

### Risks

| Risk | Mitigation |
|---|---|
| Prose parse loses multi-link sentences | Prefer conservative: one link per segment; leave unparsed prose alone if zero wikilinks |
| Generic rewrite spam (“durable fact about”) | Only rewrite `isWeakLinkReason`; never touch strong; land copy says “wording” not “AI” |
| Strip never clears if only polish without CURRENT | Show strip for polishable OR q&lt;CURRENT; polish removes polishable debt; refile clears quality debt |
| pipeline → resurface import cycle | No resurface rank boost in v1 |
| Hand-edits overwritten on refile | Existing confirm copy; lock deferred |

### Implementation units

#### U1 — Parse link prose (pure)

**Files:** `src/pipeline/render.ts` or new `src/pipeline/parseLinkProse.ts`; `test/parseLinkProse.test.ts`

**Does:** `parseLinkProse(prose: string): ClassificationLink[]` inverse of `formatLinkProse` for common shapes.

**Tests:** AE9 fixtures; empty; single weak; multi-link; supersession phrase; bare `Related to [[X]]`.

#### U2 — Local polish plan/apply (pure + vault)

**Files:** `src/pipeline/refreshAtoms.ts` (+ helpers); tests

**Does:** From atom content: extract capture + prose → parse links → `improveClassificationLinks` + `stripSelfReferentialLinks` → if changed, rebuild markdown (capture + new prose), preserve title/tags/created/source/quality, set optional `links-polished`.

**Tests:** AE1–AE3; quality stamp unchanged; capture unchanged.

#### U3 — Triage + ranker (pure)

**Files:** `src/pipeline/refreshAtoms.ts` or `src/pipeline/refreshTriage.ts`; tests

**Does:** Classify atom as polishable / refile-candidate / neither. Rank refile candidates per R5 (without resurface boost if cycle risk).

**Tests:** AE4; empty links beat strong-linked; broken targets boost; stable sort.

#### U4 — Orchestrator + plugin gate

**Files:** `src/pipeline/refreshAtoms.ts`, `src/plugin/main.ts`

**Does:** `runSmartRefresh` / evolved `runRefreshEligibleAtoms`: Phase A all polishable (reasonable cap e.g. 500 file ops per run to avoid UI freeze — sequential vault.modify), Phase B ranked refile ≤ 15. Report fields: `polished`, `updated`, `failed`, `updatedItems`, optional `polishedItems`. `runUpdateNotes` requires key only if Phase B work exists.

**Tests:** AE5/AE8 via unit with fixtures; integration-style pure report assembly.

#### U5 — Home copy + land honesty

**Files:** `src/home/atomsHomeData.ts`, `src/home/landPeak.ts`, `src/home/runProgress.ts`, tests

**Does:** Large-N strip body; confirm variants; land/summary for polish-only / mixed / refile / nothing.

**Tests:** AE6–AE7; string snapshots or exact equality.

#### U6 — Version + docs touch

**Files:** `package.json`, `manifest.json`, `versions.json`; optional one line in `docs/architecture.md` Update notes row; brief already exists

**Does:** Patch version bump; architecture note that Update is dual-phase.

### Test scenarios (aggregate)

- Weak reason polish without quality bump
- Strong reason untouched
- Junk/self strip
- Rank empty-link over older strong
- Polish-only no API key
- Refile still stamps CURRENT
- Round-trip parse/format
- Large-N strip copy
- Land polish-only wording
- Regression: existing refreshAtoms tests

### Dependencies / sequence

U1 → U2 → U3 → U4 → U5 → U6

### Execution direction

Test-first for pure parse/triage/ranker; characterization of existing `runRefreshEligibleAtoms` before evolving the orchestrator.

---

## Assumptions

- Resurface rank boost deferred to avoid `pipeline` → `resurface` imports (architecture rule).
- Phase A processes all polishable up to a high safety cap (500) per confirm; residual polishable remains for next Update.
- No bump to `CURRENT_ATOMS_QUALITY` in this feature.
- Verb stays **Update**.

---

## Open questions (non-blocking — defaults)

| Q | Default for implementer |
|---|---|
| Exact polish cap | 500 modifies / run |
| `links-polished` FM field | Yes, when prose changes |
| Progress during polish | Single progress total = polishCount + refileCount, or polish silent then refile N of M — prefer **combined progress** if simple |

---

## Confidence

Implementation-ready for LFG: patterns exist (refreshAtoms, linkQuality, home copy). Main novelty is prose parse + dual-phase orchestration. Residual product risk: rewrite quality — mitigated by honesty in land copy.
