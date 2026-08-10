---
title: "plus: one free trial per email"
date: 2026-08-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
deepened: false
---

# plus: one free trial per email

## Goal Capsule

**Objective.** Each Plus email gets at most one free trial. After a trial grant **or** any Plus billing relationship, only paid paths (subscribe, yearly, top-up, promo) and portal reconnect — never another `start_trial`.

**Authority.** Product decisions settled in-session (2026-08-10). Stripe does not enforce trial-once; our DB is SoT. Portal reconnect already never opens trial (#417).

**Stop when.** Durable `trial_used` on accounts; checkout + webhook + dogfood trial grants set and respect it; backfill marks existing entitled/customer-linked accounts; tests cover exhausted re-trial and webhook bypass; Fly deploy after merge.

**Out of scope.** Plugin UI redesign; Stripe Dashboard config; multi-email identity linking; promo ledger changes; charging policy for reconnect mid-trial (already shipped).

## Product Contract

### Summary

One free trial per email, forever. Mark on any trial grant (live Stripe, dogfood checkout, dogfood magic auto-grant). Block second `start_trial` for exhausted and canceled accounts, not only while still `trialing`/`active`. Backfill on deploy so current users cannot re-trial. Paid subscribe and reconnect stay open.

### Requirements

- R1. No free trial if the email already received a trial grant **or** already has a Plus billing relationship (`trial_used`, or backfill-equivalent: entitled status / `stripe_customer_id`). Covers Checkout, webhook, and dogfood.
- R2. “Used trial” is set on **any** trial grant: `start_trial` Checkout completed, dogfood `start_trial` grant, or dogfood magic-link auto-grant into `trialing`.
- R3. While `trial_used` is true, `POST /v1/billing/checkout` with `kind=start_trial` returns 409 with a clear paid-path message (not only when status is active/trialing).
- R4. `checkout.session.completed` with trial classification must not call `grantPeriod` for trial if the email already used its trial (claim event; **link customer/subscription when present**; no second meter mint).
- R5. Exhausted and inactive-after-cancel accounts cannot open a free trial again (once `trial_used` is set or backfilled).
- R6. Paid paths remain: `subscribe_monthly`, `subscribe_yearly`, `topup_50`, promo redeem, portal reconnect (`subscribe_monthly`).
- R7. Deploy backfill: mark `trial_used` for accounts that already look entitled or Stripe-linked so they cannot re-trial after ship.
- R8. `publicAccount` / plugin `/v1/me` stay lean — do not require exposing `trial_used` unless a later UI needs it.
- R9. `clearStripeBillingLink` and `revokeSubscription` must **not** clear `trial_used`.

### Actors

- A1. New email — never entitled, no customer — may start one free trial.
- A2. Current trialing / active / exhausted user — already used trial (or paid); no free trial.
- A3. Canceled user (`inactive`, may still have `stripe_customer_id`) — no free trial; paid subscribe or magic link.
- A4. Operator deploying Fly — migration + backfill run on boot / one-shot SQL.

### Key Flows

- F1. First trial: soft start → `start_trial` Checkout → webhook grants trial → set `trial_used=true`.
- F2. Second trial attempt (any status): checkout 409; if a rogue Checkout still completes, webhook no-ops the trial grant.
- F3. After trial exhausted: magic link / paid subscribe / top-up only.
- F4. Deploy: ALTER + backfill → existing Plus emails cannot re-open free trial.

### Acceptance Examples

- AE1. Email completes one trial; later `exhausted`; `start_trial` → 409; meter unchanged.
- AE2. Two webhook deliveries of different `start_trial` events for same email: second does not reset remaining/period.
- AE3. Fresh email can still complete one trial end-to-end.
- AE4. After backfill, an account that is `active` with a Stripe customer cannot `start_trial`.
- AE5. Portal reconnect still returns `subscribe_monthly` (regression from #417).

### Scope Boundaries

**In:** plus-service stores (memory/sqlite/postgres), checkout gate, Stripe trial grant path, dogfood trial grants, boot migration + backfill, tests, Fly deploy.

**Out:** Plugin copy/rows beyond surfacing existing 409 `message`; Stripe-side trial limits; identity graph across emails.

### Key Decisions (product)

| Decision | Choice | Rejected |
|---|---|---|
| When to mark used | Any trial grant | Live-Stripe-only |
| Exhausted re-trial | Block forever | Allow re-hook trial |
| Backfill | On deploy for entitled / Stripe-linked | Forward-only |
| Enforcer | Our DB flag | Stripe alone |

**Product Contract preservation:** bootstrap from session; no prior requirements-only artifact.

## Planning Contract

### Key Technical Decisions

- KTD1. **Durable flag on `accounts`:** `trial_used BOOLEAN NOT NULL DEFAULT FALSE` (SQLite INTEGER 0/1). Prefer column over a new ledger table — one bit, always loaded with the account (unlike multi-code `promo_email`).
- KTD2. **Migrate like magic_tokens, not accounts-as-today:** `CREATE TABLE` includes the column **and** boot `ALTER TABLE accounts ADD COLUMN …` (Postgres `IF NOT EXISTS`; SQLite PRAGMA + ADD). Existing prod DBs never re-run full CREATE.
- KTD3. **Single helper API in `shared.mjs`:** `accountHasUsedTrial(a)` (read). Trial entitlement claim: `tryClaimTrial(email)` → `{ won: true|false }` implemented as atomic `UPDATE … SET trial_used=TRUE WHERE email=? AND trial_used=FALSE RETURNING *` (memory: check-then-set under the account object). **Never** treat `plan === "trial"` as used — `ensureAccount` defaults inactive rows to that plan.
- KTD3b. **Atomic claim before grant:** every trial mint path (webhook, dogfood checkout, dogfood magic auto-grant) must `tryClaimTrial` **before** `grantPeriod`. Winner grants; loser takes `trial_already_used` (no meter mint). Do **not** grant-then-mark in two steps — that loses to crash + cancel/exhausted.
- KTD4. **Defense in depth:** Checkout 409 on `accountHasUsedTrial` **and** webhook `tryClaimTrial`. Dual completed Checkouts before either webhook: second completion is always no-op mint (accepted; document residual dual Stripe customers). No Checkout-time reservation in v1.
- KTD5. **Webhook when trial already used / claim lost:** Stripe `claimEvent` stays for **delivery** idempotency only (per `event.id`). Email trial claim is `tryClaimTrial`. Still `setStripeCustomer` / subscription if present; return `trial_already_used`; do not 5xx.
- KTD6. **Backfill predicate (best-effort, no history table):**
  ```sql
  UPDATE accounts SET trial_used = TRUE
  WHERE status IN ('trialing', 'active', 'exhausted')
     OR stripe_customer_id IS NOT NULL;
  ```
  Do **not** key off `plan = 'trial'` alone — `ensureAccount` defaults new rows to `plan: "trial"` while inactive. Run once on boot after ALTER (idempotent UPDATE).
- KTD7. **Dogfood counts (required, not optional).** Dogfood `start_trial` and `exchangeMagic` auto-grant into `trialing` use the same `tryClaimTrial` + gate as live. If claim lost / already used: **skip** auto-grant (do not mint trial).
- KTD8. **409 copy:** keep short and paid-path oriented, e.g. `Free trial already used — subscribe or sign in with a magic link.` Plugin already shows `Atoms Plus: ${message}`.
- KTD9. **`trial_used` is permanent** through refund, dispute, cancel, portal unlink, and `clearStripeBillingLink`. No Stripe refund webhook clears it. Abandoned Checkout does not need a reservation release in v1 (we do not mark at Checkout create).
- KTD10. **`saveAccount` invariant:** `rowToAccount` always maps `trialUsed` (default false on read of missing column pre-migrate only). Every `saveAccount` **writes** `trial_used` from the in-memory boolean and must never coerce a missing property to `false` after load. `tryClaimTrial` / mark paths only set true.

### Assumptions

- One email = one person for trial abuse purposes (no multi-email linking this pass).
- Product rule matches backfill: no free trial after any Plus billing relationship (entitled status or Stripe customer), not only after a completed trial grant.
- v1 UX: existing Start trial CTA may 409; paid-path discovery is message-only until D1 exposes `trialUsed` on `/v1/me`.
- Residual: inactive + no `stripe_customer_id` with no history may still open one trial after deploy (best-effort backfill); acceptable unless ops hand-marks known emails.
- Dual Checkout URLs before webhook: second completion no-ops mint; may still create a second Stripe customer — monitor `trial_already_used`, no auto-cancel in v1.
- No plugin version bump required if 409 message alone is enough.

### Technical Design

```
accounts.trial_used  (durable, permanent once true)

start_trial Checkout
  → if accountHasUsedTrial(a) || active || trialing → 409
  → else Stripe/dogfood as today

applyCheckoutCompleted(grant=trial)
  → claimEvent (delivery id)
  → tryClaimTrial(email)
       lost  → link customer/sub if present; action trial_already_used
       won   → grantPeriod(trialing)
  (never grant then mark in two non-atomic steps)

dogfood start_trial / magic auto-grant trialing
  → same tryClaimTrial; skip grant if lost

clearStripeBillingLink / revokeSubscription / grantPeriod(paid)
  → never clear trial_used; saveAccount always persists the flag
```

### Patterns to follow

- Additive column: `plus-service/src/store/postgres.mjs` sessions/magic_tokens ALTER block (~111–127); sqlite PRAGMA (~101–121).
- Once-per-email product rule (different shape): `promo_email` + security-meter P1-1 tests.
- Checkout 409 shape: existing “Already subscribed” branch in `server.mjs`.
- Portal never trial: `reconnectCheckoutKind` + `stripe-portal-stale.test.mjs`.

### Sequencing

1. U1 — schema + helpers + backfill on boot (all stores)
2. U2 — checkout gate + dogfood trial grant paths
3. U3 — webhook / applyCheckoutCompleted
4. U4 — tests + Fly deploy note

U1 before U2/U3. U2 and U3 can be same PR; prefer one shipping PR for atomic deploy.

## Implementation Units

### U1. Durable `trial_used` + migration + backfill + claim helper

**Goal.** Every store can read/write `trialUsed`; atomic `tryClaimTrial`; live Postgres gains the column and backfill without manual SQL; cancel/self-heal cannot wipe the flag.

**Files.**
- `plus-service/src/store/shared.mjs` — `rowToAccount` (+ `trialUsed`), `accountHasUsedTrial(a)`
- `plus-service/src/store/memory.mjs` — default false; `tryClaimTrial`; `saveAccount` paths; `clearStripeBillingLink` / `revokeSubscription` preserve flag
- `plus-service/src/store/sqlite.mjs` — CREATE column, PRAGMA ALTER, saveAccount/ensureAccount write `trial_used`, backfill on open, `tryClaimTrial`
- `plus-service/src/store/postgres.mjs` — same + `ADD COLUMN IF NOT EXISTS` + idempotent UPDATE backfill + atomic UPDATE RETURNING claim
- `plus-service/test/store.test.mjs` — persistence / default / backfill / claim / preserve-on-clear-revoke

**Approach.**
- Column: `trial_used` / `trialUsed` boolean, default false.
- `tryClaimTrial(email)` → `{ won: boolean }` only sets true; never false (KTD3, KTD10).
- On store open (sqlite/postgres): migrate then backfill UPDATE as KTD6.
- Memory: no SQL backfill; tests seed explicitly.
- `accountHasUsedTrial` reads **only** `trialUsed` — never `plan === "trial"`.

**Test scenarios.**
- New account: `trialUsed === false`.
- `tryClaimTrial` won then second claim lost; `getAccount` still true.
- SQLite reopen after claim still true (if suite uses temp db).
- Backfill: `status=exhausted` → used; fresh inactive false; inactive default `plan=trial` alone stays false; `active`+customer → used.
- After claim: `clearStripeBillingLink` and `revokeSubscription` leave `trialUsed === true`.
- After claim: paid `grantPeriod` leaves `trialUsed === true` (saveAccount does not wipe).

**Execution direction.** Test-first on helpers + sqlite migrate.

---

### U2. Checkout + dogfood gates (including magic auto-grant)

**Goal.** No second free trial can be opened from the API or dogfood auto-grant.

**Files.**
- `plus-service/src/server.mjs` — `start_trial` 409 when `accountHasUsedTrial(a) || active || trialing`; dogfood `start_trial` branch: if used → refuse; else grant then only after `tryClaimTrial` won (or claim before grant)
- `plus-service/src/store/memory.mjs` / `sqlite.mjs` / `postgres.mjs` — `exchangeMagic` dogfood auto-grant: **required** — if would grant `trialing` and claim lost / already used → skip auto-grant; on first trialing grant → `tryClaimTrial` then `grantPeriod` (or claim-integrated grant)

**Test scenarios.**
- Exhausted + `trialUsed=true` → checkout `start_trial` → 409, remaining unchanged.
- Inactive + `trialUsed=true` → 409.
- Inactive + `trialUsed=false` → still allowed (mocked Stripe or dogfood on).
- Dogfood: exhausted + used → magic exchange does **not** re-grant trialing.
- Dogfood: first auto-grant into trialing → `trialUsed=true`.
- Message does not mention raw Stripe.

**Execution direction.** Prefer existing store/HTTP test patterns.

---

### U3. Webhook trial grant respects `trial_used`

**Goal.** Completing a second trial Checkout cannot mint filings.

**Files.**
- `plus-service/src/stripe.mjs` — `applyCheckoutCompleted` trial branch
- `plus-service/test/stripe.test.mjs` — second trial event

**Approach.**
- Stripe `claimEvent` first (delivery idempotency).
- Then `tryClaimTrial(email)`. Lost → link customer/sub if present; `{ action: "trial_already_used" }`. Won → `grantPeriod` trial (flag already true).
- Never grant-then-mark as two non-atomic steps.

**Test scenarios.**
- First `start_trial` event → trialing + `trialUsed=true` + remaining included.
- Second different event id, same email, trial metadata (sequential) → `trial_already_used`, remaining/periodEnd unchanged.
- **Concurrent / interleaved** two distinct trial event ids same email → remaining/periodEnd change only once (memory store sequential simulation of both passing a naive read is enough if claim is atomic).
- Subscribe monthly still grants when `trialUsed=true`.
- Top-up still works when `trialUsed=true`.
- Simulated “entitled but trialUsed false then exhausted” is impossible if claim-before-grant; instead: claim won, then second event lost.

---

### U4. Regression + ship

**Goal.** Portal reconnect and promo paths untouched; deploy checklist.

**Files.**
- `plus-service/test/stripe-portal-stale.test.mjs` — keep green (reconnect never `start_trial`)
- `plus-service/test/security-meter.test.mjs` — once-trial case mirroring promo once-email spirit (required)
- `docs/runbooks/atoms-plus-prod.md` — boot migrates `trial_used` + backfill; residual inactive+unlinked may need ops mark; no manual SQL required for normal deploy

**Test scenarios.**
- Full `plus-service` `npm test` green.
- Portal reconnect kind still `subscribe_monthly`.

**Deploy.** Merge → `fly deploy -a atoms-plus …` (boot runs ALTER + backfill). Smoke: exhausted test account `start_trial` 409; new email still trials in test mode if needed.

## Verification Contract

```bash
cd plus-service && npm test
# focused while iterating:
cd plus-service && node --test test/stripe.test.mjs test/store.test.mjs test/stripe-portal-stale.test.mjs
```

CI: existing `plus-service tests` workflow on PR.

No plugin release required for the gate itself.

## Definition of Done

- [ ] U1–U4 complete with listed tests green
- [ ] AE1–AE5 covered by automated tests where feasible; AE4 via backfill unit test
- [ ] No path clears `trial_used` on portal self-heal or cancel
- [ ] Merged + Fly deployed; health OK
- [ ] Runbook notes boot migration

## Open Questions

None blocking. Deferred:

- D1. Expose `trialUsed` on `/v1/me` for a dedicated plugin CTA (“Subscribe” vs “Start trial”) — later UX.
- D2. Stripe Customer search-by-email before Checkout — defense in depth, not required for R1–R9.
- D3. Auto-cancel rogue second Stripe trial subscriptions on `trial_already_used` — v1 links only; ops/monitor.
- D4. Operator API to hand-mark residual inactive+unlinked false-negatives — SQL/runbook sufficient for v1.

## Appendix

### Settled session decisions

- Reconnect = paid monthly only (#417).
- Stripe does not enforce trial-once.
- Mark on any trial grant; block exhausted forever; backfill on deploy.

### Hole map (pre-fix)

| Path | Today | After |
|---|---|---|
| Checkout while active/trialing | 409 | 409 |
| Checkout while exhausted | allowed | 409 if trial_used |
| Checkout while inactive post-cancel | allowed if no entitled soft-start… verified session can still checkout | 409 if trial_used |
| Webhook second start_trial | re-grants | no-op grant |
| Portal reconnect | subscribe_monthly | unchanged |
| clearStripeBillingLink | clears customer | trial_used kept |

### Related code

- `plus-service/src/server.mjs` checkout gate ~878
- `plus-service/src/stripe.mjs` `applyCheckoutCompleted` ~536–558
- `plus-service/src/store/shared.mjs` `isEntitledAccount` ~285
- Portal reconnect #410 / #415 / #417
