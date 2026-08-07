---
handoff_date: 2026-08-07
branch: claude/field-notes-dom-visuals
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-field-notes-dom-visuals
base: master
tracking: none
status: complete
---

# Handoff — Field notes Dom letter: visuals + polish

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then **start executing Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Ship the first real **Field notes** broadcast: Tai’s climbing-gym / Dom story. Structure and send plumbing mostly work. **You own the visual craft** — especially the SVGs/PNGs and overall letter feel. Prior agent (Grok) got structure right-ish but Tai judged the illustrations “alright / not good enough” and wants Claude on visuals.

Also fix: **“Short version ↓” jump does not work** (user confirmed).

## Current status

### Product / ops
- Field notes list exists (Resend segment Atoms Notes). Runbook: `docs/runbooks/atoms-notes-list.md`
- Skill: `.agents/skills/field-notes/SKILL.md` — idea → draft JSON → test → approve → broadcast
- Voice: `docs/voice.md` + `.agents/skills/atoms-voice/`
- Email HTML: `www/functions/_lib/fieldNotesEmail.mjs`
- Web archive body: `www/lib/fieldNotesContent.mjs`
- Send CLI: `scripts/field-notes-send.mjs` (`npm run field-notes:test` / `field-notes:broadcast`)

### Schema (done — keep)
Drafts use **`blocks`** (not a wall of `paragraphs`):

| type | role |
|---|---|
| `p` | short paragraph |
| `h2` | plain section title (not all-caps blue kickers) |
| `figure` | inline PNG `https://tryatoms.app/email/….png` |
| `tldr` | quiet short-version box; **hoisted to the top**, no jump link |
| `loop` | opt-in only; **not** default footer |

**Banned forever:** pull-quote / bookend cards (orange left border, highlight quote boxes). Tai: “too AI looking.” Renderer deliberately has no `pull` type.

### This note’s draft (done — copy is mostly good)
`docs/field-notes/drafts/2026-08-07-knew-his-face.json`

Story outline Tai wrote (preserve voice; light cuts already applied):
- Met guy at climbing gym, hard problem, he sent
- Saw him later, knew face not name
- Asked Claude → **Dom** in ~2s → said hey Dom → he called Tai **Daniel**
- Point: capture tools take thoughts in; none hand them back when needed
- Atoms = connection, not folder. Messy car dictate → filed note
- Closer: “Dom… great send, my name is Tai” + featured invite

Latest test send: `taihartmandevelopment+fn-132911@gmail.com` (id `12c13a3a-8d72-4bd2-a934-36e1153462f8`)

### Illustrations (redrawn 2026-08-07 — see session log)
Source + PNG under `www/src/email/`:

| file | intent |
|---|---|
| `fn-face-no-name.svg` + `.png` | an unnamed person beside an empty name field |
| `fn-ask-dom.svg` + `.png` | the answer as typography, no phone chrome |
| `fn-messy-filed.svg` + `.png` | a dictate settling into the line it is filed on |

PNG export (use this, not `magick` — librsvg is absent so ImageMagick silently
falls back to its own renderer and loses gradients and font metrics):
```bash
scripts/render-email-svg.sh                      # all fn-*.svg
scripts/render-email-svg.sh www/src/email/foo.svg # one
```

Assets were manually deployed once so test mail could load images (`wrangler pages deploy` to tryatoms). **SVGs are generic SaaS-diagram quality** — not craft-level. Redesign them.

### Known bug (user-confirmed) — FIXED, kept for rationale
**“Short version ↓” does not work.** Current impl is `<a href="#fn-tldr">` + `id="fn-tldr"` on the TLDR table/aside.

Why it fails in email:
- Many clients (esp. Gmail) strip or ignore in-message fragment links
- Email HTML uses nested tables; anchor target may not resolve
- Web archive path may work; **email is the product**

You must fix jump behavior for real mail clients, or replace the pattern with something that actually works (e.g. put TLDR near the top under a collapsible-looking header that’s just content order; or dual layout: short first then “full story”; or drop fake jump and lead with TLDR). **Do not ship a dead link.**

### Tests
```bash
npx vitest run test/fieldNotesEmail.test.ts test/fieldNotesContent.test.ts
```
Passing as of handoff. Extend if you change block types / jump behavior.

## Session log — 2026-08-07 (Claude) — COMPLETE

**Shipped.** Broadcast `fce18b48-8896-4f41-8188-b8a90e55b73e` to the Atoms Notes segment; published JSON at `docs/field-notes/published/2026-08-07-knew-his-face.json`. The archive page goes live at `/notes/knew-his-face/` on merge to master.

**Short version jump — fixed by deleting it.** Gmail strips in-message fragment links, and a short version placed after the long version is decoration rather than a summary. `tldr` is now hoisted to the top by one shared helper (`hoistTldrFirst`) used by both the email and the web archive; the `skip` block type, the `id="fn-tldr"` anchor and the `.notes-skip` CSS are gone. Tests on both surfaces assert no `href="#"` ever ships.

**Illustrations, four rounds.** Landed on: flat plate, no glow, no accent bar, and the picture made of real words rather than graphics — a list of what you remember with one line blank; a small question and an enormous name; the actual dictation trailing off into the title it became. What got rejected on the way is the useful part, and it is recorded in the house style: nested containers, box→arrow→box, a stock avatar glyph, tinted glows behind focal elements (the clearest tell of generated art), a coloured left bar (which is the bookend pattern CLAUDE.md bans, whatever it sits beside), invented specifics the letter never states, and dramatised beats that read as trying too hard once set in type.

**Three bugs found on the way, all compounded to `docs/solutions/`:**
- Gmail proxies images by URL and caches them permanently, so a redrawn illustration at a stable URL never reaches the reader. `?v=` fixes Gmail's cache key but not Cloudflare's, and both must agree — the filename carries the hash now. This cost four consecutive sends that all looked verified.
- A double quote in a CSS value interpolated into `style="..."` closes the attribute and the whole `font-family` declaration is dropped. **Every Field notes email, welcome mail included, had been rendering in Times.**
- An SVG gradient in default `objectBoundingBox` units does not render at all on zero-width geometry; it silently erased an entire waveform.

**Tooling added:** `scripts/render-email-svg.sh` (Chrome, not ImageMagick — librsvg is absent so `magick` silently falls back to its own renderer), `scripts/check-email-assets.sh` (blocks a send on an un-fingerprinted or stale figure), and `field-notes-send.mjs preview` (build the exact bodies with no key and no network).

**Skill + docs rewritten to match:** `.agents/skills/field-notes/SKILL.md`, `docs/field-notes-email.md`, and two new hard rules in `docs/voice.md` (no dramatised beats; everything gets louder set in type). `CONCEPTS.md` gained **Short version**.

**Verified:** full suite 1408 passing after merging master; letter rendered and screenshotted at email width; live figure bytes checked against local before every send.

## Next steps

Nothing outstanding for this work. Merge lands the archive page. If a future note redraws a figure, `scripts/check-email-assets.sh <draft>` is the gate — it fails on a bare `foo.png` for the Gmail-cache reason above.

## Key files

- `docs/field-notes/drafts/2026-08-07-knew-his-face.json` — current letter SSOT
- `www/src/email/fn-*.svg` — illustration source (rewritten 2026-08-07)
- `www/functions/_lib/fieldNotesEmail.mjs` — email blocks render, `hoistTldrFirst`, theme tokens
- `www/lib/fieldNotesContent.mjs` — web archive blocks
- `www/src/styles.css` — `.notes-h2`, `.notes-tldr*` (`.notes-skip` deleted)
- `.agents/skills/field-notes/SKILL.md` — agent workflow + bans
- `docs/field-notes-email.md` — email design rules
- `docs/voice.md` — voice
- `docs/runbooks/atoms-notes-list.md` — Resend / secrets / send commands
- `scripts/field-notes-send.mjs` — preview + test + broadcast + promote to published
- `scripts/render-email-svg.sh` — SVG → PNG via Chrome

## Decisions & constraints (do NOT relitigate)

- Product name user-facing: **Field notes** (not “newsletter” in voice)
- **No pull-quote / colored bookend UI** — ever
- **No default loop diagram footer** on this note (user removed it on purpose)
- Body sacred for user atoms; this letter is product-authored — voice rules apply
- Broadcast **only** with explicit user approval + `--confirm`
- Gmail strips raw SVG in email → **PNG hosted on tryatoms** for `<img>`
- Figures absolute URL: `https://tryatoms.app/email/<name>.png`
- From: `Field notes <notes@mail.tryatoms.app>`; Reply-To: `taihartmandevelopment@gmail.com`
- Segment id / postal in runbook; never print API keys
- Prefer silence over filler; under-promise cadence
- Agent dogfood on demo/test vault only; this is marketing email not vault mutate

## Open questions / blockers

- Exact visual direction for SVGs beyond “better than generic SaaS cards” — use judgment against tryatoms aesthetic; if stuck, one tight alternative set, not five
- Whether TLDR should move to **top** (always visible) vs fixed jump — pick what works in mail
- none blocking secrets if fly/`RESEND_API_KEY` still reachable as in skill

## Git state

- Branch `claude/field-notes-dom-visuals` (base `master`), pushed to `origin`
- Last real commit / WIP snapshot: `896986a` — `wip: handoff snapshot — field-notes-dom-visuals`
- Diff since base: 17 files, +705/-56
- WIP includes blocks schema, draft, skill/docs, mediocre SVGs, broken skip-link
- Do not commit unrelated untracked junk: `.opencode/`, `SHA256SUMS.txt`, android companion research/plan unless user asks
- Prefer committing: source under `www/src/email/`, lib/email code, draft, skill, docs, tests. `www/dist/` is tracked in this repo — include email assets in dist if you rebuild, or rebuild on deploy only

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-field-notes-dom-visuals
git fetch origin && git switch claude/field-notes-dom-visuals && git pull --ff-only
npm install   # if needed
npx vitest run test/fieldNotesEmail.test.ts test/fieldNotesContent.test.ts
```

Then continue from **Next steps** above. Start with fixing Short version + redesigning SVGs.
