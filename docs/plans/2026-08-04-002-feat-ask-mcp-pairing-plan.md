---
title: Ask MCP pairing code - Plan
date: 2026-08-04
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
doc_review: 2026-08-04 auto-resolve (requirements)
product_contract_preservation: "unchanged intent; R-IDs extended in requirements pass (R2b, R4b, R5b, R7b); planning adds KTD/U only"
---

# Ask MCP pairing code - Plan

**Lane:** full feature (auth + OAuth HTML + store + plugin Settings)  
**Doc-review:** full before `ce-work` if plan material changes mid-flight  

## Goal Capsule

**Objective.** A Plus user can connect Claude or ChatGPT to their Ask mirror even when the OAuth browser cannot (or will not) complete magic link on the Plus email — by proving possession of an already-signed-in Obsidian Plus session via a short-lived pairing code. The mirror tenant stays the Plus account email forever. Wrong prior OAuth browser identity is escapable without opening the Plus inbox.

**Product authority.** This plan’s Product Contract; constitution Ask rules in `CLAUDE.md` + `docs/architecture.md` § Ask mirror sync; existing Ask OAuth design in `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md` (KTD8–11, KTD17–18).

**Stop conditions.**

- HTTP + store tests green for mint / single-active / redeem / fail-closed / cookie chooser override.
- Magic-link OAuth E2E still green (`http-ask-oauth`).
- Fly deploy of plus-service **before** plugin BRAT release.
- Dogfood AE1 + AE1b (+ AE6 if cookie present) on `https://plus.tryatoms.app`.

## Product Contract

### Summary

Ship **pairing codes from Obsidian** as a second OAuth path alongside email + magic link. Codes bind MCP tokens to the plugin’s Plus email. Authorize always lets the user switch identity (including when an OAuth browser cookie is already present). Settings Ask status shows that Plus email so dual-tenant mistakes are visible without Fly SQL.

### Problem Frame

Plugin push and MCP tools both key `atom_mirror` by email, but credentials are independent (`sess_` vs `mcp_`). Claude’s account name never reaches Atoms; only the email typed on the OAuth form **or a prior OAuth browser cookie** does. Users often complete connector OAuth under a different address than Atoms Plus (wrong free-text email, different inbox on phone, Claude profile ≠ Plus email). Result: Settings shows a healthy fresh count while Claude reads a week-stale or empty other tenant. “Just reconnect as Plus email” fails when the user cannot open that inbox **or** when the authorize page skips the form because a prior entitled browser session is still bound. Billing is not the issue (Claude and Atoms are separate); inbox/identity split is.

### Key Decisions

- **Pairing code from plugin, not secondary emails or mirror grants.**
  Tenant stays one email; no alias resolution on every `WHERE email=`. ACL/share is out of product identity for a personal second brain.
  `(session-settled: user-directed — chosen over secondary email / deep-link-only / aliases)`

- **Both OAuth entry paths, plus identity switch when already signed in.**
  Keep email + magic link. Add “I have a code from Obsidian.” When an OAuth browser session already exists, do not jump straight to consent without a chooser — Continue as {email} / Use a code / Use a different email.
  `(session-settled: user-directed — both paths; cookie chooser promoted after doc-review)`

- **Settings surfaces Plus email on Ask status.**
  Happy: `Ask mirror: N · as you@… · last pushed …`. Error: `Ask mirror: N · as you@… · push failed — …`.
  `(session-settled: user-directed — chosen over pairing-only and over MCP tenant hint)`

- **MCP tokens always bind to Plus account email after successful pair or magic link.**
  Claude/ChatGPT profile email is never a mirror tenant key.

- **Proof of possession = verified Plus session at mint; code is a short-lived bearer after that.**
  Same trust class as mirror write with `sess_` at mint time. After mint, whoever holds a valid unused code can complete connector OAuth for that Plus email until TTL/consume. Short TTL, single active code, rate limits, and consent attention are the controls — not live `sess_` at redeem.

- **Short user-facing codes with compensating controls (not crypto-length paste strings).**
  Prefer pasteable short codes. Load-bearing: single-use, one active unredeemed code per account (remint invalidates prior), short TTL, mint + redeem rate limits / lockout, hash-at-rest, never log plaintext.

### Actors

| Actor | Role |
|---|---|
| Plus subscriber | Signed into Atoms in Obsidian; owns vault + mirror |
| Connector client | Claude or ChatGPT custom connector (OAuth AS consumer) |
| OAuth browser | Opens authorize/consent; may not have Plus inbox; may hold prior OAuth cookie |
| Plus service | Issues pair codes, mints `mcp_`/`mcpr_` for Plus email |

### Key Flows

**F1 — Pair then connect (Obsidian-first)**

1. User has Plus signed in (verified session) and Ask mirror enabled; mirror may already have atoms under Plus email.
2. Settings → Ask → **Link Claude / ChatGPT** → plugin requests a pairing code with `sess_`.
3. UI shows short code + expiry + copy affordance + “paste on the connector authorize page” (codes are secrets — do not share/screenshot).
4. User starts Connect in Claude/ChatGPT → authorize page.
5. User chooses code path, pastes code → server validates unexpired + unconsumed + entitled account → binds pending OAuth to that email; establishes/replaces OAuth browser session for A (KTD17 cookie rules if a cookie is set).
6. Consent shows **Plus email A**, OAuth **client label**, and scopes → Allow → auth code → tokens for A → tools see A’s mirror.
7. `list_atoms.server_count` / `last_synced_at` match plugin Ask status (same tenant).

**F1b — Connect-first (no code yet)**

1. User starts Connect in Claude/ChatGPT with no code prepared.
2. Authorize (anonymous or chooser) explains: open Obsidian → Ask Settings → Link Claude / ChatGPT → paste the code here. Magic-link path remains available and is labeled **Atoms Plus email** (not Claude/ChatGPT account).
3. User mints code in Obsidian, returns, completes F1 from step 5.

**F1c — Already signed in as wrong email B**

1. Authorize finds entitled OAuth browser session for B.
2. Page offers: **Continue as B** / **Use a code from Obsidian** / **Use a different email** (never silent skip to consent-only for B).
3. User picks code path, redeems code for A → pending and browser session bind to A → consent shows A → tokens for A.

**F2 — Magic link**

1. Authorize → type **Atoms Plus** email → magic link → consent → same tenant as today.
2. Pairing must not remove this path. Email field copy makes Atoms Plus vs Claude/ChatGPT account explicit.

**F3 — Fail closed / recovery**

1. Expired, already-consumed, mistyped, or rate-limited code → clear error; no `mcp_`; no partial grant.
2. Session not verified / not entitled → cannot mint; Settings explains sign-in / Plus required.
3. Code for A cannot attach tokens to B.
4. Redeem and consent Allow re-check account still `active`|`trialing`; lapse after mint → no tokens.
5. Consent Deny after successful redeem → no tokens; user must mint a **new** code (code consumed on redeem-bind per KTD3).
6. After successful pair, if connector still serves old tenant counts: disconnect/reconnect the connector client so it drops the old `mcp_` grant. Server does not silently revoke wrong-email B tokens when A pairs.

```text
Obsidian (sess_ → A)     Plus service              OAuth browser           Connector
        |                      |                          |                      |
        |-- POST pair (sess_) >|                          |                      |
        |<-- code (TTL, 1×) ---|                          |                      |
        |  show code           |                          |                      |
        |                      |<-- authorize (PKCE) -----|<-- start Connect ----|
        |                      |   chooser if bs present  |                      |
        |                      |<-- submit code ----------|                      |
        |                      |   bind pending → A       |                      |
        |                      |-- consent (A+client) --->|                      |
        |                      |<-- Allow ----------------|                      |
        |                      |-- tokens (email A) ----->|--------------------->|
        |                      |                          |                      |-- /mcp as A
```

### Requirements

**Identity and security**

- R1. Pairing proves possession of a **verified, entitled** Plus `sess_` for email A at **mint**, and causes MCP access/refresh tokens for that OAuth grant to use **email A** as the only mirror tenant.
- R2. Pairing codes are **bearer secrets**: short-lived, **single-use**, at most **one unredeemed code per Plus account** (new mint invalidates prior unused), rate-limited on mint and redeem, **hashed at rest**, never logged in plaintext (KTD18 parity with other auth secrets). Failed redeem attempts do not leak whether an email exists beyond existing magic-link behavior. Short pasteable codes are allowed only with these compensating controls as load-bearing (not optional polish).
- R2b. **Threat model (named):** possession of a valid unused pairing code is sufficient for an attacker-controlled connector OAuth on the real AS to bind to that Plus mirror (phishing paste). Mitigations: R2 controls + consent shows Plus email, scopes, and OAuth client label + code never mints `mcp_` outside an in-flight PKCE pending + plugin copy that codes are secrets.
- R3. Connector credential remains MCP OAuth (`mcp_` / `mcpr_`). Plugin `sess_` is never the connector Bearer. No paste-static-token path for Claude/ChatGPT.
- R4. Wipe, Stripe/subscription cancel MCP revoke, and existing MCP revoke-for-email continue to key off Plus email A. Pairing does not create a second wipe surface or auto-wipe wrong-email partitions.
- R4b. If pairing establishes an OAuth browser session, it matches KTD17 (opaque id, short-lived, HttpOnly/Secure/SameSite as today, not valid as `/mcp` or mirror Bearer).

**OAuth UX**

- R5. Authorize UI always offers, as applicable: (a) email + magic link labeled **Atoms Plus email**, (b) **I have a code from Obsidian**, (c) when an OAuth browser session exists — **Continue as {email}** / code / different email (no silent consent-only skip that traps users on wrong B).
- R5b. Empty/no-code code path instructs: open Obsidian → Ask Settings → generate code → paste here (Connect-first is first-class).
- R6. After a valid code, consent shows **Plus email**, **OAuth client label**, and scopes before Allow.
- R7. Same flow for Claude and ChatGPT (shared AS).
- R7b. Both authorize paths state that the mirror tenant is the **Atoms Plus** account; Claude/ChatGPT profile email is irrelevant.

**Plugin UX**

- R8. Entitled, signed-in users can mint a pairing code from Ask Settings. States at minimum: idle CTA; loading; active code + expiry + copy; expired → generate new; error (sign-in / Plus / network). Remint invalidates prior unused code (R2).
- R9. Ask status includes Plus email on happy and error lines: `Ask mirror: {N} · as {email} · last pushed {relative}` / `… · as {email} · push failed — …`.
- R10. Plugin copy states Claude/ChatGPT **account** email need not match; code or magic link binds the **Atoms** account; codes are secrets.

**Compatibility**

- R11. Existing connectors already bound to the correct Plus email keep working without re-pair.
- R12. Wrong-email prior OAuth is fixed by **connector re-auth** (code or correct magic link) so the client obtains A-bound tokens. No automatic merge of two `atom_mirror` partitions. Wrong-email partitions remain abandoned until wiped under that email (not under A). Old B-bound `mcp_` grants remain valid until the client discards them or B is revoked/wiped — Settings recovery copy may say disconnect/reconnect connector if counts still mismatch after pair.

### Acceptance Examples

- AE1. Plus `hartman.tai@…` has 56 mirrored atoms. User generates code in Obsidian, OAuth in Claude with that code only (no Plus inbox). `list_atoms` → `server_count: 56`, fresh `last_synced_at`; previously `not_in_mirror` post-2026-07-28 title fetches.
- AE1b. Connect-first: open authorize with no code; follow on-page guidance; mint in Obsidian; complete pair; same tenant match as AE1.
- AE2. Magic-link OAuth with Plus email (no code) still works; email field is labeled Atoms Plus.
- AE3. Expired or already-used code → authorize error; no `mcp_`; mirror of A untouched.
- AE4. Settings Refresh shows `as hartman.tai@…` matching upsert tenant (happy and after a push error).
- AE5. User with wrong-email empty/stale mirror **and** (optionally) entitled browser session for B: uses code for A (via chooser if needed) → after connector holds A tokens, tools see A without a second Plus subscription. Residual B partition is not merged or auto-wiped.
- AE6. Entitled browser session for B + code for A → consent shows A; tokens are A (not B).

### Success Criteria

- Dogfood AE1 and AE1b (and AE6 if cookie present) on prod or staging with real Claude connector.
- Unit/HTTP tests: mint, single active code, redeem once, reject reuse/expiry/lockout, token email = pair email, redeem/consent entitlement re-check, cookie chooser / override path.
- No regression on magic-link OAuth E2E (`http-ask-oauth` class).

### Scope Boundaries

**In v1**

- Pair code mint (plugin + API) and redeem (OAuth authorize)
- Dual path + **identity chooser when browser session exists**
- Settings status email + Link control + honest copy (including Connect-first and reconnect recovery)
- Claude + ChatGPT

**Deferred**

- Secondary emails / account aliases
- Deep link or QR as the only path (code is v1; QR may wrap the same code later)
- Automatic merge or cleanup UI for orphan wrong-email partitions
- MCP tools returning tenant email/whoami
- Team/share grants

**Outside product identity**

- Binding Atoms billing to Claude billing
- Static API key paste into Claude directory connectors

### Dependencies / Assumptions

- Plus magic-link and MCP OAuth AS already live on the Ask host.
- Plugin already holds verified `sess_` + email in device-local Plus session storage.
- Mirror isolation by email remains the security boundary; pairing only chooses which email the grant binds to.
- Live GET `/oauth/authorize` today skips to consent when an entitled browser session exists — v1 **changes** that to a chooser (R5).

### Sources / Research

- Live dual-tenant diagnosis: plugin status stamps `LS_ASK_MIRROR_*` after successful mutate; MCP `list_atoms` uses `mirrorStatus(email)` from `mcp_` token email — same table, different email ⇒ 56 vs 44 / week-stale.
- Status already returns `email` from `GET /v1/ask/mirror/status` (`plus-service/src/mirror/http.mjs`); plugin UI drops it today (`src/settings/settings.ts`).
- OAuth email form is free-text; entitled `atoms_oauth_bs` skips form to consent (`plus-service/src/oauth/routes.mjs`).
- Prior Ask auth KTDs: `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md`; connector runbook `docs/runbooks/atoms-ask-connectors-directory.md`.
- Doc-review 2026-08-04: cookie chooser gap, code-theft threat + short-code posture, Connect-first + Atoms-email copy.

---

## Planning Contract

### Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | **Code format:** 8 chars Crockford Base32 (no I/L/O/U), display as `XXXX-XXXX` | ~40 bits; pasteable; with R2 controls meets short-code posture |
| KTD2 | **TTL:** 10 minutes from mint | Connect-first handoff; phishing window bounded |
| KTD3 | **Consume on redeem-bind** (code marked used when pending binds to email A, before consent Allow) | Deny → new mint (F3.5); attacker cannot re-bind same code after steal-at-consent |
| KTD4 | **Store:** dedicated `mcp_pair_codes` — one row per email (or unique email + unredeemed); columns `email`, `code_hash`, `exp_ms`, `consumed_ms` | Simpler than overloading `mcp_oauth_pending`; hash via existing `hashToken` |
| KTD5 | **Mint API:** `POST /v1/ask/mcp/pair` Bearer `sess_` only; body empty; response `{ code, expiresAt }` plaintext code once | Mirrors mirror routes; reject `mcp_` |
| KTD6 | **Redeem:** OAuth POST on authorize pending with code field → validate → `mcpUpdatePending(email)` + `mcpCreateBrowserSession` + 302 consent (copy `maybeFinishOauthAfterExchange`) | Same cookie hop as magic link |
| KTD7 | **Cookie short-circuit → chooser** at GET `/oauth/authorize` when entitled `bs` | Closes Problem Frame cookie trap (R5/F1c/AE6) |
| KTD8 | **Rate limits:** mint `pair-mint:${email}` 5/hour + `pair-mint-ip:${ip}` 10/hour; redeem `pair-redeem:${ip}` 20/15min then clear error | Compensating control for short codes |
| KTD9 | **Deploy:** Fly `atoms-plus` **first**, then plugin version bump + BRAT Release | Old plugin ignores pair API; new plugin against old server fails mint loudly |
| KTD10 | **Status email source:** prefer `GET /v1/ask/mirror/status` `email`; fallback `readPlusSession().email` for offline display | Server is SSOT when online |

### Technical approach

1. **Store trio** (sqlite / postgres / memory): pair mint/redeem methods using `hashToken` + `id` helpers from `plus-service/src/store/shared.mjs`.
2. **HTTP mint** beside Ask mirror routes in `plus-service/src/mirror/http.mjs` (same `accountFromSession({ requireVerified: true })` + entitled gate as status).
3. **OAuth HTML + routes:** extend `html.mjs` forms; replace cookie→consent short-circuit in `routes.mjs:221-237` with chooser; add code POST path.
4. **Plugin:** `askMcpPair` + parse status `email` in `plusClient.ts`; Settings Link control + R9 line in `settings.ts`.
5. **Tests:** extend `store-ask.test.mjs`, `http-ask-oauth.test.mjs`, `http-ask-mirror.test.mjs` (or new `http-ask-pair.test.mjs`), `test/plusClient.test.ts`.

### Patterns to follow

- Secret hashing: `hashToken` / auth-code single-use (`ask*Methods` mcpCreateAuthCode).
- Cookie hop: `maybeFinishOauthAfterExchange` (`oauth/routes.mjs`).
- plusRequest client: `askMirrorWipe` / `askMirrorStatus` in `src/platform/plusClient.ts`.
- Rate limit: `checkRateLimit` (`plus-service/src/ratelimit.mjs`).
- Spawned memory HTTP tests: `plus-service/test/http-ask-oauth.test.mjs`.

### Assumptions

- No schema migration tool beyond existing CREATE IF NOT EXISTS on store open.
- Consent already shows client label — pair path lands on same `consentForm`.
- Plugin version bump required for user-visible Settings (CLAUDE.md versioning).

### Sequencing

U1 → U2 → U3 → U4 → U5 → U6 (ship). U4/U5 can parallel after U2 API shape is frozen; U3 must land before dogfood AE6.

### Risks

| Risk | Mitigation |
|---|---|
| Chooser regresses happy return visitors | “Continue as {email}” one click; test magic-link + cookie continue |
| Short code brute force | KTD1+KTD2+KTD8 + consume on bind |
| Plugin ships before Fly | KTD9 gate; clear mint error if 404 |
| Dual-device TTL too short | 10m; dogfood Connect-first AE1b |

---

## Implementation Units

### U1. Store pair codes (mint / redeem / invalidate)

**Goal.** Durable pair-code capability with hash-at-rest and single-active-per-email.

**Files.**  
- Modify: `plus-service/src/store/askSqliteMethods.mjs`, `askPostgresMethods.mjs`, `memory.mjs`  
- Test: `plus-service/test/store-ask.test.mjs` (or `store-ask-pair.test.mjs`)

**Approach.** Table `mcp_pair_codes (email PRIMARY KEY, code_hash, exp_ms, consumed_ms NULL)`. `pairMint(email)` generates KTD1 code, stores hash, exp=now+10m, replaces prior row. `pairRedeem(code)` → hash lookup, reject if missing/expired/consumed, mark consumed, return email. Never return hash to callers.

**Test scenarios.**

- Mint returns plaintext code once; store has only hash.
- Second mint invalidates first (first redeem fails).
- Redeem once succeeds; second redeem fails.
- Expired code fails.
- Wrong code fails without distinguishing “unknown email.”

**Traces.** R1, R2, KTD1–4.

---

### U2. HTTP mint `POST /v1/ask/mcp/pair`

**Goal.** Entitled plugin sessions can mint codes over the wire.

**Files.**  
- Modify: `plus-service/src/mirror/http.mjs` (allowlist path + handler), wire if needed in `server.mjs`  
- Test: `plus-service/test/http-ask-mirror.test.mjs` or `http-ask-pair.test.mjs`

**Approach.** Same auth as mirror status: reject `mcp_`, `requireVerified`, entitled, rate limit `pair-mint:*`. Response `{ code, expiresAt }`. No logging of `code`.

**Test scenarios.**

- Entitled `sess_` → 200 + code + expiresAt.
- Unverified / not entitled → 401/403.
- `mcp_` Bearer → 401.
- Rate limit → 429.

**Traces.** R1, R2, KTD5, KTD8.

---

### U3. OAuth chooser + code redeem + copy

**Goal.** Dual path + cookie identity switch + redeem → consent as A.

**Files.**  
- Modify: `plus-service/src/oauth/routes.mjs`, `plus-service/src/oauth/html.mjs`  
- Test: `plus-service/test/http-ask-oauth.test.mjs` (extend heavily)

**Approach.**

1. Replace GET authorize cookie short-circuit with **chooser** HTML when entitled `bs` (Continue / Use code / Different email).
2. Anonymous authorize: email form labeled Atoms Plus + link/section for code entry + Connect-first instructions (R5b/R7b).
3. POST code: rate-limit redeem → `pairRedeem` → entitlement re-check → bind pending + browser session → 302 consent (mirror `maybeFinishOauthAfterExchange`).
4. Consent Allow unchanged (already re-checks entitled; shows email + client).
5. Keep magic-link path intact.

**Test scenarios.**

- No cookie: email form + code path both present.
- Cookie B: chooser, not silent consent for B.
- Redeem A with cookie B → consent A → tokens email A (AE6).
- Used/expired code → error, no tokens (AE3).
- Full magic-link PKCE E2E still green (AE2).
- Full pair mint→redeem→consent→token→tools/call list sees mirror of A (AE1 shape with seeded mirror).

**Traces.** R5–R7b, R2b, R4b, F1–F3, AE1–AE3, AE6, KTD6–7.

**Execution note.** Characterization-first on existing `http-ask-oauth` before rewriting the short-circuit.

---

### U4. Plugin plusClient: pair + status email

**Goal.** Typed client for mint and status email.

**Files.**  
- Modify: `src/platform/plusClient.ts`  
- Test: `test/plusClient.test.ts`

**Approach.** `askMcpPair(cfg, token) → { ok, code, expiresAt } | { ok:false, message }`. `askMirrorStatus` parse/return `email?: string`.

**Test scenarios.**

- Pair POST URL, Bearer, body empty; parses code/expiresAt.
- Status parses email when present; omits when absent without throwing.

**Traces.** R8, R9, KTD5, KTD10.

---

### U5. Settings: Link control + status `as {email}`

**Goal.** User-visible mint UX and diagnostic status line.

**Files.**  
- Modify: `src/settings/settings.ts`  
- Optional: tiny pure helper for status line string if easier to unit test  
- Test: unit test for status line formatter if extracted; else manual Settings smoke

**Approach.** Near Ask mirror Sync now: button mint → show code + expiry + copy; states per R8; copy R10 secrets + reconnect recovery. Status line R9 using status email or session email fallback. Do not write code into `data.json`.

**Test scenarios.**

- Status formatter: happy and error both include `as {email}`.
- Manual: mint shows code; remint replaces; not signed in shows error.

**Traces.** R8–R10, R12, AE4.

**Execution note.** Version bump `manifest.json` + `package.json` (+ `versions.json`) in this unit or U6.

---

### U6. Ship: Fly + plugin release + dogfood

**Goal.** Prod service then plugin; prove AE1/AE1b/AE6.

**Files.**  
- Modify: `docs/runbooks/atoms-ask-connectors-directory.md` (pairing section), optional `docs/ask-self-host.md`  
- Ops: `docs/runbooks/atoms-plus-prod.md` deploy  
- Version files if not in U5

**Approach.** Deploy Fly first; smoke pair mint with sess_; dogfood Claude connector; then GitHub Release for BRAT. Document reconnect recovery.

**Test scenarios.**

- `curl` health 200; pair mint on prod with dogfood sess_ (no code in logs/tickets).
- AE1 + AE1b human dogfood; AE6 if prior cookie.
- Rollback note: prior Fly image restores cookie short-circuit (known).

**Traces.** Success criteria, KTD9, AE1/AE1b/AE5/AE6.

---

## Verification Contract

| Gate | Command / action |
|---|---|
| Store + HTTP | `cd plus-service && npm test` (or project’s plus-service test script) — must include new pair + oauth cases |
| Plugin unit | `npm test` — plusClient + any status helper |
| Plugin typecheck/build | `npm run build` |
| Magic-link regression | `http-ask-oauth` full E2E green |
| Prod service | Fly deploy + health; optional scripted pair mint |
| Product dogfood | Real Claude connector AE1/AE1b/(AE6); screenshots optional under `docs/qa/screenshots/ask-mcp-pairing/` |
| Shipping tail | simplify → code-review → compound if durable learning → world-class-qa if UI claimed |

---

## Definition of Done

**Global**

- [ ] All U1–U5 tests green locally
- [ ] Fly service live with pair + chooser before plugin Release
- [ ] Plugin version bumped; BRAT-releasable assets
- [ ] AE1 dogfood recorded (and AE1b)
- [ ] Runbook mentions pairing + cookie chooser
- [ ] No plaintext pair codes in server logs
- [ ] PR body `Closes #<issue>` when claimed
- [ ] `STATUS.md` cleared on merge

**Per unit:** unit’s test scenarios pass; no regression on magic-link path after U3.

---

## Appendix

### Extension point cites

- Cookie short-circuit: `plus-service/src/oauth/routes.mjs` ~221–237  
- HTML forms: `plus-service/src/oauth/html.mjs`  
- Cookie hop: `maybeFinishOauthAfterExchange` ~467–497  
- Status email server: `plus-service/src/mirror/http.mjs` ~77–84  
- Client drop email: `src/platform/plusClient.ts` `askMirrorStatus`  
- Status line: `src/settings/settings.ts` ~1206–1208  
- Deploy: `docs/runbooks/atoms-plus-prod.md`
