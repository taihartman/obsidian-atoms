# Plan — #238 reconcile + alert when a paid Stripe event never grants entitlement

**Issue:** [#238](https://github.com/taihartman/obsidian-atoms/issues/238)
**Lane:** light (clear scope, ops-facing, no product decision)
**Scope:** `plus-service/` only. No plugin change, no version bump, no Release.
**Follow-up from:** #230 — same silent-failure class.
**Doc-review:** light (coherence + feasibility), 2026-08-04 — 16 findings, all applied below. Notable
corrections: `payment_status` is not a valid Stripe list filter; `getAccount` is the wrong
reconciliation oracle; the 24h checkout-binding TTL makes late repair unable to restore the session.

## Product bar

A customer who paid and did not get entitlement is **detected**, and the gap is **queryable after
the fact**. Detection mode differs by failure class, and the difference is deliberate:

- **Classes A and B** (the webhook reached us) — a signal a human *receives*: a throttled email.
- **Class C** (it never reached us) — a report a human *pulls*, via the reconciliation CLI, at a
  stated cadence (see KTD4). Nothing in-process can see class C; scheduling the pull is out of
  scope for this issue and named as such rather than implied.

Today all three classes produce at most one `console.error` line nobody reads.

## The three failure classes

| Class | Today | Covered by |
|---|---|---|
| **A. Webhook arrived, was rejected** — bad/rotated `STRIPE_WEBHOOK_SECRET`, HMAC fail | 400 + `[plus] webhook reject` log (`server.mjs:275`) | U2 record + U3 alert |
| **B. Webhook arrived, applied, granted nothing** — `missing_email`, `email_mismatch`, `unknown_price` | silent return, one `console.error` for mismatch only | U2 record + U3 alert |
| **C. Webhook never arrived** — endpoint unsubscribed, Stripe retries exhausted | **nothing at all, no in-process signal exists** | U4 sweep (records + reports) |

**Not incidents** — intentional skips that legitimately grant later or elsewhere. Recording them
would manufacture exactly the alert fatigue KTD2 exists to prevent:

- `unpaid_skip` — a delayed payment method grants on the later `checkout.session.async_payment_succeeded`.
- `invoice_skip` — `billing_reason` outside `subscription_cycle` / `subscription_update`;
  `subscription_create` is already covered by `checkout.session.completed`.

`unknown_price` is instrumented for completeness but is near-unreachable in production: webhook
payloads are unexpanded and `createCheckoutSession` never sets `metadata.price_id`. Expect zero.

## KTDs

**KTD1 — Alert channel is Resend, via a new `sendOpsEmail` extracted from `src/email.mjs`.**
Resend is the only outbound channel in the service and `prodGate.mjs` already *requires*
`RESEND_API_KEY` in production, so this adds one address and no new vendor or secret. It is **not**
pure reuse: `email.mjs` currently exports only `sendMagicLinkEmail`, whose subject and body are
hardcoded sign-in prose — routing an ops alert through it would email the operator a sign-in
notice. U3 extracts a generic `sendOpsEmail({to, subject, text})` sharing the same Resend POST and
`isProduction()` fallback. Rejected: a new Sentry/webhook-out vendor (new secret, new dependency,
for roughly one alert a week); log-only (that is the bug being fixed).

**KTD2 — One row per `(kind, day, stripeId)`, with an occurrence counter; alerts throttled per
`(kind, window)`.**
Two distinct pressures, one mechanism. `POST /v1/billing/webhook` has **no rate limit** and the
class-A reject path needs only a malformed `Stripe-Signature` header, so a row-per-request would let
any anonymous caller flood production Postgres and bury the real incidents. Class A has no parseable
Stripe id, so its rows collapse to one per kind per day with `occurrences` incrementing. Classes B
and C carry a real session id, so they get one row each per day — bounded by genuine Stripe traffic.
Separately, a rotated secret fails *every* delivery, so alerting is gated on `alerted_at` (below),
not on occurrence count.

**KTD3 — Every incident is recorded, including ones that produce no alert, and including class C
found by the sweep.** The email is the interrupt; the table is the record. Uses the existing in-boot
`CREATE TABLE IF NOT EXISTS` pattern (`postgres.mjs:24` `MIGRATE_SQL`, `sqlite.mjs:23` `migrate()`).

**KTD4 — Reconciliation ships as a one-shot CLI, report-only by default, run weekly.**
There is **no scheduler in `plus-service` at all** — no `setInterval`, no cron, no Fly schedule.
Inventing one exceeds this issue. `scripts/reconcile-stripe.mjs` matches the four existing one-shot
CLIs and runs via `fly ssh console`. **Stated cadence: weekly**, so class-C detection latency is a
number (≤7 days) rather than an accident. Scheduling it later is config, not code. The sweep logic
lives in `src/reconcile.mjs` so it is reachable from `node --test`; the script is argv parsing only.

**KTD5 — The sweep's oracle is `hasProcessedEvent`, not account entitlement.**
Comparing a paid session against `store.getAccount` is wrong in both directions: a paid `topup_50`
for a customer with an active subscription looks entitled, so a lost top-up is never reported; and
any legitimately-granted session whose period has since expired reads `status: exhausted`
(`shared.mjs:63`) and would be reported as paid-but-unentitled — then `--repair` would hand a fresh
period to a months-old payment. The store already has the right oracle on all three backends.

**KTD6 — `--repair` restores entitlement only. It cannot restore the session.**
`promoteCheckoutSession` succeeds only while a `checkout_bindings` row is live, and
`CHECKOUT_BINDING_TTL_MS` is 24h (`store/shared.mjs:24`). A sweep run days after Stripe exhausted
its retries is always past that, so the call is a guaranteed no-op. Repair therefore prints, per
repaired customer, that they must sign in again with a magic link. Claiming otherwise would be the
#230 bug restated as a promise.

**KTD7 — Never log or render a session token, and never an email body.** Incidents carry kind,
Stripe object id, and email address only. `email.mjs`'s non-prod `consoleDeliver` path logs its
payload, so `sendOpsEmail` bodies must stay free of anything beyond those three fields.

## Units

- **U1 — `stripe_incidents` store surface.** Table
  `(id, kind, stripe_id, email, detail, occurrences, first_seen_at, last_seen_at, alerted_at)`,
  unique on `(kind, day_bucket, stripe_id)`. Methods `recordStripeIncident(kind, {stripeId, email,
  detail})` (upsert, increments `occurrences`), `lastStripeAlertAt(kind, sinceMs)`,
  `markStripeIncidentAlerted(id)`, `listStripeIncidents({since, kind, limit})` — across
  `memory` / `sqlite` / `postgres`, with the migration in each dialect. Parity test.
  *Largest unit: three backends, two DDL dialects.*
- **U2 — Record at both holes.** `server.mjs:275` webhook-reject path (class A);
  `applyStripeEvent`'s no-grant returns in `stripe.mjs` (class B), excluding the two named
  non-incidents. Record only — no change to any response.
- **U3 — Alert.** `sendOpsEmail` extracted in `src/email.mjs`; `src/alert.mjs` sends when no row of
  that kind has a non-null `alerted_at` inside the window, then stamps the row. **Single call site:
  the webhook handler in `server.mjs`, after the response is written, inside its own try/catch** —
  not `applyStripeEvent`, which `test/stripe.test.mjs` calls directly and which would pull a Resend
  HTTP call into pure-logic tests. Never fire-and-forget: Node 20 defaults to
  `--unhandled-rejections=throw`, so an unhandled Resend outage would take the process down — the
  exact opposite of the requirement. Config `ATOMS_PLUS_ALERT_EMAIL` +
  `ATOMS_PLUS_ALERT_THROTTLE_MIN`, and **`prodGate` requires the address in production** so
  alerting cannot boot silently off.
- **U4 — Reconciliation sweep.** `stripeGet(path, params)` alongside the POST-only `stripeForm`
  (`stripe.mjs:57`), then `src/reconcile.mjs` exporting
  `reconcileStripe({ store, fetchImpl, since })`: list `/v1/events?type=checkout.session.completed`
  with `created[gte]` and `starting_after` pagination, flag every event where
  `store.hasProcessedEvent(event.id)` is false, record each as a class-C incident, and report.
  Default window 7 days (Stripe's events API retains 30; `--since` accepts up to that).
  The sweep's grantable `payment_status` filter is **`paid` ∪ `no_payment_required`** (absent
  still reads as paid): trial starts settle as `no_payment_required` and `applyStripeEvent`
  grants on them, so a `paid`-only filter would be blind to exactly the signup path #230 broke.
  Genuinely non-grantable statuses (`unpaid`) are still skipped.
  `--repair` extracts the `checkout.session.completed` grant branch of `applyStripeEvent` into a
  shared function both callers use, so repair claims the event id *before* granting (a late Stripe
  redelivery must not double-mint) and honors `metadata.kind` / `mode` so a `topup_50` gets
  `addTopUp`, not a 30-day period. Repair refuses sessions older than the period it would grant
  unless `--force`.
- **U5 — Tests, written per unit (TDD), not batched at the end.** `node:test`, memory + sqlite
  through the existing `runStoreSuite` shape. Stripe list calls take an **injected fetch** — no
  global monkey-patching, consistent with `test/stripe.test.mjs`, which avoids network by testing
  functions that never call out. Cases: throttle (N incidents → 1 email), class-A flood collapses to
  one row, alert failure does not fail the webhook response, repair honors top-up vs subscription,
  repair claims the event.

## Explicitly out of scope

Scheduling the sweep (KTD4 states the manual cadence instead); an admin HTTP route — the table is
reachable by SQL through the same `fly ssh console` access the CLI uses; making `prodGate` validate
that Stripe secrets are *correct* rather than *present* (real, but it needs a live Stripe call at
boot — separate issue); backfilling incidents from Stripe history.

**Deliberately not this issue:** `applyStripeEvent`'s *third* `missing_email` return, on the
`customer.subscription.deleted/updated` path. That is a failed **revoke**, not a failed grant — the
opposite customer-harm direction (revenue leakage, not denied entitlement) from this issue's product
bar. Worth its own issue; naming it here so U2's implementer does not silently fold it in.

## Verification

`cd plus-service && npm install && npm test` green; each unit's tests fail before its fix. Sweep
proven against an injected Stripe stub — no live Stripe call from CI or from an agent. Server-only,
so no vault screenshots: PR Evidence is `N/A — no UI`.

## Open questions

- Does the alert throttle need to hold across multiple Fly machines? It does as specified, because
  `alerted_at` lives in the shared table and no throttle state is in-process. Flagged so a future
  in-memory "optimisation" does not silently double every alert on a two-machine deploy.
