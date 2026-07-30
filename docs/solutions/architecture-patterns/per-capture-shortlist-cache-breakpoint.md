---
title: "Per-capture shortlist must split the cache breakpoint off the titles block"
date: 2026-07-30
category: architecture-patterns
module: classify-context
problem_type: architecture_pattern
component: pipeline
severity: high
applies_when:
  - "Changing classify request shape, cache_control, or ContextProvider shortlists"
  - "Routing Process/preview/backfill through a per-capture or per-chunk title list"
  - "Touching plus-service Anthropic payload construction for classify"
tags:
  - shortlist
  - bm25
  - cache-control
  - anthropic
  - plus-service
  - cost
---

# Per-capture shortlist must split the cache breakpoint off the titles block

## Context

#186 replaced the all-titles classify prefix with a BM25 body-scored shortlist per capture (daily Process/preview) or per calendar chunk (backfill/refresh). The Anthropic prompt still needs a stable prefix for prompt caching. Putting `cache_control` on a block that includes `### Note titles` when those titles change every request is strictly worse than no cache marker: every call pays a cache-write premium and nothing is ever read back.

## Guidance

1. **Two content blocks in the first user message.**
   - Block A (index 0): vocabulary, vault tags, person hubs — byte-stable for the run. **Always** carries `cache_control`.
   - Block B (index 1): `### Note titles` shortlist — volatile. **No** `cache_control` on the daily path.
2. **Chunked catch-up is the exception for titles.** When a whole month shares one shortlist, titles are byte-stable across that chunk — then (and only then) a second breakpoint on block B is correct (`shouldCacheChunkTitles` / `cacheTitles`).
3. **Plus must mirror the split.** `plus-service` builds the Anthropic body server-side. A single cached block that embeds titles reintroduces the write-premium bug for every Plus subscriber on per-capture shortlists.
4. **Do not trust vacuous cache tests.** Asserting “prefix bytes match” by rendering the same context twice passes even when the production path changes titles every call. Pin the real property: block A is stable across different shortlists; block B is not; only A has `cache_control` on the daily path.
5. **Runtime gates hard-code index 0.** Backfill’s `assertBatchUsesHourCache` reads `messages[0].content[0].cache_control.ttl`. Keep the stable block at index 0.

## Why This Matters

Measured on this branch: per thousand captures with the marker left on the full context ~$29; marker removed ~$16; breakpoint correctly split ~$11. Leaving the marker in place is the expensive failure mode, not the cheap one.

## When to Apply

Any change that makes classify context capture-dependent (shortlist, chunk union, dynamic hubs) must re-check where `cache_control` sits. Apply on both the plugin BYOK path (`buildMessagesRequest`) and Plus (`buildClassifyPayload`).

## Examples

**Bad — one cached block including titles (Plus before the fix):**

```js
content: [{
  type: "text",
  text: buildContextUserMessage(ctx), // includes ### Note titles
  cache_control: { type: "ephemeral", ttl: "5m" },
}]
```

**Good — stable cached, titles uncached:**

```js
content: [
  { type: "text", text: buildStableContextText(ctx) + "\n\n", cache_control: { type: "ephemeral", ttl: "5m" } },
  { type: "text", text: buildTitlesText(ctx) },
]
```
