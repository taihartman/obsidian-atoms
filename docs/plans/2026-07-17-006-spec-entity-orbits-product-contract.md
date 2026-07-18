---
artifact_contract: product-spec/v1
artifact_readiness: requirements-settled
product_contract_source: multi-session brainstorm + architecture pass 2
execution: none-yet
title: "Entity orbits — hard links + sibling list"
date: 2026-07-17
status: product-authority-for-planning
---

# Entity orbits — Product Contract

**What this is.** Durable product authority for “see related atoms as a set” (packing, projects, media, etc.). Requirements and decisions only.  
**What this is not.** Implementation plan, unit breakdown, or a claim to code.  
**Constitution still wins:** `CLAUDE.md` non-negotiables + `docs/architecture.md` north star.

**Architecture detail:** `docs/architecture-constellations.md` (pass 2)  
**Adversarial / cost:** `docs/plans/2026-07-17-cluster-together-adversarial-and-cost.md`  
**Staff review:** `docs/reviews/2026-07-17-constellations-staff-adversarial-review.md`  
**Exploration mock:** `docs/design-handoff/atoms-view/cluster-together.html` (illustrative; T1 pull-first supersedes home-card-as-win)  
**Cousin:** person-hub invite brief `docs/plans/2026-07-16-person-hub-creation-adversarial-and-apple-brief.md`

---

## Goal capsule

**Objective.** When several atoms share a **real vault entity** (trip note, project title, work title, person hub), the system forms **hard links** while filing, then lets the user **see the sibling set** on phone without merging bodies, inventing folders, or spending extra AI calls.

**One-liner.** Intelligence in hard links you already buy; sibling list is a free view; silence beats a wrong shelf.

**Target moment.** Nightly auto-run files one packing item at a time across days. User later opens any member (or hub) and sees the whole set. Discovery is pull-first, not a packing app.

---

## Problem frame

| Today | Pain |
|---|---|
| Capture “bug spray / hat / pants” over several nights | Separate atoms (correct) |
| Classify often soft-links `Camping` / broad buckets | Graph looks structured but is not trip-specific |
| Phone has no calm “all of these” | User cannot see the set without desktop graph / hunting |
| Temptation: merge list, checkboxes, folders, second AI pass | Violates body sacred, second-brain stance, Plus cost |

**Not the same problem as consolidation maps** (same *claim* repeated over years → MOC). This is same *entity membership* across sporadic captures.

---

## Product nouns

| Noun | User-facing? | Meaning |
|---|---|---|
| **Hard entity link** | Indirect (chip / wikilink) | `[[Exact vault title]]` that exists; non-junk reason |
| **Soft bucket** | Indirect | `Camping`, `People`, `Travel`, … — never a shelf alone |
| **Sibling set / orbit** | “Also about {title}” | Atoms that hard-link the same entity |
| **Constellation** | **No** | Engineering-only word; do not ship as product taxonomy |
| **Together** | Optional later (T2) | Home push card label only if dogfood demands push discovery |
| **Person hub invite** | Yes (separate feature) | Owns people; not this contract’s first UI |

---

## Progressive delivery (product phases)

Phases are **gates**, not optional polish. Later phases require earlier success metrics.

| Phase | Name | Ships | Gate to next |
|---|---|---|---|
| **T0** | Hard links | Prompt + local entity reinforce on existing classify; shared soft-key denylist; fixtures | Precision on fixtures; soft-only never becomes “structure” |
| **T1** | Pull siblings | On open atom/hub: **Also about {T} · N** → in-home title list | Used when multi-member hubs exist; no wrong-trip reports |
| **T2** | Home Together (optional) | One calm home card when threshold met | Only if T1 dogfood shows users never open members and still want discovery |
| **T3** | Non-person hub invite | Sparse “Make {label}?” after person-invite pattern is live | Human accept only; no silent stubs |
| **T4** | Light Suggest (optional) | Gated batch model for residual ambiguity | Offline evals prove T0 fails named cases; default **off** |

**First shippable product slice for an implementation plan:** **T0 + T1** only.  
**Do not** plan T2–T4 in the same claim as T0+T1 unless product re-opens scope.

---

## Requirements

### Core behavior

**R1. Hard keys only for any multi-atom shelf.** A surfaceable entity key is a **vault note title that exists**, is not a soft bucket, is not a daily basename, and has enough generated-atom members. Soft keys alone never open a sibling list or home card.

**R2. Soft buckets never surface as the set.** Shared denylist includes at least: People, Camping, Travel, Movies, Shows, Watchlist, Index, Social, Tags, Home, Archive, Templates, App ideas, Projects (borderline buckets). Soft denylist is **shared** with connected resurface so Camping-only never becomes “Also about Camping.”

**R3. Membership from classification edges, not capture prose.** Prefer **link-prose** (plugin-written links). Do not treat user wikilinks inside the sacred capture body, frontmatter `source`, or daily marker lines as orbit membership.

**R4. minMembers = 3** for any sibling surface. Pairs stay in connected / graph; they are not a shelf.

**R5. Multi-membership allowed.** One atom may hard-link a person and a trip. UI scopes to the entity in context (the hub/key being viewed), not a forced single orbit per atom.

**R6. Bodies stay separate.** No merge into a master list. No append into hub/user notes. No auto checkboxes. No folder placement. Copy must say titles are gathered; bodies stay where they are.

**R7. Living graph.** Update notes / refile may change links; membership is derived, not frozen. Dismiss/snooze is the only user freeze (device-local).

### Filing intelligence (T0)

**R8. Piggyback only.** Entity linking improves on the **existing** classify call (prompt + local enrich). No second Anthropic call in T0/T1.

**R9. Link-if-exists contract.** Local reinforce may add a hard link only when the entity title **already exists** in the vault title index (same spirit as media enrich). Never invent hollow trip/project notes in T0/T1.

**R10. High precision, low recall.** Prefer silence and soft-only links over wrong hard entity. False shelves destroy trust faster than a sparse library.

**R11. Not packing-only.** Machinery is general entity membership (trip/list, work/project, media work titles, and person links via existing person enrich). Packing is a **story**, not a separate product module.

**R12. Person class is specialized.** Person discovery, soft `People`, and person-hub invite remain the person path. This contract **must not** ship a “Together · {person}” card that doubles person invite.

### Pull UI (T1)

**R13. First UI is pull, not push.** Primary surface: when the user opens an atom (or hub) that participates in a surfaceable orbit, offer **Also about {entity title} · N** and open an in-home **title list**.

**R14. Open contract.** Primary open target = in-home title list (phone-first). Secondary optional: open hub note if it exists. Do not rely on Obsidian’s backlinks pane as the product. Global Graph remains a parallel power path, not a substitute for T1.

> **Amended 2026-07-18** (`docs/plans/2026-07-18-amend-library-open-vault-note.md`): **Library** row open target is the **vault note** (file-explorer). In-home title list / Also about remain for Together → siblings and other in-home navigation — not as the library open intermediary.

**R15. Copy voice.** Memory shelf, not job queue. No “3 of 7 packed,” “still need to,” “review packing,” or completion language. No em dashes in app chrome. No mind-change purple fills on this surface. No person-orange kicker on non-person shelves.

### Home push (T2 — optional, gated)

**R16. Together is never a For-you cue.** If a home card ships, it is a separate flat growth card (sibling to person invite / Update), not mind-change / on-this-day / connected.

**R17. Global one-hero arbitration.** Waiting, progress, and land peak **exclude** all growth cards. On calm home, at most **one** growth card per session. Priority when multiple fire: mind-change → person invite → Together (T2) → temporal/connected For you → Update → silence.

**R18. Sparsity metric.** Together impressions must be rare relative to home opens. If most calm opens show a promo card, the feature failed.

### Hubs and invent (T3 — later)

**R19. Prefer existing hubs.** Inference reinforces declared/existing titles. Do not invent trip hubs in T0/T1.

**R20. Human accept only for new hubs.** Non-person “Make {label}?” only after person-invite pattern is live; same adversarial bar (no silent stubs, rate-limited, dismissible). Flat atoms / configured hub path — no AI folder intelligence.

### Cost (all phases)

**R21. Cost lanes.**

| Lane | Examples | Plus filing |
|---|---|---|
| Free | Local enrich, orbit index, sibling UI, hub create on tap, dismiss | 0 |
| Piggyback | Prompt / optional future schema on existing classify | 0 extra (same classify unit) |
| Suggest (T4) | Extra model call, candidates only, default off | **Counts as filing** |
| Reject | Per-capture second pass; library-wide agent; mass refile on hub create | Never default |

**R22. Market honestly.** Sibling list / Together UI is free. Only classify (and optional gated Suggest) costs. Do not spend managed filings on pattern *views*.

**R23. No auto-run call multiplication.** Silent nightly filing must not add cluster/summarize/hub model calls.

### Trust and safety

**R24. Constitution non-negotiables hold.** Body sacred; flat `Atoms/`; no append-into-user-notes; second brain not task app; never process today by default; API key not in `data.json`.

**R25. Vault lanes for agents.** Dogfood on demo/test vault only. No unattended Remote Vault orbit rewrites.

**R26. Kill criteria.** Freeze or abandon the family if: T0 cannot beat soft-only on fixtures without inventing hubs; push surfaces produce repeated wrong-entity reports; growth cards fire on most calm opens; Suggest becomes demo-required rather than residual; feature drifts into checklists/append/Collections.

---

## Key decisions (locked)

| ID | Decision |
|---|---|
| **KD1** | Product name internal: entity orbit / hard-key membership. User: entity title or “Also about …”. Not “Constellation” in UI. |
| **KD2** | First implementation claim = **T0 + T1** only. |
| **KD3** | minMembers = **3**. Soft-only = **never surface**. |
| **KD4** | Link region for membership = **link-prose preferred** (not capture body, not FM source, not daily markers). |
| **KD5** | Index = **derived** on home open / after write. Persist only device-local dismiss/snooze if needed. |
| **KD6** | AI default = **piggyback + local**. No second model in T0/T1. |
| **KD7** | T2 home card = **optional after dogfood**, not part of first plan win condition. |
| **KD8** | Person UI exclusivity = person invite owns people; no Together for person kind. |
| **KD9** | Suggest (T4) = batch candidates, ≤1 per launch, default off, **1 filing per batch call**. |
| **KD10** | Append / checkboxes / folder intelligence = **out of scope** for this contract. |
| **KD11** | Consolidation maps = separate future problem (same-claim MOC), not this end-state. |

---

## Scope boundaries

### In scope (T0 + T1 product)

- Soft-key denylist module shared with connected resurface  
- Classify prompt guidance for trip/list/project/media **existing** entity titles  
- Local entity reinforce (link-if-exists)  
- Pure orbit index + sibling policy  
- Pull “Also about {T} · N” + in-home title list  
- Fixtures for soft-only silence, hard-key siblings, no cross-trip merge, person non-surface  
- Unit tests on pure index/reinforce  

### Explicitly out of first claim

- Home Together push card (T2)  
- Non-person hub auto-invite (T3)  
- Haiku / second model (T4)  
- Schema `constellation_key` field  
- Checkboxes, append, packing progress  
- Collections tab / MOC browser  
- Packing-only vertical UI  
- Theme orbits (sleep, gifts) as shelves  
- Agent unattended hub creation on personal vault  

### Outside product identity

- Task manager / packing checklist app  
- CRM  
- Vault chat / RAG  
- AI folder placement  

---

## Success criteria

### T0 (must pass before T1 UI claim is “done”)

- [ ] Soft-only fixtures produce **zero** surfaceable orbits  
- [ ] Hard hub fixtures with ≥3 members produce a correct orbit  
- [ ] Japan vs Yosemite soft Camping does **not** merge  
- [ ] Capture-body-only `[[Camping]]` does **not** mint membership  
- [ ] Connected resurface does not treat expanded soft keys as named kinship alone  
- [ ] No extra Anthropic call on Process / auto-run path  

### T1

- [ ] Opening a multi-member atom shows **Also about {T} · N** when policy passes  
- [ ] Title list opens in-home; tap opens atom; bodies unchanged  
- [ ] Copy states titles gathered / bodies separate  
- [ ] Person-only orbits do not show this as a substitute for person invite  
- [ ] Phone-primary layout (≥44px targets, calm flat card language)  

### Product (dogfood)

- [ ] Multi-night packing (or project) with an **existing** hub title becomes visible as a set via T1  
- [ ] Without a hub title, system stays quiet (accepted, not a bug)  
- [ ] No user report of “fake packing list” in first dogfood window  

---

## Non-goals (reminders)

- Solving “where does this file live in my folders”  
- Completing packing lists  
- Replacing Global Graph for power users  
- Unattended cloud worker beyond existing auto-run  
- Paywalling sibling UI  

---

## Priority vs other work

| Work | Relative priority |
|---|---|
| Atoms Plus managed filing | Higher (unblocks filing) |
| Person hub invite | Peer / slightly higher for identity; specialized path |
| Entity orbits T0 | After or parallel to link-quality health; cheap piggyback |
| Entity orbits T1 | After T0 fixtures green |
| T2–T4 | Explicitly later |

This contract **must not** block Plus.

---

## Authority and next artifacts

| Artifact | Role |
|---|---|
| **This file** | Product Contract (requirements + KDs) for planning |
| `docs/architecture-constellations.md` | Shape, keying, modules, cost lanes, kill criteria |
| Future `docs/plans/YYYY-MM-DD-*-feat-entity-orbits-*-plan.md` | Implementation plan (units, files, tests) via `ce-plan` |
| Future GitHub Issue + STATUS + draft PR | Hard claim before code |

**Planning entry:** implement **T0 + T1 only**, citing this contract as product authority.  
**Doc-review:** light `ce-doc-review` on the implementation plan before `ce-work`.

---

## Open blockers

None product-blocking for writing the T0+T1 implementation plan.

Deferred (not blocking T0+T1):

- Exact non-person hub folder default (T3)  
- Whether T2 ever ships (dogfood)  
- Schema key field (post-T1 evals)  
- Suggest model id / Plus metering UI (T4)  

---

## Session-settled decisions (trace)

| Decision | Source |
|---|---|
| Soft-only never surfaces; minMembers 3 | Architecture pass 2 + adversarial |
| Pull-first UI over home card as win condition | Staff adversarial + UX multi-surface review |
| Piggyback AI; reject per-capture second pass | Cost review + Plus R14 spirit |
| General entity membership, not packing-only | User direction + architecture |
| No append / checkboxes / folders | Constitution + user agreement |
| Nightly auto-run → multi-day set, not Process batch invite | Product discussion |
| Person invite owns people | Person-hub brief + UX arbitration |

---

## One-page summary for humans

**Build:** better entity links while filing + “Also about this · N” title list when you open a related atom.  
**Don’t build yet:** packing app, home Together hero, second AI brain, invent trip notes, checkboxes.  
**Cost:** free view; same classify you already run.  
**Trust:** wrong shelf is worse than silence.
