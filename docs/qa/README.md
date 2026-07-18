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
| Install plugin (agent QA) | `./scripts/install-to-vault.sh` → throwaway test vault |
| Seed demo dogfood | `node scripts/seed-demo-vault.mjs` then install into `docs/media/demo-vault` |
| Phone install only | `npm run phone` → Remote Vault **plugin files only** (CLAUDE.md) |
| Full agent verify | `./scripts/verify.sh` (Obsidian open + CLI on **test** vault) |
| Live CLI smoke | `obsidian command id=atoms:…` from **test/demo** vault cwd |

## Vault lanes

| Who | Vault | Purpose |
|---|---|---|
| **Agent dogfood / QA** | `test_vault/test vault/`, `docs/media/demo-vault/` | Process, Update notes, fixtures, screenshots — **all write experiments** |
| **Phone product** | `~/Documents/Remote Vault` via Sync | Human live data; agent only installs plugin (`npm run phone`) |
| **Never by default** | Remote Vault atoms/dailies | Unattended Update / fixture rewrite / bulk classify |

## Product dogfood honesty (mandatory)

**Bug this kills:** agent plants hubs + perfect atoms, screenshots a green feature, claims “product works” — users never get that setup.

| Kind of proof | Allowed | Not allowed as product proof |
|---|---|---|
| **Real product loop** | Append **capture bullets** only → Process / force Process today → observe | Pre-create hub notes, hand-write atom link-prose, plant ≥3 linked atoms just to light Also about / hubs / etc. |
| **Plumbing / unit** | `npm test`, `seed:vault`, `seed:demo`, fixture Process, pure index fixtures | Calling that “day-one dogfood” in the PR verdict |
| **UI chrome only** | After a real loop (or explicit “UI-only with labeled fixture”) | Unlabeled seeded screenshots as merge evidence for product magic |

**Default dogfood steps (agents):**

1. Install plugin to throwaway vault.  
2. Write captures the way a user would (`- pack …` on past dailies; force today if needed).  
3. Run **Process** / **Process include today** — not hand-authored atoms.  
4. Report what actually happened (including noise, silence, missing Also about).  
5. If a feature needs an existing hub to shine, say so — do not invent the hub to fake the aha unless the product itself creates it.

**Scripts:** `npm run seed:vault` / `seed:demo` remain valid for parse/process plumbing and README chrome. They are **not** a substitute for step 2–4 when claiming a product surface works.

## Viewports / Devices

| Surface | Target |
|---|---|
| **Primary (phone product)** | Obsidian mobile (iOS) on **Remote Vault** via Sync — install id `atoms`, check Settings version |
| **Agent automation / dogfood** | Desktop Obsidian **1.12.x** + CLI on `test_vault/` or **demo-vault** (not Remote Vault notes) |
| Home UI | Mobile-first `atoms-home` leaf (~phone width); desktop left sidebar leaf OK for smoke |

Visual fidelity mocks (when UI change): `docs/design-handoff/atoms-view/`.

## Evidence Paths

- QA reports: `docs/qa/YYYY-MM-DD-<branch>-world-class-qa.md`
- Screenshots: `docs/qa/screenshots/<branch-or-feature>/<frame>.png`
- CLI transcript: paste into report Evidence section (no secrets / no raw API keys)

### PR body evidence (required)

For any PR that changes **user-visible UI** (Atoms home, For you, cards, pair-open, library chrome, settings product copy):

1. Install to the throwaway vault (`./scripts/install-to-vault.sh`).
2. Drive the happy path (CLI `atoms:open-home` + clicks via `obsidian eval`, or human).
3. Capture frames with `obsidian vault="test vault" dev:screenshot path=docs/qa/screenshots/<feature>/0N-name.png`.
4. Commit the PNGs under `docs/qa/screenshots/<feature>/` and **link them in the PR body** with **absolute** URLs — GitHub PR descriptions do **not** render repo-relative `![…](docs/…)` paths (broken image icon). After push:

   `![label](https://raw.githubusercontent.com/<owner>/<repo>/<branch>/docs/qa/screenshots/<feature>/01-….png)`

5. **Check** the matching Test plan boxes — never leave `- [ ]` after claiming the step ran.

Pure logic / docs-only PRs: write `N/A — no UI` in Evidence. Skipping screenshots on a UI PR is a process failure, not optional polish.

## Auth Reality

- Anthropic API key: **SecretStorage** (or device-local fallback). Never commit keys.
- Auto-run flags: **device-local** (`loadLocalStorage`) — phone ≠ desktop.
- Live classify needs a key on the device under test. Dry-run / fixture commands avoid spend when possible.

## Merge gate (project)

Non-trivial PRs must run **`world-class-qa`** (and its required **`adversarial-qa`** half) or record a **Blocked / checklist handoff** with named gaps. Unit tests alone are not QA.
