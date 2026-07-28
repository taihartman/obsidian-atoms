---
title: "Ask mirror parity — vault events + delete + reconcile"
date: 2026-07-27
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
issue: 137
branch: feat/ask-mirror-parity
related:
  - 112
  - 127
  - 134
deepened: 2026-07-27
---

# Ask mirror parity — vault events + delete + reconcile

**Issue:** #137  
**Branch:** `feat/ask-mirror-parity`  
**Lane:** full feature  
**Date:** 2026-07-27  
**Depends on:** Ask read (#112) + write/outbox (#127) shipped  
**Upstream product/arch (approved defaults):**  
- `docs/plans/2026-07-27-004-feat-ask-mirror-parity-product.md`  
- `docs/plans/2026-07-27-004-arch-ask-mirror-sync.md`  
- `docs/qa/2026-07-27-ask-mirror-sync-security-review.md`

---

## Goal Capsule

**Objective.** When Ask is on and Obsidian has been open online, Claude’s copy of vault `Atoms/` stays current — including hand-edits, renames, and deletes — without making Sync now a daily chore. Full cross-device orphan cleanup remains Sync now; background never deletes paths this device never hashed.

**Authority.** Constitution (vault SSOT, body sacred, Atoms/-only egress) > product verdict 004 > this plan > prior Ask plans for sync triggers only.

**Stop conditions.** No CRDT, no bidirectional body sync, no MCP delete-atom, no full-vault/dailies mirror, no conflict UI, no desktop-only watcher, no background sync while Obsidian is killed.

**Product Contract preservation.** Defaults approved 2026-07-27 (session): hybrid C; path-only wire reconcile; 2s event debounce; no extra mirror interval; wipe on valid sess_ even if not entitled; server path allowlist.  
**Doc-review 2026-07-27 (user choice 1):** confirmEmpty + accumulate reconcile + Atoms/-only allowlist + device-local hashes + honest promise locked; **no interval heal (5B)** — Sync now is the self-heal for missed events; **connectivity-restore deferred P1 (6)**; Sync now multi-device warning copy only (7).

---

## Product Contract

### Promise

When Ask is on and Obsidian has been open online, Claude’s copy of `Atoms/` stays current with this vault (hand-edits, deletes, renames). Brief multi-device lag is OK until Obsidian Sync converges; full orphan cleanup is **Sync now**. Not a second library you maintain by hand.

### Requirements

| ID | Requirement |
|---|---|
| R1 | Debounced vault events on configured atom folder: create/modify → upsert; delete → mirror delete; rename → delete old + upsert new |
| R2 | `POST /v1/ask/mirror/delete` `{ paths[] }` sess_ only; idempotent |
| R3 | Sync now = full reconcile: upsert dirty + `keepPaths` orphan delete on server |
| R4 | Background/delta reconcile uses **local hash evidence only**: delete server paths that are keys in `askMirrorHashes` but missing from vault — never full remote inventory delete on non-force sync (events, layout-ready, outbox, Process/Update). No extra mirror interval. |
| R5 | Layout-ready catch-up: one `syncAskMirror({ force: false })` + existing outbox apply when Ask on + session. Must not pass `force: true` on open. |
| R6 | `askMirrorInFlight` single-flight mutex (sibling to `askOutboxInFlight`) |
| R7 | Server allowlist: paths must match `{atomFolder}/*.md` flat (no `..`, no nested, no extra segments) on upsert + delete + reconcile |
| R8 | Wipe allowed on valid `sess_` even when not entitled (exit path); still deletes mirror + outbox + MCP tokens |
| R9 | Same code path desktop + iOS + Android; no desktop-only watcher |
| R10 | Best-effort: mirror failures never fail Process/Update/outbox apply |
| R11 | Settings copy + status line: “Claude sees N · last pushed …”; Sync now = force full refresh |
| R12 | Hash-on-wire deferred; P0 reconcile = **path presence only** |

### Flows

| ID | Flow |
|---|---|
| F1 | Hand-edit atom → debounce ~2s → upsert → Claude fetch shows new body |
| F2 | Delete atom → mirror delete → fetch misses |
| F3 | Rename atom → old path deleted, new path upserted |
| F4 | Sync now → orphans removed even if this device never hashed them |
| F5 | Device that never mirrored path P does not delete P on background reconcile |
| F6 | Process/Update/outbox still push; hash-skip makes double fire cheap |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Edit body in vault → wait debounce → Claude fetch matches |
| AE2 | Delete atom → Claude search/fetch miss |
| AE3 | Rename title/path → old fetch miss, new fetch hit |
| AE4 | Sync now after manual cloud drift → count matches vault |
| AE5 | Second device with incomplete vault runs background/delta sync (events, layout-ready, outbox, Process) → does not wipe paths it never hashed |

### Scope

**In:** delete + reconcile APIs, planner prune, vault watch, sync mutex, settings copy/status, tests, version.

**Out:** CRDT, bidirectional, conflict UI, MCP delete-atom, full vault/dailies, websocket, OS background sync, hubs outside Atoms/, hash-on-wire SSOT, ChatGPT/DIY (#119/#120), **mirror interval heal**, **connectivity-restore catch-up (P1)**.

---

## Planning Contract

### Approved defaults (session-settled 2026-07-27)

| Topic | Default |
|---|---|
| Architecture | Hybrid C — events + local-hash reconcile + Sync now full |
| Wire hash | **No** cross-side hash compare; path presence only |
| Reconcile API | `POST /mirror/reconcile { keepPaths, done }` |
| Event debounce | **2s** coalesce |
| Extra mirror interval | **None** (session 5B: Sync now is self-heal for missed events; layout-ready + events + Process/outbox cover happy path) |
| Wipe entitlement | Allow wipe on valid `sess_` even if not entitled |
| Server path allowlist | Reject non-flat `{folder}/*.md` on upsert/delete/reconcile |

### Key technical decisions

| ID | Decision | Why |
|---|---|---|
| KTD1 | `mirrorDelete(email, paths[])` all backends; idempotent missing | Ghost rows after delete/rename |
| KTD2 | `mirrorReconcileKeep(email, keepPaths)` deletes server paths not in set. **Empty `keepPaths` + done requires `confirmEmpty: true`** or server 400 — never wipe-all on bare empty (failed scan guard). | Sync now full inventory |
| KTD3 | `POST /v1/ask/mirror/delete` + `POST /v1/ask/mirror/reconcile` sess_ only; reject `mcp_`; CORS POST | Match existing mirror HTTP |
| KTD4 | Max 100 paths/delete call (upsert batch parity) | Existing caps |
| KTD5 | Server `assertMirrorPath(path)` — **P0 hardcode flat `Atoms/*.md` only** (`^Atoms/[^/\\\\]+\\.md$`); reject `..`, `\`, NUL, absolute, nested, non-md. Custom `atomFolder` **out of scope** for Ask mirror until account-stored folder exists. Never take folder from request body. | Security review deal-breaker |
| KTD6 | Apply path allowlist to **existing upsert** too (not only new routes) | Close full-vault upload hole |
| KTD7 | Wipe: valid sess_ enough; **remove entitled() gate** on wipe only | Exit path when sub lapses |
| KTD8 | `planAskMirrorDeletes(vaultPaths, lastHashes)` → paths in hashes not in vault. **`askMirrorHashes` must be device-local** (`loadLocalStorage` / `saveLocalStorage`), not synced `data.json` — migrate off settings on first run. | Local evidence prune; multi-device safety |
| KTD9 | Normal sync = upsert dirty + delete `planAskMirrorDeletes` | Background safe |
| KTD10 | Sync now / force = upsert dirty (hash clear optional) + reconcile `{ keepPaths: all vault atom paths, done: true }` | Orphan delete |
| KTD11 | **Reconcile chunking (fail-closed):** client buffers full `keepPaths` and sends **one** reconcile POST with the complete set + `done: true` when ≤500 paths. If >500, server **accumulates** keepPaths per `(email, reconcileSessionId)` across chunks with `done: false` (no deletes), then on `done: true` deletes path ∉ **union** and clears session (TTL abandon incomplete). Never delete against a partial last chunk alone. Test: 600 paths in 500+100 → zero false deletes. | Large libraries |
| KTD12 | Vault events create/modify/delete/rename on plugin main; filter Atoms/ `.md`; debounce **2s**; coalesce path set | Mobile-friendly |
| KTD13 | `askMirrorInFlight` mutex; coalesce requests while in flight | Prevent hash clobber |
| KTD14 | No new mirror interval — layout-ready one-shot `syncAskMirror({ force:false })` + events | Outbox already 60s; arch 004 15s/15min scheduler **superseded** by this plan |
| KTD15 | Settings copy toward “Claude’s copy”; status line count + last success/fail. **Sync now** copy must warn: uses **this device’s** Atoms/ as truth (multi-device incomplete vault can orphan cloud rows). | Product verdict |
| KTD16 | `askMirrorLastSuccessAt` / `askMirrorLastError` device-local (same localStorage lane as hashes). N on status line = **server** `GET /mirror/status` count after last successful sync/status fetch — never label local vault count as “Claude sees N”. | Status line honesty |
| KTD20 | **Missed-event heal = Sync now** (no 15m interval). Layout-ready delta + vault events + Process/Update/outbox are the automatic paths. Document residual: long open session with dropped events may ghost until Sync now or next Process. | Doc-review 5B |
| KTD21 | **Connectivity-restore catch-up = P1** (not this PR). Open/layout-ready still runs force:false delta. | Doc-review 6 |
| KTD22 | **`askMirrorHashes` + stamps in device `localStorage`** (migrate from settings/data.json on first run). Prevents Obsidian Sync from copying evidence maps across devices (F5). | Doc-review 3 |
| KTD17 | Quiet background failures; one Notice pointing at Sync now (dedupe per session) | Mobile spam |
| KTD18 | Outbox apply unchanged pull/ack; after land still calls sync (hash skip + delete prune) | No outbox rewrite |
| KTD19 | Wipe remains nuclear (mirror+outbox+tokens); allowed when sess_ valid even if not entitled | Security + exit path |

### Conflict rules

| Situation | Rule |
|---|---|
| Two devices upsert same path | Last successful upsert wins; vaults converge via Obsidian Sync |
| A deletes; B still has file | Brief ghost OK until B converges + reconcile |
| Background reconcile | Delete only paths in **local** `askMirrorHashes` missing from vault |
| Sync now | Full keepPaths orphan delete |
| Vault vs mirror content | Next vault→mirror upsert wins; never mirror→vault body |

### What NOT to build

CRDT · bidirectional body sync · conflict UI · MCP delete-atom · full-vault watch · websocket · OS background sync without Obsidian · hash-on-wire SSOT · extra mirror poll interval · desktop-only watcher

---

## Implementation Units

> **Arch 004 U-map:** arch U1+U2 store → plan U1; arch U3 HTTP → plan U2; arch U4 client → plan U3; arch U5 planner → plan U4; arch U6 sync → plan U5; arch U7 events (interval dropped per KTD14) → plan U6; arch U8 settings → plan U7; arch U9 dogfood+version → plan U8. Do **not** implement arch 15s debounce or 15min interval.

### U1. Store `mirrorDelete` + `mirrorReconcileKeep`

**Files:**  
`plus-service/src/store/askSqliteMethods.mjs`  
`plus-service/src/store/askPostgresMethods.mjs`  
`plus-service/src/store/memory.mjs`  
`plus-service/test/store-ask.test.mjs` (extend) or `plus-service/test/store-ask-mirror-sync.test.mjs` (new)

**Approach.**  
- `mirrorDelete(email, paths[])` → delete by (email, path); return `{ deleted, missing, count, updatedAt }`  
- `mirrorReconcileKeep(email, keepPaths[])` → delete where email match and path not in keep set; return `{ deleted, count, updatedAt }`  
- Path validation helper shared (KTD5)

**Tests:**
1. Delete existing path → gone; fetch null  
2. Delete missing path → missing++ idempotent  
3. Tenant isolation: A cannot delete B’s path via wrong email arg (email always from session in HTTP — unit still scopes by email)  
4. Reconcile keep [A,B] when server has A,B,C → C deleted  
5. Reconcile empty keepPaths + done **without** `confirmEmpty:true` → 400 no deletes; with `confirmEmpty:true` → delete all mirror rows for email (intentional empty vault only)

---

### U2. HTTP delete + reconcile + upsert allowlist + wipe gate

**Files:**  
`plus-service/src/mirror/http.mjs`  
`plus-service/test/http-ask-mirror.test.mjs`

**Approach.**  
- Extend `isAsk` allowlist: `/v1/ask/mirror/delete`, `/v1/ask/mirror/reconcile`  
- `POST /v1/ask/mirror/delete` `{ paths: string[] }` max 100; each path `assertMirrorPath`  
- `POST /v1/ask/mirror/reconcile` `{ keepPaths: string[], done?: boolean, reconcileSessionId?: string, confirmEmpty?: boolean }` per KTD11/KTD2  
- Upsert: validate each path with **same** allowlist before write (reject, don't strip)  
- Wipe: valid `accountFromSession` only — **no** `entitled()`; still nuclear mirror+outbox+tokens  
- Delete/reconcile/upsert/status/outbox: entitled required  
- Reject `mcp_` on all; email from session only; reuse `checkRateLimit(`ask:${ip}:${email}`)`

**Tests:**
1. delete + reconcile: sess_ ok; mcp_ 401; no session 401  
2. delete max paths / invalid path (`Daily/`, nested, `..`, `\`, absolute, non-md) → 400  
3. reconcile multi-chunk 600 paths → zero false deletes; done:false → no deletes  
4. reconcile empty keepPaths without confirmEmpty → 400; with confirmEmpty → wipe rows only (not tokens)  
5. upsert rejects `Daily/foo.md` and `Atoms/sub/x.md`  
6. wipe works for inactive/not-entitled session; delete still 403 when not entitled

---

### U3. plusClient delete + reconcile

**Files:**  
`src/platform/plusClient.ts`  
`test/plusClient.test.ts`

**Approach.** `askMirrorDelete`, `askMirrorReconcile` mirroring upsert error mapping.

**Tests:** request path/body shape (mock request).

---

### U4. Planner deletes + hash prune

**Files:**  
`src/platform/askMirror.ts`  
`test/askMirror.test.ts`

**Approach.**  
```ts
isFlatAtomPath(folder, path) → boolean  // folder/name.md only; no nested
planAskMirrorDeletes(vaultPaths: Set<string>, lastHashes) 
  → { deletePaths, nextHashes }
// deletePaths = hash keys not in vaultPaths
```
Pure functions; no I/O. Planner + event filter + keepPaths builder all use `isFlatAtomPath` (nested `Atoms/sub/x.md` excluded client-side).

**Tests:**
1. Hash key missing from vault → deletePaths  
2. Hash key present → not deleted  
3. nextHashes drops deleted keys only after caller confirms (function returns both)  
4. Nested path excluded from vault path set / upsert plan  
5. Comment/test: no cross-side hash equality (client FNV ≠ server SHA)

---

### U5. syncAskMirror delta + force reconcile

**Files:**  
`src/plugin/main.ts`  
`src/platform/askMirrorSync.ts` (optional extract if main grows too much)

**Approach.**  
- Add `askMirrorInFlight` + queue-followup flag  
- `syncAskMirror({ force?: boolean })`:
  - gate Ask on + ack + session only (never skip solely because dirty upsert list is empty)
  - list vault atom md paths with **flat** `{folder}/{name}.md` filter only
  - plan upsert (force: ignore hashes for dirty detection, but do **not** clear persisted hashes until full success)
  - plan deletes via `planAskMirrorDeletes` from **pre-sync hash snapshot**
  - upsert atoms (**chunk 100**); delete deletePaths (**chunk 100**)
  - if force: reconcile keepPaths (see KTD11 contract); `done:true` only on committing call
  - **Commit `askMirrorHashes` only after each successful HTTP sub-step**; on any failure leave prior hashes + stamp error
  - on full success: stamp `askMirrorLastSuccessAt`, clear last error
  - on fail: stamp error; Notice once/session → Sync now  
- After outbox apply success: await same sync flight (join in-flight promise; never ack outbox if mirror sync deferred/failed)
- Live landmine: today's early `atoms.length === 0 → return 0` must be removed so force delete/reconcile still runs

**Tests:** pure planner coverage in U4; U5 cases: force + zero dirty still reconciles; empty dirty + non-empty deletePaths; partial failure leaves hashes unchanged.

---

### U6. Vault event scheduler

**Files:**  
`src/plugin/main.ts` (or `src/platform/askMirrorSync.ts`)  
`test/askMirror.test.ts` if pure debounce helper extracted

**Approach.**  
- After settings load + layout-ready: register `vault.on` create/modify/delete/rename  
- Filter: md under clampAtomFolder  
- Debounce **2s**; coalesce paths; single-flight via `askMirrorInFlight`  
- On fire: run delta sync (U5 normal)  
- rename: delete old path + upsert new  
- Do not register only inside home view  
- Skip when Ask off / no ack / no session  

**Tests:** pure filter/coalesce helpers if extracted; else manual dogfood.

---

### U7. Settings copy + status stamps

**Files:**  
`src/settings/settings.ts`  
`src/shared/types.ts`  
`src/plugin/main.ts` (stamp writes)

**Approach.**  
- Types: `askMirrorLastSuccessAt`, `askMirrorLastError` (optional strings in settings)  
- Copy per product doc 004  
- Status line: Claude sees N · last pushed relative  
- Sync now = `syncAskMirror({ force: true })` full reconcile  
- Wipe copy unchanged nuclear honesty  

**Tests:** none required beyond typecheck; copy is UX.

---

### U8. Version + dogfood QA note

**Files:**  
`manifest.json` `package.json` `versions.json`  
`docs/qa/2026-07-27-ask-mirror-parity-dogfood.md`  
`STATUS.md`

**Verify:** version shown in settings; QA checklist **AE1–AE5** (+ F6 Process+edit double-fire) on test_vault only.

---

## Verification Contract

| Gate | Evidence |
|---|---|
| Unit | `npm test` — askMirror deletes/prune; plusClient shapes; store-ask delete/reconcile |
| Plus HTTP | `plus-service` test — delete/reconcile auth + allowlist + wipe without entitle |
| Build | `npm run build` |
| Dogfood | test_vault: edit/delete/rename atom → debounce → status; Sync now orphans; never Remote Vault unattended |

**Execution direction:** test-first on pure planner + store delete/reconcile; then HTTP; then plugin wiring.

---

## Definition of Done

- [ ] AE1–AE5 satisfied on test_vault  
- [ ] R1–R12 implemented  
- [ ] Upsert allowlist closed  
- [ ] Wipe without entitle works  
- [ ] No desktop-only branches  
- [ ] Version bump  
- [ ] PR `Closes #137`  
- [ ] STATUS cleared on merge  
- [ ] Note: plus-service delete/reconcile routes must deploy before/with plugin that calls them (human release coordination — agents do not cut releases unless asked)

---

## Implementation order

1. U1 store delete/reconcile  
2. U2 HTTP + allowlist + wipe gate  
3. U3 plusClient  
4. U4 planner  
5. U5 syncAskMirror  
6. U6 vault events  
7. U7 settings  
8. U8 version + QA  

---

## Appendix — defaults locked

| Topic | Default |
|---|---|
| Architecture | Hybrid C |
| Wire hash | Path presence only |
| Reconcile | `{ keepPaths, done }` + accumulate if chunked; `confirmEmpty` for empty |
| Debounce | 2s |
| Mirror interval | None — Sync now heals missed events |
| Connectivity restore | P1 |
| Wipe | sess_ valid enough |
| Path allowlist | flat `Atoms/*.md` only (custom folder out of scope) |
| Hash evidence map | Device localStorage (not synced data.json) |
| Promise | Best-effort current copy; multi-device lag OK; Sync now for full orphans |

## Appendix — doc-review disposition (2026-07-27)

| Finding | Disposition |
|---|---|
| Chunk accumulate / last-chunk wipe | **Applied** — KTD11 |
| confirmEmpty empty keepPaths | **Applied** — KTD2 |
| askMirrorHashes device-local | **Applied** — KTD8/KTD22 |
| Honest promise | **Applied** — Goal + Promise |
| No interval heal (5B) | **Applied** — KTD20 |
| Connectivity restore (6) | **Deferred P1** — KTD21 |
| Sync now multi-device warning (7) | **Applied** — KTD15 copy |
| U5 no early-return / chunk 100 / prune after ack | **Applied** — U5 |
| Status N = server count | **Applied** — KTD16 |
| Arch U-map / AE5 wording | **Applied** |

## Appendix — authority docs

- `docs/plans/2026-07-27-004-feat-ask-mirror-parity-product.md`
- `docs/plans/2026-07-27-004-arch-ask-mirror-sync.md`
- `docs/qa/2026-07-27-ask-mirror-sync-security-review.md`
