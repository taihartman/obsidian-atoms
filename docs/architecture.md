# Architecture — Obsidian Atoms

Living system map. Implementation detail and unit order live in the plan; this doc is the **shape we protect** so the product stays world-class as it grows.

## Product UI (v0.4+)

**Atoms home** (`ItemView` type `atoms-home`): one mobile-first leaf — recent atom library + dominant waiting card when past captures are unprocessed. Preview reuses dry-run; Process reuses write path. Live **progress card** during Preview/Process (`N of M` + snippet + bar; done summary; auto-run silent). Resurface multi-cue stream on home (mind-change → on-this-day → **named** connected → quiet; soft throttle; no review queue; no shelf label — cue kicker only). Post Process/Update/auto-run (home open): **land peak** (filed titles) freezes resurface until dismiss. Mind-change v2: flat hero with serif-quoted fossil + pair-open (Then / connector / Now). Shared chrome via `src/ui/` kit. Design: `docs/design-handoff/tokens/README.md` (editorial tokens); contribute guide: `docs/components.md`.

## North star

A second brain with three legs:

| Leg | Now | Later |
|---|---|---|
| **Capture** | External (iOS Shortcut → daily note today; Android-capable later) | Still not owned by this plugin |
| **File + link** | This plugin: triage, title, link, mark | Consolidation maps; supersession stays |
| **Resurface** | Stream on home (on-this-day, connected, quiet; belief rehearsal) | Richer cues; still **not** a guilt queue |

World-class here means: **trust the body**, **intelligence in the graph**, **zero guilt UI**, **mobile-primary** (desktop + iOS + Android consumers), **never lossy**.

**Constitution changes** (this north star + `CLAUDE.md` non-negotiables) land only via PR — see `docs/collab.md`.

## Design principles (load-bearing)

1. **Verbatim body** — the model never authors the note body. Titles may be confident; the body preserves hedges and half-formedness (context-rot defense).
2. **Three write types** — (a) new files in flat `Atoms/`, (b) append-only marker lines on past dailies, (c) **user-initiated** in-place refresh of existing linker atoms (Update notes: model surfaces only; body sacred). No rewriting user capture prose, no folder intelligence.
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

**Product stance (0.4.3+):** second brain, not a task app. Classify soft-retires **task** (legacy markers still processed): **atom** for keepable memory including list/media dumps; **noise** for pure logistics. Home library remains atoms-only. Resurfacing stream + collection UIs stay v2.

**Media shape (0.4.4+):** hybrid — prompt steers media dumps; structural tags `watch`/`show`/`movie`/`media`/`list` always eligible; `enrichMediaLinks` post-classify repair adds media tags and **work-title links only when that title already exists in the vault** (no empty stubs).

**Link / idea quality (0.6.6+):** `improveClassificationLinks` rewrites boilerplate reasons (“preference about X”); `rescueKeepableIdea` promotes product/app pitches from task/noise → atom; optional exact `People` index link for workplace-shaped captures without a person hub.

**Entity orbits (0.6.24+):** packing/trip/project-shaped captures may gain **exact** vault entity links via `enrichEntityLinks` (piggyback classify). Soft buckets (Camping, People, …) never form a shelf alone. Home library opens atoms in-place; **Also about {entity} · N** shows sibling titles when ≥3 generated atoms hard-link the same existing note. See `docs/architecture-constellations.md`.

## Module map (`src/`) — hybrid layout

**Layout rule (agents):** new filing logic → `pipeline/` (or `pipeline/enrich/`); home UI → `home/`; shared home presentation → `ui/`; resurface cues → `resurface/`; settings/CTA → `settings/`; device gates → `platform/`; shared types → `shared/`. Wire-up only in `plugin/`.

**Dependency rule:** `pipeline/**` never imports `home/`, `resurface/`, `settings/`, `ui/`, or `plugin/`. Features may import `pipeline` + `shared` + `platform`. `home/` and `resurface/` may import `ui/`. `ui/` must not import `home/`, `resurface/`, `pipeline/`, or `plugin/`.

| Path | Responsibility |
|---|---|
| `main.ts` | esbuild entry — re-exports `plugin/main` |
| `plugin/main.ts` | Plugin lifecycle, home leaf, settings wire, auto-run schedule |
| `plugin/commands.ts` | Command id registration (callbacks → plugin methods) |
| `pipeline/parse.ts` | Capture extent + marker detection |
| `pipeline/context.ts` | `ContextProvider` / titles+tags+vocab |
| `pipeline/classify.ts` | Prompt, cache, schema, invariants, retry |
| `pipeline/render.ts` | Atom markdown + markers + sanitize/collision |
| `pipeline/write.ts` | Write-path orchestration |
| `pipeline/preview.ts` | Dry-run surface |
| `pipeline/backfill.ts` | Batch API + estimate gate |
| `pipeline/atomQuality.ts` | `CURRENT_ATOMS_QUALITY` + eligibility stamps |
| `pipeline/refreshAtoms.ts` | Update notes: free local polish + ranked Process-parity refile |
| `pipeline/parseLinkProse.ts` | Link-prose → structured links (offline polish) |
| `pipeline/daily.ts` | Past dailies / today open helpers |
| `pipeline/vocabulary.ts` | Active / vault / proposed tags |
| `pipeline/enrich/*` | Post-classify repair: people, media, entityLinks, linkQuality, ideaRescue |
| `pipeline/softKeys.ts` | Soft entity denylist (orbits + connected resurface) |
| `pipeline/entityOrbitIndex.ts` / `entityOrbitPolicy.ts` | Hard-key sibling orbits (Also about) |
| `ui/*` | Thin DOM factories for home (button, flatCard, claimQuote, …) |
| `home/*` | Atoms home view + pure library helpers + run progress + Also about |
| `resurface/resurface.ts` | Multi-cue stream / mind-change / throttle / citator lines |
| `settings/*` | Settings tab + capture shortcut CTA |
| `platform/*` | Auto-run gates, connectivity probe |
| `shared/types.ts` | Shared types + defaults |

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

Atom frontmatter: `created`, `source` (wikilink), `generated-by`, `tags`, plus quality stamps `atoms-quality` (int) and `quality-updated` (YYYY-MM-DD) on Process-created and Update-refreshed atoms. Optional `aliases` when sanitization changes the title (KTD8) or title rename needs a back-compat alias.

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

Hard stops: today excluded · no file moves · no append-into-user-notes · no auto-apply proposed tags · backfill behind cost gate · auto-run needs egress ack · **no auto Update notes** (user strip/command only).

## Future architecture (v2 — do not build yet)

These are the world-class gaps **named so we don’t paper over them with v1 hacks**:

1. **Resurfacing stream** — v0.5 multi-cue home card (on-this-day / connected / quiet); further polish still welcome.
2. **Consolidation pass** — map-of-content that *links* same-claim clusters; never rewrites bodies.
3. **Age-on-recall** — quiet cue covers a first cut; richer “stale + no inbound links” still open.
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
