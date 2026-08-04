# Runbook — Claude connectors directory (Atoms Ask)

**MCP URL:** `https://plus.tryatoms.app/mcp`  
**Plan:** `docs/plans/2026-07-28-002-feat-ask-mcp-2026-07-28-protocol-directory-plan.md`  
**Shipped:** Bar A #188 / #189 · Bar B code #194 / #195 (Fly live)  
**Protocol:** Dual-era — legacy initialize (Claude JSON-only Accept OK) + modern `2026-07-28`

## Product honesty (listing copy)

| Say | Do not say |
|-----|------------|
| Cloud **mirror** of `Atoms/` (+ linked hubs) | “Whole vault” |
| **Queue** new atoms (outbox) until Obsidian applies | Instant vault write / edit existing bodies |
| Scopes: `atoms:read` + `atoms:write` | Read-only if write tools are listed |
| Tool results go to Anthropic when chatting in Claude | Zero-knowledge host |

## OAuth scopes

| Scope | Tools |
|-------|--------|
| `atoms:read` | `mirror_status`, `list_tags`, `search_atoms`, `fetch_atom`, `neighbors`, `list_atoms` |
| `atoms:write` | `create_atom`, `continue_atom`, `cancel_pending` |

Consent **Allow** grants **both**.  
**Reconnect** (Disconnect → OAuth again) if an old connector was linked before `atoms:write` shipped — otherwise write tools return `insufficient_scope`.

## Reviewer-completable write path

Directory review needs write tools to **succeed**, not stay forever-pending.

### Option A — Human vault window (default; dogfooded)

1. Plus account (active/trialing) with Ask enabled + **Allow filing**.
2. Desktop Obsidian open (prefer **test vault** for review; personal vault OK for owner dogfood).
3. In Claude: `create_atom` → status **pending** / outbox id → within ~1 min with app open, vault applies → `fetch_atom` finds the note.
4. Portal test-account steps: operator email + “Obsidian open + Allow filing during review.”

**Owner dogfood (2026-07-29):** consent shows both scopes; Claude queued `create_atom` as pending outbox. Apply confirmed when Obsidian open with filing allowed.

### Option B — Harness (optional later)

Script: claim outbox → mirror upsert → ack applied (no Obsidian). Not required if Option A is staffed.

## Pre-submit checklist

### Done (code + owner dogfood)

- [x] HTTPS MCP URL live; unauth `/mcp` → 401 + PRM  
- [x] AS metadata: CIMD + `none` + `atoms:read` + `atoms:write` + `iss` flag (live prod)  
- [x] Claude custom connector: tools list + search/fetch (after JSON Accept fix)  
- [x] After reconnect: `atoms:write`; `create_atom` enqueues (pending outbox)  
- [x] DCR register rate-limited (CI)  
- [x] Dual-era + write-scope tests in `plus-service`  

### Still open (portal / assets / evidence)

- [ ] Write → Obsidian **apply** → `fetch_atom` screenshot/notes under `docs/qa/` (optional if you already saw it land)  
- [ ] Privacy URL live on tryatoms (confirm `https://tryatoms.app/privacy` or current path)  
- [ ] Public docs URL for listing (this runbook raw GitHub URL or tryatoms help page)  
- [ ] Icon/asset for directory listing  
- [ ] Support contact email  
- [ ] Portal form: name, tagline, description, categories, use cases **reads and writes**  
- [ ] Compliance acks in portal  
- [ ] Team/Enterprise Claude org with Directory management role  

## Portal submission

1. Team/Enterprise Claude org with Directory management role  
2. [Submission docs](https://claude.com/docs/connectors/building/submission)  
3. Dashboard: `https://claude.ai/admin-settings/directory/submissions`  
4. Escalations: `mcp-review@anthropic.com`  

### Exit state

| Date | State | Notes | Owner |
|------|--------|-------|--------|
| 2026-07-29 | **Code ready, not submitted** | Bar A+B on Fly; custom connector dogfood green; portal form not started | |

States: `Not submitted` · `Code ready, not submitted` · `Submitted` · `Approved` · `Rejected + remediation` · `Blocked (org/privacy/icon)`

## Pairing code (Plus email ≠ Claude/ChatGPT account)

When the OAuth browser cannot complete magic link on the **Atoms Plus** email (or a prior OAuth cookie is wrong):

1. Obsidian → Settings → Atoms → Ask → **Get pairing code** (copies `XXXX-XXXX`).
2. Claude/ChatGPT → Connect Atoms → on authorize page choose **code from Obsidian** (or Continue / different email if a browser session exists).
3. Allow consent — tokens bind to the **Plus** email, not the Claude profile.
4. If `list_atoms` still looks stale: disconnect/reconnect the connector so it drops the old grant.

Deploy **plus-service before** a plugin BRAT release that mints codes (`POST /v1/ask/mcp/pair` + OAuth chooser). Plan: `docs/plans/2026-08-04-002-feat-ask-mcp-pairing-plan.md`.

## Ops / deploy

Already on production from #189 / #195. Further MCP changes (including pairing):

```bash
fly deploy -a atoms-plus \
  --config plus-service/fly.toml \
  --dockerfile plus-service/Dockerfile
```

Rollback: `fly releases -a atoms-plus` → prior image (see `docs/runbooks/atoms-plus-prod.md`). Note: rolling back pairing removes the cookie identity chooser (silent consent returns).

## Related evidence

- Dual-era deploy probes: `docs/qa/2026-07-29-ask-mcp-dual-era-deploy.md`  
- Prod runbook Ask section: `docs/runbooks/atoms-plus-prod.md`  
