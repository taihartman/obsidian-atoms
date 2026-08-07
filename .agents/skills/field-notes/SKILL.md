---
name: field-notes
description: >
  End-to-end Field notes email: user feeds an idea or story, agent drafts on-voice
  copy, builds on-theme HTML, sends a test, and on explicit approval broadcasts to
  the list. Triggers on "field notes", "send a field note", "newsletter idea",
  "broadcast to the list", "draft an email about…", or when the user pastes a
  story and wants it turned into the mailing list letter.
---

# Field notes — idea → send

You own the full path. The human feeds **the idea**; you draft, build, test-send, and only broadcast after they say yes.

## Authority (read every run)

1. [`docs/voice.md`](../../../docs/voice.md) — tone, hard rules, Field notes section  
2. [`docs/field-notes-email.md`](../../../docs/field-notes-email.md) — HTML + diagrams  
3. [`docs/runbooks/atoms-notes-list.md`](../../../docs/runbooks/atoms-notes-list.md) — segment / secrets  

Also load skill **atoms-voice** principles (no em dashes, no corn, no “use case”).

## Input

User provides any of:

- A rough story / beat (“wedding text → atom → calendar”)  
- Bullet notes  
- “Feature this reply: …”  

If the idea is too thin for a letter, ask **one** clarifying question, then proceed.

## Workflow (do not stop after draft)

### 1. Draft

**Never ship a wall of plain paragraphs.** Every note uses `blocks` with real structure and at least one visual beat.

Write:

- `subject` — short, calm, specific  
- `title` — H1  
- `preheader` — one line  
- `blocks` — ordered mix of:
  - `{ "type": "p", "text": "..." }` — short paras (2–4 sentences max each)
  - `{ "type": "h2", "text": "..." }` — plain section titles (2–3; break the scroll). Not shouty all-caps kicker labels.
  - `{ "type": "figure", "src": "https://tryatoms.app/email/<name>.png", "alt": "..." }` — **inline** illustrations between sections
  - `{ "type": "tldr", "lines": ["...", "..."] }` — quiet short-version box. **Always renders first**, above the story, in email and on the web. The renderer hoists it, so draft order cannot get this wrong.
  - `{ "type": "loop" }` — only when the three-step loop truly serves; optional, never default footer
- `cta`: usually Open tryatoms.app  

**Never:** colored pull-quote / bookend cards (left border bars, “highlight” quote boxes). They read as AI template. A sharp one-line beat is just a normal paragraph.

**Never:** in-message jump links (`href="#..."`). Gmail strips fragment links, so “Short version ↓” is a dead link for most readers. There is no `skip` block type — a short version earns its place by being read first, not by being linked to.

**Structure recipe:** `tldr` → open beat → figure → h2 → figure → tight argument → close + featured invite.  
Long notes always get a `tldr`. Featured invite near the end: “Want to be featured? Reply and show how you use Atoms…”

**Illustrations (required for story notes).** These are the part readers judge first and the part that most easily reads as AI slop. The house style, learned the hard way on the Dom letter:

- **One container, ever.** The SVG draws a single dark plate (`#121214`, `rx="28"`, hairline `rgba(84,84,88,0.38)`) on a transparent canvas, and `figureHtml` puts **no frame around it**. The first Dom set stacked four boxes deep — letter card, figure frame, black SVG background, inner card — and that nesting alone is what made it look like a stock SaaS diagram. If you find yourself drawing a card inside the plate, stop.
- **No box → arrow → box.** A blue arrow between two rounded rectangles is the single most generic thing you can draw. Show one idea per figure, or one continuous gesture.
- **Colour carries meaning, not decoration.** Amber `#ff9f0a` = a person. Blue `#0a84ff` = the system answering, used once and small. Everything else is grey. Two accent colours in one figure is usually one too many.
- **Type is the illustration.** These letters are about words; rendering the actual words at real size beats an icon. `system-ui, -apple-system, 'Helvetica Neue', sans-serif` resolves to SF in the renderer.
- **Mind the display size.** Canvas is 1040px wide and shows at 520 in mail, so anything under ~26px in the SVG is illegible. Big answer text ~104px, titles ~56px, labels 26–30px.
- **Vary the set.** Three text-only plates in a row is monotonous. Mix one object, one typographic, one gestural.
- **Negative space is the tryatoms look.** When a figure feels weak the fix is usually removing an element, not adding one.

Then:

1. Draw the SVG at `www/src/email/<slug-beat>.svg` (tokens in `docs/field-notes-email.md`).
2. Rasterize: `scripts/render-email-svg.sh` (all `fn-*.svg`) or pass paths for one.
   **Do not use `magick`.** librsvg is not installed on this machine, so ImageMagick silently falls back to its own renderer and loses gradients and font metrics — it looks fine until you compare. The script uses Chrome, the same engine the site renders in.
3. Reference `https://tryatoms.app/email/foo.png` in blocks, and write `alt` that describes the actual drawing (it is the plain-text body too).
4. **Images must be live on tryatoms before *any* send, test included** — otherwise the test shows the previous version and you review the wrong art:
   ```bash
   npm run build:www   # copies www/src/email/* into www/dist/email/
   ( cd www && npx wrangler pages deploy dist --project-name=tryatoms --branch=master )
   ```
   Then verify the live bytes actually changed, because the edge caches these paths for 4h and the first request after a deploy can still serve the old file:
   ```bash
   curl -s -o /dev/null -w '%{size_download}\n' https://tryatoms.app/email/foo.png
   ```
   Repeat once if it does not match `ls -l www/src/email/foo.png`; a revalidation pass clears it.

Legacy `paragraphs` + trailing `diagram`/`figure` still render, but **new drafts must use `blocks`.**

Save JSON to:

`docs/field-notes/drafts/YYYY-MM-DD-<slug>.json`

(create dirs as needed). Also keep a short markdown preview in chat (subject + section outline).

### 2. Preview and judge it yourself

Never let a test send be the first time anyone looks at the letter. Build the exact bodies with no key and no network:

```bash
node scripts/field-notes-send.mjs preview \
  --draft docs/field-notes/drafts/<file>.json --out /tmp/letter.html
```

Open it at email width and read it as a reader, not as the author. Point the figure `src`s at local files first if the PNGs are not deployed yet:

```bash
sed "s|https://tryatoms.app/email/|file://$PWD/www/src/email/|g" /tmp/letter.html > /tmp/letter-local.html
```

What to look for: does the short version earn the top slot, do the sections break the scroll, is any figure doing work a sentence already did, is the body actually in the sans-serif stack (if it looks like Times, a font stack has broken — see **Do not**).

### 3. Test send (always before audience)

Resolve secrets (do not print secret values):

```bash
export RESEND_API_KEY="$(fly ssh console -a atoms-plus -C 'printenv RESEND_API_KEY' 2>/dev/null | tr -d '\r' | tail -1)"
export ATOMS_NOTES_FROM='Field notes <notes@mail.tryatoms.app>'
export ATOMS_NOTES_REPLY_TO='taihartmandevelopment@gmail.com'
export ATOMS_NOTES_POSTAL_ADDRESS='Taitopia, 1029 Lyell Ave Unit #740, Rochester, NY 14606'
export RESEND_MARKETING_SEGMENT_ID='3b2147b4-a1bf-4225-91a0-e24f6c5868e2'
```

Default test inbox: `taihartmandevelopment@gmail.com` (or +alias). Override if user names another.

```bash
node scripts/field-notes-send.mjs test \
  --to "taihartmandevelopment+fn-$(date +%H%M)@gmail.com" \
  --draft docs/field-notes/drafts/<file>.json
```

Double quotes — in single quotes the `$(date)` does not expand and you mail a literal address.

Tell the user the exact +address and that mail is on the way.

### 4. Approval gate (required)

Ask: **Send this to the whole Field notes list?**  
Only if they clearly say yes / send it / broadcast:

```bash
node scripts/field-notes-send.mjs broadcast --draft docs/field-notes/drafts/<file>.json --confirm
```

Never broadcast without explicit approval. Never use `--confirm` “to be helpful.”

### 5. After broadcast (send = publish SSOT)

Successful `broadcast --confirm` also writes `docs/field-notes/published/YYYY-MM-DD-<slug>.json`.

**Live web is not automatic.** Checklist before calling it done:

1. Report broadcast id + published path  
2. Commit published JSON (and any draft) on the feature branch / master  
3. Merge to **master** so Pages deploys (`tryatoms-pages` workflow)  
4. Verify `https://tryatoms.app/notes/<slug>/` and `/notes/`  
5. Remind: replies hit Reply-To Gmail; feature with permission  

`test` mode never writes `published/`.  
Draft basename must be `YYYY-MM-DD-<slug>.json` or promote fails after send (email already live — fix and commit manually).

## Defaults

| Item | Value |
|---|---|
| From | `Field notes <notes@mail.tryatoms.app>` |
| Reply-To | `taihartmandevelopment@gmail.com` |
| Segment | `RESEND_MARKETING_SEGMENT_ID` (Atoms Notes segment) |
| Postal | Taitopia Lyell Ave line (CAN-SPAM) |
| npm script | `npm run field-notes:test` / `field-notes:broadcast` (wrappers) |

## Do not

- Skip voice docs  
- Invent pricing/trial claims  
- Put raw SVG in HTML body (PNG or built-in `loop` diagram)  
- Ship an in-message jump link (`href="#..."`) — Gmail strips fragment links  
- Broadcast without `--confirm` + user yes  
- Print API keys  
- **Put a double quote in any CSS value that `fieldNotesEmail.mjs` interpolates into `style="..."`.** A font stack like `"SF Pro Text"` closes the attribute early, the whole `font-family` declaration is dropped, and the letter silently falls back to Times in every client. Use single quotes. This shipped undetected for the entire life of the list until someone screenshotted a preview; `test/fieldNotesEmail.test.ts` now guards it.

## One-liner for the human

> Feed me the idea (or a reply you want to feature). I’ll draft Field notes, send you a test, and only blast the list when you say go.
