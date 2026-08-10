---
title: Open-source + Plus/Stripe production security review
date: 2026-08-10
scope: secrets exposure, Stripe, multi-key model, plus-service prod posture, plugin credential storage
live_host: https://plus.tryatoms.app
fly_app: atoms-plus
---

# Security review — open source + Stripe/Plus keys (2026-08-10)

**Question:** With the repo public and Stripe connected, can people reading the code (or calling the API) steal keys, mint free Plus, or read other users' atoms?

**Verdict:** **Production posture is sound for an open-source client + hosted Plus backend.** Secrets are not in the repo. Billing and Anthropic spend are enforced server-side. The multi-key split is correct. Residual risks are operational (rotate/runbook drift, session theft on-device) and known design limits (not zero-knowledge Ask mirror), not “open source = keys leaked.”

---

## 1. Trust model (what open source actually exposes)

| Surface | Public? | Contains secrets? |
|---------|---------|-------------------|
| GitHub source (`src/`, `plus-service/src/`, plans, runbooks) | Yes | **No** — only names of env vars and architecture |
| `plus-service/.env.example` | Yes | Placeholders only |
| Root / `plus-service/.env` | Local only | **Gitignored** (verified); not in `git ls-files` |
| Built `main.js` in releases | Yes | No operator keys; default Plus URL only |
| Fly image | Private registry | No baked secrets; `fly secrets` at runtime |
| Fly secret names (listable by operators) | Ops | Values never printed by this review |

**Open-source rule of thumb this repo already follows:** anything an attacker learns from the code must still require a secret that only lives in Fly / Stripe Dashboard / local SecretStorage.

---

## 2. Multi-key inventory (what each key is for)

| Secret | Where it lives | Who holds it | If leaked |
|--------|----------------|--------------|-----------|
| User Anthropic BYOK `sk-ant-…` | Device SecretStorage (or opt-in device-local fallback) — **never `data.json`** | End user | Their Anthropic bill only |
| Operator `ANTHROPIC_API_KEY` | Fly secret | You | Attacker spends **your** Anthropic budget via Plus if they also have a valid `sess_` + entitlement — key alone is not enough for `/v1/classify` (Bearer session required) |
| `STRIPE_SECRET_KEY` | Fly secret | You | Full Stripe API (refunds, customers). **Rotate immediately** if exposed |
| `STRIPE_WEBHOOK_SECRET` | Fly secret | You | Forge webhooks → free entitlements. Rotate + re-point Dashboard |
| `STRIPE_PRICE_*` | Fly secret (ids, not money keys) | You | Public-ish; wrong ids = wrong products, not silent free money if allowlist enforced |
| `RESEND_API_KEY` | Fly secret | You | Send as your domain |
| `DATABASE_URL` | Fly secret | You | Full customer DB (sessions hashes, encrypted mirror, emails) |
| `ATOMS_ASK_MIRROR_KEY` | Fly secret | You | Decrypt Ask mirror at rest; rotate = re-encrypt not automated |
| `ATOMS_PLUS_ALERT_EMAIL` | Fly secret | You | Ops inbox only |
| Plugin `sess_…` | Device localStorage (`atoms-plus-session`) — **never `data.json`** | End user device | Impersonate that Plus account until revoked/TTL |
| MCP `mcp_…` | Connector / OAuth tokens (hashed at rest) | Claude/ChatGPT hop | Read mirror + outbox enqueue for that email; **not** mirror wipe/upsert |

**Verified live (2026-08-10):** Fly `atoms-plus` has all of:  
`ATOMS_PLUS_ENV`, `ATOMS_PLUS_STORE`, `DATABASE_URL`, `DOGFOOD_AUTO_GRANT`, `STRIPE_DOGFOOD_CHECKOUT`, `PUBLIC_BASE_URL`, `ANTHROPIC_API_KEY`, three `STRIPE_PRICE_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ATOMS_PLUS_EMAIL_FROM`, `ATOMS_ASK_MIRROR_KEY`, `ATOMS_PLUS_ALERT_EMAIL`.

**Also baked non-secret in `fly.toml` `[env]`:**  
`ATOMS_PLUS_ENV=production`, `DOGFOOD_AUTO_GRANT=0`, `STRIPE_DOGFOOD_CHECKOUT=0`, `ATOMS_PLUS_STORE=postgres`, `force_https=true`.

---

## 3. Live black-box probes (no credentials)

| Probe | Result |
|-------|--------|
| `GET /health` | `{"ok":true,"service":"atoms-plus"}` — no secret/env dump |
| `GET /v1/me` + fake `sess_` | `401` `Invalid session` |
| `POST /v1/classify` empty | `400` (no free proxy) |
| `POST /mcp` empty | `401` |
| `POST /v1/billing/webhook` unsigned | `400` `Missing Stripe-Signature` |
| OAuth metadata | Public issuer `https://plus.tryatoms.app` — expected |

---

## 4. What the code already gets right

### 4.1 Production fail-closed (`prodGate.mjs`)

On `ATOMS_PLUS_ENV=production` (or `NODE_ENV=production`), boot refuses:

- dogfood auto-grant / dogfood checkout  
- missing Stripe secret + webhook + three prices  
- missing Anthropic, Resend, alert email, `DATABASE_URL`, `ATOMS_ASK_MIRROR_KEY`  
- `memory` / `sqlite` stores  
- localhost `PUBLIC_BASE_URL` / non-https  

Covered by `plus-service/test/prod-gate.test.mjs` + `security-meter.test.mjs`.

### 4.2 Stripe

- Webhook: HMAC-SHA256 over `t.rawBody`, `timingSafeEqual`, ±300s skew (`stripe.mjs` `constructEvent`)  
- Price allowlist before grant  
- Claim-before-grant event ids (no double mint on redelivery)  
- Unpaid checkout does **not** claim/grant  
- Email mismatch / missing email → incident, no grant  
- Checkout session binding so only the paying device’s soft session is re-verified after pay (C1 suite)  
- Class A/B/C incident recording + ops alert (#238)

### 4.3 Meter / Anthropic proxy

- Server `tryConsumeFiling` **before** Anthropic; client `remaining` is UX only  
- Client `messagesRequest` ignored; model/system/schema server-built (`buildClassifyPayload`)  
- Capture/context size caps; body size 413  
- Production requires `Idempotency-Key`  
- Cross-tenant idempotency isolation (C2)  
- Soft/unverified `sess_` cannot consume after entitlement (C1)

### 4.4 Auth tokens

- Sessions / magic tokens / MCP tokens **hashed at rest** (`hashToken` = SHA-256)  
- Magic link single-use + expiry; device verifier / PKCE-style binding (#240)  
- Audience split: `sess_` ↔ Plus HTTP; `mcp_` ↔ `/mcp` only  
- Soft start only for non-entitled accounts; entitled → magic link required  

### 4.5 Ask mirror

- Tenant email from session lookup, never body  
- Server path allowlist `assertMirrorPath` — `Atoms/*.md` + hub paths; rejects `..`, absolute, `\`, NUL (fixes 2026-07-27 critical finding)  
- AES-256-GCM at rest when key set; prod gate requires key  
- Wipe cancels in-flight expand jobs (body egress honesty)  
- Entitlement gate on mirror write/status  

### 4.6 Plugin / open client

- API key id in settings; value in SecretStorage / device-local — constitution non-negotiable #5  
- Plus session device-local (`LS_PLUS_SESSION`) — not vault-synced  
- Error paths redact `sk-ant-…`, `Bearer`, `sess_…`  
- Classify can use Plus Bearer **or** BYOK — never embeds operator key  

### 4.7 Build / deploy

- Dockerfile copies source + `plus-pricing.json` only; no `.env`  
- CI uses GitHub/Cloudflare secrets for Pages token only  
- Security regression suites: `security-meter.test.mjs`, `security-auth-criticals.test.mjs`, stripe/prod-gate/magic-link tests  

---

## 5. Findings (current)

### P0 — none observed in this pass

No committed live keys, no unauthenticated Anthropic proxy, no unsigned webhook grants, no dogfood path in `fly.toml` production env.

### P1 — residual / residual-ops

| ID | Sev | Finding | Why it matters | Mitigation status / action |
|----|-----|---------|----------------|----------------------------|
| R1 | P1 ops | **Runbook vs checklist drift on Stripe live.** `docs/runbooks/atoms-plus-prod.md` “Live secret snapshot” still says `sk_test` / no live webhook (2026-07-27). Checklist (2026-07-28) says live GO. | Operator could “fix” prod by re-applying test keys, or distrust live setup | **Fixed 2026-08-10** — snapshot + env block refreshed; human Checkout smoke still ⬜ |
| R2 | P1 design | **`sess_` is a bearer cookie-equivalent** (≤60d TTL). Stolen from device localStorage / backup / malware = full Plus + Ask for that email until revoke | Open clients cannot hide this | User sign-out revokes; magic-link re-issue revokes prior; consider shorter TTL or server-side “revoke all devices” UX if abuse appears |
| R3 | P1 design | **CORS `Access-Control-Allow-Origin: *`** on Plus API | Any website can call the API **if** it has a stolen `sess_`. No cookie CSRF (Bearer). Acceptable for Obsidian `requestUrl`/fetch | Do **not** switch to credentialed cookies without tightening origin; keep Bearer |
| R4 | P2 | **In-process rate limits** (`ratelimit.mjs`). Documented: XFF forgeable; multi-instance multiplies ceiling. Fly currently 1 started machine (+1 stopped) | Limits are a volume brake, not auth | Already documented honestly in code; billing SoT is meter + Stripe, not RL |
| R5 | P2 | **Ask mirror is not zero-knowledge.** Host decrypts for search/MCP; expand sends body plaintext to Anthropic | Privacy, not key theft | Privacy ack versioning already forces re-consent; keep copy honest |
| R6 | P2 | **Hub path allowlist is wider than `Atoms/`** (linked hubs). Compromised client with valid `sess_` can upsert allowed hub shapes | Bounded by path regex + entitlement | Keep client planner strict; server already fail-closed on junk paths |
| R7 | P2 docs | **`ATOMS_PLUS_ALERT_EMAIL` required by prod gate** but omitted from runbook env block | Fresh deploy might miss ops alerts | **Fixed 2026-08-10** — env block, `fly secrets set` example, `.env.example` |
| R8 | P2 marketing site | **Notes unsubscribe HMAC** falls back to `RESEND_API_KEY` then literal `"dev"` if secrets missing | Forged unsub tokens if Pages env incomplete | Ensure `ATOMS_NOTES_UNSUB_SECRET` set on Cloudflare Pages; never ship with empty Resend |
| R9 | P3 | **Default `DOGFOOD_AUTO_GRANT=1` in code** when env unset | Safe only because production gate + fly.toml force `0` | Never deploy without `ATOMS_PLUS_ENV=production`; gate already exits 1 |
| R10 | P3 | No machine-readable **security access matrix** (`docs/security/`) | Drift between reviews and code over time | Optional bootstrap of security-contract later; existing U9/C1/C2 tests carry load today |

### Explicit non-findings (often asked)

- **“People can see the Stripe code so they can forge payments”** — No. Grants require Stripe-signed webhooks + allowlisted price ids + durable event claim.  
- **“People can see how classify works so they free-ride Anthropic”** — No. Proxy needs verified entitled `sess_` and server meter.  
- **“BYOK key is in the open-source plugin”** — No. Only storage **mechanism**; value never ships in the repo.  
- **“main.js hides a sk_live”** — Grep of tracked sources found only test placeholders / docs ellipses, not live secrets.

---

## 6. Operator checklist (do these, then sleep)

1. **Stripe Dashboard (Live):** webhook endpoint `https://plus.tryatoms.app/v1/billing/webhook` enabled; events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`; signing secret matches Fly `STRIPE_WEBHOOK_SECRET`.  
2. **Confirm Fly digests still match** after any Dashboard secret rotate (`fly secrets list -a atoms-plus`).  
3. **One live Checkout + Process smoke** (checklist still had this open as of 2026-07-28).  
4. **Never commit** `.env`, Stripe CLI webhook secrets, or `fly secrets` dumps into issues/PRs.  
5. **Rotate immediately** if a secret ever hits chat, CI logs, or a screenshot: Stripe → Anthropic → Resend → `ATOMS_ASK_MIRROR_KEY` (plan re-encrypt) → DB credentials.  
6. **Refresh** `docs/runbooks/atoms-plus-prod.md` live snapshot so it cannot send a future you back to test mode.  
7. **Cloudflare Pages:** `RESEND_API_KEY` + dedicated `ATOMS_NOTES_UNSUB_SECRET` for Field notes.  

---

## 7. If you only remember three things

1. **Open source is safe here because secrets are runtime-only (Fly / device), not source-only.**  
2. **Money and model spend are server-enforced** (Stripe signature + meter + server-built classify). Client forgeries of `remaining` only change UX until 402.  
3. **The real residual threat is a stolen device `sess_` or a leaked Fly secret** — not a stranger reading GitHub.

---

## 8. Evidence pointers (live code)

- Prod gate: `plus-service/src/prodGate.mjs`  
- Config / key names: `plus-service/src/config.mjs`  
- Stripe verify + grant: `plus-service/src/stripe.mjs`  
- Classify + webhook routes: `plus-service/src/server.mjs`  
- Mirror path allowlist: `plus-service/src/store/askHelpers.mjs` `assertMirrorPath`  
- Mirror crypto: `plus-service/src/mirror/crypto.mjs`  
- Plugin session/key storage: `src/platform/filingAuth.ts`, `src/plugin/main.ts` `getApiKey`  
- Prior reviews: `docs/qa/2026-07-22-atoms-plus-meter-security-review.md`, `docs/qa/2026-07-27-ask-mirror-sync-security-review.md`  
- Deploy: `plus-service/fly.toml`, `docs/runbooks/atoms-plus-prod.md`  

---

*Review method: live code + Fly secret **names** + external HTTP probes. Secret **values** were never read or printed.*
