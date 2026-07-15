# Atoms view — design handoff (settled)

**Status:** design locked after adversarial review (2026-07-15).  
**Open mock:** `index.html`

## Product job

Atoms **classifies past captures** and writes **flat atoms + markers**. The UI must support:

1. **Trust / process** when work is pending (preview before write)  
2. **Proof of what landed** when the queue is clear (library of atoms, with links visible)

It is **not** a second file browser, not a People CRM, not an API console.

## Settled information architecture

### One home: **Atoms** (not four tabs, not equal dual-tabs)

| State | What you see |
|---|---|
| **Queue clear** | Large title **Atoms** · list of **recent atom notes** (Atoms-native rows) |
| **Work pending** | Same shell · **dominant waiting card** · optional queue peek · primary **Preview** |

**Links is not a v1 tab.** Connections show as:
- Orange / accent chips on Recent rows (`Nichita`)  
- Optional filter chip: **All | Linked**  
- Tapping a chip or row opens the note (hub or atom); Obsidian Backlinks do the rest  

v1.1+ only if we need “hubs with *new* backlinks this week” as its own surface.

### Process is a state, not a place you live

- Banner/card when `unprocessedCount > 0` — high contrast, hard to miss  
- Sheet / flow: **Preview first**, then Process  
- ⋯ menu: Backfill, Test connection, Status  
- ⚙ → Plugin settings  

### Recent rows must be Atoms-native (or we don’t build this)

Each row shows at least:
- Declarative **title** (atom file title)  
- **Link chips** if any (person hubs etc.)  
- Light meta: from daily date · relative time  
- Tap → open atom in editor  

Not a bare `ls` of filenames with no Atoms meaning.

## Explicit non-goals (v1)

- People / Links / Status / Inbox as equal tabs  
- Mini graph explorer  
- Replacing Navigator / Daily for capture  
- Auto-process from the home screen without Preview affordance when user is still learning trust  

## Implementation notes (for later `ce-plan`)

- Obsidian `ItemView` + ribbon / left drawer registration  
- Mobile-first layout; desktop = same view in sidebar leaf + editor  
- Data: `Atoms/` mtime list; unprocessed via existing daily parse; hubs optional chips from classification frontmatter/links in atom files  
- Reuse dry-run / write commands behind Preview / Process  

## Open only at implement time

- Exact filter chips (All / Linked only vs + This week)  
- Whether task/noise markers appear in a collapsed “Also processed” section (default: **atoms only** on home)  
