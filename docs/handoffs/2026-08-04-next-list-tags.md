# Handoff — next: Ask MCP `list_tags` (#256)

**Date:** 2026-08-04  
**From:** session that shipped #255/#259 via #260  
**Resume on:** fresh session, `master` after pull

---

## Just shipped (do not redo)

| Item | Detail |
|---|---|
| PR | [#260](https://github.com/taihartman/obsidian-atoms/pull/260) merged → `5ad0132` |
| Issues | #255 + #259 **closed** |
| Fly | `atoms-plus` deploy live — `https://plus.tryatoms.app/health` → `{"ok":true}` |
| Plugin | **No BRAT / no version bump** (plus-service only) |
| STATUS | Clear #255/#259 row (this handoff’s chore PR if not already on master) |

**What landed for agents:**

- Tool **`mirror_status`**: `account`, `server_count`, `last_synced_at`, `pending_writes`, scopes
- **`account`** on search / fetch not_found / list_atoms / neighbors empty
- **`scope_note`**, `in_this_mirror`, `hub_linked_not_synced` (legacy `exists_outside_mirror` kept)
- Instructions: call `mirror_status` early; never claim vault-wide absence

**Human dogfood (optional, not blocking #256):** In Claude connector call `mirror_status` and confirm `account` + `server_count` match Settings → Atoms → Ask line.

---

## Next claim: #256 `list_tags`

**Issue:** https://github.com/taihartman/obsidian-atoms/issues/256  
**Lane:** light (WHAT clear; plus-service only; no schema migration if tags already on rows)  
**Priority:** P0 in MCP gap list (after whoami)

### Problem

`search_atoms` with `tags: ["bug"]` → empty is ambiguous:

1. Tag does not exist in mirror  
2. Tag exists, query matched nothing  
3. Tag only in vault / unsynced  

### Goal

Read-only MCP tool `list_tags`:

```json
{
  "account": "you@example.com",
  "mirror_count": 56,
  "tags": [
    { "tag": "bug", "count": 3 },
    { "tag": "app", "count": 12 }
  ]
}
```

- Sort: **count desc**, then tag alpha (document in tool description)
- Cap if needed (e.g. top 500) — unlikely at current vault sizes
- Include `...absenceMeta()` / `scope_note` for consistency
- Instructions: call `list_tags` before concluding a tag filter found nothing

### Implementation sketch (verify live code first)

| Area | Notes |
|---|---|
| Store | Tags already on mirror rows (`tags_json`). Add `mirrorListTags(email)` on memory + sqlite + postgres (or pure helper over `mirrorList`/internal pubs) |
| Tool | `plus-service/src/mcp/tools.mjs` — register next to `mirror_status` |
| Instructions | `plus-service/src/mcp/instructions.mjs` — read tools list + one rule |
| Tests | Unit: seed tags → counts; empty mirror; tools/list includes `list_tags` (pattern from #260 modern-era assert) |
| Runbook | `docs/runbooks/atoms-ask-connectors-directory.md` — add to `atoms:read` row |
| Deploy | Fly only after merge — same as #260 |

**Do not:** touch plugin version, BRAT, or vault personal data.

### Hard claim checklist

1. Assign #256 to human owner  
2. `git fetch origin master && git checkout -b feat/ask-mcp-list-tags origin/master`  
   (master may be checked out in worktree `obsidian_plugin-ask-coordinator-peel` — branch from `origin/master`, don’t `checkout master` if blocked)  
3. STATUS row + draft PR with `Closes #256`  
4. Short plan under `docs/plans/` (light lane)  
5. Implement → `cd plus-service && npm test` → review → merge → `fly deploy -a atoms-plus -c plus-service/fly.toml --dockerfile plus-service/Dockerfile`

### Hot files (expected)

- `plus-service/src/mcp/tools.mjs`
- `plus-service/src/mcp/instructions.mjs`
- `plus-service/src/store/{memory,askSqliteMethods,askPostgresMethods}.mjs` and/or `askHelpers.mjs`
- `plus-service/test/mcp-*.test.mjs`
- `docs/runbooks/atoms-ask-connectors-directory.md`

### After #256 (backlog order)

1. **#257** — `created` timestamps + `list_atoms` sort/filter (needs plugin push field + store column + re-sync)  
2. **#258** — `list_pending`  
3. Inbox bugs / #222 catch-up on resume (separate track)

### Context docs

- Gap list: `docs/handoffs/2026-08-04-mcp-tool-surface-gaps.md`
- Prior plan pattern: `docs/plans/2026-08-04-003-feat-ask-mcp-mirror-status-plan.md`
- Live tools: `plus-service/src/mcp/tools.mjs`

---

## Session start paste

```
Lane: light
Claim: #256 list_tags
Read: docs/handoffs/2026-08-04-next-list-tags.md + STATUS.md + issue #256
Hard claim then implement; Fly deploy after merge; no plugin release.
```
