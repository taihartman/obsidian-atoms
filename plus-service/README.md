# Atoms Plus service (U6)

HTTP API for managed filing: magic-link auth, 150/period meter (**no rollover**), Anthropic proxy, Stripe Checkout (optional).

Matches plugin client paths in `src/platform/plusClient.ts`.

## Quick start (dogfood, no Stripe)

```bash
cd plus-service
export ANTHROPIC_API_KEY=sk-ant-…   # required for /v1/classify
export DOGFOOD_AUTO_GRANT=1         # first login gets trialing + 150
npm start                           # http://127.0.0.1:8787
```

In Obsidian **Settings → Atoms Plus → Plus service URL**:

```
http://127.0.0.1:8787
```

### Dogfood sign-in (no email yet)

1. Request magic link from Settings (or curl below)
2. `curl -s -X POST http://127.0.0.1:8787/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"you@example.com"}'`
3. Copy magic link from server console → open in browser → copy `sess_…`
4. Paste session in Settings → Save Session (verified via `/v1/me`)

Without Stripe env, **checkout kinds grant immediately** (dogfood).

## Stripe test mode

Prefer **test** keys (`sk_test_…`). Do not use live keys for local dogfood.

```bash
# 1) Create catalog from plus-pricing.json ($6 / $60 / $2)
export STRIPE_SECRET_KEY=sk_test_…
node scripts/create-stripe-catalog.mjs
# → prints STRIPE_PRICE_* exports

# 2) Forward webhooks (Stripe CLI)
stripe listen --forward-to localhost:8787/v1/billing/webhook
# → export STRIPE_WEBHOOK_SECRET=whsec_…

# 3) Run service
export DOGFOOD_AUTO_GRANT=0
export STRIPE_PRICE_MONTHLY=price_…
export STRIPE_PRICE_YEARLY=price_…
export STRIPE_PRICE_TOPUP=price_…
npm start
```

Checkout then returns a real Stripe URL. Entitlements update on:

| Event | Effect |
|-------|--------|
| `checkout.session.completed` (sub/trial) | `grantPeriod` 150 |
| `checkout.session.completed` (top-up) | `addTopUp` +50 |
| `invoice.paid` (`subscription_cycle`) | reset 150 (no rollover) |
| `customer.subscription.deleted` | revoke sub (keep remaining filings) |

Test card: `4242 4242 4242 4242`.

OpenCode Stripe MCP is often **live** OAuth — create catalog with `sk_test_` via the script, not live MCP.

## API

| Method | Path | Auth |
|--------|------|------|
| POST | `/v1/auth/magic-link` | body `{ email }` |
| POST | `/v1/auth/exchange` | body `{ token }` → session |
| GET | `/v1/me` | Bearer session |
| POST | `/v1/classify` | Bearer; body `{ capture, context, messagesRequest }` |
| POST | `/v1/billing/checkout` | Bearer; `{ kind: start_trial\|subscribe_monthly\|subscribe_yearly\|topup_50 }` |
| POST | `/v1/billing/webhook` | Stripe-Signature (raw body) |
| GET | `/v1/billing/return` | browser land after Checkout |
| POST | `/v1/promo` | Bearer; `{ code }` |

**402** when quota exhausted (no BYOK pitch in message).

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | Managed key (never sent to clients) |
| `ATOMS_PLUS_MODEL` | `claude-sonnet-5` | Forced model |
| `ATOMS_PLUS_INCLUDED` | from `plus-pricing.json` | Filings per period |
| `ATOMS_PLUS_TOPUP` | from pricing | Top-up size |
| `DOGFOOD_AUTO_GRANT` | `1` | Grant period on first magic exchange |
| `PORT` | `8787` | Listen port |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:$PORT` | Magic-link + Checkout return host |
| `ATOMS_PLUS_PROMOS` | `FOUNDING=2` | `CODE=months` |
| `STRIPE_SECRET_KEY` | — | When set + prices, real Checkout |
| `STRIPE_WEBHOOK_SECRET` | — | Webhook HMAC |
| `STRIPE_PRICE_MONTHLY` | — | Recurring monthly price id |
| `STRIPE_PRICE_YEARLY` | — | Recurring yearly price id |
| `STRIPE_PRICE_TOPUP` | — | One-time top-up price id |
| `STRIPE_DOGFOOD_CHECKOUT` | `0` | `1` = instant grants even with Stripe |

See `.env.example`.

## Tests

```bash
npm test
```

## Production notes

- Replace in-memory `store.mjs` with durable DB
- Send real magic-link email (Resend/Postmark)
- `DOGFOOD_AUTO_GRANT=0`; Stripe live keys + live prices
- TLS reverse proxy; never log Authorization or Anthropic/Stripe secrets
