---
title: "feat: Continue an existing atom (home + classify parent)"
date: 2026-08-04
type: feat
status: active
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
issue: 16
branch: feat/continue-atom
lane: full
---

# Continue an existing atom — Plan

**Issue:** [#16](https://github.com/taihartman/obsidian-atoms/issues/16)  
**Branch:** `feat/continue-atom`  
**Lane:** full  
**Version:** bump patch on ship (e.g. 0.6.68)

## Goal capsule

From an open atom on home, one quiet **Continue** starts a new capture that becomes a **new child atom** with a reason-bearing link to the parent. Parent body bytes never change. Human free-edit of the parent file stays outside classify.

## Product authority

| Source | Role |
|---|---|
| Issue #16 | Product stance (A + B UX entry) |
| This plan | Implementation authority |
| Ask write path (#127) | Same spirit for MCP; reuse relation→reason templates |
| Constitution | Body sacred; create-only atoms; no free-form append |

### Settled decisions (session)

| ID | Decision | Provenance |
|---|---|---|
| SD1 | **Full handoff + classify parent** — not thin daily-seed-only, not Ask-style direct create from home | session-settled: user locked recommended shape |
| SD2 | Continue = new atom + reason link; never rewrite parent; never recategorize modal | issue #16 |
| SD3 | Capture stays in dailies; no second compose UI on home | constitution + session |

---

## Product contract

### Actors

| ID | Actor |
|---|---|
| A1 | Vault user on desktop / iOS / Android Obsidian with Atoms home |
| A2 | Classify (BYOK or Plus `/v1/classify`) |

### Requirements

| ID | Requirement |
|---|---|
| R1 | From **home-open atom**, primary quiet action **Continue** (label exact). |
| R2 | Continue sets **device-local pending parent** `{ title, path, setAt }` and opens **today’s daily** for writing. |
| R3 | While pending: home shows one quiet chip `Continuing [[Title]]` + **Cancel** (clears pending). No recategorize UI. |
| R4 | Next Process / Preview / auto-run that classifies a capture while pending is set injects **parent into classify context** (BYOK + Plus). |
| R5 | Atom verdict → **new child file only**; child carries reason link to parent (`continues` default; model may choose `revises` / `contradicts` / `adds detail to`). |
| R6 | **Parent file body bytes unchanged** by pipeline (no `vault.modify` on parent). |
| R7 | **Deterministic safety net:** if atom verdict and no link targets parent title, post-enrich adds `continues [[Parent]]` (reuse Ask reason templates). |
| R8 | **Title must not equal parent title** — prompt + post-check; if model reuses parent title, force a distinct title (suffix) before planWrite so collision does not leave capture stuck. |
| R9 | Clear pending parent after the **first** capture successfully classified while pending was set (atom **or** noise/task — one shot). Cancel also clears. |
| R10 | Library + land peak open atoms **in home** (so Continue is reachable), with existing **Open in vault** still available on open. |
| R11 | Human editor edits to parent remain outside recategorize / Update-as-continue loop. |
| R12 | Dual-surface parity: plugin `SYSTEM_PROMPT` + `contextForPlus` + plus `classifyTemplate.mjs` stay parity-tested for new parent guidance. |
| R13 | Desktop + iOS + Android same plugin code; device-local pending (not `data.json`). |

### Key flows

| ID | Flow |
|---|---|
| F1 | Library/land → home-open atom → **Continue** → today opens → chip shows → user writes bullet → Process today (or tomorrow auto) → child atom + link; parent MD unchanged; chip gone |
| F2 | Continue → **Cancel** → chip gone; next Process has no parent context |
| F3 | Continue parent A → write → classify noise → pending cleared; no child required |
| F4 | Model omits parent link → safety net still writes `continues [[Parent]]` on child |
| F5 | Model reuses parent title → forced distinct title → create succeeds |
| F6 | Open in vault from home-open still works; free-edit parent does not clear/set pending |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Parent "Sleep debt is real" → Continue → capture "actually it might be cortisol" → new atom linked `revises` or `continues` that title; parent body identical byte-for-byte |
| AE2 | Continue then Cancel → Process unrelated capture → no forced parent link |
| AE3 | Pending set, model returns atom with empty links → child still has continues parent |
| AE4 | No primary UI asks to recategorize the old atom |

### Scope

**In**

- Home-open Continue + chip + Cancel  
- Library/land → `openAtomInHome`  
- Device-local pending parent store  
- `VaultContext` optional continue parent + prompt/context blocks  
- Write/preview path pass-through; clear pending  
- Title collision with parent guard + link safety net  
- Tests + version bump + CONCEPTS touch  
- Screenshots under `docs/qa/screenshots/continue-atom/`

**Out**

- Soft-hide superseded atoms  
- Thread preview list under parent (“Also: …”) beyond existing citator  
- Infer continue without user Continue (classify may still infer links as today)  
- Direct create modal (Ask `continue_atom` already covers agent path)  
- Re-process human-edited parent as continue  
- Append into arbitrary notes  
- Multi-parent queue (one pending parent only)

### Open questions (defaults locked)

| Q | Default |
|---|---|
| Process today friction | User uses existing **Process today** / wait for past-day auto; chip copy mentions writing in today |
| Relation default | `continues`; model may upgrade |
| Same title | Forbidden; force distinct |
| Which capture consumes pending | First capture classified in a Process/Preview/auto batch while pending set (document order of that run) |
| Last-opened as default parent without Continue | **No** |

---

## Planning contract

### Key technical decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | `LS_CONTINUE_PARENT = "atoms-continue-parent"` JSON `{ title, path, setAt }` via `loadLocalStorage` / `saveLocalStorage` | Device-local; matches resume/mind-change pattern; not settings sync |
| KTD2 | Pure module `src/home/continueParent.ts` (read/write/clear/parse) + unit tests | Home + write path share without UI import cycles |
| KTD3 | Extend `VaultContext` with optional `continueParent?: { title: string; path?: string }` | Typed; flows through BYOK messages + `contextForPlus` |
| KTD4 | Prompt section **Continue parent (when present):** must link parent with continues/revises/contradicts/adds detail; never reuse parent title; never rewrite parent body | Dual-surface parity phrases in `CLASSIFICATION_PARITY_PHRASES` |
| KTD5 | User context block when set: `### Continue parent\nTitle: …\nPath: …` in stable or capture-adjacent volatile block (prefer **volatile with capture** so cache titles stay valid) | Parent is per-capture intent, not vault-stable |
| KTD6 | `ensureContinueParentLink(result, parentTitle)` after enrich, before planWrite — if atom and no link.note matches parent (case-insensitive trim), unshift Ask-template `continues [[Title]]` | Robust acceptance; no body invent |
| KTD7 | `ensureContinueDistinctTitle(result, parentTitle)` — if atom title equals parent (ci), set title to `${parent} — continued` or first ~8 words of capture + disambiguator if still colliding | Avoids collision stuck state |
| KTD8 | Clear pending in write path after **successful classify** of the consuming capture (ok outcome), even if noise; do **not** clear on classify hard-fail (retry keeps parent) | One-shot intent; failures retry |
| KTD9 | Preview dry-run: inject parent context when pending; **do not clear** pending on preview-only | Preview must not burn the handoff |
| KTD10 | Library row + land peak: `openAtomInHome` instead of `openPathInVault`; open surface keeps Open in vault | R10 |
| KTD11 | Reuse `relationReasonProse` from askOutbox (extract shared pure helper if needed) — single template SSOT | Don’t fork continues/revises strings |
| KTD12 | Plus: `contextForPlus` includes `continueParent` when set; server template renders same block; parity test | R12 |
| KTD13 | No schema field change for parent (context-only) — keeps structured output stable | Smaller blast radius |
| KTD14 | Version bump manifest + package + versions.json; Settings shows new version | CLAUDE versioning |

### Architecture

```
Home-open atom
  → Continue → save LS pending parent → open today’s daily
  → chip while pending (Cancel → clear)

Process / auto-run / Preview
  → read pending
  → for each capture: ctx.continueParent = pending?
  → classifyCapture (BYOK | Plus)
  → ensureContinueDistinctTitle + ensureContinueParentLink
  → planWrite create_atom only (parent untouched)
  → on first successful classify in write path: clear pending
```

### Units of work

| Unit | Deliverable | Done when |
|---|---|---|
| U0 | Claim: STATUS + draft PR + this plan committed | PR open draft |
| U1 | `continueParent.ts` + tests (parse/roundtrip/clear) | unit green |
| U2 | Shared relation reason helper (extract from askOutbox if duplicated) | unit green |
| U3 | VaultContext + buildMessagesRequest + contextForPlus + prompt + plus template + parity phrases/tests | dual parity green |
| U4 | `ensureContinue*` pure fns + classify/write wiring; clear rules; preview no-clear | unit + write path tests |
| U5 | Home UI: Continue, chip, Cancel; library/land → home-open | typecheck + vault smoke |
| U6 | Version bump, CONCEPTS, architecture one-liner if needed | docs |
| U7 | Shipping tail: simplify → code-review → compound → world-class-qa + screenshots | PR ready |

### Test plan (evidence)

| Check | How |
|---|---|
| LS roundtrip / clear | unit |
| ensure link / distinct title | unit |
| context block present when parent set | unit on buildMessagesRequest / contextForPlus |
| Dual-surface parity | existing parity tests extended |
| Write path clears pending once | unit with mock LS |
| Preview does not clear | unit |
| Parent body unchanged | vault smoke: hash parent before/after Process today |
| Continue chip + button | vault screenshot home-open + chip |
| npm test / typecheck / build | CI local |

### Risks

| Risk | Mitigation |
|---|---|
| Today not processed by default | Chip copy; user Process today; accept next-day auto |
| Plus ignores unknown context keys | Explicit template render + dogfood Plus path if key available |
| Library open-in-home surprises power users | Keep Open in vault one tap away |
| Pending stuck forever | Cancel; clear on successful classify; optional stale clear >7d (nice-to-have, not required) |
| Title force ugly | Prefer model compliance; suffix only as backstop |

### Hot files

- `src/home/continueParent.ts` (new)
- `src/home/atomsHomeView.ts`
- `src/home/atomsHomeData.ts` (chip copy)
- `src/shared/types.ts`
- `src/pipeline/classify.ts`
- `src/pipeline/write.ts` / `preview.ts`
- `src/platform/askOutbox.ts` (extract helper)
- `plus-service/src/classifyTemplate.mjs`
- `test/*`
- `styles.css` (chip if needed)
- `manifest.json` / `package.json` / `versions.json`
- `CONCEPTS.md`

### Non-goals recap

No append zone in parent file · no recategorize modal · no Ask home parity rewrite · no soft-death of old atoms.
