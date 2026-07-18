# Architecture — Entity orbits (Constellations pass 2)

**Date:** 2026-07-17 · **Pass:** 2 (deep multi-lens)  
**Status:** design architecture — **not constitution**, not claimed, do not implement until Issue + STATUS + draft PR  
**Supersedes:** pass-1 framing where “Together home card + general Constellation product” was the win condition  
**Inputs (this pass):** graph/keying review · AI/cost review · UX/home arbitration · staff adversarial review  
**Related:**  
`docs/plans/2026-07-17-cluster-together-adversarial-and-cost.md`  
`docs/reviews/2026-07-17-constellations-staff-adversarial-review.md`  
`docs/design-handoff/atoms-view/cluster-together.html`  
`docs/plans/2026-07-16-person-hub-creation-adversarial-and-apple-brief.md`

---

## Executive decision

### The problem (real)

Captures about the **same entity** (trip, person, project, work) file as **separate atoms** across nights of auto-run. The graph may hold the truth, but the user cannot **see the set** on a phone — and soft links (`Camping`, `People`) look like structure when they are not.

### The wrong product noun

**“Constellation” as a user-facing system** (kinds taxonomy, push Together card, hub invent for trips) is premature.  
What is durable:

| Object | Role |
|---|---|
| Atom | Claim + sacred body |
| Hard entity link | `[[Exact vault title]]` with a non-junk reason |
| Soft bucket | `Camping`, `People`, `Travel` — **never** a shelf alone |
| Sibling list | Titles that share a hard key |
| Person hub invite | Specialized, high-precision identity accept |
| Consolidation map (v2) | Same-**claim** sediment — **different problem** from packing |

**Engineering name (internal):** entity orbit / hard-key membership index.  
**User language (if any):** entity title (“Yosemite packing”) or “Also about …”, not “Constellation.”

### Best approach (ranked winner)

```
T0  Better hard entity links     (piggyback classify + local reinforce)   ← SHIP FIRST
T1  Pull sibling list            (open atom / hub → title list)           ← FIRST UI
T2  Optional home Together card  (only if T1 dogfood proves need)         ← MAYBE
T3  Non-person hub invite        (only after person-invite pattern lives) ← LATER
T4  Gated light Suggest pass     (Haiku batch, default off)               ← ONLY IF EVALS FAIL
```

**Rejected as default:** per-capture second model · nightly library agent · append/checklists · folder placement · soft-key Together · packing-only vertical · Constellation as product taxonomy.

**If we could ship only one thing:** T0 — high-precision entity links on the classify you already pay for. Everything else is a view.

---

## Why pass 1 was incomplete

| Pass 1 said | Pass 2 corrects |
|---|---|
| Winner = piggyback + index + Together UI | Winner = **piggyback first**; UI is pull, then maybe push |
| Packing is first story of general kinds | Packing is the **hardest** entity class; people/media already win |
| Soft + token can become candidate | Soft + token = **reinforce or invite only**, never Together |
| Index from metadataCache | Index from **link-prose / structured links**; exclude FM `source` + daily markers |
| Constellation = product | Constellation = **internal index**; product = hard keys + sibling list |
| Second model “later if evals fail” | Named gates; **batch only**, never per-capture; default off |
| Home max 1 constellation card | Home needs **global** card arbitration (land peak / mind-change / person / …) |

---

## Approaches ranked (trust × value × cost × fit)

| Rank | Approach | Trust | Value | Cost | Fit | Verdict |
|---|---|---|---|---|---|---|
| **1** | **T0 Hard entity links only** (prompt + media-style reinforce; zero UI) | High | High | ~$0 marginal filings | Perfect | **Do this** |
| **2** | **T0 + T1 Pull sibling list** on open atom/hub | High | High | Free UI | Mobile-native | **Default UI path** |
| **3** | User-declared / existing hub only (never invent trip hubs) | Highest | High for packing | Free | Matches person/media law | **Policy for hubs** |
| **4** | Graph polish (`open-atom-graph`) | High | Medium (desktop) | Free | Parallel, not product | Keep shipping |
| **5** | T2 Home Together push card | Medium–low | Medium discovery | Free but **home noise** | Fights one-hero law | Only after dogfood |
| **6** | Person-hub invite (specialized) | High if sparse | High | Free create | Already designed | **Separate claim** |
| **7** | T4 Haiku Suggest (candidate batch) | Medium | Residual only | Paid if on | Costly habit | Gated only |
| **8** | Per-capture light second pass | Low | Demo | **2× filings** | Auto-run disaster | **Reject** |
| **9** | Append / master list / checkboxes | Low | High short-term | Low $ / high trust | Violates constitution | **Reject** |
| **10** | Consolidation maps | High if user-init | High for rot | Gated | Different problem | Arch v2 later |
| **11** | Soft co-occurrence Together | Low | Fake magic | Free | False clusters | **Reject surface** |

### Decisive “best approach” package

**Ship spine:** Rank 1 → Rank 2, under progressive trust gates.  
**Do not** couple Rank 1 to Rank 5 in one claim.  
**Do not** invent a Constellations product before person-hub invite and Plus are healthy.

---

## Domain model (engineering, not product taxonomy)

### Hard key (the only surfaceable unit)

```
HardKey =
  vault note title T such that:
    - T resolves in the vault (exists)
    - normalize(T) ∉ SOFT_ENTITY_KEYS
    - T is not a daily basename (YYYY-MM-DD)
    - T is not “existence-only soft bucket” (Camping, People, Travel, …)
```

### Soft keys (index poison if used alone)

Shared constant (must also fix connected resurface — today only softs `People`):

```
SOFT_ENTITY_KEYS ⊇
  people, camping, travel, movies, shows, watchlist,
  index, social, tags, home, archive, templates,
  app ideas, projects   // borderline buckets linked by enrich
```

### Membership (pure)

An atom is a **member** of orbit(T) iff:

1. Generated atom (`generated-by: linker`, under atom folder).  
2. **Link-prose region** (preferred) contains `[[T]]` — not capture-body user wikilinks, not FM `source`, not daily markers.  
3. If reason available: not junk (`isJunkLinkReason`).  
4. Not self-link.

**Multi-membership is allowed** (one atom → person + media). Surfaces pick one context; do not force single-key atoms.

### Sibling set

```
siblings(T) = members of orbit(T) excluding current atom
surfaceable(T) iff |members| ≥ minMembers (default 3) AND T is HardKey
```

No `kind` required for T0/T1. Optional `kind` later for invite copy only.

### What we do **not** model in v1

- Constellation ids as vault files  
- Theme orbits (sleep, gifts) as shelves  
- Completeness / packing progress  
- Temporal “trip ended” automation (manual dismiss is enough)  
- Same-claim consolidation (separate future)

---

## Keying strategies (graph truth)

### Rank 1 — Inverted hard link targets (adopt)

Key = non-soft vault title with ≥N generated-atom inbound edges from link-prose.

### Rank 2 — Optional schema key later (not v1)

`constellation_key` only if it **equals** an existing title or is discarded. Never dual-SSOT that replaces `links[]`.

### Rank 3 — Soft co-occurrence / title tokens (reject for surface)

Use only for:

- Local **reinforce** when a vault title already matches a token, or  
- Future invite signal  

Never for push Together.

### Link SSOT in the vault (load-bearing)

| Stage | Reality |
|---|---|
| Classify | `links: { note, reason }[]` |
| Write | Flattened to **body link-prose**, not frontmatter |
| Read | Prefer `extractLinkProseRegion` + `parseLinkProse`; home chips may scan body |
| Graph | Body links; filter daily inbound + FM source |

Constellation index **must** share this discipline with `src/graph/*` and not invent a second graph.

---

## AI + cost architecture

### Lanes (mandatory for all future AI-ish features)

| Lane | What | Plus filings | When |
|---|---|---|---|
| **Free** | Local enrich, index, sibling UI, hub create on tap, dismiss | 0 | Always preferred |
| **Piggyback** | Prompt / later soft schema on existing classify | 0 extra (same 1 classify) | T0 default |
| **Suggest** | Extra model call | **Counts as filing** | Default **off**; candidates only |
| **Reject** | Per-capture double call; library-wide agent; mass refile on hub create | — | Never default |

### Nightly unit economics (auto-run N ≈ 5–15)

| Path | Filings / night | Latency |
|---|---|---|
| Today classify | N | baseline |
| T0 piggyback | N | ~same (+tiny prompt tokens) |
| T1 sibling UI | N | 0 extra |
| Haiku per capture | **~2N** | ~2× | **Reject** |
| Haiku batch ≤1 / launch on candidates | N + 0..1 | +1 RTT rare | T4 only |

Plus included **150/mo**: heavy auto-run already pressures quota. **Never** spend filings on pattern views.

### Cache

- Prompt addendum sits in stable prefix → small cold-write growth.  
- **Dominant cost remains all-titles context**, not constellation rules.  
- Never put “tonight’s clusters” into cached context.  
- Real fix for cost scale: ContextProvider shortlist (architecture.md later) — orthogonal.

### When a second model is allowed (all must hold)

1. Offline fixtures prove T0 cannot form hard keys on cases product still wants.  
2. Local reinforce cannot close the gap without inventing hubs.  
3. Candidates only (list/trip-shaped + soft key + missing hard key).  
4. ≤1 batch Suggest per auto-run launch.  
5. Default off; counts as Plus filing if managed.  
6. No vault write from Suggest.  
7. Never re-classify whole orbit on hub create.

---

## Surfaces (UX architecture)

### Progressive trust (ship gates)

| Phase | Ship | Success before next |
|---|---|---|
| **T0** | Prompt + `entityReinforce` (name TBD) | Fixture precision; no false hard links to soft buckets |
| **T0.5** | Named attack fixtures | Soft-only → 0 surface; no Japan/Yosemite merge |
| **T1** | Pull: “Also about {T} · N” → title list | Used when opening multi-member hubs; no angry wrong-trip |
| **T2** | Home Together card (optional) | Dismiss &lt; ~30%; impressions ≪ home opens |
| **T3** | Non-person hub invite | Person invite pattern already live + trusted |
| **T4** | Suggest seam | Eval gate above |

If T0 fails → **kill the family** without burning home IA.

### Pull-first UI (T1) — recommended first surface

When user opens an atom (or hub) that has `surfaceable(T)` for some hard key T on that atom:

```
Also about Yosemite packing · 3
  → title list (in-home)
  → tap opens atom
Copy: Each note keeps its own body. This view only gathers titles.
```

| Open target | Role |
|---|---|
| In-home title list | **Primary** (phone) |
| Open hub note | Secondary if hub exists |
| Obsidian backlinks pane | Not primary |
| Global Graph | Parallel power path |

**Why pull beats push for packing:** false positive cost is low (user already in a claim); home stays quiet; auto-run still compounds links every night.

### Push home card (T2) — only if needed

If dogfood shows users never open members and still miss the set:

- Flat card, kicker `Together` (work-cyan text), entity title, peek ≤3, Open / Not now.  
- **Never** a For-you cue type (not mind-change, not guilt).  
- **Never** person-orange invite kicker on trips.  
- Suppressed under land peak / waiting / progress (same freeze as For you).

### Global home card arbitration (required if T2 or person invite ships)

**One top calm card.** Suggested priority:

| Rank | Card |
|---|---|
| 0 | Waiting / progress / **land peak** (exclusive) |
| 1 | Mind-change For you |
| 2 | Person invite |
| 3 | Together (T2 only) |
| 4 | On-this-day / named connected |
| 5 | Update strip |
| 6 | Silence |

Rules:

- Person orbits → **person invite only**, never Together + invite.  
- max **1** growth card per session.  
- Snooze per entity id ~14d device-local.

### Explicit non-surfaces

Collections tab · packing progress · checkboxes · nightly toast · Process multi-item packing theater · append into hub · theme shelves · “review your list”

---

## Runtime architecture

```
capture
  → classify (paid, once) + entity-aware prompt
  → enrich chain (free):
        rescueKeepableIdea
        enrichPersonLinks
        enrichMediaLinks
        maybeLinkPeopleIndex          // SOFT only
        enrichEntityLinks (NEW T0)    // hard titles only, media contract
        improveClassificationLinks
        stripSelfReferentialLinks
  → write atom + marker

on home open / after write (free):
  → buildEntityOrbits(atomLinkRecords)   // pure invert
  → policy (soft denylist, minMembers)

on open atom (T1):
  → siblings for hard keys on this atom
  → optional “Also about {T} · N”

optional later:
  ConstellationSuggester (T4) → candidates only, gated
```

### Module map (when claimed)

| Path | Responsibility |
|---|---|
| `pipeline/softKeys.ts` | Shared soft denylist (constellations **and** connected resurface) |
| `pipeline/enrich/entityLinks.ts` | T0 reinforce: trip/list/project/media-adjacent **existing** titles only |
| `pipeline/entityOrbitIndex.ts` | Pure `buildOrbits` / `siblings` |
| `pipeline/entityOrbitPolicy.ts` | minMembers, surfaceable, pick (if home card) |
| `home/*` | T1 strip / T2 card; global HomeCardPolicy when multiple growth cards exist |
| Future `pipeline/entitySuggest.ts` | T4 interface only |

**Reuse:** `isJunkLinkReason`, person hub discovery, media `workTitleExistsInVault`, graph body-link filters.

**Do not** put this in `plugin/main.ts`.

---

## Composition with existing systems

| System | Relationship |
|---|---|
| Person hubs | Own people; T0 may link; **no Together for person** |
| Media enrich | Template for entity reinforce (link-if-exists) |
| Connected resurface | Pairwise cousin; **expand soft denylist** so Camping-only never “Also about Camping” |
| Mind-change | Hard revises/contradicts; not entity orbits |
| Land peak | Tonight’s filings only; freezes growth cards |
| Open atom graph | Desktop orbit; T1 is phone-native sibling list |
| Consolidation maps | Same-claim MOC later; **not** packing end-state |
| Atoms Plus | T0–T3 free UI; T4 Suggest = filing if enabled |

---

## Packing is not special — but it is hard

| Entity class | Precision today | UI owner |
|---|---|---|
| Person | High (discovery + enrich) | Person invite |
| Media work | Medium–high (link-if-exists) | Links + optional orbit |
| Project / work title | Medium | T0 links + T1 |
| Trip / packing | **Low without hub title** | T0 only until hub exists |

**No hub title in vault ⇒ no Together / no sibling shelf.**  
Silence is correct. Product must not market “we always assemble packing lists.”

**Hub invent for trips:** same adversarial bar as people (human accept only). Prefer **user-created or already-existing** packing notes; inference reinforces, does not invent (T3).

**Multi-entity captures:** atom may link two hard keys; sibling UI scopes to the key the user is viewing (or highest-confidence key on open). Never merge two trips into one orbit because both soft-link Camping.

**Year / trip decay:** no auto archive. Living graph + dismiss. Wrong merge → silence next time via better keys, not smarter AI.

---

## Test / eval architecture (before any UI claim)

| Fixture | Expected |
|---|---|
| 3 atoms link existing `Yosemite packing` | orbit size 3; T1 shows siblings |
| 3 atoms link only `Camping` | no surface |
| Japan + Yosemite soft Camping only | no cross-merge |
| 3 atoms → person hub | no Together; person path |
| Capture body `[[Camping]]`, no link-prose | no membership |
| Game-night + soft Camping | no surface |
| 3 atoms → existing show title | orbit OK |

Unit-test pure index + reinforce. No live Haiku in default CI.

---

## Phased claims (when product prioritizes)

| Claim | Scope | Cost |
|---|---|---|
| **Claim A (T0)** | Soft-key module + connected fix + prompt + entity reinforce + fixtures | Piggyback |
| **Claim B (T1)** | Orbit index + “Also about” open strip + title list | Free |
| **Claim C** | Person hub invite (if not already) | Free |
| **Claim D (T2)** | Home Together under global card policy | Free |
| **Claim E (T3/T4)** | Non-person invite / Suggest | Free / gated paid |

**Do not** claim A+D together. **Do not** block Plus on this family.

---

## Open decisions (narrowed)

| # | Decision | Pass 2 recommendation |
|---|---|---|
| 1 | minMembers | **3** |
| 2 | Soft-only surface | **Never** |
| 3 | First UI | **Pull T1**, not home T2 |
| 4 | Person + Together | **Person invite only** |
| 5 | Suggest metering | **1 filing per batch call**; default off |
| 6 | Trip hub create | **T3 only**; prefer existing titles |
| 7 | Product noun | Internal orbit; UI says entity name / “Also about” |
| 8 | Schema key field | **Not in T0** |

---

## Kill criteria

Abandon or freeze the family if:

1. T0 cannot beat soft-only linking on packing fixtures without inventing hubs.  
2. Any push surface produces repeated wrong-trip / wrong-person reports.  
3. Home growth cards fire on most calm opens (sparsity failure).  
4. Suggest becomes needed for demos rather than residual eval failures.  
5. Feature drifts into checklists, append, or Collections tab.

---

## Bottom line

| Question | Answer |
|---|---|
| Best approach? | **Hard entity links (T0) → pull sibling list (T1).** Home Together and second models are optional later. |
| General beyond packing? | **Yes as graph membership**, not as packing vertical or theme detector. |
| Lighter model? | **Seam only (T4), batch, default off** — never per-capture. |
| Cost? | T0–T3 ≈ **0 extra filings**; don’t tax Plus for views. |
| Architecture name? | Entity orbits / hard-key index — **not** a Constellation product. |

**Next product decision:** accept progressive-trust spine (**T0 → T1**, no home card in first claim) vs keep pass-1 “ship Together card as the aha.” Pass 2 recommends the spine.
