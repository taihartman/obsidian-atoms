---
title: Atoms Plus meter / entitlement security review
date: 2026-07-22
plan: docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md
scope: plus-service filing meter anti-abuse
---

# Atoms Plus — meter security review (SoT)

Adversarial review of **current** dogfood-grade Plus service. Client `remaining` is **not** billing SoT for successful classify. Real holes: server dogfood grants, unpaid checkout, in-memory store, open Anthropic proxy body.

Maps 1:1 to plan U9 tests. Update this file when findings change.

## Trust boundaries

| Layer | Trusted for billing? |
|-------|----------------------|
| Plugin localStorage session / remaining | **No** — display + UX gate only |
| `POST /v1/classify` Bearer + server `remaining` | **Yes** |
| Stripe signed webhooks | **Yes** (when verified + durable) |
| Dogfood checkout / auto-grant | **No** — dev only |

## Findings

| ID | Sev | Summary | Plan unit | U9 test |
|----|-----|---------|-----------|---------|
| P0-1 | P0 | `DOGFOOD_AUTO_GRANT` default ON → free 150 on every re-login when exhausted | U1 | auto-grant off |
| P0-2 | P0 | Checkout without Stripe (or dogfood flag) grants free top-up/sub | U1 | dogfood checkout unavailable in prod |
| P0-3 | P0 | Client `messagesRequest` unbounded → COGS blowup per filing | U4 | oversize messagesRequest |
| P0-4 | P0 | In-memory store → restart webhook replay + multi-instance free quota | U2 | restart + parallel consume |
| P1-1 | P1 | Promo re-redeem per account until global cap | U6 | promo one per email |
| P1-2 | P1 | Webhook under-validates payment/price; fragile idempotency | U3 | unknown price / replay |
| P1-3 | P1 | Immortal pasteable sessions | U5 | expired/revoked 401 |
| P1-4 | P1 | `dev-exchange` dumps `sess_` in HTML | U1 | dev-exchange 404 in prod |
| P1-5 | P1 | No rate limits | U4 | 429 |
| P1-6 | P1 | Refund/idempotency edges | U2 | Idempotency-Key |
| P1-7 | P1 | Client exhausted gate forgeable (UX only; server still 402) | U9 | forged remaining → 402 |
| P1-8 | P1 | No Customer Portal / cancel path clarity | U3 | subscription.deleted |

## Defenses already present

- Server `tryConsumeFiling` before Anthropic proxy; 402 at 0
- Model forced server-side (KTD-P7)
- Stripe webhook HMAC + timestamp skew (single-process event id)
- Magic token single-use + 15m expiry
- No rollover on `grantPeriod`
- Session not in `data.json`

## Production must-haves (checklist)

- [ ] `ATOMS_PLUS_ENV=production` fail-closed (U1)
- [ ] No dogfood checkout / auto-grant in prod (U1)
- [ ] Durable Postgres meter + ledger (U2)
- [ ] Webhook price allowlist + durable event id (U3)
- [ ] Server-built classify payload + rate limits (U4)
- [ ] Email magic link; no dev-exchange (U5)
- [ ] Promo per-email cap (U6)
- [ ] Plugin Idempotency-Key (U8)
- [ ] U9 suite green on staging before public DNS (U7)

## Explicit: client remaining is never SoT

Forging local `remaining` / `status` must never mint server filings. Only UX may change until 402.
