# Atoms

Get stuff **out of your head** into Obsidian — then have it **filed, linked, and gently brought back** so you can expand on it later.

The loop is simple:

1. **Dump** — capture a thought instantly (phone shortcut or a bullet in Daily Notes). No filing UI, no folders, no “where does this go?”
2. **File** — Atoms classifies **past** captures into flat notes under `Atoms/` (title, tags, reason-bearing links). Your original words stay **verbatim** as the body.
3. **Recall** — home resurfaces filed notes (For you / mind-change / library) so you’re not stuck in a guilt task list. Open any atom in Obsidian and keep writing.

It’s a **second brain inside your vault**, not a separate app and not a CRM. Person hubs you already keep get real links and backlinks.

**Plugin id:** `atoms` · **Version:** see `manifest.json` · **Requires:** Obsidian ≥ 1.11.4, core **Daily Notes**, Anthropic API key

**Coding agents:** start at [`AGENTS.md`](AGENTS.md) (claim rules + constitution). Humans do not need to memorize process — agents must.

### Privacy & cost

- Each classify run sends **vault note titles**, tags, person-hub **titles**, and the **capture text** to the Anthropic API over TLS.
- You supply your own API key (SecretStorage). That usage is **optional paid** Anthropic billing — the plugin itself is free (MIT).
- The model never rewrites your hand-authored daily bullets. It creates flat atom files, appends markers, and (only when you choose **Update notes**) refreshes titles/links/tags on existing linker atoms — **never** the capture body.
- On Process title collision, **existing atom files are not overwritten** (protect-existing).
- Auto-run (device-local, default off) requires a one-time egress acknowledgment.

---

## What it does

| Step | Behavior |
|---|---|
| **Capture** | Instant dump — iOS Shortcut or typing bullets (`- thought`) in Daily Notes. Capture UI is not this plugin. |
| **Classify** | Anthropic structured output: keepable **atom** vs logistics **noise** (task soft-retired). Title, tags, reason-bearing links. |
| **Write** | New flat files (default `Atoms/`) + append markers under past captures so nothing reprocesses. |
| **Update notes** | Optional: re-run the same AI path on older atoms so titles/links match newer filing quality; body stays put. |
| **People** | Vault-aware person hubs + structural tags — no AI folders, no CRM. |
| **Home** | Mobile-first leaf: wait to file, library, first-day setup, **For you** resurface (incl. mind-change), progress while Preview/Process runs. |
| **Atom graph** | Command palette → **Open atom graph** — Global Graph filtered to atoms and notes they connect to (not the whole vault hairball). |

### Non-negotiables

- Body of every atom = capture text **verbatim**
- Never move files or invent folders
- **Auto-run never processes today’s daily** (manual “Preview/Process today” exists for testing)
- API key in SecretStorage (or device-local fallback), never in `data.json`
- Write types: new atom files · append-only markers · user-initiated Update notes (model surfaces only)
- Second brain, not a task app — no due-date queue

---

## Install

### Community plugins (once listed)

1. Settings → **Community plugins** → turn on community plugins if needed.
2. **Browse** → search **Atoms** → Install → Enable.
3. Continue with [First-run setup](#first-run-setup).

### Manual / beta (GitHub Release)

Use this before Community listing, or to pin a specific version:

1. Open the latest [GitHub Release](https://github.com/taihartman/obsidian-atoms/releases) and download `main.js`, `manifest.json`, and `styles.css`.
2. Create `<Vault>/.obsidian/plugins/atoms/` and copy those three files into it.
3. Settings → Community plugins → refresh → enable **Atoms**.

Optional beta channel: install via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) pointing at `taihartman/obsidian-atoms`.

### First-run setup

1. Settings → **Atoms** → set your Anthropic API key (SecretStorage).
2. Confirm core **Daily Notes** is enabled.
3. Settings → Capture → install the iOS shortcut (or use the default iCloud link).
4. Capture bullets in daily notes, then use **Atoms** home → Preview → Process on **past** days (or the “including today” commands only for testing).

---

## How to use (walkthrough)

Empty vault → dump into Daily → file into a linked library → open notes in Obsidian whenever you want to expand them. Screenshots are **phone-frame** product UI with synthetic dogfood (not personal notes).

### 1. First open — empty home

Open **Atoms** from the ribbon (library icon) or command palette → **Open home**. With no filed atoms yet, you get a setup card: write one bullet today, open today’s daily, install the capture shortcut.

![Atoms first-day home with Get started card](docs/media/readme/01-first-day-home.png)

### 2. Capture as daily bullets

Get it out of your head: top-level bullets in a **past** daily note (or today’s note if you only want to test later with “including today”). Phone shortcut or desktop typing both work.

![Past daily note with unprocessed capture bullets](docs/media/readme/02-daily-captures.png)

### 3. Waiting to file

When past days have unmarked bullets, home shows a **waiting** card (and a queue peek). Today’s daily is never auto-processed. Add an API key if prompted, then Preview / Process (or enable automatic filing after the privacy ack).

![Atoms home showing past captures waiting to file](docs/media/readme/03-waiting-to-file.png)

### 4. Library after filing

Filed claims land as flat notes under `Atoms/`. Home lists them with optional person / work chips. Tap a row to open the atom in Obsidian and keep writing.

![Atoms library populated with filed notes and link chips](docs/media/readme/04-library-populated.png)

### 5. An atom note

Each atom keeps your capture text **verbatim**, plus frontmatter (`created`, `source`, tags, `generated-by`, quality stamps) and reason-bearing links the model proposed. Expand the note like any other Obsidian file.

![Example atom note with verbatim body and person link](docs/media/readme/05-atom-note.png)

### 6. Person hubs

Link to a person note you already keep (e.g. `People/Jordan`). Backlinks surface preferences and related atoms without a separate CRM.

![Person hub note for Jordan](docs/media/readme/06-person-hub.png)

### 7. Settings

**Settings → Atoms**: API key (SecretStorage), capture shortcut URL, model, atom folder, vocabulary. Version is shown at the top of the tab.

![Atoms plugin settings](docs/media/readme/07-settings-atoms.png)

### After you’re set up

- **For you** on home gently resurfaces filed atoms (calendar day, connections, quiet spacing) and mind-change pairs when you revised yourself — stream, not a review queue.
- **Update notes** (home strip or command) refreshes older atoms to current filing quality when the pipeline improves; original capture text still never changes.

---

## Capture (phone)

1. Dump a thought as a **bullet** in today’s daily (`- What's on your mind?`).
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
./scripts/install-to-vault.sh   # copy build into the throwaway vault
node scripts/seed-demo-vault.mjs           # synthetic README dogfood (full library)
node scripts/seed-demo-vault.mjs --empty   # first-day empty
node scripts/seed-demo-vault.mjs --waiting # past captures pending
```

Throwaway vault: `test_vault/test vault/`. Prefer that over a personal vault until dry-run looks right.

README screenshots use **`docs/media/demo-vault/`** with fictional sample notes only (`seed-demo-vault.mjs`). Do not seed personal vault content into that folder.

### Useful command palette entries

- **Open home**
- **Dry-run: preview classifications** / **including today (test)**
- **Process unprocessed captures** / **including today (test)**
- **Update notes (refresh older atoms to current quality)**
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

**[taihartman/obsidian-atoms](https://github.com/taihartman/obsidian-atoms)**

Releases ship `main.js`, `manifest.json`, and `styles.css` for manual install and for the Community directory once listed.

(Previously `obsidian-ai-linker`; renamed with the product.)

## License

MIT — see [LICENSE](./LICENSE).
