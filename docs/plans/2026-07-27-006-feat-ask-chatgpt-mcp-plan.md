---
title: "Ask — ChatGPT remote MCP connector path"
date: 2026-07-27
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
issue: 119
branch: feat/ask-chatgpt-mcp
related:
  - 112
  - 120
deepened: 2026-07-27
---

# Ask — ChatGPT remote MCP connector path

**Issue:** #119  
**Branch:** `feat/ask-chatgpt-mcp`  
**Lane:** light feature (client-compat + honesty copy)  
**Depends on:** Hosted Ask Claude path shipped (#112+); mirror parity (#137) helpful but not blocking  
**Session-settled:** **Connector only** — same `/mcp` URL + OAuth allowlist + Settings/privacy/runbook. **No** deep-research `search`/`fetch` schema rename. DIY self-host remains #120.

---

## Goal Capsule

**Objective.** A Plus user can connect the **same** Atoms MCP URL in ChatGPT (Developer mode / custom connector) via OAuth, then search/fetch (and optionally file via outbox) their mirrored atoms — without a second endpoint or ChatGPT-only tool surface.

**Authority.** Constitution (vault SSOT, Atoms/-only egress, body sacred) > this plan > plan 001 P2 carve-out for ChatGPT.

**Stop conditions.** No second MCP server; no deep-research-only `search`/`fetch` tools; no ChatGPT plugin store listing; no mTLS requirement; no DIY self-host polish (#120); no private_key_jwt unless dogfood proves `none` fails.

**Product Contract preservation.** Bootstrap from #119 + OpenAI plugin auth docs (2026). Scope locked session: connector-only.

---

## Product Contract

### Promise

If Ask is on and the vault has mirrored, ChatGPT can use the same connector URL Claude uses. OAuth signs the user into Atoms Plus; tool results go to OpenAI the way Claude tool results go to Anthropic. Honest privacy copy names both.

### Requirements

| ID | Requirement |
|---|---|
| R1 | Same public MCP URL (`{plusBase}/mcp`) works for ChatGPT connector discovery (PRM 401 + well-known unchanged shape) |
| R2 | OAuth redirect allowlist accepts ChatGPT production callbacks (prefix + legacy exact) without opening arbitrary HTTPS redirects |
| R3 | CIMD / DCR clients whose redirect is allowlisted can complete authorize → magic link → consent → token (existing AS) |
| R4 | Token endpoint continues to support public client `none` + PKCE S256 (ChatGPT falls back when `private_key_jwt` unsupported) |
| R5 | Settings: connector URL label/steps cover Claude **and** ChatGPT; privacy ack mentions OpenAI when chatting in ChatGPT |
| R6 | Consent / OAuth HTML not Claude-only (“Claude” → “your AI app” or dual name) where user-facing |
| R7 | Runbook + short dogfood checklist for ChatGPT connect path on test account |
| R8 | Existing Claude path regression: Claude callback + loopback still pass OAuth tests |
| R9 | No new MCP tools; existing `search_atoms` / `fetch_atom` / write tools unchanged |
| R10 | MCP tools advertise OAuth need so ChatGPT can show linking UI: per-tool `securitySchemes` (oauth2 + scopes) and unauth/`insufficient_scope` paths carry `WWW-Authenticate` / `_meta["mcp/www_authenticate"]` per OpenAI plugin auth docs |

### Flows

| ID | Flow |
|---|---|
| F1 | ChatGPT Developer mode → add connector URL → OAuth → Plus email magic link → consent → tools list |
| F2 | Chat in ChatGPT asks a vault-only fact → `search_atoms` / `fetch_atom` answer |
| F3 | Claude connect still works (regression) |
| F4 | Reject non-allowlisted redirect_uri (security) |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | Allowlisted ChatGPT redirect completes OAuth unit/integration test (or documented live dogfood if CI cannot hit ChatGPT) |
| AE2 | Non-allowlisted `https://evil.example/cb` still 400 |
| AE3 | Settings shows ChatGPT connect steps + dual privacy line |
| AE4 | Claude callback test still green |
| AE5 | Live dogfood (human): ChatGPT tool call returns atom body from test_vault mirror |

### Scope

**In:** redirect allowlist, client_name labeling, Settings/OAuth HTML/privacy copy, runbook, tests, version bump if user-visible.

**Out:** deep-research `search`/`fetch` schema; plugin directory publish; mTLS; `private_key_jwt`; DIY (#120); second base URL; tool rename; MCP metering.

---

## Planning Contract

### Key technical decisions

| ID | Decision | Why |
|---|---|---|
| KTD1 | **One MCP URL** — no `/mcp/chatgpt` fork | Issue + plan 001 R2 |
| KTD2 | **Redirect allowlist** add: (a) exact legacy `https://chatgpt.com/connector_platform_oauth_redirect`; (b) `https://chatgpt.com/connector/oauth/{callback_id}` where `callback_id` is one path segment (`[A-Za-z0-9_-]+`, non-empty; reject `..`, `//`, `@`, query-only tricks). Loopback `http(s)://127.0.0.1|localhost|[::1]/callback` already covered | OpenAI plugin auth “Redirect URL” |
| KTD3 | **Do not** allowlist all of `chatgpt.com` or open HTTPS | Security — prefix path only |
| KTD4 | Keep `token_endpoint_auth_methods_supported: ["none"]`; CIMD already advertised. If live ChatGPT requires `private_key_jwt` only, open follow-up — do not block ship on speculation | Docs: ChatGPT prefers stronger method when both supported; falls back to `none` |
| KTD5 | CIMD auto-register path: when `client_id` is HTTPS URL and redirect allowlisted, register as today; set `client_name` from host (`ChatGPT` if chatgpt.com, else Claude/other) | routes.mjs already auto-registers |
| KTD6 | Privacy ack: add OpenAI receives tool results when chatting in ChatGPT (parallel to Anthropic/Claude). Re-ack not forced if already acked — show updated text; optional one-line “updated” in Settings only if product wants (default: update text, no re-gate) | Honesty; avoid lockout |
| KTD7 | Settings heading may stay “Ask” with subcopy for both clients; connector field: “MCP connector URL” + steps for Claude and ChatGPT | Less Claude-only product |
| KTD8 | Transport unchanged (stateless Streamable HTTP POST, JSON). If ChatGPT dogfood fails on transport, document and follow-up — not in P0 code speculation | Claude-proven path |
| KTD11 | **P0:** Register tools with `securitySchemes: [{ type: "oauth2", scopes: ["atoms:read"] }]` (write tools same scope until scope split exists). Unauthenticated `/mcp` already returns 401 + `WWW-Authenticate` resource_metadata — keep. Tool-level error path: when Bearer missing/invalid inside a tools/call, include `_meta["mcp/www_authenticate"]` with `error` + `error_description` so ChatGPT can re-link. Do not invent anonymous `noauth` tools — mirror is always entitled. | OpenAI plugin auth “Triggering authentication UI”; doc-review |
| KTD9 | Live ChatGPT dogfood is **human** evidence (AE5); automated tests cover allowlist + OAuth unit shapes without ChatGPT cloud | Agents cannot drive ChatGPT reliably |
| KTD10 | Version bump when Settings copy ships (user-visible) | CLAUDE.md versioning |

### Assumptions

- ChatGPT production redirects remain under `chatgpt.com` paths cited in OpenAI plugin auth docs (2026).
- Existing PRM resource = `{base}/mcp` matches what ChatGPT sends as `resource` (same as Claude).
- Hosted Plus already reachable at production base (tryatoms / plus host cutover as on master).

### Risks

| Risk | Mitigation |
|---|---|
| ChatGPT requires SSE GET sessions | Dogfood early; if blocked, new issue — do not half-implement dual transport in this PR |
| Callback path changes | Prefix allowlist + tests; runbook note to re-check OpenAI docs |
| Privacy ack drift confuses existing users | Update copy without clearing ack timestamp |

### Deferred to follow-up

- Deep-research compatible `search`/`fetch` tools (#119 out)
- `private_key_jwt` / JWKS if `none` insufficient
- #120 DIY self-host
- Anthropic/OpenAI directory listing

---

## Implementation Units

### U1. OAuth redirect allowlist + client labeling

**Goal.** ChatGPT OAuth redirects accepted; evil redirects rejected; Claude unchanged.  
**Requirements.** R2, R3, R8, F4, AE1, AE2, AE4  
**Dependencies.** None  
**Files:**  
- `plus-service/src/oauth/constants.mjs`  
- `plus-service/src/oauth/routes.mjs` (client_name only if needed)  
- `plus-service/test/http-ask-oauth.test.mjs`  
- `plus-service/test/oauth-redirect.test.mjs` (new pure unit if cleaner)

**Approach.** Extend `isAllowedRedirectUri` per KTD2 (legacy exact + single-segment callback_id). Keep Claude exact + loopback. Auto-register client_name: detect chatgpt host → `"ChatGPT"`.

**Test scenarios:**  
1. Claude callback → true  
2. Loopback `http://127.0.0.1:1234/callback` → true  
3. Legacy ChatGPT redirect → true  
4. `https://chatgpt.com/connector/oauth/abc123` → true  
5. `https://chatgpt.com/evil` → false  
6. `https://evil.com/connector/oauth/x` → false  
7. `https://chatgpt.com/connector/oauth/../admin` → false  
8. `https://chatgpt.com/connector/oauth/` (empty id) → false  
9. `https://chatgpt.com/connector/oauth/a/b` (extra segment) → false  
10. Full OAuth happy path with ChatGPT redirect URI (in-process, existing magic-link pattern) → code issued  
11. Claude full path still green  

**Verification.** `plus-service` oauth tests pass.

---

### U1.5. MCP securitySchemes + www_authenticate meta (ChatGPT OAuth UI)

**Goal.** ChatGPT can discover that tools need OAuth and surface the linking UI (not only Claude’s connector flow).  
**Requirements.** R10, F1, AE1  
**Dependencies.** None (parallel U1)  
**Files:**  
- `plus-service/src/mcp/tools.mjs` (or wherever tools register)  
- `plus-service/src/mcp/handler.mjs`  
- `plus-service/test/http-ask-mcp.test.mjs`

**Approach.** Per KTD11: on tool registration, set oauth2 securitySchemes with `atoms:read`. Ensure tools/list JSON exposes schemes (SDK-supported field). On tools/call without valid mcp token, return MCP error result with `_meta["mcp/www_authenticate"]` array string matching Bearer challenge (resource_metadata URL + error + error_description). Keep existing HTTP 401 on bare POST without Authorization. Do not weaken entitlement checks.

**Test scenarios:**  
1. tools/list includes securitySchemes oauth2 for search_atoms (or document SDK serialization shape)  
2. tools/call without token → error + www_authenticate meta present  
3. tools/call with valid mcp_ → success unchanged  
4. HTTP 401 without Authorization still has WWW-Authenticate header  

**Verification.** MCP HTTP tests green; Claude path still works.

---

### U2. OAuth HTML + instructions honesty

**Goal.** Consent/email pages not Claude-only.  
**Requirements.** R6  
**Dependencies.** U1  
**Files:**  
- `plus-service/src/oauth/html.mjs`  
- `plus-service/src/mcp/instructions.mjs` (if Anthropic-only line)

**Approach.** Replace hard “Claude” with “Claude or ChatGPT” / “your AI app” on sign-in and consent. Instructions: tool results may be sent to the host model provider (Anthropic or OpenAI). No behavior change.

**Test expectation:** none — copy; spot-check HTML strings in unit if cheap.

**Verification.** Grep OAuth HTML for leftover “only Claude” claims.

---

### U3. Settings copy + version

**Goal.** Plugin Settings teach ChatGPT connect; privacy names OpenAI.  
**Requirements.** R5, R7, R9, AE3, KTD10  
**Dependencies.** None (parallel U1)  
**Files:**  
- `src/settings/settings.ts`  
- `manifest.json` / `package.json` / `versions.json`  
- `docs/runbooks/atoms-plus-prod.md` (ChatGPT steps)  
- `docs/qa/2026-07-27-ask-chatgpt-connector-dogfood.md` (new)

**Approach.**  
- Section title: “Ask” (or “Ask (Claude + ChatGPT)”).  
- Connector: “MCP connector URL” — Claude connectors + ChatGPT Developer mode / Plugins steps (short).  
- Privacy ack bullet (4): Claude → Anthropic; ChatGPT → OpenAI.  
- Filing toggle: “from Claude or ChatGPT” if write tools available to both.  
- Status line: keep server-count honesty (architecture KTD16). Prefer **“Ask mirror: N · last pushed …”** (client-neutral); never label local vault count as N.
- Dogfood checklist AE5 human-only.  
- Version patch bump.

**Test expectation:** none for copy; build/typecheck.

**Verification.** `npm run build`; dogfood doc exists.

---

### U4. CONCEPTS / architecture one-liners

**Goal.** Future agents know ChatGPT is supported connector path.  
**Requirements.** R1  
**Dependencies.** U1–U3  
**Files:**  
- `CONCEPTS.md`  
- `docs/architecture.md` (Ask mirror section or Ask one-liner)  
- optional `docs/solutions/architecture-patterns/` only if a durable pitfall appears during dogfood

**Approach.** Remote MCP: Claude **and** ChatGPT connectors; same URL; redirect allowlist hosts. Point to this plan.

**Test expectation:** none — docs.

---

## Verification Contract

| Gate | Evidence |
|---|---|
| Unit | Allowlist + OAuth tests (U1) |
| Build | `npm run build` |
| Claude regression | Existing oauth MCP tests |
| Human dogfood | AE5 on ChatGPT + Plus test account; never unattended personal vault |

**Execution direction:** test-first on pure `isAllowedRedirectUri`; then HTTP oauth; then Settings copy.

---

## Definition of Done

- [ ] AE1–AE4 automated or equivalent  
- [ ] AE5 human dogfood checked or explicitly deferred with reason in PR  
- [ ] Claude path green  
- [ ] Version bumped if Settings ships  
- [ ] PR `Closes #119`  
- [ ] STATUS cleared on merge  
- [ ] Fly deploy OAuth allowlist before relying on production ChatGPT connect  

---

## Implementation order

1. U1 allowlist + tests  
2. U1.5 securitySchemes + www_authenticate  
3. U2 OAuth HTML  
4. U3 Settings + runbook + version  
5. U4 docs pointers  

---

## Sources & Research

- OpenAI plugin auth: ChatGPT redirect `https://chatgpt.com/connector/oauth/{callback_id}`; legacy `https://chatgpt.com/connector_platform_oauth_redirect`; CIMD + `none` / `private_key_jwt`; resource parameter; PRM 401  
- Live code: `plus-service/src/oauth/constants.mjs`, `routes.mjs`, `metadata.mjs`, `src/settings/settings.ts`  
- Origin: #119, plan 001 P2 carve-out  
- Session-settled: connector-only (no deep-research schema)
