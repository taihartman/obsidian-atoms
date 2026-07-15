# Capture shortcut — Mac + iCloud

## Mac right now (works without iCloud)

A Mac capture helper lives in the repo:

| Path | What |
|---|---|
| `scripts/Atoms Capture.app` | Double-click → dialog → appends `- your text` to today’s daily |
| `scripts/atoms-capture.sh` | CLI: `./scripts/atoms-capture.sh "thought"` |
| `scripts/atoms-capture-shortcut.sh` | For Shortcuts **Run Shell Script** (see below) |

Defaults: vault `~/Documents/Remote Vault`, folder `Quick Notes` (your Daily Notes settings).

**Dock it:** drag `Atoms Capture.app` to the Dock, or Spotlight “Atoms Capture”.

That is **enough for Mac capture**. iCloud is only needed so **phone** can install the same idea via a share link.

### “Unknown Action” on Mac

If **Capture to Daily Note** shows *This action could not be found in this version of Shortcuts*, it used an **Obsidian iOS-only** action. Delete that action (or the whole shortcut) and rebuild:

1. Shortcuts → **+** → name **Atoms Capture**  
2. **Ask for Input** → Text, prompt `Capture`  
3. **Run Shell Script** → Shell `/bin/bash` · Pass Input **as arguments** · body:

```bash
/Users/a515138832/StudioProjects/obsidian_plugin/scripts/atoms-capture-shortcut.sh "$@"
```

4. Run once with ▶ to verify a bullet appears in today’s daily  
5. Share → **Copy iCloud Link** → paste into Settings → Atoms → Capture  

A copy of these steps is also on your Desktop: `Atoms-Capture-Shortcut-Setup.txt`.

## iCloud link (phone install)

**Neither this agent nor the plugin can mint `icloud.com/shortcuts/…` links.**  
Apple only issues those when **you** share from Shortcuts.app.

You already have a shortcut named **Capture to Daily Note** on this Mac (`shortcuts list`). Open it with:

```bash
shortcuts view "Capture to Daily Note"
```

Then: ensure it appends a **bullet** to today’s daily → Share → **Copy iCloud Link** → paste into **Settings → Atoms → Capture → iCloud shortcut link**.

---

## Build a new Shortcuts.app recipe (if you prefer)

On **iPhone** (or Mac with Shortcuts):

1. Open **Shortcuts** → **+** → name it **Atoms Capture**.
2. Add actions in order:

| # | Action | Config |
|---|---|---|
| 1 | **Ask for Input** (or **Receive** Text from Share Sheet — enable in shortcut details) | Prompt: `Capture` · Input type: Text |
| 2 | **Text** | `- ` then insert the **Provided Input** / Ask for Input variable (so the line is a markdown bullet) |
| 3 | **Append to Note** (Obsidian) *or* open Obsidian via URL* | See options below |

### Option A — Obsidian app action (if available)

If you see **Obsidian** actions:

- **Append to Daily Note** / **Append to Note**  
- Vault: **Remote Vault** (your vault name)  
- Note: **Daily Note** / today  
- Text: the bullet line from step 2  

### Option B — Advanced URI (common)

1. Install community plugin **Advanced URI** in Obsidian (desktop + mobile).  
2. Shortcut ends with **Open URLs**:

```text
obsidian://advanced-uri?vault=Remote%20Vault&daily=true&mode=append&data=<bullet text URL-encoded>
```

Use **URL Encode** on the bullet text, then insert into `data=`.

Exact query params depend on Advanced URI version — check its docs for “append to daily”.

### Option C — Files (fallback)

Append to  
`iCloud Drive/Obsidian/Remote Vault/Quick Notes/<today YYYY-MM-DD>.md`  
only if that path matches Sync on your phone.

## Share the iCloud link

1. Open the shortcut → **⋯** or share sheet.  
2. **Share Shortcut** → **Copy iCloud Link**.  
3. Link looks like: `https://www.icloud.com/shortcuts/abc123…`  
4. In Obsidian: **Settings → Atoms → Capture → iCloud shortcut link** → paste → done.  
5. On phone after Sync: Atoms home → **Install capture shortcut** opens that link.

## Update later

1. Edit the shortcut.  
2. Share → **Copy iCloud Link** again (new link if Apple reissues).  
3. Paste into Settings (or bump `CAPTURE_SHORTCUT_VERSION` in code if you ship a default URL).  
4. Users with an old ack see **Update**.

## Version constant

`CAPTURE_SHORTCUT_VERSION` in `src/captureShortcut.ts` is the “shipped recipe” id.  
Ack is device-local (`atoms-capture-shortcut-acked-version`).  
Install URL prefers **settings** (synced), then the empty built-in constant.
