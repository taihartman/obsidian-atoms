# Atoms view — design handoff (settled)

**Status:** design locked after adversarial review (2026-07-15); **first-day loop** added (2026-07-15); **home v2** mock (2026-07-15); **update linking** mock (2026-07-16).  
**Open mocks:**  
- `index.html` — steady + waiting (v1)  
- `first-day.html` — setup + shortcut  
- **`home-v2.html`** — For you · one hero · typed chips (person/work, max 2) — **settled; implemented 0.5.2**  
- **`update-linking.html`** — quality upgrade path: home strip → review sheet → done (draft; not implemented)
- **`person-hub-invite.html`** — **Add {Name}?** people-only invite (settled product; not implemented)
- **`land-then-remember.html`** — **Land, then remember**: post-write peak (Process / Update / auto-run), 0·1·many counts, Done dismiss, named connected or silence, bridge tap, light theme (draft; not implemented)
- **`soft-unfreeze-reconsider.html`** — **Reconsider capture** (#100): cursor on skipped line → classify once → Now → Proposed sheet → Apply (draft; not implemented)

## Product job

Atoms **classifies past captures** and writes **flat atoms + markers**. The UI must support:

1. **Trust / process** when work is pending (preview before write)  
2. **Proof of what landed** when the queue is clear (library of atoms, with links visible)  
3. **First-day bridge** when nothing is filed yet: open today, install/update capture shortcut, teach bullets  

It is **not** a second file browser, not a People CRM, not an API console.

## Settled information architecture

### One home: **Atoms** (not four tabs, not equal dual-tabs)

| State | What you see |
|---|---|
| **Queue clear** | Large title **Atoms** · list of **recent atom notes** (Atoms-native rows) |
| **Work pending** | Same shell · **dominant waiting card** · optional queue peek · primary **Preview** |

**Links is not a v1 tab.** Connections show as:
- Orange / accent chips on Recent rows (`Alex`)  
- Optional filter chip: **All | Linked**  
- Tapping a chip or row opens the note (hub or atom); Obsidian Backlinks do the rest  

v1.1+ only if we need “hubs with *new* backlinks this week” as its own surface.

### Process is a state, not a place you live

- Banner/card when `unprocessedCount > 0` — high contrast, hard to miss  
- Sheet / flow: **Preview first**, then Process  
- ⋯ menu: Backfill, Test connection, Status, Capture shortcut  
- ⚙ → Plugin settings  

### First-day / empty library (no past queue)

When `atoms.length === 0` and `unprocessedCount === 0`:

- **Setup card** (not a blank void): Open today · Install/Update shortcut · bullet example  
- **Header ◎** always opens/creates today’s daily (never processes it)  
- **Shortcut update banner** when shipped `CAPTURE_SHORTCUT_VERSION` &gt; device-acked version  

Detail + interactive states: `first-day.html`. Plan: `docs/plans/2026-07-15-004-feat-first-day-capture-loop-plan.md`.

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

### Update notes — Process parity (quality stamp + AI refresh)

When older atoms were filed under a weaker pipeline, home may show a **secondary** strip (never competing with Process as the hero):

- **Parity:** same AI classify + enrich pipeline as Process (not a local-only polish)  
- **Body sacred:** original capture text never changes  
- **Model may change:** title, tags, link notes / reasons  
- **Needs API key** (same as Process)  
- **Happy path:** strip (**Update**) → **light confirm** → run → done  
- Optional deep review later; not the default door  
- Stamps: `atoms-quality` + `quality-updated` in frontmatter  

Mock: `update-linking.html` (v3). Plan: `docs/plans/2026-07-16-015-feat-atoms-quality-stamp-and-improve-plan.md`.

## Open only at implement time

- Exact filter chips (All / Linked only vs + This week)  
- Whether task/noise markers appear in a collapsed “Also processed” section (default: **atoms only** on home)  

 
