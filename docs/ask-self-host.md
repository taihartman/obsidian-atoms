# Self-host Atoms Ask (DIY)

Run **your own** Atoms Plus service so Claude, ChatGPT, or Grok can Ask your atoms without a hosted Plus bill, and without sending that traffic to `plus.tryatoms.app`.

This page is for advanced, non-Plus users. Hosted Plus is still the usual path: sign in under Settings → Atoms, turn on Ask, connect to `https://plus.tryatoms.app/mcp`.

Grounded in what the code does today. Not a roadmap.

---

## Status

| | Hosted Plus | DIY (this doc) |
|---|---|---|
| Who runs `plus-service` | Atoms (`plus.tryatoms.app`) | You |
| Entitlement | Stripe trial / paid | Local dogfood grant (`DOGFOOD_AUTO_GRANT=1`) |
| Plugin URL | empty override → production | **Advanced → Plus service URL override** |
| MCP auth | OAuth → `mcp_*` | Same code path against your base URL |
| MCP scopes | `atoms:read` + `atoms:write` (Allow grants both) | Same |
| Mirror data | Plus DB | Your store (use **sqlite**) |
| Claude / ChatGPT | Public host | **Public HTTPS** origin (required) |

---

## What this is / is not

**IS**

- Run the monorepo `plus-service` binary yourself
- Point the plugin at that base URL **before** any sign-in, so it never hits production
- Dogfood entitlement so Ask works without Stripe
- OAuth MCP for **Claude and ChatGPT** on the same `{base}/mcp` URL

**IS NOT**

- Authless `/mcp` (unauthenticated POST → **401**)
- A static bearer / shared API key for the connector
- Tools reading a live `Atoms/` folder (they read the **DB mirror only**)
- Free use of `plus.tryatoms.app` without Plus
- A one-command packaged binary
- Agent Local REST MCP (`docs/dev-obsidian-mcp.md`)

Do not configure a folder + static-bearer DIY. That is not in the code.

---

## Public HTTPS is required

Claude and ChatGPT custom connectors call your MCP URL **from their cloud**, not from your laptop. `http://127.0.0.1:8787/mcp` will fail in Claude and in ChatGPT.

Loopback is valid only as an OAuth *redirect* (Claude Code), not as the MCP server URL.

So:

| Who | URL they may use |
|---|---|
| `plus-service` listen address | `http://127.0.0.1:8787` |
| Tunnel target | that same listen address |
| `PUBLIC_BASE_URL` | the **public HTTPS origin** the tunnel prints |
| Plugin **Plus service URL override** | that **same** public origin (no `/mcp`) |
| URL you paste into Claude / ChatGPT | `{that origin}/mcp` |

Those three public values must match. Restart `plus-service` after you set `PUBLIC_BASE_URL`.

---

## Architecture

```
Obsidian plugin
  Bearer sess_*  →  POST /v1/ask/mirror/* , /v1/ask/outbox/*
                 →  DB atom_mirror + ask_outbox

Claude / ChatGPT connector
  OAuth (magic-link or pairing code + consent) → mcp_* access token
  Bearer mcp_*  →  POST /mcp  (Streamable HTTP)
                 →  store.mirror* + outbox enqueue only
```

| Token | Who mints it | Used for |
|-------|----------------|----------|
| `sess_…` | Magic-link exchange (plugin / browser) | Mirror upsert/delete/reconcile, outbox pull/ack, wipe |
| `mcp_…` | OAuth code exchange after connector consent | MCP tools only |

- `sess_` on `/mcp` → **401**. Do not paste the plugin session into the connector.
- `mcp_` on Plus mirror routes → **401**.
- MCP never opens vault files. An empty mirror means you have not run **Sync now**.

---

## Prerequisites

- **Node.js ≥ 20** (`plus-service/package.json` engines)
- This repo (or at least `plus-service/`) and `npm install` inside `plus-service`
- Obsidian + Atoms **0.7.8+** (Settings → **Advanced** has the URL override and the DIY guide link)
- A public **HTTPS** tunnel to your listen port (Cloudflare Tunnel, ngrok, or a VPS with TLS)

---

## 1. Run the service

```bash
cd plus-service
npm install
export DOGFOOD_AUTO_GRANT=1
export ATOMS_PLUS_STORE=sqlite
export ATOMS_PLUS_DATABASE_PATH=./data/plus.sqlite
# set this after the tunnel prints an origin; restart after you change it
export PUBLIC_BASE_URL=http://127.0.0.1:8787
npm start
# listen: http://127.0.0.1:8787
```

`ANTHROPIC_API_KEY` is required for Plus **classify** and for search expansion. Ask-only DIY can omit it. Filing on the device still uses the plugin API key you already have.

Bring the tunnel up, copy the `https://…` origin it prints, set `PUBLIC_BASE_URL` to that origin with **no path**, restart `plus-service`.

Example:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
# then, in the service shell:
export PUBLIC_BASE_URL=https://YOUR-SUBDOMAIN.trycloudflare.com
# restart npm start
```

### Env that matters

| Variable | Default | Notes |
|----------|---------|--------|
| `PORT` | `8787` | Listen port |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:$PORT` | OAuth issuer + magic links + MCP resource. Must match the origin Claude/ChatGPT use. |
| `DOGFOOD_AUTO_GRANT` | on (unless `"0"`) | First magic-link exchange can grant `trialing` when the account was inactive |
| `DOGFOOD_GRANT_STATUS` | `trialing` | Status written by that grant |
| `ATOMS_PLUS_STORE` | `memory` | Use **`sqlite`** so a restart does not wipe the mirror |
| `ATOMS_PLUS_DATABASE_PATH` | `plus-service/data/plus.sqlite` | When store is sqlite |
| `ATOMS_ASK_MIRROR_KEY` | empty → `plain:` bodies | 64-hex or passphrase; AES-GCM `v1:` when set. Set this if anyone else can read the DB. |

Copy-paste template: `plus-service/.env.example`.

---

## 2. Point the plugin at your service

Do this **before** any sign-in so the plugin never talks to production.

**Settings → Atoms → Advanced → Plus service URL override** = your public origin, e.g. `https://YOUR-SUBDOMAIN.trycloudflare.com`.

Leave it empty only for hosted production (`https://plus.tryatoms.app`).

The same Advanced screen has **DIY Ask guide**, which opens this page.

---

## 3. Sign in to *your* service

You need a session whose status is `active` or `trialing`. Ask refuses `inactive`.

**Magic link (preferred on DIY)**

1. Settings → **Set up automatic filing** → **Sign in with a link** → your email → **Send sign-in link**
2. Or: `curl -s -X POST http://127.0.0.1:8787/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"you@example.com"}'`
3. Copy the link from the **server console** (`[plus] magic link for …`). Resend is unset, so nothing is emailed.
4. Open the link. The page says signed in. Return to Obsidian.
5. If Obsidian does not pick it up: landing page shows a `sess_…` token → Settings → **Set up automatic filing** → **Advanced: paste session** → **Save session**

`DOGFOOD_AUTO_GRANT=1` grants `trialing` on that first exchange.

**Start free trial (also works locally)**

Settings → **Set up automatic filing** → **Email** → **Start free trial**. The plugin still says a card is required (that is the hosted path). Against a local service with no Stripe keys, checkout **instant-grants** trial and the browser says “You’re set.” Then **Refresh status**.

---

## 4. Enable Ask and sync

1. Settings → **Ask** → accept the privacy sheet → turn on **Ask mirror**
2. Optional: **Allow filing from Claude or ChatGPT** (outbox create/continue)
3. Open **Connect Claude, ChatGPT, or Grok**
4. **Sync now** — push flat `Atoms/*.md` into your mirror DB
5. **MCP connector URL** → **Copy**. It must be `https://YOUR-ORIGIN/mcp`, not localhost.
6. Optional: **Get pairing code** if the OAuth browser cannot complete the magic link on your Plus email

---

## 5. Add the connector

Paste the copied MCP URL. Complete OAuth (email + magic link, or the pairing code). Do **not** paste `sess_`.

**Claude** (Pro / Max): [Customize → Connectors](https://claude.ai/customize/connectors) → **+** → **Add custom connector** → paste the URL → Add. Enable it in a chat from **+** → Connectors.

Claude Team / Enterprise: an Owner adds it first under Organization settings → Connectors → Add → Custom → Web.

**ChatGPT:** Settings → **Apps** → **Advanced settings** → turn on Developer mode, then **Apps → Create**, paste the URL, choose OAuth, complete sign-in. Pro can use read/fetch this way. Full write MCP is on Business / Enterprise / Edu.

**Grok:** grok.com/connectors → **New Connector** → **Custom**, paste the URL, complete sign-in.

If authorize fails with `resource must be …` or `redirect_uri not allowed`, `PUBLIC_BASE_URL` does not match the URL the client is using, or the redirect is not on the allowlist (Claude `https://claude.ai/api/mcp/auth_callback`, ChatGPT `https://chatgpt.com/connector/oauth/…` or the legacy redirect, Grok exact `https://grok.com/connectors-oauth-exchange-code/`, or loopback `/callback`).

---

## Auth model

- Mirror mutate / outbox apply: **`sess_`** + account **`active` or `trialing`** (wipe is allowed without entitlement so you can always delete the copy).
- MCP tools: **`mcp_`** from OAuth; same entitlement gate.
- Keep development env and `DOGFOOD_AUTO_GRANT=1`. Do not set `ATOMS_PLUS_ENV=production` unless you have the full hosted operator secrets.

---

## Production self-host (prodGate)

`ATOMS_PLUS_ENV=production` or `NODE_ENV=production` fail-closes unless Stripe, Resend, managed Postgres, public HTTPS `PUBLIC_BASE_URL`, `ATOMS_ASK_MIRROR_KEY`, and `DOGFOOD_AUTO_GRANT=0` are all set. See `plus-service/src/prodGate.mjs` and [`docs/runbooks/atoms-plus-prod.md`](runbooks/atoms-plus-prod.md).

Personal DIY does **not** need that. Development + dogfood + sqlite is the path.

---

## Security / privacy / wipe

- Only flat **`Atoms/*.md`** leave the device (not dailies, not the rest of the vault).
- Mirror bodies live in **your** store. With `ATOMS_ASK_MIRROR_KEY` they are AES-GCM (`v1:`). Without a key, local/dev uses `plain:`.
- This is **not** zero-knowledge. The assistant you connect receives tool results in its chat context.
- **Wipe cloud copy** (Connect screen) deletes mirror rows, outbox, and MCP tokens for that account. Turning Ask off does not wipe.
- **Search expansion** is on by default (`ASK_EXPAND_ENABLED=1`) since 0.6.87. It only spends if `ANTHROPIC_API_KEY` is set on the service. Set `ASK_EXPAND_ENABLED=0` to turn it off. Expansion text is never returned on MCP payloads.
- **Sync now** can delete cloud paths missing from **this** vault. Do not force-sync from an incomplete second device.

---

## Not supported

- Authless MCP
- Static bearer / long-lived shared API key for connectors
- Pointing tools at a live `Atoms/` folder
- Using plugin `sess_` as the Claude/ChatGPT connector secret
- Free hosted `plus.tryatoms.app` Ask without Plus
- Hubs outside `Atoms/` or daily notes in the mirror
- Mirror → vault reverse body sync
- In-plugin chat UI
- Pasting `http://127.0.0.1:…/mcp` into Claude, ChatGPT, or Grok

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Claude / ChatGPT cannot add the connector | You pasted localhost. Use the public HTTPS `/mcp` URL. |
| `POST /mcp` → 401 | Missing Bearer, wrong token, or `sess_` used as MCP credential |
| Mirror 401 Invalid session | Bad/expired `sess_`, or `mcp_` on Plus routes |
| 403 Plus entitlement required | Account not `active`/`trialing` |
| OAuth resource / redirect errors | `PUBLIC_BASE_URL` ≠ origin the client uses |
| Tool says mirror empty | Ask mirror off, or never **Sync now** |
| Lost session/mirror after restart | Default `memory` store. Use sqlite. |
| Status stuck inactive | Need **Refresh status**; confirm the override hits *your* service |
| Decrypt errors after restart | Rows encrypted with a key you no longer set |
| Prod boot exits immediately | Production gate. DIY should not set `ATOMS_PLUS_ENV=production`. |
| `outbox_full` / pending never files | Obsidian open with **Allow filing** |
| Rate limited | ~30/min on mirror and write tools |
| `npm start` module errors | `npm install` in `plus-service/` first; Node ≥ 20 |

Sanity checks (against the listen address, not the tunnel):

```bash
curl -s http://127.0.0.1:8787/health
# development includes extra fields; look for "ok":true and "service":"atoms-plus"

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/mcp
# → 401
```

---

## Related

- [`plus-service/README.md`](../plus-service/README.md) — dogfood start, store modes, Stripe
- [`plus-service/.env.example`](../plus-service/.env.example) — env template
- [`docs/runbooks/atoms-plus-prod.md`](runbooks/atoms-plus-prod.md) — hosted/prod operator
- [`docs/architecture.md`](architecture.md) — Ask mirror sync invariants
- [`CONCEPTS.md`](../CONCEPTS.md) — Atoms Ask, Remote MCP vocabulary
- [`docs/dev-obsidian-mcp.md`](dev-obsidian-mcp.md) — **not** this product
- Hosted MCP: `https://plus.tryatoms.app/mcp`
