# Capture shortcut — Mac + iCloud

## Preferred: Atoms capture URI (create-if-missing, silent)

The plugin registers:

```text
obsidian://atoms-capture?vault=<VaultName>&text=<url-encoded capture>
```

| Behavior | Detail |
|---|---|
| Missing daily | **Creates** today’s note (Daily Notes folder/format) |
| Existing daily | Appends only |
| Editor | **Does not open** the note (fast path) |
| Format | One top-level markdown bullet: `- your text` |
| Alias | `data=` works the same as `text=` |

### iPhone / Mac Shortcuts recipe

1. Shortcuts → **+** → name **Atoms Capture**
2. **Ask for Input** → Text, prompt `Capture`
3. **URL Encode** the Ask for Input result (or use **Encode** media)
4. **Open URLs**:

```text
obsidian://atoms-capture?vault=Remote%20Vault&text=<Encoded Text>
```

Replace `Remote%20Vault` with your vault name (spaces → `%20`).

5. Run once ▶ — if today’s daily was missing, it is created and the bullet appears
6. Share → **Copy iCloud Link** → paste into **Settings → Atoms → Capture → iCloud shortcut link**

Requires the **Atoms** plugin enabled on that device (desktop or mobile). Obsidian may come to the foreground when the URL opens; the daily note itself stays unfocused.

---

## Mac without URI (filesystem)

A Mac capture helper lives in the repo (creates the file if missing):

| Path | What |
|---|---|
| `scripts/Atoms Capture.app` | Double-click → dialog → appends `- your text` to today’s daily |
| `scripts/atoms-capture.sh` | CLI: `./scripts/atoms-capture.sh "thought"` |
| `scripts/atoms-capture-shortcut.sh` | For Shortcuts **Run Shell Script** |

Defaults: vault `~/Documents/Remote Vault`, folder `Quick Notes` (your Daily Notes settings).

**Dock it:** drag `Atoms Capture.app` to the Dock, or Spotlight “Atoms Capture”.

### Mac Shortcuts → Run Shell Script

1. Shortcuts → **+** → name **Atoms Capture**
2. **Ask for Input** → Text, prompt `Capture`
3. **Run Shell Script** → Shell `/bin/bash` · Pass Input **as arguments** · body:

```bash
/Users/a515138832/StudioProjects/obsidian_plugin/scripts/atoms-capture-shortcut.sh "$@"
```

4. Run once with ▶ to verify a bullet appears in today’s daily
5. Share → **Copy iCloud Link** → paste into Settings → Atoms → Capture

---

## Fallbacks (if you prefer)

### Option A — Obsidian app action

If you see **Append to Daily Note** / **Append to Note**:

- Vault: your vault name
- Note: Daily / today
- Text: bullet line

**Caveat:** some builds fail when today’s daily does not exist yet. Prefer the **atoms-capture** URI above.

### Option B — Advanced URI

Community plugin **Advanced URI**, then **Open URLs**:

```text
obsidian://advanced-uri?vault=Remote%20Vault&daily=true&mode=append&data=<bullet text URL-encoded>
```

Exact params depend on Advanced URI version. May still fail if the daily is missing — use `atoms-capture` instead.

### Option C — Files

Append to  
`iCloud Drive/Obsidian/Remote Vault/Quick Notes/<today YYYY-MM-DD>.md`  
only if that path matches Sync on your phone.

---

## Share the iCloud link

1. Open the shortcut → **⋯** or share sheet.
2. **Share Shortcut** → **Copy iCloud Link**.
3. Link looks like: `https://www.icloud.com/shortcuts/abc123…`
4. In Obsidian: **Settings → Atoms → Capture → iCloud shortcut link** → paste → done.
5. On phone after Sync: Atoms home → **Install capture shortcut** opens that link.

## Update later

1. Edit the shortcut (prefer URI recipe above).
2. Share → **Copy iCloud Link** again (new link if Apple reissues).
3. Paste into Settings (or bump `CAPTURE_SHORTCUT_VERSION` in code if you ship a default URL).
4. Users with an old ack see **Update**.

## Version constant

`CAPTURE_SHORTCUT_VERSION` in `src/settings/captureShortcut.ts` is the “shipped recipe” id.  
Ack is device-local (`atoms-capture-shortcut-acked-version`).  
Install URL prefers **settings** (synced), then the empty built-in constant.
