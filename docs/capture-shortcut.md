# Capture shortcut — maintainer guide

Atoms does **not** embed or push Shortcuts into iOS. The plugin opens a **versioned install URL**; the user confirms in Shortcuts.app.

## Constants (code)

In `src/captureShortcut.ts`:

| Constant | Role |
|---|---|
| `CAPTURE_SHORTCUT_VERSION` | Bump whenever the shortcut behavior changes |
| `CAPTURE_SHORTCUT_INSTALL_URL` | iCloud share link or GitHub Release asset URL |

Device-local ack key: `atoms-capture-shortcut-acked-version` (never `data.json`).

When `acked !== shipped`, home (non–first-day) shows Update; first-day setup card shows Install.

## How to publish an update

1. Build/edit the shortcut on a phone (append bullet to **today’s daily** in the vault’s Daily Notes folder).  
2. Share → **Copy iCloud Link** (or attach `.shortcut` to a GitHub Release).  
3. Set `CAPTURE_SHORTCUT_INSTALL_URL` to that link.  
4. Bump `CAPTURE_SHORTCUT_VERSION` (e.g. `1.0.0` → `1.1.0`).  
5. Ship the plugin. Users who acked the old version see **Update**.

## Intended shortcut behavior

- Input: text (Share Sheet / dictation)  
- Append a line to today’s daily as a **top-level markdown bullet**: `- {text}`  
- Target vault + Daily Notes folder must match the user’s Obsidian setup  

## Empty URL

If `CAPTURE_SHORTCUT_INSTALL_URL` is `""`, Install is disabled and Settings explains the link is not configured yet. UI still ships so open-today + first-day copy work.
