---
title: "ChatGPT custom app connection - Plan"
date: 2026-09-08
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# ChatGPT custom app connection - Plan

## Goal Capsule

- **Objective:** An Atoms Plus subscriber can add Atoms Plus directly to ChatGPT and complete OAuth without being sent through a local callback or a Codex plugin flow.
- **Means:** Make the hosted ChatGPT custom-app recipe explicit and make Atoms Plus OAuth pages name ChatGPT and the selected Atoms Plus account consistently.
- **Authority:** Issue #620, the completed ChatGPT setup observed on 2026-09-08, and the existing OAuth account-binding contract.
- **Security classification:** Copy and guidance only. OAuth scopes, tokens, redirect validation, account binding, pending state, and the account chooser stay unchanged.
- **Stop conditions:** Focused OAuth and setup tests pass, the existing Claude instructions remain intact, and the browser evidence shows Atoms Plus installed in ChatGPT with the hosted callback.

## Product Contract

### Requirements

- R1. The public guide starts ChatGPT users inside ChatGPT web, not in Codex or a local plugin installer.
- R2. The guide uses the production MCP endpoint `https://plus.tryatoms.app/mcp` and the current ChatGPT custom-app controls.
- R3. The guide says that ChatGPT completes OAuth through its hosted callback. A localhost callback means the person is outside this flow and should restart from ChatGPT web.
- R4. The existing Claude connector recipe remains present and unchanged in meaning.
- R5. Sign-in and account-choice pages use Atoms Plus as the account and service name and identify ChatGPT when the pending OAuth request provides that context.
- R6. Consent keeps the selected Atoms Plus email, ChatGPT label, read and queued-write scopes, mirror boundary, filing boundary, and provider-egress disclosure visible.
- R7. A remembered browser session still stops at the account chooser before consent.
- R8. No Codex marketplace, plugin package, loopback-specific product work, or Codex first-use guidance is added.

### Key Flow

1. In ChatGPT web, the person enables Developer mode.
2. In ChatGPT Plugins or Apps, the person creates an app named Atoms Plus.
3. They paste `https://plus.tryatoms.app/mcp`, choose OAuth, and create the app.
4. Atoms Plus asks for an email or pairing code, shows the account chooser when a browser session exists, and displays the read and queued-write scopes.
5. Allow returns to `https://chatgpt.com/connector_platform_oauth_redirect`.
6. ChatGPT lists Atoms Plus as installed.

### Acceptance Examples

- AE1. Given ChatGPT web, when a person follows the setup guide, then every step stays inside the ChatGPT custom-app flow and uses the production MCP URL.
- AE2. Given a ChatGPT OAuth request, when sign-in, account choice, and consent render, then the pages identify Atoms Plus and ChatGPT without changing fields, scopes, or actions.
- AE3. Given a remembered Atoms Plus browser session, when authorization starts, then account choice renders before Allow.
- AE4. Given the setup guide, when Claude instructions are inspected after the change, then the custom connector recipe is still available.
- AE5. Given a localhost callback during attempted ChatGPT setup, when recovery guidance is read, then it tells the person to restart from ChatGPT web.

### Scope Boundaries

**In scope**

- Atoms Plus OAuth product and client copy.
- ChatGPT custom-app setup and recovery guidance.
- Focused regression tests and browser evidence.

**Out of scope**

- Codex plugin packaging or installation.
- Changes to Claude setup behavior.
- OAuth, token, scope, redirect, or account-binding semantics.
- Production deployment before merge and explicit release authorization.

## Planning Contract

### Key Technical Decisions

- KTD1. Pass the existing client label into sign-in and account-choice renderers instead of storing another identity value.
- KTD2. Use Atoms Plus for the account and hosted service. Keep Atoms Ask only where the recall capability itself needs a name.
- KTD3. Preserve the chooser and every form action and hidden field.
- KTD4. Treat the observed ChatGPT web flow as the setup source of truth: Plugins or Apps, Developer mode, Create app, OAuth, hosted callback.
- KTD5. Add or strengthen focused tests before changing behavior-bearing source.

### Risks and Mitigations

- **Account safety:** Copy work could bypass the chooser. Keep an HTTP assertion that Allow is unavailable before the chooser action.
- **Claude regression:** A ChatGPT rewrite could erase the working Claude recipe. Assert that the Claude connector steps remain.
- **UI drift:** ChatGPT may rename Plugins back to Apps. Use wording that acknowledges both labels while keeping the action sequence precise.
- **False localhost recovery:** The guide could imply the production MCP URL is local. State that only the unexpected callback is local and that the server URL remains HTTPS.

## Implementation Units

### U1. Make OAuth pages client-aware

- **Goal:** Satisfy R5-R7 and AE2-AE3 without changing authorization behavior.
- **Files:** `plus-service/src/oauth/html.mjs`, `plus-service/src/oauth/routes.mjs`, `plus-service/test/http-ask-oauth.test.mjs`.
- **Approach:** Add failing assertions for ChatGPT-aware sign-in, chooser, consent, and recovery copy. Thread the already-derived client label through the existing rendering paths.
- **Verification:** Run `node --test plus-service/test/http-ask-oauth.test.mjs` and the full plus-service suite.

### U2. Make the ChatGPT recipe unmistakable

- **Goal:** Satisfy R1-R4, R8, and AE1, AE4-AE5.
- **Files:** `www/src/setup.html.tmpl`, `docs/ask-self-host.md`, `test/wwwSetupLabels.test.ts`.
- **Approach:** Strengthen setup assertions first, then document the production URL, current ChatGPT labels, hosted callback, and localhost recovery. Preserve the Claude recipe.
- **Verification:** Run the focused setup test, the site build, and source-to-dist checks.

### U3. Verify the completed journey

- **Goal:** Confirm the implementation matches the successful ChatGPT setup without accessing atom content.
- **Files:** Browser evidence and PR checklist only.
- **Approach:** Record that ChatGPT discovered the OAuth endpoints and scopes, returned through the hosted callback, and listed Atoms Plus as installed. Do not run search, fetch, list, create, continue, cancel, or other atom-content tools.
- **Verification:** Recheck the installed Atoms Plus detail page and record the result in PR #621.

## Definition of Done

- The focused and full relevant test suites pass.
- ChatGPT setup guidance is direct and Claude guidance still works.
- OAuth pages identify Atoms Plus and ChatGPT while preserving the chooser and scope disclosures.
- No Codex package or Codex setup guidance is present in the diff.
- The draft PR accurately records the hosted callback and installed-app evidence.
