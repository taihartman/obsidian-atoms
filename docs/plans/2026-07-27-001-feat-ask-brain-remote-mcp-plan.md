---
title: "Ask your brain — remote MCP for Claude/ChatGPT (Plus)"
type: feat
date: 2026-07-27
issue: 112
pr: https://github.com/taihartman/obsidian-atoms/pull/116
origin: "https://github.com/taihartman/obsidian-atoms/issues/112"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: issue-112
execution: code
doc_review: 2026-07-27
deepened: 2026-07-27
---

# Ask your brain — remote MCP for Claude/ChatGPT (Plus)

## Goal Capsule

**Objective.** Plus users ask questions about their atoms **inside Claude (phone + desktop)** via a **public remote MCP**. Chat stays in Claude/ChatGPT. Atoms owns read-only tools + optional `Atoms/` cloud mirror. **No in-plugin chat.**

**Authority.** Issue #112 product contract → this plan → `CLAUDE.md` non-negotiables (body sacred, no vault writes from chat). Dev Local REST MCP (`docs/dev-obsidian-mcp.md`) is **not** this product.

**P0 stop condition.** Dogfood user on **phone Claude** → custom connector → `https://plus.taihartman.com/mcp` → OAuth (Plus magic-link identity) → `search_atoms` / `fetch_atom` → answer with `[[title]]` citations and verbatim body quotes. Evidence under `docs/qa/`.

**P1 stop condition.** Plugin opt-in push, privacy ack, wipe, Settings; then full #112 acceptance. **One claim / draft PR #116 through P1** (do not `Closes #112` on P0-only merge).

**Out of band.** Full public Stripe catalog polish is not a P0 blocker if Plus sessions already work for dogfood. ChatGPT + DIY self-host docs = P2.

---

## Product Contract

**Product Contract preservation:** unchanged from #112 — planning adds HOW only.

### Problem frame

Pull recall today is Library + Obsidian search. Users want plain-language “ask my second brain” on **phone**, where Claude cannot reach vault localhost. Anthropic connects to remote MCP **from their cloud** — the server must be public HTTPS with atom text already available (hosted mirror) or DIY-hosted next to the vault.

Push recall (resurface) stays; Ask does not replace it.

### Actors

| ID | Actor |
|----|--------|
| A1 | Plus user (desktop + phone Obsidian; Claude Pro/Max or Free with one custom connector) |
| A2 | Free / DIY user (self-host MCP; no Plus bill for hosting) |
| A3 | Atoms plugin (Process/Update; P1 push client) |
| A4 | Claude custom connector (Anthropic cloud → public MCP) |
| A5 | ChatGPT remote MCP client (P2) |

### Requirements

| ID | Requirement |
|----|-------------|
| R1 | Chat happens in Claude and/or ChatGPT — **not** inside Atoms UI |
| R2 | One remote MCP (Streamable HTTP); Claude first; ChatGPT fast-follow |
| R3 | Tools **read-only**: search atoms, fetch full atom (verbatim body + tags + link reasons), optional neighbors |
| R4 | Hosted path: opt-in sync of **`Atoms/` only** with privacy ack (auto-run honesty bar) |
| R5 | Plus gates hosted mirror + MCP; free users get DIY self-host documentation |
| R6 | Answers cite `[[title]]` and prefer body quotes; if unknown, say so |
| R7 | User can **wipe** cloud mirror and revoke connector access |
| R8 | No Process / write / classify from chat in v1 |
| R9 | Desktop + iOS + Android consume the **same** cloud MCP |

### Key flows

| ID | Flow |
|----|------|
| F1 | P0: seed mirror → Claude Connectors → OAuth magic-link → phone question → tools → cited answer |
| F2 | P1: enable Ask + ack → Process/Update pushes atoms → Sync now / Wipe in Settings |
| F3 | P2: same MCP URL in ChatGPT; free user follows DIY doc |

### Acceptance examples

| ID | Example |
|----|---------|
| AE1 | Phone Claude: “What did I decide about X?” → tool calls → answer quotes body and cites `[[…]]` |
| AE2 | Wipe → subsequent search returns empty for that account; OAuth tokens revoked |
| AE3 | MCP tools cannot create/modify vault files or call classify |
| AE4 | Unauthenticated `/mcp` returns HTTP **401** with `WWW-Authenticate` resource_metadata (not a 200 tool error) |

### Explicit non-goals (v1)

- In-plugin chat chrome  
- Agent that files or edits notes  
- Full daily-note or whole-vault upload  
- Embeddings required day one  
- MCP process embedded in Obsidian mobile  
- Second subscription / second login system  
- Blocking P0 on unrelated Stripe public catalog work  

---

## Planning Contract

### Assumptions

- `https://plus.taihartman.com` remains the production Plus host (health verified 2026-07-27).
- Dogfood Plus sessions (magic-link + entitlement active/trialing) are available for P0 without new Stripe products.
- Claude custom connectors support Streamable HTTP + OAuth on mobile once account-linked (Anthropic docs 2026).
- Host can decrypt mirrored atoms at rest in v1 (documented in privacy ack) — not zero-knowledge.

### Session-settled decisions

| ID | Decision | Annotation |
|----|----------|------------|
| D1 | Mirror: app-level AES-GCM at rest (platform secret); wipe = hard delete | (session-settled: user-approved — chosen over per-user KMS day one: small-team ops + honesty) |
| D2 | Sync: P0 manual/seed API; P1 push on Process/Update + Sync now | (session-settled: user-approved — vault remains SSOT) |
| D3 | Connector auth: MCP OAuth 2.1 + PKCE; authorize reuses Plus magic-link; `mcp_` tokens ≠ plugin `sess_` | (session-settled: user-directed — chosen over inventing second login / query-string tokens: Claude requires OAuth; reuse Plus identity) |
| D4 | Ask included in base Plus (trialing/active); no Ask SKU v1 | (session-settled: user-approved) |
| D5 | Claude-only P0 (incl. mobile); ChatGPT + DIY = P2 | (session-settled: user-directed — phone path first) |
| D6 | Extend `plus-service` on same Fly app; path `/mcp` | (session-settled: user-approved — one deploy/auth DB) |
| D7 | Search v1 = FTS/ILIKE + title/tag boost; no embeddings | (session-settled: user-approved) |
| D8 | P0 data = per-account `atom_mirror` (not Anthropic reading vault) | (session-settled: user-approved) |

### Key technical decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD1 | Streamable HTTP single endpoint `/mcp`; **JSON response mode** (SSE optional later); GET may 405 | Claude supports Streamable HTTP; stateless JSON fits multi-instance Fly |
| KTD2 | Prefer `@modelcontextprotocol/sdk` (`McpServer` + `StreamableHTTPServerTransport`, `enableJsonResponse`) for protocol; **hand-roll OAuth AS** in existing `node:http` server | Avoid protocol drift; keep identity bridge on Plus patterns |
| KTD3 | Tools: `search_atoms`, `fetch_atom`; `neighbors` deferred unless free | R3; timebox P0 |
| KTD4 | Server MCP instructions: answer only from tools; quote bodies; cite `[[titles]]`; admit unknown | R6 |
| KTD5 | Unauth `/mcp` → **401** + `WWW-Authenticate: Bearer resource_metadata="https://plus.taihartman.com/.well-known/oauth-protected-resource"` (+ optional scope) | Claude discovery; AE4 |
| KTD6 | PRM `resource` **exactly** `https://plus.taihartman.com/mcp` (no trailing slash); AS issuer same host | Claude resource match |
| KTD7 | OAuth: AS metadata with PKCE S256; prefer **CIMD flags** (`client_id_metadata_document_supported` + `token_endpoint_auth_methods_supported` includes `none`) **or** DCR `/register`; redirect allowlist includes `https://claude.ai/api/mcp/auth_callback` (+ Claude Code loopback port-agnostic) | Claude auth reference; DCR spam risk |
| KTD8 | `/authorize`: require Plus identity via magic-link browser flow → consent “Atoms Ask (read-only)” → auth code bound to email + `resource` + PKCE challenge | Reuse Plus; no second account |
| KTD9 | Token endpoint: `application/x-www-form-urlencoded`; access `mcp_…` ~1h; refresh ~30d rotate; hash at rest like `sess_` | Separate from plugin sessions; R7 revoke |
| KTD10 | Mirror table: `(email, atom_id, title, path, body_text, tags_json, links_json, content_hash, updated_at)` unique `(email, path)` | Atoms-only; body sacred |
| KTD11 | Upsert/wipe HTTP: Bearer **Plus session** + entitlement active\|trialing; MCP bearer never writes | R8 |
| KTD12 | Cap fetch body / search snippets (snippet ≤240 chars; full body truncate soft cap ~100k chars toward 150k tool limit) | Claude tool result limit |
| KTD13 | Rate limit search/fetch per token + IP | Abuse floor; metering P3 |
| KTD14 | Prod refuses authless MCP; DIY local may use folder + optional static bearer | R5 |
| KTD15 | Plugin P1: Settings near Plus — ack, enable, copy MCP URL, Sync now, Wipe; push via `plusFetchRequest` | CORS/fetch lessons from Plus dogfood |
| KTD16 | Deploy: same `atoms-plus` Fly app; keep `min_machines_running = 1` (OAuth discovery &lt;10s) | Cold-start risk |
| KTD17 | OAuth `/authorize` uses a **short-lived HttpOnly browser cookie** set when magic-link exchange HTML succeeds (or after POST exchange with `Accept: text/html`). Plugin continues paste/`sess_` device-local storage — cookies are **only** for the MCP consent browser hop. Cookie binds email; not a substitute for `mcp_` access tokens | Plus today is paste-session only; Claude OAuth needs a browser identity step without inventing a second account |

### High-level technical design

```mermaid
sequenceDiagram
  participant Phone as Claude mobile
  participant Ant as Anthropic cloud
  participant Plus as plus-service
  participant DB as Postgres mirror

  Phone->>Ant: User question
  Ant->>Plus: POST /mcp (Bearer mcp_…)
  alt no/invalid token
    Plus-->>Ant: 401 + resource_metadata
    Ant->>Plus: OAuth AS + magic-link authorize
    Plus-->>Ant: access_token
  end
  Ant->>Plus: tools/call search_atoms
  Plus->>DB: FTS by email
  Plus-->>Ant: titles + snippets
  Ant->>Plus: tools/call fetch_atom
  Plus->>DB: body_text
  Plus-->>Ant: verbatim body + tags + links
  Ant-->>Phone: Answer with [[citations]]
```

```text
plus-service/src/
  server.mjs          # route switch: existing + /mcp + well-known + /authorize + /token
  mcp/
    transport.mjs     # SDK Streamable HTTP wiring
    tools.mjs         # search_atoms, fetch_atom
    instructions.mjs  # server instructions string
  oauth/
    metadata.mjs      # PRM + AS metadata
    authorize.mjs     # magic-link bridge + consent
    token.mjs         # code + refresh exchange
    dcr.mjs           # optional /register
  mirror/
    store-api.mjs     # upsert/search/fetch/wipe (store methods)
    crypto.mjs        # AES-GCM envelope (optional wrapper around body_text)
```

### Alternatives considered

| Approach | Verdict |
|----------|---------|
| In-plugin chat | Rejected — #112 product decision |
| Local Desktop MCP only | Rejected — fails phone |
| Hand-rolled JSON-RPC only (no SDK) | Rejected as default — protocol drift risk; SDK for transport |
| Separate `services/atoms-mcp` host | Deferred — extra deploy/auth; revisit if plus-service bloats |
| Embeddings day one | Deferred — FTS first |
| Plugin `sess_` as MCP Bearer | Rejected — wrong audience/TTL; use scoped `mcp_` |

### Scope boundaries

**In (this claim #112 / PR #116):** P0 service vertical + P1 plugin push/Settings/wipe.

**Deferred to follow-up:** ChatGPT verification (P2), polished DIY docs (P2), MCP call metering (P3), neighbors tool, Anthropic directory submission, per-user KMS.

**Outside product identity:** Competing with Claude’s chat UI; full-vault cloud backup product.

---

## Implementation Units

### U1. Mirror + MCP OAuth store methods

**Goal.** Durable (and memory) storage for atom mirror rows and OAuth artifacts across all three store backends.

**Requirements.** R3, R4, R7 · D1, D8 · KTD9, KTD10

**Dependencies.** None

**Files.**
- `plus-service/src/store/shared.mjs` (helpers if needed)
- `plus-service/src/store/memory.mjs`
- `plus-service/src/store/sqlite.mjs`
- `plus-service/src/store/postgres.mjs`
- `plus-service/test/store-ask.test.mjs` (new)

**Approach.** Add tables: `atom_mirror`; `mcp_oauth_clients` (if DCR); `mcp_auth_codes`; `mcp_access_tokens` / `mcp_refresh_tokens` (hash-only secrets). Methods: `mirrorUpsert`, `mirrorSearch`, `mirrorFetch`, `mirrorWipe(email)`, `mcpCreateAuthCode`, `mcpExchangeCode`, `mcpRefresh`, `mcpRevokeForEmail`, `accountFromMcpToken`. Match existing `hashToken` / `id("mcp")` patterns. Encryption wrapper can store ciphertext in `body_text` with version prefix or separate column — keep decrypt inside store fetch API.

**Test scenarios.**
- Upsert then fetch by path returns verbatim body for same email
- User A cannot fetch user B’s path
- Search ranks title hit above body-only hit for same query
- Wipe removes all rows for email and revokes MCP tokens
- Auth code is one-time and expires
- Refresh rotation invalidates old refresh token
- Invalid/expired access token → null account

**Verification.** `cd plus-service && npm test` includes new store-ask suite on memory + sqlite.

---

### U2. Mirror HTTP API (Plus session)

**Goal.** Authenticated upsert/wipe for operators and (later) plugin.

**Requirements.** R4, R5, R7, R8 · KTD11

**Dependencies.** U1

**Files.**
- `plus-service/src/server.mjs`
- `plus-service/src/mirror/http.mjs` (or inline routes)
- `plus-service/test/http-ask-mirror.test.mjs` (new; spawn pattern from `http-dogfood.test.mjs`)

**Approach.**
- `POST /v1/ask/mirror/upsert` Bearer Plus session; body `{ atoms: [{ path, title, body, tags?, links? }] }`; require status active|trialing
- `DELETE /v1/ask/mirror` or `POST /v1/ask/mirror/wipe` → wipe + revoke MCP tokens
- `GET /v1/ask/mirror/status` → `{ enabled hint, count, updatedAt }` (optional P0)
- Size caps per atom and bulk batch; rate limit

**Test scenarios.**
- 401 without session; 403 inactive entitlement
- Upsert then status count increments
- Wipe empties count
- Oversized body rejected with 413/400
- Covers AE2 (wipe path at API layer)

**Verification.** Spawned HTTP tests green against memory store.

---

### U3. MCP tools over mirror (authenticated bearer stub OK)

**Goal.** Streamable HTTP `/mcp` serves `initialize`, `tools/list`, `tools/call` for search/fetch against mirror.

**Requirements.** R1–R3, R6, R8 · KTD1–KTD4, KTD12

**Dependencies.** U1

**Files.**
- `plus-service/package.json` (add `@modelcontextprotocol/sdk`, `zod` if required)
- `plus-service/src/mcp/transport.mjs`
- `plus-service/src/mcp/tools.mjs`
- `plus-service/src/mcp/instructions.mjs`
- `plus-service/src/server.mjs` (mount `/mcp`)
- `plus-service/test/http-ask-mcp.test.mjs`

**Approach.** Wire SDK transport in JSON mode. Resolve user from `Authorization: Bearer mcp_…` (U1); if missing/invalid → **HTTP 401** before JSON-RPC (U4 completes PRM header). Tools return structured text optimized for citation. No write tools registered.

**Execution note.** Start with failing HTTP tests for initialize + tools/call with a pre-inserted mirror row and a test-minted mcp token (helper), then implement.

**Test scenarios.**
- `initialize` returns server info + instructions mentioning cite/quote
- `tools/list` exposes only read tools
- `search_atoms` returns seeded title
- `fetch_atom` returns verbatim body including hedges/whitespace-significant content
- Missing atom → tool error payload (not HTTP 500)
- No tool named classify/write/delete
- Result truncation when body exceeds soft cap
- Covers AE3 at tool registration level

**Verification.** Node test suite + optional `npx @modelcontextprotocol/inspector` smoke noted in QA doc.

---

### U4. OAuth AS + PRM + magic-link authorize

**Goal.** Claude can complete custom connector OAuth against Plus identity.

**Requirements.** R5, R7 · D3 · KTD5–KTD9 · AE4

**Dependencies.** U1, U3

**Files.**
- `plus-service/src/oauth/metadata.mjs`
- `plus-service/src/oauth/authorize.mjs`
- `plus-service/src/oauth/token.mjs`
- `plus-service/src/oauth/dcr.mjs` (if DCR path)
- `plus-service/src/server.mjs`
- `plus-service/test/http-ask-oauth.test.mjs`

**Approach.**
- Serve PRM + AS metadata under `/.well-known/…`
- `/authorize`: unauthenticated → magic-link collect email (reuse createMagicToken / exchange UX) → **KTD17 browser cookie** → consent page → redirect `code` (PKCE). Do not require the user to paste `sess_` into Claude.
- `/token`: form-urlencoded; PKCE S256 verify; mint mcp access+refresh; bind `aud`/`resource` to canonical MCP URL
- CIMD metadata flags preferred; DCR optional fallback
- Prod: reject authless tool access

**Test scenarios.**
- Unauth POST `/mcp` → 401 + `WWW-Authenticate` contains resource_metadata URL
- PRM `resource` exact match config public URL + `/mcp`
- AS metadata advertises S256 PKCE
- Full code+PKCE exchange yields token that authorizes tools/call
- Bad code_verifier fails
- Refresh works once; reused old refresh fails after rotate
- Redirect URI not in allowlist rejected
- Covers AE4

**Verification.** Automated OAuth happy path in http tests; manual Claude Desktop connector once deployed.

---

### U5. Seed script + fixture corpus

**Goal.** Repeatable dogfood atoms for one Plus account without plugin push.

**Requirements.** F1 · D2

**Dependencies.** U2

**Files.**
- `plus-service/scripts/ask-seed.mjs`
- `plus-service/fixtures/ask-atoms/` (small markdown set)
- `plus-service/package.json` script `ask:seed`
- `plus-service/README.md` (Ask dogfood section)

**Approach.** CLI: env `PLUS_SESSION` or magic-link dogfood exchange → upsert fixtures with distinctive bodies answerable only from seed content.

**Test scenarios.**
- Script dry-run prints planned upserts without token
- With token, status count ≥ fixture count (integration, optional CI skip without env)

**Verification.** Documented one-command seed for dogfood account.

---

### U6. P0 dogfood — phone Claude

**Goal.** Prove AE1 on real mobile Claude against public host.

**Requirements.** R1, R6, R9 · AE1 · F1

**Dependencies.** U3, U4, U5, U7 (or local tunnel only if public deploy delayed — prefer public)

**Files.**
- `docs/qa/YYYY-MM-DD-ask-brain-p0-dogfood.md`
- `docs/qa/screenshots/ask-brain/` (phone screenshots if available)

**Approach.** Human/agent-assisted: seed → add connector URL → OAuth → phone question only answerable from fixtures → capture answer + tool trace notes. No personal Remote Vault required — fixtures only.

**Test scenarios.**
- Covers AE1 end-to-end
- Negative: disconnect connector / wipe → model cannot retrieve prior atoms

**Verification.** QA doc checked into PR; STATUS notes P0 green.

**Execution note.** Prefer smoke/runtime proof over unit coverage for this unit.

---

### U7. Production deploy wiring

**Goal.** Live `/mcp` and OAuth on `plus.taihartman.com` without breaking classify/billing.

**Requirements.** R2, R9 · KTD16

**Dependencies.** U2–U5

**Files.**
- `plus-service/fly.toml` (env knobs if any)
- `plus-service/Dockerfile` (deps install already via npm ci)
- `plus-service/.env.example`
- `docs/runbooks/atoms-plus-prod.md` (Ask section)
- `plus-service/src/config.mjs` (`PUBLIC_BASE_URL`, MCP resource URL, crypto key)

**Approach.** Deploy same app; set secrets (`ATOMS_ASK_MIRROR_KEY` if encryption); smoke: health, unauth mcp 401, OAuth metadata 200. Regression: `/v1/me` and classify still work.

**Test scenarios.**
- Prod gate still fails closed without existing required env
- New optional Ask secrets documented; service starts if Ask disabled? **Decision:** Ask routes always on when code shipped; mirror empty until upsert — no separate feature flag required P0
- Health check unchanged path `/health`

**Verification.** Post-deploy curl checklist in runbook passes.

---

### U8. Plugin Settings — Ask (P1)

**Goal.** User-facing enable, privacy ack, connector URL copy, Sync now, Wipe.

**Requirements.** R4, R5, R7 · KTD15 · F2

**Dependencies.** U2, U7

**Files.**
- `src/settings/settings.ts`
- `src/shared/types.ts` (settings flags)
- `src/platform/plusClient.ts` (mirror upsert/wipe/status clients)
- `src/platform/filingAuth.ts` (only if needed)
- `test/plusClient-ask.test.ts` (or extend plusClient tests)
- `manifest.json` / `package.json` / `versions.json` version bump

**Approach.** Subsection under Atoms Plus. Require checkbox ack before enable. Copy `https://plus.taihartman.com/mcp`. Sync now scans configured atoms folder, hash-skips unchanged, upserts via `plusFetchRequest`. Wipe confirms then DELETE. No chat UI.

**Test scenarios.**
- plusClient wipe/upsert request shapes (mock fetch)
- Settings: enable without ack blocked (if testable pure helper)
- Version string bumps

**Verification.** Desktop Settings smoke on test vault; screenshots for PR evidence.

---

### U9. Plugin push on Process/Update (P1)

**Goal.** After successful write-path Process or Update notes, push changed atoms when Ask enabled.

**Requirements.** R4 · D2 · F2

**Dependencies.** U8

**Files.**
- `src/plugin/main.ts` (hooks after process/update)
- `src/platform/askMirror.ts` (new pure-ish push planner)
- `test/askMirror.test.ts`

**Approach.** Collect created/updated atom paths from write results; read files; build upsert payload; best-effort push (Notice on failure, never fail Process). Hash skip. Phone relies on Sync when desktop last processed — document; optional open-app catch-up later.

**Test scenarios.**
- Planner includes only Atoms/ paths
- Hash equal → skip
- Disabled Ask → no network
- Failure does not throw into Process success path

**Verification.** Unit tests + test_vault Process → mirror status count (service local or mock).

---

### U10. P1 shipping tail + acceptance

**Goal.** Claim complete for #112 merge criteria (minus P2 ChatGPT/DIY polish if split — default include DIY stub link).

**Requirements.** All R1–R9 for hosted path · AE1–AE4

**Dependencies.** U6, U8, U9

**Files.**
- `docs/qa/YYYY-MM-DD-ask-brain-world-class-qa.md`
- `docs/ask-self-host.md` (stub OK if full DIY is P2 — prefer short stub)
- `STATUS.md` (In review)
- PR #116 body: `Closes #112` only when ready

**Approach.** simplify → code-review → compound → world-class-qa + adversarial. PR evidence screenshots for Settings.

**Test scenarios.**
- Full acceptance checklist from #112
- Covers AE1–AE4

**Verification.** Shipping tail complete; human review on product-facing Settings.

---

## Phased delivery

| Phase | Units | Ship gate |
|-------|-------|-----------|
| **P0** | U1–U7 | Phone Claude AE1 + public host |
| **P1** | U8–U10 | Plugin enable/sync/wipe + `Closes #112` |
| **P2** | (follow-up issue if needed) | ChatGPT + full DIY docs |
| **P3** | — | Metering / harden |

**PR landing.** Keep draft #116 through P1. If P0 must deploy early: merge service-only with **no** `Closes` keyword, open follow-up issue for P1, update STATUS — prefer single PR Option A unless humans need P0 live faster.

---

## Verification Contract

| Gate | Command / action |
|------|------------------|
| Unit/store | `cd plus-service && npm test` |
| Plugin unit | `npm test` (root vitest) when U8–U9 land |
| Build | `npm run build` after plugin changes |
| MCP protocol | http-ask-mcp tests + Inspector optional |
| OAuth | http-ask-oauth tests |
| Deploy smoke | curl health; curl `/mcp` expect 401; GET well-known 200 |
| Product | Phone Claude dogfood doc (U6); Settings screenshots (U10) |
| Non-regression | Existing plus http-dogfood + meter tests still pass |

---

## Definition of Done

**Global**
- [ ] All P0 units U1–U7 complete with tests/evidence
- [ ] AE1 proven on phone Claude against public URL
- [ ] AE2–AE4 covered by automated tests and/or QA doc
- [ ] No write tools; no dailies/full-vault upload
- [ ] P1 Settings + push + wipe shipped before `Closes #112`
- [ ] Shipping tail (simplify, code-review, compound, world-class-qa) on merge-ready PR
- [ ] STATUS cleared after merge

**Per-unit.** Each U-ID verification section satisfied; feature-bearing units have green listed tests.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Claude OAuth discovery fails (“Couldn’t reach MCP”) | Strict 401+PRM; exact resource URL; Inspector before phone |
| Cold start exceeds 10s OAuth budget | `min_machines_running = 1`; keep authorize/token fast |
| Protocol drift hand-rolling MCP | Use official SDK transport |
| Mirror privacy backlash | Clear ack: host can read atoms; Atoms-only; wipe |
| Process slowed by push | Best-effort async; hash skip; never fail filing |
| Confusion with Local REST MCP | Name “Atoms Ask”; docs callout |
| DCR client table spam | Prefer CIMD metadata flags |

---

## Open questions (deferred, non-blocking)

| ID | Question | Default if unresolved |
|----|----------|----------------------|
| OQ1 | Privacy ack / Settings copy voice | Ship plain honest draft; voice pass later |
| OQ2 | Soft caps: max atoms / max body bytes per account | 10k atoms / 100k chars body / 2MB bulk upsert |
| OQ3 | Neighbors in P0? | **No** — P1+ if free |
| OQ4 | Split P0 merge without Closes? | Prefer single PR; humans may choose early deploy |

---

## System-wide impact

- **plus-service:** new routes, deps, tables — classify/billing must not regress  
- **Plugin:** Settings + post-process hook only; pipeline body sacred unchanged  
- **Ops:** one more secret (mirror key); same Fly app  
- **Users:** new Plus capability; free path docs later  
- **Agents:** still never MCP into personal vault for product Ask — dogfood fixtures / test_vault only  

---

## Sources and research

- Issue #112 full body  
- Prior plan draft this branch; STATUS claim; draft PR #116  
- `plus-service/src/server.mjs`, store trio, `prodGate.mjs`, `src/platform/plusClient.ts`, `filingAuth.ts`, `pipeline/render.ts`  
- `docs/handoffs/2026-07-23-plus-production-backend.md` (CORS, fetch vs requestUrl)  
- `docs/dev-obsidian-mcp.md` (non-product)  
- Claude: [connectors building](https://claude.com/docs/connectors/building), [authentication](https://claude.com/docs/connectors/building/authentication)  
- MCP: [Streamable HTTP transports](https://modelcontextprotocol.io/docs/concepts/transports)  
- Live gate: `GET https://plus.taihartman.com/health` → `{"ok":true,"service":"atoms-plus"}` (2026-07-27)
