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
**2.2 intent (companion):** accept **Shortcut Input** when the Atoms Capture app
(or anything else) runs Capture Atom with text, so users never build a second
shortcut. Standalone ▶ still offers Type / Voice.

On **iPhone**: install via Atoms Settings → Capture (or the companion hub button).
Name must stay **Capture Atom**. Actions in order:

| # | Action | Config |
|---|---|---|
| 0 | **If** | Shortcut Input **has any value** → **Set Variable** `Capture` = **Shortcut Input** → skip to step 6. *Else* continue to step 1. |
| 1 | **Choose from Menu** | Two items: `Type` and `Voice`. Standalone path only. |
| 2 | *(Type branch)* **Ask for Input** | Prompt `What's on your mind?` · type **Text** |
| 3 | *(Type branch)* **Set Variable** | Name `Capture` · value **Provided Input** |
| 4 | *(Voice branch)* **Dictate Text** | Defaults are fine |
| 5 | *(Voice branch)* **Set Variable** | Name `Capture` · value **Dictated Text** |
| 6 | **Replace Text** | Find `\n` · Replace with `\n\t` · **Regular Expression** on · Input **`Capture`**. Turns dictated line breaks into indented continuation lines the parser keeps. |
| 7 | **Format Date** | Date **Current Date** · then open the *action's own* options: Date Format **Custom**, Format String `yyyy-MM-dd'T'HH:mm:ssZZZZZ`, Locale **Default**. |
| 8 | **Text** | `- ` then **Formatted Date** (step 7), one space, then **Updated Text** (step 6). All on one line: `- <stamp> <capture>`. |
| 9 | **Append to Bookmark** (Obsidian) | Bookmark **Atoms Inbox** · **Append** · Text = the **Text** from step 8. |

**Companion app:** runs `shortcuts://run-shortcut?name=Capture%20Atom&input=text&text=…`
with the **body only** (no stamp). Capture Atom still owns Format Date + append —
one recipe for plugin install and the companion.

**Until 2.2 is published on iCloud:** an older Capture Atom may ignore input and
show the Type/Voice menu. Re-install from Atoms Settings after the link bumps.

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

## First run on a new phone (lock the bookmark once)

The plugin creates **Atoms Inbox**. It cannot edit Shortcuts.app. A shared
iCloud install often leaves **Append to Bookmark** empty or set to Ask Each
Time, so every run asks which bookmark (or vault) to use even though capture
still works after you pick.

**Do this once per phone after Add Shortcut:**

1. Open **Obsidian** on that phone with Atoms enabled (so **Atoms Inbox** exists
   in Bookmarks).
2. Open **Shortcuts** → **Capture Atom** → tap to **edit** (not just Run).
3. Find **Append to Bookmark** (Obsidian).
4. Set the bookmark to **Atoms Inbox**. Do not leave **Ask Each Time**.
5. Tap **Done**.

Run Capture Atom again. It should no longer prompt. Choosing only during a run
does not save the choice; only the edit screen does.

If it still asks every time: confirm Bookmarks is on in Obsidian, **Atoms Inbox**
appears in the Bookmarks pane, and you are writing into the vault that has that
bookmark.

## Three things to know

**Renaming the inbox note breaks the Shortcut.** The Capture to Bookmark action
binds its bookmark reference at setup time, so moving or renaming
`Atoms System/Inbox.md` makes the Shortcut prompt for the bookmark on every run
until you edit the shortcut and re-select it. Same fix as above: edit → set
**Atoms Inbox** → Done. This is why the path is a fixed constant, not a setting.

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

Atoms ships a built-in iCloud link for this recipe, so most users paste
nothing: **Settings → Capture → Install Capture Atom** (or Atoms home) opens
the current one, and a plugin update moves everyone to a newer link
automatically. After Add Shortcut, lock **Atoms Inbox** once (see above).

**Settings → Atoms → Capture → Custom shortcut link is optional**, and only for
people who modified the recipe:

1. Build your own variant, then Share → **Copy iCloud Link**
   (`https://www.icloud.com/shortcuts/…`). Apple only mints these from
   Shortcuts.app on your device — neither the plugin nor an agent can.
2. Obsidian → **Settings → Atoms → Capture** → paste it into *Custom shortcut
   link*. This wins over the built-in from then on, which also means shipped
   link updates stop reaching you.
3. Clear the field (or press **Use built-in**) to go back to the shipped link.

Pasting a link Atoms itself ships is treated as *no* custom link — see
`BUILTIN_INSTALL_URLS`. Users copied the default into that field thinking it was
required, which pinned them to whatever link was current that day. Matching
ignores cosmetic differences (trailing slash, host case, empty `?`/`#`), since
those are the same shortcut wearing a different string.

**To ship a new link, prepend it to `BUILTIN_INSTALL_URLS`.**
`CAPTURE_SHORTCUT_INSTALL_URL` is the head of that list, so there is no second
edit to forget, and `test/captureShortcut.test.ts` freezes the full shipped set —
dropping an entry fails there rather than silently re-pinning everyone who still
stores it.

`CAPTURE_SHORTCUT_VERSION` in `src/settings/captureShortcut.ts` is the
shipped-recipe id; the ack is device-local
(`atoms-capture-shortcut-acked-version`). Bump it when the recipe changes and
users with an old ack see **Update Capture Atom**.
