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

Write:

- `subject` — short, calm, specific  
- `title` — H1  
- `preheader` — one line  
- `paragraphs` — 3–6 short paras: concrete beat → what mattered → stack only if it serves → **featured invite** (“Want to be featured? Reply and show how you use Atoms…”)  
- `diagram`: `"loop"` if the three-step loop fits; else `null`  
- optional `figure` if a hosted PNG exists  
- `cta`: usually Open tryatoms.app  

Save JSON to:

`docs/field-notes/drafts/YYYY-MM-DD-<slug>.json`

(create dirs as needed). Also keep a short markdown preview in chat (subject + body).

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

### 5. After send

- Report broadcast id / test id  
- Remind: replies hit Reply-To Gmail; feature with permission  
- If they want edits, update JSON and re-test (new +alias)

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
