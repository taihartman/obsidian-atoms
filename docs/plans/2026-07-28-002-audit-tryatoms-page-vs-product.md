# Audit — tryatoms.app page vs the actual product

**Date:** 2026-07-28 · companion to [2026-07-28-001](2026-07-28-001-feat-tryatoms-landing-page-plan.md)
**Method:** two parallel sweeps — full shipped-feature inventory (`src/`) and internal
product-story sweep (CONCEPTS, architecture, spec-amendments, plans, ideation) — diffed
against the live page copy.

## P0 — the page undersells the core magic

| # | Miss | Evidence | Fix |
|---|---|---|---|
| 1 | **Page sells the homework version.** Step 2 says "Run Process and…". The product's own ideation doc: "Feels like a tool: Open app → Tap Process. **Feels like magic**: Dump anytime → Open Atoms later → Stuff is already filed" and "if step 2 always needs a finger-press… **it feels like homework**." Auto-run ships (opt-in, device-gated, past days only, 15/launch cap) | ideation 2026-07-16, `main.ts` auto-run gates | Step 2 becomes "Tomorrow it's already sorted", honestly qualified (turn on auto-run, or keep it to one tap) |
| 2 | **Mind change is buried.** The most distinctive shipped surface (then/now pair view, citator ribbon, "Not a mind-change" recovery). Internal line is dinner-table grade: "*It's the second brain that shows me when I changed my mind.*" On the page it is one flat bullet | belief-rehearsal plan, `resurface.ts`, home view | Give it the closing claim of the resurface section, in its own words |
| 3 | **Person hubs are absent.** "Add {Name}?" invite → one tap makes a person page and retroactively upgrades every soft mention across the library to a real link, cross-links peers. Nothing on the page. Continues the Sam narrative perfectly | home person invite, enrich/people | New tight section: "It notices who matters" |

## P1 — trust machinery unmentioned (it is the conversion argument)

- **Dry-run preview**: full classify pass, writes nothing, shows exact atom body + marker + links + token use — "Nothing written yet." Page never says you can look before it writes.
- **Backfill cost gate**: real token count → dollar figure → modal before any batch spend.
- **Verbatim's WHY is missing**: the rot thesis — "Declarative titles launder uncertainty into confidence"; bodies "preserve hedges and half-formedness." Page says "unchanged" but not why that matters.
- Preview cache (looking twice is free), tag proposals never auto-applied, today never auto-touched (page has this one).

## P2 — worth a line, not a section

- **Together / orbits**: "you've written 6 notes about Yosemite" — themes you never declared; zero extra API cost.
- **Land peak**: post-run card listing the atoms just created.
- **Graph without the hairball**: atom-neighborhood graph, daily-note spider removed.
- **Update notes**: old atoms get better as filing gets smarter; most of it free local polish.

## Copy bank (internal words beat mine — reuse verbatim)

- "It's the second brain that shows me when I changed my mind."
- "Stream, not guilt queue." / "No badge of 'N to review'."
- "Silence beats a wrong shelf."
- "Declarative titles launder uncertainty into confidence." (rot thesis; adapt)
- "A little web of your life" (graph); "not the whole vault hairball."
- Magic vs homework contrast (ideation doc).

## Overclaim tripwires confirmed (do NOT cross)

Auto-run is opt-in + device-local + past-days only → never say "files itself" unqualified.
"Pending ≠ filed" for Ask writes. No promo-code UI ships. No jump nav ships. "Constellation"
is engineering vocabulary, never product. Cold open has no magic without key + captures +
one Process — do not promise instant wow.

## Site infrastructure fixed this round

favicon.svg (sentinel glyph) · og.png 1200×630 (link previews were bare text — deadly for a
share-a-link product) · twitter:card · 404 page · robots.txt.

## Still open (product, not page)

No support mailbox (page points at GitHub Issues) · Terms not lawyer-reviewed · og:image URL
is absolute to tryatoms.app so previews only resolve after the apex goes live.

---

# Implementation plan — Round 2 (approved before edit)

**Discipline:** the last round's lesson was density. Net word count of the page may grow by
at most ~120 words. Every fix below either edits in place or adds one tight section. Sam
remains the single running character.

## R2-U1 · Step 2 becomes the magic, honestly

Replace step 2 ("Atoms sorts out yesterday… Run Process…") with (per doc-review: the
launch-time qualifier lives in the heading itself, not just the body, and no "overnight"
imagery — auto-run fires on open, capped per launch):

> **Come back and it is sorted.**
> Yesterday's captures become notes with a real title and links to what they relate to.
> Let it happen on its own each time you open Obsidian, or keep it to one tap.

The "today is never touched" sentence is NOT repeated here — the specimen caption already
owns it. Test: page must not contain "files itself" / "automatically" without an opt-in
qualifier nearby.

## R2-U2 · New section "It notices who matters" (after resurface, ~55 words)

Sam narrative, third act:

> Write about Sam a few times and Atoms offers: **Add Sam?** One tap makes a page where
> everything about Sam lives. Every note that mentioned Sam gets linked, including
> the ones from months ago. Decline and it stays quiet for two weeks.

Grounded: person invite card, retroactive soft→hard upgrade, 14-day snooze. Test asserts
"Add Sam?" present.

## R2-U3 · Mind change gets the internal line

Resurface section: "Mind change" becomes the first cue bullet, worded as *seeing the
then/now pair with dates* (the Ask section's "Change your mind safely" bullet keeps the
write-path meaning: revising from chat never overwrites — different theme, stays). The
resurface section closes with the claim line (serif): *"It is the second brain that shows
you when you changed your mind."* "One card, then done" stays the last bullet. Grounded:
then/now pair view + citator ship today.

## R2-U4 · Trust section gains preview + the why of verbatim

- New first bullet: **See it before it writes.** Preview shows the exact note, links, and
  markers Process would create, with nothing written to your vault until you say so.
- "Your words, unchanged" gains the rationale: a half-formed hunch stays half-formed
  instead of becoming confident-sounding prose.
- ~~Backfill cost-gate clause~~ — CUT (doc-review, word budget).

## R2-U5 · One-line adds — CUT (doc-review, word budget)

Together / graph / land peak all stay off the page this round. They live in the app and
in the audit's P2 list for a future pass. To fund U1–U4, the Ask section's "reads the
library, not the pile" bullet is trimmed by ~15 words.

## R2-U6 · Tests + honesty tripwires

Extend `test/wwwPricing.test.ts`: "Add Sam?" present; auto-run claim carries opt-in
qualifier; forbidden-phrase list gains "files itself for you" (unqualified), "constellation".

## R2-U7 · Infra already in working tree (this round, mechanical)

favicon.svg · og.png + twitter/og meta · 404.html.tmpl · robots.txt · build.mjs ASSETS
loop. Commit together with the copy changes.

## Order + verify

U1→U6 in one pass on the template · `npm run build:www` · full vitest · local browser pass
at 375/1280 both schemes · redeploy `--branch=preview` · verify live copy strings.

**Explicitly not doing:** restructuring sections again, promo codes (no UI ships), Android
capture promises, "semantic" anything, apex domain.

---

# R3 (Tai, 2026-07-28 13:13) — mockups, not text

Direct feedback on the R2 preview:

1. Hero chat read as an Apple text message. It must read as **Claude** — window
   chrome, ✱ mark, tool-use chip ("searched your atoms"), serif answer, citation line.
2. "Atoms is built for the other half" implied we did not build capture. Atoms is the
   whole system; reword to own both halves.
3. The milk line's fate was unclear. Say it plainly: it becomes nothing; Atoms is not a
   reminders or task app.
4. Sections need to SHOW the product: app-card mockups (product chrome from
   design-handoff tokens: #1c1c1e / radius 16 / kickers / real button vocabulary) for
   Ask write-back, the mind-change pair, and the Add Sam? invite.

Grounding for the mocks (shipped UI): resurface card kickers + quiet Another button;
mind-change pair view (old claim, "later revised/contradicted" connector, new claim,
dates); person invite "Add {Name}?" with Add / Not now; Ask write path returns
pending → lands when Obsidian opens. Mock content stays in the Sam storyline,
placeholder people only.

---

# R4 (Tai, 2026-07-28 14:28) — the gift storyline; show the graph inferring

1. Elevator example not relatable. **New storyline: Sam loves yellow tulips.**
   Hero asks "gift ideas for Sam?" — the question never mentions flowers; the answer
   finds them by walking links through Sam. That is the graph selling itself.
2. **"remember:" is banned as a chat trigger** — reads as a reminders app, which the
   page itself denies. Write-back mock uses "note this:" and captures a *preference*,
   never a todo. Test-blocked.
3. The write-back note (poetry section) is deliberately the second gift signal: caption
   closes the loop — the next gift answer knows it too.
4. Mind-change pair leaves the apartment world: night-owl → morning-brain (relatable to
   the note-taking audience, still first-person claims).
5. "Follow the thread" bullet names the mechanism plainly: notes form a graph; the gift
   question finds the tulip note because both point at Sam.

Honesty check: this flow is exactly what the MCP tools do — keyword search on the
person, then neighbors/link-walking, then the model synthesizes. No semantic-search
implication added; the tool chip shows "followed links from Sam", not magic.

---

# R5 (Tai, 2026-07-28 14:38) — switchable coordinated storylines

One segmented control in the hero switches the WHOLE page's example world; every mock
downpage follows. Constraints:

- **CSS-only** (radio inputs + `:checked` general-sibling selectors). The page ships no
  JS and its CSP blocks scripts; that stays true, and the no-script test keeps guarding.
- **Two stories:** Life (Sam, tulips — default) · Work (Priya, a client whose budget
  freezes in November). A third is one HTML block later if wanted.
- **Swapped surfaces (5):** hero Q&A, specimen daily→atom, "Follow the thread" bullet,
  write-back mock + loop caption, "Also about" cue, Add-person card + People paragraph.
- **Shared:** headline, lead, mind-change pair (midnight vs morning is universal),
  trust, pricing, install, privacy.
- Work story keeps every honesty rule: verbatim body, noise line ("reply to the invoice
  email") becomes nothing, write-back is a preference (deck-on-phone), pending state
  shown, "note this:" trigger.

---

# R6 (Tai, 2026-07-28 14:46) — labeled story carousel, JS allowed, cache bug

Two failures surfaced by Tai's screenshot + questions:

1. **Stylesheet cache bug (P0).** `_headers` cached `/styles.css` for an hour, so a
   deploy could serve new HTML with old CSS — which is exactly what Tai saw (both
   stories stacked, unstyled "Life Work" text). Fix: content-fingerprinted asset
   filenames under `/a/` (`styles.<hash>.css`, `app.<hash>.js`) with immutable
   caching; HTML revalidates. A deploy can never again mix old CSS with new HTML.
2. **The no-JS rule was self-imposed and over-applied.** The CSP header is ours;
   loosened one notch to `script-src 'self'`. No inline script, no third-party.

New design (Tai's): stories get **named scenario labels** above the hero mock —
**Relationships (Sam) · Work (Priya) · Journaling (self)** — with ‹ › arrows cycling
and clickable labels. Whole page still coordinates via `data-story` on `<main>`;
default Relationships works with JS disabled.

Third story (Journaling): skipped-lunch afternoons capture; hero asks "why do my
afternoons keep falling apart?"; write-back is the clean-drafts-after-a-run
observation; the People section swaps to Patterns with a Together card ("Six notes
about Running" — grounded: Together card + entity hubs ship). Noise line: "call the
dentist" becomes nothing.

Class scheme: `.s-rel` / `.s-work` / `.s-self` (story-specific) + `.s-people`
(shared by rel+work, hidden in self). Tests updated: exactly one same-origin script
tag; all three arcs complete; default story present without JS.
