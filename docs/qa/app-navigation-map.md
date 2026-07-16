# App Navigation Map

Living map for Obsidian Atoms plugin QA. Not a web app — surfaces are Obsidian leaves, commands, and Settings.

## Launch

- Run command: Obsidian open on vault → `./scripts/install-to-vault.sh` → `obsidian plugin:reload id=atoms`.
- Primary device: phone via Sync (`Remote Vault`) or desktop throwaway vault.
- Auth path: Settings → Atoms → Anthropic API key (SecretStorage). Optional for dry-run/fixture/unit.

## Key Surfaces

### Atoms home

- Entrypoint: Command palette **Open Atoms home** / ribbon / leaf type `atoms-home`.
- How to reach: enable plugin → open home leaf.
- Source anchors: `src/atomsHomeView.ts`, `styles.css`.
- Fixture: library atoms in `Atoms/`; optional unprocessed dailies for wait card.
- Notes: mobile-first; For you hero only when calm (no wait card).

### For you / mind-change

- Entrypoint: Atoms home scroll, section “For you”.
- How to reach: home with zero unprocessed past captures + eligible resurface candidate.
- Source anchors: `src/resurface.ts` (`listResurfaceCandidates`, `pickResurface`), `renderResurfaceCard` / `renderMindChangeCard`.
- Fixture: Mind-change pair (see `testing-fixtures.md`).
- Notes: Max one mind-change hero per calendar day (device-local `atoms-mind-change-day-v1`).

### Home open + citator

- Entrypoint: Mind-change **Open**, or future home atom open path.
- Source anchors: `openAtomInHome`, `renderHomeOpen`, `citatorChipsForAtom`.
- Notes: **Not** injected into Obsidian editor; “Open in vault” leaves pure note.

### Dry-run / Process

- Commands: `atoms:dry-run-preview`, `atoms:process-unprocessed`, `atoms:process-fixture-sample`.
- Source: `main.ts`, `preview.ts`, `write.ts`.

### Settings → Atoms

- Version display; API key; capture shortcut; auto-run.
- Source: `settings.ts`.
