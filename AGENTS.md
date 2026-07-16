# AGENTS.md — mandatory for every coding agent

This repo is **two humans + many agents**. Humans may not read the process docs. **You (the agent) must.**

## Session start (do this before any code)

1. Read **[CLAUDE.md](./CLAUDE.md)** (constitution + non-negotiables).  
2. Read **[docs/collab.md](./docs/collab.md)** (multiplayer process).  
3. Read **[STATUS.md](./STATUS.md)** (what is already claimed).  
4. Check open GitHub Issues/PRs if `gh` is available.  
5. On non-trivial work: pick a lane from **[docs/workflow-lanes.md](./docs/workflow-lanes.md)** (full / light / amend / debug) and state it before plan or code.

**Do not implement until a hard claim exists:**

- GitHub Issue **assigned** to a human owner  
- Row in `STATUS.md` (owner, branch, plan, hot files, state)  
- **Draft PR** opened for the branch  

If hot files overlap an `In progress` claim → **stop** and re-scope or wait. Do not “just be careful.”

**PR → Issue close (mandatory, agent-checked — no CI):** every shipping PR body must include `Closes #<issue>` (or `Fixes` / `Resolves`) for the claimed Issue. Plain “Issue #N” does **not** auto-close. Before mark-ready/merge, re-read the PR body and confirm. Docs/chore with no Issue: no fake `Closes`. After merge, clear the `STATUS.md` row.

**PR evidence (mandatory):** check Test plan boxes only after real runs. UI / product-facing PRs must attach vault smoke **screenshots** under `docs/qa/screenshots/<feature>/` and link them in the PR body (CLAUDE.md shipping tail § PR evidence). Docs-only / pure logic: `N/A — no UI`.

## Product guardrails (short)

- **Body sacred** — never rewrite capture body into the atom.  
- Flat `Atoms/` only — no folder intelligence.  
- Default: do not process **today’s** daily (explicit force only).  
- Sentinel markers = processed; never lossy.  
- Second brain, **not** a task app.  
- Desktop + iOS + Android are consumers; no silent platform-only product.  
- Constitution changes (`CLAUDE.md` non-negotiables / `docs/architecture.md` north star) **only via PR**.  
- **Phone install after master:** run `npm run phone` (plugin files → Remote Vault → Sync) when plugin code lands on `master`. That is **install only**, not vault rewrites.
- **Agent dogfood on demo/test vault only:** Process, Update notes, fixtures, classify smoke, screenshots → `test_vault/` or `docs/media/demo-vault/`. **Never** unattended mutate personal Remote Vault notes. Live personal data = human (or explicit user ask).

## Authority map

| Doc | Role |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Full project rules |
| [docs/collab.md](./docs/collab.md) | Claim / conflict / AI-PM process |
| [docs/workflow-lanes.md](./docs/workflow-lanes.md) | Full / light / amend / debug — process gates |
| [STATUS.md](./STATUS.md) | Live in-flight claims |
| [docs/architecture.md](./docs/architecture.md) | North star + system shape |
| Active plan in `docs/plans/` | Feature implementation authority |
| [docs/dev-obsidian-cli.md](./docs/dev-obsidian-cli.md) | Preferred agent verification (CLI) |
| [docs/dev-obsidian-mcp.md](./docs/dev-obsidian-mcp.md) | Optional MCP |
| [CONCEPTS.md](./CONCEPTS.md) | Domain vocabulary |
| [docs/solutions/](./docs/solutions/) | Past learnings |

## If the human says “just build X”

Still: claim → plan (if non-trivial) → implement claimed scope only → shipping tail in `CLAUDE.md`.  
Chat is not a ticket. Unclaimed work is out of bounds.

## Shared skills (`world-class-qa`, etc.)

Method skills are **not** in this repo. They come from private `taihartman/claude-skills` (see `docs/collab.md` § Shared agent skills).  
If `world-class-qa` / `adversarial-qa` cannot load: stop the shipping-tail QA step, report **skills not installed**, and point the human at that section — do not fake QA from code-read alone.
