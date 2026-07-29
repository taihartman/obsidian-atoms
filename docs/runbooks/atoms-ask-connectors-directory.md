# Runbook — Claude connectors directory (Atoms Ask)

**MCP URL:** `https://plus.tryatoms.app/mcp`  
**Plan Bar B:** `docs/plans/2026-07-28-002-feat-ask-mcp-2026-07-28-protocol-directory-plan.md` (U6–U7)  
**Issue:** #194  

## Product honesty (listing copy)

| Say | Do not say |
|-----|------------|
| Cloud **mirror** of `Atoms/` (+ linked hubs) | “Whole vault” |
| **Queue** new atoms (outbox) until Obsidian applies | Instant vault write / edit existing bodies |
| Scopes: `atoms:read` + `atoms:write` | Read-only if write tools are listed |
| Tool results go to Anthropic when chatting in Claude | Zero-knowledge host |

## OAuth scopes (U6)

| Scope | Tools |
|-------|--------|
| `atoms:read` | `search_atoms`, `fetch_atom`, `neighbors`, `list_atoms` |
| `atoms:write` | `create_atom`, `continue_atom`, `cancel_pending` |

Consent **Allow** grants **both**. Users must **Disconnect + reconnect** after U6 deploy to pick up `atoms:write` on existing connectors.

## Reviewer-completable write path (KTD15)

Directory review needs write tools to **succeed**, not stay forever-pending.

### Option A — Human vault window (default)

1. Plus test account (active/trialing) with Ask enabled + **Allow filing**.
2. Desktop Obsidian open on a **test vault** (not personal Remote Vault for unattended agents).
3. Reviewer (or operator) runs `create_atom` in Claude → within ~1 min with app open, outbox applies → `fetch_atom` finds the note.
4. Document operator email + “Obsidian open during review” in portal test-account steps.

### Option B — Harness (optional later)

Script: claim outbox → apply payload into mirror upsert → ack applied, so `fetch_atom` works without Obsidian. Not required if Option A is staffed.

## Pre-submit checklist

- [ ] HTTPS MCP URL live; unauth `/mcp` → 401 + PRM  
- [ ] AS metadata: CIMD + `none` + `atoms:read` + `atoms:write` + `iss` flag  
- [ ] Claude custom connector: tools list + search/fetch  
- [ ] After reconnect: token `scope` includes `atoms:write`; `create_atom` enqueues  
- [ ] Write → Obsidian apply → `fetch_atom` (Option A) recorded  
- [ ] Privacy URL live on tryatoms (e.g. `/privacy`)  
- [ ] Public docs URL (this runbook or tryatoms Ask help)  
- [ ] Icon/asset ready  
- [ ] Support contact  
- [ ] DCR register still rate-limited (CI)  
- [ ] Portal: name, tagline, description, categories, use cases **reads and writes**  
- [ ] Compliance acks  

## Portal submission

1. Team/Enterprise Claude org with Directory management role  
2. [Submission docs](https://claude.com/docs/connectors/building/submission)  
3. Dashboard: `https://claude.ai/admin-settings/directory/submissions`  
4. Escalations: `mcp-review@anthropic.com`  

### Exit state (record here after submit)

| Date | State | Notes | Owner |
|------|--------|-------|--------|
| _pending_ | Not submitted | Code + runbook first | |

States: `Not submitted` · `Submitted` · `Approved` · `Rejected + remediation` · `Blocked (org/privacy/icon)`

## Deploy note

After merging U6 code:

```bash
fly deploy -a atoms-plus \
  --config plus-service/fly.toml \
  --dockerfile plus-service/Dockerfile
```

Then human: reconnect Claude connector before directory dogfood.
