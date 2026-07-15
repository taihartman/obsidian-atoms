# Architecture — Obsidian Atoms

Living system map. Implementation detail and unit order live in the plan; this doc is the **shape we protect** so the product stays world-class as it grows.

## Product UI (v0.4+)

**Atoms home** (`ItemView` type `atoms-home`): one mobile-first leaf — recent atom library + dominant waiting card when past captures are unprocessed. Preview reuses dry-run; Process reuses write path. Live **progress card** during Preview/Process (`N of M` + snippet + bar; done summary; auto-run silent). **From the brain** card resurfaces one on-this-day atom (body snippet first; Open / Next; no review queue). Design: `docs/design-handoff/atoms-view/`.

## North star

A second brain with three legs:

| Leg | v1 | v2 |
|---|---|---|
| **Capture** | Already solved (iOS Shortcut → daily note) | Unchanged |
| **File + link** | This plugin: triage, title, link, mark | Consolidation maps; supersession stays |
| **Resurface** | Deferred | Stream (not queue): on-this-day, connected-to-recent, age-on-recall |

World-class here means: **trust the body**, **intelligence in the graph**, **zero guilt UI**, **mobile-primary**, **never lossy**.

## Design principles (load-bearing)

1. **Verbatim body** — the model never authors the note body. Titles may be confident; the body preserves hedges and half-formedness (context-rot defense).
2. **Two write types only** — (a) new files in flat `Atoms/`, (b) append-only marker lines on past dailies. No rewriting user prose, no folder intelligence.
3. **Sentinel idempotency** — processed state is a plugin-owned HTML comment line, not “any wikilink.” Covers atom **and** task/noise (cost + correctness).
4. **Conservative triage** — when in doubt, `noise`. Dry-run is the only human gate before writes.
5. **Device-local control plane** — API key and auto-run flag do not sync; vocabulary and atoms do.
6. **Seams over premature scale** — `ContextProvider` is one function so BM25/shortlist is a swap, not a rewrite.

## Runtime pipeline

```
processInbox(dryRun)
  → getPastDailyNotesWithUnmarkedCaptures()   // never today
  → parseCaptures(note)                       // extent + marker
  → buildContext(capture)                     // ContextProvider
  → classify(capture, context)                // Anthropic structured output
  → render(decision)                          // atom file + marker strings
  → if dryRun: preview only
    else: create atom (if any) + append marker
```

### Verdict table

| verdict | atom file | marker | reprocess? |
|---|---|---|---|
| atom | yes | `↳ [[title]] <!--linker-->` | no |
| task | no | `<!--linker:task-->` | no |
| noise | no | `<!--linker:noise-->` | no |
| unmarked | — | — | yes |

## Module map (`src/`)

| Module | Responsibility | Unit |
|---|---|---|
| `main.ts` | Commands, onload/interval, key resolution, home leaf | U1–U2, U9, home |
| `settings.ts` | SecretStorage UI, vocab, privacy, auto-run | U2, U5, U9 |
| `types.ts` | Shared types + defaults | all |
| `parse.ts` | Capture extent + marker detection | U3 |
| `context.ts` | `ContextProvider` / titles+tags+vocab | U4 |
| `vocabulary.ts` | Active / vault / proposed tags | U5 |
| `classify.ts` | Prompt, cache, schema, invariants, retry | U1, U6 |
| `people.ts` | Person hub discovery + post-classify repair | people 0.3 |
| `preview.ts` | Dry-run surface | U7 |
| `render.ts` | Atom markdown + markers + sanitize/collision | U8 |
| `backfill.ts` | Batch API + estimate gate | U10 |
| `atomsHomeData.ts` | Pure library + wait-card helpers | home 0.4 |
| `atomsHomeView.ts` | Mobile-first Atoms `ItemView` home | home 0.4 |

## Model contract

```jsonc
{
  "verdict": "atom" | "task" | "noise",
  "title": "Declarative claim",      // required iff atom (post-parse invariant)
  "tags": ["from Active vocabulary only"],
  "proposed_tags": ["never auto-applied"],
  "links": [{ "note": "Title", "reason": "revises [[…]] | contradicts | relates…" }]
}
```

**Three trust layers (KTD4):**

1. **Parse** — structured outputs → trust `JSON.parse` of completion text.
2. **Invariant** — atom ⇒ title; non-atom ⇒ no title.
3. **Request** — retry 429/5xx; Notice on 401/403; silent fail otherwise for auto-run.

**Caching (KTD3 default):** stable system + vault context **before** `cache_control`; single capture after. Fork: per-day batch if spike shows better cost/quality.

## Data placement

| Data | Where | Syncs? |
|---|---|---|
| API key | SecretStorage (fallback: device localStorage) | no |
| Auto-run flag + last-run day | `saveLocalStorage` | no |
| Active vocabulary, model, atom folder | `data.json` | yes |
| Atoms | `Atoms/*.md` | yes (vault) |
| Markers | under captures in daily notes | yes (vault) |

Atom frontmatter (exact): `created`, `source` (wikilink), `generated-by`, `tags`. Optional `aliases` only when filename sanitization changes the title (KTD8).

## Safety envelope

```
                    ┌─────────────────────────┐
  daily notes ──►   │  parse (past only)      │
                    └───────────┬─────────────┘
                                ▼
                    ┌─────────────────────────┐
  titles/tags ──►   │  classify (API)         │──► never writes body
                    └───────────┬─────────────┘
                                ▼
              dry-run ──► preview ──► human nod
                                ▼
                    ┌─────────────────────────┐
                    │  write: Atoms/ + append │
                    └─────────────────────────┘
```

Hard stops: today excluded · no file moves · no append-into-user-notes · no auto-apply proposed tags · backfill behind cost gate · auto-run needs egress ack.

## Future architecture (v2 — do not build yet)

These are the world-class gaps **named so we don’t paper over them with v1 hacks**:

1. **Resurfacing stream** — re-show filed atoms without a backlog (antidote to epistemic rot).
2. **Consolidation pass** — map-of-content that *links* same-claim clusters; never rewrites bodies.
3. **Age-on-recall** — surface stale `created` + no recent inbound links.
4. **Context shortlist** — swap `ContextProvider` when all-titles prefix cost degrades (log prefix tokens per run).
5. **Orphan rebuild command** — marker present, file gone; never auto-reprocess on unresolved links (KTD10).

## Quality bar for “world class”

- **Mobile open → filed** with no launch jank; cold `metadataCache` gated (U9).
- **Re-run over fully marked vault = 0 API calls.**
- **Dry-run fidelity** matches write output byte-for-byte on markers/frontmatter shape.
- **Supersession visible** in the graph when a mind changes (R16).
- **User trusts the body over the title** (document in settings / onboarding).
- **Prompt lab = shipped path** (`classify.ts` is not a throwaway script).

## Dev topology

```
repo/
  src/                 plugin source
  test/                unit tests (parse, render, context, classify)
  test_vault/          throwaway Obsidian vault (gitignored)
  docs/                plan, amendments, architecture, MCP setup
  scripts/             spike-api, install-to-vault
```

Obsidian MCP (Local REST API) talks only to the **open vault**. Keep the throwaway vault open when agents drive notes or commands.
