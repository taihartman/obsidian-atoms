# Atoms voice

**Authority for all product-authored words:** plugin chrome, tryatoms.app, Field notes emails, Broadcasts, Notices, empty states, settings.  
**Not in scope:** capture bodies and atom bodies (verbatim; never “improve” the user’s words).

Grounded in shipped landing and home copy, `docs/design-handoff/tokens/README.md`, and constitution (second brain, not a task app).

---

## One sentence

**Quiet confidence.** You already wrote it down. We help it come back when it matters - without guilt, hype, or homework.

---

## Pillars

1. **Second brain in real life**  
   The five-second capture on a walk. Expanding it later. Remembering what you would have lost. Not a productivity system to maintain.

2. **Your words stay yours**  
   Body sacred. We file, link, and surface. We do not rewrite your thoughts into confident-sounding prose.

3. **Tools that fit together**  
   Obsidian is home. Claude and ChatGPT can ask when you want that. Atoms is the honest middle - vault stays source of truth.

4. **Quiet by default**  
   No streaks, no backlog filling up, no “you should process.” Empty can be correct. Rare beats constant.

5. **People, not personas**  
   Real practice. How others run it. Invite their stories. No fake case studies, no “10x your brain.”

---

## Tone axes

| Lean toward | Lean away |
|---|---|
| Warm, plain, specific | Corporate, hype, growth-hack |
| Concrete moment (walk, tulips, afternoon) | Abstract “knowledge management” |
| Positive without cheerleading | Corny, inspirational-poster |
| Short sentences. Periods and colons. | Em dashes, exclamation piles |
| “You” and “we” when true | “Users,” “leverage,” “unlock” |
| Honest limits | Magic that overclaims |

**Positivity** = relief and possibility (“it comes back when it matters”), not pep talk (“you’ve got this!!!”).

**Creative** = a sharp image or one true beat, not clever wordplay for its own sake.

---

## Hard rules (all surfaces)

- **No em dashes** in product-authored copy (tryatoms honesty tests + app). Use period, colon, or comma.
- **No guilt language:** due, overdue, still need to, backlog, streak broken, “you haven’t processed.”
- **No task-app gravity** in marketing the product identity.
- **No “use case” / “use-case notes”** in user-facing marketing (sounds like a deck). Prefer *how people run it*, *practice*, *field notes*, *second brain in real life*.
- **Numbers and locked pricing sentences** stay SSOT (`plus-pricing.json` / plugin helpers). Marketing must not invent trial or price claims.
- **Body sacred** never gets a creative rewrite.

---

## Field notes (email list)

**What it is:** Occasional maker notes on a second brain you actually use - capture that sticks, tools (Obsidian, Claude, ChatGPT), how other people run it. Invite replies with their practice.

**What it is not:** Changelog drip, sales sequence, “newsletter,” feature dump, use-case PDF.

### Cadence and promise

- Under-promise: a few times a year, or when something is worth saying.
- Prefer silence over filler.
- Every mail: clear From, unsubscribe, physical address (CAN-SPAM).

### Structure of a good note

1. **One concrete beat** (a walk, a person, a moment you almost forgot).  
2. **Sections, not a scroll wall** — use `blocks` with `h2` breaks, short paras, pull quotes, and **inline** figures between beats (see `docs/field-notes-email.md`).  
3. **What the stack did** (capture → atom → ask / calendar / recap) without tool-worship.  
4. **One soft next step** (tryatoms, setup, or “reply with yours”).  
5. **Invite:** show how you use Atoms day to day - you may get featured (ask before naming).  
6. **No default loop footer** — the catch/file/return diagram is optional and only when it serves the story.

### Subject lines

- Specific and calm: `The five-second capture that came back`  
- Not: `🚀 You won't BELIEVE this second brain hack`

### Sign-off

- Plain: name or “Tai” / “Atoms”  
- No “Cheers to crushing it”

### List name in UI

- **Field notes** (user-facing)  
- Engineering/env may still say `ATOMS_NOTES_*` and Resend segment “Atoms Notes” - fine; don’t put that jargon on the page.

---

## tryatoms and plugin chrome (quick)

- Landing already models the voice: short claim, concrete loop, no syntax in the hero.
- Settings and Notices: plain verbs (Process, Sync now, Wipe cloud copy). Explain *what happens*, not internal parser state.
- Kickers and cards: memory shelf, not job queue (see entity-orbits / resurface copy rules).

---

## Do / don’t examples

| Do | Don’t |
|---|---|
| A thought goes in, in five seconds, and comes back the moment it matters. | Supercharge your PKM workflow with AI-powered atomic notes!!! |
| You’re in. Check your email for a short welcome. | 🎉 Welcome to the community of second-brain legends |
| How people run a real second brain day to day. | Top 7 use cases for knowledge workers |
| Reply with how you capture and remember. | Submit your testimonial for a chance to be featured |
| Rare. Practical. No sales sequences. | Exclusive content unlocked for subscribers only |

---

## Where this applies

| Surface | Follow this doc |
|---|---|
| Field notes welcome + Broadcasts | Yes - primary |
| tryatoms marketing blocks | Yes |
| Plugin Notices, home, settings | Yes + tokens/components rules |
| Resend subject/preview | Yes |
| User capture / atom body | **Never rewrite** |

---

## Email visuals

Field notes is not plain-text-only. HTML mail should match tryatoms (dark card, tint blue, quiet type). Diagrams: simple glanceable beats. **Gmail strips SVG** - host PNG on tryatoms; keep SVG as source under `www/src/email/`.

Full layout and export recipe: **`docs/field-notes-email.md`**.

---

## Related

- `docs/design-handoff/tokens/README.md` - visual + no em dash  
- `docs/field-notes-email.md` - HTML email shell + SVG/PNG workflow  
- `docs/components.md` - UI kit + copy placement  
- `docs/runbooks/atoms-notes-list.md` - ops for the list  
- `CLAUDE.md` - body sacred, second brain not task app  
