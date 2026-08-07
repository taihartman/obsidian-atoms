# Self-host Atoms Ask (DIY)

Honest guide for running **your own** Atoms Plus service so Claude / ChatGPT can Ask your brain without a hosted Plus bill. Grounded in what the code does today — not a roadmap.

**Primary product path remains hosted Plus:** sign in at Settings → Atoms Plus, enable Ask, connect to `https://plus.tryatoms.app/mcp`. Use this page only if you want to operate the stack yourself.

Issue: [#120](https://github.com/taihartman/obsidian-atoms/issues/120).

---

## Status — what works today vs hosted Plus

| | Hosted Plus | DIY self-host (this doc) |
|---|---|---|
| Who runs `plus-service` | Atoms (`plus.tryatoms.app`) | You |
| Entitlement | Stripe trial / paid | Local dogfood grant (`DOGFOOD_AUTO_GRANT=1`) or your own Stripe |
| Plugin URL | empty override → production | **Development → Plus service URL override** |
| MCP auth | OAuth magic-link → `mcp_*` | Same code path against your base URL |
| MCP scopes | `atoms:read` + `atoms:write` (consent Allow grants both) | Same |
| Mirror data | Plus DB | Your store (memory / sqlite / postgres) |
| Phone Claude | Works on public host | Needs **public HTTPS** tunnel + matching `PUBLIC_BASE_URL` |

---

## What this is / is not

**IS**

- Run the monorepo `plus-service` binary yourself
- Point the plugin at that base URL (Plus session + Ask mirror + MCP)
- Dogfood entitlement so Ask works without Stripe
- OAuth MCP for **Claude and ChatGPT** (same `{base}/mcp` URL)
- Optional durable sqlite (or full postgres) for the mirror DB

**IS NOT**

- Authless `/mcp` (unauthenticated POST → **401**)
- Static bearer / shared API key for the connector
- Live vault / `Atoms/` folder filesystem backend (tools read the **DB mirror only**)
- Free use of `plus.tryatoms.app` without Plus entitlement
- One-command packaged DIY binary
- Agent Local REST MCP (`docs/dev-obsidian-mcp.md`) — that is **dev tooling**, not product Ask

Plan notes about “folder + static bearer DIY” are **intent only**, not implemented. Do not configure what is not in code.

---

## Architecture (short)

```
Obsidian plugin
  Bearer sess_*  →  POST /v1/ask/mirror/* , /v1/ask/outbox/*
                 →  DB atom_mirror + ask_outbox

Claude / ChatGPT connector
  OAuth (magic-link + consent) → mcp_* access token
  Bearer mcp_*  →  POST /mcp  (Streamable HTTP)
                 →  store.mirror* + outbox enqueue only
```

| Token | Who mints it | Used for |
|-------|----------------|----------|
| `sess_…` | Magic-link exchange (plugin / browser) | Mirror upsert/delete/reconcile, outbox pull/ack, wipe |
| `mcp_…` | OAuth code exchange after connector consent | MCP tools only |

- `sess_` on `/mcp` → **401** (not a connector credential).
- `mcp_` on Plus mirror routes → **401**.
- MCP never opens your vault files; empty mirror returns a hint to **Settings → Ask → Sync now**.

---

## Prerequisites

- **Node.js ≥ 20** (`plus-service/package.json` engines)
- Clone of this repo (or at least `plus-service/`) and `npm install` inside `plus-service`
- Obsidian + Atoms plugin build that includes Ask + **Development → Plus service URL override**
- For desktop-only Claude/ChatGPT with loopback OAuth: local `http://127.0.0.1:8787` can work
- For **phone** Claude (or any non-loopback client): a public **HTTPS** URL (Cloudflare Tunnel, ngrok, etc.) that reaches your service

---

## Minimal local run

```bash
cd plus-service
npm install
export DOGFOOD_AUTO_GRANT=1
export PUBLIC_BASE_URL=http://127.0.0.1:8787
# Prefer sqlite so sessions + mirror survive restart (memory is default / ephemeral):
export ATOMS_PLUS_STORE=sqlite
export ATOMS_PLUS_DATABASE_PATH=./data/plus.sqlite
# optional at-rest encryption for mirror bodies:
# export ATOMS_ASK_MIRROR_KEY="$(openssl rand -hex 32)"
npm start
# → http://127.0.0.1:8787
```

`ANTHROPIC_API_KEY` is required for Plus **classify** filing and for production gate — **not** for MCP tools. Ask-only DIY can omit it in development.

### Env that matters for Ask DIY

| Variable | Default | Notes |
|----------|---------|--------|
| `PORT` | `8787` | Listen port |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:$PORT` | OAuth issuer + magic links + MCP resource. **Must match** the URL clients use (tunnel HTTPS on phone). |
| `DOGFOOD_AUTO_GRANT` | on (unless `"0"`) | Magic-link exchange can grant `trialing` when account was inactive |
| `DOGFOOD_GRANT_STATUS` | `trialing` | Status written by that grant |
| `ATOMS_PLUS_STORE` | `memory` | Use **`sqlite`** for real DIY; `memory` wipes on process exit |
| `ATOMS_PLUS_DATABASE_PATH` | `plus-service/data/plus.sqlite` | When store is sqlite |
| `DATABASE_URL` | — | Postgres (required if store is postgres / real prod) |
| `ATOMS_ASK_MIRROR_KEY` | empty → `plain:` bodies | 64-hex or passphrase; AES-GCM `v1:` when set. Required in production gate. |

Copy-paste template: `plus-service/.env.example`. Full Plus dogfood (classify, Stripe): `plus-service/README.md`.

---

## Plugin wiring

Do this **in order**. Set the URL override **before** any sign-in so the plugin never hits production by mistake.

### 1. Point the plugin at your service

**Development → Plus service URL override** = your base, e.g. `http://127.0.0.1:8787` or `https://your-tunnel.example`.  
Leave empty for hosted production (`https://plus.tryatoms.app`).

### 2. Get a Plus session with entitlement (`active` or `trialing`)

Hosted UI is Stripe-first. On a **local dogfood** service (no Stripe keys, default dogfood checkout allowed), either path works:

**A — Start free trial (simplest local)**

1. Settings → **Atoms Plus** → email → **Start free trial**
2. Plugin opens checkout; without Stripe the service **instant-grants** trial and returns a browser “You’re set” page
3. Back in Obsidian → **Refresh status** until status is trial/active (not inactive)

**B — Magic link (no Resend)**

1. **Sign in on another device** → email → **Send sign-in link**  
   Or: `curl -s -X POST http://127.0.0.1:8787/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"you@example.com"}'`
2. Copy the link from the **server console** (printed when `RESEND_API_KEY` is unset)
3. Open it → page says signed in; return to Obsidian → **Refresh status**
4. Only if Refresh fails: landing page **Advanced: session token** → Settings → **Advanced: paste session** → **Save session**

`DOGFOOD_AUTO_GRANT=1` grants `trialing` on magic exchange when the account was inactive. Ask/MCP refuse accounts that stay `inactive`.

### 3. Enable Ask and sync

1. **Ask (Claude + ChatGPT)**  
   - Privacy acknowledgment  
   - **Enable Ask mirror**  
   - Optional: **Allow filing from Claude or ChatGPT** (outbox create/continue)  
2. **Sync now** — push flat `Atoms/*.md` into the mirror DB  
3. **MCP connector URL** → **Copy** (`{plusBase}/mcp`)  
4. In Claude or ChatGPT, add a connector / custom MCP to that URL and complete **OAuth** (email + magic link + consent). Do **not** paste `sess_` into the connector.

Status / wipe / cloud mirror refresh stay on the same Settings section as hosted Ask.

---

## Public tunnel for phone Claude

Phone clients cannot reach `127.0.0.1` on your laptop. You need:

1. A tunnel that terminates **HTTPS** to your local `PORT`.
2. `PUBLIC_BASE_URL` set to that **exact** public origin (no path), e.g. `https://abc.trycloudflare.com`.
3. Plugin **Plus service URL override** set to the same origin.
4. Restart `plus-service` after changing `PUBLIC_BASE_URL` (OAuth metadata and resource checks use it).
5. Re-copy MCP URL and reconnect the phone client if the base changed.

OAuth requires:

- `resource` = `{PUBLIC_BASE_URL}/mcp`
- Redirect URI on the built-in allowlist (Claude callback, ChatGPT connector redirects, or loopback `http(s)://127.0.0.1|localhost|[::1]/callback`)

Mismatch → authorize failures (`resource must be …`, `redirect_uri not allowed`).

---

## Optional: seed fixtures

From `plus-service` with a valid Plus session:

```bash
cd plus-service
PLUS_SESSION=sess_… npm run ask:seed
# or PLUS_EMAIL=… PLUS_MAGIC_TOKEN=mt_…
```

Upserts `fixtures/ask-atoms/*.md` into the mirror for empty-vault connector tests. Not a substitute for syncing your real vault.

---

## Auth model (`sess_` vs `mcp_`; active|trialing)

- Mirror mutate / outbox apply: **`sess_`** + account **`active` or `trialing`** (wipe allowed without entitlement so you can always delete cloud copy).
- MCP tools: **`mcp_`** from OAuth; same **active|trialing** gate; unauth or `sess_` → **401** + `WWW-Authenticate` pointing at OAuth protected-resource metadata.
- DIY free of Stripe: keep **development** env and `DOGFOOD_AUTO_GRANT=1` so first login is `trialing`.
- Scope advertised as `atoms:read`; write tools still exist under Allow filing + outbox (same as hosted).

---

## Production self-host (prodGate) — advanced, not free DIY

If you set `ATOMS_PLUS_ENV=production` or `NODE_ENV=production`, boot **fail-closes** unless Stripe, Resend, managed Postgres, public HTTPS `PUBLIC_BASE_URL`, `ATOMS_ASK_MIRROR_KEY`, and `DOGFOOD_AUTO_GRANT=0` (and related) are all set. See `plus-service/src/prodGate.mjs` and [`docs/runbooks/atoms-plus-prod.md`](runbooks/atoms-plus-prod.md).

Personal DIY Ask does **not** need that shape: run development + dogfood + sqlite (optional). Full production gate is the hosted-operator checklist, not the minimal free path.

---

## Security / privacy / wipe

- Only flat **`Atoms/*.md`** leave the device for Ask (not dailies, not full vault).
- Mirror bodies live in **your** store; with `ATOMS_ASK_MIRROR_KEY` they are AES-GCM at rest (`v1:`). Without a key, local/dev uses `plain:` — fine for throwaway dogfood, not for a shared host.
- This is **not** zero-knowledge: anyone with the DB and key (or plaintext mode) can read bodies. Claude/ChatGPT receive tool results in their chat context.
- **Wipe cloud copy** (Settings) deletes mirror rows (including encrypted search-expansion phrases), outbox, and MCP tokens for that account. Turning Ask off does **not** wipe.
- **Search expansion:** **on by default since 0.6.87** — set `ASK_EXPAND_ENABLED=0` to turn it off. When on *and* `ANTHROPIC_API_KEY` is set, Plus may send title/tags/body slices to Anthropic on mirror upsert to build encrypted expansion phrases for `search_atoms`. This is the only Ask path that sends body **plaintext** off-device; clause (4) of the Ask privacy disclosure names it, and `ASK_PRIVACY_ACK_VERSION` re-prompts every device that only ever agreed to the older wording. A deployment with no `ANTHROPIC_API_KEY` is inert whatever the flag says, and keeps pure lexical search. Expansion text is never returned on MCP payloads. Note the spend caps (`ASK_EXPAND_CONCURRENCY`, `ASK_EXPAND_PER_EMAIL_PER_HOUR`, `ASK_EXPAND_PER_UPSERT_CAP`) are **per process**, so running N replicas gives you N× each of them.
- Multi-device: **Sync now** can remove cloud paths missing from **this** vault’s full `keepPaths` — don’t force-sync from an incomplete secondary vault.

---

## NOT supported

- Authless MCP  
- Static bearer / long-lived shared API key for connectors  
- Pointing tools at a live `Atoms/` folder on disk  
- Using plugin `sess_` as the Claude/ChatGPT connector secret  
- Free hosted `plus.tryatoms.app` Ask without Plus trial/paid  
- Hubs outside `Atoms/` or daily notes in the mirror  
- Mirror → vault reverse body sync  
- In-plugin chat UI  

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `POST /mcp` → 401 | Missing Bearer, wrong token, or `sess_` used as MCP credential — complete OAuth for `mcp_` |
| Mirror 401 Invalid session | Bad/expired `sess_`, or `mcp_` on Plus routes |
| 403 Plus entitlement required | Account not `active`/`trialing` — enable dogfood grant or Stripe |
| OAuth “Plus required” | Same entitlement gate at consent |
| OAuth resource / redirect errors | `PUBLIC_BASE_URL` ≠ URL client uses; or redirect not allowlisted |
| Tool says mirror empty | Never synced — Enable Ask + **Sync now** |
| Lost session/mirror after restart | Default `memory` store — use `ATOMS_PLUS_STORE=sqlite` |
| Status stuck inactive after trial click | Dogfood grant needs **Refresh status**; confirm override URL hits your service |
| Phone cannot connect | Still on localhost; need HTTPS tunnel + matching override + restart |
| Decrypt errors after restart | Rows encrypted with a key you no longer set (`ATOMS_ASK_MIRROR_KEY`) |
| Prod boot exits immediately | Production gate — see runbook; DIY should not set `ATOMS_PLUS_ENV=production` without full secrets |
| `outbox_full` / pending never files | Open Obsidian with **Allow filing**; ack path needs plugin online |
| Rate limited | ~30/min on mirror and write tools |
| `npm start` module errors | Run `npm install` in `plus-service/` first; Node ≥ 20 |

Sanity checks:

```bash
curl -s http://127.0.0.1:8787/health
# → {"ok":true,"service":"atoms-plus"}

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
- [`docs/dev-obsidian-mcp.md`](dev-obsidian-mcp.md) — **not** this product (agent Local REST only)  
- Hosted MCP: `https://plus.tryatoms.app/mcp`  
- Issue [#120](https://github.com/taihartman/obsidian-atoms/issues/120)
