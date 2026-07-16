# App Navigation Map

Living map for driving Atoms during QA. Update when commands, home cards, or settings sections change.

## Launch

| Item | Value |
|---|---|
| App | Obsidian desktop or mobile |
| Plugin id | `atoms` |
| Throwaway vault | `test_vault/test vault/` (gitignored) |
| Phone Sync vault | Remote Vault (user machine path; see CLAUDE.md) |
| CLI | Settings → General → Advanced → Command line interface **ON** |
| Install | `./scripts/install-to-vault.sh` then `obsidian plugin:reload id=atoms` |

## Key Surfaces

### Atoms home

- **Entrypoint:** Ribbon library icon, or command `atoms:open-home`, or open leaf type `atoms-home`.
- **How to reach:** Command palette → “Open home” (plugin name shown beside it).
- **Source:** `src/atomsHomeView.ts`, `src/atomsHomeData.ts`.
- **Fixture:** Seeded past unprocessed for wait card; atoms in `Atoms/` for library / For you.
- **Notes:** One hero: Ready / automatic filing / For you when calm. Progress card only for manual Preview/Process (not silent auto-run).

### Wait card / automatic filing

- **When:** Past unprocessed &gt; 0.
- **Modes:** need key → open settings; enable auto → privacy modal; auto on → Process secondary.
- **Source:** `filingHeroCopy` in `src/atomsHomeData.ts`.
- **QA:** Enable flow must not write to `data.json` auto-run flags.

### Settings → Atoms

- **Entrypoint:** Settings tab id `atoms`.
- **Contains:** Version, API key / SecretStorage id, auto-run ack + enable, model, atom folder, vocab, capture shortcut URL.
- **Source:** `src/settings.ts`.

### Process / Preview (manual)

- **Commands:** Process unprocessed; dry-run preview; home buttons; include-today via ⋯ menu.
- **Never auto:** `includeToday` only manual.
- **Source:** `src/pipeline/write.ts`, `src/pipeline/preview.ts`, `src/plugin/main.ts`.

### Update notes (refresh older atoms)

- **When:** Linker atoms with missing/`atoms-quality` &lt; `CURRENT_ATOMS_QUALITY`; strip not dismissed for this quality gen.
- **Entrypoint:** Home secondary strip **Update** (after Process wait if any); command `atoms:update-notes`.
- **Flow:** strip → light confirm Modal → progress phase `update` → done summary (may show remaining).
- **Dismiss:** strip × → device-local `atoms-update-notes-dismissed-q` = CURRENT.
- **Never auto:** not called from `maybeAutoRun`.
- **Source:** `src/pipeline/refreshAtoms.ts`, `src/shared/atomQuality.ts`, `src/home/atomsHomeView.ts`.
- **Fixture:** unstamped `generated-by: linker` atom in `Atoms/`; unit tests in `test/refreshAtoms.test.ts`.
- **QA:** body sacred; stamp CURRENT; Process collision path unchanged.

### Auto-run

- **Triggers:** App open (after index ready); hourly interval; home enable → `maybeAutoRun("manual")`; command `atoms:auto-run-now`.
- **Status:** `atoms:auto-run-status`.
- **Source:** `src/autorun.ts`, `src/main.ts` `maybeAutoRun`.
- **QA:** Same-day retry after offline; stamp only when past drained.

### For you (resurface)

- **When:** Home calm (no past wait card), not first-day setup.
- **Source:** `src/resurface.ts`.
- **Note:** Empty when all atoms same-day / young — not necessarily a bug.

## Handy CLI anchors

```bash
obsidian plugins:enabled
obsidian plugin:reload id=atoms
obsidian commands filter=atoms
obsidian command id=atoms:auto-run-status
obsidian command id=atoms:auto-run-now
obsidian command id=atoms:list-unprocessed-captures
obsidian command id=atoms:dry-run-preview
obsidian command id=atoms:process-unprocessed
obsidian command id=atoms:update-notes
```

### For you / mind-change

- Entrypoint: Atoms home “For you” when calm (no wait card).
- Source: `src/resurface.ts`, `renderMindChangeCard` in `atomsHomeView.ts`.
- Fixture: Mind-change pair.
- Notes: Max one mind-change hero per calendar day (`atoms-mind-change-day-v1`).
