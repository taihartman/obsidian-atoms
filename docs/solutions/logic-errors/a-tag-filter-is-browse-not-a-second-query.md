---
title: "A tag filter is browse, not a second query"
date: 2026-08-30
category: logic-errors
module: ask-search
problem_type: logic_error
component: plus-service
severity: high
symptoms:
  - "search_atoms with tags returns fewer hits than the tag pool"
  - "Host presents a truncated person list as complete"
  - "A tagged atom with no query tokens never appears"
root_cause: logic_error
resolution_type: code_fix
tags:
  - ask
  - search_atoms
  - tags
  - agent-honesty
  - truncation
related:
  - docs/solutions/features/ask-search-silent-empty-and-index-expand.md
  - docs/solutions/logic-errors/an-opener-stop-rule-must-name-the-tool-it-stops.md
  - docs/plans/2026-08-30-1219-fix-ask-tagged-search-truncation-plan.md
---

# A tag filter is browse, not a second query

## Problem

`search_atoms` applied the #331 relevance floor *after* the tag filter. A `person` browse with a generic query dropped tagged notes that shared no query tokens. The payload then looked complete: `returned: 5`, `limit: 25`, `scope_note` about mirror partiality, nothing about the cut.

## Symptoms

- `tags: ["person"]`, query `person met name`, limit 25 → five atoms whose bodies contain `met`. John (porch neighbor, tagged `person`, no `met`/`name` in title or body) absent.
- `search_atoms(query: "John")` finds him immediately.
- Host, under one-look, lists those five as all recent contacts.

## What Didn't Work

- Treating tags as an extra query constraint that still has to clear coverage. Tag membership on a multi-word query is only one of N content words, so coverage stays below 0.5 and confidence is null.
- `scope_note` as the honesty field. It talks about vault vs mirror, never about floor truncation.
- Created-only ranking when tags are present. That would break `search_atoms(query: "CRG", tags: ["person"])`.

## Solution

When `tags` is non-empty, skip the absolute and relative floors. Every atom that carries all requested tags is eligible up to `limit`. Rank by score, then `created` desc. Rows kept only as tag members carry `match_signals: ["tag_scope"]` and `confidence: "medium"`. Untagged search keeps the floor.

Every search payload includes `omitted_below_threshold`, `omitted_by_limit`, and `tag_pool`. Recency / "all people" still routes to `list_atoms`. One look still forbids a second `search_atoms`; `list_atoms` is an allowed follow-up.

Code: `plus-service/src/store/askHelpers.mjs` (`rankSearchHits`), `plus-service/src/mcp/tools.mjs`, `plus-service/src/mcp/instructions.mjs`.

## Why This Works

A caller who passed `tags` already scoped the set. The floor exists to hide coincidences in an unscoped search. Applying it inside a tagged pool hides members of that pool and produces a confident-looking partial list. Query ranking still puts topical matches first.

## Prevention

- Fixture: a tagged atom whose title and body share none of the query tokens must still return under that tag.
- Tagged topical search still ranks query matches above `tag_scope` fills.
- Untagged AE1 junk still empties.
- Payload tests lock the three truncation fields on empty and non-empty responses.
- Opener names `list_atoms` next to `fetch_atom` / `list_tags` / `mirror_status`.
