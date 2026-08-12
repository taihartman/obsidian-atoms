---
title: "plus: Stripe Checkout promotion codes"
date: 2026-08-11
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
deepened: 2026-08-11
---

# plus: Stripe Checkout promotion codes

## Goal Capsule

**Objective.** Let operators create and control promo codes in the **Stripe Dashboard** (expiry, max redemptions, first-time only, customer lock, % or free months). Customers enter those codes on **hosted Checkout**. Our webhook entitlement path stays unchanged.

**Authority.** Session-settled (2026-08-11): prefer Stripe over env `ATOMS_PLUS_PROMOS` for real billing-linked discounts; keep env promos for rare free comps without a Stripe sub.

**Stop when.** Every live Checkout Session we mint (trial, monthly, yearly, top-up, portal reconnect Checkout) sends `allow_promotion_codes=true`; a unit test proves the form body; runbook documents Dashboard coupon setup; Fly deploy ships it. Operator can mint a live promo and redeem it end-to-end.

**Out of scope.** Plugin promo field UI; Customer Portal promo toggle (Dashboard-only optional); deleting or redesigning env `ATOMS_PLUS_PROMOS` / `POST /v1/promo`; server-side pre-applied `discounts[]`; Stripe Tax changes; new coupon catalog scripts.

## Product Contract

### Summary

Stripe owns generation and control of customer-facing codes. Checkout shows Stripe’s “Add promotion code” box. Completing Checkout (including 100% off) still fires `checkout.session.completed` → existing grant logic. Operators never rotate Fly secrets to launch a campaign.

### Requirements

- R1. `createCheckoutSession` sets `allow_promotion_codes` so hosted Checkout shows a promo field.
- R2. Applies to **all** Checkout kinds we create: `start_trial`, `subscribe_monthly`, `subscribe_yearly`, `topup_50`, and portal-reconnect Checkout (`subscribe_monthly` via `createPortalSessionForAccount`).
- R3. Do **not** pass Checkout `discounts[]` in the same session (Stripe forbids combining `allow_promotion_codes` with `discounts`).
- R4. Webhook / classify / meter behavior unchanged: discounted or free first invoice still completes a session (`payment_status` `paid` **or** `no_payment_required` — already grantable; only literal `unpaid` skips). `grantPeriod` / `addTopUp` still run from event type + metadata/price, **not** from coupon percent or duration. Coupon duration only affects Stripe billing; our meter keeps advancing on `invoice.paid` (`subscription_cycle` / `subscription_update`) as today.
- R5. Env promo path (`ATOMS_PLUS_PROMOS`, `POST /v1/promo`) remains available for free comps that never touch Stripe; no requirement to remove or hide it.
- R6. Document operator workflow in `docs/runbooks/atoms-plus-prod.md` (create coupon + promotion code in **live** Dashboard; redeem via plugin Checkout).
- R7. No plugin version bump required (server-only). Deploy is Fly `atoms-plus`.

### Actors

- A1. Paying or trial customer — enters a code on Checkout if they have one.
- A2. Operator (owner) — creates/archives codes in Stripe Dashboard; may use a private max-1 code for self-grant.
- A3. Implementer — one-line Checkout param + test + runbook + deploy.

### Key Flows

- F1. Customer: Settings → Start trial / Subscribe / Top up → Checkout URL → optional promo field → pay or $0 first invoice → webhook grants → plugin poll shows entitled.
- F2. Operator campaign: Dashboard Coupons → % or duration → promotion code (max redemptions, expires_at, first_time_transaction, optional customer) → share code string.
- F3. Owner self-grant: 100% off coupon (duration forever or repeating N months) + promo max 1 → plugin **Subscribe monthly/yearly** Checkout (not Start trial) with that code → webhook `grantPeriod` **active** + real `cus_` / `sub_`. Trial Checkout only mints our 14-day `trialing` row; coupon duration does not rewrite that grant.
- F4. Portal reconnect Checkout (stale/missing customer) inherits R1 automatically because it calls `createCheckoutSession`.

### Acceptance Examples

- AE1. Create Checkout for `subscribe_monthly` in test mode with a known promo; Checkout UI shows the promo box; applying a valid 100% code yields a completed session and account `active` with 150 remaining after webhook.
- AE2. Unit test: mocked Stripe POST body for `/checkout/sessions` includes `allow_promotion_codes=true` (or form equivalent `true`).
- AE3. Invalid / exhausted promo: Stripe Checkout rejects at Stripe UI; our service never sees a completed session (no false grant).
- AE4. Top-up (`mode=payment`) also allows promo codes (Stripe supports discounts on payment mode Checkout).
- AE5. Regression: without a promo, Checkout + webhook grant behavior matches pre-change.

### Scope Boundaries

**In:** `plus-service/src/stripe.mjs` (`createCheckoutSession`); tests under `plus-service/test/`; runbook note; Fly deploy after merge.

**Out:** Plugin Settings rows; Customer Portal configuration API; env promo admin CLI; marketing copy on tryatoms; automatic coupon creation scripts in repo.

### Key Decisions (product)

| Decision | Choice | Rejected |
|---|---|---|
| Control plane | Stripe Coupons + Promotion codes | Expand env `ATOMS_PLUS_PROMOS` |
| Customer entry | Hosted Checkout field (`allow_promotion_codes`) | Plugin text field + server redeem |
| Free owner grant | 100% Stripe coupon + **paid** Checkout (`subscribe_monthly` / `yearly`), not `start_trial` | Neon SQL / dogfood auto-grant on prod; trial Checkout + coupon (only buys free trial window in our DB) |
| Env promos | Keep for rare non-Stripe comps | Delete in this change |
| Portal promos | Optional Dashboard setting later | Configure portal API in this PR |

**Product Contract preservation:** bootstrap from session; no prior requirements-only artifact.

## Planning Contract

### Key technical decisions

| ID | Decision | Choice | Why |
|---|---|---|---|
| KTD1 | Where to set the flag | Single place: `createCheckoutSession` params | All Checkout entry points (server checkout + portal reconnect) already call it |
| KTD2 | Value shape | Form POST `allow_promotion_codes=true` (string `"true"` via existing `buildStripeParams`) | Matches no-SDK `URLSearchParams` style already used for Checkout |
| KTD3 | Modes | Always on for both `subscription` and `payment` | Top-ups are payment mode; same operator codes should work |
| KTD4 | Pre-applied discounts | Never send `discounts[]` alongside allow | Stripe mutual exclusion; keep operator/customer code entry |
| KTD5 | Entitlement truth | Unchanged webhook taxonomy (`classifyCheckoutGrant` + metadata/price) | Coupon only changes money; product grant is still period/top-up |
| KTD6 | Card on $0 first invoice | Rely on Stripe Dashboard / Checkout defaults; document that 100% forever still usually collects a PM | Avoid custom free-order config in code this PR |
| KTD7 | Test strategy | Mock `fetch` around `createCheckoutSession` (or extract param builder if cleaner) | No live Stripe required in unit suite |

### Architecture / code map

```
plugin Settings → POST /v1/billing/checkout
                      │
                      ▼
              createCheckoutSession  ←── ADD allow_promotion_codes
                      │
                      ▼
              Stripe hosted Checkout (promo box)
                      │
                      ▼
         checkout.session.completed webhook
                      │
                      ▼
              applyCheckoutCompleted → grantPeriod / addTopUp
                      │
                      ▼
              plugin resume poll → /v1/me entitled
```

Portal reconnect that falls back to Checkout reuses the same function (no second edit site).

**Do not touch:** `POST /v1/promo`, store `redeemPromo`, `ATOMS_PLUS_PROMOS` parsing, Customer Portal session create (portal promo is a Stripe Dashboard Billing → Customer portal setting, not this API field).

### Implementation units

#### U1 — Enable promotion codes on Checkout

**Goal.** Every Checkout Session we create accepts customer-entered promotion codes.

**Files:**
- `plus-service/src/stripe.mjs` — in `createCheckoutSession`, after building base `params`, set `allow_promotion_codes: "true"` (or `true` if params type allows; `buildStripeParams` stringifies).
- `plus-service/test/stripe-checkout-promos.test.mjs` (new) **or** extend `plus-service/test/stripe.test.mjs` — mock global `fetch`, call `createCheckoutSession`, assert request URL ends with `/checkout/sessions` and body contains `allow_promotion_codes=true`.
- Optionally assert for both a subscription kind and `topup_50`.

**Patterns to follow:** existing `stripeForm` / `buildStripeParams`; portal stale tests’ inject style if needed (`createCheckout` override is for portal only — prefer fetch mock for the real function).

**Test scenarios:**
1. `subscribe_monthly` session request includes `allow_promotion_codes=true`.
2. `topup_50` session request includes `allow_promotion_codes=true`.
3. `start_trial` still sends `subscription_data[trial_period_days]` and promo flag together.
4. Negative: if fetch returns no `url`, still throws (unchanged behavior).

**Done when:** `cd plus-service && npm test` green; code review can see one intentional param addition.

#### U2 — Operator runbook + deploy notes

**Goal.** Owner can create and control codes without reading Stripe docs from scratch.

**Files:**
- `docs/runbooks/atoms-plus-prod.md` — short section **Promotion codes (Checkout)**:
  - Requires U1 deployed.
  - Live Dashboard: Products → Coupons → New → enable promotion codes.
  - Suggested owner coupon: 100% off, duration forever (or repeating N months), promo code max_redemptions=1; apply to Plus product or leave unrestricted so monthly/yearly prices match.
  - Owner redeem path: **Subscribe** (monthly or yearly) → enter code — **not** Start trial (trial webhook only grants 14-day `trialing`).
  - Customer path: plugin Checkout → “Add promotion code”.
  - Note: env `ATOMS_PLUS_PROMOS` is separate (no Stripe sub); prefer Stripe for anything that should show in portal/invoices.
  - Caution: do not combine server-side `discounts` with allow_promotion_codes if a future change adds pre-applied coupons.
  - $0 first invoice: expect `payment_status=no_payment_required` (already granted by webhook); Stripe may still collect a payment method depending on Dashboard settings.
- Optional one-liner in `plus-service/README.md` under Stripe section.

**Test scenarios:** doc-only; human smoke AE1 after deploy.

**Done when:** runbook merged; deploy checklist mentions live coupon smoke.

#### U3 — Ship

**Goal.** Production Checkout shows the field.

**Steps (human/agent shipping tail):**
1. Merge PR (plus-service only).
2. `fly deploy -a atoms-plus -c plus-service/fly.toml --dockerfile plus-service/Dockerfile` from repo root.
3. Live smoke: open trial or subscribe Checkout → confirm promo UI; optional redeem test code then archive it.
4. No plugin BRAT release required.

### Risks and edge cases

| Risk | Mitigation |
|---|---|
| 100% off + trial double-free / wrong grant shape | Runbook: owner free forever uses **subscribe** + 100% coupon; trial + promo still only `trialing` for `trialDays` in our DB; renewals via `invoice.paid` |
| First-time-only promos blocked after prior incomplete PaymentIntent | Stripe restriction; document; use non-first-time codes for owner |
| Customer shares a public campaign code | Use max_redemptions + expires_at on the promo; archive in Dashboard |
| Expecting free Plus without card | Stripe may still require a payment method; owner accepts PM on file or uses Dashboard-applied coupon on existing sub |
| Env promo vs Stripe promo both exist | Different products: env grants `plan: promo` without `sub_`; Stripe keeps real subscription — runbook says which to use |
| Reconnect Checkout with promo | Allowed; paid monthly + promo is fine; still no new trial (`reconnectCheckoutKind`) |

### Dependencies

- Live Stripe already configured on `atoms-plus` (confirmed runbook 2026-08-10).
- No new secrets.
- No DB migration.

### Execution direction

Small, server-only. Unit test first for the form param (characterization of Checkout body), then one-line enable, then runbook, then deploy smoke.

## Assumptions

- Stripe live mode coupons are created manually in Dashboard for v1 (no `scripts/create-stripe-catalog.mjs` expansion required).
- Portal “allow promotion codes” for existing subscribers is a separate Dashboard toggle; not blocking this plan.
- Plugin does not need copy changes; Checkout hosts the field in Stripe’s UI language.

## Open questions (non-blocking)

- Optional later: enable Customer Portal promotion codes (Dashboard Billing → Customer portal); script to mint single-use codes via API for support.
- Optional later: assert in a live/test smoke that a 100% `subscribe_monthly` session returns `payment_status=no_payment_required` and still grants (covered by existing reconcile comments; not a code change).

## Doc-review (2026-08-11)

**Team:** coherence, feasibility, security, product-lens, adversarial (billing + bootstrap). No design-lens / scope-guardian (no UI; 3 units).

**Applied this pass:** F3/KTD owner path = paid subscribe not trial; R4 documents `no_payment_required` + coupon-does-not-set-meter; runbook bullets for product restriction and owner path.

**Residual FYI (no plan change):** public Checkout promo box is intentional attack surface — control via Dashboard max_redemptions/expiry/archive only. Dual env+Stripe promo systems remain by product decision R5.

## Sources

- Session: owner wants Stripe-controlled promos for self + campaigns (2026-08-11).
- Code: `plus-service/src/stripe.mjs` `createCheckoutSession` (~L177–235); no `allow_promotion_codes` today.
- Stripe docs: Checkout `allow_promotion_codes`; Coupons vs Promotion codes; mutual exclusion with `discounts`.
- Runbook: `docs/runbooks/atoms-plus-prod.md`.
- Prior Plus plans: trial-once, Stripe-first onboarding (webhook grant model unchanged).
