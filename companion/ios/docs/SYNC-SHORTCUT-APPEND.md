# Atoms Capture Append (Sync Remote Vault)

iOS cannot write into Obsidian Sync’s private vault folder from another app.  
The companion owns **type / voice / widget / Live Activity**. A **two-action Shortcut** is the free bridge into Sync.

## One-time setup

1. Open **Obsidian** on the phone once with the Atoms plugin so it creates:
   - note `Atoms System/Inbox.md`
   - bookmark **Atoms Inbox**
2. Open **Shortcuts** → **+** → name it exactly:

   **Atoms Capture Append**

3. Add actions:

   | # | Action | Config |
   |---|--------|--------|
   | 1 | **Receive** | Input type **Text** · from **Shortcuts** / Share Sheet |
   | 2 | **Append to Bookmark** (Obsidian) | Bookmark **Atoms Inbox** · Append · Text = **Shortcut Input** |

4. In **Atoms Capture** hub:
   - Delivery = **Obsidian Sync (Shortcut)** (default)
   - Toggle **I’ve added the Append Shortcut**
   - **Save test capture** → Shortcuts should run once → line appears in Inbox

## What the companion sends

A full inbox line (already stamped), e.g.:

```text
- 2026-08-07T16:55:01-04:00 hello from the companion
```

Do **not** Format Date in this Shortcut — the app already did that (avoids the old Format Date traps).

## Day to day

Widget / Action Button / Capture sheet → type or speak → **Save** → brief Shortcuts flash → done.  
Open Obsidian later for Sync + Process/drain.

## Optional Files mode

If you also keep a vault folder in Files, hub → Delivery → **Files folder** or **Auto**.
