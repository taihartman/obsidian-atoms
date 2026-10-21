---
title: "OpenClaw Ask login - Plan"
date: 2026-09-24
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
type: feat
topic: openclaw-ask-login
deepened: 2026-09-24
---

# OpenClaw Ask login - Plan

## Goal Capsule

**Objective.** OpenClaw’s shared operator login finishes against the Ask MCP server that Claude and ChatGPT already use. The server allows its loopback callback. The human still consents. Settings and the site keep their current names.

**Product authority.** Key Decisions below. Ask MCP vocabulary in `CONCEPTS.md`.

**Open blockers.** None.

**Lane.** Full. The change is an OAuth redirect allowlist.

**Stop.** Do not accept a public Gateway callback. Do not add MCP tools, a paste-a-token path, or a plugin version bump. Do not edit `src/` or `www/`. Do not deploy Plus, and do not touch a personal vault.

**Tail.** Hard claim before code. Plus-service tests for the allowlist and the sign-in page. Operator notes match the page the human actually sees.

**Product Contract preservation:** bootstrap. No upstream requirements-only plan.

---

## Product Contract

### Summary

OpenClaw signs in to Ask with the same OAuth server, the same `mcp_` grant, and the same tools. Registration and authorize accept `http://127.0.0.1:<port>/oauth/callback` and `http://localhost:<port>/oauth/callback`. A public host is refused. The sign-in page tells a loopback client that an app on this computer is connecting, and it still points at the existing Settings row for the pairing code. Operator notes cover the copied MCP URL, Streamable HTTP, and the `--code` fallback.

### Problem Frame

Ask is already a public Streamable HTTP MCP server. Claude and ChatGPT complete OAuth because their callbacks are on the allowlist. OpenClaw’s shared login registers `http://127.0.0.1:8989/oauth/callback` and, if that registration is rejected, retries `http://localhost:8989/oauth/callback`. Today the loopback allowlist only accepts the path `/callback`, so dynamic registration returns `invalid_redirect_uri` and authorize never starts. A public Gateway callback (`<gateway origin>/oauth/mcp/callback`) is a different OpenClaw flow and would deliver the authorization code off the machine.

### Key Decisions

- Loopback callback only. (session-settled: user-approved — chosen over a public Gateway host: the authorization code would leave the machine.) Governs R1, R2.
- One shared sign-in on the OpenClaw machine. (session-settled: user-approved — chosen over a separate Plus account per chat sender: that flow uses the public Gateway callback.) Governs R3.
- Settings and the site keep saying Claude and ChatGPT. (session-settled: user-approved — chosen over naming OpenClaw in those surfaces: the confirmed scope is the connection and the operator notes.) The consent page may show the name the client registered. Governs R5, R6.

### Requirements

**Callback**

- R1. Registration and authorize accept a loopback redirect whose path is `/oauth/callback` or `/oauth/callback/`, on `127.0.0.1`, `localhost`, or `[::1]`, on any port. A non-empty query, a fragment, or userinfo is refused. Any other host is refused, including a Gateway origin and the path `/oauth/mcp/callback`.
- R2. Claude’s exact callback, ChatGPT’s connector redirects, and loopback `/callback` stay accepted. The query rule in R1 applies to loopback only.

**Sign-in**

- R3. The supported OpenClaw path is shared operator login. The grant is the Plus email from consent. The server does not record a machine id.
- R4. After Allow, the browser is sent to the registered redirect with `code`, `state`, and `iss`, through the existing same-origin handoff. A rejected registration still returns the error `invalid_redirect_uri`.
- R5. The human finishes with the magic link or the existing pairing code. Both loopback sign-in screens, including the account chooser and an error re-render, say an app on this computer is connecting, and they name the Settings row that actually issues the code. A loopback redirect never uses the Claude or ChatGPT sentence, even when the client id contains those hosts. An opaque client shows its registered name, unless that name is empty, is the raw id, or is Claude or ChatGPT, in which case the label is AI app. Non-loopback screens keep their current sentences.

**Notes and unchanged product**

- R6. Settings and the website gain no OpenClaw wording. The self-host guide, the Plus runbook, and the Ask MCP glossary sentence document `auth: oauth`, Streamable HTTP, the copied MCP URL, `openclaw mcp login`, the `--code` fallback, and the refusal of a public Gateway callback. The MCP URL is the canonical `{base}/mcp` resource. A loopback MCP URL works only when that string is `PUBLIC_BASE_URL` plus `/mcp`.
- R7. MCP tools, scope minting, `sess_` rejection on `/mcp`, and filing rules stay as they are. Allow still grants `atoms:read` and `atoms:write` plus a refresh token. `offline_access` stays advertised and is not a third minted scope.

### Actors

- A1. The person who runs OpenClaw and owns the Plus account.
- A2. OpenClaw, as the MCP client that holds the refresh token.
- A3. The Ask authorization server.

### Key Flows

- F1. Shared login
  - **Trigger:** A1 adds the copied MCP URL with Streamable HTTP and runs `openclaw mcp login`.
  - **Actors:** A1, A2, A3
  - **Steps:** A2 registers one loopback redirect. A1 opens the printed URL, signs in with a magic link or a pairing code, and clicks Allow. The handoff opens the loopback callback. A2 exchanges the code and calls an existing Ask tool.
  - **Covered by:** R1, R3, R4, R5, R7
- F2. Listener miss
  - **Trigger:** Nothing accepts the loopback callback. The port is busy, the browser is on another machine, or OpenClaw’s wait ends.
  - **Actors:** A1, A2
  - **Steps:** A1 copies the `code` query value from the Continue link and runs `openclaw mcp login <name> --code <code>`. The page does not print the code as body text. The value is the authorization code, not an `mcp_` token.
  - **Covered by:** R4, R6

### Acceptance Examples

- AE1. Register `http://127.0.0.1:8989/oauth/callback` and the localhost twin. Both succeed. Authorize the first URI and the page says an app on this computer is connecting. Covers R1, R5.
- AE2. Register `https://gateway.example/oauth/mcp/callback`. The response is `invalid_redirect_uri` and the browser is not redirected. Covers R1, R4.
- AE3. Authorize Claude’s callback. The page still says Connect Claude or ChatGPT. Covers R2, R5.
- AE4. `http://127.0.0.1:8989/oauth/callback?next=https://evil.example` and `http://user:pass@127.0.0.1:8989/oauth/callback` are refused. `http://127.0.0.1:8989/oauth/mcp/callback` is refused. Covers R1.

### Success Criteria

- A1 can finish F1 against a Plus process running this code, using the existing Copy URL button and the existing pairing row.
- Claude and ChatGPT authorize pages keep their current sentences.
- `src/` and `www/` have no diff.

### Scope Boundaries

- The public Gateway callback and per-sender Plus accounts stay out. That flow needs a redirect host this plan refuses.
- No new MCP tools, no static bearer, and no change to mirror or outbox rules.
- No OpenClaw wording in Settings or on the site.
- Port 8989 is not pinned. OpenClaw’s listener, its five-minute wait, and its SSE default stay OpenClaw’s behavior. The notes describe them.
- The consent sentence that names Anthropic or OpenAI stays on the Claude and ChatGPT pages.

#### Deferred to Follow-Up Work

- Per-sender accounts, if a later plan accepts a public callback under a reviewed host rule.
- A live check that a specific OpenClaw build ignores the `iss` query on the callback. This plan keeps `iss`.

### Sources

- Allowlist: `plus-service/src/oauth/constants.mjs`. Registration and authorize: `plus-service/src/oauth/routes.mjs`. Sign-in copy: `plus-service/src/oauth/html.mjs`. Resource and scopes: `plus-service/src/oauth/metadata.mjs`.
- OpenClaw shared login, checked 2026-09-24 against `main` `78398c58` and the transports doc: default redirect `http://127.0.0.1:8989/oauth/callback`, localhost retry on an error that matches `redirect_uri`, one redirect per registration, client name `OpenClaw MCP`, transport defaults to SSE, listener path is exact and a trailing slash 404s.
- MCP authorization 2026-07-28: exact redirect match, loopback port may vary, dynamic registration remains available. RFC 8252: the code for a loopback redirect stays on the machine.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Extend `isAllowedRedirectUri` with two exact loopback paths, `/oauth/callback` and `/oauth/callback/`. Keep the existing hosts and any port. Refuse a non-empty query or fragment on every loopback redirect, including `/callback`. Compare the parsed pathname so `..` is normalized, and do not prefix-match. (session-settled: user-approved — chosen over a public Gateway host: the authorization code would leave the machine.) Governs R1, R2.
- KTD2. Leave dynamic registration, the `invalid_redirect_uri` error, `registration_endpoint`, and `client_id_metadata_document_supported` in place. OpenClaw’s localhost retry looks for that error text. Its default login uses registration unless the operator sets a client-metadata URL. Governs R4.
- KTD3. A loopback redirect uses the local-app sentence on the email form, the account chooser, and consent, including error re-renders. It does not use the Claude or ChatGPT label, even when the client id contains `claude.ai` or `chatgpt.com`. An opaque id shows the stored client name only when that name is non-empty, is not the raw id, and is not Claude or ChatGPT. Otherwise the label is `AI app`. Escape that name the way the page already escapes the email. Non-loopback screens keep `oauthClientLabel`. Do not hardcode OpenClaw. Governs R5.
- KTD4. Do not edit the OAuth CSP. The handoff stays a 200 page with a meta refresh, a Continue link, and `iss`. Before that page is written, parse the stored redirect and run `isAllowedRedirectUri` again. A failure shows the error page and sets no `Location`. The host check uses the parsed hostname, not a substring search. Notes tell the operator to use OpenClaw’s default redirect, which has no trailing slash, and to paste `--code` only into the OpenClaw process that printed the login URL. Governs R4, R6.
- KTD5. Operator notes are the only new OpenClaw wording. They name the real Settings row, `auth: oauth`, `transport: streamable-http`, and the copied URL that ends in `/mcp`. They do not set an OAuth scope. They say `--code` is the `code` query on the Continue link. A loopback MCP URL is valid only when it is exactly `PUBLIC_BASE_URL` plus `/mcp`. Hosted Plus and a production self-host use the public HTTPS URL. Governs R6.
- KTD6. Consent stays human-only. One Allow mints the existing account-scoped `mcp_` grant for every agent that shares that OpenClaw login. Refresh does not ask again. The plugin `sess_` session and Allow filing stay the vault gate. Do not re-check the redirect predicate at token exchange, and do not put an entitlement check inside the predicate. Governs R3, R7.

### High-Level Technical Design

```mermaid
sequenceDiagram
  participant OC as OpenClaw
  participant Br as Browser
  participant AS as Ask OAuth
  OC->>AS: POST /oauth/register one loopback redirect
  AS-->>OC: client_id
  OC->>Br: authorization URL
  Br->>AS: GET /oauth/authorize
  AS-->>Br: sign-in page
  Br->>AS: magic link or pairing code, then Allow
  AS-->>Br: handoff to loopback with code, state, iss
  Br->>OC: GET /oauth/callback
  OC->>AS: POST /oauth/token
  OC->>AS: existing MCP tool with mcp_
```

The redirect predicate is the only new gate. Token exchange still compares the stored redirect string, including the port, and does not call the predicate again. Protected-resource metadata already publishes `{base}/mcp` as `resource`. OpenClaw sends that value when the configured URL is that URL. An omitted `resource` already defaults to the canonical MCP URL. A configured loopback URL does not match a public resource.

### Risks

- OpenClaw waits about five minutes for the callback. A slow magic link outlives that wait. F2 and the Continue URL are the recovery. The authorization code is minted at Allow and does not depend on the listener.
- An omitted `transport` makes OpenClaw use SSE after a successful login. R6 leads with Streamable HTTP so the tools call the right endpoint.
- Consent will show `OpenClaw MCP` when that is the registered client name. That is the client’s own name, not a Settings or site rename.
- `iss` stays on the callback because the metadata already advertises it. A client that rejects unknown callback parameters would fail after Allow. Do not remove `iss` to chase that.
- Hosted Plus serves this only after a later Plus deploy. This plan does not deploy.
- Dynamic registration accepts a client name, and a client id can contain `claude.ai` without being Claude. KTD3 keeps the local-app sentence on every loopback page. The authorization code in the Continue link is useful only to the client that started that login. The notes say to paste it only into that OpenClaw process.
- Refusing a query on every loopback path also tightens Claude Code’s `/callback`. That is intended. ChatGPT query strings stay allowed.

### System-Wide Impact

- The predicate change is the whole server change. Authorize already uses it as the only redirect gate. Token exchange compares the stored string. The OAuth CSP already allows loopback HTTP on any port. Entitlement stays on `subscriptionLive` at consent and on `accountFromMcpToken` at `/mcp`.
- OpenClaw holds `mcp_` only. The plugin keeps `sess_` for mirror writes and outbox apply. `sess_` on `/mcp` and `mcp_` on mirror routes stay refused. `atoms:write` enqueues. Atoms land after Allow filing.
- One Allow is one Plus email. Every agent on that OpenClaw install that uses the shared login holds the grant. The server stores no agent id or machine id. Sign-out-all and mirror wipe revoke it with the other connector grants for that email. This plan adds no per-client revoke.
- `isAllowedPlusBaseUrl` is a different predicate. It allows HTTPS on any host because Plus calls send `sess_`. Do not use it for `redirect_uri`.
- The account chooser is not a grant. Continue still lands on Allow. The loopback sentence has to be on that chooser, or a returning browser never sees it.

---

## Implementation Units

### U1. Loopback `/oauth/callback`

- **Goal:** Registration and authorize accept OpenClaw’s two default redirects and refuse the neighbors in R1.
- **Requirements:** R1, R2, R4. KTD1, KTD2.
- **Dependencies:** None.
- **Files:** `plus-service/src/oauth/constants.mjs`, `plus-service/src/oauth/routes.mjs`, `plus-service/test/oauth-redirect.test.mjs`, `plus-service/test/http-ask-oauth.test.mjs`
- **Approach:** Change the loopback branch of the existing predicate. Leave the Claude string match and the ChatGPT path match alone. Keep the DCR error body. Do not call `isAllowedPlusBaseUrl`. If a stored client has only non-loopback redirects, refuse a loopback authorize. An unknown client may still be registered on the fly when the request URI is allowlisted. Do not require one stored URI for ChatGPT, which already uses two https redirects. Re-check the predicate in the handoff writer per KTD4.
- **Execution note:** Write the predicate tests first. The pure function is the gate both routes already call.
- **Patterns to follow:** `isAllowedRedirectUri` and the redirect cases in `plus-service/test/oauth-redirect.test.mjs`. The register and authorize cases in `plus-service/test/http-ask-oauth.test.mjs`.
- **Test scenarios:**
  - `http://127.0.0.1:8989/oauth/callback` and `http://localhost:8989/oauth/callback` are allowed. `http://[::1]:8989/oauth/callback` is allowed.
  - `http://127.0.0.1:9/callback` stays allowed. Claude’s callback and `https://chatgpt.com/connector/oauth/abc123` stay allowed. A ChatGPT URL with a query string stays allowed.
  - `http://127.0.0.1:8989/oauth/callback/` is allowed. `http://127.0.0.1:8989/oauth/callbackevil`, `http://127.0.0.1:8989/oauth/mcp/callback`, and `http://127.0.0.1:8989/oauth/callback/extra` are refused.
  - `http://127.0.0.1:8989/oauth/foo/../callback` is allowed, because the parser normalizes the path before the check.
  - `http://127.0.0.1:8989/oauth/callback?next=https://evil.example`, a fragment, and `http://user:pass@127.0.0.1:8989/oauth/callback` are refused. `http://127.0.0.1:9/callback?x=1` is refused.
  - `https://gateway.example/oauth/callback`, `https://gateway.example/oauth/mcp/callback`, `http://127.0.0.2/oauth/callback`, and `http://127.0.0.1:8989@evil.example/oauth/callback` are refused. The last one is host `evil.example`.
  - A client already stored with only ChatGPT redirects cannot authorize `http://127.0.0.1:8989/oauth/callback`. That call returns the HTML error and no `Location`. An unknown client can still register that URI and authorize it.
  - The handoff writer refuses a stored URI that fails the predicate and does not emit `Location`.
  - `POST /oauth/register` with the OpenClaw URI returns 201. The same call with the Gateway URI returns 400 and the body contains `invalid_redirect_uri`. A list that mixes one good URI and one bad URI stores nothing.
  - `GET /oauth/authorize` with the OpenClaw URI returns the sign-in page. The Gateway URI returns the existing HTML error and does not redirect.
- **Verification:** The predicate tests and the HTTP register and authorize tests fail before the predicate change and pass after it. Claude and ChatGPT cases still pass.

### U2. Loopback sign-in copy

- **Goal:** A loopback client sees an honest sign-in page and its registered name. Claude and ChatGPT pages stay as they are.
- **Requirements:** R5. KTD3, KTD6.
- **Dependencies:** U1
- **Files:** `plus-service/src/oauth/constants.mjs`, `plus-service/src/oauth/html.mjs`, `plus-service/src/oauth/routes.mjs`, `plus-service/test/oauth-redirect.test.mjs`, `plus-service/test/http-ask-oauth.test.mjs`
- **Approach:** Follow KTD3 for the label and for which screens get the loopback sentence. The three consent call sites in `routes.mjs` share one lookup. Pairing instructions keep the text `Link Claude / ChatGPT` on every page, because that is the row in Settings. Continue on the account chooser still lands on Allow.
- **Patterns to follow:** `oauthClientLabel` in `plus-service/src/oauth/constants.mjs`. `authorizeEmailForm`, `authorizeChooserForm`, and `consentForm` in `plus-service/src/oauth/html.mjs`.
- **Test scenarios:**
  - A non-loopback Claude client id still labels Claude. A non-loopback ChatGPT redirect still labels ChatGPT. A loopback redirect whose client id contains `claude.ai` still uses the local-app sentence and does not say Claude. An opaque id with client name `OpenClaw MCP` labels `OpenClaw MCP`. An opaque id with client name `Claude`, or a client name equal to the raw id, labels `AI app`. A client name that is a meta-refresh tag is escaped and does not become markup.
  - Authorize with `http://127.0.0.1:8989/oauth/callback` on the email form and on the account chooser returns HTML that says an app on this computer is connecting and names `Link Claude / ChatGPT`. Loopback consent does not say the results go only to Anthropic or OpenAI.
  - Authorize with Claude’s callback still contains `Connect Claude or ChatGPT` and the consent muted sentence that names Anthropic or OpenAI.
- **Verification:** The label tests and one HTTP authorize assertion cover both pages. A Claude authorize response still matches the current sentences.

### U3. Operator notes

- **Goal:** A person can finish F1 and F2 from the notes, without a Settings or site change.
- **Requirements:** R6. KTD4, KTD5.
- **Dependencies:** U1, U2
- **Files:** `docs/ask-self-host.md`, `docs/runbooks/atoms-plus-prod.md`, `CONCEPTS.md`
- **Approach:** Follow KTD5. Update the allowlist sentences so they include loopback `/oauth/callback` and still mention `/callback`. State the failure strings the server already returns: `redirect_uri not allowed` and `resource must be …`. Say the Copy URL button and the pairing row keep their current names. Say not to point the redirect at `/callback` once this ships, and not to use a public Gateway callback.
- **Test scenarios:**
  - Test expectation: none. These are prose docs. The notes are wrong if they rename a Settings row, omit `streamable-http`, or tell the operator to use a trailing slash or a public callback.
- **Verification:** The three docs agree with R1 and R6. `src/` and `www/` are untouched, so the settings and site label tests need no edit.

---

## Verification Contract

- From `plus-service/`, run `node --test test/oauth-redirect.test.mjs test/http-ask-oauth.test.mjs`, then `npm test`.
- `git diff --name-only` includes no path under `src/` or `www/`.
- No plugin version bump. No Plus deploy in this change.

## Definition of Done

- U1, U2, and U3 meet their verification lines.
- AE1 through AE4 hold.
- Abandoned experiments are not left in the diff.
- The hard claim exists before implementation, per `docs/collab.md`.
