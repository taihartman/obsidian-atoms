# Runbook — Atoms Plus production

## Prerequisites

- Issue #107 claimed; plan `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md`
- Stripe **live** prices (or test on staging)
- `ANTHROPIC_API_KEY`, Resend key (optional at first)
- Domain DNS → host (default Fly)

## Env (production)

```bash
ATOMS_PLUS_ENV=production
DOGFOOD_AUTO_GRANT=0
STRIPE_DOGFOOD_CHECKOUT=0
ATOMS_PLUS_STORE=sqlite          # or wire Postgres later
ATOMS_PLUS_DATABASE_PATH=/data/plus.sqlite
PUBLIC_BASE_URL=https://plus.tryatoms.app
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_MONTHLY=price_…
STRIPE_PRICE_YEARLY=price_…
STRIPE_PRICE_TOPUP=price_…
ANTHROPIC_API_KEY=sk-ant-…
RESEND_API_KEY=re_…             # optional; else magic links log only
```

Boot **exits 1** if gates fail.

## Stripe webhook

Dashboard → Webhooks → `https://plus.tryatoms.app/v1/billing/webhook`

Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`

## Docker / Fly sketch

```bash
# from repo root
docker build -f plus-service/Dockerfile -t atoms-plus .
# mount volume for /data
```

Fly: set secrets, attach volume at `/data`, internal port 8787.

## Staging

Use Stripe **test** keys + `PUBLIC_BASE_URL=https://plus-staging…` still with `ATOMS_PLUS_ENV=production` gates (no dogfood).

## Verify

```bash
curl -s https://plus.tryatoms.app/health
# {"ok":true,"service":"atoms-plus"}
cd plus-service && npm test
```
