# Testing Fixtures

Durable fixture catalog for Atoms QA. Never commit API keys, SecretStorage dumps, or personal vault content.

## Security Rules

- No credentials, JWTs, or raw Anthropic keys in reports or fixtures.
- Prefer throwaway vault (`test_vault/`) for write experiments.
- Remote Vault is real Sync data — process only with user consent; never bulk-rewrite dailies.

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

### Remote Vault (phone Sync)

- **Purpose:** Real mobile product path.
- **Mode:** Live / human phone.
- **Surface:** Atoms home, Process, auto-run, For you.
- **Setup:** Install built plugin to Remote Vault; Sync; key `mobile-key` or SecretStorage.
- **Expected states:** Settings version matches ship; filing works offline-retry after 0.5.4.
- **Cleanup:** User-owned; do not agent-wipe personal notes.
- **Evidence:** Screenshot or human checklist rows in QA report.

## Fixture Maintenance

When a feature adds a stable seed, CLI command, or device flag, update this file in the same change.

### Update notes (quality stamp / legacy atoms)

- **Purpose:** Prove eligibility, extract skip, stamp, and home strip counting.
- **Mode:** Automated (+ live optional).
- **Surface:** Atoms home Update strip; command `atoms:update-notes`.
- **Setup (unit):** `test/refreshAtoms.test.ts`, `test/atomQuality.test.ts`.
- **Setup (live throwaway):** unstamped atom under `Atoms/` with `generated-by: linker` and no `atoms-quality` (or quality &lt; 2). Optional multipara body (should **skip**).
- **Expected states:** strip count &gt; 0 when eligible; after successful Update, atom has `atoms-quality: 2` and capture text unchanged; multipara skipped not corrupted.
- **Cleanup:** delete QA-prefixed fixture atoms; re-seed vault if needed.
- **Evidence:** unit suite + human phone checklist in QA report.
- **Spend:** live Update calls Anthropic — use small batch / throwaway only.

### Mind-change pair (Belief Rehearsal)

- **Purpose:** Prove For you mind-change hero and citator when hard supersession exists.
- **Mode:** Automated (unit) + Live (seeded atoms).
- **Surface:** Atoms home For you + home open.
- **Setup (unit):** `test/resurface.test.ts` supersession cases.
- **Setup (live):** Older + newer atom with `revises [[Old title]]` and `generated-by: linker`.
- **Expected states:** Mind change kicker; old body; later line; citator chips on home open.
- **Cleanup:** Delete fixture atoms after the pass.
- **Evidence:** Unit tests + CLI/home visual.
