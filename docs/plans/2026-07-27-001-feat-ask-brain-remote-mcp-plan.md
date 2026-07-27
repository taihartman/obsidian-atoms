---
title: "Ask your brain — remote MCP for Claude/ChatGPT (Plus)"
type: feat
date: 2026-07-27
issue: 112
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: "https://github.com/taihartman/obsidian-atoms/issues/112"
doc_review: pending
deepened: null
---

# Ask your brain — remote MCP for Claude/ChatGPT (Plus)

## Goal capsule

Let Plus users **ask questions about their atoms inside Claude (phone + desktop)** via a **public remote MCP**. Chat UI stays in Claude/ChatGPT. Atoms owns read-only tools + optional `Atoms/` mirror. **No in-plugin chat.**

**P0 success:** one dogfood user on **phone Claude** → custom connector → public HTTPS MCP → `search_atoms` / `fetch_atom` → answer with `[[title]]` citations and verbatim body quotes.

**Depends on:** Plus public host live (`https://plus.taihartman.com`, health OK 2026-07-27).  
**Free path:** same MCP binary + local folder + tunnel docs (P2).

## Lane

```
Lane: full feature
Why: net-new product surface (remote MCP + cloud mirror + connector auth)
Doc-review: full (after this plan lands; before ce-work beyond P0 unit scaffolds)
Done when: P0 mobile Claude dogfood evidence + plan KTDs locked; P1+ only after P0 green
```

## Problem frame

| Need | Today | Gap |
|---|---|---|
| Pull recall in plain language | Library + Obsidian search | No “ask my second brain” on phone |
| Chat UX | — | Rebuilding chat loses to Claude/ChatGPT |
| Phone reachability | Local MCP / vault | Anthropic connects from **their cloud**, not device localhost |

Product decision (issue #112 / 2026-07-23): integrate via **remote MCP**; reject in-plugin chat and copy-paste pack as primary.

## Product contract (v1) — authoritative

From #112. Do not weaken in implementation.

| ID | Requirement |
|----|-------------|
| R1 | Chat in Claude and/or ChatGPT — **not** Atoms UI |
| R2 | One remote MCP (Streamable HTTP); Claude first OK; ChatGPT fast-follow |
| R3 | Tools **read-only**: search, fetch full atom (verbatim body + tags + link reasons), optional neighbors |
| R4 | Hosted: opt-in sync **`Atoms/` only** + privacy ack (auto-run honesty bar) |
| R5 | Plus gates hosted mirror + MCP; free = DIY self-host docs |
| R6 | Cite `[[title]]`; prefer body quotes; unknown → say so |
| R7 | User can **wipe** mirror + revoke connector access |
| R8 | No Process/write/classify from chat in v1 |
| R9 | Desktop + iOS + Android consume **same** cloud MCP |

### Explicit non-goals (v1)

In-plugin chat · agent that files notes · full-vault / dailies upload · embeddings day one · MCP inside Obsidian mobile process · second login/subscription system · blocking on full public Stripe catalog if Plus **sessions** already work for dogfood.

## Architecture

```
Obsidian (desktop / phone)
  Process · Update · (P1) opt-in push Atoms/*.md
       │
       ▼
plus-service  (extend — not a second product host)
  • existing Plus session / magic link / Stripe entitlement
  • atom_mirror store (per account)
  • OAuth AS (MCP) → access tokens bound to Plus account
  • Streamable HTTP MCP  GET|POST  /mcp
       tools: search_atoms · fetch_atom · neighbors (P0 optional)
       ▲
Claude / ChatGPT (incl. mobile)
  Custom connector → Anthropic/OpenAI cloud → https://plus.taihartman.com/mcp
```

**Repo shape:** plugin stays filing/home/resurface. **`plus-service/`** owns mirror + MCP + OAuth. Plugin P1 adds opt-in push client only.

**Not this product:** `docs/dev-obsidian-mcp.md` (Local REST agent tooling).

## Resolved decisions (plan-time)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| D1 | Mirror encryption / retention | **App-level AES-GCM at rest** (key in platform secrets, not per-user KMS v1); plaintext only in process memory for search/fetch. **Retention = while Ask enabled**; wipe deletes rows immediately. Soft-delete not required v1. | Small team; honesty + wipe > crypto theater. Document threat model (host can decrypt). |
| D2 | Sync frequency | **P0:** manual seed / folder import API (operator). **P1:** push on Process/Update success + Settings “Sync now”; optional hourly catch-up when app open (no background phone daemon required). | Vault remains SSOT; cloud is index. |
| D3 | OAuth vs Plus session for connectors | **MCP OAuth 2.1 + PKCE** (Claude requires real connector auth). Authorize UI reuses **Plus magic-link identity** (same email/account). Access token ≠ plugin `sess_*` (scoped `mcp` audience, shorter TTL + refresh). **Do not** put session in URL query. | Claude docs: OAuth DCR/CIMD primary; static_headers beta/org-only; no second account system. |
| D4 | Ask in base Plus vs add-on | **Included in base Plus** (trialing/active) for v1. No separate Ask SKU. Metering of MCP calls deferred (P3). | Chat tokens paid by user; our cost is storage/egress. |
| D5 | Claude-only P0 vs both | **Claude-only P0** (incl. **mobile**). ChatGPT + DIY docs = **P2**. | Prove phone path first. |
| D6 | Service boundary | **Extend `plus-service`** on same Fly app / `plus.taihartman.com`. Path `/mcp` + OAuth well-known. | One deploy, one auth DB, health already public. |
| D7 | Search v1 | **FTS / ILIKE + title/tag boost** over mirrored fields. No embeddings. | Issue non-goal; good enough for dogfood. |
| D8 | P0 data source | **Per-account mirror table** seeded by authenticated `POST /v1/ask/mirror/upsert` (bulk) **or** dogfood folder loader. Not “read vault from Anthropic.” | Proves real multi-tenant shape even for one user. |

## Key technical decisions (KTD)

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD1 | Transport: **Streamable HTTP** single endpoint `/mcp` (JSON responses OK; SSE optional later) | MCP + Claude current transport; simpler than dual legacy SSE |
| KTD2 | Tools only (no write tools, no sampling): `search_atoms`, `fetch_atom`; `neighbors` if free from link JSON | R3/R8 |
| KTD3 | MCP instructions string: answer only from tools; quote bodies; cite `[[titles]]`; admit unknown | R6 |
| KTD4 | OAuth: protected-resource metadata + AS metadata on same host; **DCR** for Claude custom connector; PKCE S256; redirect `https://claude.ai/api/mcp/auth_callback` | Claude connector auth reference 2026 |
| KTD5 | Authorize page: email magic-link (reuse `createMagicToken` / exchange) → consent “Atoms Ask (read-only)” → auth code | Reuse Plus identity |
| KTD6 | Resource tokens: opaque `mcp_…` hashed in DB; bind `email` + scopes `atoms:read`; TTL ~1h access / ~30d refresh rotate | Separate from plugin sessions; revoke on wipe/sign-out |
| KTD7 | Unauthenticated `/mcp` → **401** + `WWW-Authenticate: Bearer resource_metadata="https://plus.taihartman.com/.well-known/oauth-protected-resource"` | Claude discovery path |
| KTD8 | Mirror row schema: `(email, atom_id, title, path, body_text, tags_json, links_json, content_hash, updated_at)` unique `(email, path)` | Atoms-only; body sacred (store verbatim) |
| KTD9 | Upsert API Bearer **Plus session** (plugin) or dogfood script; never MCP token for write | Write path stays plugin/operator |
| KTD10 | Wipe: `DELETE FROM atom_mirror WHERE email=?` + revoke MCP tokens for email | R7 |
| KTD11 | CORS: keep existing Plus CORS; MCP is server-to-server from Anthropic (still allow OPTIONS) | Parity with classify |
| KTD12 | Rate limit search/fetch per token + IP | Abuse floor without full metering |
| KTD13 | DIY binary: `node plus-service` with `ATOMS_ASK_LOCAL_DIR=./Atoms` + authless or static bearer **local only**; prod refuses authless | Free path without Plus bill |
| KTD14 | Plugin P1 Settings: Ask section — enable toggle, privacy ack, connector URL copy, Sync now, Wipe cloud copy, link DIY docs | R4/R5/R7 |
| KTD15 | No constitution change; architecture note under “Partially shipped” only after P1 ships | collab rules |

## Tool contracts

```text
search_atoms(query: string, limit?: number = 8)
  → [{ id, title, snippet, path, tags[] }]

fetch_atom(id_or_title: string)
  → { id, title, text /* verbatim body */, tags[], links: [{ note, reason }], path }
  // 404-shaped tool error if missing

neighbors(title: string)  // P0 optional / P1
  → [{ title, reason }]
```

**Snippet rule:** ≤240 chars from body, no model rewrite.  
**Title match:** exact title, then case-fold, then path basename.

## Implementation slices

### P0 — one-user remote MCP + Claude mobile (this claim’s first ship gate)

| Unit | Deliverable | Evidence |
|------|-------------|----------|
| U0 | Plan + claim + draft PR | this file + STATUS + PR |
| U1 | Store: `atom_mirror` + `mcp_oauth_*` tables (memory/sqlite/postgres) | unit tests |
| U2 | `POST /v1/ask/mirror/upsert` + `DELETE /v1/ask/mirror` (Plus session auth; entitlement active\|trialing) | http dogfood test |
| U3 | Streamable HTTP MCP `/mcp` + tools over mirror (read-only) | inspector / curl JSON-RPC |
| U4 | OAuth AS + PRM well-known + DCR + PKCE + magic-link authorize HTML | MCP inspector auth; Claude desktop connector |
| U5 | Seed script: load fixture atoms for dogfood account | `npm run ask:seed` (plus-service) |
| U6 | **P0 dogfood:** phone Claude custom connector → question → citations | screenshot/notes under `docs/qa/…` |
| U7 | Deploy to Fly `atoms-plus` / plus.taihartman.com | `/health` + live `/mcp` 401 shape |

**P0 out:** plugin UI, ChatGPT, DIY docs polish, embeddings, neighbors required, Stripe changes, metering.

### P1 — plugin opt-in + Plus gate + wipe + Settings

| Unit | Deliverable |
|------|-------------|
| U8 | Settings → Atoms Plus / Ask: privacy ack, enable, copy MCP URL, Sync now, Wipe |
| U9 | After Process/Update: if Ask enabled, push changed `Atoms/` files (hash skip) |
| U10 | Entitlement gate + clear errors; version bump |
| U11 | QA + shipping tail |

### P2 — ChatGPT + DIY docs

| Unit | Deliverable |
|------|-------------|
| U12 | ChatGPT remote MCP path verified or issue-split with doc |
| U13 | `docs/ask-self-host.md` — binary, folder, tunnel, authless local |

### P3 — harden

Rate/meter if abuse · encryption key rotation · neighbors polish · directory submission (optional).

## Multiplayer / claim

| Field | Value |
|-------|--------|
| Issue | **#112** (assignee: Tai) |
| Branch | `feat/ask-brain-remote-mcp` |
| Plan | `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md` |
| Hot files | `plus-service/**`, later `src/platform/plusClient.ts`, `src/settings/settings.ts`, `docs/ask-*.md` |
| Overlap | None in STATUS at claim time |

**PR strategy:** one long-lived draft PR for the claim; land P0 vertical slice first (service-only OK). Plugin P1 can be same PR if small, else follow-up PR still `Closes #112` only when full acceptance or split issue.

**Close rule:** do **not** merge-close #112 on P0-only unless humans accept “P0 = ship slice + open #N for P1.” Default: keep #112 open until P1 acceptance criteria (enable + sync + wipe + phone Claude) met; P0 evidence still required before expanding.

**Recommended:** P0 merge as **non-closing** PR (`Related #112`) if humans want continuous deploy; or single PR through P1. **Agent default:** draft PR body `Closes #112` only when P1 done; until then PR says `Implements #112 (P0 in progress)` without close keyword — wait: collab says shipping PR must Closes. So either:
- **Option A:** keep one draft until P1, then `Closes #112`
- **Option B:** split issues P0/P1

**Plan picks Option A** (one claim through P1; P0 is milestone not separate close).

## Test plan (minimum)

### Service

- Mirror upsert isolation (user A cannot read B)
- Wipe empties mirror + revokes MCP tokens
- MCP tools never mutate store
- OAuth: invalid code, expired token, wrong audience → 401
- Prod gate: authless MCP disabled when `ATOMS_PLUS_ENV=production`
- search/fetch unit tests on fixture corpus

### Product dogfood (P0)

1. Seed 5–10 real-shaped atoms for Plus dogfood account  
2. Add custom connector URL `https://plus.taihartman.com/mcp` in Claude  
3. Complete OAuth (magic link)  
4. On **phone**: ask a question only answerable from seeded bodies  
5. Confirm answer cites `[[…]]` and quotes body  
6. Capture evidence in `docs/qa/YYYY-MM-DD-ask-brain-p0-dogfood.md`

### Plugin (P1)

- Privacy ack required before first push  
- Sync now + post-Process push  
- Wipe from Settings  
- Screenshots under `docs/qa/screenshots/ask-brain/`

## Security / privacy notes

- Host **can** read mirrored atoms (document in ack). Not zero-knowledge.  
- Mirror = `Atoms/` only — never dailies, never attachments binary dump v1.  
- No tool can write vault or trigger classify.  
- Logs: never log bodies, tokens, or Authorization headers (Plus log safety).  
- Anthropic egress must reach public host (already true for Plus).

## Risks

| Risk | Mitigation |
|------|------------|
| Claude OAuth quirks (DCR, PKCE, 401 shape) | Follow Claude auth docs; test inspector before phone |
| Fly auto-stop cold start > connector timeout | `min_machines_running = 1` already; keep OAuth &lt;10s |
| Large vaults / payload size | Cap body size per atom; search returns snippets; fetch one |
| Scope creep into chat UI | Hard non-goal; reject in review |
| Confusion with Local REST MCP | Naming “Atoms Ask”; docs callout |

## Open questions (non-blocking)

1. Exact Settings copy / privacy ack wording — voice pass at P1  
2. Whether neighbors ships in P0 (default: **defer** if timeboxed)  
3. Max atoms / max body bytes per account soft caps — set conservative defaults in U1  

## Implementation order (agents)

1. **Do not implement until plan doc-review (light minimum, full preferred).**  
2. U1 → U2 → U3 → U5 (tools work with Plus session seed without Claude).  
3. U4 OAuth → U6 Claude mobile → U7 deploy.  
4. Stop for human dogfood sign-off on P0 before U8+.  
5. P1 plugin → shipping tail (simplify → code-review → compound → world-class-qa).

## References

- Issue #112  
- Plus plans: `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md`, `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md`  
- Claude: [custom connectors](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp), [auth](https://claude.com/docs/connectors/building/authentication)  
- MCP: [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports)  
- Live host: `https://plus.taihartman.com/health` → `{"ok":true,"service":"atoms-plus"}` (verified 2026-07-27)
