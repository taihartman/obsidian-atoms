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

**Illustrations (required for story notes):**

1. Draw simple on-theme SVG under `www/src/email/<slug-beat>.svg` (tokens in `docs/field-notes-email.md`).  
2. Export PNG 1040px wide:  
   `magick -background none -font "/System/Library/Fonts/Helvetica.ttc" www/src/email/foo.svg -resize 1040x www/src/email/foo.png`  
3. Reference `https://tryatoms.app/email/foo.png` in blocks.  
4. **Images must be live on tryatoms before audience send** (`build:www` + Pages deploy copies `www/src/email/*`). Test send will show broken images until deploy.

Legacy `paragraphs` + trailing `diagram`/`figure` still render, but **new drafts must use `blocks`.**

Save JSON to:

`docs/field-notes/drafts/YYYY-MM-DD-<slug>.json`

(create dirs as needed). Also keep a short markdown preview in chat (subject + section outline).

### 2. Build check

Import is already in the send script via `fieldNotesEmail.mjs`. No separate build required for send.

Optional: add/update SVG under `www/src/email/` and note PNG export if they want a custom figure later.

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
  --to 'taihartmandevelopment+fn-$(date +%H%M%S)@gmail.com' \
  --draft docs/field-notes/drafts/<file>.json
```

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
- Broadcast without `--confirm` + user yes  
- Print API keys  

## One-liner for the human

> Feed me the idea (or a reply you want to feature). I’ll draft Field notes, send you a test, and only blast the list when you say go.
