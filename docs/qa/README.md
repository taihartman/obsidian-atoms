# QA Playbook

This folder is the project-specific adapter for the shared `world-class-qa` and `adversarial-qa` skills. The global skills define the method; this folder defines how Atoms is launched, which fixtures are valid, where evidence lives, and which surfaces matter.

## Required Preflight

Before a QA pass, read:

1. `docs/qa/testing-fixtures.md` for deterministic data, live-data constraints, and cleanup rules.
2. `docs/qa/app-navigation-map.md` for surface and command anchors.
3. The changed files, plan (if any), and adjacent tests for the feature under QA.

## Run Commands

| Layer | Command |
|---|---|
| Unit | `npm test` |
| Typecheck + bundle | `npm run build` |
| Seed throwaway vault | `npm run seed:vault` |
| Install plugin into vault | `./scripts/install-to-vault.sh` (test vault) or Remote Vault path per CLAUDE.md |
| Full agent verify | `./scripts/verify.sh` (Obsidian open + CLI on) |
| Live CLI smoke | `obsidian command id=atoms:…` from vault cwd (see CLAUDE.md) |

## Viewports / Devices

| Surface | Target |
|---|---|
| **Primary (phone product)** | Obsidian mobile (iOS) on **Remote Vault** via Sync — install id `atoms`, check Settings version |
| **Agent automation** | Desktop Obsidian **1.12.x** + CLI on throwaway `test_vault/test vault/` |
| Home UI | Mobile-first `atoms-home` leaf (~phone width); desktop left sidebar leaf OK for smoke |

Visual fidelity mocks (when UI change): `docs/design-handoff/atoms-view/`.

## Evidence Paths

- QA reports: `docs/qa/YYYY-MM-DD-<branch>-world-class-qa.md`
- Screenshots (if any): `docs/qa/screenshots/<branch-or-feature>/<frame>.png`
- CLI transcript: paste into report Evidence section (no secrets / no raw API keys)

## Auth Reality

- Anthropic API key: **SecretStorage** (or device-local fallback). Never commit keys.
- Auto-run flags: **device-local** (`loadLocalStorage`) — phone ≠ desktop.
- Live classify needs a key on the device under test. Dry-run / fixture commands avoid spend when possible.

## Merge gate (project)

Non-trivial PRs must run **`world-class-qa`** (and its required **`adversarial-qa`** half) or record a **Blocked / checklist handoff** with named gaps. Unit tests alone are not QA.
