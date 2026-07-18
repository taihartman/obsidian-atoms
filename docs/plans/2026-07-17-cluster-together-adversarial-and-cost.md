# Cluster / Together — adversarial view + AI feasibility + cost

**Date:** 2026-07-17  
**Question:** Is “together” (packing-style clusters across nights of auto-run) worth building, can current classify do it tastefully, and what does it cost?  
**Status:** product brief (not claimed; not implementation plan)  
**Mocks:** `docs/design-handoff/atoms-view/cluster-together.html`  
**Cousins:** person-hub invite brief · media enrich · cut `append` · land-then-remember

---

## Recommendation (up front)

| Layer | Verdict |
|---|---|
| **Core idea** | Keep. Sporadic atoms + one calm “see them all” is real second-brain value. |
| **Ship now** | **No** as a full feature. Atoms Plus + person-hub invite still higher leverage. |
| **Ship first slice (cheap)** | **Yes when free:** stronger cluster *links* inside the classify you already pay for + **local** threshold UI. |
| **Extra AI calls** | **Do not.** Second model pass for clustering is a cost and latency tax for little gain. |
| **Checkboxes / append / folders** | Stay out. Same rejections as before. |

**One-liner:** Intelligence in links you already buy; Together is a **local view** over those links; never a second paid brain.

---

## What “this” is (scoped)

1. Captures about the same trip / list / entity file as **separate atoms** over nights.  
2. System **links** them into a shared node (existing note or soft entity).  
3. When the cluster is real, home offers **Together** (title list) and optionally **Make {hub}?**  
4. Bodies stay separate. No merge. No folder intelligence. No packing app.

Nightly auto-run makes (2)+(3) more important than “invite at Process for a multi-item batch.”

---

## Steelman (why it is good)

- **Matches real capture:** people dump one item when they remember it, not a full packing session.  
- **Honors non-negotiables:** flat atoms, body sacred, graph over folders.  
- **New-user aha:** library looks random until “Yosemite packing · 3” appears.  
- **Fits auto-run:** work compounds while silent; UI speaks once on calm home.  
- **Same family as person hubs / media:** discover + link; invite containers; never silent invent.

---

## Adversarial view — what breaks

### 1. False clusters are worse than sparse library

| Attack | Failure mode |
|---|---|
| “board games” for game night + camping pack | One fake “Yosemite packing” shelf |
| Two trips both “camping” | Merged constellation |
| Japan 2024 packing + Japan 2026 | Wrong year hub |
| Generic #list dumps | Everything becomes “Together” noise |
| Model links everything to Camping | Threshold fires on unrelated trail notes |

**Rule:** wrong Together card destroys trust faster than missing one. Default = silence.

### 2. Nightly auto-run has no audience at file time

Land peak shows last night’s titles, not the multi-day set.  
If we only hook “after Process,” auto-run users never see the magic.  
**Must** be **home-time cluster detection**, not process-toast theater.

### 3. Container vs claim title tension

Atoms titles are claims. Hubs are containers (`Yosemite packing`).  
Mixing them in the library without clear UX confuses “what is an atom?”  
Person hubs already live in this middle — packing hubs amplify it.

### 4. Checklist / task gravity re-enters through the side door

Together → checkboxes → “3 of 7 packed” → guilt queue.  
That path fights “second brain, not task app.” Gate hard.

### 5. Append expectation gap

Users will open Together and ask “why isn’t bug spray *on* the list note?”  
Link-only v1 must be honest in copy: **titles gathered, bodies stay where they are.**  
If we never plan append-with-preview, say so in the invite.

### 6. Hub invite Sync pollution

Same as person hubs: empty packing hubs after “Create” on a bad cluster = Sync forever clutter.  
**Human accept only.** Rate limit 1 invite / session. Dismiss per entity.

### 7. Cost / Plus double-charge temptation

“Run a clustering model over recent atoms” or “re-classify when hub appears”  
→ burns filings, hurts margin, trains “AI for every nicety.”  
Reject second pass for v1.

### 8. Scope creep into Collections product

Permanent Collections tab, MOC browser, folder mirrors, multi-select merge.  
Home IA already rejected Links-as-tab. Together is a **card + open**, not a new app mode.

### 9. Detection without trip name is mostly hopeless

“bug spray, hat, pants” with no Yosemite/Japan string →  
only soft Camping links, **no** Together card.  
That is correct, not a bug — but product marketing must not promise “we always assemble packing lists.”

### 10. Multiplayer / two humans

Shared vault: whose trip? Name collisions.  
Same caution as person identity.

### 11. Update notes refile can rewire clusters

Update re-classify may change links; Together membership shifts.  
Accept as living graph; don’t freeze bad edges forever without user dismiss.

### 12. Agent / dogfood vault lanes

Unattended hub creates on Remote Vault = collab violation.  
Invite UI creates only on human tap.

---

## Are we missing anything?

| Gap | Why it matters |
|---|---|
| **General archetype, not packing** | Recipes, gift dumps, reading lists share the same machinery. Packing-only code rots. |
| **Entity extraction quality** | Together needs a stable key (trip title / hub title), not “feels packing-ish.” |
| **Threshold policy** | ≥3 atoms + shared hard link target (or exact entity string). Soft #camping alone is not enough. |
| **Surfacing schedule** | Home open / post-land dismiss — not every classify. Max 1 cluster card / session. |
| **Dismiss / snooze** | Per entity, device-local (person-hub pattern). |
| **Open target** | In-home title list vs open hub note + rely on Obsidian backlinks (phone backlinks UX is weak → prefer in-home list). |
| **Relationship to land peak** | Land peak = tonight’s filings. Together = multi-night constellation. Do not conflate. |
| **Relationship to For you** | Together is not a guilt cue. Never “you still have packing to review.” |
| **Metering story** | Document: cluster UI is free; only classify you already run costs. |
| **Eval set** | Named failure modes: false trip merge, game-night vs camp, year collision, no-entity silence. |
| **Priority vs Plus / person hub** | Do not block paid filing or person invite for packing theater. |

---

## Can current AI do this tastefully?

**Yes for links. Maybe for invites. No for perfect packing intelligence.**

### What we already have

| Capability | Today |
|---|---|
| Model sees **all note titles** in context | `MetadataContextProvider` → classify prefix |
| Prompt steers relate / revise / people / media | `classify.ts` system + enrich |
| Local post-repair | people, media (link only if title exists), linkQuality, ideaRescue |
| No second model for enrich | Free CPU after one classify |

### What works well enough (prompt + local)

1. **Better links on the same classify call**  
   Prompt addendum: list-shaped / packing / trip dumps → link existing packing/trip/camping titles when present; reason names the trip.  
   Local enrich: if capture matches packing-ish heuristics AND vault has titles matching trip tokens, reinforce link (mirror media enrich).

2. **Cluster membership without AI**  
   After many atoms exist: group by **shared hard link target** or shared exact entity in links[].  
   Count ≥ N → Together card. Pure vault graph math. **$0.**

3. **Hub invite**  
   Same as person: local signal “3 atoms link to soft Camping but share extracted entity Yosemite and no hub” → invite.  
   Create on tap only. **$0** create.

### What current AI will get wrong (accept or gate)

- Inventing trip names not in the capture  
- Over-linking to broad hubs (Camping, Travel)  
- Treating any bullet list as packing  
- Year / trip disambiguation without dates in text  

**Tasteful control:** high precision, low recall. Silence on doubt. Human invite for containers.

### What we should not ask the model to do

- Second “cluster this week’s atoms” API call  
- Rewrite bodies into master lists  
- Choose folders  
- Emit checkbox markdown  
- Rank “completeness” of a packing list  

### Model class

Sonnet-class classify (BYOK or Plus) is enough for link quality if context titles include packing/trip notes.  
Haiku-only clustering pass is still an **extra** call — avoid for product reasons, not just quality.

---

## Cost analysis (load-bearing for all future AI features)

### Unit economics today (simplified)

| Path | Anthropic cost | Plus filing unit (planned) |
|---|---|---|
| Classify capture (Process / auto-run / paid Preview) | Yes (cached prefix + capture) | 1 filing when classify runs |
| Local enrich (people/media/linkQuality/rescue) | **No** | **No** |
| Home UI / Together view / backlink list | **No** | **No** |
| Hub file create on user tap | **No** | **No** |
| Second model pass “find clusters” | **Yes** | Would need a rule (should be **0** product choice) |
| Re-classify all cluster members when hub created | **Yes × N** | Expensive; avoid |
| Update notes refile | Yes per atom | Counted |

### Cost of *this* feature if built right

| Slice | Marginal AI cost | Marginal Plus cost |
|---|---|---|
| Prompt tweak for packing/trip linking | ~0–few % tokens on existing call (title list already in prefix) | **$0** extra filings |
| Local enrich reinforce | $0 | $0 |
| Together card + open list | $0 | $0 |
| Hub invite + create stub | $0 | $0 |
| Bad design: nightly cluster job over library | **High** | Burns cap / margin |
| Bad design: refile whole cluster on hub create | **High** | N filings surprise |

**Prompt token note:** vault title list is already in the cached prefix. Adding a short “list/trip linking” rule is cheap relative to titles. Growing title lists is the real cost driver long-term (ContextProvider shortlist) — clustering UI does not fix or worsen that much.

### Policy recommendation for *all* new AI-ish features

Adopt as constitution-adjacent product rule:

1. **Prefer local enrich + graph** over a new model call.  
2. **Piggyback** on classify you already run; never a dedicated “feature model.”  
3. **One capture → at most one paid classify** per change of inputs (Plus R14 spirit).  
4. **UI that reads the vault is free** — always.  
5. **If a feature needs its own model call**, it needs an explicit cost gate (estimate, cap, or Plus unit) before plan approval.  
6. **Silent auto-run** must not multiply calls (no “also cluster” after each night’s batch).

Together **passes** this bar only as local + prompt piggyback.  
Together **fails** if it becomes a clustering agent.

### Future cost pressure (name it now)

| Pressure | Mitigation |
|---|---|
| All-titles prefix grows | Shortlist / BM25 ContextProvider (already architecture “later”) |
| Plus 150 filings/mo | Don’t spend filings on niceties; spend on classify quality |
| Users expect free magic | Market Together as “from notes you already filed,” not “AI packing assistant” |
| Eval / bakeoff | Measure link precision on packing fixtures offline (`spike:api` / fixtures), not live double-calls |

---

## Tasteful architecture (if / when)

```
classify (existing, 1 paid unit)
  → prompt: trip/list linking when titles exist
  → local enrich: reinforce packing/trip links (like media)
  → write atom + marker

home (free, on open / after land dismiss)
  → scan recent atoms’ links for clusters
  → if |cluster| ≥ 3 and hard entity: show Together card
  → Open: title list (no API)
  → optional: Make hub? (create file on tap, no API)
```

No new verdict. No append. No folder placement.

---

## Priority vs other work

| Work | Why ahead or behind |
|---|---|
| Atoms Plus managed filing | Unblocks people who never file — higher than packing UX |
| Person hub invite | Same pattern, clearer entity, already briefed + mocked |
| Link quality / false edges | Trust base for any cluster |
| **Together v1 (local)** | After person-hub invite pattern ships once |
| Checkboxes / append | Last, if ever |

---

## Missing decisions before any claim

1. Threshold: N=3? shared **exact** link title required?  
2. Soft hubs only (`Camping`) — Together or never? (**Recommend never** without trip entity.)  
3. Open = in-home list only vs also create hub file.  
4. General name: “Together” / “Related” / entity title only.  
5. Cost rule locked: no second model call (yes/no).  

---

## Bottom line

- **Idea:** sound, especially under nightly auto-run.  
- **Adversarial:** false clusters, task gravity, append expectations, silent empty hubs, scope creep.  
- **AI:** current classify + local enrich is enough for a **sparse, high-precision** version; not enough for a magical packing manager.  
- **Cost:** **near-zero** if piggyback + local UI; **painful** if we add clustering calls or mass refile.  
- **Do next (product):** lock the five decisions above; keep mock as exploration.  
- **Do not next (eng):** claim/implement until person-hub pattern and cost rule are settled; do not block Plus.

---

## Related paths

- Mock: `docs/design-handoff/atoms-view/cluster-together.html`  
- Person hub: `docs/plans/2026-07-16-person-hub-creation-adversarial-and-apple-brief.md`  
- Append cut: `docs/spec-amendments.md` § B  
- Plus metering: `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` R14  
- Architecture hard stops: `docs/architecture.md`
