# Atoms

Obsidian plugin that turns **past daily-note captures** into a flat, linked knowledge graph.

Capture on your phone (iOS Shortcut → daily note). Atoms classifies each bullet as **atom / task / noise**, writes permanent claims into `Atoms/`, and leaves **markers** so nothing reprocesses. Person hubs you already have (e.g. `Nichita`) get links and backlinks—no CRM, no AI folders.

**Plugin id:** `atoms` · **Version:** see `manifest.json` · **Requires:** Obsidian ≥ 1.11.4, core **Daily Notes**, Anthropic API key

---

## What it does

| Step | Behavior |
|---|---|
| **Capture** | Your job — iOS Shortcut or typing bullets (`- thought`) in Daily Notes |
| **Classify** | Anthropic structured output: verdict, title, tags, links |
| **Write** | New files only in a flat folder (default `Atoms/`) + append markers under past captures |
| **People** | Vault-aware hubs + structural tags (`person`, `preferences`, `relationship`) |
| **Home** | Mobile-first **Atoms** leaf: library, waiting queue, first-day setup, preview cards |

### Non-negotiables

- Body of every atom = capture text **verbatim**
- Never move files or invent folders
- **Auto-run never processes today’s daily** (manual “Preview/Process today” exists for testing)
- API key in SecretStorage (or device-local fallback), never in `data.json`
- Two write types only: atom files + marker lines

---

## Install (this private repo)

1. Clone or download a release build (`main.js`, `manifest.json`, `styles.css`).
2. Copy into `<Vault>/.obsidian/plugins/atoms/`.
3. Enable **Atoms** in Community plugins (or unrestricted local plugins).
4. Settings → set Anthropic API key.
5. Settings → Capture → install the iOS shortcut (or use the default iCloud link baked into the plugin).

Dev install into a vault:

```bash
npm install
npm run build
./scripts/install-to-vault.sh   # or copy main.js manifest.json styles.css manually
```

---

## Capture (phone)

1. Write **bullets** in today’s daily (`- What's on your mind?`).
2. Install shortcut from **Settings → Capture** (or Atoms home → Install).
3. Shortcut should append a line like `- your text` (dash added for you).
4. **Tomorrow** (or use **Preview today / Process today** to test): Atoms home → Preview → Process.

See [docs/capture-shortcut.md](./docs/capture-shortcut.md).

---

## Development

```bash
npm install
npm run dev          # watch-build main.js
npm test
npm run build
```

Throwaway vault: `test_vault/test vault/`. Prefer that over a personal vault until dry-run looks right.

### Useful command palette entries

- **Open Atoms home**
- **Dry-run: preview classifications** / **including today (test)**
- **Process unprocessed captures** / **including today (test)**
- **Test connection**
- **Backfill: estimate cost & confirm batch**

---

## Docs

| Doc | Purpose |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Agent rules / non-negotiables |
| [docs/architecture.md](./docs/architecture.md) | System map |
| [docs/capture-shortcut.md](./docs/capture-shortcut.md) | iOS shortcut + iCloud link |
| [docs/design-handoff/atoms-view/](./docs/design-handoff/atoms-view/) | Home UI mocks |
| [docs/plans/](./docs/plans/) | Implementation plans |

---

## Repo

Private GitHub: **[taihartman/obsidian-atoms](https://github.com/taihartman/obsidian-atoms)**

(Previously `obsidian-ai-linker`; renamed with the product.)

## License

See repository license file if present; otherwise all rights reserved for this private project.
