# Capture shortcut — iCloud link

Atoms **cannot** create an iCloud link by itself. Only **Shortcuts.app** on your iPhone/Mac can. Once you have the link, paste it in **Settings → Atoms → Capture → iCloud shortcut link** (syncs with the vault).

## Build the shortcut (once, ~2 minutes)

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
