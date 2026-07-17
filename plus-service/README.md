# Atoms Plus service (U6 dogfood)

HTTP API for managed filing: magic-link auth, 150/period meter (**no rollover**), Anthropic proxy, dogfood checkout grants.

Matches plugin client paths in `src/platform/plusClient.ts`.

## Quick start

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

1. Plugin: **See Plans** still stubs checkout; for session:
2. `curl -s -X POST http://127.0.0.1:8787/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"you@example.com"}'`
3. Copy magic link from server console → open in browser → copy `sess_…`
4. Temporary: store session via plugin console or upcoming “paste session” dogfood field

Or use in-app exchange once Settings wires `exchangeMagicToken` after magic-link.

## API

| Method | Path | Auth |
|--------|------|------|
| POST | `/v1/auth/magic-link` | body `{ email }` |
| POST | `/v1/auth/exchange` | body `{ token }` → session |
| GET | `/v1/me` | Bearer session |
| POST | `/v1/classify` | Bearer; body `{ capture, context, messagesRequest }` |
| POST | `/v1/billing/checkout` | Bearer; `{ kind: start_trial\|subscribe_monthly\|subscribe_yearly\|topup_50 }` dogfood grants |
| POST | `/v1/promo` | Bearer; `{ code }` |

**402** when quota exhausted (no BYOK pitch in message).

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | Managed key (never sent to clients) |
| `ATOMS_PLUS_MODEL` | `claude-sonnet-5` | Forced model |
| `ATOMS_PLUS_INCLUDED` | `150` | Filings per period |
| `ATOMS_PLUS_TOPUP` | `50` | Top-up size |
| `DOGFOOD_AUTO_GRANT` | `1` | Grant period on first magic exchange |
| `PORT` | `8787` | Listen port |
| `ATOMS_PLUS_PROMOS` | `FOUNDING=2` | `CODE=months` |

Stripe price IDs reserved for later; dogfood checkout applies grants without Stripe.

## Tests

```bash
npm test
```

## Production notes

- Replace in-memory `store.mjs` with durable DB
- Send real magic-link email (Resend/Postmark)
- Wire Stripe Checkout + webhooks; disable `DOGFOOD_AUTO_GRANT`
- TLS reverse proxy; never log Authorization or Anthropic keys
