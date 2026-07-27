# Atoms Plus — public launch checklist + go/no-go

**Date:** 2026-07-27  
**Issue:** #115  
**Host:** https://plus.taihartman.com (Fly app `atoms-plus`)  
**Plugin default (empty URL):** `https://plus.taihartman.com`  
**Pricing SSOT:** `plus-pricing.json` ($6/mo · $60/yr · $2 top-up · 150 filings · 14-day trial)

---

## Verdict (this session)

| Gate | Status | Evidence |
|------|--------|----------|
| API health | ✅ | `curl https://plus.taihartman.com/health` → `{"ok":true,"service":"atoms-plus"}` |
| Prod boot (Postgres, no dogfood) | ✅ | Fly logs: `env=production dogfoodAutoGrant=false stripe=true anthropic=true` · `publicBase=https://plus.taihartman.com` |
| DNS | ✅ | `plus.taihartman.com` → CNAME `atoms-plus.fly.dev` |
| Plugin code on master | ✅ | PR #92 merged; `DEFAULT_PLUS_BASE_URL` = taihartman host |
| BRAT / GitHub Release ships Plus | ❌ → fix with **0.6.31** | Release **0.6.30** tag = pre-#92 (person-hub only); `main.js` has **no** Plus default host |
| Resend → non-owner email | ❌ | `ATOMS_PLUS_EMAIL_FROM` = `Atoms Plus <onboarding@resend.dev>` (test-from; owner-only) |
| Stripe live money | ❌ | Fly `STRIPE_SECRET_KEY` = **`sk_test_…`**; live webhook list **empty**; live products for Plus **not** created (CLI key is `rk_live_` restricted) |
| Fly paid billing | ⬜ human | Org `personal`; add card at https://fly.io/dashboard/personal/billing |
| Second-email magic link | ⬜ blocked on Resend | |
| Live Checkout smoke | ⬜ blocked on Stripe live | |
| Process + meter (test_vault) | ⬜ after secrets | Operator dogfood OK on **test** Stripe earlier |

### Go / no-go

**NO-GO for strangers** until all of: Resend domain + second-email proof · Stripe live keys/prices/webhook on Fly · Release **0.6.31** on BRAT · Fly billing card.

**Partial GO for install path** once 0.6.31 is released: BRAT installs Plus UI + default host; auth/pay still operator-limited until Resend/Stripe live.

---

## Operator steps (human secrets)

Do in order. Do **not** paste secrets into chat/PRs.

### 1. Fly billing

1. Open https://fly.io/dashboard/personal/billing  
2. Add payment method so trial limits cannot stop `atoms-plus`  
3. Confirm app still healthy: `curl -sS https://plus.taihartman.com/health`

### 2. Resend — custom domain

1. Resend dashboard → Domains → add e.g. `taihartman.com` (or a subdomain you control)  
2. Add DNS records Resend shows (SPF/DKIM)  
3. Wait until domain **Verified**  
4. Create a **full** API key (send + domain read if you want CLI checks) — current Fly key is **send-only restricted**  
5. Set secrets (example from):

```bash
fly secrets set -a atoms-plus \
  ATOMS_PLUS_EMAIL_FROM='Atoms Plus <plus@taihartman.com>' \
  RESEND_API_KEY='re_…'
```

6. **Prove second email:**

```bash
curl -sS -X POST https://plus.taihartman.com/v1/auth/magic-link \
  -H 'content-type: application/json' \
  -d '{"email":"SECOND_INBOX@example.com"}'
```

Open link on that inbox → session lands → paste `sess_…` in plugin (test vault).

### 3. Stripe **live**

Local Stripe CLI only has **`rk_live_`** (cannot create products). Use Dashboard or a full **`sk_live_`** once.

**Create products/prices** (match `plus-pricing.json`):

| Kind | Amount | Type | lookup_key |
|------|--------|------|------------|
| monthly | 600 ($6) | recurring month | `atoms_plus_monthly` |
| yearly | 6000 ($60) | recurring year | `atoms_plus_yearly` |
| topup | 200 ($2) | one_time | `atoms_plus_topup` |

Test-mode reference prices (already exist; do not use on live Fly):

- monthly `price_1TvpO30U07CPvfLKIC47SGlE`
- yearly `price_1TvpO30U07CPvfLKyalrrjM7`
- topup `price_1TvpO30U07CPvfLKf5KAyagO`

**Live webhook** (none exist yet):

```text
URL: https://plus.taihartman.com/v1/billing/webhook
Events:
  checkout.session.completed
  invoice.paid
  customer.subscription.deleted
  customer.subscription.updated
```

Copy signing secret → `STRIPE_WEBHOOK_SECRET`.

**Fly secrets** (all live):

```bash
fly secrets set -a atoms-plus \
  STRIPE_SECRET_KEY='sk_live_…' \
  STRIPE_WEBHOOK_SECRET='whsec_…' \
  STRIPE_PRICE_MONTHLY='price_…' \
  STRIPE_PRICE_YEARLY='price_…' \
  STRIPE_PRICE_TOPUP='price_…'
```

**Smoke:** Settings → Start trial / Checkout with a real card (or Stripe live test carefully) → webhook grants trial/active → **Refresh status**.

Keep **test** webhook endpoint for a staging app if you still dogfood test mode; after live cutover, Fly must not keep `sk_test_`.

### 4. Release + BRAT

After **0.6.31** is on GitHub Releases (this PR):

1. Desktop: BRAT → `taihartman/obsidian-atoms` → Check for updates  
2. **Settings → Atoms → Version 0.6.31**  
3. Plus URL empty → uses `https://plus.taihartman.com`  
4. Phone: Sync after desktop BRAT update (or BRAT on mobile if used)

### 5. Process smoke (test_vault only)

Agents/humans: **not** Remote Vault.

1. Magic link + session on test vault  
2. Append a past-day capture bullet  
3. Process → atom + sentinel  
4. Refresh Plus status → remaining decremented  

```bash
curl -sS https://plus.taihartman.com/health
```

---

## Agent-verified facts (2026-07-27)

```text
fly secrets: RESEND, STRIPE_*, DATABASE_URL, ANTHROPIC, PUBLIC_BASE_URL, ATOMS_PLUS_* present
STRIPE_SECRET_KEY prefix on machine: sk_test_
ATOMS_PLUS_EMAIL_FROM: Atoms Plus <onboarding@resend.dev>
PUBLIC_BASE_URL: https://plus.taihartman.com
stripe webhook (test): https://plus.taihartman.com/v1/billing/webhook  enabled
stripe webhook (live): (none)
Release 0.6.30 tag commit: 9b3ac23 (person hub) — Plus merge a88a21d is AFTER tag
```

---

## When to flip to GO

Check every box:

- [ ] Fly billing card on personal org  
- [ ] Resend domain verified + non-`resend.dev` from-address on Fly  
- [ ] Magic link received on a **second** email  
- [ ] Fly Stripe secrets are **live** (`sk_live_`, live price ids, live `whsec_`)  
- [ ] Live webhook endpoint enabled on plus host  
- [ ] One live trial/Checkout completed; meter grants  
- [ ] GitHub Release **0.6.31** assets = post-#92 build  
- [ ] BRAT desktop shows Version 0.6.31  
- [ ] test_vault Process decrements remaining  

Then update this file’s verdict table to ✅ and note the date.

---

## Out of scope

Ask/MCP (#112), model bake-off, in-plugin chat, personal Remote Vault mutation.
