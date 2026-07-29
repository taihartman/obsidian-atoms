# Capture Atom — the iOS capture Shortcut

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

Built and verified on device 2026-07-28 (iOS Shortcuts, Obsidian 1.12.7).

On **iPhone**: Shortcuts → **+** → name it **Capture Atom**. Add these actions
in order:

| # | Action | Config |
|---|---|---|
| 1 | **Choose from Menu** | Two items: `Type` and `Voice`. Lets one shortcut serve both keyboard and dictation. |
| 2 | *(Type branch)* **Ask for Input** | Prompt `What's on your mind?` · type **Text** |
| 3 | *(Type branch)* **Set Variable** | Name `Capture` · value **Provided Input** |
| 4 | *(Voice branch)* **Dictate Text** | Defaults are fine |
| 5 | *(Voice branch)* **Set Variable** | Name `Capture` · value **Dictated Text** |
| 6 | **Replace Text** | Find `\n` · Replace with `\n\t` · **Regular Expression** on · Input **`Capture`**. Turns dictated line breaks into indented continuation lines the parser keeps. |
| 7 | **Format Date** | Date **Current Date** · then open the *action's own* options: Date Format **Custom**, Format String `yyyy-MM-dd'T'HH:mm:ssZZZZZ`, Locale **Default**. |
| 8 | **Text** | `- ` then **Formatted Date** (step 7), one space, then **Updated Text** (step 6). All on one line: `- <stamp> <capture>`. |
| 9 | **Append to Bookmark** (Obsidian) | Bookmark **Atoms Inbox** · **Append** · Text = the **Text** from step 8. |

Run it with ▶ and confirm one new line lands in `Atoms System/Inbox.md`, shaped
exactly like:

```
- 2026-07-28T17:23:34-04:00 Test
```

### Two traps that cost real time

Both were hit while building this on device. The symptom in each case is a line
that reaches the inbox but never files.

**Set the format string on the Format Date *action*, not on the `Current Date`
variable.** Tapping the blue `Current Date` chip opens the magic-variable panel
(it has *Clear Variable* / *Return* buttons and Date/Time/Name rows). Setting a
custom format there does **not** change what the action outputs — the action
keeps its own default and emits Short style, `7/28/26, 12:00 PM`. The field you
want is behind the action's own disclosure arrow, labelled **Format String**,
next to **Date Format** and **Locale**.

**Use `ZZZZZ`, not `Z`.** A single `Z` renders the offset as `-0400`; the parser
requires `-04:00`. The default custom format Shortcuts offers
(`EEE, dd MMM yyyy HH:mm:ss Z`) is wrong on both counts.

A related tell: if the stamp's time is always `12:00:00`, the `Current Date`
variable is set to the **Date** component only, so the time was truncated to
noon. Clear the variable and re-insert it without picking a component.

Why the rest is shaped this way:

- **Seconds are required** (step 7). Two captures in the same minute would
  otherwise share a stamp, and the drain's duplicate protection compares the
  daily line's time against the inbox capture's — matching on `HH:MM` alone
  would collapse them.
- **Set an explicit `Capture` variable** (steps 3 and 5) rather than relying on
  a menu-result variable, which does not reliably carry the chosen branch's text.
- **Append to Bookmark adds its own newline and no bullet**, so step 8 builds
  the whole `- ` bullet itself and step 9 supplies no trailing newline.

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
3. On the phone after Sync, Atoms home → **Install Capture Atom** opens it.

`CAPTURE_SHORTCUT_VERSION` in `src/settings/captureShortcut.ts` is the
shipped-recipe id; the ack is device-local
(`atoms-capture-shortcut-acked-version`). Bump it when the recipe changes and
users with an old ack see **Update Capture Atom**.
