# Ask write path — create / continue atoms from Claude

**Issue:** #127  
**Branch:** `feat/ask-write-path`  
**Lane:** full feature  
**Date:** 2026-07-27  
**Depends on:** Ask read path (#112, 0.6.32–0.6.34)  
**Related:** #16 Continue (new atom + link; never rewrite parent body)

---

## Objective

Let Plus users **file new atoms and continue existing ones from Claude** via remote MCP. Vault remains source of truth. Hosted MCP cannot open the phone vault — writes go **outbox → plugin apply → mirror upsert**.

No in-plugin chat. No Process/classify from chat. No rewrite of existing capture bodies.

---

## Problem

Read tools work (search / fetch / neighbors). First dogfood gap: Claude cannot author or amend the brain. Mind-change pairs (e.g. HSM love vs joke) stay manual vault edits. Capture → Process remains the only write loop; chat is recall-only.

---

## Requirements

| ID | Requirement |
|---|---|
| R1 | **P0 tools:** `create_atom`, `continue_atom` |
| R2 | **Body sacred:** new files only; parent body never modified by apply |
| R3 | **Continue = #16:** child atom + reason-bearing link (`continues` / `revises` / `contradicts` / `adds detail`); parent path/title required |
| R4 | **Hosted path:** MCP enqueue outbox; plugin applies under configured `Atoms/` folder; then existing mirror push |
| R5 | **Collision protect:** if target path exists → reject apply (no clobber); MCP returns structured error |
| R6 | **Status honesty:** tool results report `pending` \| `applied` \| `rejected` + `outbox_id`; never claim vault write until apply acks |
| R7 | **Auth:** same MCP bearer as read; Plus active\|trialing; outbox scoped by account email |
| R8 | **Wipe:** existing Ask wipe clears outbox pending for that email + revokes tokens (document) |
| R9 | **Desktop + mobile** plugin consumers both poll/apply (no desktop-only product) |
| R10 | **Privacy copy:** Settings ack/settings blurb states Claude write tools → Plus outbox → vault on apply |
| R11 | **Not P0:** full body replace, append-into-parent, delete, retag-only meta, Process/markers on dailies, hub notes outside Atoms/ |

---

## Non-goals

- ChatGPT client (#119), DIY write docs (#120) beyond one-line note  
- Pagination / `list_atoms` (separate light amend)  
- Auto-hide superseded atoms  
- Daily note markers for chat-origin atoms (no capture bullet required for P0)  
- Zero-knowledge encryption change  

---

## Key technical decisions

| ID | Decision | Why |
|---|---|---|
| KTD1 | **Outbox table** `ask_outbox` (or equivalent) per email: id, kind, payload JSON, status, created_at, applied_at, error | Durable across MCP process; multi-device apply |
| KTD2 | **Plugin apply** via `GET/POST /v1/ask/outbox/pull` + `POST /v1/ask/outbox/ack` with Plus `sess_` | Same CORS/session pattern as mirror upsert; not MCP token on plugin |
| KTD3 | **Poll triggers:** plugin load, home/layout ready, Settings Ask focus, after Process/Update, interval ~60s while enabled | No push channel on mobile; good enough for dogfood |
| KTD4 | **Atom file shape:** reuse `buildAtomMarkdown`-compatible structure: frontmatter `created`, `source: "[[Ask]]"` (or `[[Claude]]`), `generated-by: ask-mcp`, tags, body = verbatim text + optional link prose block | Distinct provenance from linker Process; still library-visible |
| KTD5 | **Title sanitization** same as `sanitizeFilename` / `atomPathForTitle` (shared pure helper or duplicated rules with tests) | Collision path matches Process |
| KTD6 | **`create_atom` args:** `title`, `body` (required), `tags?`, `links?` `[{note, reason}]` | Minimal; body is the capture moment |
| KTD7 | **`continue_atom` args:** `parent_title` (or path), `title`, `body`, `relation` enum default `continues`, `tags?`, extra `links?` | Forces parent edge; relation becomes link reason template |
| KTD8 | **No confirm step on create/continue** | Low blast radius (new files only). Confirm reserved for future delete/body-replace |
| KTD9 | **Idempotency key** optional on tools (`client_request_id`); duplicate → same outbox row | Claude retries |
| KTD10 | **Caps:** body ≤ 100k chars (mirror parity); ≤ 50 pending outbox items per account; older pending may reject with full hint | Abuse + stuck queue |
| KTD11 | **Apply order:** FIFO by created_at; one device acks; others pull empty | Avoid double-create |
| KTD12 | **After apply:** existing Ask mirror upsert path (hash push) so fetch works without manual Sync | Close the loop |
| KTD13 | **MCP tool list** remains discoverable; instructions.md updated: write = outbox; vault must open Obsidian soon | Claude sets user expectation |

---

## Architecture

```
Claude  --MCP create/continue-->  Plus (outbox pending)
                                      |
Obsidian plugin (sess_)  --pull-->    |
         |                            v
         +-- create Atoms/T.md   ack applied
         +-- mirror upsert  -->  atom_mirror
Claude  --fetch_atom-->  sees new atom
```

**DIY later:** local MCP may write vault directly; hosted never skips outbox.

---

## Tool contracts (P0)

### `create_atom`

```json
// in
{ "title": "string", "body": "string", "tags": ["optional"], "links": [{"note":"","reason":""}], "client_request_id": "optional" }
// out
{ "status": "pending", "outbox_id": "...", "title": "...", "path": "Atoms/....md", "hint": "Open Obsidian (Atoms enabled) to land this in your vault. Usually under a minute when the app is open." }
```

### `continue_atom`

```json
// in
{ "parent_title": "Andrew loves High School Musical", "title": "…", "body": "…", "relation": "revises", "tags": [], "client_request_id": "" }
// out — same pending shape; payload includes link to parent
```

Relations: `continues` | `revises` | `contradicts` | `adds_detail` → link prose on child only.

### Errors

| Case | Response |
|---|---|
| Empty title/body | tool error validation |
| Parent missing on continue | `parent_not_found` + mirror_count hint (parent must be fetchable **or** known title string for link even if hub — prefer parent in mirror for P0) |
| Outbox full | `outbox_full` |
| Apply collision | status `rejected`, reason `path_exists` (visible on next tool poll or `outbox_status` optional P1) |

**P1 optional tool:** `outbox_status(outbox_id)` — skip if pull+Notice enough for dogfood.

---

## Implementation units

### U1. Store outbox + HTTP pull/ack

**Files:** `plus-service/src/store/*`, `plus-service/src/mirror/http.mjs` or `outbox/http.mjs`, tests  

- Schema + memory/sqlite/postgres methods: enqueue, list pending, ack, wipe-with-mirror  
- Routes: pull (sess_), ack (sess_), maybe status  
- Unit + HTTP tests  

### U2. MCP write tools

**Files:** `plus-service/src/mcp/tools.mjs`, `instructions.mjs`, tests  

- Register create/continue; enqueue only; never touch vault  
- Instructions: pending semantics, body sacred, continue rules  

### U3. Plugin apply + render

**Files:** `src/platform/askOutbox.ts` (new), `plusClient.ts`, `main.ts`, `askMirror.ts` hooks, `settings.ts` copy  

- Pure plan: payload → path + markdown (reuse sanitize/title rules; frontmatter per KTD4)  
- Apply: `vault.create` only if missing; ack; then mirror push for new paths  
- Triggers per KTD3; Notice on applied N / rejected  
- Settings one-liner under Ask  

### U4. Tests + dogfood + ship

- Plugin unit: planner collision, continue link prose, title sanitize  
- plus-service store/MCP tests  
- test_vault: manual or scripted enqueue → apply → fetch  
- Version bump; privacy ack if write expands egress story (additive sentence OK if ack already covers Anthropic tool results — confirm whether re-ack needed: **lean no re-ack** if create body is user-intended via Claude same as tool results already disclosed)  
- QA note under `docs/qa/`  

---

## Privacy / security

- Write payloads stored encrypted at rest with same mirror key class if bodies sit in outbox (prefer encrypt `payload.body` like mirror bodies)  
- Rate limit enqueue per MCP token  
- sess_ cannot call MCP tools; mcp_ cannot pull outbox (audience split preserved)  
- Wipe deletes pending outbox rows for email  

---

## Acceptance

- [ ] Claude `create_atom` → pending → Obsidian open → file in Atoms/ → `fetch_atom` works  
- [ ] `continue_atom` on HSM pair parent → child links parent; parent body unchanged  
- [ ] Collision title → rejected, no overwrite  
- [ ] Wipe clears pending + mirror  
- [ ] Mobile path: apply runs on phone plugin (same code)  
- [ ] `npm test` + plus-service ask tests green  
- [ ] BRAT release after merge (human ask)  

---

## Risks

| Risk | Mitigation |
|---|---|
| User never opens Obsidian → stuck pending | Clear tool hint; Settings “pending writes: N”; optional later push email |
| Double apply two devices | Ack claim / status transition pending→applied atomic |
| Model invents body as “user voice” | Product copy: body is what you asked to file; user still owns vault edit |
| Scope creep to delete/rewrite | R11 hard; separate issue |

---

## Open questions (defaults if unset)

| # | Question | Default |
|---|---|---|
| Q1 | `source` frontmatter value | `[[Ask]]` |
| Q2 | Parent must exist in mirror for continue? | **Yes for P0** (fetch parent first); link-only to unknown title = create with link, no continue tool |
| Q3 | Re-ack privacy for write? | **No** if existing ack mentions Anthropic tool traffic; add settings sentence only |
| Q4 | `outbox_status` tool P0? | **No** — Notice + pending hint enough |
| Q5 | Include pagination in same PR? | **No** |

---

## Doc-review gate

Full or light multi-persona on this plan before `ce-work`. Constitution-adjacent (new write type via cloud). Human approval on KTD defaults above.

---

## Implementation order

1. U1 store + HTTP  
2. U2 MCP tools  
3. U3 plugin apply  
4. U4 verify + version + QA  

No production Fly write deploy until U1–U2 tests green; plugin can ship same release as service.
