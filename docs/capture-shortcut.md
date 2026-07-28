# Capture shortcut — Capture to Bookmark

Capture on the phone appends one line to the inbox note. The plugin files that
line into the right daily when Obsidian next opens. This recipe is the whole
capture path — there is no filing UI on the phone.

## What the plugin owns

The plugin creates both of these on load, so you never make them by hand:

| Thing | Value |
|---|---|
| Inbox note | `Atoms System/Inbox.md` |
| Bookmark | **Atoms Inbox** (points at that note) |

The Shortcut appends to the **Atoms Inbox** bookmark. On the next Obsidian launch
(or the **Drain capture inbox into dailies** command) each line is routed into the daily note for the
date in its stamp — creating that daily if missing — and marked, never deleted.

## The recipe

On **iPhone**: Shortcuts → **+** → name it **Atoms Capture**. Add these actions
in order:

| # | Action | Config |
|---|---|---|
| 1 | **Ask for Input** (or **Receive** Text from the share sheet — set in shortcut details) | Prompt `Capture` · type **Text** |
| 2 | **Replace Text** | Find `\n` · Replace with `\n\t` · **Regular Expression** on. Turns dictated line breaks into indented continuation lines the parser keeps. |
| 3 | **Format Date** | Date **Current Date** · Format **Custom** · format string `yyyy-MM-dd'T'HH:mm:ssZZZZZ`. Produces `2026-07-28T09:14:03-04:00` — seconds and UTC offset both matter. |
| 4 | **Text** | `- ` then the **Formatted Date** (step 3), a space, then the **Updated Text** (step 2). One bullet: `- <stamp> <capture>`. |
| 5 | **Capture to Bookmark** (Obsidian) | Bookmark **Atoms Inbox** · **Append** · Text = the **Text** from step 4. |

Run it once with ▶ and confirm a new line lands in `Atoms System/Inbox.md`.

Why each step is shaped this way:

- **Seconds are required** (step 3). Two captures in the same minute would
  otherwise share a stamp; the seconds keep them distinct.
- **Capture to Bookmark adds its own newline and no bullet**, so step 4 builds
  the whole `- ` bullet itself and step 5 supplies no trailing newline.

## Three things to know

**Renaming the inbox note breaks the Shortcut.** The Capture to Bookmark action
binds its bookmark reference at setup time, so moving or renaming
`Atoms System/Inbox.md` makes the Shortcut prompt for the bookmark on every run
until you edit the shortcut and re-select it. This is why the path is a fixed
constant, not a setting.

**With Obsidian closed, a capture is on disk immediately but not yet synced.**
The line is written to the local inbox note at once; it reaches your other
devices only after Obsidian is opened on the phone. Nothing is lost — that is
Obsidian Sync behavior, not the plugin's.

**The old daily-note recipe is superseded on purpose.** Obsidian's
**Capture to Daily Note** action fails with *File not found* when today's daily
does not yet exist, because the daily is only created when Obsidian opens —
exactly the force-quit case capture has to survive. Reported against iOS 1.11.5,
promised for 1.11.6, still reproducing on 1.12.7 as of June 2026. Capture to
Bookmark writes to a note that already exists, so it never hits that bug.

## Install and update from the plugin

The plugin can open a shared iCloud link for this recipe:

1. Build the shortcut above, then Share → **Copy iCloud Link**
   (`https://www.icloud.com/shortcuts/…`). Apple only mints these from
   Shortcuts.app on your device — neither the plugin nor an agent can.
2. Obsidian → **Settings → Atoms → Capture** → paste the link.
3. On the phone after Sync, Atoms home → **Install capture shortcut** opens it.

`CAPTURE_SHORTCUT_VERSION` in `src/settings/captureShortcut.ts` is the
shipped-recipe id; the ack is device-local
(`atoms-capture-shortcut-acked-version`). Bump it when the recipe changes and
users with an old ack see **Update capture shortcut**.
