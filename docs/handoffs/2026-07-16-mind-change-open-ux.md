---
handoff_date: 2026-07-16
branch: docs/belief-rehearsal-hero-and-qa
worktree: /Users/a515138832/StudioProjects/obsidian_plugin
base: master
tracking: none (no GitHub Issue claimed yet — design-only)
status: in-progress
---

# Handoff — Mind-change hero + Open pair UX

You are picking up this work in a fresh session. Read this file top to bottom, run **How to resume**, then continue from **Next steps**. Everything load-bearing is here — do not re-open the old chat.

## Goal

Make **mind-change** (For you hero) and its **Open** flow clear: show the belief pair (Then = old fossil claim, Now = later revises|contradicts) without inventing a foreign brand. Design mocks first; **do not ship product code until a hard claim exists** (Issue + STATUS row + draft PR).

## Current status

### What works in the live plugin (unchanged this session)

| Surface | Behavior | Code |
|---|---|---|
| Cue priority | mind-change → on-this-day → connected → quiet | `src/resurface/resurface.ts` pick path ~483+ |
| Candidate shape | `path` / `bodySnippet` / `title` = **old** atom; `laterTitle` / `laterPath` / `relation` = **new** | `listMindChangeCandidates` ~199–243 |
| Hero card | kicker “Mind change”; primary = old body; later line = `Later you wrote {title} · revises\|contradicts` | `renderMindChangeCard` `atomsHomeView.ts` ~489–548; `mindChangeLaterLine` ~612 |
| Open | `openAtomInHome(card.path)` → **old atom only** + citator chips + body ≤1200 + Open in vault | ~550–624 |
| Throttle | 1 mind-change hero/day + pair key throttle | `mindChangeDayShown`, `mindChangePairThrottle` |
| Product colors | Obsidian CSS vars + mind purple `#bf5af2` on citator chips / mind card | `styles.css` ~400–405, ~495–496 |

**UX bug (confirmed with human):** After Open, the Then/Now story collapses to a single note. Opening the **old** fossil usually shows inbound chip `Revised by · {new title}` — the later **body** is never on screen. Human found this unclear.

### Design exploration done (mocks only — not product)

| File | Role | Verdict |
|---|---|---|
| `docs/design-handoff/belief-rehearsal/mind-change-hero.html` | Then/Now markup on iOS-ish chrome | Baseline clarity idea (Then/Now labels) |
| `mind-change-hero-ab.html` | A Then/Now vs B Pro-Max glass | B craft better but “super AI like” — **rejected as direction** |
| `mind-change-hero-abc.html` | A Original · B frontend-design · C Hallmark | B preferred over C but still felt AI (foreign brand) |
| `mind-change-hero-native.html` | Ship copy vs Then/Now **on Atoms chrome** (no new fonts/palette) | Right DNA direction for hero |
| `home-open-citator.html` | Generic home-open + chips | **Wrong POV** for mind-change Open (shows newer atom / Revises · old) |
| **`mind-change-open-pair.html`** | **Latest pair-open mock** | Structure agreed; **colors/fonts still foreign** (cool slate + Fraunces + `#8aa4ff`) — human said not app colors; tokens needed but **agent should not lead token inventing** |

### Skills installed in repo (this branch WIP)

- `.agents/skills/frontend-design` — anthropics/skills
- `.agents/skills/hallmark` — nutlope/hallmark  
- `skills-lock.json` pins both

Use **frontend-design** for distinctive structure; use **Hallmark** only if you want anti-slop gates. Neither licenses inventing a new brand for Atoms.

### Process / claims

- **No STATUS claim** for mind-change UI ship. `STATUS.md` currently has #25 (CI closes-issue) only.
- Branch `docs/belief-rehearsal-hero-and-qa` is **docs/mocks + QA artifacts** only so far; product `src/` not modified for Then/Now.
- Multiplayer: claim Issue → STATUS row → draft PR **before** any `src/` implementation.

## Next steps

1. **Land on this branch/worktree** (see How to resume). Open the latest mock:
   ```bash
   open docs/design-handoff/belief-rehearsal/mind-change-open-pair.html
   open docs/design-handoff/belief-rehearsal/mind-change-hero-native.html
   ```
2. **Recolor pair-open to product DNA** — only when the human drives tokens. Source of truth for live UI:
   - `styles.css` (mind `#bf5af2`, Obsidian `--background-*` / `--text-*` vars)
   - `docs/design-handoff/belief-rehearsal/mind-change-hero-native.html` (Atoms home chrome)
   - `docs/design-handoff/atoms-view/` if present for home shell
   - **Do not** invent parchment/gold/book-spine, cool-slate “editorial app”, or random accent blues as product.
3. **Lock structure (already decided — do not relitigate):**
   - Open from mind-change = **pair view**, not generic single-atom `renderHomeOpen`
   - **Then** = old body (fossil first, full claim text)
   - **Now** = later claim + relation `revises` | `contradicts` only
   - Both bodies visible when possible (later body may need load from `laterPath`)
   - Back = plain `‹ For you` (same as ship)
   - Per claim: one action **“Open this note in vault ›”** (not Earlier/Later dual nav — human found those confusing)
4. When visual is approved: **claim work** (Issue + STATUS + draft PR), then implement pair-open in `atomsHomeView.ts` (new render path from mind-change Open; keep generic `renderHomeOpen` for other entry points if still needed).
5. Optional later: Then/Now labels on the **hero** card itself (native mock) — secondary to Open pair clarity.

## Key files

### Product (read before any code change)

- `src/resurface/resurface.ts:199` — `listMindChangeCandidates` (old = hero path; new = later*)
- `src/resurface/resurface.ts:246` — `citatorChipsForAtom`
- `src/resurface/resurface.ts:612` — `mindChangeLaterLine` (“Later you wrote …”)
- `src/home/atomsHomeView.ts:489` — `renderMindChangeCard` (ship hero)
- `src/home/atomsHomeView.ts:522` — Open → `openAtomInHome(card.path)` **old only**
- `src/home/atomsHomeView.ts:550` — `openAtomInHome`
- `src/home/atomsHomeView.ts:575` — `renderHomeOpen` (single atom + chips)
- `styles.css:400` / `495` — mind purple `#bf5af2`

### Design authority (durable)

- `docs/design-handoff/belief-rehearsal/mind-change-open-pair.html` — latest Open structure
- `docs/design-handoff/belief-rehearsal/mind-change-hero-native.html` — hero Then/Now on product chrome
- `docs/design-handoff/belief-rehearsal/mind-change-hero.html` — original Then/Now handoff
- This file: `docs/handoffs/2026-07-16-mind-change-open-ux.md`

### Skills

- `.agents/skills/frontend-design/SKILL.md`
- `.agents/skills/hallmark/SKILL.md`

## Decisions & constraints (do NOT relitigate)

1. **Fossil first** — old claim is primary on hero and first in Open pair (rot defense / design handoff intent).
2. **Hard edges only** — `revises` | `contradicts` (no soft “related”).
3. **Body sacred** — never rewrite capture body into the atom; display verbatim snippets/bodies.
4. **Open then path** — candidate `path` remains the old atom; pair view still anchors on old + shows later.
5. **1 mind-change hero / day** + pair throttle stay.
6. **Then / Now** labels beat “Later you wrote …” for clarity (human agreed markup).
7. **No book-spine palette** — no gold, parchment, bone, terracotta, leather brown.
8. **No Pro-Max glass/glow** as primary direction (felt AI).
9. **No foreign brand** for Atoms — serif parchment / cool-slate Fraunces “studio” looks were rejected as “AI-like” when they leave product DNA. Stay inside Atoms/Obsidian chrome; hierarchy (Then/Now) is the change, not a new identity.
10. **Round corners OK** on exploratory mocks; product should still match existing atoms-home radii when shipping.
11. **Tokens:** human said we may need them but agent is “not that good at that” — **do not invent a full token system solo**. Recolor from live `styles.css` + native mock, or wait for human token values.
12. **Second brain, not a task app** — mind-change is belief rehearsal, not a todo.
13. **No product ship without claim** (AGENTS.md / collab).

## Open questions / blockers

- **Token values for pair-open:** deferred to human. Until then, treat open-pair colors as exploration-only.
- **Does Open load later body from vault?** Product currently only has `laterTitle`/`laterPath` on the card — full later body requires a second file read (fine at Open time).
- **Hero ship scope:** Then/Now on hero vs only on Open — Open pair is the higher-priority clarity fix.
- **GitHub Issue:** none yet for this UX change.
- **Worktree:** created at handoff time at path in frontmatter; if missing, recreate sibling worktree (never nest).

## Git state

- Branch `docs/belief-rehearsal-hero-and-qa` (base `master`).
- Last real commit before this handoff: `7daf63a` — `docs: belief-rehearsal hero mock variants + QA reports`
- WIP snapshot: tip of branch — message `wip: handoff snapshot — mind-change-open-ux` (run `git log -1 --oneline`)
- Includes: this handoff, `mind-change-open-pair.html`, `.agents/skills/frontend-design` + `hallmark`, `skills-lock.json`
- Diff since base: docs/QA + hero mocks + handoff snapshot (no `src/` product changes)
- Remote: `origin` → `https://github.com/taihartman/obsidian-atoms.git`

## How to resume

Branch is checked out on the **main tree** (sibling worktree skipped — git refuses double-checkout of the same branch). Stay here unless you cut a new branch for product work.

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
git fetch origin && git switch docs/belief-rehearsal-hero-and-qa && git pull --ff-only

open docs/design-handoff/belief-rehearsal/mind-change-open-pair.html
open docs/design-handoff/belief-rehearsal/mind-change-hero-native.html
```

Then continue from **Next steps**. Read `CLAUDE.md`, `docs/collab.md`, `STATUS.md` before any `src/` edit. Do not implement product until claimed.

## Resume prompt (paste into a fresh session)

```
You are resuming in-progress work. Check out branch docs/belief-rehearsal-hero-and-qa
at /Users/a515138832/StudioProjects/obsidian_plugin, then read
docs/handoffs/2026-07-16-mind-change-open-ux.md in full — it is your brief.
Run its resume commands, open the named mocks, then continue from Next steps.
Do not invent a foreign brand or full token system; recolor only from product DNA
when the human drives tokens. No product ship without Issue + STATUS + draft PR.
```
