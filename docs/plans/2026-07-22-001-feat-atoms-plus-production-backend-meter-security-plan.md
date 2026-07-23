---
title: "Atoms Plus — production backend + meter security"
type: feat
date: 2026-07-22
origin: docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md
related: docs/handoffs/2026-07-21-atoms-plus.md
pr: https://github.com/taihartman/obsidian-atoms/pull/92
issue: 91
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
doc_review: 2026-07-22
deepened: null
---

# Atoms Plus — production backend + meter security

## Goal capsule

Ship a **hosted** Plus service that users can reach from desktop/phone Obsidian, with **server-side filing meter integrity** that cannot be gamed by client storage, unpaid checkout, webhook replay, or open Anthropic proxy abuse. Local dogfood (in-memory + Stripe test + `stripe listen`) stays for dev; production **fails closed**.

**Not this plan:** Efficient mode (#90), companion apps, IAP, durable vault changes, rewriting the plugin classify pipeline (only auth/checkout hardening as needed).

## Problem frame

Today Plus works **only on a developer machine**:

- `plus-service` in-memory store (lost on restart; multi-instance free quota)
- Magic links in server console / `dev-exchange` HTML session dump
- Dogfood paths grant trial/top-up **without Stripe** when env incomplete
- Classify accepts client `messagesRequest` (COGS amplifier: 1 filing ≠ bounded cost)
- No rate limits, immortal sessions, weak promo / webhook price binding

**Adversarial security review (2026-07-22)** ranked free-quota and COGS issues **P0**. Client `remaining` is already **not** source of truth for successful classify — the holes are **server dogfood grants, durable store, webhook/payment binding, and open proxy bodies**.

## Product contract (preserved)

From origin plan / Plus pricing SSOT (`plus-pricing.json`):

| ID | Requirement |
|----|-------------|
| R-BYOK | Free BYOK forever; never pitch BYOK on Plus exhaust |
| R-150 | 150 filings / paid period; top-up +50 / $2; no rollover |
| R-PRICE | $6/mo, $60/yr, 14-day trial (card-upfront via Stripe) |
| R-SSOT | Vault remains SSOT; body sacred; plugin never holds managed Anthropic master key |
| R-METER | **Server** remaining is only billing truth; client cache display-only |
| R-R13 | Hard upper bound on per-user monthly Anthropic COGS under abuse |

**Product Contract preservation:** unchanged — this plan is HOW to host and harden, not re-price.

## Scope

### In

1. Production deploy shape for `plus-service`
2. Durable entitlement + usage ledger
3. Fail-closed billing (Stripe required in prod)
4. Meter anti-abuse (atomic consume, webhook idempotency, price allowlist)
5. Proxy request allowlisting / size caps / rate limits
6. Session lifecycle + kill dogfood routes in prod
7. Magic-link email provider
8. Security gates + tests that prove meter cannot be inflated
9. Stripe Customer Portal + subscription cancel/delete → entitlement revoke (keep paid top-up remainder)
10. Plugin: classify `Idempotency-Key` + post-checkout `/v1/me` refresh
11. Durable adversarial meter review under `docs/qa/`

### Out

- App Store IAP
- Multi-region active-active (start single-region)
- Full SOC2 program (document controls only)
- Changing 150/top-up product numbers (still `plus-pricing.json` only)
- Closing Issue #91 until **plugin** Plus MVP ship criteria are met (backend has its own claim — see Multiplayer)

### Multiplayer / claims

| Track | Issue | PR | Notes |
|-------|-------|-----|--------|
| **Plugin Plus MVP** (UI, BYOK dual-path, local dogfood service) | #91 | #92 | Keep until U5e/U7 plugin shipping tail |
| **Plus production backend + meter security** | **#107** | Branch off master or continue worktree; draft PR | Owns `plus-service/` deploy, DB, email, U2–U9; U1 fail-closed landed on #92 |

**U1 fail-closed** may still land on #92 as a small safety commit (no public DNS). Everything that needs Postgres/email/host → **backend Issue**, not silent scope creep on #91.

## Key technical decisions (KTD)

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD-B1 | **v0.1 default: managed Postgres** (Fly Postgres / Neon / Railway). SQLite only if explicitly single-process forever — never multi-machine SQLite | Shared truth + unique constraints; avoids split-brain meter |
| KTD-B2 | **Fail closed in production:** `ATOMS_PLUS_ENV=production` (preferred over bare `NODE_ENV`) refuses start if dogfood grants on, Stripe incomplete, or webhook secret missing | Closes P0-1/P0-2; explicit product env flag |
| KTD-B3 | **Classify payload is server-owned:** build Anthropic request server-side from `capture` + bounded `context` using the **same structured-output / tool schema the plugin expects** (copy or share schema module). Reject oversized capture/context. Do not forward raw client `messagesRequest` | Closes P0-3 without breaking Process JSON shape |
| KTD-B4 | **Webhook:** verify signature + `payment_status` + **Price ID ∈ env allowlist**; durable `event.id` unique before grant | Closes P1-2 + P0-4 replay |
| KTD-B5 | **Atomic meter:** `UPDATE … SET remaining = remaining - 1 WHERE remaining > 0 RETURNING` (or equivalent) + usage row with client `Idempotency-Key` | Multi-instance safe; retry-safe |
| KTD-B6 | **Disable** `GET /v1/auth/dev-exchange` session HTML in prod; magic link → short-lived token → plugin exchange only | Closes P1-4 |
| KTD-B7 | Session TTL (e.g. 30–90 days) + server revoke on sign-out; rate limits per IP/email/session | Closes P1-3/P1-5 |
| KTD-B8 | Promo: per-account max 1 (or N), no default public `FOUNDING` in prod | Closes P1-1 |
| KTD-B9 | Host: Fly.io / Railway / Render single region + TLS; secrets in platform vault | Match small-team ops |
| KTD-B10 | Plugin: after Checkout return, auto `/v1/me` refresh; Settings already opens Checkout URL | UX; not meter SoT |
| KTD-B11 | Plugin classify sends **Idempotency-Key** (UUID per logical attempt); service stores response for replay | Closes double-spend on client retry; pairs with U2 ledger |
| KTD-B12 | **Customer Portal** for manage/cancel; webhooks `customer.subscription.deleted` / `updated(canceled)` revoke sub access; **keep** remaining top-up filings | Matches product; closes cancel-without-revoke gap |
| KTD-B13 | Adversarial meter review lives at `docs/qa/2026-07-22-atoms-plus-meter-security-review.md`; U9 tests map 1:1 to its P0/P1 table | Durable SoT for security regression |

## Trust boundary (canonical)

```
Plugin localStorage (session, cached remaining)
        │  untrusted for billing
        ▼
Plus HTTP API ──► Postgres ledger ──► Anthropic (operator key)
        ▲
        │ signed webhooks only
     Stripe
```

**Never:** client-asserted remaining, unpaid checkout grants, unsigned webhooks, multi-replica in-memory maps.

## Architecture

### Components

| Component | Role |
|-----------|------|
| `plus-service` | Auth, checkout session create, webhook, meter, Anthropic proxy |
| Postgres | `accounts`, `sessions`, `usage_events`, `stripe_events`, `promo_redemptions` |
| Stripe | Products/prices (live), Checkout, webhooks |
| Email (Resend/Postmark) | Magic-link delivery |
| Obsidian plugin | Bearer session, open Checkout, display entitlement from `/v1/me` |

### Suggested schema (directional)

```text
accounts(email PK, status, remaining, period_end, plan, stripe_customer_id, …)
sessions(token_hash PK, email, expires_at, revoked_at)
usage_events(id PK, idempotency_key UNIQUE, email, session_id, status, tokens_in, tokens_out, created_at)
stripe_events(event_id PK, type, processed_at)
promo_redemptions(email, code, UNIQUE(email, code) or count)
```

### Prod startup asserts

Refuse boot if any:

- `DOGFOOD_AUTO_GRANT != 0`
- `STRIPE_DOGFOOD_CHECKOUT == 1`
- missing `STRIPE_SECRET_KEY` / webhook secret / three price IDs
- missing `DATABASE_URL`
- missing `ANTHROPIC_API_KEY`
- `PUBLIC_BASE_URL` is localhost (warn or fail)

### Meter algorithm

1. Validate session (not expired/revoked).
2. Validate request size + build server-side Anthropic payload (schema-compatible with plugin).
3. Begin txn: insert `usage_events` with `idempotency_key`. On unique conflict → return **stored** prior response payload (must persist `response_json` on success rows), **no** second decrement.
4. Atomic decrement; if 0 rows → 402; store `status=reserved`.
5. Call Anthropic **outside** long locks if needed; on transport/5xx → mark usage refunded + increment remaining (KTD-P6); on model 200 → store `response_json`, `status=ok`.
6. Return `{ result, remaining, usageId }`.
7. Plugin must send `Idempotency-Key` (or `usageId` client-generated UUID) on classify retries.

### Webhook algorithm

1. Verify Stripe-Signature (existing HMAC).
2. Insert `stripe_events(event_id)` unique; on conflict → 200 duplicate.
3. Map price id → grant type; reject unknown prices.
4. Require paid/complete where applicable (`payment_status` / invoice paid).
5. `grantPeriod` / `addTopUp` with **no rollover** (set remaining, never add old remaining on period grant).
6. **Lifecycle events:**
   - `customer.subscription.deleted` or canceled → `revokeSubscription` (status inactive/exhausted policy per store; **do not** zero remaining if top-ups left)
   - `invoice.paid` with `billing_reason=subscription_cycle` → new period grant 150 (no rollover)
   - Ignore or no-op `subscription_create` invoice if checkout.session.completed already granted (avoid double mint)
7. **Customer Portal:** `POST /v1/billing/portal` (Bearer) → Stripe Billing Portal session URL for manage/cancel/update payment method.

## Implementation units

### U1 — Prod fail-closed + kill dogfood paths

**Files:** `plus-service/src/config.mjs`, `plus-service/src/server.mjs`, `plus-service/test/prod-gate.test.mjs`

**Approach:** Production env asserts; checkout without Stripe → 503; remove or gate `dev-exchange`; health redacts secrets/flags in prod.

**Tests:** boot fails with dogfood on; checkout free-path disabled; dev-exchange 404 in prod.

### U2 — Durable store + atomic meter + usage ledger

**Files:** `plus-service/src/store.mjs` → `store/` (pg or better-sqlite3), migrations, `plus-service/test/meter.test.mjs`

**Approach:** Replace Maps; atomic consume; idempotency key; concurrent consume stress test.

**Tests:** two parallel consumes cannot both succeed at remaining=1; replay same idempotency key does not double-charge; restart preserves remaining.

### U3 — Stripe webhook hardening + portal + cancel path

**Files:** `plus-service/src/stripe.mjs`, `plus-service/src/server.mjs`, `plus-service/test/stripe-webhook.test.mjs`, plugin Settings “Manage Subscription” wire

**Approach:**

- Price allowlist; `payment_status` / paid invoice checks; durable `event.id`; grant amounts from **price id → config**, not free-form metadata amounts
- Handle `checkout.session.completed`, `invoice.paid` (cycle only for renew), `customer.subscription.deleted`, `customer.subscription.updated` (canceled)
- `POST /v1/billing/portal` → Stripe Customer Portal (return URL = plugin docs or `PUBLIC_BASE_URL` return page)
- Plugin **Manage Subscription** opens portal URL (replace stub Notice)

**Tests:** unknown price rejected; duplicate event_id no second top-up; unsigned body 400; subscription.deleted → revoke without wiping leftover top-up remaining; portal session requires valid Bearer.

### U4 — Proxy allowlist + rate limits + body caps

**Files:** `plus-service/src/anthropic.mjs`, `plus-service/src/server.mjs`, `plus-service/src/ratelimit.mjs`, shared schema with plugin if needed (`src/pipeline/` or `plus-service/src/classifyTemplate.mjs`)

**Approach:** Server builds the Anthropic request (system + user + **forced tool/JSON schema matching current plugin classify**). Caps: capture bytes, context title count/length, `max_tokens`. Per-IP and per-session QPS. Reject or strip client `messagesRequest` rather than merging untrusted fields.

**Tests:** huge client messagesRequest ignored or 400; oversize body 413; rate limit 429; golden fixture: server-built body still produces parseable classify result shape the plugin accepts.

### U5 — Sessions + email magic link

**Files:** `plus-service/src/auth.mjs`, email adapter, plugin Settings copy if needed

**Approach:** Resend/Postmark; session TTL; `POST /v1/auth/sign-out` revokes server session; plugin sign-out calls it.

**Tests:** expired session 401; revoked session 401; magic token single-use.

### U6 — Promo hardening

**Files:** store promo path, config

**Approach:** per-email unique redeem; prod codes from env only; audit log.

**Tests:** second redeem same code same email fails.

### U7 — Deploy + runbook

**Files:** `plus-service/README.md`, `plus-service/deploy/` or Dockerfile, `docs/runbooks/atoms-plus-prod.md`

**Approach:** container + env template; Stripe live webhook URL; `plus.tryatoms.app` DNS; plugin default base URL already `https://plus.tryatoms.app`.

**Verify:** health green; test Checkout live smoke on staging first.

### U8 — Plugin Idempotency-Key + entitlement refresh + portal

**Files:** `src/platform/plusClient.ts`, `src/pipeline/classify.ts`, `src/settings/settings.ts`, `src/home/atomsHomeView.ts` (if needed), `test/plusClient.test.ts`

**Approach:**

1. **Idempotency-Key:** each Plus classify HTTP call sends a client-generated UUID; retries of the same logical attempt reuse the key; new capture → new key. Service returns cached body on replay (U2).
2. **Refresh:** on Settings open, Home focus, and after Checkout return deep-link/notice — `GET /v1/me` and `writePlusSession`. Never treat local `remaining` as authorize.
3. **Portal:** Manage Subscription → `createBillingPortal` → `window.open`.
4. **Sign-out:** call `POST /v1/auth/sign-out` then clear local session.

**Tests:** plusClient sends Idempotency-Key header; unit for refresh helper; manual vault smoke after Checkout.

### U9 — Security regression suite + durable review artifact (mandatory gate)

**Files:**

- `docs/qa/2026-07-22-atoms-plus-meter-security-review.md` — **write first** (persist session adversarial review; KTD-B13)
- `plus-service/test/security-meter.test.mjs` — automated cases mapped to that doc’s P0/P1 table
- CI job or `plus-service` `npm test` includes security file

**Approach:** Every P0/P1 from the review becomes a named test. Suite grows as U1–U6 land; **U7 deploy blocked** until suite green on staging config.

**Scenarios (must stay red-team green):**

1. Forged local remaining 9999 still 402 when server 0  
2. Dogfood checkout path unavailable in prod config  
3. Auto-grant off: magic exchange does not mint 150  
4. Webhook replay same event_id → one grant  
5. Unknown price id → no grant  
6. Parallel classify at remaining=1 → one success  
7. Idempotent classify key → one decrement  
8. Oversize / malicious messagesRequest does not reach Anthropic unbounded  
9. Unsigned webhook rejected  
10. Promo cannot re-mint unbounded on one email  
11. Subscription deleted → cannot classify on sub alone; leftover top-up remaining still usable if product says so  
12. Classify without Idempotency-Key rejected in prod (or auto-generated server-side once + logged — prefer require from plugin)  

## Sequencing

```text
U9a  Write docs/qa/2026-07-22-atoms-plus-meter-security-review.md (durable SoT)
U1   Prod fail-closed + kill dogfood          [may land on PR #92]
U2   Durable meter + ledger                   [backend Issue]
U9b  Security tests for U1–U2
U3   Webhook harden + portal + cancel
U4   Proxy allowlist + rate limits
U5   Email + session TTL
U6   Promo harden
U8   Plugin Idempotency-Key + refresh + portal + sign-out  [before prod traffic]
U9c  Full security suite green
U7   Deploy staging → live                    [only after U9c]
```

**Private beta cut (optional):** U1–U4 + U8 + U9 + staging host with invite-only allowlist before full U5 email polish (magic link still console on staging only if gated).

**Claim rule:** U1 optional on #92; U2+ require backend Issue + STATUS row + draft PR.

## Security findings map (review → unit)

| Finding | Sev | Unit |
|---------|-----|------|
| P0-1 DOGFOOD_AUTO_GRANT default | P0 | U1 |
| P0-2 free checkout without Stripe | P0 | U1 |
| P0-3 open messagesRequest COGS | P0 | U4 |
| P0-4 in-memory / multi-instance | P0 | U2 |
| P1-1 promo re-redeem | P1 | U6 |
| P1-2 webhook under-validate | P1 | U3 |
| P1-3 immortal sessions | P1 | U5 |
| P1-4 dev-exchange dump | P1 | U1/U5 |
| P1-5 no rate limits | P1 | U4 |
| P1-6 refund/idempotency edges | P1 | U2 |
| P1-7 client gate forge (UX only) | P1 | U9-1 |
| Missing portal / cancel entitlement | P1 | U3 + U8 |
| No classify idempotency key | P1 | U2 + U8 |
| Adversarial review only in chat | P2 | U9a → `docs/qa/2026-07-22-atoms-plus-meter-security-review.md` |
| #91 scope blowout | P1 | Multiplayer claim split |

## Risks

| Risk | Mitigation |
|------|------------|
| Deploy before U2 | Only staging with single process; no public DNS |
| Stripe live key leak | Restricted keys; never commit; rotate if chat-exposed |
| Trial multi-account abuse | Stripe radar + email verify + later card fingerprint |
| Anthropic outage burns UX | KTD-P6 refund; clear 503 |
| Postgres ops | Managed Postgres (KTD-B1); no multi-node SQLite |
| Double-grant checkout + invoice.paid | U3 event ordering rules |
| Plugin/service schema drift | KTD-B3 + Q7 shared schema |
| Claim confusion #91 vs backend | Explicit multiplayer table; new Issue for U2+ |

## Dependencies / assumptions

- Issue **#91 / PR #92** = plugin Plus MVP claim only  
- **New GitHub Issue** = production backend + meter security (this plan) before U2  
- Price SSOT stays `plus-pricing.json`  
- Operator Anthropic account + Stripe account (Taitopia)  
- Domain `plus.tryatoms.app` (or successor) DNS controllable  
- Email provider account (Resend default)  
- `docs/qa/2026-07-22-atoms-plus-meter-security-review.md` exists before U9b tests land  

## Success criteria

1. Public plugin can set Plus URL to production host and complete trial Checkout  
2. Process classifies via Plus; remaining decrements server-side  
3. All U9 security scenarios pass in CI (mapped to QA review doc)  
4. Restart + two instances cannot double-grant or double-spend remaining  
5. No dogfood free path reachable on production host  
6. Dogfood local path still works with explicit `DOGFOOD_*=1` for dev  
7. Manage Subscription opens Customer Portal; cancel stops new period grants  
8. Classify retries with same Idempotency-Key do not double-consume  
9. Backend work tracked on its own Issue/PR (not silent #91 creep)  

## Open questions (resolve before U7 live)

| # | Question | Default if undecided (plan proceeds) |
|---|----------|--------------------------------------|
| Q1 | **Host** | Fly.io single region |
| Q2 | **DB** | Managed Postgres (KTD-B1) — not SQLite multi-node |
| Q3 | **Email** | Resend |
| Q4 | **Session TTL / devices** | 60-day TTL; **multiple** devices allowed; sign-out revokes that token only |
| Q5 | **Staging Stripe** | Stripe **test mode** on staging host; live prices only on prod |
| Q6 | **Trial abuse** | v1: email verify + Stripe Radar; card fingerprint uniqueness **deferred** (document residual risk) |
| Q7 | **Classify schema ownership** | Prefer shared module or checked-in snapshot so plugin + service cannot drift |

## Residual risks (accepted until later)

- Multi-email + multi-card free trials (industry-hard; Radar + manual review)
- Compromised operator Anthropic key (ops: rotate, spend alerts, restricted key if possible)
- Stolen long-lived session before TTL (mitigated by HTTPS, no log tokens, revoke endpoint)
- Health/recon on public URL (mitigate: auth health or minimal public health)

## Doc-review notes (2026-07-22)

**Round 1 (auto):** prod env flag; Postgres default; U4 schema-compat; meter `response_json` replay; U9 earlier; private-beta cut; open-question defaults; residual risks.

**Round 2 (fold remaining):** multiplayer claim split (#91 vs backend Issue); U3 portal + cancel webhooks; U8 Idempotency-Key + portal + sign-out; U9a durable QA path + scenarios 11–12; success criteria 7–9; risk table updated. No open doc-review P1/P2 left unaddressed in-plan.

## References

- Origin: `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` (U6, KTD-P4–P10, R13)  
- Handoff: `docs/handoffs/2026-07-21-atoms-plus.md`  
- Pricing: `plus-pricing.json`  
- Current service: `plus-service/`  
- Stripe dogfood already landed: PR #92  
- Meter security SoT: `docs/qa/2026-07-22-atoms-plus-meter-security-review.md` (create in U9a)  
