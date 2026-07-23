---
handoff_date: 2026-07-23
branch: feat/atoms-plus-managed-filing
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/107
related:
  - https://github.com/taihartman/obsidian-atoms/pull/92
  - https://github.com/taihartman/obsidian-atoms/issues/91
  - https://github.com/taihartman/obsidian-atoms/issues/112
status: in-progress
---

# Handoff — Atoms Plus production backend (#107)

You are picking up this work in a fresh session. Read this file top to bottom, run **How to resume**, then **start Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; begin and report what you did.

## Goal

Make **Atoms Plus user-ready on a public host**: durable meter, fail-closed prod, real email magic links, Stripe webhooks without `stripe listen`, deploy runbook. Local dogfood already works; production does not exist yet.

**Plan (authority):** `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md`  
**Issue:** #107  
**Do not** start Ask/MCP (#112) until Plus has a public URL.

## Session close-out (2026-07-23) — already done

All of this is **committed and pushed** on `feat/atoms-plus-managed-filing`. Working tree was clean before this handoff doc.

### Product dogfood (verified live)

| Check | Result |
|---|---|
| Desktop Process via Plus (no user Anthropic key) | Works |
| Stripe test Checkout → trial for `tai.piplup@gmail.com` | Webhook `checkout.session.completed → trial` |
| Server entitlement | trialing · 150 then filings used (saw 144) |
| Plugin Refresh status | Fixed stale localStorage after Checkout |
| Plugin/server `/v1/me` match after refresh | Yes |
| Atoms filed from today captures | Yes (e.g. Plus invisible, movies, Alex hubs, Ask/MCP thought) |

### Code landed this session (on branch tip)

| Commit | What |
|---|---|
| `9d0b1c1` | merge `master` into Plus branch (resolve STATUS + `plusBaseUrl`/`enableReconsiderCapture`) |
| `5e6dffe` | **CORS** allow `Idempotency-Key`; Plus path **`plusFetchRequest`** (fetch) — fixes Obsidian `requestUrl` → localhost `net::ERR_FAILED`; upstream Anthropic auth error copy |
| `e2e4b9c` | Prominent **Refresh status** CTA on Status / exhausted; Checkout notices point at Refresh |

### Issues / PR

| Item | URL | State |
|---|---|---|
| PR #92 plugin Plus | https://github.com/taihartman/obsidian-atoms/pull/92 | OPEN, **MERGEABLE** (not merge-ready for public Plus — dogfood only) |
| #91 plugin MVP | https://github.com/taihartman/obsidian-atoms/issues/91 | OPEN |
| #107 production backend | https://github.com/taihartman/obsidian-atoms/issues/107 | OPEN — **your claim** |
| #112 Ask brain remote MCP | https://github.com/taihartman/obsidian-atoms/issues/112 | OPEN — **fully documented research**; implement **after** public Plus host |

### Local dogfood how-to (keep working while you build prod)

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus/plus-service
# .env has STRIPE test keys + ANTHROPIC (do not commit .env)
DOGFOOD_AUTO_GRANT=0 ATOMS_PLUS_STORE=sqlite npm start   # :8787
# other terminal:
stripe listen --forward-to localhost:8787/v1/billing/webhook
```

Plugin install target used in dogfood (same vault name as main repo — install Plus build here):

```text
/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault
```

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus
npm run build
cp main.js manifest.json styles.css \
  "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault/.obsidian/plugins/atoms/"
# Settings → Plus URL http://127.0.0.1:8787
```

Magic links in dogfood appear in **`/tmp/atoms-plus-service.log`** (not email).

## Current status (backend)

Already on branch (from earlier commits, not only this session):

- `plus-service/` HTTP API: auth, classify proxy, Stripe Checkout/webhooks/portal hooks
- U1-ish **prod fail-closed** (`prodGate.mjs`, `ATOMS_PLUS_ENV=production`)
- **SQLite** durable store option (`ATOMS_PLUS_STORE=sqlite`) — plan wants **managed Postgres** for multi-instance prod (KTD-B1)
- Rate limit stub, email adapter stub, meter security tests exist under `plus-service/test/`
- Plugin: Plus session, classify via Plus, Idempotency-Key on classify, Refresh status, Manage Subscription portal call

**Not done (your job — plan sequencing):**

```text
U9a  Ensure docs/qa/2026-07-22-atoms-plus-meter-security-review.md exists / complete
U2   Durable Postgres meter + ledger (not multi-node SQLite)
U9b  Security tests for U1–U2
U3   Webhook harden + portal + cancel (partially present — verify vs plan)
U4   Server-owned classify payload (reject raw client messagesRequest) + caps
U5   Real email magic link (Resend) + session TTL enforce
U6   Promo harden
U8   Any remaining plugin refresh/portal/sign-out gaps
U9c  Full security suite green
U7   Deploy (Fly default) + docs/runbooks/atoms-plus-prod.md + public URL
```

## Next steps

1. **Read** `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md` end to end (KTDs + U1–U9).  
2. **Confirm** `docs/qa/2026-07-22-atoms-plus-meter-security-review.md` exists; if missing/thin, complete **U9a** first.  
3. **U2:** add managed-Postgres store path (`DATABASE_URL`), migrations, atomic consume + idempotent `usage_events.response_json` replay; keep SQLite/memory for local dogfood.  
4. **U9b:** meter security tests (parallel remaining=1, idempotency, restart preserves).  
5. **U4:** server-builds Anthropic classify body (schema-compatible with plugin); do not forward untrusted `messagesRequest`.  
6. **U5:** Resend (or configured) magic-link email; disable `dev-exchange` in prod (already gated — verify).  
7. **U7 only after U9c:** deploy staging with Stripe **test** mode → smoke Checkout + Process from phone/desktop against `https://…`.  
8. **Do not** implement #112 Ask MCP in this track.  
9. **Do not** merge #92 as “public Plus” until production host + security suite green (dogfood merge is a human call).

## Key files

| Path | Why |
|---|---|
| `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md` | Implementation authority for #107 |
| `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` | Plugin Plus product contract |
| `plus-pricing.json` | $6 / $60 / 150 / +50 / trial days SSOT |
| `plus-service/src/server.mjs` | HTTP routes + CORS (Idempotency-Key allowed) |
| `plus-service/src/store/sqlite.mjs` | Current durable local store |
| `plus-service/src/prodGate.mjs` | Production boot asserts |
| `plus-service/src/stripe.mjs` | Checkout + webhook apply |
| `plus-service/src/anthropic.mjs` | Proxy (must become server-owned payload — U4) |
| `src/platform/plusClient.ts` | `plusFetchRequest`, checkout, entitlement |
| `src/pipeline/classify.ts` | Plus path + Idempotency-Key + auth error split |
| `src/settings/settings.ts` | Plus UI + Refresh status CTA |
| `docs/qa/2026-07-22-atoms-plus-meter-security-review.md` | Security SoT (U9) |
| https://github.com/taihartman/obsidian-atoms/issues/112 | Ask MCP research dump — later |

## Decisions & constraints (do not relitigate)

- **No in-plugin chat**; Ask = remote MCP later (#112).  
- Plus = managed filing plane; free BYOK forever; never pitch BYOK on exhaust.  
- **Server remaining** is billing truth; client cache display-only.  
- Production **fail closed** (no dogfood auto-grant, Stripe required).  
- Prod DB default: **managed Postgres**, not multi-instance SQLite (KTD-B1).  
- Host default: **Fly.io** single region; email default: **Resend** (plan Q1–Q3).  
- Plugin default Plus URL already aims at `https://plus.tryatoms.app` when empty.  
- Body sacred; vault SSOT; never put managed Anthropic key in the plugin.  
- Multiplayer: #91/#92 = plugin MVP; **#107 = production backend** — keep scope split.  
- Hard claim: STATUS already has #91 + #107 on this branch; keep STATUS accurate.  
- Never commit `.env` / secrets; Anthropic keys in chat expire — use env only.  
- Agent vault writes: test/demo vault only — not personal Remote Vault.

## Open questions / blockers

- Operator must provide: Fly (or host) account, `plus.tryatoms.app` DNS, Resend API key, Stripe webhook endpoint on public URL.  
- Whether to merge #92 to master before or after staging deploy is a **human** call — code is mergeable but product is not “public Plus” yet.  
- Postgres provider choice within “managed” (Fly Postgres vs Neon) — pick at U2/U7, don’t block U2 interface design.

## Git state

- Branch `feat/atoms-plus-managed-filing` (base `master`), worktree  
  `/Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus`  
  (linked worktree of main repo `obsidian_plugin`).  
- Last feature commit before this handoff: `e2e4b9c feat(plus): prominent Refresh status after Checkout`  
- WIP handoff commit: branch tip `wip: handoff snapshot — plus production backend` (see `git log -1`)  
- Diff vs `origin/master`: ~57 files, large Plus surface (+8k lines)  
- Remote: `origin` → `taihartman/obsidian-atoms`

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus
git fetch origin && git switch feat/atoms-plus-managed-filing && git pull --ff-only
# read constitution + claim
# CLAUDE.md, docs/collab.md, STATUS.md, this handoff, then the #107 plan
cd plus-service && npm test
cd .. && npm test && npm run build
```

Then execute **Next steps** from step 1.
