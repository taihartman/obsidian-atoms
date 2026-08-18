---
title: "A derived list filter indexes the whole mirror, not the already-filtered rows"
date: 2026-08-18
category: architecture-patterns
module: plus-service ask mirror
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "Adding a list_atoms (or mirrorList) filter that reads a derived field"
  - "The derivation consults inbound edges (redeems, revises, continues)"
tags: [open-loops, list_atoms, open_now, paginate-mirror-list, inbound-index]
---

# A derived list filter indexes the whole mirror, not the already-filtered rows

## Context

`list_atoms` already projects `open_now` on every row. A consumer that wants "all open loops" had to page the whole mirror. The honest filter is that same derivation (active loop AND no redeeming child) — no new frontmatter, no write path. All three stores already hand list work to one helper.

## Guidance

Put the predicate in `paginateMirrorList` (`plus-service/src/store/askHelpers.mjs`). Memory, sqlite, and postgres `mirrorList` already call it with the same `opts`. Do not copy the filter into each store.

Build `buildInboundIndex` from the **full** public set **before** tags, dates, or the new filter run. A redeeming child may fail those other filters and still close the parent. Shape the page with that same index so the filter and the `open_now` field cannot disagree.

Reuse `attachLoopFields` / `openNowFromLoop` — do not invent a second "is this open?" that looks only at frontmatter.

Absent `open_now` must be a no-op (`typeof opts.open_now === "boolean"`). `false` is the complement, not "unset."

## Why This Matters

If the inbound index is built from rows that already passed `tags` / `created_*`, an active loop whose redeeming child has different tags still looks open. That is exactly the case a scheduled "list open loops" call would get wrong, and it would not show up in a unit test that only plants matching tags on both notes.

Copying the predicate into sqlite/postgres SQL would also drift: `open_now` is not a column. The list SELECT already learned that omitted fields make every shape look empty; a SQL `WHERE loop_json->>'state' = 'active'` would reintroduce that bug for redeemed parents.

## When to Apply

- Any new `list_atoms` / `mirrorList` filter that reads a field `shapeMirrorListItem` already derives
- Any filter whose truth depends on another atom's links (inverse edges)

## Examples

Wrong: filter `tags` first, then `buildInboundIndex(filtered)`, then drop rows whose `loop.state !== "active"`.

Right: `inboundIndex = buildInboundIndex(allPubs)`, then keep rows where `attachLoopFields(pub, revisionStatusFor(pub.title, inboundIndex)).open_now` matches the boolean, then apply tags/dates, then paginate.

The #573 suite includes "redeeming child does even if child fails other filters" and a mutation check that ignores redeeming children — that test must fail.

## Related

- [A list SELECT that omits a field makes every shape look empty](../logic-errors/list-select-must-include-fields-shapes-promise.md)
- Issue #573 (filter); Issue #461 / PR #462 (open_now projection)
