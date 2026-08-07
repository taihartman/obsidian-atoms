# Atoms Capture Append (slim Sync bridge)

**Not** Capture Atom (that one has Type/Voice). This shortcut only appends.

| | |
|--|--|
| Name | `Atoms Capture Append` |
| Input | Full stamped line from the companion |
| Action | Append to Obsidian bookmark **Atoms Inbox** |

## Recipe (publisher / first device)

1. Open Obsidian once (Atoms creates Inbox + **Atoms Inbox** bookmark).
2. Shortcuts → **+** → name **Atoms Capture Append**.
3. **Receive** → Text from Shortcuts.
4. **Append to Bookmark** (Obsidian) → **Atoms Inbox** → Text = Shortcut Input.
5. Share → **Copy iCloud Link**.
6. Paste URL into `DeliverySettings.bundledAppendShortcutURL` (and optionally plugin settings later).

**Shipped install URL (2026-08-07):**  
https://www.icloud.com/shortcuts/9f7425ab9eb94884b610667a69a8e38b  

Name after install must remain **Atoms Capture Append** (or match `DeliverySettings.appendShortcutName`).

## User experience

- Hub → **Install Atoms Capture Append** (iCloud) → Add Shortcut.
- Or guided sheet until the link is shipped.
- Day to day: companion only; brief Shortcuts flash on Save.
