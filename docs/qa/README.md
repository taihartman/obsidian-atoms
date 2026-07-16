# QA Playbook

This folder is the project-specific adapter for the shared `world-class-qa` and `adversarial-qa` skills. The global skills define the method; this folder defines how this project is launched, which fixtures are valid, where screenshots live, and which routes matter.

## Required Preflight

Before a QA pass, read:

1. `docs/qa/testing-fixtures.md` for deterministic data, live-data constraints, and cleanup rules.
2. `docs/qa/app-navigation-map.md` for route and tap-path anchors.
3. The changed files and adjacent tests for the feature under QA.

## Run Commands

From repo root (see `CLAUDE.md` / `README.md`):

```bash
npm install
npm test                 # vitest unit tests
npm run build            # tsc + production main.js
./scripts/install-to-vault.sh   # build + copy into throwaway vault + plugin:reload
./scripts/verify.sh      # tests + seed + install + CLI live checks (agents: run this)
```

Obsidian must be open on the target vault for CLI checks.

```bash
cd "test_vault/test vault"
obsidian plugin:reload id=atoms
obsidian commands filter=atoms
obsidian command id=atoms:dry-run-preview
obsidian command id=atoms:process-fixture-sample
```

Phone / Sync install (user-visible builds):

```bash
./scripts/install-to-vault.sh "$HOME/Documents/Remote Vault"
```

## Viewports / Devices

- **Primary:** Obsidian mobile phone (Atoms home is mobile-first; design handoffs at 375px phone shells).
- **Secondary:** Obsidian desktop with Atoms home leaf open.
- Visual fidelity: compare live home UI to `docs/design-handoff/` mocks at phone width — not a web browser app.

## Evidence Paths

- QA reports: `docs/qa/YYYY-MM-DD-<branch>-world-class-qa.md`.
- Screenshots: `docs/qa/screenshots/<branch-or-feature>/<frame>.png` (manual capture from Obsidian or mock HTML).

## Auth Reality

No user sign-in. Anthropic API key lives in SecretStorage (or device-local fallback) — never in `data.json`. Live Process paths need a key; dry-run / fixture / pure unit paths do not. Never commit API keys.
