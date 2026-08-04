# Plan: Ask MCP `list_tags` (#256)

**Lane:** light  
**Issue:** #256  
**Branch:** `feat/ask-mcp-list-tags`

## Goal

Read-only MCP tool `list_tags` returns this account's mirror tag vocabulary with per-tag atom counts so tag-filtered `search_atoms` empty results are self-correcting (tag missing vs tag present but no match).

## Approach

| File | Change |
|---|---|
| `plus-service/src/store/askHelpers.mjs` | Pure `aggregateMirrorTags(tagLists, { limit })` — case-insensitive merge, count desc then alpha, cap 500 |
| `plus-service/src/store/{memory,askSqliteMethods,askPostgresMethods}.mjs` | `mirrorListTags(email)` → `{ tags, mirror_count }` |
| `plus-service/src/mcp/tools.mjs` | Register `list_tags` next to `mirror_status` + `absenceMeta` + empty hint |
| `plus-service/src/mcp/instructions.mjs` | Name tool; call before concluding tag filter found nothing |
| `plus-service/test/mcp-list-tags.test.mjs` | Counts, empty mirror, sort, case merge |
| `plus-service/test/mcp-modern-era.test.mjs` | `tools/list` includes `list_tags` |
| `docs/runbooks/atoms-ask-connectors-directory.md` | Add to `atoms:read` row |

No plugin, schema, or Fly migration. Tags already on `tags_json`.

## Payload

```json
{
  "account": "you@example.com",
  "mirror_count": 56,
  "tags": [{ "tag": "bug", "count": 3 }],
  "mirror_scope": ["Atoms/", "hub notes linked from atoms"],
  "scope_complete": false,
  "scope_note": "…",
  "searched_fields": ["tags"]
}
```

Sort: **count desc**, then tag alpha. Cap: top **500**.

## Out of scope

- #257 created/sort, #258 list_pending
- Plugin version / BRAT

## Done when

- [x] `cd plus-service && npm test` green (233)
- [x] Draft PR `Closes #256`
- [ ] Fly deploy after merge (no plugin release)
