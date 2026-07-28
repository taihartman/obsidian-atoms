# Ask mirror sync — architecture decision

**Status:** recommendation (not claimed / not implementing)  
**Date:** 2026-07-27  
**Scope:** vault ↔ Plus MCP mirror freshness (read path). Write path (outbox) stays as shipped.  
**Live code cited:** `src/plugin/main.ts` (`syncAskMirror`, `applyAskOutbox`), `src/platform/askMirror.ts`, `src/platform/plusClient.ts`, `plus-service/src/mirror/http.mjs`, `plus-service/src/store/askSqliteMethods.mjs` (+ postgres twin).

---

## Problem (verified against live code)

| Fact | Evidence |
|---|---|
| Vault is SSOT; mirror is search/fetch cache for Claude MCP | Plan D2/D8; MCP tools read `atom_mirror` only |
| Push triggers only Process, Update notes, outbox apply, Settings “Sync now” | `main.ts` ~387, ~937, ~1187; settings Sync now |
| No `vault.on` for mirror (home uses create/modify/delete for UI only) | `atomsHomeView.ts` ~304–306 |
| Upsert is path-keyed; hash-skip local + server | `planAskMirrorUpsert`; `mirrorUpsert` PK `(email, path)` |
| **No per-path delete** — only full `POST /v1/ask/mirror/wipe` | `http.mjs` routes list |
| Rename/delete/hand-edit/other-device Obsidian Sync → stale or ghost mirror rows | No delete API + no watchers + hashes never prune |
| Outbox poll already 60s + layout-ready | `main.ts` ~184–196 |
| Mobile first-class (`isDesktopOnly: false`); network via `requestUrl` | constitution + `plusClient` |

**User-visible failure:** Claude answers from deleted/renamed/outdated atoms until manual Sync (and Sync still cannot remove ghosts without Wipe).

---

## Comparison (5 architectures)

### A. Event watcher only

**How:** `vault.on('create'|'modify'|'delete'|'rename')` filtered to `atomFolder`; debounce → single-path upsert or delete.

| Axis | Score |
|---|---|
| Mobile viability | Good if debounce ≥5–15s and Atoms/-only |
| Battery/network | Low steady-state; spikes on bulk paste/Sync |
| Delete/rename | Correct **when this device sees the event** |
| Multi-device races | **Weak:** Obsidian Sync remote changes often land as create/modify bursts; some platforms under-fire rename; a device that never observed delete never deletes mirror |
| Complexity here | Low–med: mirror home’s debounce pattern; extend `syncAskMirror` for path subset |
| Residual risk | Missed events = permanent drift; no self-heal |

**Verdict:** Necessary but not sufficient.

---

### B. Periodic full reconcile only

**How:** Interval (e.g. 15–30 min) + layout-ready: scan all Atoms/, push inventory, server diffs hashes, deletes orphans, returns missing paths for upsert.

| Axis | Score |
|---|---|
| Mobile viability | OK if rare + foreground-only |
| Battery/network | Medium: full folder read each cycle (hash-skip limits upload) |
| Delete/rename | Correct **if inventory is complete** |
| Multi-device races | **Dangerous:** lagging device with incomplete vault inventory can delete mirror rows that still exist on the leader vault mid–Obsidian-Sync |
| Complexity here | Med: new reconcile API + chunking; no event code |
| Residual risk | Stale until next tick (Claude lag); lagging-device delete storms |

**Verdict:** Good safety net shape; naive “server = exact inventory of whoever called” is unsafe multi-device.

---

### C. Hybrid vault-authoritative (events + local-evidence reconcile + force full)

**How:**

1. **Delta push (fast path):** debounced vault events on Atoms/ → upsert changed paths; delete/rename → per-path delete API.  
2. **Background reconcile (heal path):** compare vault files vs **local** `askMirrorHashes` (what *this device last successfully mirrored*):  
   - in vault, hash changed/missing → upsert  
   - in hashes, not in vault → delete those paths on server + drop hash  
3. **Force Sync now / first enable:** full vault inventory reconcile (user intent = this vault is complete) → server deletes any path not in inventory + upsert mismatches.  
4. Keep existing Process / Update / outbox-apply hooks (cheap no-ops when hashes match).

| Axis | Score |
|---|---|
| Mobile viability | **Best fit** — same code path desktop/phone; debounce + long interval |
| Battery/network | Low: events coalesced; reconcile mostly hash compares; uploads only dirty |
| Delete/rename | Correct on event; healed by local-hash prune even if event missed |
| Multi-device races | **Safe default:** background never deletes a path this device never mirrored. Force Sync is explicit. Last vault content wins on upsert (path PK). Outbox claim lease already serializes Claude→vault writes |
| Complexity here | Med: one delete API + thin planner + plugin scheduler; reuses `planAskMirrorUpsert`, store methods, `plusFetchRequest` |
| Residual risk | Ghost rows until some device that *had* mirrored them runs reconcile, or user hits Sync now / Wipe. Acceptable; Settings can show count drift |

**Verdict:** **RECOMMENDED.**

---

### D. Server-authoritative mirror

**How:** Mirror (or outbox) is SSOT; plugin pulls mirror into vault; Claude writes land server-first as truth.

| Axis | Score |
|---|---|
| Mobile viability | N/A product-wise |
| Battery/network | Pull storms |
| Delete/rename | “Correct” only if server wins |
| Multi-device | CRDT-hard without CRDT |
| Complexity | High rewrite of constitution |
| Residual risk | **Violates vault SSOT, body sacred, no unattended vault mutation from cloud.** Outbox is already the only cloud→vault write and is create-only |

**Verdict:** Reject. Outbox stays one-way create/continue; never reverse-sync body edits.

---

### E. CRDT / multi-writer sync (Automerge, Yjs, path LWW matrix)

**How:** Every atom is a CRDT doc; devices and server merge.

| Axis | Score |
|---|---|
| Mobile viability | Poor (CPU, storage, conflict UI) |
| Battery/network | High |
| Delete/rename | Hard (tombstone epochs, title identity vs path PK) |
| Multi-device | Theoretically strong |
| Complexity here | **Extreme** vs current 5 routes + SQLite row |
| Residual risk | Overkill: mirror is a **cache for search**, not collab editing. Obsidian Sync already merges the vault |

**Verdict:** Reject. Wrong problem class.

---

## Recommendation: **C — Hybrid vault-authoritative**

### Principles

1. **Vault always wins** for atom body/title/tags/links content.  
2. **Mirror is a derived cache** of `Atoms/` only — never a second brain SSOT.  
3. **Deletes require evidence** on background paths (local hash map or explicit vault delete event). **Force Sync** is the only automatic full-inventory delete.  
4. **Same implementation** on desktop, iOS, Android — no desktop-only watcher.  
5. **Best-effort:** never fail Process/Update because mirror push failed (already true).  
6. **No agent unattended personal-vault mutation** — unchanged; this is plugin→cloud only (except existing outbox apply).

### Architecture diagram

```
                    ┌──────────────────────────────────────┐
                    │  Claude / ChatGPT (MCP tools)         │
                    │  search_atoms / fetch_atom / neighbors│
                    └──────────────────┬───────────────────┘
                                       │ read only
                                       ▼
┌─────────────┐   sess_    ┌───────────────────────────────┐
│ Obsidian    │───────────▶│ plus-service (Fly)              │
│ plugin      │  upsert    │ atom_mirror (email,path) PK     │
│             │  delete    │ ask_outbox (create/continue)    │
│  Atoms/ SSOT│  reconcile │ AES-GCM bodies                  │
│             │  status    └───────────────────────────────┘
│             │◀────────── outbox pull/ack (existing)
└──────┬──────┘
       │
       │ vault.on create/modify/delete/rename  (debounced)
       │ + Process / Update notes / outbox apply
       │ + interval reconcile (local-hash evidence)
       │ + Sync now (full inventory)
       ▼
  planAskMirrorDelta / planAskMirrorReconcile
       │
       ├─▶ POST /v1/ask/mirror/upsert     (existing)
       ├─▶ POST /v1/ask/mirror/delete     (NEW)
       ├─▶ POST /v1/ask/mirror/reconcile  (NEW, force path)
       └─▶ GET  /v1/ask/mirror/status     (extend: optional server path count vs local)
```

### Conflict rules

| Situation | Rule |
|---|---|
| Two devices upsert same path, different body | **Last successful upsert wins** on server. Vaults converge via Obsidian Sync; next reconcile re-upserts loser → eventual match to vault |
| Device A deletes atom; Device B still has it (Sync lag) | A: event/hash delete → mirror drops. B: may re-upsert until B’s vault drops file → B hash reconcile deletes again. **Brief ghost OK** |
| Device B never mirrored path P; P deleted on A before B enabled Ask | Ghost until **Sync now** (full inventory) or Wipe. Status copy: “Cloud has N; vault has M — Sync now” |
| Claude outbox create vs local hand-create same title | Existing `planAskOutboxApply` reject / idempotent — unchanged. Mirror after apply |
| Hand-edit body in vault | Event modify → upsert; body sacred (verbatim push of vault bytes after FM split — existing `splitAtomMarkdown`) |
| Rename path | `rename` event: delete old path + upsert new; drop old hash key |
| Disable Ask | Stop push; **do not** wipe (existing privacy copy) |
| Wipe | Existing nuclear: mirror + outbox + MCP tokens |

**Vault always wins** means: server never pushes content *into* existing atom bodies; outbox remains create/continue only; any content divergence is resolved by next vault→mirror upsert.

### API additions (plus-service)

Keep CORS POST/GET only (KTD15). Session `sess_` + entitled; reject `mcp_`.

#### 1. `POST /v1/ask/mirror/delete` (P0)

```json
// request
{ "paths": ["Atoms/Old.md", "Atoms/Gone.md"] }

// response
{ "ok": true, "deleted": 2, "missing": 0, "count": 41, "updatedAt": "..." }
```

- Max paths per call: **100** (match upsert batch).  
- Store: `mirrorDelete(email, paths)` → `DELETE FROM atom_mirror WHERE email=? AND path=?` (sqlite + postgres + memory).  
- Idempotent: missing path counts as missing, not error.

#### 2. `POST /v1/ask/mirror/reconcile` (P0 — force / Sync now)

```json
// request — complete inventory of vault Atoms/ (chunk if needed)
{
  "inventory": [ { "path": "Atoms/Tea.md", "hash": "a1b2c3" } ],
  "mode": "full",           // full = delete server paths not in inventory
  "cursor": null,           // optional pagination token if inventory > limit
  "done": true              // last chunk commits orphan delete
}

// response
{
  "ok": true,
  "matched": 40,
  "stale": ["Atoms/Tea.md"],   // hash mismatch or absent → client must upsert
  "deleted": 3,                // orphans removed (only when done:true && mode:full)
  "count": 42
}
```

- Inventory item = path + **client content hash** (same algorithm as plugin `contentHash` / server `prepareMirrorRow` — today both FNV-style in plugin and sha in server crypto; **P0 must align hash for reconcile** or reconcile only uses path presence for deletes and leaves stale detection to client-side hash map).  
- **Hash alignment note:** plugin `askMirror.ts` `contentHash` ≠ server `mirror/crypto.mjs` `contentHash`. Do **not** compare cross-side without unifying. Safer P0:  
  - **delete orphans** by path set only on `mode:full`  
  - **stale** = paths where server has no row OR client omits path from “unchanged” set; client decides upsert via local `planAskMirrorUpsert`  
  - optional later: store plugin hash in row or send server hash in inventory GET  

**Simpler P0 reconcile (recommended implement):**

```json
{ "keepPaths": ["Atoms/A.md", ...], "done": true }
// server deletes paths not in keepPaths when done
// client separately upserts dirty via existing upsert
```

Skip hash-on-wire until hash SSOT. Client already knows dirty via `askMirrorHashes`.

#### 3. Status extend (P1 nice)

`GET /v1/ask/mirror/status` → add `pathsSample` or just keep `count`; plugin compares `count` vs local Atoms/ file count for Settings drift line.

**No new MCP tools. No pull-mirror-to-vault API.**

### Plugin triggers

| Trigger | Behavior | Debounce / rate |
|---|---|---|
| `vault.on('modify'\|'create')` Atoms/*.md | Queue path upsert | **15s** coalesce (mobile-friendly); flush on blur/unload if possible |
| `vault.on('delete')` | Queue path delete + remove hash | Immediate coalesce **2s** |
| `vault.on('rename')` | Delete old path, upsert new | 2s |
| Process / Update notes success | Existing `syncAskMirror()` + outbox | unchanged |
| Outbox apply success | Existing per-land `syncAskMirror` | unchanged; after delete API, also prune hashes for rejects N/A |
| Layout ready | `applyAskOutbox` (exist) + **one** `reconcileLocal()` | once |
| Interval | `reconcileLocal()` | **15 min** while plugin loaded; skip if Ask off / no session / offline |
| Settings Sync now | `reconcileFull()` = keepPaths full set + upsert all dirty (`force` hash clear optional) | user gesture |
| Enable Ask first time | Offer Sync now (existing UX) → full | user |

Implement scheduler in `main.ts` (or `src/platform/askMirrorSync.ts`) with `askMirrorInFlight` mutex sibling to `askOutboxInFlight`.

**Filter:** only paths under `clampAtomFolder(settings.atomFolder)`; ignore Daily/, etc.

**Obsidian Sync other-device:** remote edits appear as create/modify/delete on this device when Sync lands — events cover most cases; interval heals misses.

### Local planner additions (`askMirror.ts`)

```ts
// existing
planAskMirrorUpsert(files, folder, lastHashes) → { atoms, nextHashes }

// new
planAskMirrorDeletes(vaultPaths: Set<string>, lastHashes: Record<string,string>)
  → { deletePaths: string[]; nextHashes: Record<string,string> }
// deletePaths = keys in lastHashes not in vaultPaths

planAskMirrorKeepList(vaultPaths: string[]) → string[]  // for full reconcile
```

Prune `askMirrorHashes` only after **successful** server delete/upsert ack (same as today for upsert).

### What NOT to build

| Don’t | Why |
|---|---|
| CRDT / OT / vector clocks | Mirror is cache; Obsidian Sync owns multi-device merge |
| Server→vault body sync | Violates SSOT + body sacred |
| Embeddings / FTS rebuild pipeline as part of sync | Orthogonal; search stays ILIKE |
| Whole-vault or Daily/ upload | Constitution R4 / privacy ack |
| Desktop-only `chokidar` / Node fs watchers | Mobile first-class; use `vault.on` only |
| Per-keystroke upsert | Battery; 15s debounce |
| Background full wipe+reupload | Expensive; breaks MCP mid-wipe |
| Delete-via-inventory on every interval | Lagging phone can erase mirror |
| Second hash algorithm on wire without SSOT | Plugin FNV vs server sha already diverge — don’t pretend they match |
| MCP write tools for delete | Claude must not trash vault; delete is plugin→mirror only |
| Changing outbox semantics | Already correct claim/ack/lease |

### P0 vs P1

#### P0 — “Claude stops lying about deleted/edited atoms”

1. Server `mirrorDelete` + HTTP `POST /v1/ask/mirror/delete` (sqlite/postgres/memory + tests).  
2. Server `mirrorReconcileKeep` + `POST /v1/ask/mirror/reconcile` `{ keepPaths, done }` (orphan delete).  
3. `plusClient.askMirrorDelete` / `askMirrorReconcile`.  
4. `planAskMirrorDeletes` + prune hashes.  
5. Extend `syncAskMirror` → `syncAskMirrorDelta` (upsert dirty + delete missing-from-vault-by-hash).  
6. Vault event registration in `main.ts` (create/modify/delete/rename), debounced, Ask-gated.  
7. Sync now = full keepPaths + force dirty upsert.  
8. Layout-ready + 15 min `reconcileLocal` (hash-evidence only).  
9. Tests: unit planner; store delete/reconcile; HTTP tests twin of `http-ask-mirror.test.mjs`.  
10. Version bump + Settings one-line “auto-sync when vault changes”.

#### P1 — polish / multi-device UX

1. Status drift: `mirror.count` vs local Atoms/ count → Notice/Settings.  
2. Unify content hash SSOT (plugin ↔ server) for smarter skip.  
3. Batching/backpressure when Sync dumps 500 files (queue + 100/batch already).  
4. `rename` coverage QA on iOS/Android Obsidian.  
5. Optional: pause mirror push when battery saver / no network (`connectivity.ts`).  
6. Compound learning doc after dogfood.

### Implementation units (aligned with plus-service patterns)

| Unit | Goal | Touch | Verify |
|---|---|---|---|
| **U1** | Store `mirrorDelete(email, paths)` all backends | `askSqliteMethods.mjs`, `askPostgresMethods.mjs`, memory store, `store-ask.test.mjs` | delete idempotent; tenant isolation |
| **U2** | Store `mirrorReconcileKeep(email, keepPaths)` → deletes orphans, returns `{ deleted, count }` | same stores | keep set retains; extras gone |
| **U3** | HTTP routes delete + reconcile | `mirror/http.mjs`, `http-ask-mirror.test.mjs` | 401/403/entitlement; max 100 paths; sess_ only |
| **U4** | Client API | `plusClient.ts` | types + error map |
| **U5** | Planner deletes + keep list | `askMirror.ts`, `test/askMirror.test.ts` | hash prune pure |
| **U6** | `syncAskMirror` gains delete pass + optional full reconcile flag | `main.ts` | force Sync now uses reconcile; normal uses hash deletes |
| **U7** | Event scheduler + interval + mutex | `main.ts` or `askMirrorSync.ts` | Atoms/-only; debounce; no-op if Ask off |
| **U8** | Settings copy + version bump | `settings.ts`, manifest/package | Sync now = full; mention auto |
| **U9** | Dogfood QA | `test_vault` / demo-vault only | hand-edit → wait debounce → status; delete atom → Claude empty; rename; phone Process still pushes |

**Outbox path:** after U6, outbox apply continues to call delta sync (upsert new file); no change to pull/ack.

### Multi-device race cheatsheet

```
Time →
Phone vault        Desktop vault       Mirror
create Tea         (syncing…)          upsert Tea (phone)
delete Tea         still has Tea       delete Tea (phone event)
                   modify Tea          upsert Tea (desktop)  ← brief ghost
                   sync deletes Tea    delete Tea (desktop hash reconcile)
```

Accept brief ghosts; full consistency when every active device has Obsidian Sync caught up and one reconcile cycle runs. Force Sync on any device snaps mirror to **that** vault snapshot — user responsibility if vault incomplete.

### Residual risks (accepted)

| Risk | Mitigation |
|---|---|
| Ghost until device that knew the path reconciles | Sync now; status count drift; Wipe |
| Debounced edit not yet pushed; user asks Claude | 15s bound; Sync now; document “seconds, not instant” |
| 10k atom vault full reconcile payload | Chunk keepPaths 500/req with `done` on last (U3 design) |
| Hash algorithm mismatch | Don’t compare server/client hashes on wire in P0 |
| Double upsert from Process + modify event | Hash skip makes second no-op |
| Outbox apply create fires modify event + explicit sync | Mutex + hash skip |

### Success metrics

- Delete atom in vault → within 30s (debounce+net) mirror status count−1 and MCP fetch miss.  
- Hand-edit body → Claude sees new verbatim body without Process.  
- Rename → old title missing, new title fetchable.  
- Phone-only user: same behavior as desktop.  
- Process latency unchanged (async best-effort).  
- Lagging second device does **not** wipe the mirror on background interval.

---

## Decisive summary

**Build hybrid C.** Extend the existing push cache with **per-path delete**, **force keep-list reconcile**, **debounced vault events**, and **local-hash evidence prune**. Reject CRDT and server-authoritative reverse sync. Vault remains SSOT; mirror remains a Plus-hosted read cache for MCP.

**Next decision for humans:** claim Issue + draft PR for P0 units U1–U8 (or approve this doc as plan authority and assign owner).
