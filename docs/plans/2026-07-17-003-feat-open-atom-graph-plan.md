---
title: "feat: Open atom graph (dynamic closed neighborhood)"
date: 2026-07-17
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
issue: 83
lane: light
doc_review: "2026-07-17 multi-persona + user best-judgment resolve (Apple-class defaults)"
deepened: 2026-07-17
---

# feat: Open atom graph (dynamic closed neighborhood)

## Goal Capsule

Give the user a **one-tap clean second-brain graph**: every **atom** plus only notes that **actually share an edge with an atom** (1-hop links + backlinks). Old vault hairball (notes linking only to each other) stays out. No hardcoded hub folders. Command only — not a home hero, not a custom mini-graph product.

**Authority hierarchy**

1. This plan (implementation)
2. Session-settled product decisions (below)
3. Constitution: intelligence in the graph; home is library + resurface, not a second browser
4. Design handoff non-goal: mini graph explorer on Atoms home stays out of v1

**Stop when:** AE1–AE8 pass (unit + vault smoke); command works on desktop and mobile consumers; version bumped; claim Issue closable via PR.

**Product Contract preservation:** Bootstrap from session (no prior brainstorm file). Product Contract is the source of truth for WHAT.

**Summary:** Command `Atoms: Open atom graph` builds a **dynamic closed neighborhood** from `metadataCache`, opens Obsidian **Global Graph**, applies a search filter for that set (best-effort internal API + honest fallback). Frontmatter **`source`** is provenance, not a graph claim — do not seed neighbors from it alone.

---

## Product Contract

### Actors

| ID | Actor |
|---|---|
| A1 | Vault owner with filed atoms who wants a clean graph without pre-atoms noise |
| A2 | Owner on phone (Sync) who runs the same command when Graph is available |

### Requirements

| ID | Requirement |
|---|---|
| R1 | **Command:** Register palette command **Open atom graph** (plugin id prefix `atoms:` as usual). |
| R2 | **Node set (dynamic):** Include all markdown notes under configured `atomFolder` that count as atoms (same stamp rule as library: prefer `generated-by: linker`; tolerate folder markdown if product already does). |
| R3 | **1-hop expansion:** For each atom path, add resolved **outbound** link targets and **inbound** backlink sources from `metadataCache`. No folder allowlists (`People`, etc.). |
| R4 | **Source demotion:** Do **not** add a neighbor solely because of frontmatter `source: [[daily]]` (pipeline provenance). Body/backlink edges to a daily still count. |
| R5 | **Open Global Graph** with a filter that keeps only the closed set (or best compact equivalent). User must not hand-type `path:Atoms`. |
| R6 | **Empty vault:** If no atoms, Notice and do not open a confusing empty/wrong graph. |
| R7 | **Fallback honesty:** If filter application via internal Graph APIs fails, still open Graph with `path:{atomFolder}` only and a clear Notice — never silent whole-vault graph. When the **capped** query uses folder term or drops external neighbors, Notice states what was lost (external neighbors omitted; full atom folder may include non-stamp files). |
| R8 | **Surface:** Command only in v1. No Atoms home primary control, no mini-graph ItemView, no settings for hub folders. Optional **one README sentence** under existing feature list (discoverability without home chrome). |
| R9 | **Version:** User-visible version bump (`manifest.json` + `package.json` + `versions.json`). |
| R10 | **Vault lanes:** Agent smoke on demo/test vault only; no unattended Remote Vault rewrites. |
| R11 | **Graph unavailable:** If Global Graph cannot be opened (e.g. environment without Graph), Notice “Graph view unavailable” and stop — do not fake a substitute UI in v1. |

### Key flows

| ID | Flow |
|---|---|
| F1 | Command palette → Open atom graph → Global Graph shows atoms + 1-hop only |
| F2 | Atom links to person hub outside `Atoms/` → hub node appears |
| F3 | Two old notes link only to each other → neither appears unless an atom edges them |
| F4 | Atom has only `source` daily in FM, no body links → daily **not** forced in solely via source |
| F5 | Zero atoms → Notice, no false success |
| F6 | Cap/fallback path → Notice explains folder fallback or omitted neighbors; never silent whole vault |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Vault with 3 linker atoms under `Atoms/`, mutual `[[wikilinks]]` → graph filter includes all 3; unrelated vault note with no atom edge absent. |
| AE2 | Atom body links `[[Alex]]` (hub outside folder) → `Alex` in set. |
| AE3 | Note `Junk A` links only to `Junk B` (no atom) → neither in set. |
| AE4 | Atom frontmatter `source: "[[2026-07-01]]"` only, no body link to that daily → daily **not** in set from source alone. |
| AE5 | Atom body mentions `[[2026-07-01]]` → that daily **is** in set. |
| AE6 | Zero atoms → Notice; graph not opened as success. |
| AE7 | Command registered and invokable via CLI/`obsidian command` when Obsidian open on test vault. |
| AE8 | Cap/fallback: Notice mentions omitted neighbors and/or full folder; graph is not whole-vault unfiltered. |

### Scope boundaries

**In**

- Pure closed-set builder + graph search query builder (unit-tested)
- Open Global Graph + apply filter (best-effort) + fallback Notice
- Command registration
- Version bump
- Optional one README sentence for discoverability

**Out**

- Custom force-graph / Canvas / Bases mini explorer
- Home UI control / ribbon icon (unless free later amend)
- Hardcoded hub folders or multi-hop (2+)
- Changing classification, link quality, or atom write path
- Settings UI for edge policy (future toggle “include source dailies” only if demanded)
- Replacing Local Graph for single-note exploration
- Teaching users to keep `Atoms/` pure via new settings — product already lands only linker atoms there; stray files are edge

### Session-settled decisions

| Decision | Class | Rejected | Why |
|---|---|---|---|
| Isolation from pre-atoms hairball is the job | session-settled: user-directed — chosen over “pretty global graph” | Old notes not written for links | User pain |
| Dynamic 1-hop if atom touches it | session-settled: user-directed — chosen over atoms-folder-only forever | Bridges are real second-brain edges | User: “why wouldn’t we show it if an atom touches it?” |
| No hardcoded hub/path allowlists | session-settled: user-directed — chosen over `path:People` config | Vault layouts differ; wants dynamic | User |
| Demote FM `source` only (not “all dailies”) | session-settled: user-approved — chosen over include all source dailies | Source is provenance stamp; calendar spiderweb | Agent rec + user “dynamic” |
| Command only v1 | session-settled: user-approved — chosen over home control | Home non-goal mini-graph; keep chrome quiet | Scoping |
| Stock Global Graph + filter, not custom engine | session-settled: user-approved — chosen over mini-graph product | Cost, mobile, design non-goal | Session product take |

---

## Planning Contract

### Key technical decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | Pure module e.g. `src/graph/atomGraphSet.ts` (name flexible): `collectAtomSeedPaths`, `expandOneHop`, `buildClosedNeighborhood`, `toGraphSearchQuery` — no DOM, injectable metadata/link maps for tests. | Test-first; matches `landPeak` / `resurface` purity style |
| KTD2 | Seeds = markdown under `settings.atomFolder` with library stamp rule (`isGeneratedAtomContent` / same as `listAtomLibraryEntries` intent). Prefer reusing `isUnderAtomFolder` + generated-by check from `atomsHomeData`. | One definition of “atom file” |
| KTD3 | Outbound: from `metadataCache.resolvedLinks[atomPath]` keys (and/or `getFileCache` links resolved via `getFirstLinkpathDest`). Inbound: `metadataCache.getBacklinksForFile(file)` when available; else invert `resolvedLinks`. Unresolved targets: no file node (Obsidian graph same). | Public cache APIs; no folder hardcode |
| KTD4 | **Source demotion:** when collecting outbound from an atom, skip link targets that appear **only** as frontmatter `source` (YAML wikilink), not as body links. Implement via FM parse of `source:` or `frontmatterLinks` + body link set — pure helper unit-tested. | R4 / AE4–AE5 |
| KTD5 | Search query for set **S** (closed neighborhood): **prefer** `path:"p1" OR path:"p2" OR …` over every path in S (exact filter). **Compact optimization** only when `|S|` is large or query exceeds a char/term cap: `path:"{atomFolder}"` **OR** path terms for external neighbors still in the capped list; Notice when any member of S was dropped. Cap default: implementer-chosen constant (e.g. ~2–4k chars or ~80 path terms) — document in code comment. | Exact S matches R2–R3; folder-only term can over-include non-seed files in `Atoms/` |
| KTD6 | Open graph: `workspace.getLeaf` + `setViewState({ type: "graph", active: true })` (or `executeCommandById("graph:open")` then find leaf). Apply filter via **documented-if-any / best-effort internal** fields on the graph view (search box setValue + refresh). Wrap in try/catch; on failure → R7 (`path:atomFolder` + Notice). Notice copy is calm, specific, one breath — Apple-class: say what happened, not how to debug plugins. | No public Graph filter API in `obsidian.d.ts` |
| KTD7 | Do **not** write temp vault notes to “trick” Local Graph. | Vault sacred; agent lanes |
| KTD8 | Command id e.g. `open-atom-graph`, name **Open atom graph**. Wire in `registerAtomsCommands`. | Existing command pattern |
| KTD9 | Version bump patch (0.6.x → next). | CLAUDE.md versioning |
| KTD10 | Optional later (out of v1): setting “include source dailies”; home secondary control; 2-hop. | Scope freeze |

### Technical design (directional)

```
command Open atom graph
  → seeds = atoms under atomFolder (generated-by)
  → for each seed: outbound links (minus source-only) + backlinks
  → S = seeds ∪ neighbors (existing TFiles only)
  → query = path:atomFolder OR path:neighbor…
  → open Global Graph leaf
  → apply query to graph search (best-effort)
  → if apply fails: Notice + apply/open with path:atomFolder only (never whole-vault as success)
```

Implementer verifies live Obsidian graph view shape once (1.12.x) and pins the smallest internal touch that works; keep internals in one function so breakage is one place.

### Assumptions

- A1. Global Graph exists on desktop and most mobile Obsidian builds; if missing → R11 Notice, no substitute UI.
- A2. `metadataCache` is ready when user invokes command (same class of gate as other interactive commands; no auto-run cold path).
- A3. Hard claim (Issue + STATUS + draft PR) before `ce-work` per collab — plan does not skip multiplayer.
- A4. Default `Atoms/` is effectively linker-owned; folder-fallback over-include of stray files is rare. Prefer exact path-OR of S; Notice only when fallback/cap actually fires.
- A5. Discoverability via command palette + optional README line is enough for v1; no home icon.

### Sequencing

U1 pure set + query → U2 open graph + filter apply → U3 command + version → verify

### Risks

| Risk | Mitigation |
|---|---|
| Internal Graph filter API changes | Single adapter; fallback Notice + `path:atomFolder`; AE still documents fallback |
| Huge neighborhood → query too long | Cap + folder-only fallback + Notice count |
| Source demotion false positive strips real daily body links | Only skip when target is **solely** source FM, not in body link set (AE5) |
| Users expect edges *among* non-atom neighbors | Closed set still shows neighbor↔atom; neighbor↔neighbor only if both in S (both touch atoms). Document in Notice/help one-liner if needed |
| Graph opens whole vault on failure | R7 forbids silent whole-vault as “success” |
| `path:atomFolder` over-includes non-seed files in folder | KTD5 prefers exact path-OR of set S when small; folder term only as compact optimization when folder is atom-pure or after cap (see KTD5) |

### Open questions

| Q | Blocking? | Default (settled by doc-review best judgment) |
|---|---|---|
| Fallback when filter apply fails | settled | **`path:atomFolder` + calm Notice** — never whole-vault as success |
| Non-`generated-by` in atom folder | settled | **Same as library list** (prefer stamp) |
| Ribbon / home control | settled | **No** v1 |
| Discoverability | settled | **Command + optional README one-liner** |
| Cap numbers | settled | Implementer constant (~2–4k chars or ~80 path terms); document in code |
| Mobile without Graph | settled | **R11 Notice only** — no custom graph |

---

## Implementation Units

### U1. Closed neighborhood pure helpers

**Goal:** Deterministic seed + 1-hop set and search query string; source demotion; caps.

**Files:** `src/graph/atomGraphSet.ts` (new; or `src/plugin/atomGraphSet.ts` if graph/ disallowed by layout — prefer small `src/graph/`), `test/atomGraphSet.test.ts` (new)

**Patterns:** `src/home/atomsHomeData.ts` (`isUnderAtomFolder`, `isGeneratedAtomContent`); pure resurface tests style

**Requirements:** R2–R4, AE1–AE5 (logic)

**Test scenarios:**

- Happy: 2 seeds, mutual link → set size 2
- Outbound hub outside folder → included
- Junk↔junk only → excluded
- Source-only FM daily → excluded; body link to same daily → included
- Query: seeds under folder produce `path:` folder term; external neighbor appears as path term
- Cap: many neighbors → fallback query is folder-only (or truncated policy as coded) with flag for Notice

**Execution note:** test-first pure functions; inject link maps rather than real `App` where possible.

---

### U2. Open Global Graph + apply filter

**Goal:** Workspace open of graph view; apply search query; fallback Notice.

**Files:** `src/graph/openAtomGraph.ts` (new) or thin methods on plugin; may stay next to U1

**Patterns:** leaf `setViewState` / command execute patterns in `main.ts` / home open path

**Requirements:** R5–R7, F1, AE6–AE7

**Test scenarios:**

- Unit: if adapter injectable, mock leaf apply success/fail → correct Notice path
- Manual/CLI: open command on test vault with demo atoms → filter visible or fallback Notice (evidence in PR)

**Execution note:** smoke-first on real Obsidian after pure tests green; pin internal property names discovered live.

---

### U3. Command registration + version

**Goal:** Palette command; version bump; no home chrome; optional README line.

**Files:** `src/plugin/commands.ts`, `src/plugin/main.ts` (if method on plugin), `manifest.json`, `package.json`, `versions.json`, optionally `README.md` (one sentence)

**Requirements:** R1, R8–R9, R11, F5, F6

**Test scenarios:**

- Command id present in register list
- Version files consistent
- AE6 empty atoms Notice (integration or pure guard before open)
- AE8 Notice path when fallback/cap simulated in pure/unit if flags exposed

---

## Verification Contract

```bash
npm test
npm run typecheck
npm run build
# Obsidian open on test vault:
./scripts/install-to-vault.sh
obsidian command id=atoms:open-atom-graph   # exact id after impl
```

- Unit: `test/atomGraphSet.test.ts` covers AE1–AE5 logic
- CLI/manual: AE6–AE7 on demo or test vault
- PR: Test plan checkboxes only after runs; UI evidence = screenshot of filtered graph optional but preferred under `docs/qa/screenshots/open-atom-graph/`

---

## Definition of Done

- [ ] U1–U3 complete; tests green; typecheck/build green
- [ ] Command opens filtered (or documented fallback) graph for closed neighborhood
- [ ] Source-only dailies not forced in; body-linked dailies are
- [ ] Fallback/cap Notices are calm and specific (R7, AE8); never silent whole-vault success
- [ ] No home mini-graph; no hardcoded People path
- [ ] Version bumped; hard claim Issue + STATUS + draft PR with `Closes #N`
- [ ] Light shipping tail as needed (simplify if messy; compound if durable learning on Graph internals)

---

## Appendix

### Research notes (planning)

- Official `obsidian.d.ts` has **no** public Graph filter API; community pattern is open `type: "graph"` leaf + set internal search control.
- Product already surfaces graph intelligence via link chips, connected resurface, citator, mind-change — this feature is **isolation / proof**, not a new primary loop.
- Design handoff `docs/design-handoff/atoms-view/README.md` lists mini graph explorer as v1 non-goal — honored by command-only stock Graph.

### External research

Skipped: strong local command/metadata patterns; Graph filter is app-internal and must be verified live (execution-time), not planned as fixed signatures.
