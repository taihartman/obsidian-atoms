# Plan — #238 reconcile + alert when a paid Stripe event never grants entitlement

**Issue:** [#238](https://github.com/taihartman/obsidian-atoms/issues/238)
**Lane:** light (clear scope, ops-facing, no product decision)
**Scope:** `plus-service/` only. No plugin change, no version bump, no Release.
**Follow-up from:** #230 — same silent-failure class.

## Product bar

A customer who paid and did not get entitlement produces a **signal a human receives**, and the gap
is **queryable after the fact**. Today it produces one `console.error` line nobody reads.

## The three failure classes, and what covers each

| Class | Today | Covered by |
|---|---|---|
| **A. Webhook arrived, was rejected** — bad/rotated `STRIPE_WEBHOOK_SECRET`, HMAC fail | 400 + `[plus] webhook reject` log (`server.mjs:275`) | U2 record + U3 alert |
| **B. Webhook arrived, applied, granted nothing** — `missing_email`, `email_mismatch`, `unknown_price` | silent return, one `console.error` for mismatch only | U2 record + U3 alert |
| **C. Webhook never arrived** — endpoint unsubscribed, Stripe retries exhausted | **nothing at all, no in-process signal exists** | U4 reconciliation sweep |

Class C is the one no amount of in-process instrumentation can see, which is why the sweep is not
optional. `unpaid_skip` is explicitly **not** an incident — a delayed payment method legitimately
grants later.

## KTDs

**KTD1 — Alert channel is Resend, reusing `src/email.mjs`.**
It is the only outbound channel in the service, and `prodGate.mjs` already *requires*
`RESEND_API_KEY` in production, so this adds one config value (`ATOMS_PLUS_ALERT_EMAIL`) and no new
secret or vendor. Rejected: a new Sentry/webhook-out dependency (new secret, new vendor, for one
alert/week); log-only (that is the bug being fixed).

**KTD2 — Alerts are throttled and deduped per (kind, day).**
A rotated webhook secret fails *every* delivery. Un-throttled, that is hundreds of identical
emails, which trains the reader to ignore them — the log-nobody-reads failure wearing a new hat.
One email per incident kind per throttle window; the table keeps every occurrence.

**KTD3 — Every incident is recorded to a `stripe_incidents` table regardless of whether an alert
was sent.** The email is the interrupt; the table is the record. Follows the existing in-boot
`CREATE TABLE IF NOT EXISTS` migration pattern (`postgres.mjs:24`, `sqlite.mjs:23`).

**KTD4 — Reconciliation ships as a one-shot CLI, report-only by default.**
There is **no scheduler in `plus-service` at all** (no `setInterval`, no cron, no Fly schedule).
Inventing one is a bigger change than #238 warrants. A `scripts/reconcile-stripe.mjs` matches the
four existing one-shot CLIs and is runnable via `fly ssh console`. `--repair` is opt-in and prints
what it would grant first. Scheduling it later is a config change, not a code change.

**KTD5 — Never log or render a session token, and never an email body.** Alerts carry the incident
kind, the Stripe object id, and the email address only.

## Units

- **U1 — `stripe_incidents` store surface.** `recordStripeIncident(kind, {stripeId, email, detail})`
  + `listStripeIncidents({since, kind, limit})` + `countRecentIncidents(kind, sinceMs)` (drives the
  throttle) across `memory` / `sqlite` / `postgres`, migration in each. Parity test.
- **U2 — Record at both holes.** `server.mjs:275` webhook-reject path (class A);
  `applyStripeEvent`'s no-grant returns in `stripe.mjs` (class B). Record only, no behavior change
  to the responses.
- **U3 — Alert.** `src/alert.mjs` — throttle via `countRecentIncidents`, send via `email.mjs`,
  config `ATOMS_PLUS_ALERT_EMAIL` + `ATOMS_PLUS_ALERT_THROTTLE_MIN`. Missing address = record only,
  never throw; an alert failure must never fail the webhook response.
- **U4 — Reconciliation sweep.** `stripeGet(path, params)` alongside the POST-only `stripeForm`
  (`stripe.mjs:57`), then `scripts/reconcile-stripe.mjs`: list recent `checkout.sessions` with
  `payment_status=paid`, resolve each to an email, compare against `store.getAccount`, report every
  paid-but-unentitled session. `--repair` grants via the same `grantPeriod` +
  `promoteCheckoutSession` pair the webhook uses, so #230's binding fix is preserved.
- **U5 — Tests.** `node:test`, memory + sqlite through the existing `runStoreSuite` shape. Stripe
  list calls are exercised with an injected fetch (none of the existing tests stub `fetch`; the
  helper takes an optional fetch impl rather than monkey-patching a global).

## Explicitly out of scope

Scheduling the sweep; an admin HTTP route; making `prodGate` validate that Stripe secrets are
*correct* rather than *present* (real, but it is a live Stripe call at boot — separate issue);
backfilling incidents from Stripe history.

## Verification

`cd plus-service && npm install && npm test` green; new tests fail before the fix (TDD per unit).
Reconciliation CLI proven against a stubbed Stripe list — no live Stripe call from CI or from an
agent. Server-only, so no vault screenshots: PR Evidence is `N/A — no UI`.
