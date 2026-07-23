# App Navigation Map

Living map for driving Atoms during QA. Update when commands, home cards, or settings sections change.

## Launch

| Item | Value |
|---|---|
| App | Obsidian desktop or mobile |
| Plugin id | `atoms` |
| Throwaway vault (agent QA) | `test_vault/test vault/` (gitignored) |
| Demo vault (agent dogfood) | `docs/media/demo-vault/` (synthetic seed) |
| Phone / personal vault | Human only — plugin via **BRAT** / Release; note rewrites = human (see CLAUDE.md vault lanes) |
| CLI | Settings → General → Advanced → Command line interface **ON** |
| Install (agent QA) | `./scripts/install-to-vault.sh` then `obsidian plugin:reload id=atoms` (throwaway vault only) |

## Key Surfaces

### Atoms home

- **Entrypoint:** Ribbon library icon, or command `atoms:open-home`, or open leaf type `atoms-home`.
- **How to reach:** Command palette → “Open home” (plugin name shown beside it).
- **Source:** `src/atomsHomeView.ts`, `src/atomsHomeData.ts`.
- **Fixture:** Seeded past unprocessed for wait card; atoms in `Atoms/` for library / For you.
- **Notes:** One hero: Ready / automatic filing / resurface when calm. Progress + **land peak** after Process/Update/auto-run (home open). Land peak freezes resurface, wait card, and Update strip until Done.

### Land peak (post-write Done)

- **When:** After Process / Update notes / auto-run with Atoms home open and a land payload.
- **UI:** Done status card · filed titles (max 3 + more) · Done dismiss or open title.
- **Source:** `src/home/landPeak.ts`, `fillLandPeakContent` in `atomsHomeView.ts`, `finishHomeRun` in `main.ts`.
- **QA:** No resurface under Done; wait card suppressed while landPeak set; connected later must be named (not “Related to something recent”).

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
- **Source:** `src/write.ts`, `src/preview.ts`, `src/main.ts`.

### Auto-run

- **Triggers:** App open (after index ready); hourly interval; home enable → `maybeAutoRun("manual")`; command `atoms:auto-run-now`.
- **Status:** `atoms:auto-run-status`.
- **Source:** `src/autorun.ts`, `src/main.ts` `maybeAutoRun`.
- **QA:** Same-day retry after offline; stamp only when past drained.

### Resurface (cue card)

- **When:** Home calm (`runPhase === idle`, no past wait card), not first-day setup; not under land peak.
- **Source:** `src/resurface/resurface.ts`.
- **Connected:** Named kicker only (`Because of …` / `Also about …`); soft hubs alone dropped (`People`, `Camping`, `Travel`, … via `softKeys`).
- **Note:** Empty when no eligible cue — not necessarily a bug.

### Also about (entity orbits, 0.6.24+)

- **When:** Open a generated atom **in-home** (library row → in-home) that hard-links an existing vault hub with ≥3 generated members.
- **UI:** Strip `Also about {hub} · N` → title list of siblings; tap peer opens in-home. Soft Camping-only never shows.
- **Source:** `entityOrbitIndex` / `entityOrbitPolicy` / `openAtomInHome` in `atomsHomeView.ts`.
- **QA:** Seed ≥3 linker atoms with link-prose `[[Hub]]` + hub note outside or in vault; soft-only control atoms.

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
```

### For you / mind-change

- Entrypoint: Atoms home “For you” when calm (no wait card).
- Source: `src/resurface.ts`, `renderMindChangeCard` in `atomsHomeView.ts`.
- Fixture: Mind-change pair.
- Notes: Max one mind-change hero per calendar day (`atoms-mind-change-day-v1`).
