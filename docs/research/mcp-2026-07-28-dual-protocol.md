# MCP 2026-07-28 — Dual-Protocol Research (Atoms Ask)

**Date:** 2026-07-28  
**Context:** Existing Node.js Streamable HTTP MCP server (`@modelcontextprotocol/sdk` ~1.29), `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, `enableJsonResponse: true`, per-request `McpServer`, OAuth 2.1 + PKCE with `client_id_metadata_document_supported: true` AND DCR `/register`, protocolVersion tests use `"2025-03-26"`.  
**Goal:** Dual-support strategy for legacy (handshake) + modern (`2026-07-28`) clients.

> **Citation rule:** Only claims found in fetched sources. Gaps called out explicitly.

---

## 1. Breaking changes that affect this server

Sources: [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [TS SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html).

### High impact (your stack)

| Change | Spec | Impact on Atoms Ask |
|---|---|---|
| **No `initialize` / `notifications/initialized`** | SEP-2575 | Modern clients never handshake. Every request carries `_meta`: `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`; clients SHOULD send `clientInfo`; servers SHOULD stamp `serverInfo` on every result `_meta`. Version mismatch → `UnsupportedProtocolVersionError` **`-32022`**. |
| **No protocol-level sessions / no `Mcp-Session-Id`** | SEP-2567 | You already use `sessionIdGenerator: undefined` (stateless) — aligned with modern. Cross-call state must be explicit handles (tool args) or MRTR `requestState`, not transport sessions. |
| **Required HTTP headers on every POST** | SEP-2243 | Clients MUST send `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for `tools/call`, `resources/read`, `prompts/get`). Server MUST validate header↔body match or return **400 + `-32020` HeaderMismatch**. Header and `_meta` protocol versions MUST match. |
| **MUST implement `server/discover`** | SEP-2575 | New RPC advertising supported versions, capabilities, identity. Optional for clients to call first; required on servers. |
| **Required `resultType` on all results** | SEP-2322 | `"complete"` or `"input_required"`. Older clients that omit it are treated as `"complete"`. Your server must emit it on modern responses. |
| **Cache fields on list/read results** | SEP-2549 | MUST include `ttlMs` + `cacheScope` on `resultType: "complete"` for: `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`. |
| **Deterministic `tools/list` order** | changelog minor #3 | Servers SHOULD return tools in stable order (prompt-cache friendliness). |
| **GET endpoint removed; no SSE resumability** | SEP-2575 | No standalone GET stream, no `Last-Event-ID`. Modern-only server SHOULD answer GET/DELETE with **405**; ignore `Mcp-Session-Id` and `Last-Event-ID` if present. |
| **`subscriptions/listen` replaces GET + resources/subscribe** | SEP-2575 | Long-lived POST-response SSE for opted-in change notifications. Request-scoped progress/logging stay on the originating request stream. |
| **MRTR replaces server→client JSON-RPC requests** | SEP-2322 | No more server-initiated `elicitation/create` / `sampling/createMessage` / `roots/list` on SSE. Server returns `InputRequiredResult`; client retries with `inputResponses` (+ optional `requestState`). |
| **Removed methods** | SEP-2575 | `ping`, `logging/setLevel`, `notifications/roots/list_changed` gone from core. Log level is per-request `_meta` `io.modelcontextprotocol/logLevel`; servers MUST NOT emit `notifications/message` unless that field was present. |
| **Tasks moved to extension** | SEP-2663 | Experimental tasks out of core → `io.modelcontextprotocol/tasks`. Poll via `tasks/get`; new `tasks/update`; no `tasks/list`. |
| **Resource-not-found error code** | changelog | `-32002` → **`-32602` (Invalid Params)**. |
| **Error code renumber (2026 draft)** | changelog | `HeaderMismatch` `-32020`, `MissingRequiredClientCapability` `-32021`, `UnsupportedProtocolVersion` `-32022`. Range `-32020`–`-32099` reserved for MCP. |
| **SDK package split (v2)** | TS SDK README | v1 `@modelcontextprotocol/sdk` → v2 `@modelcontextprotocol/server` + `@modelcontextprotocol/client` (+ optional `@modelcontextprotocol/node` / express / hono / fastify). v1 gets bugfixes/security ≥6 months; v2 is the 2026-07-28 line. **v2 does not put 2026-07-28 on the wire by default** — must opt in via `createMcpHandler` / `serveStdio` / client `versionNegotiation`. |

### Already partially aligned

- Stateless Streamable HTTP (`sessionIdGenerator: undefined`) maps directly to v2 `createMcpHandler` default (`legacy: 'stateless'`).
- `enableJsonResponse: true` remains valid for simple JSON replies; note TS SDK legacy-shim caveat: JSON-mode cannot deliver mid-call server→client requests (interactive MRTR via legacy shim needs streaming session).
- CIMD already advertised (`client_id_metadata_document_supported: true`) — preferred path under 2026-07-28.

### Protocol version test debt

- Tests pin `"2025-03-26"`. Spec dual-era model: **legacy** = `2025-11-25` and earlier (initialize handshake); **modern** = `2026-07-28`+.
- Servers MAY treat omitted `MCP-Protocol-Version` header as `2025-03-26` only if they still support pre-`2025-06-18` clients; otherwise reject missing header.
- Dual-era servers list both eras in `UnsupportedProtocolVersionError.data.supported`.

---

## 2. Auth hardening checklist (iss, CIMD, DCR)

Sources: [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index), [client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), [Claude connectors auth](https://claude.com/docs/connectors/building/authentication), [blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

### RFC 9207 `iss` (SEP-2468)

| Actor | Requirement |
|---|---|
| **AS (you, if you host AS)** | **SHOULD** include `iss` on authorization responses (including errors). If you do, advertise `authorization_response_iss_parameter_supported: true` in AS metadata. Spec notes a future revision will likely upgrade SHOULD→MUST. |
| **Client** | **MUST** record expected issuer from validated AS metadata before redirect; **MUST** validate present `iss` with simple string comparison (no URI normalization) before redeeming the code. If metadata says `iss` supported and response omits it → reject. |

### CIMD vs DCR deprecation

| Mechanism | Status (2026-07-28) |
|---|---|
| **Client ID Metadata Documents (CIMD)** | Preferred. Clients/AS **SHOULD** support. Advertise `client_id_metadata_document_supported: true`. Client IDs are HTTPS URLs to JSON metadata. Portable across AS changes (no re-register). |
| **Pre-registration** | Still first priority if client already has static credentials for that AS. |
| **DCR (RFC 7591)** | **Deprecated**. Remains for backwards compatibility with AS that lack CIMD. Clients MUST send appropriate `application_type` (`native` vs `web`) during DCR (SEP-837). Credentials MUST be keyed by issuer; MUST NOT reuse across AS; MUST re-register on AS change (SEP-2352). |

**Client selection priority (spec):** (1) pre-registered → (2) CIMD if advertised → (3) DCR fallback → (4) user-entered credentials.

**Your posture today:** CIMD + DCR both on is correct for dual compatibility. Plan: keep DCR until clients you care about are CIMD-only; do not add new DCR-only flows. Claude docs: for high directory traffic prefer **CIMD or `oauth_anthropic_creds` over DCR** (DCR registers a new client per fresh connection → client explosion).

### Claude-specific CIMD gate (not in core MCP alone)

Claude selects CIMD only when AS metadata has **both**:
1. `"client_id_metadata_document_supported": true`
2. `"none"` in `token_endpoint_auth_methods_supported` (Claude CIMD client is a public client)

If either missing → Claude falls back to DCR.

### Other auth MUST/SHOULD for remote servers

- OAuth 2.1 + PKCE S256; advertise `code_challenge_methods_supported: ["S256"]`.
- Protected Resource Metadata (RFC 9728); 401 with `WWW-Authenticate: Bearer resource_metadata="…"`.
- Resource Indicators (RFC 8707) `resource` param on auth + token requests.
- Tokens only as `Authorization: Bearer`; never in query string.
- Audience-bound tokens; reject tokens not minted for this resource.
- Redirect: Claude hosted surfaces use `https://claude.ai/api/mcp/auth_callback`; Claude Code uses loopback (`localhost` / `127.0.0.1`, port-agnostic).
- Token endpoint: `application/x-www-form-urlencoded`; Claude waits ≤10s discovery/register/token, ≤30s refresh.
- Egress allowlist if needed: Anthropic `160.79.104.0/21`.

### Checklist (server/AS owner)

- [ ] Emit `iss` on auth code redirects; set `authorization_response_iss_parameter_supported: true`
- [ ] Keep `client_id_metadata_document_supported: true`
- [ ] Ensure `token_endpoint_auth_methods_supported` includes `"none"` if you want Claude CIMD path
- [ ] Keep DCR `/register` until deprecation window ends / traffic proves CIMD-only
- [ ] DCR: accept `application_type`; document native vs web redirect rules
- [ ] Key any stored DCR client records by issuer; never share across AS
- [ ] PRM `resource` matches public MCP URL exactly (incl. path)
- [ ] PKCE S256 advertised and enforced
- [ ] Rotate refresh tokens for public clients (or sender-constrain)
- [ ] 401 shape: `WWW-Authenticate` + `resource_metadata` (+ optional `scope`)
- [ ] Latency budgets on `/token`, discovery, `/register`

**Gap:** Spec does not publish a hard calendar date for DCR *removal* — only “Deprecated” with minimum **12-month** deprecation window under feature lifecycle (SEP-2596). Removal is a future revision.

---

## 3. Dual-support strategy recommendations

Sources: [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [legacy clients](https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html), [support-2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html), [upgrade-to-v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html).

### Terminology

- **Modern:** `2026-07-28`+ — per-request `_meta`, no initialize.
- **Legacy:** `2025-11-25` and earlier — initialize handshake.
- **Dual-era server:** answers both on same endpoint.

### Recommended path for Atoms Ask (stateless Streamable HTTP today)

1. **Upgrade to TS SDK v2** packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/node` or express adapter). Run codemod:
   ```bash
   npx @modelcontextprotocol/codemod@latest v1-to-v2 .
   ```
2. **Serve with `createMcpHandler(factory)`** — default `legacy: 'stateless'` serves both eras per-request from one factory. Your v1 pattern (`sessionIdGenerator: undefined`, fresh server per request) maps 1:1.
3. **One tool/resource factory** for both eras. Write interactive flows in MRTR `inputRequired(...)` form; SDK legacy shim converts to server→client requests for 2025 clients (when streaming session exists — see pitfall on JSON-only).
4. **Advertise supported versions** via `server/discover` and in `-32022` error `data.supported` (include at least `2026-07-28` and the legacy revisions you still test, e.g. `2025-11-25` / `2025-03-26` as needed).
5. **Do not flip `legacy: 'reject'`** until Claude + other hosts you care about are modern-only. Claude blog (2026-07-28): support is “rolling out across Claude products soon” — dual-era is required in the interim.
6. **Auth hardening is era-independent** in v2 (iss, CIMD, credential isolation are SDK opt-ins on every era once enabled).

### Version header / body

Modern clients send:

```http
POST /mcp HTTP/1.1
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: search
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer …

{
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{
    "name":"search",
    "arguments":{…},
    "_meta":{
      "io.modelcontextprotocol/protocolVersion":"2026-07-28",
      "io.modelcontextprotocol/clientInfo":{"name":"…","version":"…"},
      "io.modelcontextprotocol/clientCapabilities":{}
    }
  }
}
```

Server validation: header version === body `_meta` version; method/name headers match body; else `-32020`.

### Client-side era detection (for your own clients/tests)

- Prefer modern request first.
- On HTTP 400: if body is recognized modern error (`-32022`, `-32020`, `-32021`) → stay modern / retry with advertised version.
- If body empty or not modern → fall back to `initialize` (legacy).
- Cache era per origin.

### Compatibility matrix (server dual-era)

| Client | Dual-era server |
|---|---|
| Modern | Works (discover optional) |
| Legacy | Works (`initialize` → legacy revision) |
| Dual-era client | Works either path |

Legacy-only client vs modern-only server: **fails** (no fall-forward). Dual-era server is the safe default while ecosystem rolls out.

---

## 4. Header-based routing (`Mcp-Method`, `Mcp-Name`)

Source: [Streamable HTTP § Request Metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#request-metadata) (SEP-2243).

### What clients MUST send

| Header | Source | Required when |
|---|---|---|
| `MCP-Protocol-Version` | `_meta` protocol version | All POSTs |
| `Mcp-Method` | JSON-RPC `method` | All requests |
| `Mcp-Name` | `params.name` or `params.uri` | `tools/call`, `resources/read`, `prompts/get` |

Optional custom: tool params annotated `x-mcp-header` → client mirrors as `Mcp-Param-{Name}` (primitive string/int/bool only; static property paths).

### Encoding

Non-ASCII / control / leading-trailing whitespace / sentinel-shaped values → Base64 sentinel:

```text
Mcp-Name: =?base64?{Base64UTF8}?=
Mcp-Param-Region: =?base64?…?=
```

Header **names** case-insensitive; **values** (methods) case-sensitive.

### What servers MUST do

- **Accept** the headers on modern POSTs.
- **Validate** after decode: headers match body; missing required headers → fail.
- On failure: HTTP **400** + JSON-RPC error **`-32020` HeaderMismatch**.
- Decode Base64 sentinels before compare.
- Integer params: prefer numeric compare (`42` vs `42.0`).
- Unknown `Mcp-Param-*`: intermediaries forward; servers that recognize a param MUST validate.

### What servers emit

Spec focuses on **client→server** request headers for routing. Server responses are normal HTTP + JSON-RPC/SSE; no requirement found for servers to *emit* `Mcp-Method`/`Mcp-Name` on responses.

### Gateways

Intermediaries can route/rate-limit on headers without parsing body, but **SHOULD** only trust headers when `MCP-Protocol-Version` indicates a revision that requires header↔body validation; otherwise reject rather than trust unvalidated headers.

### `enableJsonResponse: true` note

Headers still apply; response may be single `application/json` object instead of SSE. Cancellation on modern HTTP = close SSE stream (not `notifications/cancelled`); JSON-only has no stream to close mid-flight — relevant for long tools.

---

## 5. `tools/list` cache fields

Source: [Caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) (SEP-2549).

### Required on complete results

For `tools/list` (and discover/prompts/resources list/read/templates):

```json
{
  "tools": [ … ],
  "ttlMs": 300000,
  "cacheScope": "public",
  "resultType": "complete"
}
```

| Field | Type | Meaning |
|---|---|---|
| `ttlMs` | integer ≥ 0 | Freshness hint (ms). `0` = immediately stale. Absent (old servers) clients treat as 0. Negative → treat as 0. |
| `cacheScope` | `"public"` \| `"private"` | `public`: safe for shared caches / any user. `private`: per authorization context only. |

### Rules

- Only `resultType: "complete"` is cacheable; `input_required` interim results are not.
- Cache key = method + params that affect result (e.g. pagination `cursor`).
- MRTR retries with `inputResponses`/`requestState` MUST NOT be cached.
- Notifications (e.g. tools list_changed) **invalidate** fresh cache immediately.
- Paginated lists: each page own TTL; same `cacheScope` across pages of one request.
- **Security:** `public` tools/list from authenticated endpoint may still be shared across tokens — only mark public if catalog is identical for all users.
- Prefer deterministic tool order (changelog).

### Suggested defaults for Atoms Ask

- If tool catalog is the same for every authenticated user: `cacheScope: "public"`, `ttlMs` in range of minutes (e.g. 300000) unless tools change often.
- If tools vary by user/plan: `cacheScope: "private"`.
- Pair with `listChanged` capability + `subscriptions/listen` when you need push invalidation.

---

## 6. Claude connectors directory submission checklist

Sources: [submission](https://claude.com/docs/connectors/building/submission), [review criteria](https://claude.com/docs/connectors/building/review-criteria), [authentication](https://claude.com/docs/connectors/building/authentication).

### Access prerequisites

- [ ] Team or Enterprise Claude org (portal in admin settings)
- [ ] Owner / Primary owner, or Enterprise custom role with Directory management / Libraries
- [ ] Agree to Anthropic Software Directory Terms + Policy

### Technical / product requirements

- [ ] Remote MCP over **HTTPS** Streamable HTTP (or SSE — SSE is deprecated in MCP but portal still lists it)
- [ ] OAuth 2.0 for authenticated services (`oauth_dcr`, `oauth_cimd`, or coordinated `oauth_anthropic_creds`)
- [ ] Every tool has **`title`** + applicable **`readOnlyHint` / `destructiveHint`**
- [ ] Split read vs write tools (no catch-all `api_request` with method param)
- [ ] Tool names ≤ 64 chars; narrow accurate descriptions; no prompt-injection patterns in descriptions
- [ ] Tools succeed with valid params; actionable errors
- [ ] First-party API ownership (or legitimate proxy); domain matches service
- [ ] No money/crypto transfer; no AI image/video/audio gen (diagrams/charts OK)
- [ ] Privacy policy URL (required for local; remote listing also collects privacy URL in portal)
- [ ] Public documentation URL by publish date
- [ ] Optional: allowed link URIs for `ui/open-link` (origins you own only)
- [ ] MCP Apps: 3–5 PNG screenshots ≥1000px width, app-only crop, paired prompts

### Portal steps (have ready)

Connection URL, transport, tools sync, listing (name ≤100, tagline ≤55, description ≤2000, categories, docs, privacy, support, icon, slug), use cases, company, auth mode, data handling, **fully populated test account** + step-by-step access, seven compliance acknowledgments.

### Pre-submit verification

- [ ] Exercise every tool via MCP Inspector and as custom connector in Claude
- [ ] Confirm CIMD path if chosen: metadata flags + `"none"` auth method
- [ ] Register Claude callback(s); PKCE S256
- [ ] Allowlist Anthropic egress if firewalled
- [ ] Latency: OAuth endpoints well under Claude timeouts

### Contact

- Escalations: `mcp-review@anthropic.com`
- Dashboard: `https://claude.ai/admin-settings/directory/submissions`

**Gap:** Claude blog says 2026-07-28 support is “rolling out … soon” — directory may still connect primarily via legacy Streamable HTTP until rollout completes. Dual-era server remains the safe submission posture. Exact Claude-required protocol version for directory review was **not** stated as a hard pin in fetched pages.

---

## 7. Migration pitfalls and recommended sequencing

### Pitfalls

1. **Assuming v2 SDK = modern wire** — Hand-built `McpServer` + connect still speaks 2025-era until `createMcpHandler` / `serveStdio` / client `versionNegotiation` opt-in.
2. **Sessionful mental model** — Any code keyed on `sessionId` must move to tool-arg handles or HMAC’d `requestState` (use `createRequestStateCodec`).
3. **`enableJsonResponse: true` + interactive tools** — Legacy MRTR shim needs a return path for server→client requests; JSON-only + stateless legacy cannot deliver mid-call elicitations (shim degrades to capability refusal / timeouts). Modern MRTR is request/response and works with JSON for non-streaming rounds; progress still wants SSE.
4. **Missing headers on modern path** — Proxies stripping `Mcp-*` / `MCP-Protocol-Version` → `-32020` / 400.
5. **Header/body drift** — Gateways rewriting method without body (or vice versa) fail validation by design.
6. **Forgetting `server/discover`** — Server MUST implement.
7. **Forgetting `ttlMs`/`cacheScope`/`resultType`** — Modern clients/SDK may treat as incomplete or default ttl 0.
8. **Logging silence on modern** — No `notifications/message` unless client sent `logLevel` in `_meta`.
9. **DCR client explosion** — Claude DCR path registers per connection; prefer CIMD for directory scale.
10. **Claude CIMD incomplete metadata** — Missing `"none"` in `token_endpoint_auth_methods_supported` → silent fall back to DCR.
11. **iss validation is client-side** — You still should emit `iss` now; clients that validate will reject mismatches/absences when advertised.
12. **Package dual-install boundary** — v1 and v2 packages can coexist by name but objects must not cross (`instanceof` breaks). Stage by process/transport boundary.
13. **Node 20+** required for v2.
14. **Error code renumber** — Don’t hardcode old alpha codes (`-32001` etc.).
15. **Tests still on `2025-03-26` only** — Add modern suite: headers, `_meta`, discover, cache fields, no initialize; keep legacy suite until reject.
16. **GET/DELETE clients** — Dual default legacy stateless returns 405 for session GET/DELETE; sessionful legacy clients need explicit `isLegacyRequest` branch to old sessionful handler.

### Recommended sequencing

| Phase | Work | Exit criteria |
|---|---|---|
| **0. Inventory** | List tools, auth endpoints, clients (Claude custom connector, Inspector, any SDK clients), session assumptions | Written matrix |
| **1. Auth harden (era-neutral)** | Emit `iss` + metadata flag; verify CIMD Claude dual-flag; keep DCR; PRM/resource/PKCE audit | Claude OAuth green; no DCR-only dependency for primary clients |
| **2. SDK v2 codemod** | `npx @modelcontextprotocol/codemod v1-to-v2 .`; fix markers; Node 20 | Typecheck + existing tests green on legacy behavior |
| **3. Dual HTTP entry** | `createMcpHandler(factory)` default legacy stateless; same tool registration | Legacy clients unchanged; modern probe works |
| **4. Modern completeness** | `server/discover`; `ttlMs`/`cacheScope`; `resultType`; deterministic tool order; header validation (SDK); Origin validation | Conformance against 2026-07-28 Streamable HTTP examples |
| **5. Interactive paths** | Port any elicitation to `inputRequired` + sealed `requestState`; decide JSON vs SSE per tool | Both eras pass interactive smoke |
| **6. Test matrix** | Legacy: initialize + your `2025-03-26` cases. Modern: headers, `_meta`, discover, cache, HeaderMismatch, UnsupportedProtocolVersion | CI both eras |
| **7. Claude dogfood** | Custom connector + Inspector; then directory pre-checklist | Ready for portal |
| **8. Directory submit** | Portal when product-ready | Listing live |
| **9. Later** | Monitor Claude modern rollout; consider `legacy: 'reject'`; plan DCR off after 12-month window / traffic data | Modern-only optional |

**Do not** drop DCR or legacy initialize in the same PR as the first dual-era cut.

---

## 8. Authoritative links

### Spec (2026-07-28)

- https://modelcontextprotocol.io/specification/2026-07-28
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
- https://modelcontextprotocol.io/specification/2026-07-28/server/discover
- https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- https://modelcontextprotocol.io/specification/2026-07-28/schema
- https://modelcontextprotocol.io/llms.txt
- Schema TS: https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts

### SEPs (named in changelog)

- SEP-2567 sessionless: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567
- SEP-2575 stateless: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575
- SEP-2243 headers: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243
- SEP-2549 TTL: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2549
- SEP-2468 iss: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2468
- SEP-2322 MRTR: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2322
- SEP-2663 tasks extension: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663
- DCR deprecate / CIMD: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2858
- Feature lifecycle SEP-2596: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2596
- SEP index: https://modelcontextprotocol.io/seps/index

### Blog / Claude

- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://claude.com/blog/bringing-mcp-2026-07-28-to-claude
- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria
- https://claude.com/docs/connectors/building/authentication

### TypeScript SDK

- https://github.com/modelcontextprotocol/typescript-sdk (main = v2)
- https://ts.sdk.modelcontextprotocol.io/v2/
- https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html
- https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html
- https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html
- v1 docs (still maintained ≥6 months): https://ts.sdk.modelcontextprotocol.io/

### External RFCs

- RFC 9207 iss: https://datatracker.ietf.org/doc/html/rfc9207
- RFC 7591 DCR: https://datatracker.ietf.org/doc/html/rfc7591
- CIMD draft: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
- RFC 9728 PRM: https://datatracker.ietf.org/doc/html/rfc9728
- RFC 8707 resource indicators: https://www.rfc-editor.org/rfc/rfc8707.html

---

## Gaps / thin docs

1. **Hard DCR removal date** — not specified; only ≥12-month deprecation window.
2. **Claude product protocol pin** — “rolling out soon”; no mandatory `2026-07-28` directory gate found in fetched pages.
3. **Exact default `ttlMs` recommendations** — server-chosen; no official numeric default beyond “MUST provide ≥ 0”.
4. **Whether intermediaries may inject `Mcp-*` headers** — validation assumes client authenticity of header↔body match; no separate intermediary injection profile beyond “forward unknown Mcp-Param”.
5. **Full `server/discover` response schema** — referenced but not fully expanded in this research fetch; see schema + discover page before implementing by hand (prefer SDK).
6. **v1.29 dual-era without v2** — no official guidance to implement 2026-07-28 on v1 SDK; path is upgrade to v2.

---

## Bottom line for Atoms Ask

You are already **stateless Streamable HTTP** — the hardest architectural jump is mostly done. Highest-leverage next moves: (1) auth iss + Claude CIMD dual-flag verification, (2) SDK v2 + `createMcpHandler` dual-era default, (3) modern completeness (`discover`, cache fields, `resultType`, headers via SDK), (4) keep DCR + legacy initialize until Claude modern rollout and directory traffic prove otherwise.
