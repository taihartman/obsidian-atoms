---
handoff_date: 2026-08-07
branch: claude/field-notes-dom-visuals
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-field-notes-dom-visuals
base: master
tracking: none
status: blocked-on-send
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

## Session log — 2026-08-07 (Claude)

Steps 1, 2, 3 and 6 are **done** and pushed (`0095419`, `b2cfe87`). Steps 4 and 5 are **blocked**, see below.

**Short version jump — fixed by removing it.** Gmail strips in-message fragment links, and a short version placed after the long version is decoration rather than a summary. So there is no jump: `tldr` is hoisted to the **top** of the letter by one shared helper (`hoistTldrFirst`) used by both the email and the web archive, the `skip` block type is gone from both renderers, and the `id="fn-tldr"` / `.notes-skip` CSS are deleted. Regression tests on both surfaces assert no `href="#"` ships and that the short version renders before the story. A legacy draft carrying a `skip` block now renders nothing rather than a dead link.

**Illustrations redrawn.** The old set stacked four containers deep (letter card → figure frame → SVG black bg → inner card), which is what made it read as a SaaS diagram. Now: one dark plate per figure, no frame around figures in the email at all, no arrows between boxes. Amber means a person, blue means the system answering, nothing else is coloured. Face = an unnamed person beside an empty name field; ask = the answer as typography with no phone chrome; filed = one gesture, a dictate settling into the line it is filed on.

**Found and fixed a real bug the visuals pass surfaced.** `EMAIL_THEME.font` used double quotes and is interpolated into `style="..."`, so the attribute closed early and `font-family` was dropped entirely — **every Field notes email so far, including the welcome mail, rendered in Times.** Single quotes now, plus a test that no theme font stack contains a double quote.

**New tooling.**
- `scripts/render-email-svg.sh` — rasterizes `www/src/email/*.svg` via Chrome. Use this, not the `magick` line below: librsvg is absent on this machine, so ImageMagick silently falls back to its own renderer and loses gradients and font metrics.
- `node scripts/field-notes-send.mjs preview --draft <file> --out letter.html` — builds the exact HTML + text a send would, with no key and no network.

**Blocked — needs a human or a permission rule:**
1. **`wrangler pages deploy` was denied by the sandbox classifier.** `www/dist/email/fn-*.png` are committed and current, but production still serves the **old** illustrations. Merging to `master` auto-deploys via the Pages Action (`www/**` is a trigger path), so a merge fixes this without a manual deploy.
2. **Test send was denied by the same classifier**, so no `+fn-` address was used this session. Nothing has been sent. `fly ssh console -a atoms-plus -C 'printenv RESEND_API_KEY'` does work; only the Resend call is blocked.

**Verified locally instead:** `npx vitest run test/fieldNotesEmail.test.ts test/fieldNotesContent.test.ts` → 20 passed; letter rendered from the real draft via `preview` and screenshotted at email width in Chrome (short version leads, sans-serif body, figures unframed, sections break cleanly).

## Next steps

1. ~~Fix Short version navigation~~ — **done**, by deleting the jump. See session log.
2. ~~Redesign the three SVGs~~ — **done**; PNGs rebuilt and committed to `www/src/email/` and `www/dist/email/`. Original brief: to feel like tryatoms (quiet, dark, `#0a84ff` / `#ff9f0a` sparingly, simple, not generic “AI illustration” cards). Look at landing/home and `docs/design-handoff/tokens` + existing `www/src/email/loop-remember.svg` for token baseline — then **beat** that quality. Export PNGs. Redeploy or ensure `https://tryatoms.app/email/fn-*.png` is current before audience send (`npm run build:www` + Pages deploy per `docs/runbooks/tryatoms-pages-deploy.md`).
3. ~~Open the rendered letter and judge~~ — **done** via `send.mjs preview` + Chrome. Original brief: (local HTML from `buildFieldNotesHtml`, and/or test email). Tighten spacing/section rhythm if still “a lot.” Do **not** reintroduce pull/bookend chrome.
4. **Test send** — **BLOCKED** (classifier denied the Resend call). Still owed before broadcast. Recipe: (secrets from fly `atoms-plus` `RESEND_API_KEY`; postal + segment in runbook). Tell user the +address.
5. **Only after explicit user yes:**  
   `node scripts/field-notes-send.mjs broadcast --draft docs/field-notes/drafts/2026-08-07-knew-his-face.json --confirm`  
   Then commit published JSON, merge master so `/notes/<slug>/` goes live.
6. ~~Skim draft copy for voice~~ — checked: no em dashes, no guilt, soft CTA. Original brief: skim draft copy once more for voice (`docs/voice.md`) — no em dashes, no guilt, soft CTA.

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
