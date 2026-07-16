# Testing Fixtures

Durable fixture catalog for Atoms QA. Never commit API keys, SecretStorage dumps, or personal vault content.

## Security Rules

- No credentials, JWTs, or raw Anthropic keys in reports or fixtures.
- **Agent dogfood:** throwaway `test_vault/` and synthetic `docs/media/demo-vault/` only.
- **Phone:** Remote Vault receives **plugin installs** (`npm run phone`), not agent note rewrites.
- Remote Vault is real Sync data — Process/Update only by the human (or explicit user ask); never bulk-rewrite dailies unattended.

## Current Fixtures

### Seeded test vault dailies

- **Purpose:** Unprocessed captures on past dailies for parse/list/process smoke.
- **Mode:** Automated + Live.
- **Surface:** Daily notes + Process / list-unprocessed / auto-run.
- **Setup:** `npm run seed:vault` then `./scripts/install-to-vault.sh` with Obsidian open on `test_vault/test vault/`.
- **Expected states:** Unprocessed count &gt; 0 after seed (until process/markers); atoms under `Atoms/` after write path.
- **Cleanup:** Re-seed or discard vault copy; do not commit vault contents.
- **Evidence:** `./scripts/verify.sh` output; `atoms:list-unprocessed-captures`.

### Fixture Process (no API)

- **Purpose:** Write path without Anthropic spend.
- **Mode:** Live CLI.
- **Surface:** `atoms:process-fixture-sample` (if enabled) or dry-run preview.
- **Setup:** Plugin installed; see command palette `atoms:`.
- **Expected states:** Markers and/or atoms without network (fixture path).
- **Cleanup:** Re-seed vault.
- **Evidence:** CLI notice / `lastWriteReport` via eval (no secrets).

### Device auto-run flags (local only)

- **Purpose:** Enable automatic filing / egress ack for auto-run QA.
- **Mode:** Live (device-local).
- **Surface:** Settings → Atoms → Auto-run; home “Turn on automatic filing”.
- **Setup:** Toggle on device under test; key present.
- **Expected states:** `atoms:auto-run-status` shows on + ack; past work files on open when gates pass.
- **Cleanup:** Toggle off after destructive tests if desired.
- **Evidence:** Status command Notice/console; markers on past dailies.

### Remote Vault (phone Sync) — human product vault

- **Purpose:** Live phone product path; agent only **installs the plugin**, does not rewrite notes.
- **Mode:** Live / human phone (agent: install only).
- **Surface:** Settings version; human Process / Update / For you.
- **Setup:** `npm run phone` after master; Sync; quit/reopen phone; key on device.
- **Expected states:** Settings version matches ship.
- **Cleanup:** User-owned; **never** agent bulk-Update / fixture-rewrite Atoms or dailies unless user explicitly asks.
- **Evidence:** Human checklist or screenshot; version string on phone.

## Fixture Maintenance

When a feature adds a stable seed, CLI command, or device flag, update this file in the same change.

### Mind-change pair (Belief Rehearsal)

- **Purpose:** Prove For you mind-change hero and citator when hard supersession exists.
- **Mode:** Automated (unit) + Live (seeded atoms).
- **Surface:** Atoms home For you + home open.
- **Setup (unit):** `test/resurface.test.ts` supersession cases.
- **Setup (live):** Older + newer atom with `revises [[Old title]]` and `generated-by: linker`.
- **Expected states:** Mind change kicker; old body; later line; citator chips on home open.
- **Cleanup:** Delete fixture atoms after the pass.
- **Evidence:** Unit tests + CLI/home visual.
