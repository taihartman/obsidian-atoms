---
title: "A security fix's repair path was wired into only the dogfood branch, so every production trial signup dead-ended"
date: 2026-08-01
category: logic-errors
module: plus-service/auth
problem_type: incomplete_remediation
component: server
symptoms:
  - "Brand-new trial user told her session was invalid, repeatedly"
  - "Refresh status changed nothing — still invalid"
  - "Re-signing up returned 409 'already has Plus'"
  - "Only recovery was logging out and requesting a fresh magic link"
root_cause: repair_path_unreachable_in_production
resolution_type: code_fix
severity: critical
tags:
  - stripe
  - webhook
  - sessions
  - trial-onboarding
  - dogfood-vs-production
---

# A security fix's repair path was wired into only the dogfood branch

## What happened

Issue #163 closed C1, a soft-start session-fixation hole: `POST /v1/auth/start` mints a long-lived
`sess_` with no email proof, so an attacker who soft-started `victim@…` before the victim paid would
inherit a fully entitled session. The fix made `grantPeriod` revoke **every unverified session** for
an email on entitlement upgrade.

That revoke has a necessary counterpart: the legitimate user's session is *also* unverified at that
moment, so it gets revoked too. The hotfix knew this and shipped `markSessionVerified` as the repair,
commented *"Promote soft session after checkout; clears revoke from grantPeriod."*

**The repair was wired into the dogfood branch only.** The production Stripe branch returns at
`createCheckoutSession` and never reaches it. So:

1. `/v1/auth/start` mints an unverified session; the plugin stores it
2. `/v1/billing/checkout` returns the Stripe URL — session still unverified
3. the user pays
4. the webhook's `grantPeriod` revokes every unverified session for that email
5. every `GET /v1/me` returns `401 Invalid session`, permanently

Paying for the trial is what broke the account. It was deterministic for **every** production signup,
and it shipped because the only path anyone exercised internally was the dogfood one.

## Why the tests did not catch it

`test/security-auth-criticals.test.mjs` had a test named *"C1: dogfood markSessionVerified restores
checkout caller only"*. It asserted the repair at the **store** level and named the dogfood path in
its own title. The production branch's session lifecycle had no coverage at all.

The test suite was green, the security review was satisfied, and the feature was broken for 100% of
real users. Green plus a named-after-the-safe-path test is a smell, not a signal.

## The fix

Bind the Stripe Checkout Session id to the plugin session that opened it, then consume that binding
in the webhook right after `grantPeriod`:

- `server.mjs` — on the production branch, `store.bindCheckoutSession(cs.id, email, session)` (hash
  only, single-use, 24h TTL matching Stripe's own Checkout Session lifetime). It lives *inside* the
  checkout `try` on purpose: failing before a card is charged beats stranding the user after.
- `stripe.mjs` — after `grantPeriod`, `store.promoteCheckoutSession(obj.id, email)` re-verifies
  exactly that one session.

C1 is preserved: a soft session that never opened checkout has no binding and stays revoked. The
regression test asserts precisely that — the attacker session is still dead after the victim's grant
*and* promote.

## Transferable lessons

**1. When a security fix breaks a legitimate flow, its repair is part of the fix — audit every branch
that needs it.** Search for the repair function's call sites and check them against every code path
that triggers the damage. Here the damage (`grantPeriod`) had two triggers, dogfood and Stripe; the
repair had one call site. That asymmetry is the bug, and it is greppable.

**2. A test whose name contains the safe path is telling you the risky path is uncovered.** "dogfood
markSessionVerified" should have read as "…and what about the Stripe one?"

**3. Dogfooding on a shortcut path is not dogfooding.** Every internal trial ran through dogfood
grants or magic links, both of which mint or repair a verified session. The first person down the
real Stripe path was an external user. If a production path has an "easier" internal equivalent,
that equivalent is a coverage hole, not a convenience.

**4. A dead session must never be a dead end.** The server bug was one failure; what made it a
*support incident* was that the client could not distinguish a rejected token from a 502, `Refresh
status` was a visual no-op on error, and the magic-link recovery rendered the new token as text in a
browser `<details>` with no handoff to the plugin. Recovery affordances deserve the same scrutiny as
the happy path.

**5. The production store had zero test coverage, and it bit during this very fix.** A rename left
the postgres binding passing an imported helper function as a query parameter; the full suite stayed
green because it only exercises memory and sqlite. A source-level parity test now holds all three
stores to the same method surface, but the real gap — no postgres-backed integration job — is still
open. Treat "the store we actually run in production is the one we never test" as a standing risk.

## See also

- Issue #163 (C1 soft-start fixation — the fix this completes)
- Issue #230 / PR #231
- `plus-service/test/trial-checkout-session.test.mjs` — the production-path coverage that was missing
