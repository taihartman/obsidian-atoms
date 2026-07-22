# Testing Fixtures

Durable fixture catalog for Atoms QA. Never commit API keys, SecretStorage dumps, or personal vault content.

## Security Rules

- No credentials, JWTs, or raw Anthropic keys in reports or fixtures.
- **Agent dogfood:** throwaway `test_vault/` and synthetic `docs/media/demo-vault/` only.
- **Phone / personal vaults:** humans install the plugin via **BRAT** (or Release assets). Agents never copy plugin files into personal vaults and never rewrite notes there unattended.
- Remote Vault is real Sync data — Process/Update only by the human (or explicit user ask); never bulk-rewrite dailies unattended.

## Product proof vs fixture proof

| | Product dogfood | Fixture / seed |
|---|---|---|
| **Goal** | What a user gets after capture → Process | Deterministic parse/write/UI chrome |
| **Write** | Daily **capture bullets** only | `seed:vault`, `seed:demo`, hand atoms, fixture Process |
| **OK to plant hubs/atoms?** | **No** (unless the product created them) | Yes, for unit/UI-only — **label in QA** |
| **Silence / noise** | Real outcome — report it | May be bypassed on purpose |

See `docs/qa/README.md` § Product dogfood honesty. Example learning: entity orbits / Also about — `docs/solutions/features/entity-orbits-hard-keys-and-also-about.md`.

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

- **Purpose:** Live phone product path; humans own install + data.
- **Mode:** Live / human phone (agent: no default access).
- **Surface:** Settings version; human Process / Update / For you.
- **Setup:** BRAT → `taihartman/obsidian-atoms` → check for updates after a GitHub Release; Sync if multi-device; key on device.
- **Expected states:** Settings version matches release.
- **Cleanup:** User-owned; **never** agent bulk-Update / fixture-rewrite Atoms or dailies unless user explicitly asks.
- **Evidence:** Human checklist or screenshot; version string on phone.

### Desktop throwaway vault (reuse — do not recreate)

- **Purpose:** Default live Process / Also about / invite dogfood.
- **Mode:** Live CLI.
- **Path:** `test_vault/test vault/` (open as vault name **`test vault`**).
- **Setup once:** `./scripts/install-to-vault.sh`; Settings → Atoms → API key (SecretStorage). Key is **per vault + device**.
- **Reuse:** Agents **must not** delete the vault, wipe `.obsidian`, or `pm clear` desktop Obsidian between passes. Append captures → Process; clean only feature-specific notes when needed.
- **Evidence:** `obsidian vault="test vault" …`

### Android emulator vault **AtomsMobileQA** (reuse — do not recreate)

- **Purpose:** Mobile UI smoke for Atoms home, Also about, Make list invite.
- **Mode:** Live emulator (`adb` device `emulator-5554` or current AVD).
- **Path on device:** `/sdcard/Documents/AtomsMobileQA`
- **Setup once:**
  1. Install Obsidian APK if needed (`Obsidian-*.apk` from obsidian-releases).
  2. Push plugin: `main.js` `manifest.json` `styles.css` → `…/AtomsMobileQA/.obsidian/plugins/atoms/`
  3. `community-plugins.json` → `["atoms"]`
  4. First open: Use existing vault → Documents → **AtomsMobileQA** → Trust plugins.
  5. API key: set in **this vault** on the emulator (Settings → Atoms). Emulator key ≠ desktop key.
- **Reuse (mandatory):** **Do not** `pm clear md.obsidian` or delete `AtomsMobileQA` between QA runs unless the fixture is corrupt. Update plugin files in place; append captures / Process; screenshot.
- **Open Atoms home:** command palette / ribbon **Open home** (`atoms:open-home`). URI `obsidian://command?vault=AtomsMobileQA&id=atoms:open-home` when supported.
- **Evidence:** screenshots under `docs/qa/screenshots/entity-orbits-mobile/` (or feature folder).

### API key persistence (why it “disappears”)

| Cause | What happens |
|---|---|
| **Different vault** | SecretStorage is not shared across vaults. Key in Remote Vault ≠ test vault. |
| **Emulator `pm clear`** | Wipes entire Obsidian app data including secrets. |
| **New emulator / wipe data** | Same as clear. |
| **Device-local fallback off + empty secret id** | Key only found if stored under the configured secret id (default `atoms-anthropic-api-key` is also tried as of 0.6.25). |
| **data.json** | Never holds the key (by design). |

**Agent rule:** Prefer **device-local key fallback** on throwaway vaults for dogfood stability, or re-enter SecretStorage once per vault and stop clearing app data.

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
