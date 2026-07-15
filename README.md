# Obsidian Atoms

Classifies **past** daily-note captures (atom / task / noise) via the Anthropic API, writes one atomic note per atom (declarative title + reason-bearing wikilinks, **verbatim** body), and marks every capture with a sentinel so nothing is reprocessed.

Capture itself is out of scope (native iOS Shortcut). See `docs/plans/2026-07-15-001-feat-obsidian-atoms-plugin-plan.md` and `docs/spec-amendments.md`.

## Requirements

- Obsidian ≥ 1.11.4 (SecretStorage)
- Core **Daily Notes** plugin enabled
- Anthropic API key

## Project docs

- **[CLAUDE.md](./CLAUDE.md)** — agent rules / non-negotiables  
- **[docs/architecture.md](./docs/architecture.md)** — system map + v2 north star  
- **[docs/dev-obsidian-cli.md](./docs/dev-obsidian-cli.md)** — official Obsidian CLI (preferred for agents)  
- **[docs/dev-obsidian-mcp.md](./docs/dev-obsidian-mcp.md)** — Local REST API MCP (optional)  
- Plan + amendments under `docs/`

## Dev setup

```bash
npm install
npm run dev                     # watch-build main.js
./scripts/install-to-vault.sh   # copy into test vault + CLI reload
./scripts/spike-via-cli.sh      # U1 spikes via official CLI
```

Requires **Obsidian 1.12+** with CLI enabled (`obsidian` on PATH). Use the **throwaway vault** at `test_vault/test vault/` — never the real vault until dry-run is trusted.

### U1 spike commands (Command Palette)

1. **Spike: probe SecretStorage read/write** — confirms key storage on this device (desktop now; re-run on iOS).
2. **Spike: classify hardcoded capture** — one API call; logs `{verdict, title, tags, links}` to the console.
3. **Spike: measure cache + per-day batch fork (KTD3)** — three per-capture calls (watch `cache_read_input_tokens`) + one day-batch call for cost/quality comparison.

Offline equivalent (no Obsidian):

```bash
ANTHROPIC_API_KEY=sk-… npm run spike:api
```

## Non-negotiables

- Atom body = capture text **verbatim**
- Never move files / choose folders — flat configured folder only
- Never read or modify **today's** daily note
- Sentinel HTML comments mark **all three** verdicts
- API key in SecretStorage (or device-local fallback), never `data.json`
