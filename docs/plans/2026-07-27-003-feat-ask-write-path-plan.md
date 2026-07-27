---
title: "Ask write path — create / continue atoms from Claude"
date: 2026-07-27
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
issue: 127
branch: feat/ask-write-path
related:
  - 16
  - 112
  - 129
deepened: 2026-07-27
---

# Ask write path — create / continue atoms from Claude

**Issue:** #127 · **Branch:** `feat/ask-write-path` · **Lane:** full feature  
**Depends on:** Ask read path (#112, 0.6.32–0.6.34)  
**Related:** #16 Continue · #129 pagination (deferred)

---

## Goal Capsule

**Objective.** Plus users file **new** atoms and **continue** existing ones from Claude via remote MCP. Vault stays source of truth. Hosted path: **outbox → plugin apply → mirror upsert**.

**Authority.** Constitution (body sacred, flat `Atoms/`, collision protect) > this plan > prior Ask plan read-only R3/R8 (superseded for write tools only).

**Stop conditions.** Do not ship delete, body-replace, append-into-parent, Process/classify from chat, daily markers for chat atoms, or hub notes outside `Atoms/`. Do not merge #129 pagination into this PR.

**Product Contract preservation.** Bootstrap from session + #127 + research; R1–R11 locked below. Session-settled: create/continue only; outbox round-trip; no privacy re-ack; parent must be in mirror for continue; path computed at apply.

---

## Product Contract

### Problem

Read tools work. Claude cannot author or record mind-change (e.g. HSM love vs joke). Capture → Process is the only write loop.

### Actors

| ID | Actor |
|---|---|
| A1 | Plus user in Claude (phone/desktop) with Atoms connector |
| A2 | Same user with Obsidian open (desktop or mobile), Ask enabled, Plus session |
| A3 | Atoms Plus host (`plus-service`) |

### Requirements

| ID | Requirement |
|---|---|
| R1 | P0 MCP tools: `create_atom`, `continue_atom` |
| R2 | Body sacred: **new files only**; never modify parent capture body |
| R3 | Continue = #16: child + reason-bearing link (`continues` \| `revises` \| `contradicts` \| `adds_detail`); parent required |
| R4 | Hosted: enqueue outbox → plugin apply under configured atom folder → existing mirror push |
| R5 | Collision: path exists → **reject** apply (no clobber); structured reason |
| R6 | Tool honesty: `pending` until apply acks; never claim vault write early |
| R7 | Auth split: enqueue with **mcp_**; pull/ack with **sess_**; Plus active\|trialing; tenant = token email |
| R8 | Wipe clears outbox pending + mirror + MCP tokens |
| R9 | Desktop + mobile apply (same plugin code; poll triggers) |
| R10 | Settings copy: write tools → Plus outbox → vault on apply |
| R11 | Not P0: body replace, append-into-parent, delete, meta-only retag, Process/markers, hubs outside Atoms/ |

### Key flows

| ID | Flow |
|---|---|
| F1 | Claude `create_atom` → `pending` + `outbox_id` → Obsidian open → file in Atoms/ → Notice → mirror upsert → `fetch_atom` succeeds |
| F2 | Claude `continue_atom` on mirrored parent → child links parent; parent body bytes unchanged |
| F3 | Collision title on apply → `rejected` / `path_exists`; existing file untouched |
| F4 | Wipe Ask → pending outbox empty; tools cannot write as that connector |
| F5 | Idempotent retry: same `client_request_id` → same outbox row |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Create "Periwinkle is still my favorite" → lands as new atom with `generated-by: ask-mcp`, `source: "[[Ask]]"` |
| AE2 | Continue parent "Andrew loves High School Musical" with relation `revises` → new child; parent MD unchanged |
| AE3 | Create with title of existing atom → reject at apply; no overwrite |
| AE4 | Two devices open: only one creates file (atomic claim) |
| AE5 | Continue with unknown parent title → tool error `parent_not_found` (no enqueue) |

### Scope

**In:** outbox store+HTTP, MCP write tools, plugin planner/apply/poll, instructions+settings copy, CONCEPTS touch, tests, version bump.

**Out:** #119 ChatGPT, #120 DIY write depth, #129 list/pagination, auto-hide supersession, email push for pending, OAuth scope rename (see KTD14).

---

## Planning Contract

### Key technical decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | Table `ask_outbox`: id (`obx_…`), email, kind (`create`\|`continue`), payload_enc or structured cols, status (`pending`\|`claimed`\|`applied`\|`rejected`), client_request_id nullable unique per email, error, created_at, claimed_at, applied_at | Durable multi-device |
| KTD2 | Routes under Ask HTTP (extend `handleMirrorRoutes` **or** sibling `handleOutboxRoutes` mounted beside it): `POST /v1/ask/outbox/pull`, `POST /v1/ask/outbox/ack` — **sess_ only**; reject **mcp_** | Mirror CORS/session pattern |
| KTD3 | Poll: `onload`/`layout-ready`, Settings Ask open, after Process/Update success, interval **60s** while `askEnabled` + Plus session | No mobile push |
| KTD4 | Atom FM: `created` (UTC date), `source: "[[Ask]]"`, `generated-by: ask-mcp`, tags, optional aliases; body = verbatim + `formatLinkProse` | Distinct from `linker` Process |
| KTD5 | Reuse `sanitizeFilename`, `atomPathForTitle`, `clampAtomFolder`, `formatLinkProse` from `src/pipeline/render.ts` (import in plugin planner) | Collision path matches Process |
| KTD6 | `create_atom`: title, body required; tags?, links? `[{note,reason}]`, client_request_id? | Minimal |
| KTD7 | `continue_atom`: parent_title, title, body, relation default `continues`, tags?, links?, client_request_id?; server `mirrorFetch` parent or reject | P0 parent-in-mirror |
| KTD8 | No human confirm on create/continue | New-file only blast radius |
| KTD9 | Idempotency: unique (email, client_request_id) when set | Claude retries |
| KTD10 | Caps: body ≤ 100_000; ≤ 50 **pending+claimed** per email | Abuse + stuck queue |
| KTD11 | **Lease claim on pull:** pull returns up to N pending, sets `claimed` + claimed_at + optional device id; ack → applied/rejected; **stale claim** (>15 min) returns to pending | Multi-device double-create |
| KTD12 | After successful create: call existing `syncAskMirror` (or targeted upsert) so fetch works without manual Sync | Close loop |
| KTD13 | Update `ASK_MCP_INSTRUCTIONS`: write = outbox; pending until Obsidian; body sacred; continue rules | Stops “cannot write” lie |
| KTD14 | **No OAuth scope bump in P0** — keep `atoms:read` string; tools still not scope-gated (today). Document that write tools share connector. Optional later `atoms:write` + re-consent | Avoid Claude reconnect tax this ship |
| KTD15 | **Path at apply only** — outbox stores title + body + tags + links (+ parent/relation); plugin computes path with local `atomFolder` | Server must not assume `Atoms/` |
| KTD16 | Encrypt outbox body (and full payload JSON) with `encryptMirrorField` / same key as mirror | Parity with KTD10b Ask plan |
| KTD17 | Relation → link prose templates on child only (e.g. `Revises [[Parent]].` / reason includes `[[Parent]]`) | #16 graph edge |
| KTD18 | Settings: pending count via pull empty response `pending_count` or lightweight status field; one-line write privacy under Ask | R10 + stuck UX |
| KTD19 | Rate-limit MCP enqueue (reuse ratelimit helper per email/token) | Abuse |
| KTD20 | CONCEPTS: Ask tools are read **and** write-via-outbox; add short “Ask write / continue” term | Vocab SSOT |

### Architecture

```
Claude (mcp_) --create/continue--> ask_outbox (pending)
Obsidian (sess_) --pull (claim)--> vault.create only if missing
                 --ack applied/rejected-->
                 --mirror upsert--> atom_mirror
Claude (mcp_) --fetch_atom--> sees atom
```

Audience split unchanged: **mcp_** never hits outbox HTTP; **sess_** never hits `/mcp`.

### Patterns to follow

| Area | Follow |
|---|---|
| Store trio | `askSqliteMethods` / `askPostgresMethods` DDL+factory; `memory.mjs` inline parity |
| Mirror HTTP auth | `plus-service/src/mirror/http.mjs` sess_ gate, reject mcp_ |
| MCP tools | `plus-service/src/mcp/tools.mjs` registerTool + JSON content |
| Plugin Plus HTTP | `askMirrorUpsert` shape in `plusClient.ts` |
| Atom create | `applyWrite` create-if-missing; collision protect solutions |
| Tests | `store-ask.test.mjs`, `http-ask-mirror.test.mjs`, `http-ask-mcp.test.mjs` |

### Assumptions

- User opens Obsidian within minutes for dogfood; no email notify P0.
- Library shows `generated-by: ask-mcp` atoms (no filter-out).
- Quality stamps: omit `atoms-quality` or set minimal — **omit** Process quality stamps for Ask-origin (not linker-classified). Implementer: only KTD4 fields unless tests need more.

### Deferred open questions (non-blocking)

| # | Question | Default |
|---|---|---|
| Q1 | `outbox_status` MCP tool | No P0 |
| Q2 | Pagination (#129) | Separate issue |
| Q3 | Privacy re-ack checkbox | No; settings sentence only |
| Q4 | `source` string | `[[Ask]]` |
| Q5 | Scope rename `atoms:write` | Post-P0 |

### Risks

| Risk | Mitigation |
|---|---|
| Stuck pending | Tool hint + Settings pending_count |
| Double apply | KTD11 lease |
| Path folder mismatch | KTD15 apply-local path |
| Scope surprise | KTD14 + instructions honesty |
| Memory/sqlite drift | Mandatory trio tests |

### Learnings to honor

- Collision protect: never `vault.modify` existing atoms (`docs/solutions/security/pre-community-protect-existing-atoms.md`)
- Body sacred / continue = new atom + link (#16, constitution)
- Auth audiences from Ask P0 plan (sess_ vs mcp_)

---

## Implementation Units

### U1. Store outbox + HTTP pull/ack

**Goal.** Durable outbox with claim/ack and wipe integration; plugin-facing HTTP.

**Files:**
- `plus-service/src/store/askSqliteMethods.mjs`
- `plus-service/src/store/askPostgresMethods.mjs`
- `plus-service/src/store/memory.mjs`
- `plus-service/src/store/askHelpers.mjs` (optional pure validators)
- `plus-service/src/mirror/http.mjs` and/or `plus-service/src/outbox/http.mjs`
- `plus-service/src/server.mjs` (mount if new handler)
- `plus-service/test/store-ask-outbox.test.mjs` (new) or extend `store-ask.test.mjs`
- `plus-service/test/http-ask-outbox.test.mjs` (new)

**Approach.** DDL `ask_outbox`; methods `outboxEnqueue`, `outboxPull` (claim), `outboxAck`, `outboxPendingCount`; extend `mirrorWipe` to delete outbox rows. Encrypt payload. Atomic claim SQL/transaction. HTTP: sess_ pull/ack; caps; 401 patterns from mirror tests.

**Test scenarios:**
1. Enqueue → pull returns item + status claimed; second pull empty (or other items only)
2. Ack applied → not pulled again
3. Ack rejected with error persisted
4. Stale claim (>15m) becomes pullable again
5. client_request_id duplicate returns same id
6. Cap 50 → enqueue fails cleanly
7. mirrorWipe clears outbox
8. HTTP: mcp_ on outbox → 401; sess_ ok; forged email ignored
9. memory + sqlite parity (postgres if DATABASE_URL)

**Verify:** `node --test plus-service/test/store-ask*.mjs plus-service/test/http-ask-outbox.test.mjs` (or project’s plus-service test script)

---

### U2. MCP write tools + instructions

**Goal.** `create_atom` / `continue_atom` enqueue only; honest pending responses.

**Files:**
- `plus-service/src/mcp/tools.mjs`
- `plus-service/src/mcp/instructions.mjs`
- `plus-service/test/http-ask-mcp.test.mjs` (extend) and/or `plus-service/test/mcp-ask-write.test.mjs`

**Approach.** Validate inputs; continue requires `mirrorFetch(parent)`; enqueue kind+payload; return pending JSON + hint. Rate limit. No vault. Do not advertise false path if folder unknown — return **suggested** title/filename only or omit path until applied (prefer **title + outbox_id**, path optional null until apply — tool out may include `suggested_filename` from shared sanitize if duplicated in JS helpers, else title only).

**Test scenarios:**
1. create_atom happy → pending + outbox_id; row in store
2. continue without parent → parent_not_found, no row
3. continue with parent → payload includes parent + relation link fields
4. empty title/body → validation error
5. body > 100k → error
6. instructions no longer say tools cannot write
7. Existing search/fetch still pass

**Verify:** plus-service ask MCP tests green

---

### U3. Plugin apply planner + poll + settings

**Goal.** Land outbox items as vault files; mirror push; UX copy.

**Files:**
- `src/platform/askOutbox.ts` (new) — pure plan + apply orchestration helpers
- `src/platform/plusClient.ts` — `askOutboxPull`, `askOutboxAck`
- `src/plugin/main.ts` — triggers + interval
- `src/settings/settings.ts` — write/pending copy
- `src/shared/types.ts` — only if settings fields needed (prefer none)
- `test/askOutbox.test.ts` (new)
- `test/plusClient.test.ts` (extend)

**Approach.**
- Pure: payload → `{ path, content }` using render helpers; continue injects relation link into links list before `formatLinkProse`.
- Apply: if `app.vault.getAbstractFileByPath(path)` exists → ack rejected `path_exists`; else `vault.create` (ensure folder); ack applied; then `syncAskMirror`.
- Triggers KTD3; Notice: `Ask: landed N atom(s)` / `Ask: N write(s) rejected`.
- Settings sentence under Ask (not full re-ack).

**Test scenarios:**
1. Plan create → path under clamped folder + FM ask-mcp + body sacred
2. Plan continue → child body includes `[[Parent]]` relation prose; parent not in content as rewrite
3. Sanitize title matches Process rules
4. Collision path → reject decision without modify
5. plusClient paths/headers match pull/ack contracts (mock)

**Verify:** `npm test` (askOutbox + plusClient + no regressed askMirror)

---

### U4. Docs, CONCEPTS, version, dogfood note

**Goal.** Ship-ready packaging and vocabulary.

**Files:**
- `CONCEPTS.md` — Ask write / outbox note
- `docs/qa/2026-07-27-ask-write-path-dogfood.md` (new)
- `manifest.json`, `package.json`, `versions.json` — bump on user-visible ship
- `STATUS.md` — update notes when in review

**Approach.** Short CONCEPTS; QA checklist F1–F5; version when feature complete (not plan-only).

**Test scenarios:** N/A docs — manual dogfood checklist exists.

**Verify:** QA doc lists Claude create → vault → fetch; collision; continue HSM-style pair on test_vault only for agents.

---

## Verification Contract

| Gate | Command / evidence |
|---|---|
| Plugin unit | `npm test` |
| Plugin typecheck/build | `npm run build` |
| Plus store/HTTP/MCP | existing plus-service test entry (see `plus-service/package.json` / root scripts) — all ask* including new outbox |
| Live dogfood | test_vault or human vault: enable Ask → Claude create → open Obsidian → file appears → fetch |
| Collision | pre-create same title → reject, body unchanged |
| Wipe | wipe → pending gone |
| Platforms | same code path mobile+desktop; no desktop-only branch |

**Execution direction:** test-first on pure outbox planner + store claim/ack; HTTP/MCP characterization after store green.

---

## Definition of Done

**Global**
- [ ] F1–F5 satisfied on dogfood
- [ ] R2/R5 collision + body sacred held
- [ ] Wipe clears outbox
- [ ] All listed tests green
- [ ] Settings + MCP instructions updated
- [ ] CONCEPTS updated
- [ ] Version bump in shipping commit
- [ ] PR #128 body `Closes #127`; STATUS cleared on merge
- [ ] Fly deploy write routes before/with BRAT (human ops)
- [ ] No #129 scope creep

**Per unit**
- U1: store+HTTP tests pass three backends as available  
- U2: MCP create/continue tests; instructions fixed  
- U3: plugin tests + Notice path; poll wired  
- U4: docs/version/QA  

---

## Appendix

### Research breadcrumbs (2026-07-27)

- Read surface: `plus-service/src/mcp/tools.mjs` (search/fetch/neighbors only today)
- Auth: `mirror/http.mjs` sess_; `mcp/handler.mjs` rejects sess_
- Scope string still `atoms:read` (`oauth/constants.mjs`) — KTD14
- Atom shape: `src/pipeline/render.ts` `buildAtomMarkdown` / `applyWrite`
- Plugin push today only after Process/Update + Settings Sync — outbox needs broader triggers
- Solutions: collision protect, body sacred (no Ask-specific solution yet)

### Origin session defaults (settled)

create/continue P0 · outbox · no body replace · parent in mirror · no re-ack · no outbox_status tool · source `[[Ask]]` · pagination separate (#129)

### Implementation order

1. U1 → 2. U2 → 3. U3 → 4. U4  

Deploy Fly after U1–U2 green; plugin release with U3–U4.
