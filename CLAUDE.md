# CLAUDE.md — Obsidian Atoms

Project rules for any coding agent (Grok, Claude Code, Cursor). Deeper docs win when they conflict with this file only if they are the **implementation plan** or **spec amendments**.

## Product in one sentence

Read **past** daily notes → split captures → classify atom/task/noise via Anthropic → write flat atoms (declarative title, reason-bearing links, **verbatim** body) → mark every capture with a sentinel so nothing reprocesses. Capture UI is **out of scope** (iOS Shortcut already exists).

## Authority (read before coding)

| Doc | Role |
|---|---|
| `docs/plans/2026-07-15-001-feat-obsidian-atoms-plugin-plan.md` | Implementation authority (units U1–U10) |
| `docs/spec-amendments.md` | Corrected design + *why* (markers, append cut, rot) |
| `docs/architecture.md` | Long-lived system map + future v2 shape |
| `docs/u1-spike-findings.md` | Spike-verified API/SecretStorage notes |

Where plan and amendments conflict, **the plan wins**. Amendments explain rationale for plan KTDs.

## Non-negotiables (bugs if violated)

1. **Body is sacred** — capture text lands in the atom **verbatim** (whitespace / obvious typo only). Model output surface = title, tags, links only.
2. **Never move files or choose folders** — atoms land flat in one configured folder (default `Atoms/`).
3. **Never read or modify today's daily note.** Only *create files* and *append* markers to past dailies; never rewrite existing lines.
4. **Sentinel is the processed marker** for **all three** verdicts:
   - atom: `↳ [[title]] <!--linker-->`
   - task/noise: `<!--linker:task-->` / `<!--linker:noise-->`
   - Wikilinks *inside* capture text are **not** markers.
5. **API key in SecretStorage** (or device-local fallback) — never `data.json`.
6. **Nothing destroyed** — idempotent, re-runnable; bad classifications are never lossy.
7. **Dry-run (U7) before write path (U8).**
8. **Develop against throwaway vault only** (`test_vault/`) until dry-run is trusted on real history.

## Build order

Implement strictly **U1 → U10**. Each unit = one atomic commit's worth of work. After each unit: show diffs + Verification evidence before continuing.

- **U1** spike first (API + SecretStorage + KTD3/KTD5 forks).
- **Test-first** on correctness cores: `parseCaptures` (U3), `render` (U8).
- Stack: sample-plugin template, TypeScript + esbuild, `obsidian-daily-notes-interface`, `isDesktopOnly: false`, network via `requestUrl` (not `fetch` — CORS).

## Commands

```bash
npm install
npm run dev          # watch main.js
npm run build        # typecheck + production bundle
npm run spike:api    # offline classify+cache (needs ANTHROPIC_API_KEY env)
```

## Dev vault + Obsidian CLI (preferred)

Full detail: `docs/dev-obsidian-cli.md`. Prefer CLI over Local REST API MCP for agent automation.

### Verified setup (2026-07-15)

| Item | Value |
|---|---|
| Obsidian | **1.12.7** installer (Homebrew cask) |
| CLI binary | `/opt/homebrew/bin/obsidian` (or `/usr/local/bin/obsidian`) |
| CLI toggle | Settings → **General → Advanced → Command line interface** ON |
| Throwaway vault | `test_vault/test vault/` (gitignored) |
| Plugin id | `atoms` |
| Anthropic key | SecretStorage (settings store secret **name** only; never `data.json`) |

Without the Advanced toggle, `obsidian` prints “Command line interface is not enabled” even if the binary exists.

### Everyday loop

```bash
# From repo root — Obsidian must be open on the test vault
./scripts/install-to-vault.sh   # build + copy main.js + plugin:reload
./scripts/spike-via-cli.sh      # U1 spikes via CLI
```

### Handy CLI (cwd = vault or `vault="test vault"` first)

```bash
cd "test_vault/test vault"

obsidian version
obsidian plugins:enabled
obsidian plugin:reload id=atoms

obsidian commands filter=atoms
obsidian command id=atoms:spike-secret-storage-probe
obsidian command id=atoms:spike-classify-hardcoded
obsidian command id=atoms:spike-cache-and-batch-fork
obsidian command id=atoms:list-unprocessed-captures   # U3 read-only
obsidian command id=atoms:dry-run-preview             # U7 — no vault writes
obsidian command id=atoms:process-unprocessed         # U8 — live API write
obsidian command id=atoms:process-fixture-sample      # U8 — fixture write (no API)
obsidian command id=atoms:auto-run-status             # U9 — device-local gates
obsidian command id=atoms:auto-run-now                # U9 — try (respects gates)
obsidian command id=atoms:test-connection             # HTTPS + Anthropic probe (no secrets)
obsidian command id=atoms:backfill-estimate-confirm   # U10 — estimate gate (batch only after confirm)

# Safe key presence check (no raw key in output)
obsidian eval 'code=(()=>{const p=app.plugins.plugins["atoms"];const k=p?.getApiKey?.();return JSON.stringify({hasKey:!!k,keyLen:k?.length??0,model:p?.settings?.model})})()'
```

```bash
npm test                 # vitest (parse tests)
npm run seed:vault       # ~20 Daily/ fixtures in test vault
./scripts/verify.sh      # tests + seed + install + CLI live checks (agents: run this)
```

**Agents must verify with CLI**, not only unit tests: after each unit that touches the plugin, run `./scripts/verify.sh` (or the relevant `obsidian command` / `obsidian eval`) while Obsidian is open on the throwaway vault, and report the CLI output as evidence.

Spike results land in **Notices** + DevTools console (`[atoms] …`). CLI cannot scrape the renderer console; `fetch` from `eval` hits CORS — plugin code must use `requestUrl`.

### Optional MCP

Local REST API MCP is optional (`docs/dev-obsidian-mcp.md`). Never point automation at a real personal vault for write experiments.

## Log safety

Never log request headers/bodies, full error objects, or raw API keys. Redact keys to fingerprints. Gate capture-content console dumps behind dev-only paths.

## Architecture seams (do not collapse)

- `parse.ts` — capture extent + marker detection (KTD1)
- `context.ts` — `ContextProvider` seam (all-titles v1; shortlist later)
- `classify.ts` — request build, cache breakpoint, schema, invariants, retry
- `render.ts` — atom file + markers; collision policy KTD8
- `preview.ts` — dry-run only
- `backfill.ts` — Batch API + cost gate

Intelligence lives in **links + titles**, not folders.

## Workflow

Default: plan → implement unit → verify → next unit. Full ce-* loop when using compound-engineering for net-new features. Amend lane for tiny post-ship tweaks.

## Out of scope (v1)

Capture UI · AI folder placement · `append` into user notes · always-on 3am headless · embeddings · resurfacing stream (v2).
