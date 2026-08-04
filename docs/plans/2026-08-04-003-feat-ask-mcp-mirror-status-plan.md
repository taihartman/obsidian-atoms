# Plan: Ask MCP `mirror_status` + absence wording (#255 / #259)

**Lane:** light  
**Issues:** #255 (whoami), #259 (absence semantics)  
**Branch:** `feat/ask-mcp-mirror-status-whoami`

## Goal

1. MCP tool `mirror_status` returns account email, `server_count`, `last_synced_at`, `pending_writes`, scopes, mirror scope — one call diagnoses wrong-tenant / empty / stale.
2. Absence payloads cannot be read as “not in the vault”: louder `scope_note`, `in_this_mirror: false` on not_found, keep `exists_outside_mirror` for hub-backlink case with clearer sibling `hub_linked_not_synced`.

## Approach

| File | Change |
|---|---|
| `plus-service/src/mcp/tools.mjs` | Register `mirror_status`; clarify fetch not_found fields + hints |
| `plus-service/src/store/askHelpers.mjs` | `scope_note` on `MIRROR_SCOPE_META`; neighbors/out may add `hub_linked_not_synced` |
| `plus-service/src/mcp/instructions.mjs` | Document tool + never claim vault absence |
| `plus-service/test/mcp-mirror-status.test.mjs` | Tool payload + empty mirror + pending count |
| `plus-service/test/mcp-unmisreadable-shape.test.mjs` | `scope_note` assertions |

Reuse `store.mirrorStatus` + `store.outboxPendingCount` (already exported). No plugin/schema change. No Fly schema migration.

## Product call (#259)

Keep `scope_complete: false` always (partial mirror by design). Louder docs + `scope_note` — no full-vault option in this claim.

## Out of scope

- `list_tags` (#256), created/sort (#257), `list_pending` (#258)
- Plugin Settings (done in #251)
- Auto-merge wrong-email partitions

## Done when

- [ ] `cd plus-service && npm test` green
- [ ] Tool returns account matching token email
- [ ] Draft PR `Closes #255` + `Closes #259`
