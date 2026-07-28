# Atoms Plus — public launch checklist + go/no-go

**Date:** 2026-07-27 (updated 2026-07-28)  
**Issue:** #115  
**Host:** https://plus.tryatoms.app (Fly `atoms-plus`)  
**Mail from:** `Atoms Plus <plus@mail.tryatoms.app>` (Resend domain **verified**)  
**Plugin default:** `https://plus.tryatoms.app` (0.6.40+)  
**Pricing SSOT:** `plus-pricing.json`

> Canonical product domain: **tryatoms.app**. Do not use `mail.taihartman.com` or `onboarding@resend.dev`. Legacy `plus.taihartman.com` is deprecated (optional Fly cert remove later).

---

## Verdict (2026-07-28)

| Gate | Status | Evidence |
|------|--------|----------|
| API health | ✅ | `plus.tryatoms.app/health` |
| Prod boot | ✅ | postgres, dogfood off, publicBase tryatoms |
| DNS + TLS | ✅ | A/AAAA + Let’s Encrypt issued |
| Plugin default host | ✅ | 0.6.40 Release |
| Resend domain | ✅ | `mail.tryatoms.app` **verified**; only domain on account |
| Magic link API | ✅ | `POST /v1/auth/magic-link` → `{"ok":true}` from `plus@mail.tryatoms.app` |
| Second-inbox open | ⬜ human | Confirm mail landed (e.g. tai.piplup@gmail.com) |
| Stripe live | ❌ | Fly still `sk_test_`; no live webhook |
| Fly billing card | ⬜ human | https://fly.io/dashboard/personal/billing |
| Live Checkout + Process | ⬜ | blocked on Stripe live |

### Go / no-go

**NO-GO for strangers paying** until Stripe **live** + Fly billing.  
**Partial GO:** install + magic-link email on tryatoms brand works once second-inbox confirmed.

---

## Operator steps remaining

### Stripe live (human — full `sk_live_`)

1. Dashboard **Live** mode → products $6 / $60 / $2 (`atoms_plus_*` lookup keys)  
2. Webhook: `https://plus.tryatoms.app/v1/billing/webhook`  
   Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`  
3. `fly secrets set` live key, whsec, three price ids  

### Fly billing

https://fly.io/dashboard/personal/billing

### Optional cleanup

```bash
fly certs remove plus.taihartman.com -a atoms-plus   # after nothing points at it
```

---

## Verify commands

```bash
curl -sS https://plus.tryatoms.app/health
curl -sS -X POST https://plus.tryatoms.app/v1/auth/magic-link \
  -H 'content-type: application/json' \
  -d '{"email":"SECOND@inbox.com"}'
```

Cutover detail: `docs/runbooks/tryatoms-domain-cutover.md`
