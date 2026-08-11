---
name: plus-promo
description: >
  Mint, list, or archive Atoms Plus Stripe coupons and promotion codes for
  production Checkout. Use when the user asks to mint a promo, create a coupon,
  free Plus for an owner/friend, campaign code, founding discount, 100% off,
  "Stripe promo", or "promotion code". Live Dashboard control plane for codes
  customers enter on hosted Checkout (allow_promotion_codes already on).
---

# Plus promo — Stripe coupons + promotion codes

You mint and control **live** Stripe coupons and customer-facing promotion codes for Atoms Plus Checkout. Codes are redeemed in the plugin at **Subscribe / Trial / Top-up** Checkout (promo box), not via env `ATOMS_PLUS_PROMOS`.

## Authority

1. [`docs/runbooks/atoms-plus-prod.md`](../../../docs/runbooks/atoms-plus-prod.md) — § Promotion codes (Checkout)
2. Plan (why Subscribe ≠ trial): [`docs/plans/2026-08-11-001-feat-stripe-checkout-promotion-codes-plan.md`](../../../docs/plans/2026-08-11-001-feat-stripe-checkout-promotion-codes-plan.md)

## Preconditions

- `stripe` CLI installed and logged in
- `fly` CLI can `ssh console -a atoms-plus`
- Checkout already sends `allow_promotion_codes=true` (plus-service #454+) — if promo box missing, deploy latest master first
- **Confirm live** with the human before any `--live` / `sk_live` write unless they already said “prod” / “live”

## Auth (critical)

The Stripe CLI **restricted live key** (`rk_live_…`) usually **lacks `coupon_write`**. Do **not** use bare `stripe … --live` for creates.

**Always** pull the Fly app secret into the shell without printing it:

```bash
export STRIPE_API_KEY="$(fly ssh console -a atoms-plus -C 'printenv STRIPE_SECRET_KEY' 2>/dev/null | tr -d '\r' | tail -1)"
case "$STRIPE_API_KEY" in
  sk_live_*) ;; # ok
  *) echo "expected sk_live from Fly; abort"; exit 1 ;;
esac
# Never echo the key. Prefix-only sanity is fine: ${STRIPE_API_KEY:0:8}
```

Then run `stripe coupons …` / `stripe promotion_codes …` with that env (CLI picks up `STRIPE_API_KEY`).

**Never** log, commit, or paste `STRIPE_API_KEY` / full secrets into chat, PRs, or files.

## Product rules (do not invent)

| Rule | Detail |
|---|---|
| Owner free forever | Coupon **100%**, `duration=forever` + promo `max_redemptions=1` (or low N) |
| Redeem path | Human uses plugin **Subscribe monthly/yearly** + code — **not** Start trial |
| Why not trial | Trial webhook only grants 14-day `trialing` in our DB; coupon duration does not rewrite that grant |
| Meter | Coupon only changes Stripe money; our filings still grant on `checkout.session.completed` / renew on `invoice.paid` |
| Env promos | `ATOMS_PLUS_PROMOS` + `POST /v1/promo` are a **separate** no-Stripe path — do not mix instructions |
| $0 Checkout | Often `payment_status=no_payment_required` (already grantable). Stripe may still require a payment method |

## API shapes that bite

### Coupon create

```bash
stripe coupons create \
  -d percent_off=100 \
  -d duration=forever \
  -d id=atoms_owner_100 \
  -d name="Atoms owner 100% forever" \
  -d "metadata[purpose]=owner_comp"
```

Other durations:

- Once: `-d duration=once`
- N months free: `-d duration=repeating -d duration_in_months=3`
- Percent or amount: `percent_off` **or** `amount_off` + `currency=usd`

Reusable coupon ids are fine (`atoms_owner_100`). Creating the same `id` twice fails — list first or pick a new id.

### Promotion code create (nested `promotion`, not bare `coupon`)

Stripe rejects `-d coupon=…`. Use:

```bash
CODE="OWNER-$(openssl rand -hex 3 | tr 'a-f' 'A-F')"
stripe promotion_codes create \
  -d "promotion[type]=coupon" \
  -d "promotion[coupon]=atoms_owner_100" \
  -d code="$CODE" \
  -d max_redemptions=1 \
  -d "metadata[purpose]=owner_comp"
```

Optional restrictions:

- `-d "restrictions[first_time_transaction]=true"`
- `-d expires_at=<unix>`
- `-d customer=cus_…` (lock to one Stripe customer)

### List / archive

```bash
stripe coupons list --limit 20
stripe promotion_codes list --limit 20
# Deactivate a code (cannot re-activate after max/expiry in some cases):
stripe promotion_codes update promo_… -d active=false
```

## Recipes

### 1) Owner / friend one-shot free forever (default when they say “mint me Plus”)

1. Ensure coupon `atoms_owner_100` exists (create if missing).
2. Mint promo: random `OWNER-XXXXXX`, `max_redemptions=1`.
3. Reply with **code only** + redeem path: Subscribe monthly → Add promotion code.
4. Do not put the code in git, STATUS, or public docs.

### 2) Campaign: N free months, capped redemptions

```bash
stripe coupons create \
  -d percent_off=100 \
  -d duration=repeating \
  -d duration_in_months=3 \
  -d id=atoms_founding_3mo \
  -d name="Founding 3 months free"
stripe promotion_codes create \
  -d "promotion[type]=coupon" \
  -d "promotion[coupon]=atoms_founding_3mo" \
  -d code=FOUNDING \
  -d max_redemptions=100
```

### 3) Percent off first invoice / forever

```bash
# e.g. 50% off forever
stripe coupons create -d percent_off=50 -d duration=forever -d id=atoms_half_forever -d name="50% forever"
# then promotion_codes create as above
```

## Workflow every run

1. Confirm **live** vs test (default live for “prod Plus”).
2. Load `STRIPE_API_KEY` from Fly (never print).
3. List existing coupons/codes if reusing.
4. Create coupon only if needed; always create a **new** promo code for single-use grants.
5. Tell the human: code, max uses, coupon duration, **Subscribe not trial**.
6. Optional: after they redeem, `stripe promotion_codes retrieve promo_…` to confirm `times_redeemed`.

## Out of scope

- Plugin UI for promo entry (Checkout hosts the field)
- Env `ATOMS_PLUS_PROMOS` / `POST /v1/promo`
- Neon SQL grants
- Customer Portal promo toggle (Dashboard Billing → Customer portal, separate)
- Printing or rotating Fly Stripe secrets in chat

## Failure cheatsheet

| Symptom | Fix |
|---|---|
| `more_permissions_required` / `coupon_write` | Use Fly `sk_live` via `STRIPE_API_KEY`, not CLI `rk_live` |
| `Received unknown parameter: coupon` | Use `promotion[type]=coupon` + `promotion[coupon]=…` |
| Promo box missing on Checkout | Deploy plus-service with `allow_promotion_codes` (#454+) |
| Redeemed but still inactive after trial Checkout | They used Start trial — redo with **Subscribe** + new code if max=1 spent |
| Code works in test not prod | You used test keys; reload Fly live secret |
