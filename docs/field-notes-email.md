# Field notes — email design

**Voice:** [`docs/voice.md`](voice.md)  
**Ops:** [`docs/runbooks/atoms-notes-list.md`](runbooks/atoms-notes-list.md)  
**Code:** `www/functions/_lib/fieldNotesEmail.mjs` (HTML shell + loop diagram)

Emails should feel like tryatoms.app: near-black, surface cards, `#0a84ff` tint, system UI font, quiet type. Not a rainbow newsletter template.

---

## What ships in code (welcome)

- **Multipart:** `text` + `html` (always both). Solid plain-text twin helps inbox placement.
- **Theme:** dark background `#000`, card `#1c1c1e`, label white, muted gray, tint blue - same as site tokens.
- **Layout:** single column, max ~560px, table-based (Outlook-safe).
- **Built-in diagram:** “Catch it → It is filed → It comes back” as **HTML table cells** (no image). Works in Gmail.
- **CTA:** keep light on welcome (text link, not a billboard of buttons). Broadcasts can use a pill when there is one clear next step.
- **Footer:** why you’re getting this, unsubscribe, postal address.

## Primary vs Promotions (Gmail)

**We cannot force Primary.** Gmail (and Apple/Yahoo) classify mail. Field notes is permissioned marketing, so Promotions is common, especially early.

What helps a little:

| Do | Why |
|---|---|
| SPF/DKIM/DMARC on `mail.tryatoms.app` (already via Resend) | Authentication baseline |
| One-to-one API sends (welcome), not huge cold blasts | Looks less like bulk |
| Strong plain-text part + lean HTML | Less “template promo” |
| Few links; personal Reply-To | More like a letter |
| People open, reply, move to Primary once | Trains *their* Gmail |
| Consistent From; low complaint rate | Reputation over time |

What you cannot dodge:

- Unsubscribe + postal (required) still signal “list mail.”
- New volume on a domain takes warm-up time.
- Asking subscribers to drag one message to **Primary** and click “Yes” on “Do this for future messages?” is the honest lever.

Do **not** try dark patterns (fake “re:” subjects, hiding unsubscribe). That hurts reputation and is illegal for US marketing mail.

---

## Illustrations (SVGs and images)

### Why not raw SVG in the email body?

Gmail and many clients **strip or block SVG**. Reliable path:

1. Draw the idea as **SVG** in the repo (`www/src/email/*.svg`) - on theme, editable.  
2. Export a **PNG** (2x width, ~1040px wide for retina).  
3. Host PNG on tryatoms: `www/src/email/foo.png` → build copies to `https://tryatoms.app/email/foo.png`.  
4. In HTML: `<img src="https://tryatoms.app/email/foo.png" …>` via `figureHtml()` or Resend’s editor.

### Drawing SVGs on theme

| Token | Hex |
|---|---|
| Background | `#000000` |
| Card / surface | `#1c1c1e` or `#2c2c2e` |
| Text | `#ffffff` |
| Muted | `rgba(235,235,245,0.72)` |
| Accent / arrows | `#0a84ff` |
| Person accent | `#ff9f0a` (sparingly) |

Keep diagrams **simple**: 2–4 boxes, one arrow story, almost no text. The email prose carries the story; the figure is a glanceable beat.

**Starter file:** `www/src/email/loop-remember.svg` (same three-step loop as the HTML diagram).

### Export PNG (local)

Any of:

```bash
# if you have rsvg-convert (librsvg)
rsvg-convert -w 1040 www/src/email/loop-remember.svg -o www/src/email/loop-remember.png

# or open in Figma / Preview / Illustrator and export 2x PNG
```

Then `npm run build:www` and deploy so `https://tryatoms.app/email/loop-remember.png` resolves.

### Using a figure in a Broadcast (Resend UI)

1. Upload PNG to tryatoms (or Resend image host).  
2. Paste HTML from a test render, or build with:

```js
import { buildFieldNotesHtml } from "./fieldNotesEmail.mjs";
// figure: { src: "https://tryatoms.app/email/your-idea.png", alt: "…" }
```

3. Keep a plain-text version of the same story.

---

## Body shape: blocks (not a wall of text)

Draft JSON prefers **`blocks`** (email + web archive share the model):

| type | Role |
|---|---|
| `p` | Short paragraph |
| `h2` | Plain section title (not all-caps kicker) |
| `figure` | Inline PNG (`https://tryatoms.app/email/….png`) between sections |
| `tldr` | Quiet short-version box; auto top jump link “Short version ↓” |
| `loop` | Built-in three-step diagram — **opt-in**, not a default footer |

**Banned:** pull-quote / bookend cards (colored left bars, highlight quote boxes). AI-template look. Use a normal `p` for a one-line beat.

Legacy flat `paragraphs` + trailing `diagram`/`figure` still work for welcome and old notes.

**Rule of thumb:** 2–3 `h2`s, at least one inline `figure`, and a `tldr` on anything longer than a welcome. Story first; loop only when it earns the slot.

## Resend Broadcast checklist

- [ ] Read `docs/voice.md`  
- [ ] `blocks` with sections + inline figures (not a paragraph wall)  
- [ ] PNGs live on tryatoms.app/email/ before broadcast  
- [ ] Soft CTA + invite “reply with how you run yours”  
- [ ] Dark card layout (or Resend theme tuned to black / #1c1c1e / #0a84ff)  
- [ ] `{{{RESEND_UNSUBSCRIBE_URL}}}` + postal line  
- [ ] Test on iPhone Mail + Gmail before audience send  

---

## Code hooks

| Helper | Use |
|---|---|
| `welcomeEmailContent` | Signup welcome (wired in `resendMarketing.mjs`) |
| `buildFieldNotesHtml` | Full note HTML for Broadcasts or future automation |
| `loopDiagramHtml` | Built-in three-step diagram |
| `figureHtml` | Hosted PNG block |
| `scripts/field-notes-send.mjs` | CLI test + broadcast from a draft JSON |
| skill **`field-notes`** | Idea → draft → test → (approve) → list |

Skills: **`field-notes`** (end-to-end send), **`atoms-voice`** (tone only).
