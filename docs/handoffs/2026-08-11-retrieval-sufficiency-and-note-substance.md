# Atoms — Development Handoff

**Date:** 2026-08-11  
**Origin:** Live agent session (Claude via MCP connector). Two failures observed in one conversation. Both are instances of general classes, not one-off bugs.  
**Committed:** this path (durable). Do not treat chat paste as canonical.

---

## Framing

Neither issue below should be fixed at the site where it was noticed. Both are cases where the system knows something it does not express, and a consumer downstream is forced to guess. The fix in each case is to make the known thing explicit and let every consumer — agent, UI, future integration — read it the same way.

Two invariants to build toward:

1. **Nothing that leaves the system misrepresents its own completeness.**
2. **Every note carries a machine-readable claim about how substantive it is.**

---

## Problem 1 — Retrieval output does not carry provenance about its own sufficiency

### What happened

`search_atoms` returned a set of hits with truncated snippets. The agent characterized what those notes contained, and pitched one of them to the user as a ready-to-use asset, without ever calling `fetch_atom`. The characterization was wrong. The tool description already warns that snippets are non-authoritative; the warning did not survive contact with a plausible-looking snippet.

### Why it is general

Any consumer that receives partial content will treat it as whole unless the payload says otherwise. This applies to the MCP agent today, and equally to future clients: mobile previews, search-result lists, digest emails, any third-party integration. A prose warning in a tool description is not a system property. It is a hope.

### Direction

Move sufficiency from documentation into the payload. Every returned fragment should be self-describing:

- A boolean indicating whether the returned text is the complete body.
- A coverage ratio — returned characters over total body characters.
- Truncation at semantic boundaries (sentence or line), never mid-thought, so a snippet is never a misleading fragment of a sentence.

Rule to hold: **any consumer should be able to decide whether it may summarize, using only the response object.** No consumer should need to have read the docs.

### Notes for implementation

- `snippets: false` already exists as a coarse version of this. It is all-or-nothing and forces an extra round trip. The graded signal is what is missing.
- The same fields should appear on `search_atoms`, `list_atoms`, and `neighbors` — anywhere partial content is emitted. Inconsistency here recreates the bug in a new surface.

### Codebase grounding (2026-08-11)

| Surface | Today | Gap |
|---|---|---|
| `makeSnippet` (`plus-service/src/store/askHelpers.mjs`) | Word-boundary window; capture-head preference | No sentence/line end; no ratio |
| `buildSearchHits` | Always sets `snippet_truncated: true` when snippets on | Lies for short full bodies; no `is_complete` / `coverage_ratio` |
| `neighbors` backlinks | Same always-true truncated flag, max 160 | Same |
| `fetch_atom` soft cap 100k | Prose `…[truncated]` only; still `authoritative: true` | No structured completeness |
| `list_atoms` | Metadata only (no body) | N/A for body completeness unless list later emits previews |
| Agent instructions | “snippets non-authoritative; fetch for claims” | Hope, not payload |

Prior art: #150 / #152 (snippet authority + scope), #331 / #332 (confidence + empties), #339 / #340 (retrieval mode honesty). Those shipped authority and scope honesty; **body completeness is still missing**. An older handoff (`docs/handoffs/2026-08-06-ask-search-handoff-2.md`) claimed `snippet_truncated` distinguishes fragment vs complete short atom — **aspirational; code always sets true**.

Shared helper target: one `partialContent({ text, max })` → `{ text, is_complete, coverage_ratio, truncated }` used by search, neighbors, and fetch soft-cap.

---

## Problem 2 — Notes that record an intention are indistinguishable from notes that record substance

### What happened

A note titled *"Newsletter idea- share Claude cowork routine for atoms"* (created 2026-08-05) has a well-formed title and correct tags. Its body records only the intention to write the routine down later. The routine itself was never captured. In every list and search view the note appears as a real asset. It was pulled at the exact moment it was filed for, and it was an IOU.

### Why it is general

This is a whole class, not one note. Any vault built on fast capture accumulates notes whose body is a pointer to work not yet done — "idea to write about X", "should look into Y", "I'll share my routine for Z". They pass every structural check. They fail only at retrieval, and only at the moment of highest cost: when the user has stopped to act on them.

The vault gets less trustworthy as it grows, which is the opposite of the promise.

### Direction

Treat substance as a first-class property of a note, computed at capture and carried through retrieval.

- **At capture:** detect bodies that are predominantly future-tense, self-referential, or pointer-shaped. Do not block the capture — the whole value of Atoms is that capture is frictionless. Prompt once, in the moment, while the content is still in the user's head: *what's the actual thing?* Accepting or declining both resolve; declining marks the note as a stub.
- **In the data model:** persist the distinction. A stub is a legitimate kind of note, not a defect. It should be filterable, countable, and visible.
- **At retrieval:** surface the distinction wherever notes are listed, so a stub never reads as a finished asset. An agent asked for candidates should be able to say "three notes with substance, one stub" without opening all four.

### Design constraints

- Frictionless capture is non-negotiable. Any prompt is one-shot and dismissable.
- Classification should be conservative. False stubs are more damaging than missed ones — a wrongly demoted note is an asset the user stops seeing.
- Stubs are useful. A prompt to finish them later, or a filtered "unfinished" view, converts the class from liability to backlog.

### Codebase grounding (2026-08-11)

**Stub-as-first-class does not exist.** Closest axes today:

- Verdict `atom | task | noise` (task soft-retired)
- Tag `idea` + `rescueKeepableIdea` (product-pitch rescue, not intention detection)
- `atoms-quality` stamp (pipeline generation epoch, not richness)
- Mirror `kind`: `atom | hub`
- Home filters: `all | linked | skipped` only

Frontmatter writers: `src/pipeline/render.ts` (linker), `src/platform/askOutbox.ts` (Ask MCP — no quality stamp). Mirror parse: `src/platform/askMirror.ts`. MCP list/search: no substance filter. No open Issue for stub/intention class yet (#190 is related triage noise, not this).

Capture hooks where a one-shot prompt could live: post-classify enrich (linker path); MCP `create_atom` has **no** classify today — agent-supplied body only.

Constitution tension to resolve in plan: **Body is sacred** (verbatim capture). Stub label must be metadata (FM / mirror field), never a rewrite of the body. Prompt-to-expand is additive capture, not mutation of the IOU text unless the user replaces it.

---

## Shared thread

Both problems have the same shape: **the system possesses the information and does not emit it.** It knows how much of a body it returned. It can tell that a body is a pointer rather than content. In both cases the knowledge dies inside the system and a downstream consumer guesses wrong.

Prefer fixes that expose what is already known over fixes that add new inference. And when adding a signal, add it to every surface that emits notes at once — a signal present on one endpoint and absent on another is how this class of bug reappears.

---

## Open questions

- Should stub detection run on existing notes retroactively, or only on new captures? Retroactive gives immediate value and risks mislabeling a backlog the user already trusts.
- Does the stub signal belong in the note's frontmatter — visible and editable in Obsidian — or only in the cloud mirror? Frontmatter makes it user-correctable, which likely matters more than tidiness.
- Is there a third case: notes that were substantive but have gone stale? Different problem, same family. Worth scoping before the model hardens.

---

## Recommended split (for claim / plan)

| Track | Lane | Scope | Dependency |
|---|---|---|---|
| **A — Retrieval sufficiency** | Light→full if multi-surface + contract change | plus-service only first: honest `is_complete` + `coverage_ratio` on search / neighbors / fetch soft-cap; shared helper; tests; instruction tweak only if flags become truthful | None. Ship alone. |
| **B — Note substance / stub** | Full feature | Product KTDs first (open questions above); FM vs mirror; capture prompt UX; MCP + Home surfaces; conservative detector | Benefits from A (agent can say “stub + incomplete snippet”) but does not require A |

Do **not** fix only the MCP tool description or only one endpoint.
