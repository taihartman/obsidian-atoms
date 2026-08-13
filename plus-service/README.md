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

In Obsidian **Settings → Atoms → Advanced → Plus service URL override**:

```
http://127.0.0.1:8787
```

### Dogfood sign-in (no email yet)

1. Request magic link from Settings (or curl below)
2. `curl -s -X POST http://127.0.0.1:8787/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"you@example.com"}'`
3. Copy magic link from server console → open in browser → copy `sess_…`
4. Paste session in Settings → Save Session (verified via `/v1/me`)

Without Stripe env, **checkout kinds grant immediately** (dogfood).

## Durable store (U2)

| Mode | Env | Use |
|------|-----|-----|
| `memory` | default / tests | Ephemeral |
| `sqlite` | `ATOMS_PLUS_STORE=sqlite` + optional `ATOMS_PLUS_DATABASE_PATH` | Local dogfood durable |
| `postgres` | `ATOMS_PLUS_STORE=postgres` + `DATABASE_URL` | **Production** (multi-instance safe) |

```bash
# Local durable dogfood
ATOMS_PLUS_STORE=sqlite ATOMS_PLUS_DATABASE_PATH=./data/plus.sqlite npm start

# Production-shaped (managed Postgres)
ATOMS_PLUS_STORE=postgres DATABASE_URL=postgres://… npm start
```

Meter: atomic `remaining - 1 WHERE remaining > 0`, `usage_events` ledger with `Idempotency-Key` → `response_json` replay. Prod gate **requires** `DATABASE_URL`.

Postgres meter suite (optional): `DATABASE_URL=… PLUS_METER_PG=1 npm test`

## Production fail-closed (U1)

```bash
export ATOMS_PLUS_ENV=production
export DOGFOOD_AUTO_GRANT=0
export STRIPE_DOGFOOD_CHECKOUT=0
export DATABASE_URL=postgres://…   # managed Postgres required
export ATOMS_PLUS_STORE=postgres
# + full STRIPE_* + ANTHROPIC + PUBLIC_BASE_URL=https://…
npm start   # exits 1 if any gate fails
```

In production: no free checkout grants, minimal `/health`, Postgres meter. (`/v1/auth/dev-exchange` is gone everywhere, not just in production — #240 deleted it as a zero-caller duplicate of the magic-link landing.)

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

Checkout sessions send `allow_promotion_codes=true` — create coupons + promotion codes in the Stripe Dashboard (see `docs/runbooks/atoms-plus-prod.md` § Promotion codes).

OpenCode Stripe MCP is often **live** OAuth — create catalog with `sk_test_` via the script, not live MCP.

## API

| Method | Path | Auth |
|--------|------|------|
| POST | `/v1/auth/magic-link` | body `{ email, verifierHash?, vault? }` |
| POST | `/v1/auth/peek` | body `{ token, verifier? }` → verdict, no session |
| POST | `/v1/auth/exchange` | body `{ token, verifier? }` → session |
| GET | `/v1/auth/exchange?token=` | browser landing; renders, consumes nothing |
| POST | `/v1/auth/exchange/fallback` | form `token=` → pasteable session (HTML) |
| GET | `/v1/me` | Bearer session |
| POST | `/v1/classify` | Bearer; body `{ capture, context, messagesRequest }` |
| POST | `/v1/billing/checkout` | Bearer; `{ kind: start_trial\|subscribe_monthly\|subscribe_yearly\|topup_50 }` |
| POST | `/v1/billing/webhook` | Stripe-Signature (raw body) |
| GET | `/v1/billing/return` | browser land after Checkout |
| POST | `/v1/promo` | Bearer; `{ code }` |

**402** when quota exhausted (no BYOK pitch in message).

### Magic-link handoff (#240)

The plugin mints a device verifier, sends its hash at `magic-link` time, and presents the raw verifier at `peek` and `exchange`. `POST /v1/auth/peek` answers `result: usable | expired | invalid | refused` — the same vocabulary the exchange uses, so the plugin routes one outcome table. It returns the requesting vault on `usable` **and** `refused`, the account email on `usable` only, never a session or the token itself, and always `Cache-Control: no-store`. It consumes nothing: peek as often as you like, the link still exchanges.

Every magic-token surface is rate-limited on its own per-IP key (`MAGIC_LINK_RATE_LIMITS` in `src/ratelimit.mjs`), so a scanner hammering the landing page cannot 429 the peek, the exchange, or the fallback form. The keys are per-instance and the IP is client-supplied, so they brake undirected volume — they are not an authorization control.

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | Managed key (never sent to clients) |
| `ATOMS_PLUS_MODEL` | `claude-sonnet-5` | Forced model |
| `ATOMS_PLUS_INCLUDED` | from `plus-pricing.json` | Filings per period |
| `ATOMS_PLUS_TOPUP` | from pricing | Top-up size |
| `ATOMS_PLUS_MAX_CONTEXT_TITLES` | `400` | Ceiling on a **ranked** shortlist; order received is the order sent |
| `ATOMS_PLUS_MAX_LEGACY_CONTEXT_TITLES` | `40` | Cap for older clients that send the vault alphabetically |
| `ATOMS_PLUS_MAX_CLASSIFY_BYTES` | `300000` | Classify body ceiling (must fit a 400-title shortlist) |
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

## Self-host Ask (DIY)

Product Ask (Claude/ChatGPT remote MCP + atom mirror) on a service **you** run: plugin **Plus service URL override**, dogfood entitlement, OAuth MCP — not authless/static-bearer/live-folder. Guide: [`docs/ask-self-host.md`](../docs/ask-self-host.md).
