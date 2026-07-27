# Runbook — Atoms Plus production

**Live host (2026-07-27):** https://plus.taihartman.com  
**Fly app:** `atoms-plus` · **DB:** Neon via `DATABASE_URL`  
**Public launch checklist / go-no-go:** [`docs/qa/2026-07-27-plus-public-launch-checklist.md`](../qa/2026-07-27-plus-public-launch-checklist.md)

> Historical plan text used `plus.tryatoms.app`. **Do not** point DNS or secrets there unless that domain is cut over. Plugin default empty URL is `https://plus.taihartman.com`.

## Prerequisites

- Stripe account (staging = **test** mode; **live** keys only on the public host when ready for real money)
- Managed Postgres (`DATABASE_URL`)
- Resend account + **verified sending domain** (not `onboarding@resend.dev` for public users)
- DNS `plus.taihartman.com` → Fly (`atoms-plus.fly.dev`)
- Operator Anthropic key (never in the plugin)
- Fly **billing** card so machines are not killed by trial limits

## Env (production)

```bash
ATOMS_PLUS_ENV=production
DOGFOOD_AUTO_GRANT=0
STRIPE_DOGFOOD_CHECKOUT=0
ATOMS_PLUS_STORE=postgres
DATABASE_URL=postgres://…          # managed Postgres (required)
PUBLIC_BASE_URL=https://plus.taihartman.com
STRIPE_SECRET_KEY=sk_live_…        # sk_test_ only on intentional staging
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_MONTHLY=price_…
STRIPE_PRICE_YEARLY=price_…
STRIPE_PRICE_TOPUP=price_…
ANTHROPIC_API_KEY=sk-ant-…
RESEND_API_KEY=re_…                # required in production
ATOMS_PLUS_EMAIL_FROM=Atoms Plus <plus@taihartman.com>   # must be on verified domain
# Optional promo codes (none by default in prod):
# ATOMS_PLUS_PROMOS=FOUNDING=2
# ATOMS_PLUS_PROMO_MAX=100
```

Boot **exits 1** if gates fail (dogfood on, missing Stripe/DB/Resend/Anthropic, localhost PUBLIC_BASE_URL, memory/sqlite store).

### Live secret snapshot (operator; 2026-07-27)

| Item | Expected when public | Observed |
|------|----------------------|----------|
| `PUBLIC_BASE_URL` | `https://plus.taihartman.com` | ✅ |
| `STRIPE_SECRET_KEY` | `sk_live_…` | ❌ still `sk_test_…` |
| `ATOMS_PLUS_EMAIL_FROM` | domain you verified | ❌ `onboarding@resend.dev` |
| Live Stripe webhook | enabled on host | ❌ none (test webhook only) |

## Stripe webhook

Dashboard → Webhooks → endpoint (**live** mode for public):

```text
https://plus.taihartman.com/v1/billing/webhook
```

Events:

- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.deleted`
- `customer.subscription.updated`

Copy signing secret → `STRIPE_WEBHOOK_SECRET`.

Prices must match [`plus-pricing.json`](../../plus-pricing.json): $6/mo, $60/yr, $2 top-up (150 / 50 filings, 14-day trial).

## Fly.io (default host)

From **repo root** (Dockerfile paths assume monorepo context):

```bash
# One-time
fly apps create atoms-plus
# Attach managed Postgres (Neon URL or fly postgres)

fly secrets set -a atoms-plus \
  ATOMS_PLUS_ENV=production \
  DOGFOOD_AUTO_GRANT=0 \
  STRIPE_DOGFOOD_CHECKOUT=0 \
  ATOMS_PLUS_STORE=postgres \
  PUBLIC_BASE_URL=https://plus.taihartman.com \
  STRIPE_SECRET_KEY=… \
  STRIPE_WEBHOOK_SECRET=… \
  STRIPE_PRICE_MONTHLY=… \
  STRIPE_PRICE_YEARLY=… \
  STRIPE_PRICE_TOPUP=… \
  ANTHROPIC_API_KEY=… \
  RESEND_API_KEY=… \
  ATOMS_PLUS_EMAIL_FROM='Atoms Plus <plus@taihartman.com>' \
  ATOMS_ASK_MIRROR_KEY="$(openssl rand -hex 32)"

# Deploy (build context = repo root)
fly deploy -a atoms-plus -c plus-service/fly.toml \
  --dockerfile plus-service/Dockerfile
```

DNS: CNAME `plus` (on taihartman.com) → `atoms-plus.fly.dev` (or A/AAAA per Fly docs).

Local Docker smoke:

```bash
docker build -f plus-service/Dockerfile -t atoms-plus .
# Pass DATABASE_URL + secrets at runtime; do not bake secrets into the image.
```

### Billing

https://fly.io/dashboard/personal/billing — required before relying on public traffic.

## Staging

1. Separate Fly app (e.g. `atoms-plus-staging`) + **test** Stripe keys + test prices  
2. `PUBLIC_BASE_URL=https://…staging…` still with `ATOMS_PLUS_ENV=production` gates (no dogfood)  
3. Smoke: magic-link email → Checkout trial → Process from desktop/phone plugin with Plus URL set  

## Plugin

Default Plus URL when empty: `https://plus.taihartman.com`  
Install: **BRAT** → `taihartman/obsidian-atoms` after a GitHub Release that includes Plus (0.6.31+).  
Settings → Atoms Plus → confirm session after magic link / Checkout → **Refresh status**.  
Confirm **Settings → Atoms → Version x.y.z**.

## Verify

```bash
curl -sS https://plus.taihartman.com/health
# {"ok":true,"service":"atoms-plus"}

# Ask / MCP (after deploy with ATOMS_ASK_MIRROR_KEY)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://plus.taihartman.com/mcp \
  -H 'content-type: application/json' -d '{}'
# expect 401
curl -sS https://plus.taihartman.com/.well-known/oauth-protected-resource | head -c 200
curl -sS https://plus.taihartman.com/.well-known/oauth-authorization-server | head -c 200

cd plus-service && npm test
# Optional live Postgres meter suite:
# DATABASE_URL=… PLUS_METER_PG=1 npm test
```

### Ask (remote MCP)

| Item | Value |
|------|--------|
| MCP URL | `https://plus.taihartman.com/mcp` (or `PUBLIC_BASE_URL/mcp`) |
| OAuth authorize | `/oauth/authorize` |
| Claude callback | `https://claude.ai/api/mcp/auth_callback` |
| Secret | `ATOMS_ASK_MIRROR_KEY` (AES-GCM at rest; rotate = re-encrypt not automated) |

Claude: Settings → Connectors → Add custom connector → paste MCP URL → complete magic-link OAuth in browser.

Public readiness: [`docs/qa/2026-07-27-plus-public-launch-checklist.md`](../qa/2026-07-27-plus-public-launch-checklist.md)  
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
