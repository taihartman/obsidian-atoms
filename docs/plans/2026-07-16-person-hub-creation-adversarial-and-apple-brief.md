# Person hub creation — adversarial view + Apple-world-class approach

**Date:** 2026-07-16  
**Question:** Should Atoms auto-create person hubs (e.g. Ning, Sherry) when captures name people who have no hub note?  
**Status:** product brief (not an implementation plan until claimed)

---

## Recommendation (up front)

**Do not auto-create hub files.**

**Do** ship a calm, opt-in **hub invitation** after filing when we have high confidence a *named person* is missing a hub — one tap creates a minimal stub under the user’s preferred people folder (default Social/People pattern), never silently.

That is the Apple-shaped path: **trust, sparse UI, intentional identity** — not CRM automation.

---

## What “person hub” means in this product

| Layer | Role |
|---|---|
| Capture | Raw life (daily) |
| Atom | One claim (“Ning wears white collared shirts”) |
| Person hub | The *person* as a durable node (`Nichita.md`) — backlinks accumulate |
| `People` index | Soft bucket when no hub exists |

Second brain = **claims orbit people (and works)**, not a flat scrapbook of claims.

Today: hubs are **discovered** from existing notes; we never invent people. Missing hub → soft `[[People]]` (Ning/Sherry case).

---

## Adversarial view — why auto-create is dangerous

### 1. Identity is sacred; false people are worse than missing links

Auto-create on name-ish tokens invents:

- “CRG”, “Penfield”, “High School Musical” as people if heuristics slip  
- Nicknames, typos, one-off first names (“Josh from the test”)  
- Brands and places that look like names  

A wrong hub is **pollution that Syncs forever**. Missing a hub is recoverable. Wrong hub is a trust failure (“who is this empty person?”).

### 2. Empty stubs are not a second brain — they’re clutter

Apple products hate empty objects that demand cleanup. A vault full of one-line `Ning.md` / `Alex.md` with no human intent feels like a broken Contacts import, not a trusted mind.

World-class rule: **don’t create a container until the user accepts the identity.**

### 3. Second brain ≠ CRM / LinkedIn graph

Auto person graph is the gravity well of every failed PKM plugin: relationship managers, birthday fields, “complete their profile.” We already non-negotiably reject task-app gravity. **Auto person creation is the same gravity in a different costume.**

### 4. Mobile + Sync cost

Silent creates on phone = Sync noise, conflict risk, hard-to-undo mass creates after a bad batch Update. Agents/automation replaying Process would multiply stubs.

### 5. Model over-confidence

Classify already hallucinated “unrelated placeholder ([[Nichita]])” on Sherry. Auto-create multiplies model mistakes into **filesystem facts**.

### 6. Adversarial “what breaks”

| Attack | Auto-create outcome |
|---|---|
| Batch Update 50 captures | 20 empty people notes overnight |
| Voice dump “met Jake, Jake, Jake” | One Jake or three? Wrong merge forever |
| “Christian recommended…” | Christian hub even if one-shot media tip |
| User renames / merges people manually | Plugin re-creates old name next run |
| Shared vault / two humans | Name collisions, cultural name ambiguity |

### 7. Steelman for auto-create (fair counter)

| Argument | Rebuttal |
|---|---|
| “Zero friction — graph fills itself” | Frictionless wrong graph is worse than sparse right graph |
| “Users won’t create hubs” | Invitation at the moment of meaning is enough; power users create hubs deliberately (you already have Nichita) |
| “Stub is fine; body comes later” | Empty notes train users that the system is sloppy |
| “We can gate on high confidence” | Confidence on names is still error-prone; gate should be **human accept**, not score alone |

**Adversarial verdict:** Auto-create fails the product’s trust non-negotiables. Reject as default.

---

## Apple world-class implementation (how we *should* do it)

### Design principles

1. **Sparse by default** — no new note unless the user confirms or already created one  
2. **Identity is a choice** — naming a person in the vault is intentional  
3. **One calm moment, not a settings maze**  
4. **Undoable** — create is a single file; delete is obvious  
5. **Mobile-first** — one thumb, one decision, no multi-step CRM  
6. **Matches existing filing language** — “hub” may be internal; user-facing: **person note** or just the name  

### The experience (happy path)

**When (triggers — all must pass):**

- Atom just filed or refreshed (Process / Update), verdict atom  
- Capture is **person-shaped** (existing enrich signals)  
- A **clear display name** was resolved (e.g. “Ning”, “Sherry”)  
- **No hub** matches that name (discovery empty)  
- Soft link was only `[[People]]` or no person hub link  
- **Not** pure media recommendation with only a work title (Christian → MHA can skip person invite unless we also extract Christian as person with high confidence)  
- Rate limit: max **1 invite card per home session** (or 1/day), never a list of 12 “create these people”

**Where:** Atoms home, secondary strip below filing/Update — same calm language as “Filing got smarter”, **not** a modal wall on Process complete.

**Copy (example):**

> **Add Ning?**  
> You filed a note about Ning, but there’s no person note yet.  
> Backlinks will collect here.  
> **[ Add Ning ]**  **[ Not now ]**

Not: “Create person hub entity”, “Sync to CRM”, “Complete profile”.

**On Add:**

1. Create `Personal notes/Social/Ning.md` (or user setting: people folder, default matching discovery boost paths)  
2. Minimal content: title heading + optional `#person` frontmatter — **no fake bio**  
3. Best-effort: re-link the atom that triggered the invite from `People` → `[[Ning]]` (in-place modify of **plugin-owned** reason line only, or re-run enrich for that one atom)  
4. Notice: “Added Ning”  
5. Never batch-create the rest of the queue without separate accepts  

**On Not now:**

- Dismiss for that **name** for N days (device-local), not forever global  
- Don’t shame, don’t re-ask same session  

### What we deliberately don’t do

| Anti-pattern | Why |
|---|---|
| Silent auto-create on Process | Trust + clutter |
| Create hub for every capitalized word | False people |
| Force “fill in birthday / company” | CRM gravity |
| Multi-select “create 8 people” sheet | Homework UI |
| Auto-merge “Ning” / “ning” / “Ning CRG” without user | Identity violence |
| Agent unattended hub creation on Remote Vault | Collab vault-lane rules |

### Confidence gates (implementation sketch)

Only invite when:

- `personName` extracted with high confidence (reuse person enrich / claim title patterns)  
- Name length / shape passes (not “CRG”, not show titles)  
- Not already a denylisted hub title (`People`, `Social`, …)  
- Optional: same name appeared ≥2 times in vault history **or** strong workplace identity capture — **still invite, don’t auto-create**

### Folder placement

- Default: same family as existing hubs (`Personal notes/Social/` if present, else `People/`, else configurable)  
- One setting later: “New person notes go in…” — not required for v1 if we detect Social/  

### Metrics of success (product)

- User accepts ≥ some invites → hubs start to fill  
- Almost zero accidental people notes  
- Nichita-like clusters appear for Ning/Sherry without empty note graveyard  
- Support burden: “why did it create 40 people?” never happens  

---

## Phased rollout

| Phase | Ship | Risk |
|---|---|---|
| **0 (now)** | Document: create `Social/Name.md` + Update | None |
| **1** | Home **Add {Name}?** invite after filing miss | Low |
| **2** | One-tap create + re-point that atom’s person link | Medium (write path) |
| **3** | Optional “review missing people” power list (⋯ menu) | Low if opt-in |
| **Never default** | Silent auto-create on classify | High |

---

## Relation to current code

- `discoverPersonHubs` / `enrichPersonLinks` — keep as SSOT for “who is a hub”  
- `maybeLinkPeopleIndex` — keep as soft fallback  
- `personHubMissAfterEnrich` — already signals miss; wire **UI invite**, not create  
- Update notes / quality stamps — orthogonal; invite is post-file UX  

---

## Decision needed

1. **Reject auto-create** as product default? (recommended **yes**)  
2. **Accept Phase 1–2 invite flow** as next person-graph feature?  
3. User-facing name: **“person note”** vs keep internal “hub”?

---

## Bottom line

**World-class here is restraint.**  
The brain gets smarter when *you* decide Ning is a person in your vault — then Atoms compounds every claim onto that node.  

Auto-create optimizes for graph density.  
**Invitation optimizes for trust.**  

For a second brain that must stay sacred, trust wins.
