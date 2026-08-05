---
title: "A signal nobody receives is not a signal — entitlement was webhook-only and every failure mode degraded to console.error"
date: 2026-08-04
category: architecture-patterns
module: plus-service/billing
problem_type: unobservable_failure_class
component: server
symptoms:
  - "Customer paid; account never got Plus; nothing anywhere said so"
  - "Every webhook failure path ended in a console.error line on Fly"
  - "A webhook Stripe never delivered left no trace at all — nothing in-process can see it"
  - "First design's reconcile check flagged healthy top-ups and missed real losses"
root_cause: single_callback_grants_entitlement_with_no_record_interrupt_or_sweep
resolution_type: architecture_change
severity: critical
tags:
  - stripe
  - webhook
  - entitlement
  - observability
  - reconciliation
  - alerting
---

# A signal nobody receives is not a signal

## The class, not the instance

[#230](../logic-errors/security-fix-repair-wired-into-only-one-branch.md) was one way a paid customer
could end up unentitled: a repair path wired into only the dogfood branch. Fixing it left the
underlying shape untouched — **the Stripe webhook was the only path that granted entitlement, and
every way it could fail degraded to a `console.error` line nobody reads.**

That is three missing things, not one bug:

- **(a) a record** of every way the grant can fail — durable, queryable, deduped
- **(b) an interrupt** a human actually receives
- **(c) a sweep** for the case where the callback *never arrived* — because nothing in-process can
  observe an event that did not happen

#238 added all three: the `stripe_incidents` table, a throttled ops email, and a Stripe-events
reconciliation sweep. The taxonomy lives in one place — `plus-service/src/store/shared.mjs:43`
(`INCIDENT_KIND`) — split by what an operator has to *do*: **class A** (unauthenticated garbage,
`webhook_reject`), **class B** (we processed it and could not act, e.g. `missing_email`,
`unknown_price`, `revoke_missing_email`), **class C** (`missing_webhook` — delivered by Stripe, never
processed here; only a sweep can see it).

**Rule:** when a single external callback is the only path that grants something a customer paid for,
(a), (b), and (c) are part of the feature, not operational polish added later.

## The oracle matters more than the check

The first design compared **paid Stripe sessions against current account entitlement**. That is wrong
in both directions:

- a top-up bought by a customer with an active subscription reads entitled → **false negative**, the
  real loss is invisible
- a legitimately granted session whose period has since expired reads `exhausted` → **false
  positive**, and `--repair` would then grant a fresh period for a months-old payment

The right oracle is `hasProcessedEvent` (`plus-service/src/reconcile.mjs:158`): *Stripe considered it
delivered; we have no record of processing it.* That question has exactly one legitimate answer.

**Rule: reconcile against what you did, not against what the state looks like now.** State has other
legitimate causes; your own processing log does not.

The review found the same lesson from the opposite end. Account state could not distinguish "revoked
after a real cancellation" from "soft account that never got its webhook" — both read `inactive` with
`remaining: 0`. Refusing repair on `inactive` would have refused the entire #230 signup-repair case,
which is the population this sweep exists for. Stripe had to be the oracle because local state is
ambiguous by construction.

## "Repaired" must mean granted

Repair initially reported success for outcomes that granted nothing, **while still claiming the event
id** — so the incident would never resurface in a later sweep. An operator reads "repaired" over a
still-lost payment, and the only mechanism that would have caught it again is now disarmed.

The fix branches the report on the actual grant outcome, not on the call completing
(`plus-service/src/reconcile.mjs:238` vs `:245`); a no-grant outcome lands in `failed` with the reason
naming that the event id is now claimed.

**Rule: when a maintenance action both acts and marks-as-handled, the report must branch on what
actually happened.** Marking-as-handled is destructive to the *next* run's ability to find the
problem.

## Fail-closed boot gates are deploy-ordering dependencies

Requiring `ATOMS_PLUS_ALERT_EMAIL` in `prodGate` (`plus-service/src/prodGate.mjs:65`) stops alerting
from silently booting off — which is the whole failure being fixed, reintroduced one layer up. But it
also hard-fails the next production boot if the Fly secret is not set first.

Both are real. The resolution was to keep the gate and make its message name the exact remedy:
`fly secrets set ATOMS_PLUS_ALERT_EMAIL=…`. **A fail-closed boot gate is a deploy-ordering
dependency, and the error message is the mitigation.** Do not soften the gate to avoid the ordering
problem.

## Throttling is part of the fix

A rotated webhook secret fails **every** delivery. Un-throttled, that is hundreds of identical emails
in an hour — which retrains the operator to ignore the channel, reproducing the log-nobody-reads bug
in email. Throttling is what makes the alert a signal.

Two details that are not optional:

- **Throttle state lives in the shared store**, on the `alerted_at` column keyed by kind
  (`plus-service/src/alert.mjs:30`, `plus-service/src/store/postgres.mjs:695`). In-process state means
  a two-machine deploy doubles every alert, and it resets on every restart — precisely when incidents
  cluster.
- **Stamp only after a delivered send** (`alert.mjs:40`), so a Resend outage retries next window
  instead of silently consuming the throttle.

## An unauthenticated route that writes to the DB

`POST /v1/billing/webhook` has no rate limit, and its reject path needs only a malformed signature
header. Recording one row per rejection let any anonymous caller flood production Postgres — and
worse, *serialize on one row lock* and drain the pool.

The fix is two collapses, and it needs both (`plus-service/src/server.mjs:282-307`):

- a **day-bucket upsert** — unique key `(kind, day_bucket, stripe_id)` with an empty id for class A —
  collapses **rows**
- a **rate limit on the reject path only** collapses **writes**; the row-collapse alone still UPSERTs
  the same row on every request

Scoping the limit to the reject path is load-bearing: a signature-verified Stripe delivery never
reaches it, so a real webhook can never be throttled, and the response the anonymous caller sees is
identical either way.

**Rule: before adding a write to any unauthenticated route, ask what one anonymous caller in a loop
does to the database** — including lock contention, not just row count.

## See also

- [`../logic-errors/security-fix-repair-wired-into-only-one-branch.md`](../logic-errors/security-fix-repair-wired-into-only-one-branch.md) — #230, the instance this generalizes
- Issue #238 · `docs/plans/2026-08-04-238-stripe-reconcile-alerts-plan.md` (KTD2 throttle/day-bucket, KTD5 oracle, KTD6/KTD9 repair semantics)
- `plus-service/scripts/reconcile-stripe.mjs` — the sweep CLI (report-only by default; `--repair` is opt-in)
