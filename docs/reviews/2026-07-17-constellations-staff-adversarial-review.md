# Constellations — staff engineer + adversarial product review

**Date:** 2026-07-17  
**Inputs:** `docs/architecture-constellations.md`, `docs/plans/2026-07-17-cluster-together-adversarial-and-cost.md`, `docs/architecture.md` (v2 consolidation), `docs/spec-amendments.md` (append cut, knowledge rot), person-hub invite brief, live seams (`open-atom-graph`, people/media enrich, land peak, resurface)  
**Status:** design critique only — not claimed, not implementation  

---

## Executive verdict

The architecture pass got the **cost and safety envelope** right (piggyback classify, local index, no second brain-call, no append/folders/checkboxes). It underweighted **where value is felt**, **when silence is better than a noun**, and **what problem is actually being solved**.

**Blunt read:** “Constellation” is mostly a **product noun for better entity links + a sibling list**. The recommended stack still ships a **push card on home** and a **general archetype system** before proving the only load-bearing layer: **hard entity keys on classify**. That is the wrong order of risk.

If this ships as written (P0→P1 Together card as the win condition), you will likely get:

1. A beautiful empty state (soft keys → silence) that looks like the feature “doesn’t work,” or  
2. A few false Together cards that teach users the system is sloppy faster than sparse library ever did.

Person-hub invite already owns the only high-precision entity class. Packing/trip is the **hardest** entity class (no stable proper-noun identity, temporal, multi-entity, year collisions). Building a general “Constellation” product on packing as the first story is backwards.

---

## Lateral answers (the questions you asked)

### 1. Is “constellation” the right abstraction — or just better linking + backlinks UX?

**Mostly the latter.** The durable objects already exist:

| Object | Role today |
|---|---|
| Atom | Claim + body |
| `links[]` + reasons | Graph edges |
| Person hub / media title | Hard entity nodes |
| Backlinks / open-atom-graph | “Show me the orbit” |
| Consolidation map (v2) | Same-claim sediment → synthesis |

“Constellation” adds:

- A **derived cluster type** with `kind`, `confidence`, dismiss state  
- A **home product surface** (Together)  
- Gravity toward Collections / hub invent / list completeness  

None of that is required to deliver the packing aha. The aha is: *three claim-titles share a real hub, and I can open the set*. That is **membership list over a hard key**, not a new domain entity.

**Opinion:** keep the *engineering* idea (local group-by-hard-key) as an internal index helper. Do **not** promote Constellation as a user-facing product noun until dogfood proves users need a named thing beyond “Also about Yosemite packing.” Internal types are fine; product taxonomy is expensive.

### 2. Could on-demand Together (open any member) beat proactive home cards?

**Yes — and it should be the default surface if any UI ships before consolidation maps.**

| | Push (home Together card) | Pull (open member / hub) |
|---|---|---|
| Trust cost of false positive | High — unsolicited wrong shelf | Low — user already in a claim |
| Competition on home | Land peak, For you, person invite, wait, setup | None |
| Auto-run fit | “Must surface later” is true, but **not** as a hero | Graph compounds silently; pull reveals on interest |
| Phone UX | One more card in a crowded calm home | Sibling strip under open atom is natural |
| Precision | Needs global threshold policy | Context is the threshold |

Home already has a **one-hero discipline** (land peak freezes resurface). Adding another calm card family (Together) next to person-hub invite and For you is **product surface inflation** before the graph is good enough to deserve it.

**Recommended surface order:**

1. Silent better links (no UI)  
2. On open atom: **Also about {hub} · N** → title list (local)  
3. Optional: same strip when opening an existing hub note  
4. Home push card **only** if dogfood shows users never open members and still want discovery  

The adversarial brief correctly said “home-time detection, not process toast.” Detection can still be home-time **index refresh**; **display** need not be a home hero.

### 3. Could graph view / open-atom-graph already solve this?

**Partially — more than the architecture admits.**

Shipped: `atoms:open-atom-graph` + `atomGraphSet` (seeds + inbound backlinks, daily markers). That is already “show me the local constellation” for desktop power users.

**Gaps graph does not fill:**

- Phone graph is weak / not the mobile-primary path  
- Graph does not **name** “these three are packing for Yosemite” — it shows topology  
- No threshold / calm product language for non-graph users  
- Soft-hub stars (Camping) still look like structure when they are not  

**Role:** treat graph polish + “open graph from this atom” as a **cheap parallel**, not the product. Do not invent Together solely because graph is weak on phone — invent a **phone-native sibling list**, which is exactly the open-member pull surface, not a new home mode.

### 4. Is consolidation map the real end-state and Together a wrong intermediate?

**For epistemic rot: yes, consolidation is the real end-state. For packing lists: they are different problems.**

| Problem | Shape | Right tool |
|---|---|---|
| Same claim repeated 12× / year | Claim clusters, supersession, MOC | **Consolidation maps** (arch v2) |
| Sporadic items about one trip | Entity membership, not same claim | **Hard entity links + sibling list** |
| Belief fossilization | Rehearsal + revises/contradicts | **Resurface / mind-change** (shipping) |

Architecture-constellations folds `theme` and “project crumbs” into the same machine as packing. That is how you get a **wrong intermediate**: a general pattern product that is too weak for synthesis and too eager for entity shelves.

**Together as packing-shelf is not on the path to consolidation.** Consolidation wants *same-claim* clustering and a user-initiated MOC. Packing wants *same-entity* membership. Sharing an index module is fine; sharing a product story and `kind` taxonomy is a category error.

**Opinion:** do not build Constellations-as-product to “practice” for consolidation. Practice is **better `links[].reason` + supersession + collision-as-signal** (already in amendments H2 / rot section).

### 5. Pull-based vs push-based pattern detection

Split the concepts the architecture merged:

| Layer | Should be |
|---|---|
| **Detection / index** | Continuous, local, free — rebuild on home open / after write |
| **Surfacing** | **Pull-first**; push only for rare high-precision invites (person hub pattern) |

Push is justified for **identity invites** (“Add Ning?”) because the alternative is permanent soft `People` and the entity class is well-defined. Push is **not** justified for packing clusters where false merge is common and the user did not ask for a shelf.

### 6. User-declared lists vs inferred

**Underweighted. This is the highest trust × value move for packing-shaped work.**

Person-hub doctrine already says: **identity is a choice.** Trip/list hubs should follow the same law harder than people (names are clearer than trips).

| Mode | Trust | Recall | Fit |
|---|---|---|---|
| Infer “Yosemite packing” from three soft Camping atoms | Low | Medium | Fragile |
| User already has / creates `Yosemite packing` note; classify links into it | High | High | Matches media + people |
| Explicit capture convention (“packing for Yosemite: bug spray”) + prompt | High | Medium | Cheap |
| UI “Start a list / pin as list” once | High | High | Small product, big precision |

**Inference should reinforce declared hubs, not invent them.** The architecture’s hub invite for non-person kinds re-opens the empty-stub Sync pollution the person-hub brief correctly feared — for a *weaker* entity class.

**Opinion:** v1 of “packing intelligence” = **never invent trip hubs**; only link to titles that exist or that the user just accepted on a person-grade invite after multiple independent signals. Prefer teaching one capture habit over a Together hero.

### 7. Progressive trust: zero UI for N weeks of dogfood metrics

**This should be the plan’s first ship gate, not a soft note.**

Architecture says “do not ship P1 without P0 quality” but still frames the **winner** as piggyback **+ index + Together UI**. That couples the cheap correctness work to the expensive trust surface.

**Better program:**

| Phase | Ship | Success metric (dogfood vault / personal) |
|---|---|---|
| **T0** | Prompt + local reinforce only | Precision of hard entity links on packing/trip fixtures; false link rate |
| **T0.5** | Offline eval set (named attacks from adversarial brief) | Zero false trip merges on fixtures |
| **T1** | Pull sibling list only | Used when opening multi-member hubs; no home chrome |
| **T2** | Home card optional | Dismiss rate &lt; ~30%; zero angry “wrong trip” reports |
| **T3** | Hub invite for non-person | Only after person invite pattern is live and trusted |

If T0 fails, **kill the feature family** without having burned home IA.

### 8. Multi-entity atoms

**Under-specified; will break single-key constellation id.**

Real captures: “bug spray for Yosemite and also the Japan bag,” “board games for cabin + game night next week.”

Architecture:

- One `constellation_key` optional field  
- Suggester later for “ambiguous multi-entity”  
- Index keyed as if membership is primarily one hard key  

**Reality:** multi-entity is normal, not edge. Index must be **many-to-many** (atom → set of hard keys) from day one. UI shows **one** context (the key matching the open atom or the strongest recent key), never forces a single global constellation id as truth.

Do not wait for Haiku suggester to “solve” multi-entity. Solve it as **multiple hard links on one atom** (already allowed by `links[]`). The bug is treating constellation as a partition of the library.

### 9. Temporal decay / trip ended

**Missing entirely — serious product hole.**

A trip constellation has a lifecycle:

| Phase | Correct product behavior |
|---|---|
| Pre-trip capture drip | Sibling list useful; optional soft discovery |
| During trip | Same |
| Post-trip | Archival; **home Together is wrong** (feels like unfinished packing guilt) |
| Years later | On-this-day / connected resurface, not “Together · Yosemite packing” |

Without **recency on `sourceDate` / last member activity**, high-confidence clusters become permanent home noise — exactly the guilt-queue gravity you banned for tasks (“3 of 7 packed” is just one form; “still showing packing from 2024” is another).

**Minimum policy if any push surface exists:** only surface if last member `sourceDate` within ~45–90 days **or** user opened a member recently. Else index-only / pull-only.

Themes and multi-year Japan packing are the year-collision attack; temporal windows are part of the fix, not just better keys.

### 10. Non-negotiable conflicts

| Risk | Conflict | Severity |
|---|---|---|
| Hub invite + “re-point links” | Body sacred OK if only frontmatter/links; **do not** touch body; careful Update-notes interaction | High if sloppy |
| User expects master list | Append cut (amendment B) — copy must say bodies stay separate; invite must not promise merge | High product expectation |
| `kind: list` + progress UI | Task-app gravity (adversarial already flags; architecture non-surfaces help) | Medium — keep kill switch |
| Soft Camping reinforce | False edges → false clusters (link quality trust base) | High |
| `theme` archetype | Epistemic false edges; architecture correctly off for surface — keep **deleted** from v1 model if possible | Medium |
| Home Together vs land peak / For you | Calm-home one-hero discipline | Medium product |
| Auto-run silent hub pressure | “Why didn’t it assemble my list?” marketing lie | Medium |
| Agent dogfood | Unattended hub create on Remote Vault | Process, already noted |
| Update notes rewires membership | Living graph OK; push card thrash not OK | Medium — another reason pull &gt; push |
| Multiplayer name collisions | Same as people | Low until shared vaults |

**Hard reject still correct:** append, folders, checkboxes, nightly library agent, second model default.

---

## Top 5 alternative strategies

Ranked by **trust × value × cost × product fit** (higher is better). Cost includes eng + AI + home IA risk.

### 1. Progressive link quality only (T0) — **recommended spine**

**What:** Piggyback prompt + local `constellationReinforce`-style enrich (media pattern): link packing/trip/project dumps to **existing** hard titles; never invent hubs; no Constellation product UI; no home card.

**Why wins:** Near-zero cost, improves graph/For you/open-atom-graph/backlinks for free, zero false-shelf risk, unblocks every later surface, aligns with cost constitution the adversarial brief wants.

**Score:** trust 5 · value 4 · cost 5 · fit 5 → **first**

### 2. Pull-based sibling strip (“Also about”) on open atom / open hub

**What:** Local group-by hard key; when user opens a member or hub with ≥N siblings, show in-home title list. No proactive Together hero. Optional command: “Show related atoms.”

**Why:** Captures multi-night auto-run value at the moment of interest; phone-friendly backlinks; false positives are less catastrophic; reuses open-atom mental model; leaves home for land peak / For you / person invite.

**Score:** trust 4 · value 5 · cost 4 · fit 5 → **best UI if any**

### 3. User-declared entity first (hub-or-nothing)

**What:** No inferred trip constellation without an existing vault title. Teach/create path: user makes `Yosemite packing` (or accepts a rare invite after person-grade confidence). Classify only links into declared nodes. Optional capture micro-habit.

**Why:** Matches person-hub identity doctrine; kills year-merge and Camping-bucket clusters; marketing honesty (“we gather into notes you named”).

**Score:** trust 5 · value 3 · cost 4 · fit 5 → **precision floor**

### 4. Graph + connected resurface leverage (no new product)

**What:** Invest in open-atom-graph discoverability on mobile command path; strengthen **named** connected resurface (already land-then-remember: name seed/hub, not soft People). Let multi-night patterns appear as “Also about {hub}” in For you when honest.

**Why:** Uses shipping surfaces; zero new IA; consolidation/resurface stay the north-star legs. Weaker for packing-shelf mental model.

**Score:** trust 4 · value 3 · cost 5 · fit 4 → **cheap cousin**

### 5. Architecture’s recommended path (piggyback + index + home Together + later invite)

**What:** As written in `architecture-constellations.md` P0–P2.

**Why it ranks lower despite good cost thinking:** push surface + general `kind` taxonomy + packing-as-first-story on the hardest entity class + missing temporal decay + multi-entity as afterthought. The **index** is fine; the **product packaging** is premature.

**Score:** trust 2 · value 4 · cost 3 · fit 3 → **defer packaging; keep signal work**

### Honorable mentions (not top 5)

| Strategy | Why not ranked high |
|---|---|
| Haiku second pass / nightly cluster agent | Correctly rejected on cost |
| Jump to consolidation MOCs now | Right for claim sediment, wrong packing fix; user-initiated later |
| Checkboxes / append master list | Non-negotiable reject |
| Collections tab | Home IA reject |

---

## What `architecture-constellations.md` is missing

1. **Surface inversion** — assumes home Together is the natural product; underweights pull-on-open and graph.  
2. **Progressive trust as a hard gate** — P0 metrics before any chrome; not just “don’t ship P1 empty.”  
3. **User-declared entity doctrine** — person-hub “identity is a choice” not fully generalized to trips/lists.  
4. **Temporal lifecycle** — trip ended / archival; recency windows for any push.  
5. **Multi-entity as first-class** — many-to-many membership; constellation is not a partition.  
6. **Problem split** — entity membership ≠ claim consolidation; `theme` kind is a footgun even “off by default.”  
7. **Home IA budget** — competition with land peak, For you, person invite, wait cards; one-hero discipline.  
8. **Expectation management** — append gap is named in adversarial brief but not a hard UX contract in architecture surfaces.  
9. **Eval-as-blocker** — named attacks exist; architecture does not make fixture-green a claim prerequisite.  
10. **Existing open-atom-graph** — not in relationship table; should be.  
11. **Kill criteria** — none.  
12. **Priority honesty** — adversarial brief says don’t block Plus / person invite; architecture “next step when claimed” can still attract premature eng. Reassert: **no claim until person-hub invite path exists or is explicitly parallel-owned.**

What it got right (do not throw away):

- Piggyback over second model  
- Soft keys never surface  
- minMembers ≥ 3 instinct  
- No append/folders/checkboxes  
- Local pure index + unit tests  
- ConstellationSuggester off by default  
- Person/media as templates  
- Cost lanes Free / Piggyback / Suggest / Reject  

---

## If I could only ship one thing

**Ship only T0: better hard-entity linking on the existing classify path (prompt + local reinforce), measured on packing/trip/person/project fixtures — zero Together UI, zero constellation settings, zero hub invent for trips.**

Rationale:

1. Every other strategy is a view over edges; bad edges make every view worse.  
2. Zero trust surface means you can dogfood on real vaults without teaching false shelves.  
3. Improves backlinks, graph, connected resurface, and future pull UI for free.  
4. Aligns with non-negotiables and Plus unit economics.  
5. If metrics fail, you abandon a prompt/enrich experiment — not a product noun and home card.

**Second place if forced to ship visible UX:** pull “Also about {hard hub}” on open atom only — still no home Together.

---

## Kill criteria (abandon the feature family)

Abandon **Together / Constellation product** (not necessarily forever abandon better linking) when any of these hold:

| # | Criterion | Why |
|---|---|---|
| K1 | Offline eval cannot hit high precision on false-trip-merge / game-night-vs-camp / year-collision without killing recall to near-zero | Signal layer is not productizable |
| K2 | After 2 weeks dogfood of T0, hard-entity link rate on packing-shaped captures does not move (or false hard links rise) | Piggyback failed; second model is not the answer either |
| K3 | Any push card dismiss/snooze rate &gt; ~40% or even one “wrong trip” trust incident in core users | Push packaging failed |
| K4 | Users’ dominant ask becomes checkboxes / “put it on the list” / progress | Feature is a task app in disguise — constitution kill |
| K5 | Eng time crowds out Atoms Plus or person-hub invite without T0 proof | Opportunity cost kill |
| K6 | Hub invites for trips create empty stubs users delete or ignore | Container path failed (same as person auto-create reject) |
| K7 | Membership thrash from Update notes makes sibling lists feel random | Living graph without stable keys is noise |

**Do not kill:** local group-by-hard-key as a pure helper, or prompt work that improves links. Kill the **product packaging** first.

---

## Decisive recommendation (ordered)

1. **Do not claim** architecture-constellations as written.  
2. **Lock cost rule** (adversarial brief): no second model; UI free.  
3. **Ship spine:** T0 link quality only; fixture eval for named attacks.  
4. **Generalize person doctrine:** hard keys = existing titles; identity/hubs are human-accepted.  
5. **If UI later:** pull sibling list on open member/hub; temporal decay; many-to-many keys.  
6. **Home Together card:** only after T0+pull dogfood, and only if discovery gap is real.  
7. **Keep consolidation maps** as the separate v2 answer to epistemic sediment — not a sequel of packing Together.  
8. **Priority:** Plus + person-hub invite still ahead of packing theater.

---

## One-line architecture rewrite (if this review is accepted)

> When atoms share a **user-real hard entity title**, improve those **links** on classify; optionally show **siblings on open**. Do not invent a Constellation product, home shelf, or second model until link precision is proven — and never merge bodies or build a packing app.

---

## Next decision needed

Product owners: **accept progressive-trust spine (T0 only) vs keep architecture’s P0+P1 Together package.** If T0-only, demote `architecture-constellations.md` winner section and treat home Together as explicit non-goal until eval.
