# Testing Fixtures

## Security Rules

Never commit Anthropic API keys, SecretStorage dumps, personal vault contents, or Sync credentials.

## Current Fixtures

### Vitest pure modules

- **Purpose:** Deterministic parse/render/resurface/classify behavior without Obsidian.
- **Mode:** Automated.
- **Surface:** `test/**/*.test.ts` with `test/mocks/`.
- **Setup:** `npm test`.
- **Expected states:** All suites green.
- **Cleanup:** None.
- **Evidence:** Vitest output in QA reports.

### Throwaway test vault

- **Purpose:** CLI-driven plugin smoke without personal data.
- **Mode:** Live / Both.
- **Surface:** `test_vault/test vault/` (gitignored).
- **Setup:** `npm run seed:vault` then `./scripts/install-to-vault.sh` with Obsidian open on that vault.
- **Expected states:** Plugin id `atoms` enabled; commands listed under filter=atoms.
- **Cleanup:** Re-seed or wipe vault notes under Daily/Atoms as needed; never use personal Remote Vault for destructive experiments.
- **Evidence:** `obsidian command` / `obsidian eval` output.

### Mind-change pair (Belief Rehearsal)

- **Purpose:** Prove For you mind-change hero and citator when hard supersession exists.
- **Mode:** Automated (unit) + Live (seeded atoms in test vault).
- **Surface:** Atoms home For you + home open.
- **Setup (unit):** `test/resurface.test.ts` supersession cases.
- **Setup (live):** Two files under `Atoms/`:
  - Older: body “I used to think X”, title `Old claim`.
  - Newer: body “Now Y”, link prose `revises [[Old claim]].`, `generated-by: linker` frontmatter.
- **Expected states:** Mind change kicker; old body snippet; later line; Open → citator “Revises · Old claim” on new or “Revised by · New claim” on old.
- **Cleanup:** Delete the two atom files after the pass.
- **Evidence:** Unit tests + CLI eval of pure functions if available; screenshots if human-captured.

### Design handoff mocks

- **Purpose:** Visual authority for home surfaces.
- **Mode:** Reference (open in browser).
- **Surface:** `docs/design-handoff/belief-rehearsal/*.html`, `docs/design-handoff/atoms-view/`.
- **Setup:** Open HTML files locally.
- **Evidence:** Side-by-side with live Obsidian when assessing fidelity.

## Fixture Maintenance

When a feature adds seed shapes or CLI commands, update this file in the same change.
