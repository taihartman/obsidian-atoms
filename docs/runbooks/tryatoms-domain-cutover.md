# tryatoms.app — Plus domain cutover

**Domain:** `tryatoms.app`  
**API:** `https://plus.tryatoms.app`  
**Mail from:** `Atoms Plus <plus@mail.tryatoms.app>`  
**Fly app:** `atoms-plus`

## 1. Cloudflare DNS (tryatoms.app zone)

| Type | Name | Content | Proxy |
|------|------|---------|--------|
| CNAME | `plus` | `atoms-plus.fly.dev` | **DNS only** (grey) |
| — | Resend records for `mail.tryatoms.app` | as Resend shows | **DNS only** |

Fly also accepts A/AAAA instead of CNAME:

```text
A     plus → 66.241.124.58
AAAA  plus → 2a09:8280:1::153:556c:0
```

(Confirm current IPs: `fly ips list -a atoms-plus`.)

## 2. Fly TLS

```bash
fly certs add plus.tryatoms.app -a atoms-plus   # already requested
fly certs check plus.tryatoms.app -a atoms-plus
```

## 3. Resend

1. Add domain `mail.tryatoms.app`  
2. Add DNS → Verified  
3. Secrets:

```bash
fly secrets set -a atoms-plus \
  PUBLIC_BASE_URL='https://plus.tryatoms.app' \
  ATOMS_PLUS_EMAIL_FROM='Atoms Plus <plus@mail.tryatoms.app>' \
  RESEND_API_KEY='re_…'   # production key
```

## 4. Stripe webhook (test now; live when ready)

```text
https://plus.tryatoms.app/v1/billing/webhook
```

## 5. Plugin

Default empty URL → `https://plus.tryatoms.app` (release **0.6.40+**).  
BRAT update after GitHub Release.

## 6. Verify

```bash
curl -sS https://plus.tryatoms.app/health
curl -sS -X POST https://plus.tryatoms.app/v1/auth/magic-link \
  -H 'content-type: application/json' \
  -d '{"email":"SECOND@inbox.com"}'
```

Legacy: remove `plus.taihartman.com` Fly cert when unused. **Mail:** only `mail.tryatoms.app` on Resend (taihartman mail domain deleted 2026-07-28).
