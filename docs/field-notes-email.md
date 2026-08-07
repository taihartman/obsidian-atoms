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
| Figure plate | `#121214`, `rx="28"` |
| Plate hairline | `rgba(84,84,88,0.38)` |
| Text | `#ffffff` |
| Muted | `rgba(235,235,245,0.42–0.55)` |
| The system answering | `#0a84ff` (once, small) |
| A person | `#ff9f0a` |

**House style** (established on the 2026-08-07 Dom letter; `www/src/email/fn-*.svg` are the reference set):

- **One container.** The SVG draws a single plate — `#121214`, `rx="28"`, hairline `rgba(84,84,88,0.38)` — on a transparent 1040-wide canvas. `figureHtml` deliberately adds **no frame**. The first version of that set nested four boxes (letter card → figure frame → black SVG bg → inner card) and read as a stock SaaS diagram purely because of the nesting.
- **No box → arrow → box.** One idea per figure, or one continuous gesture. A blue arrow between two rounded rectangles is the most generic mark available.
- **Colour means something.** Amber `#ff9f0a` = a person. Blue `#0a84ff` = the system answering, once and small. Everything else grey. Two accents in one figure is usually one too many.
- **Type is the illustration.** Use `system-ui, -apple-system, 'Helvetica Neue', sans-serif`; it resolves to SF in the renderer.
- **Size for 520px.** The canvas shows at half size in mail, so nothing below ~26px is legible. Answers ~104px, titles ~56px, labels 26–30px.
- When a figure feels weak, remove an element rather than adding one.

- **Let the set rhyme.** `fn-face-no-name.svg` is `fn-ask-dom.svg` with the answer removed — same label line, same bar, same slot, amber bar instead of blue, a redaction block where the word goes. The reader meets the hollow frame first, so the filled one later reads as a payoff. `fn-messy-filed.svg` breaks the pattern deliberately.

**Starter files:** `fn-ask-dom.svg` / `fn-face-no-name.svg` (the rhyming pair), `fn-messy-filed.svg` (gestural). `loop-remember.svg` predates the house style — do not copy its card-and-arrow layout.

### Export PNG (local)

```bash
scripts/render-email-svg.sh                        # all fn-*.svg
scripts/render-email-svg.sh www/src/email/foo.svg  # one
```

The script rasterizes with Chrome. **Do not use `magick`**: with librsvg absent (it is, on this machine) ImageMagick silently falls back to its own SVG renderer, dropping gradients and picking wrong font metrics — output that looks plausible until compared side by side.

Then `npm run build:www` and deploy so `https://tryatoms.app/email/foo.png` resolves.

**Cache-bust redrawn figures.** The Pages edge pins `/email/*.png` for 4h, and a path whose cache entry was populated recently will keep serving the old image after a deploy — you review last week's art and never know. Sometimes a second request revalidates; sometimes it does not. So a draft references the figure with a content hash:

```json
{ "type": "figure", "src": "https://tryatoms.app/email/foo.png?v=6852857c", "alt": "..." }
```

`md5 -q www/src/email/foo.png | cut -c1-8`. The web archive drops the query (`normalizeFigureSrc` keeps only the pathname), so published pages stay clean — guarded by a test. Verify before judging any send:

```bash
curl -s -o /dev/null -w '%{size_download}\n' 'https://tryatoms.app/email/foo.png?v=<hash>'
stat -f%z www/src/email/foo.png
```

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
| `tldr` | Quiet short-version box. Always hoisted to the **top**, above the story |
| `loop` | Built-in three-step diagram — **opt-in**, not a default footer |

**Banned:** pull-quote / bookend cards (colored left bars, highlight quote boxes). AI-template look. Use a normal `p` for a one-line beat.

**Banned: in-message jump links.** Gmail strips or rewrites `href="#anchor"`, so a “Short version ↓” link is dead for most readers, and a short version placed after the long version is decoration anyway. `normalizeBlocks` / `renderBlocksEmailHtml` hoist `tldr` to the front on both surfaces; there is no `skip` block type and nothing carries an `id` for linking. Tests guard both (`test/fieldNotesEmail.test.ts`, `test/fieldNotesContent.test.ts`).

Legacy flat `paragraphs` + trailing `diagram`/`figure` still work for welcome and old notes.

**Rule of thumb:** 2–3 `h2`s, at least one inline `figure`, and a `tldr` on anything longer than a welcome. Short version first, then the story; loop only when it earns the slot.

## Resend Broadcast checklist

- [ ] Read `docs/voice.md`  
- [ ] `blocks` with sections + inline figures (not a paragraph wall)  
- [ ] PNGs live on tryatoms.app/email/ before broadcast  
- [ ] Soft CTA + invite “reply with how you run yours”  
- [ ] Dark card layout (or Resend theme tuned to black / #1c1c1e / #0a84ff)  
- [ ] `{{{RESEND_UNSUBSCRIBE_URL}}}` + postal line  
- [ ] Test on iPhone Mail + Gmail before audience send  
- [ ] Live PNG byte count matches local before judging the test send  
- [ ] Body renders sans-serif, not Times (a `"` in a font stack breaks `style="..."`)  

---

## Code hooks

| Helper | Use |
|---|---|
| `welcomeEmailContent` | Signup welcome (wired in `resendMarketing.mjs`) |
| `buildFieldNotesHtml` | Full note HTML for Broadcasts or future automation |
| `loopDiagramHtml` | Built-in three-step diagram |
| `figureHtml` | Hosted PNG block, unframed |
| `hoistTldrFirst` | Short version to the top; shared by email and web archive |
| `scripts/field-notes-send.mjs` | CLI preview + test + broadcast from a draft JSON |
| `scripts/render-email-svg.sh` | SVG → PNG via Chrome |
| skill **`field-notes`** | Idea → draft → test → (approve) → list |

Skills: **`field-notes`** (end-to-end send), **`atoms-voice`** (tone only).
