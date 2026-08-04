# Atoms — MCP Handoff

**Date:** 2026-08-04  
**Context:** Session where Claude (custom connector, `https://plus.tryatoms.app/mcp`) failed to find recently-logged atoms. Root-caused to an account mismatch. Surfaced several tool-surface gaps along the way.

**Related shipped work:** #251 / #252 (pairing code + OAuth identity chooser · 0.6.66). Explicitly out of scope there: MCP `whoami`, auto-merge of wrong-email partitions.

**Issues filed 2026-08-04:**

| Pri | Issue | Title |
|---|---|---|
| P0 | #255 | `mirror_status` / whoami |
| P0 | #256 | `list_tags` |
| P1 | #257 | `created` + list sort/filter |
| P2 | #258 | `list_pending` |
| P2 | #259 | qualify `exists_outside_mirror` / `scope_complete` |

---

## 1. Incident: silent wrong-account reads

### What happened

Claude asked about recent `#bug` atoms and reported none existed. They did exist — Claude was reading a different account's mirror.

Observed state during the failure:

| Source | Atom count | Last sync |
|---|---|---|
| Obsidian plugin settings | 56 | "last pushed 1h ago" |
| MCP connector (`list_atoms`) | 44 | `2026-07-28T02:28:42Z` |

`fetch_atom` on an exact known title returned:

```json
{
  "error": "not_found",
  "reason": "not_in_mirror",
  "exists_outside_mirror": false,
  "backlink_count": 0
}
```

### Root cause

The connector's OAuth token resolved to a different account than the one the plugin was pushing to. Not a sync lag — two separate mirrors.

### Why it was expensive to diagnose

Nothing on either side surfaced the mismatch. The plugin showed a healthy count and a recent push. The MCP returned a well-formed, internally consistent snapshot. Both were telling the truth about *different* accounts, and neither exposed *which* account.

The failure mode is worse than an error: Claude confidently asserted "you have no bug atoms" from stale data. Silent wrong-data beats loud failure every time — and here it produced a false negative on the user's own vault.

### Fixes worth considering

- **Surface the account identity in both surfaces.** Plugin settings should show the account the push targets; MCP responses should include the account it reads. A visible mismatch is self-diagnosing.
  - **Partial ship (#251):** Settings now show `Ask mirror: N · as you@… · last pushed …` + pairing code / identity chooser. **Still open:** MCP-side account identity (`whoami` / `mirror_status`).
- **`exists_outside_mirror: false` was misleading.** It's technically scoped to the mirror the token can see, but reads as "this note does not exist anywhere." Consider renaming or qualifying it.
- **Consider a staleness warning** in the plugin when server-confirmed sync age exceeds some threshold — "last pushed" currently reflects the attempt, not a verified server state.

---

## 2. Missing tools / API gaps

Ranked by how much friction they caused in one session.

### P0 — `mirror_status` (or `whoami`)

No way to ask "which account am I reading, how many atoms, when did it last sync." Today `mirror_count` only leaks out as a side effect of other calls, and account identity is invisible entirely.

This single tool would have collapsed the incident above from five exchanges to one call. Suggested payload: account identifier, `server_count`, `last_synced_at`, `pending_writes`, `mirror_scope`.

### P0 — `list_tags`

First search used `tags: ["bug"]` and returned zero. There was no way to distinguish *"no such tag exists"* from *"tag exists, nothing matched"* from *"tag exists but is unsynced."* All three look identical.

A tag vocabulary with counts makes tag-filtered search self-correcting, and would have ended the confusion immediately.

### P1 — Creation timestamps in list/search results

`list_atoms` exposes only `synced_at`. The `created` field exists in note frontmatter but never reaches the mirror.

Consequence: **"what are my newest atoms" is currently unanswerable.** Client could only report push order, which is wrong — a bulk re-push stamped 30 atoms with timestamps inside a 7-minute window, none of which reflected when they were written.

### P1 — Sort / filter / date-range on `list_atoms`

Current params are `limit` (max 50) and `offset` only. To find recent atoms, paginate the entire vault and sort client-side. At 60 atoms that's two calls; at 600 it stops being viable.

Wanted: `sort_by` (created | modified | synced), `order`, `created_after` / `created_before`, `tags` filter.

### P2 — `list_pending`

`cancel_pending` requires an `outbox_id` returned by `create_atom` / `continue_atom`. Nothing enumerates pending writes. If the id is lost across a session boundary, the queued write becomes uncancellable.

### P2 — `scope_complete` is always `false`

Because the mirror covers `Atoms/` plus linked hubs only, negative answers can never be fully trusted. Either widen the scope optionally, or give the flag a path to `true` so negative answers can be trusted.

---

## 3. What's working well — don't regress this

- **Append-only revision model.** `continue_atom` never mutates a parent; typed relations (`continues` / `revises` / `contradicts` / `adds_detail`) plus `status: live|superseded|contradicted` on every atom.
- **`neighbors` output quality.** Outgoing links carry human-readable `reason` strings.
- **`snippets: false`.** Forcing `fetch_atom` before content claims is a deliberate anti-hallucination guardrail.
- **Error payload richness.** `not_found` returning `reason`, `mirror_count`, `mirror_scope`, and a hint is why the incident was diagnosable at all. The gap was *which account*, not detail level.

---

## 4. Separately: two open `#bug` atoms in the vault

Both are inbox-processing issues, possibly related:

1. **Bug- inbox over-classifies items as noise, misses Nichita tag** — inbox too aggressive classifying items as noise; failed to tag a Nichita item with `Nichita`.
2. **Auto-file inbox note on Obsidian resume without force-close** — inbox notes should file when Obsidian resumes; currently requires a force-close. (`#app #bug #idea`, quality 8, created 2026-07-30, generated-by: linker)

Related open Issue for (2): [#222](https://github.com/taihartman/obsidian-atoms/issues/222) / draft PR #223 (`feat: catch up on resume`).
