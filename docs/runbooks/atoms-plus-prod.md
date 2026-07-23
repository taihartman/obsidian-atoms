# Runbook — Atoms Plus production

## Prerequisites

- Issue #107 claimed; plan `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md`
- Stripe account (staging = **test** mode; live only on prod host)
- Managed Postgres (`DATABASE_URL`)
- Resend account + verified sending domain
- DNS `plus.tryatoms.app` (or staging host) → Fly (or chosen host)
- Operator Anthropic key (never in the plugin)

## Env (production)

```bash
ATOMS_PLUS_ENV=production
DOGFOOD_AUTO_GRANT=0
STRIPE_DOGFOOD_CHECKOUT=0
ATOMS_PLUS_STORE=postgres
DATABASE_URL=postgres://…          # managed Postgres (required)
PUBLIC_BASE_URL=https://plus.tryatoms.app
STRIPE_SECRET_KEY=sk_live_…        # sk_test_ on staging
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_MONTHLY=price_…
STRIPE_PRICE_YEARLY=price_…
STRIPE_PRICE_TOPUP=price_…
ANTHROPIC_API_KEY=sk-ant-…
RESEND_API_KEY=re_…                # required in production
ATOMS_PLUS_EMAIL_FROM=Atoms Plus <plus@tryatoms.app>
# Optional promo codes (none by default in prod):
# ATOMS_PLUS_PROMOS=FOUNDING=2
# ATOMS_PLUS_PROMO_MAX=100
```

Boot **exits 1** if gates fail (dogfood on, missing Stripe/DB/Resend/Anthropic, localhost PUBLIC_BASE_URL, memory/sqlite store).

## Stripe webhook

Dashboard → Webhooks → endpoint:

```text
https://plus.tryatoms.app/v1/billing/webhook
```

Events:

- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.deleted`
- `customer.subscription.updated`

Copy signing secret → `STRIPE_WEBHOOK_SECRET`.

## Fly.io (default host)

From **repo root** (Dockerfile paths assume monorepo context):

```bash
# One-time
fly apps create atoms-plus
fly postgres create --name atoms-plus-db   # or attach Neon DATABASE_URL
fly postgres attach atoms-plus-db -a atoms-plus

fly secrets set -a atoms-plus \
  ATOMS_PLUS_ENV=production \
  DOGFOOD_AUTO_GRANT=0 \
  STRIPE_DOGFOOD_CHECKOUT=0 \
  ATOMS_PLUS_STORE=postgres \
  PUBLIC_BASE_URL=https://plus.tryatoms.app \
  STRIPE_SECRET_KEY=… \
  STRIPE_WEBHOOK_SECRET=… \
  STRIPE_PRICE_MONTHLY=… \
  STRIPE_PRICE_YEARLY=… \
  STRIPE_PRICE_TOPUP=… \
  ANTHROPIC_API_KEY=… \
  RESEND_API_KEY=… \
  ATOMS_PLUS_EMAIL_FROM='Atoms Plus <plus@tryatoms.app>'

# Deploy (build context = repo root)
fly deploy -a atoms-plus -c plus-service/fly.toml \
  --dockerfile plus-service/Dockerfile
```

DNS: CNAME `plus` → Fly app hostname (or A/AAAA per Fly docs).

Local Docker smoke:

```bash
docker build -f plus-service/Dockerfile -t atoms-plus .
# Pass DATABASE_URL + secrets at runtime; do not bake secrets into the image.
```

## Staging

1. Separate Fly app (e.g. `atoms-plus-staging`) + test Stripe keys + test prices  
2. `PUBLIC_BASE_URL=https://plus-staging…` still with `ATOMS_PLUS_ENV=production` gates (no dogfood)  
3. Smoke: magic-link email → Checkout trial → Process from desktop/phone plugin with Plus URL set  

## Plugin

Default Plus URL when empty: `https://plus.tryatoms.app`  
Settings → Atoms Plus → confirm session after magic link / Checkout → **Refresh status**.

## Verify

```bash
curl -sS https://plus.tryatoms.app/health
# {"ok":true,"service":"atoms-plus"}

cd plus-service && npm test
# Optional live Postgres meter suite:
# DATABASE_URL=… PLUS_METER_PG=1 npm test
```

Security checklist: `docs/qa/2026-07-22-atoms-plus-meter-security-review.md`

## Rollback

- `fly releases` / `fly deploy --image <previous>`  
- Stripe: disable webhook endpoint if minting incorrectly  
- Rotate `ANTHROPIC_API_KEY` / Stripe / Resend if leaked  

## Local dogfood (not production)

```bash
cd plus-service
DOGFOOD_AUTO_GRANT=0 ATOMS_PLUS_STORE=sqlite npm start
stripe listen --forward-to localhost:8787/v1/billing/webhook
# Magic links print to console / log when RESEND_API_KEY unset
```
