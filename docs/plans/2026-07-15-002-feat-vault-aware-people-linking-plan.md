---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
title: "feat: Vault-aware people linking (tasteful, low-setup)"
date: 2026-07-15
---

# feat: Vault-aware people linking (tasteful, low-setup)

## Product intent

You should not have to “set up Atoms for people.” Capture freely; when a person note **already exists** and the capture uses that note’s **title or alias**, Atoms should **automatically** tag + link so backlinks on that hub fill up over time — with **no Atoms Settings visit**.

**Zero-setup means:** no per-person setup and no Active-tag curation for structural tags. It does **not** mean “infer who is a person across every vault layout.” Prefer exact title/alias match; path allowlist ranks *which* notes are hubs.

**Not the goal:** AI invents a people CRM, moves files into `Alex/`, or rewrites her note.

---

## Grounded in this vault (verified)

Existing structure (examples):

| Path | Role |
|---|---|
| `Personal notes/Social/Alex.md` | Person hub |
| `Personal notes/Social/People.md` | People index (not a hub) |
| `Personal notes/Social/Social.md` | Social area root (not a hub) |
| `Personal notes/Tin.md` | Person hub (under `/Personal notes/`) |

So the “Alex folder” mental model is really **a Social area with person notes**, not necessarily `Alex/` as a directory. The design must treat **basename `Alex`** as the preferred link target (Obsidian resolves `[[Alex]]` to that file).

---

## How it should feel (target UX)

1. Capture: *“Alex likes pajamas / periwinkle”* (name or alias in the text is enough).  
2. Process (auto-run / process / backfill):  
   - verdict **atom**  
   - tags include **person** (and **preferences** when the model chooses — structural, always eligible)  
   - link **`[[Alex]]`** with a concrete reason  
   - body verbatim; file still in flat `Atoms/`  
3. **In-product proof:** dry-run preview and process Notice call out the people link (e.g. `linked → Alex`) — do not rely only on opening the Backlinks panel.  
4. Open `Alex.md` → **Backlinks** also shows the new claim.  
5. You never: create special tags first, create a second hub, or file into a folder.

Chores (*“buy Alex flowers”*) stay **task** / **noise**, not person-pref atoms — and **repair never runs** on them.

---

## Design principles (taste)

| Do | Don’t |
|---|---|
| Infer hubs from **notes you already have** under allowlisted paths | Require a setup wizard or vault-wide “capitalised title = person” |
| Prefer **exact title / basename + alias match** → canonical link title | Hallucinate new person pages |
| Structural tags **always eligible** (`person`, `preferences`, `relationship`) — not auto-applied on every capture | Open-ended auto-applied tag spam (including keyword `#preferences`) |
| Keep **two write types** (atom file + daily marker) | AI folder placement or append-into-Alex |
| Unresolved `[[Name]]` only when no vault match | Auto-create dozens of empty people notes |

**Optional later (out of this plan):** create a single stub hub only when (a) capture is clearly about a proper name, (b) no match, (c) user opted in. Default **off**.

---

## Settled decisions (session)

| # | Decision | Choice |
|---|---|---|
| KTD-P1 | When does link/tag repair run? | **Atom only** — never on `task` / `noise` |
| KTD-P2 | Auto-create missing person hubs? | **No** for this plan |
| KTD-P3 | Hub discovery width | **Path allowlist only** for v1: hubs are person-like basenames under `/Social/`, `/People/`, or `/Personal notes/` (plus denylist). **No** vault-wide capitalised-basename promotion |
| KTD-P4 | Repair aboutness | Inject link only when atom + hub match **and** capture is person-shaped (see §4). Not every incidental name drop |
| KTD-P5 | Preference tags | Model-only for `#preferences` / `#relationship`. Repair may add **`#person` only** when a hub link is injected |
| KTD-P6 | Primary lever | **P3 repair** is the reliability surface. Discovery is a **candidate set for safe matching**, not a second product |

---

## Technical approach

### 1. Discover person hubs from the vault (deterministic)

Build hub records for repair + optional prompt salience:

```ts
type PersonHub = {
  canonicalTitle: string; // preferred links[].note (usually markdown basename)
  matchKeys: string[];    // basename + frontmatter aliases, normalized for match
  path: string;           // source path (local only — never send paths to the model)
};
```

**Inclusion (set semantics — not multi-candidate “resolution”):**

1. Markdown note under path allowlist segments **`/Social/`**, **`/People/`**, or **`/Personal notes/`**  
2. Basename passes **person-like heuristic** (1–3 words, starts with capital, not all-caps acronym, not numeric/date-like, not denylist titles)  
3. **Frontmatter aliases** on those notes expand `matchKeys` only (reuse the same extraction as `collectLinkTargets` in `context.ts` — do not reimplement alias parsing)  
4. Index titles `People`, `Social` (and denylist titles) are **never** hubs  

**Denylist folders/names** (not hubs; separate from path allowlist):  
`Atoms`, `Quick Notes`, `Daily`, `Excalidraw`, `Templates`, `Projects`, `Plans`, `Tags`, `Archive`, `Recipes`, system/dot folders, etc.

**API:**

- Pure helpers: `isPersonLikeBasename`, path allow/deny checks  
- `discoverPersonHubs(files: { path, cache? }[]) → PersonHub[]` — same file+cache shape as `collectLinkTargets`  
- Sort by `canonicalTitle`; default `[]` (not null) when none  
- Cap optional later if measured; **not** a scored “top 100 by signal” system in v1  
- **Basename collision:** prefer allowlisted path; if still ambiguous, **skip auto-repair** for that title (model may still link)

**Out of v1:** vault-wide single-token capitalised basenames (false-hub factory: Cooking, Budget, Health).

### 2. Context + prompt (thin)

- Compute hubs once in `MetadataContextProvider.buildContext` next to `collectLinkTargets`.  
- **`personHubs` on `VaultContext`:** sorted **canonical titles only** (strings), for stable prefix + enrich. Paths never enter the model payload.  
- Empty list: render section with deterministic `(none)` (same empty-marker pattern as titles) so prefix layout stays stable.  
- **Prompt:** tighten existing `## People` rules in `SYSTEM_PROMPT` to prefer hub titles when the list is non-empty; fall back to note titles. Avoid duplicating conflicting people rules. Structural tags already always eligible via `vocabulary.ts`.  
- **Brownfield note:** titles + aliases already ship; dedicated Person hubs section is **salience**, not new linkability. If dry-run already links well after repair-only, keep the section short.

### 3. Classify prompt (behavior, not setup)

- If the capture is about a person matching a hub (title or alias), **must** include `links[]` with the **canonical** vault title and a concrete reason.  
- Prefer `#person` / `#preferences` / `#relationship` when applicable (always eligible — not forced).  
- Do not invent a different spelling of the hub title.  
- Tasks that merely mention a name stay task/noise.

### 4. Post-classify safety net (main lever)

Pure: `enrichPersonLinks(captureText, result, hubs) → result` — **never** changes verdict or title.

**Gates (all required for inject):**

1. `result.verdict === "atom"`  
2. Capture matches a hub `matchKey` (word-boundary, case-insensitive; longest-key-first; handle possessives like `Alex’s` where practical)  
3. No existing `links[]` entry targets that hub’s `canonicalTitle`  
4. **Person-shaped signal** — at least one of:  
   - model already emitted `#person` or `#preferences` or `#relationship`, **or**  
   - capture has clear preference/relationship language about the person (keep lexicon tight; fixture-test it), **or**  
   - capture is primarily a claim *about* that person (title/body centered on them — conservative: if unsure, skip inject)

**On inject:**

- `{ note: canonicalTitle, reason }` — prefer leaving model reason if present; if inventing, use a minimal neutral reason derived from the matched span, **not** bare `about [[Name]]` spam  
- If tags miss `person` → add `person`  
- **Do not** keyword-inject `#preferences`

**Short hubs** (e.g. length &lt; 3): repair only if hub is path-allowlisted (always true under KTD-P3) **and** match is exact token; add tests for short false friends if any hubs are short.

### 5. Write path unchanged in shape

- Still only create under configured flat atom folder + append markers.  
- `[[Alex]]` resolves via Obsidian — **no file move**.  
- Do **not** write into person hub notes.  
- **No settings/schema migration**; allowlist/denylist are code constants. P4 bumps version only (+ privacy copy).

### 6. What we skip (this plan)

| Idea | Why skip now |
|---|---|
| Auto-create person notes | Can pollute vault; you already have hubs |
| Route atoms into Social/Alex folder | Violates flat-atoms invariant |
| Vault-wide capitalised basename = person | False hubs (Cooking, Budget, …) |
| Keyword auto-`#preferences` | Tag spam; model already steered |
| Embeddings / face recognition | Overkill |
| Force user to tag Active list | Structural tags already always eligible |

---

## Implementation units

Ship order favors the reliability lever (KTD-P6). Version rides the last behavior commit.

### P1. Hub discovery (pure + tests)

**Files:** prefer `src/context.ts` helpers or `src/people.ts` if logic/tests would bloat context; `test/people.test.ts` (or context tests)  
**Deliver:** `discoverPersonHubs(files) → PersonHub[]` with path allowlist, denylist, person-like heuristic, aliases via shared `collectLinkTargets` logic.  
**Fixtures:** Remote Vault shapes + **false friends** (`Projects/Cooking.md`, `Quick Notes/…`) expected **out**; empty vault → `[]`.

### P2. Post-classify repair (primary product surface)

**Files:** `src/people.ts` or `src/classify.ts`, tests  
**Deliver:** `enrichPersonLinks` with gates above + mandatory negative tests (task/noise no repair; no dupe links; denylist; word boundary; case → exact casing in `note`; multi-hub only mentioned hubs).

**Single choke-point (required — all three paths):**

1. **End of `classifyCapture` success path** — after invariants + `filterTagsToActive`, using `context.personHubs` (or hub records). Dry-run and interactive process inherit this.  
2. **`runWritePath` fixtureResults** — enrich each fixture result before render/write.  
3. **`applyBackfillResults`** — after `classificationFromBatchLine`, before atom write; pass hubs / `VaultContext` on ApplyBackfill opts.

### P3. Context + prompt wiring

**Files:** `src/types.ts`, `src/context.ts`, `src/classify.ts`  
**Deliver:** `personHubs: string[]` on `VaultContext` (default `[]`); build in `MetadataContextProvider`; stable prefix section with `(none)` when empty; tighten People prompt; keep `buildContextUserMessage` ↔ `renderStablePrefix` lockstep; update SPIKE_CONTEXT + fixtures.

### P4. Version bump + install + privacy copy

**Version:** `0.3.0` (user-visible smart behavior).  
Install Remote Vault + test vault; Settings still shows version for Sync check.  
**Privacy:** extend Settings Privacy / egress wording: stable prefix may include a **derived person-hub title list** (titles only; still Anthropic Messages; still no hub body content or filesystem paths).

---

## Verification

| Check | Pass criteria |
|---|---|
| Unit tests | Discovery picks `Alex` / `Tin` under allowlisted paths; denylists Projects/Quick Notes / index titles |
| Unit tests | Repair adds link + `person` when model omits and person-shaped gate passes |
| Unit tests | Task + “Alex” → no repair; already-linked → no dupe; alias `Al` → note `Alex` |
| Unit tests | False friend `Cooking.md` outside allowlist never a hub |
| Dry-run (live vault) | Capture mentioning Alex shows link + in-preview people callout |
| Process Notice | Mentions people link outcome when repair/model linked a hub |
| Write path | Atom in `Atoms/`; hub gains backlink; hub body untouched |
| No setup | Works without visiting tag settings if structural tags remain |
| Empty hubs | `personHubs=[]` stable prefix + enrich identity |

---

## Risks

| Risk | Mitigation |
|---|---|
| False person hubs (e.g. `Cooking`) | Path allowlist only + denylist; no vault-wide capitalised basenames |
| Over-linking every mention | Atom-only + person-shaped gate + no preference-keyword injection |
| Wrong person association (integrity) | Canonical title from basename; alias match keys; skip on basename collision |
| Prompt cache size | Hub list is a small title subset; cap only if measured |
| Privacy | Classify already sends titles + captures. This feature **labels** a subset as person hubs (semantic amplification). **Titles only in model payload — never vault paths or hub bodies.** Local repair adds no extra API call |
| Mis-triage freezes edges | Markers freeze verdict; atom-only repair cannot promote task→atom. Recover by clearing marker. Prefer under-link to junk edges |

---

## Out of scope

- Resurfacing “Alex prefs this year”  
- Merging duplicate person notes  
- Mobile-only UX  
- Renaming GitHub repo  
- Vault-wide person inference / CRM auto-create  

---

## Deferred / Open Questions

### From 2026-07-15 doc review

- Should task verdicts ever gain soft person links for chore history without becoming atoms? (Current KTD: no.)  
- Multi-person captures: multiple hub links vs primary only?  
- Min length / short-name policy if a real hub is 2 letters under Social?  
- When, if ever, opt-in stub hub creation (already default off)?  
