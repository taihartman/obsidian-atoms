---
title: OpenAI plugin submission - Plan
date: 2026-09-09
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: user request
execution: code
doc_review: 2026-09-09 inline full review
product_contract_preservation: "ChatGPT-first public remote MCP listing; no Codex-only feature and no custom UI required"
---

# OpenAI plugin submission - Plan

**Lane:** full feature (public integration + OAuth + reviewer credentials)

**Doc-review:** full multi-persona and independent cross-model review completed before production deployment
**Done when:** the parent domain challenge verifies, production tool discovery passes, the OpenAI draft has complete review materials, and the only remaining actions are the owner's confirmed developer identity, public author name, OAuth Allow action, country availability, policy attestations, and Submit for Review click.

## Goal Capsule

**Objective.** Publish Atoms Plus as a legitimate, ChatGPT-facing OpenAI plugin backed by the existing production remote MCP at `https://plus.tryatoms.app/mcp`.

**Product authority.** The user's explicit request to add Atoms Plus to ChatGPT; the existing Ask mirror and OAuth contracts; OpenAI's current plugin submission and app-review requirements.

**Stop conditions.**

- The public challenge URL returns exactly the current OpenAI token.
- Every production MCP tool declares accurate `readOnlyHint`, `openWorldHint`, and `destructiveHint` values.
- Review credentials access synthetic Atoms only and require no reviewer email, SMS, or MFA step.
- Five positive and three negative review tests are documented and exercised against production.
- No verified legal identity, policy attestation, OAuth grant, or review submission is transmitted without action-time owner confirmation.

## Product Contract

### Summary

Submit the existing Atoms Plus remote MCP through OpenAI's official plugin portal. Keep the integration ChatGPT-first and remote-MCP-only. Reuse the current OAuth server, Atoms brand, Plus service, privacy policy, terms, and support channel. Do not create a Codex-only plugin, custom component UI, new billing path, or new user-data surface.

### Key Decisions

- **KTD1 — Official remote MCP listing.** The listing points to `https://plus.tryatoms.app/mcp`; custom UI is deferred because it is not required for review or for the core search-and-capture experience.
- **KTD2 — Parent-domain verification.** Serve OpenAI's challenge from `https://tryatoms.app/.well-known/openai-apps-challenge`, which OpenAI permits as a parent domain of the MCP host. This avoids adding an unrelated endpoint to the OAuth service.
- **KTD3 — Exact tool annotations.** All tools declare `openWorldHint: false` because they access only the authenticated user's bounded Atoms mirror/outbox. Read tools keep `readOnlyHint: true`. `create_atom` and `continue_atom` are additive writes, so `destructiveHint` is false. `set_loop` can overwrite existing loop state and `cancel_pending` cannot restore the same queued operation, so their `destructiveHint` stays true.
- **KTD4 — Existing OAuth contract.** Keep the current OAuth authorization-code + PKCE flow and the existing Obsidian-issued pairing-code path. Do not add a bypass, static bearer token, reviewer-only auth route, or weaker production scope.
- **KTD5 — Synthetic reviewer tenant.** Provision dedicated reviewer account(s) containing only synthetic demo atoms and an active Plus entitlement. Reviewer credentials reuse the existing hashed pairing-code store but are explicitly operator-only, contain at least 128 bits of random entropy, remain reusable for OpenAI's later reviewers and ongoing testing, expire after 30 days by default, and are invalidated by reminting. Normal user-generated pairing codes remain eight-character, ten-minute, and one-time. Credentials are generated operationally, printed once to the operator, and entered only in the private OpenAI portal; plaintext credentials never enter git, CI or service logs, tests, or documentation.
- **KTD6 — Human-controlled attestations.** The owner confirms the verified developer identity, public author name, OAuth Allow action, policy declarations, and final Submit for Review action at the moment each is sent to OpenAI.

### Review UX

1. Reviewer connects Atoms Plus in ChatGPT.
2. Atoms OAuth offers the pairing-code path without requiring access to an inbox.
3. Reviewer enters the supplied dedicated reviewer credential and sees the synthetic account and requested scopes on consent.
4. Reviewer allows access and runs the supplied positive and negative tests.
5. Writes remain queued in the synthetic account and never touch a real user's vault.

### Acceptance Examples

- **AE1:** OpenAI fetches the parent-domain challenge and receives only the portal-generated token with HTTP 200.
- **AE2:** Unauthenticated MCP discovery returns the expected OAuth challenge and metadata; an authorized `tools/list` returns every tool with the three required annotations.
- **AE3:** `mirror_status`, `list_tags`, `search_atoms`, `fetch_atom`, `neighbors`, and `list_atoms` read only the synthetic reviewer mirror.
- **AE4:** `create_atom`, `continue_atom`, and `set_loop` create pending synthetic operations; `list_pending` observes them; `cancel_pending` cancels one before Obsidian applies it.
- **AE5:** A query for absent content returns an honest scoped-absence response and does not claim the user's entire vault was searched.
- **AE6:** Expired, malformed, or superseded reviewer credentials fail closed without an MCP token; ordinary user pairing codes also fail after one redemption.
- **AE7:** The listing copy says the mirror is opt-in and limited to the flat Atoms folder plus linked hubs; it does not imply whole-vault access.

### Scope Boundaries

**In v1**

- OpenAI public plugin draft and review submission
- Parent-domain challenge file
- Required MCP tool annotations
- Synthetic reviewer tenant and pairing credentials
- Review prompts, tests, release notes, policy/support links, and listing assets
- Production deployment and smoke validation

**Deferred**

- Custom OpenAI component UI
- OIDC `openid`/`email` support for enterprise domain restrictions
- Automatic credential rotation in the OpenAI portal
- Separate Codex packaging

**Outside product identity**

- Reading daily notes or the rest of a user's vault
- Sharing a real customer's mirror with reviewers
- Static API-key authentication
- Checkout or subscription purchase inside ChatGPT

## Implementation Units

### U1 — Domain challenge

Use the current portal draft's generated challenge token, add it as a source challenge file, and include it in the deterministic website build. A focused test first asserts that an isolated `ATOMS_DIST_DIR` build emits `.well-known/openai-apps-challenge` with content exactly equal to the source token. Deploy through the existing Cloudflare Pages path and verify the live response.

### U2 — MCP annotations

Add a failing discovery test that asserts the complete annotation triple on every listed tool and exact expected values by tool name. The closed matrix in `docs/runbooks/openai-plugin-submission.md` is authoritative. Update `plus-service/src/mcp/tools.mjs`, run focused MCP tests, then deploy the existing Fly app and rescan through OpenAI's portal.

### U3 — Reviewer-safe access

Use existing production store and OAuth primitives to provision synthetic primary and backup reviewer tenants with an active Plus entitlement, the exact fixture graph defined in `docs/runbooks/openai-plugin-submission.md`, and dedicated reviewer credentials. The narrow operator entrypoint accepts only `@review.tryatoms.app` identities, refuses non-persistent production stores, prints each plaintext credential once, and never logs database credentials. Reviewer credentials are reusable until their bounded expiry so OpenAI can perform later and ongoing testing; they use at least 128 bits of entropy and reminting invalidates the prior credential. Do not change requested OAuth scopes or token authorization semantics. Keep the public pairing route on its eight-character, ten-minute, one-time default. Validate reviewer expiry, reusable redemption, remint invalidation, ordinary one-time rejection, tenant isolation, exact fixtures, and non-entitled failure before any production operation.

Reserved reviewer identities are operator-owned: normal authenticated Plus mirror and pairing endpoints reject them. Reprovisioning invalidates access tokens, refresh tokens, browser sessions, and unexchanged authorization codes for only the target reviewer email. Provision credentials only after every production machine serves the new redemption path, then validate the new tenant before replacing portal instructions.

### U4 — Submission packet

Create a durable, secret-free review runbook containing listing copy, review instructions, exactly five positive tests, exactly three should-not-trigger negative tests, expected results, release notes, policy/support URLs, and the canonical synthetic fixture graph. Keep live credentials only in the OpenAI portal. Document credential replacement: remint the affected reviewer credential, update the private Testing field, resubmit the current draft, and leave the backup tenant untouched unless it is needed. Replace the listing description's em dash so the public copy follows Atoms voice.

### U5 — Production and portal validation

Deploy only after scoped tests and review gates pass; merge remains separate from the production verification authorized for this submission. Confirm Cloudflare and Fly deployment health, verify the domain in the portal, complete OAuth tool scanning, inspect the discovered tool list, attach listing assets, and fill the review packet. The owner then confirms the verified developer identity, public author name, OAuth Allow action, country availability, policy attestations, and Submit for Review action.

## Verification

- Focused website challenge build test fails before U1 and passes after it.
- Focused MCP discovery test fails before U2 and passes after it.
- Existing MCP/OAuth/store test suites pass without weakened assertions.
- `curl` of the live challenge returns HTTP 200 and byte-for-byte token content.
- Production OAuth metadata resolves from the MCP host and the portal scan lists all expected tools.
- Exactly five positive and three should-not-trigger negative review cases pass using only synthetic fixtures.
- A reviewer credential authorizes two independent OAuth sessions before expiry, while a normal user pairing code fails on its second redemption.
- Repository secret scan shows no reviewer code, OAuth token, database URL, or portal challenge copied outside its intended public challenge file.

## Rollout and Rollback

- The challenge is an inert static file. Roll back by removing the asset after the app is withdrawn or the token is rotated.
- Annotation changes affect client confirmation semantics, not server authorization. Roll back the Fly release if discovery or invocation regresses.
- Reviewer data is isolated in dedicated primary and backup tenants. Keep the credentials, entitlement, and fixtures working while the draft is in review or the published plugin is subject to ongoing testing. If the draft is withdrawn or the plugin is unpublished, revoke both tenants' MCP tokens, invalidate both credentials by reminting or entitlement revocation, remove the private portal credentials, and delete only those synthetic tenants if they are no longer needed.
- A rejected draft remains unpublished and can be edited without affecting existing MCP users.

## Full Doc Review

Coherence, feasibility, product, OAuth-flow design, security, and adversarial reviewers examined this plan, with an independent Grok cross-model pass over the judgment lenses and full document. The review aligned the fixture manifest with the portal cases, replaced the unsuitable one-time reviewer login with a high-entropy reusable test credential, made the exact five-positive/three-negative contract explicit, corrected public privacy/write copy, and restored the complete owner-controlled action list. The live OpenAI requirements do not require a demo recording for this remote-MCP-only submission; screenshots are optional only when UI exists. Country availability remains an explicit owner decision at the final portal step.

## OpenAI Review Materials

**Listing description.** Search, retrieve, and continue ideas from the private Atoms mirror you enable in Obsidian. Atoms Plus works only with your flat Atoms folder and linked hubs, not daily notes or the rest of your vault, and can queue new atoms for Obsidian to apply.

**Positive tests.** Exactly the five combined workflows in `docs/runbooks/openai-plugin-submission.md`: account and mirror status; tags plus newest atoms; search plus authoritative fetch; graph neighbors; and the queued-write lifecycle.

**Negative tests.** Exactly the three should-not-trigger prompts in `docs/runbooks/openai-plugin-submission.md`: current weather, summarizing supplied text, and creating a calendar event.

**Release notes.** Initial OpenAI plugin submission for the Atoms Plus remote MCP. It provides scoped search and retrieval over the user's opt-in Atoms mirror and queues capture operations for Obsidian to review and apply.
