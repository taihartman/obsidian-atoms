# Runbook — Atoms Plus production

**Live host (2026-07-27):** https://plus.tryatoms.app  
**Fly app:** `atoms-plus` · **DB:** Neon via `DATABASE_URL`  
**Public launch checklist / go-no-go:** [`docs/qa/2026-07-27-plus-public-launch-checklist.md`](../qa/2026-07-27-plus-public-launch-checklist.md)

> Product domain **tryatoms.app** only. Mail: `plus@mail.tryatoms.app` (Resend verified 2026-07-28). No `mail.taihartman.com` / `onboarding@resend.dev`. Cutover: `docs/runbooks/tryatoms-domain-cutover.md`.

## Prerequisites

- Stripe account (staging = **test** mode; **live** keys only on the public host when ready for real money)
- Managed Postgres (`DATABASE_URL`)
- Resend account + **verified sending domain** (not `onboarding@resend.dev` for public users)
- DNS `plus.tryatoms.app` → Fly (`atoms-plus.fly.dev`)
- Operator Anthropic key (never in the plugin)
- Fly **billing** card so machines are not killed by trial limits

## Env (production)

```bash
ATOMS_PLUS_ENV=production
DOGFOOD_AUTO_GRANT=0
STRIPE_DOGFOOD_CHECKOUT=0
ATOMS_PLUS_STORE=postgres
DATABASE_URL=postgres://…          # managed Postgres (required)
PUBLIC_BASE_URL=https://plus.tryatoms.app
STRIPE_SECRET_KEY=sk_live_…        # sk_test_ only on intentional staging
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_MONTHLY=price_…
STRIPE_PRICE_YEARLY=price_…
STRIPE_PRICE_TOPUP=price_…
ANTHROPIC_API_KEY=sk-ant-…
RESEND_API_KEY=re_…                # required in production
ATOMS_PLUS_EMAIL_FROM=Atoms Plus <plus@mail.tryatoms.app>   # must be on verified domain
# Optional promo codes (none by default in prod):
# ATOMS_PLUS_PROMOS=FOUNDING=2
# ATOMS_PLUS_PROMO_MAX=100
```

Boot **exits 1** if gates fail (dogfood on, missing Stripe/DB/Resend/Anthropic, localhost PUBLIC_BASE_URL, memory/sqlite store).

### Live secret snapshot (operator; 2026-07-27)

| Item | Expected when public | Observed |
|------|----------------------|----------|
| `PUBLIC_BASE_URL` | `https://plus.tryatoms.app` | ✅ |
| `STRIPE_SECRET_KEY` | `sk_live_…` | ❌ still `sk_test_…` |
| `ATOMS_PLUS_EMAIL_FROM` | `Atoms Plus <plus@mail.tryatoms.app>` | ✅ verified |
| Live Stripe webhook | enabled on host | ❌ none (test webhook only) |

## Stripe webhook

Dashboard → Webhooks → endpoint (**live** mode for public):

```text
https://plus.tryatoms.app/v1/billing/webhook
```

Events:

- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.deleted`
- `customer.subscription.updated`

Copy signing secret → `STRIPE_WEBHOOK_SECRET`.

Prices must match [`plus-pricing.json`](../../plus-pricing.json): $6/mo, $60/yr, $2 top-up (150 / 50 filings, 14-day trial).

### Promotion codes (Checkout)

**Agent skill:** [`.agents/skills/plus-promo/`](../../.agents/skills/plus-promo/SKILL.md) — mint/list/archive via Stripe CLI + Fly `sk_live` (not the restricted CLI live key).

Requires `allow_promotion_codes` on Checkout (shipped in plus-service; deploy before relying on the field).

**Create codes (live Dashboard):** Products → Coupons → **+ New** → set % or amount off and duration → enable **promotion codes** → set code string, max redemptions, expiry, optional first-time only / customer lock. Apply to the Plus product (or leave unrestricted so monthly/yearly/top-up prices match).

**Owner free Plus:** 100% off, duration forever (or repeating N months), promo `max_redemptions=1`. Redeem via plugin **Subscribe monthly/yearly** → enter code at Checkout — **not** Start trial (trial webhook only grants 14-day `trialing` in our DB; coupon duration does not rewrite that grant).

**Customer path:** Settings → Account → Email → **Use promo code** → Stripe Checkout → “Add promotion code”. Not Start free trial.

**$0 first invoice:** expect `payment_status=no_payment_required` (webhook already grants; only literal `unpaid` skips). Stripe may still collect a payment method depending on Dashboard settings.

**Env promos are separate:** `ATOMS_PLUS_PROMOS` + `POST /v1/promo` grant `plan: promo` without a Stripe subscription. Prefer Stripe codes for anything that should show in portal/invoices. Do not also send Checkout `discounts[]` alongside `allow_promotion_codes` (Stripe mutual exclusion).

**After deploy smoke:** open Subscribe Checkout and confirm the promo field appears; optional one-shot redeem then archive the test code.

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
  PUBLIC_BASE_URL=https://plus.tryatoms.app \
  STRIPE_SECRET_KEY=… \
  STRIPE_WEBHOOK_SECRET=… \
  STRIPE_PRICE_MONTHLY=… \
  STRIPE_PRICE_YEARLY=… \
  STRIPE_PRICE_TOPUP=… \
  ANTHROPIC_API_KEY=… \
  RESEND_API_KEY=… \
  ATOMS_PLUS_EMAIL_FROM='Atoms Plus <plus@mail.tryatoms.app>' \
  ATOMS_ASK_MIRROR_KEY="$(openssl rand -hex 32)"

# Deploy (build context = repo root)
fly deploy -a atoms-plus -c plus-service/fly.toml \
  --dockerfile plus-service/Dockerfile
```

DNS: CNAME `plus` (on tryatoms.app) → `atoms-plus.fly.dev` (or A/AAAA per Fly docs).

Local Docker smoke:

```bash
docker build -f plus-service/Dockerfile -t atoms-plus .
# Pass DATABASE_URL + secrets at runtime; do not bake secrets into the image.
```

### Billing

https://fly.io/dashboard/personal/billing — required before relying on public traffic.

**One free trial per email:** boot migrates `accounts.trial_used` and backfills entitled / Stripe-linked rows. No manual SQL on normal deploy. Residual: inactive accounts with no `stripe_customer_id` and no history may still open one trial — ops can `UPDATE accounts SET trial_used = TRUE WHERE email = '…'`.

## Staging

1. Separate Fly app (e.g. `atoms-plus-staging`) + **test** Stripe keys + test prices  
2. `PUBLIC_BASE_URL=https://…staging…` still with `ATOMS_PLUS_ENV=production` gates (no dogfood)  
3. Smoke: magic-link email → Checkout trial → Process from desktop/phone plugin with Plus URL set  

## Plugin

Default Plus URL when empty: `https://plus.tryatoms.app`  
Install: **BRAT** → `taihartman/obsidian-atoms` after a GitHub Release that includes Plus (0.6.31+).  
Settings → Atoms Plus → confirm session after magic link / Checkout → **Refresh status**.  
Confirm **Settings → Atoms → Version x.y.z**.

## Verify

```bash
curl -sS https://plus.tryatoms.app/health
# {"ok":true,"service":"atoms-plus"}

# Ask / MCP (after deploy with ATOMS_ASK_MIRROR_KEY)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://plus.tryatoms.app/mcp \
  -H 'content-type: application/json' -d '{}'
# expect 401
curl -sS https://plus.tryatoms.app/.well-known/oauth-protected-resource | head -c 200
curl -sS https://plus.tryatoms.app/.well-known/oauth-authorization-server | head -c 200

cd plus-service && npm test
# Optional live Postgres meter suite:
# DATABASE_URL=… PLUS_METER_PG=1 npm test
```

### Ask (remote MCP)

| Item | Value |
|------|--------|
| MCP URL | `https://plus.tryatoms.app/mcp` (or `PUBLIC_BASE_URL/mcp`) |
| Protocol | Dual-era: legacy initialize (`2025-03-26`) + modern `2026-07-28` (no initialize; `createMcpHandler`) |
| OAuth scopes | `atoms:read` (search/fetch) + `atoms:write` (outbox create/continue/cancel); consent Allow grants both |
| OAuth authorize | `/oauth/authorize` (RFC 9207 `iss` on client redirects) |
| Directory pack | [`atoms-ask-connectors-directory.md`](atoms-ask-connectors-directory.md) |
| Claude callback | `https://claude.ai/api/mcp/auth_callback` |
| ChatGPT callbacks | `https://chatgpt.com/connector/oauth/{id}` + legacy `https://chatgpt.com/connector_platform_oauth_redirect` |
| Secret | `ATOMS_ASK_MIRROR_KEY` (AES-GCM at rest; rotate = re-encrypt not automated) |
| SDK | `@modelcontextprotocol/server` + `@modelcontextprotocol/node` v2 |

**Claude:** Settings → Connectors → Add custom connector → paste MCP URL → complete magic-link OAuth in browser.

**ChatGPT:** Enable Developer mode → Apps & connectors → add the same MCP URL → complete OAuth (Plus email magic link + Allow). Re-check OpenAI redirect docs if authorize fails on `redirect_uri`.

Dogfood: `docs/qa/2026-07-27-ask-chatgpt-connector-dogfood.md`

Public readiness: [`docs/qa/2026-07-27-plus-public-launch-checklist.md`](../qa/2026-07-27-plus-public-launch-checklist.md)  
Security checklist: `docs/qa/2026-07-22-atoms-plus-meter-security-review.md`

## Rollback

```bash
# List prior releases (note image digest of last-known-good Ask MCP)
fly releases -a atoms-plus

# Redeploy previous image immediately if dual-era MCP or OAuth breaks connectors
fly deploy -a atoms-plus --image <previous-image-ref> \
  --config plus-service/fly.toml
```

- Stripe: disable webhook endpoint if minting incorrectly  
- Rotate `ANTHROPIC_API_KEY` / Stripe / Resend if leaked  

### Even G2 dark deploy and key rotation

G2 ships dark. Apply the additive schema with `G2_ENABLED=0`, run the Plus suite against the upgraded database, and verify existing Ask traffic before enabling a private device.

Set G2 secrets separately from Ask:

The Even manifest destination allowlist and the WebView request `Origin` are different controls. Installed iPhone Private builds produced `http://127.0.0.1:59134`, then `http://127.0.0.1:59263` after a process restart. The changing port proves the host serves the package from dynamic IPv4 loopback rather than one stable exact origin.

For this private iPhone host, configure the single explicit sentinel `G2_APP_ORIGIN=http://127.0.0.1:*`. It is configuration syntax, never a response header: the service accepts only a canonical `http://127.0.0.1:<valid-explicit-numeric-port>` request Origin and echoes that exact validated Origin. It rejects missing or malformed Origins, `localhost`, IPv6, HTTPS loopback, credentials, paths, query strings, fragments, omitted/default ports, non-numeric or out-of-range ports, lists, and every other wildcard or prefix/suffix trick. A stable packaged host may instead use the existing one-exact-HTTPS-origin configuration.

```bash
fly secrets set -a atoms-plus \
  G2_APP_ORIGIN='http://127.0.0.1:*' \
  G2_OPENAI_API_KEY='<dedicated-least-privilege-key>' \
  G2_ANTHROPIC_API_KEY='<dedicated-least-privilege-key>' \
  G2_PROVIDER_CONTROLS_ACCEPTED=2026-09-09 \
  G2_RETENTION_DISCLOSURE_VERSION=g2-retention-v1 \
  G2_DATA_KEY_CURRENT='<64-hex-characters>' \
  G2_DATA_KEY_CURRENT_VERSION=k1
```

Do not put these values in `fly.toml`, container layers, logs, crash reports, environment dumps, or `.ehpk` packages. Apply provider spend caps and grant only the transcription or messages endpoints each key needs.

Roll out in this order: deploy the new service code dark with `G2_ENABLED=0`; configure the dedicated provider, data-encryption, DPoP nonce, retention, and origin secrets; verify readiness and existing Ask traffic; enable private G2 last. Setting the loopback sentinel on an older service fails production readiness, so do not configure it before the supporting image is deployed. Old server plus new client fails closed; new server plus an old stable-origin client keeps exact HTTPS support; new server plus the current iPhone client accepts only the validated dynamic-port loopback form. DPoP, nonce, pairing code, scopes, entitlement, rate limits, no-store responses, and exact per-request Origin ticket binding remain unchanged.

To rotate encryption, move the old current key and version to `G2_DATA_KEY_PREVIOUS` and `G2_DATA_KEY_PREVIOUS_VERSION`, install a new current pair, deploy, and let normal writes upgrade active rows. Keep the previous key until the maximum 24-hour transcript retention and 15-minute preparation window have elapsed and the sweep is green. Removing it sooner can strand mixed-version rows.

Enable only for private evidence:

```bash
fly secrets set -a atoms-plus G2_ENABLED=1 G2_TRANSCRIPTION_ENABLED=1
```

Emergency stop:

```bash
fly secrets set -a atoms-plus G2_ENABLED=0
```

Then revoke the dedicated provider keys. Existing Ask remains available. Do not roll back the additive schema. If an older image is required, disable G2 first, allow short-lived tickets to expire, deploy the older image, and leave the G2 tables in place.

The bounded retention sweep reports only row counts, status, and latency. A failed sweep must alert operations but must not delete unbounded rows or stop Ask. Public submission stays blocked by [`../g2-private-test.md`](../g2-private-test.md).


## Local dogfood (not production)

```bash
cd plus-service
DOGFOOD_AUTO_GRANT=0 ATOMS_PLUS_STORE=sqlite npm start
stripe listen --forward-to localhost:8787/v1/billing/webhook
# Magic links print to console / log when RESEND_API_KEY unset
```

Personal DIY Ask (no hosted bill, development + dogfood, tunnel for phone): [`docs/ask-self-host.md`](../ask-self-host.md).
