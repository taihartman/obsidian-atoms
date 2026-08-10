# AGENTS.md — mandatory for every coding agent

This repo is **two humans + many agents**. Humans may not read the process docs. **You (the agent) must.**

## Read this first

**Read [CLAUDE.md](./CLAUDE.md).** That file is the constitution: non-negotiables, authority map, collab/claim rules, stack, shipping tail, and pointers to deeper docs (including Obsidian API conventions).

Do not treat this file as a second rulebook. If something is not in CLAUDE.md, follow the docs it links.

## Session start (before any code)

1. Read **[CLAUDE.md](./CLAUDE.md)**  
2. Read **[STATUS.md](./STATUS.md)** (what is already claimed)  
3. Check open GitHub Issues/PRs if `gh` is available  

Hard claim, lanes, product guardrails, PR close keywords, and QA rules: all in CLAUDE.md (and the docs it points at).

## Shared skills (`world-class-qa`, etc.)

Method skills are **not** in this repo. They come from private `taihartman/claude-skills` (see `docs/collab.md` § Shared agent skills).  
If `world-class-qa` / `adversarial-qa` cannot load: stop the shipping-tail QA step, report **skills not installed**, and point the human at that section — do not fake QA from code-read alone.

## Repo-local skills (Claude + other agents)

| Skill | Path | When |
|---|---|---|
| **field-notes** | `.agents/skills/field-notes/` (symlink `.claude/skills/field-notes`) | User feeds a Field notes idea → draft, test email, broadcast on approval |
| **atoms-voice** | `.agents/skills/atoms-voice/` (symlink `.claude/skills/atoms-voice`) | Any product copy / email tone |

Claude Code: project skills under `.claude/skills/`; also symlink into `~/.claude/skills/` on each machine if global discovery is needed. Docs: `docs/voice.md`, `docs/field-notes-email.md`, `docs/runbooks/atoms-notes-list.md`.
