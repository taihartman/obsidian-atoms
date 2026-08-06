---
title: "Ask search_atoms — silent empty after relevance floor + index-time expand"
date: 2026-08-06
category: features
module: ask-search
problem_type: best_practice
component: plus-service
severity: high
applies_when:
  - "Changing search_atoms scoring, confidence, empty hints, or MCP instructions"
  - "Adding recall paths (expand, hybrid, FTS) on the Ask mirror"
  - "Shipping a relevance floor that drops weak lexical hits"
tags:
  - ask
  - search_atoms
  - mcp
  - expand
  - agent-honesty
  - vocabulary-mismatch
related:
  - docs/plans/2026-08-06-004-feat-ask-search-recall-and-agent-honesty-plan.md
  - docs/handoffs/2026-08-06-ask-search-handoff-2.md
  - docs/plans/2026-08-06-002-feat-ask-search-atoms-agent-signal-plan.md
---

# Ask search_atoms — silent empty after relevance floor + index-time expand

## Context

#331 shipped a coverage-aware lexical floor and true empties so agents stop treating score-24 junk as hits. That fixed **false presence**. Handoff #2 found the dual: a **topically correct** atom with **zero shared tokens** (Ross retention vs “how to stop viewers from clicking away”) returns the same clean `results: []` as a true negative. The only brake was the word “lexical” in a hint string — not a machine field agents reliably honor.

## Guidance

1. **Keep the absolute floor.** Suppress null-confidence / weak multi-word junk. Empty is success, not error. Do not reintroduce score-24 noise to “signal” a miss.

2. **Machine-honest empties.** Every `search_atoms` payload (empty and non-empty) carries:
   - `retrieval`: `lexical` | `lexical_expanded` (later `hybrid`)
   - `expand_coverage`: fraction of mirror rows with non-empty expand (0 when expand off)
   - Advertise `lexical_expanded` only when coverage clears a floor — never just because the column exists.

3. **Agent copy:** empty ≠ vault absence; never “you have no notes on X” from one empty search. **Medium expand/body hits are first-class** — do not tell agents to always prefer `high` only (paraphrase hits are medium by design).

4. **Recall before vectors (Phase A):** on content_hash change, clear `expand_enc`, then async-queue Anthropic expand (title/tags/body slice → 3–5 phrases). Store **encrypted** like body. Persist with `WHERE content_hash = ?` so wipe/newer upsert no-ops. Soft-fail leaves empty expand; re-enqueue when hash matches and expand missing. Cap concurrency and per-email rate.

5. **Score expand as a field** (weights below title/tags, above pure body words). `expandStrong` / phrase-in-expand can clear medium and are **exempt from relative floor** so a strong wrong title does not drop the paraphrase hit. Relative floor applies among **medium** peers only (never vs a 1000 title score).

6. **Never put expand text on MCP hits or fetch.** Server-internal for scoring. Privacy ack + self-host must disclose body slices → Anthropic for expand.

7. **Hybrid (dense ∪ lexical RRF)** is Phase B only after a failed paraphrase gate and a constitution reopen (server Ask only — not plugin/on-device).

## Why This Matters

Floor + lexical-only makes failures **silent and confident-looking**. Agents over-claim absence. Expansion attacks vocabulary mismatch without dropping the floor or shipping mobile embeddings. Structured `retrieval` / coverage moves safety out of adjective-in-a-string.

## When to Apply

- Any change to `scoreSearch`, `buildSearchHits`, empty hints, or Ask MCP instructions
- New server-side search side data (expand, vectors): encrypt, wipe with mirror, hash-conditional write, no MCP exfil
- Dogfood that shows empty on a note you know exists under different words

## Examples

**Before (#331 only):** query paraphrase → `[]` + “no confident lexical match…” → agent says user has nothing on retention.

**After (#339):** same query after expand backfill → Ross atom at `confidence: medium`, `match_signals: ["expand"]`, `retrieval: lexical_expanded` when coverage is high enough; true-absent still empty.

**Code anchors:** `plus-service/src/store/askHelpers.mjs` (`scoreSearch`, `buildSearchHits`), `plus-service/src/ask/expandSearch.mjs`, `plus-service/src/mcp/tools.mjs`, `instructions.mjs`.
