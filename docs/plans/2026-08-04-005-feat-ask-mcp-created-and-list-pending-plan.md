# Plan: Ask MCP `created` + sort/filter (#257) and `list_pending` (#258)

**Lane:** light  
**Issues:** #257 (P1), then #258 (P2)  
**Branch:** `feat/ask-mcp-created-list`  
**Worktree:** `../obsidian_plugin-ask-mcp-created-list`

## Goals

1. **#257** — “What are my newest atoms?” is answerable: mirror stores note `created`, MCP exposes it, `list_atoms` sorts/filters server-side.
2. **#258** — Enumerate non-terminal outbox rows so `cancel_pending` is usable across sessions.

## Unit A — #257 created + list sort/filter

| Layer | Change |
|---|---|
| Plugin `splitAtomMarkdown` / payload | Parse FM `created` (reuse day/ISO rules from home `parseCreatedMs` or shared helper); add optional `created` on `AskMirrorAtomPayload` |
| Plugin hash | Include `created` in content hash so re-sync backfills without body edits |
| `plusClient.askMirrorUpsert` | Type includes `created?: string` |
| `mirror/http.mjs` clean | Pass through `created` when present |
| `askHelpers.prepareMirrorRow` | Persist nullable `created` (normalize to ISO date or day string; invalid → null) |
| DDL sqlite + postgres | `created TEXT` / `TIMESTAMPTZ` nullable + boot migrate `ALTER … ADD COLUMN IF NOT EXISTS` (same IF NOT EXISTS pattern as existing) |
| memory / sqlite / postgres upsert | Read/write `created`; hash skip still uses full hash |
| `rowToPublicAtom` / list item / `shapeFetchAtom` / search hits | Expose `created` when known |
| `mirrorList(email, opts)` | Extend opts: `sort_by: created\|synced\|title` (default **title** for back-compat with today’s ORDER BY title — issue suggested default `synced`; **KTD:** keep default **title** so existing clients unchanged; document). `order: asc\|desc` (default for title stays asc; for created/synced default **desc**). `created_after` / `created_before`, `tags[]` all-must-match |
| Nulls | Missing `created` sorts **last** on created sort (both orders: nulls last) |
| MCP `list_atoms` | Wire new params + return `created` on each item |
| MCP search/fetch | Add `created` field when known |
| Instructions | “newest” → `list_atoms` with `sort_by: created`, `order: desc` |
| Tests | Plugin parse+payload; store sort/filter parity memory+sqlite; MCP list/search/fetch shape; modern-era tools unchanged |
| Version | Plugin patch bump (push field is user-visible via Sync) |

### KTD — default `sort_by`

Issue suggested default `synced`. Live `mirrorList` today orders by **title**. Changing default would reshuffle every existing connector call. **Keep default title ASC** (no new params = identical behavior). New callers pass `sort_by: "created"`.

### Out of scope (#257)

- Sort by vault mtime / modified  
- Changing default list order  
- Auto full-vault re-push (Sync now / next content change backfills via hash)

## Unit B — #258 `list_pending`

| Layer | Change |
|---|---|
| Store | `outboxListOpen(email)` → non-terminal rows after stale reclaim (`pending` + `claimed`), no claim mutation |
| MCP `list_pending` | Requires `atoms:write`; shape `{ pending: [{ outbox_id, kind, status, title, created_at, client_request_id }] }` |
| kind labels | Map store `create`/`continue` → `create_atom`/`continue_atom` (match tool names) |
| `handler.mjs` | Add to `WRITE_TOOL_NAMES` |
| Instructions + runbook | Document; pair with `cancel_pending` |
| Tests | Empty; seed create/continue; exclude applied/cancelled; cross-tenant; insufficient_scope; tools/list |

No plugin bump for #258 alone (ships in same PR after A).

## Done when

- [ ] `npm test` (plugin) + `cd plus-service && npm test` green  
- [ ] Draft PR `Closes #257` + `Closes #258`  
- [ ] Fly deploy after merge  
- [ ] Plugin release only if human asks BRAT (version bumped in tree)

## Hot files

- `src/platform/askMirror.ts`, `src/platform/plusClient.ts`
- `plus-service/src/store/askHelpers.mjs`, `memory.mjs`, `askSqliteMethods.mjs`, `askPostgresMethods.mjs`, `sqlite.mjs` (migrate)
- `plus-service/src/mirror/http.mjs`
- `plus-service/src/mcp/tools.mjs`, `instructions.mjs`, `handler.mjs`
- Tests under `test/` + `plus-service/test/`
