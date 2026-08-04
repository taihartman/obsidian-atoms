# Systems architect read — Obsidian Atoms

**Date:** 2026-08-04  
**Lens:** world-class systems architecture (Apple-grade product systems discipline + senior product-platform engineering)  
**Basis:** live code + `docs/architecture.md` + graphify map (2050 nodes) — not marketing claims  
**Version context:** 0.6.61 · `isDesktopOnly: false`

---

## One-line verdict

You have built a **real product system** with rare load-bearing taste — not a chatbot bolted onto notes — and the architecture *mostly* protects that taste. The risk now is not “wrong idea”; it is **mass concentration and contract sprawl** as three surfaces (plugin, Plus/MCP, marketing) share one fragile intelligence contract.

---

## What is genuinely world-class

### 1. Invariants over features

Most note apps accumulate features until trust dies. You did the opposite: a short constitution that makes entire classes of bugs illegal.

| Invariant | Why it is systems-grade |
|---|---|
| **Body sacred** | Model surface is title/tags/links only. Context-rot defense is structural, not prompt hope. |
| **Sentinel idempotency** | Processed state is plugin-owned markers, not “any wikilink.” Re-run over a marked vault = 0 API calls is a *system* property. |
| **Today excluded by default** | Mid-day capture stays quiet. Product psychology encoded as a hard pipeline gate. |
| **Four write types only** | Flat atoms, append markers, user-initiated atom refresh, delimiter-bounded hub blocks. No folder intelligence. No unbounded append into hand notes. |
| **Ask mirror = copy, not second vault** | Vault SSOT, vault→cloud only, device-local hash evidence, Sync now for orphans. Multi-device safety is *designed*, not patched. |

Apple-grade systems work looks like this: **the hard thing is named once and enforced everywhere**, not negotiated per feature.

### 2. Safety envelope is real

```
past dailies → parse → classify (never authors body) → dry-run gate → write (Atoms/ + marker)
```

Hard stops are not comments; they are path structure: past-only selection, plan/apply split, collision body-gate, auto-run silent + egress ack, hub projection off by default, Update notes never auto.

That is how you ship AI next to a user’s life without becoming a rewrite engine.

### 3. Seams that actually hold

Verified against live imports:

- **`pipeline/**` does not import UI packages** — filing core stays testable and headless.
- **`ui/` is dumb primitives** — no feature imports. Correct composition model.
- **`planWrite` / `applyWrite`** — Preview and Process share one planner; dry-run fidelity is architecturally possible.
- **`ContextProvider` / shortlist** — context is a seam, not a rewrite when BM25 landed.
- **Enrich as pure post-pass** — rescue → people → media → entity → link quality choke through `applyClassificationQuality`.
- **Ask planner pure** (`askMirror.ts`) vs I/O in plugin — correct split for a dangerous sync path.

### 4. Product shape matches platform constraints

- Mobile-first home leaf, `isDesktopOnly: false`, network via `requestUrl` where CORS matters.
- Capture deliberately *not* owned by the plugin (Shortcut → inbox → drain → daily). That is restraint: you refused to build a second capture app inside Obsidian.
- Intelligence lives in **links + titles**, not folders — graph-native, vault-native, Sync-native.

### 5. Process architecture (often ignored, here load-bearing)

Hard claim, STATUS, constitution-by-PR, vault lanes (demo vs Remote Vault), product dogfood honesty. Multiplayer + agents without that would have already destroyed the product. Treat process as part of the system — you already do.

---

## Where it is not yet world-class

### 1. Mass concentration (the primary systemic risk)

| File | ~Lines | Role |
|---|---|---|
| `src/home/atomsHomeView.ts` | 2331 | Home leaf + invites + vault side-effects + progress + chrome |
| `src/plugin/main.ts` | 2171 | Lifecycle + Process/Update + Ask + outbox + auto-run + home bridge |
| `src/settings/settings.ts` | 1294 | Settings + Plus + Ask status UX |
| `src/pipeline/classify.ts` | 971 | Prompt + schema + HTTP + enrich orchestration |

~4.5k lines in `main` + `atomsHomeView` alone. Layering is mostly right; **orchestration shells ate the product**.

Apple systems lesson: **frameworks stay thin; features compose.** Here the “system frameworks” (plugin shell, home leaf) became the feature dump. Unit tests protect pure edges; **regressions will hide in the untested glue.**

This is not “rewrite everything.” It is a **peel** agenda:

1. Ask sync / outbox orchestration out of `main` → dedicated coordinator module(s).
2. Process / Preview / Update / auto-run run-loop out of `main` → thin commands + one run service.
3. Invite accept + hub side-effects out of `atomsHomeView` → pipeline/home services; view renders models only.
4. Settings stays presentation; Plus/Ask status models leave the tab class.

### 2. ClassificationResult is the blast-radius bomb

One structured object drives:

- client schema + prompt (`classify.ts`)
- server template (`plus-service` classify path)
- enrich chain order
- render frontmatter + markers
- Update notes parity
- person/entity invites
- home surfaces
- MCP-facing shapes / marketing honesty

There is no **versioned contract package** with dual-surface parity tests. Adding a field is a multi-deployable change with silent drift risk (plugin enrich vs hosted classify).

**World-class move:** freeze the wire contract (JSON Schema + golden fixtures) shared or dual-tested client/server; treat enrich order as a named pipeline stage list, not an ad-hoc call chain.

### 3. Doc half-step behind code

`architecture.md` still says `processInbox(dryRun)`. Reality is:

```
Shortcut → Atoms System/Inbox.md → drainInbox → past dailies
  → parseCaptures → runDryRun | runWritePath
       → classifyCapture → planWrite → applyWrite
```

Missing from the module map: `graph/`, full `platform/*` (Ask/Plus), inbox as load-bearing hop, many pipeline modules. Docs that lag become **false confidence** for agents and humans. Keep the constitution short; keep the module map honest after each structural PR.

### 4. Soft coupling leaks

Hard dependency rule holds. Soft edges already pull:

- `settings` → `home` (copy helpers)
- `resurface` / `graph` → `home` data
- **bidirectional** `pipeline` ↔ `platform` (classify needs Plus transport; platform needs classify types)
- `home` deep into pipeline for invite upgrades

None of these are emergencies. Together they mean **“home” is becoming a second plugin root.**

### 5. Triple product surface without one systems owner

| Surface | Job |
|---|---|
| Plugin | Vault SSOT, filing, home, resurface |
| plus-service | Classify proxy, billing, mirror, MCP, OAuth |
| www | Acquisition claims |

Correct product split. Risk is **contract and honesty drift** across three deploys (store backends ×3, MCP tool shapes, tryatoms copy vs actual search/write semantics). Someone (or a CI check) must own **cross-surface parity** the way Apple owns continuity between Watch and Phone.

### 6. Residual multi-device footgun

Ask hashes correctly live device-local. `askMirrorHashes` still exists on synced settings type with migrate-off — good path, bad leftover type surface. Quarantine or delete the field so it cannot be refilled.

---

## Architectural character (honest)

| Dimension | Grade | Note |
|---|---|---|
| Product invariants | **A** | Rare clarity; enforced in code paths |
| Data authority model | **A−** | Vault SSOT + device control plane is correct |
| Module layering | **B+** | Rules real; shells overweight |
| Contract discipline (classify / MCP) | **B−** | Works; not dual-surface hardened |
| Test pyramid | **B+** | Excellent pure pipeline; thin orchestration |
| Cross-platform | **A−** | Mobile-capable by design; capture external is a bet |
| Operability / multiplayer | **A** | Claim/STATUS/vault lanes are serious |
| Doc fidelity | **B** | Constitution strong; runtime diagram stale |
| Scale readiness | **B** | Fine for personal/small multi-device; contract + mass need work before “platform” |

**Overall:** strong **product architecture**, good **subsystem seams**, weak **orchestration and contract packaging**. That is the profile of a successful v1 that is about to feel the cost of success.

---

## What I would protect forever

1. Body sacred + sentinel model + today-default-off.  
2. Flat atoms only; no folder intelligence.  
3. Ask = mirror copy, never reverse body sync.  
4. `pipeline` purity from UI packages.  
5. Dry-run / write planner unity.  
6. Zero-guilt resurface (stream, not queue).  
7. Constitution changes only via PR.

If a feature fights these, the feature loses.

---

## What I would change next (priority order)

### P0 — stop the mass bleed (no product change)

- Extract **Ask mirror coordinator** from `plugin/main.ts`.  
- Extract **filing run service** (Preview/Process/Update/auto-run progress bridge).  
- Split **AtomsHomeView** into: pure models (mostly done in `atomsHomeData`) + thin view + action handlers outside the leaf class.  
- Target: `main` and home view each under ~800–1000 lines without behavior change.

### P1 — freeze the intelligence contract

- Single schema source of truth for `ClassificationResult` (+ people, hub_section — doc is stale).  
- Golden classify fixtures run against plugin path *and* plus-service template.  
- Named enrich stage list with order tests.

### P2 — honest architecture map

- Rewrite runtime diagram to drain + `runWritePath` / `runDryRun`.  
- Module table includes `graph/`, inbox, Ask/Plus platform, dual deployables.  
- Drop or quarantine `askMirrorHashes` on synced settings.

### P3 — only then product depth

Consolidation maps, richer age-on-recall, more cues — **after** orchestration peel. New surface area on 2300-line home is how world-class products become average.

---

## Apple systems parallel (useful, not cosplay)

Think of the product as:

| Layer | Analogy | Your piece |
|---|---|---|
| Persistence SSOT | Photos library on device | Vault `Atoms/` + dailies |
| Index / cloud copy | iCloud Photos optimized | Ask mirror (wipeable, never authority) |
| Capture pipeline | Camera → Photos (not “edit originals by default”) | Inbox drain → classify → markers |
| Intelligence | on-device / Private Cloud Compute boundaries | BYOK vs Plus; body never leaves as rewrite target |
| Surfaces | Photos app vs Share Sheet vs widgets | Home, Process, MCP Ask, tryatoms |

Apple’s discipline is **one library, many projections, clear mutation rights.** You already chose that for Ask. Apply the same discipline to **home and main**: one filing system, many thin projections — not one megaview that mutates the library.

---

## Graphify map (corroboration)

God nodes match the architecture story:

1. `AtomsHomeView` (86) — UI gravity well  
2. `AtomsPlugin` (74) — orchestration gravity well  
3. `classifyCapture` / `runWritePath` — correct intelligence/write cores  
4. Plus OAuth/handler — second product surface already in the graph  

No import cycles detected. The graph is not “messy spaghetti”; it is **two hubs with too much betweenness**. That is a peel problem, not a rewrite problem.

---

## Bottom line

**Ship quality of thought: top tier for an indie Obsidian product.**  
**Systems packaging: mid-stage — strong constitution, overweight shells, contract not yet dual-hardened.**

You do not need a new architecture story. You need to **keep the story and thin the actors** — so the next year of features cannot accidentally rewrite the user’s second brain from a home-view side path or a drifted Plus prompt.

---

## Suggested next decision

Pick one:

1. **Peel P0** — claim a refactor epic: Ask coordinator + run service + home view split (behavior-neutral, test-gated).  
2. **Contract P1** — freeze ClassificationResult + dual golden fixtures (plugin + plus-service).  
3. **Doc-only** — refresh `architecture.md` runtime map so agents stop learning a lie.

Recommendation: **1 then 2**. Doc refresh rides along either PR.
