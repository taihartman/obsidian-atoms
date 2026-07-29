# tryatoms.app landing page — adversarial + accessibility QA

**Date:** 2026-07-28
**Scope:** `www/` landing page (`index.html`), built from `www/src/` via `www/build.mjs`
**Status:** Investigation only. No repo file was modified, nothing was committed, nothing was deployed.
**Severity scale:** High = blocks or loses content for a real user segment · Medium = degrades a primary flow or a WCAG-relevant behaviour · Low = polish, robustness, or advisory

---

## Method and its limits

Built with `npm run build:www` and served `www/dist` from `python3 -m http.server` on `127.0.0.1:8899`. The build is deterministic (content-hashed assets), and `git status www/` was clean after building — no tracked file changed.

Three things to know before reading the findings:

1. **No Playwright MCP was connected in this session.** The available browser driver was `chrome-devtools-mcp`. Everything below was driven through it (real Chrome, real CDP, real key presses). Equivalent capability, different tool — worth noting if you want to reproduce with the exact tooling named in the brief.
2. **The local server does not apply `www/src/_headers`.** The production CSP (`default-src 'none'; script-src 'self'; …`), `X-Frame-Options`, and the immutable caching on `/a/*` were **not** exercised. CSP behaviour needs a preview-deploy check.
3. **`prefers-reduced-motion` could not be emulated at the OS level** — the `emulate` tool exposes no reduced-motion knob and the browser was already running. I substituted two checks that are, for the CSS half, actually stronger than emulation: an exhaustive CSSOM walk of every rule carrying `animation`/`transition`, plus a `matchMedia` override to test the JS half. Both are reported below with what they do and don't prove.

Viewports exercised: 320, 640, 1280, 2560 CSS px, plus 320×225 and 640×450 as the WCAG 1.4.10 equivalents of 400% and 200% zoom at 1280×900.

---

## Pass 1 — Adversarial

### A1 · High · No-JS (or failed-JS) visitors lose 29% of the page, and the carousel fails silently

**Repro.** Copy `www/dist` to a scratch dir, strip the single `<script src="/a/app.*.js" defer>` tag from `index.html`, serve it. Load the page.

**What happens.** All five carousel controls render fully styled, with hover states, and do nothing when clicked. `<main data-story="rel">` is the server-rendered default and nothing can ever change it, so `.s-work` and `.s-self` stay `display:none` permanently.

**Measured:** 580 of 1,971 words in `<main>` are unreachable — **29.4%**. That is the entire Work story (253 words), the entire Journaling story (228 words), two of the three hero conversation panels (99 words), plus a whole `<h2>` section ("It notices what repeats") and its `<h4>` ("Six notes about Running"). There is no `<noscript>` element anywhere on the page (0 occurrences).

**Why this is not hypothetical.** The site ships `script-src 'self'` (`www/src/_headers:6`), and the comment at `www/build.mjs:240-244` records that this exact class of failure — new HTML served against a stale asset — *already broke the story switcher in production on 2026-07-28*. That is why the fingerprinting exists. Any recurrence, any CSP misconfiguration, any blocked-script corporate proxy reproduces A1 exactly.

**Credit where due:** the no-JS fallback is partly deliberate and it works. All three SVG graphs render statically (`display: block`), and all four sticky-nav anchors resolve. The gap is specifically the carousel.

**Fix location:** `www/src/styles.css:808-816` (the `display:none` story rules) and `www/src/index.html.tmpl` (no `<noscript>` exists to neutralise them or to hide the inert controls).

---

### A2 · Medium · Switching story off-screen burns that graph's entrance animation permanently

**Repro.** Load at 1280×900, stay at the top of the page, click "Work", wait 2.5 s, then scroll down to the graph.

**Measured.** The Work graph figure sits at y = 4726 with a 900 px viewport — nowhere near visible. Clicking "Work" starts the force simulation immediately: drawn-pixel count goes 13283 → settles to 12918 while off-screen. On scroll-into-view it reads 12918 at t+60 ms and 12917 at t+760 ms. No motion. The graph is already dead by the time anyone sees it.

Only the default Relationships graph ever animates on entry. The documented intent (`www/src/app.js:1-13`, "Graph: … Node/link data is read out of the server-rendered SVG"; the `IntersectionObserver` at `:430-441`) is that graphs draw as they enter the viewport.

**Cause.** `onStoryChange` calls `g.start()` for every graph with a non-zero `clientWidth`, with no viewport check, and `start()` is one-shot behind a `started` guard — so the entrance can never replay.

**Fix location:** `www/src/app.js:412-421`.

---

### A3 · Medium · A story switch blanks the hero, and the answer is withheld for ~0.9 s

**Repro.** Click "Work". Sample `getComputedStyle().opacity` on the panel and its four lines.

**Measured timeline** (t = 0 at click):

| t (ms) | panel | question | tool chip | **answer** | citation |
|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 0 |
| 305 | 0.93 | 0.72 | 0 | 0 | 0 |
| 613 | 1 | 0.99 | 0.78 | 0 | 0 |
| 918 | 1 | 1 | 1 | **0.82** | 0 |
| 1227 | 1 | 1 | 1 | 1 | 0.87 |
| 1602 | 1 | 1 | 1 | 1 | 1 |

The panel is completely blank at the moment of the click. The answer — the entire payload of the carousel, the thing that demonstrates the product — is not readable until **918 ms**, the citation until **1227 ms**, and it settles at ~1.6 s.

**Consequence.** Anyone clicking through the three stories faster than ~1.5 s each reads not one answer. There is no way to skip the cascade. The interaction actively punishes the exploratory clicking it invites.

**Fix location:** `www/src/styles.css:520-563` (the 140 / 420 / 700 / 980 ms `animation-delay` ladder).

---

### A4 · Low · Carousel state never reaches the URL or history

**Repro.** Click "Journaling". `location.href` is unchanged; `history.length` delta is 0; `location.hash` is empty.

Three consequences: the Work and Journaling stories **cannot be linked or shared** (every URL opens on Relationships); **Back after switching leaves the page** rather than undoing the switch; and **reload silently discards** the visitor's selection.

**Fix location:** `www/src/app.js:24-32` (`set()` — add `history.replaceState` plus a hash reader on load).

---

### A5 · Low · No arrow-key support on a control literally drawn as `‹ ›`

**Repro.** Tab to "Relationships", press ArrowRight. Story stays `rel`. `grep -n "keydown\|keyup\|keypress" www/src/app.js` returns nothing — there are no keyboard handlers in the file at all.

Not an APG violation for the `aria-pressed` toggle pattern actually used, but the `‹ ›` glyphs set a keyboard expectation the code doesn't meet. A keyboard user must Tab onto the arrow button and press Enter.

**Fix location:** `www/src/app.js:34-44`.

---

### A6 · Low · Three unthrottled `resize` listeners, each reallocating a canvas bitmap

**Repro.** Dispatch 30 synthetic `resize` events during an in-flight simulation.

**Result: robust.** No exceptions, no NaN, canvas stayed 496×413, drawing intact. But each event triggers three full bitmap reallocations plus three full redraws (one per graph, including the two that are `display:none`). During a real drag-resize that runs every frame.

**Fix location:** `www/src/app.js:383`.

---

### Adversarial checks that found nothing

Recorded so the next pass doesn't redo them:

- **25 rapid `next` clicks with no paint between frames** → lands on `work` (25 mod 3 = 1). `is-active`, `aria-pressed`, the visible hero panel, and the visible body band all agree. No desync.
- **40 alternating next/prev clicks** → consistent.
- **Two clicks mid-cross-fade** (at 120 ms and 240 ms into the 340 ms fade), then settle → exactly one active button, one visible panel, one visible band. No stuck or double state. During the fade two panels are briefly both `visibility: visible`, which is the cross-fade working as designed; neither contains a focusable element, so there is no focus consequence.
- **320 / 640 / 1280 / 2560 px** → zero elements overflowing the viewport, no horizontal scrollbar at any width. `.wrap` caps at 544 px so line length stays sane at 2560.
- **Console** → zero messages on load, and still zero after every abuse above.
- **Network** → 4/4 requests 200 (document, fingerprinted CSS, fingerprinted JS, favicon). No failed or blocked requests.
- **Sticky-nav anchor nav** → all four targets land with 102 px clearance below the 57 px bar (`scroll-margin-top: 68px`, `styles.css:122`). The `is-current` highlight tracks correctly. Back after anchor nav restores scroll position and preserves the selected story (same-document navigation).

---

## Pass 2 — Accessibility

> **This is an automated pass, not a screen-reader pass.** Everything below was derived from the DOM, the CSSOM, computed styles, and real keyboard events. No screen reader was run. Automated tooling cannot tell you whether the announced result is *comprehensible* — only whether the machinery is present. Items B1, B2, B3, and B8 in particular describe machinery that is technically valid ARIA and may still be a poor listening experience; that judgement needs a human on VoiceOver, NVDA, or JAWS. See "Requires a human or a real device" at the end.

### B1 · High · `role="img"` hides 16.7% of the page's copy from assistive tech, and the alt text is not equivalent

Ten blocks (`.claude` conversation windows, `.appcard` cards) carry `role="img"` plus an `aria-label`. `role="img"` makes an element a leaf node: everything inside it is removed from the accessibility tree and replaced by the label.

**Measured:** 330 words of on-screen copy suppressed, replaced by 110 words of alt text — **16.7% of all copy in `<main>`**.

The suppressed text is the demonstration payload: the example questions and the answers. A sighted visitor reads the actual exchange. A screen-reader user gets "A Claude chat answering a question from your own notes." WCAG 1.1.1 asks for a text alternative that serves the *equivalent purpose*; a one-line description of a conversation does not serve the same purpose as the conversation.

Worse, **three of the ten alt strings are byte-identical** — "Telling Claude to note something, which queues a note for your vault" — across three panels showing three different stories. The alt text does not even distinguish Relationships from Work from Journaling.

**Fix location:** `www/src/index.html.tmpl:104, 129, 154, 366, 394, 421, 491, 538, 557, 577`.

---

### B2 · High · The graph has no accessible name, and JS strips the only text it had

Two compounding problems:

1. The server-rendered `<svg>` is emitted with `role="img"` and **no `<title>` and no `aria-label`** — `www/build.mjs:180`. A bare unnamed `role="img"` is a failure on its own (this is what axe flags as `svg-img-alt`).
2. At runtime `app.js` inserts a `<canvas>` with **no `role`, no `aria-label`, no `aria-hidden`, no `tabindex`** (verified: all four `null`), and CSS applies `.has-canvas .graph-svg { display: none }`. The node labels — "Sam", "Gift ideas", "Yellow tulips", "Coast trip" — leave the accessibility tree entirely (verified: `svgSiblingDisplay: "none"`).

What survives is the `aria-label` on the wrapping `<figure>`: "A graph of notes around Sam". That single string is the entire accessible content of a section headlined "A little web of your life."

Note the inversion: **the no-JS fallback and the JS version are both inaccessible, for different reasons.** Fixing only `build.mjs` leaves the JS path broken, and vice versa.

**Fix location:** `www/build.mjs:180` (add `<title>`), `www/src/app.js:127-130` (name the canvas, or `aria-hidden` it and keep a visually-hidden list of the labelled nodes), `www/src/styles.css:683-685`.

---

### B3 · Medium · Changing story announces nothing; the arrow buttons are silent by construction

The page has **zero live regions** (`[aria-live]`, `[role="status"]`, `[role="alert"]` → 0 elements).

Pressing "Next story" swaps the hero panel and three body sections. Focus correctly stays on the arrow button — that part is right — but the `aria-pressed` change lands on a *different* button than the focused one, so nothing is announced. A screen-reader user pressing "Next story" gets silence and has no way to know the page changed beneath them.

The three label buttons are better off: pressing "Work" announces its own `aria-pressed` change. The arrows announce nothing at all.

**Fix location:** `www/src/app.js:24-32` (`set()`).

---

### B4 · Medium · Heading levels skip h2 → h4, twice

- `index.html.tmpl:526` `<h2>It notices who matters</h2>` → `:560` `<h4>Add Sam?</h4>` (and `:580` `<h4>Add Priya?</h4>`)
- `index.html.tmpl:530` `<h2>It notices what repeats</h2>` → `:541` `<h4>Six notes about Running</h4>`

No `h3` in between. Heading-level navigation — the primary way screen-reader users skim a long marketing page — reports a structure that doesn't exist. WCAG 1.3.1.

Everything else in the outline is clean: exactly one `h1`, and the `h2` → `h3` runs under "You only do the first step" and "$6 a month" are correct.

---

### B5 · Medium · The section nav disappears at 200% zoom and never comes back

`.topbar-links` is `display: none` by default and only shown at `@media (min-width: 720px)` — `www/src/styles.css:185-199`. The comment there explains the tradeoff honestly ("Under 720px the four anchors would crowd out the button, which matters more"), but it was reasoned about as a *phone* breakpoint, and it also fires on *desktop zoom*.

**Measured:** at 200% zoom on a 1280 px screen (effective 640 px) all four links measure 0 × 0. Same at 400% (320 px). There is no hamburger, disclosure, or any replacement.

So a low-vision user who zooms loses "How it works / Ask / Catch up / Pricing" entirely and must scroll a ~7,000 px page to find anything. Meanwhile the sticky bar still consumes **25.3% of the viewport height** at 400% zoom while containing only a logo and a CTA — it costs a quarter of the screen and delivers no navigation.

Reflow itself **passes**: no horizontal scrolling at either 200% or 400%, zero overflowing elements. This is a loss-of-function finding, not a 1.4.10 failure.

---

### B6 · Medium · The graph is mouse-only

`canvas.classList.add("is-interactive")` is gated on `matchMedia("(pointer: fine)")`. Drag and hover-to-highlight-neighbours are pointer-only. The canvas has no `tabindex`, and `app.js` contains no keyboard handlers at all.

Mitigating: the interaction is exploratory and exposes no information a keyboard user couldn't otherwise get — because, per B2, no information is exposed to *anyone* using assistive tech. **Fix B2 first**; B6 only becomes a real 2.1.1 question once the graph carries content worth reaching.

**Fix location:** `www/src/app.js:339-381`.

---

### B7 · Low · `aria-label` on a role-less `<div>` is silently dropped

`index.html.tmpl:82`: `<div class="story-nav" aria-label="Choose an example story">`.

`aria-label` only applies to elements with a role that supports naming. A plain `div` has no role, so browsers discard the label. The intent — telling a user what this cluster of five buttons is for — does not reach anyone. Give it `role="group"`, or make it a `<fieldset>`/tablist.

---

### B8 · Low · Toggle-button semantics for a mutually exclusive three-way choice

`index.html.tmpl:86-91`: three `<button>`s with `aria-pressed`, no `role="tab"`/`tablist`, no `aria-controls`, no radiogroup.

This is legal ARIA. But a screen-reader user hears three unrelated toggle buttons rather than one three-option control, gets no pointer to the region each governs, and — combined with B7 — no grouping at all. The visual design (a segmented pill with arrows) implies the tab or radio pattern; the markup implements neither.

---

### B9 · Low · The second `<nav>` has no accessible name

`index.html.tmpl:810` (footer). The page exposes two `nav` landmarks; only the first is labelled ("Sections"). Landmark navigation lists an anonymous second one. Same on `privacy.html`.

---

### B10 · Low · One motion rule sits outside the reduced-motion guard

`www/src/styles.css:952-955` — `.btn:active { transform: scale(0.98); opacity: 0.92; }`.

Every other motion rule in the stylesheet is correctly inside `@media (prefers-reduced-motion: no-preference)`. This one isn't. A 2% press scale, so practical impact is small — but it's the single exception in an otherwise disciplined stylesheet, which makes it more likely to be an oversight than a decision.

---

### B11 · Low, advisory · In-page anchors don't set focus; it works in Chrome by grace of spec

After clicking "Pricing" and pressing Tab, focus continued at the "BRAT" link near the new scroll position rather than jumping back to the top — Chrome's "sequential focus navigation starting point" doing its job. `document.activeElement` is `BODY` immediately after the click.

Section targets have no `tabindex="-1"`, so the robust remedy is absent and the behaviour depends on the browser implementing that part of the spec well. Historically weaker in Safari + VoiceOver. **Flagged for the human pass.**

---

### B12 · Low, advisory · No skip link

`skipLink: false`. Landmarks (`nav` / `main` / `footer`) are present and are an accepted bypass technique (ARIA11), and the topbar is *not* repeated on `privacy.html` / `terms.html` — so this is not a clean 2.4.1 failure. On a ~7,000 px single page a skip link is still cheap insurance.

---

### What passed

- `lang="en"`, unique descriptive `<title>`, exactly one `<h1>`.
- **No keyboard traps.** Focus order matches visual order — zero inversions across all 20 focusable elements. **Zero focusable-but-hidden elements**: inactive hero panels use `visibility: hidden` and inactive body bands use `display: none`, both of which correctly remove focusability. This is the thing most carousels get wrong, and this one gets it right.
- **Focus indicator present and correct**: 2 px solid `#0a84ff` at 3 px offset, `:focus-visible` matching properly on keyboard Tab (and not on click). Contrast 3.01:1 against the pill background, 3.27:1 against the page — clears the 3:1 minimum for non-text contrast, though 3.01 is as close to the line as it gets.
- Arrow buttons carry `aria-label` ("Previous story" / "Next story"). Targets are 34 × 34 px — above the 24 × 24 WCAG 2.2 AA minimum, below the 44 × 44 AAA target. `.btn` is `min-height: 44px`.
- **Reduced motion, JS half:** with `matchMedia` overridden to report `reduce`, zero `.reveal` classes are applied, `reveals-on` is never set on `<html>`, and the graph settles without animating (identical pixel counts across 600 ms). Correct.
- **Reduced motion, CSS half:** an exhaustive CSSOM walk of every rule declaring `animation` or `transition` found all motion rules inside `@media (prefers-reduced-motion: no-preference)` — including `scroll-behavior: smooth` (`styles.css:70-72`), which is the one most sites forget. The only two outside are `.btn:active` (B10) and `.reveals-on .reveal`, and the latter is guarded in JS instead (`app.js:443` returns before any `.reveal` class or the `reveals-on` flag is ever applied). Belt-and-braces would be to guard it in CSS too, since the JS guard is the only thing standing between a reduced-motion user and 40-odd transform transitions.
- Zero `<img>` elements on the page, so no missing `alt` attributes.
- **Link purpose:** 15 links, no vague text ("here", "learn more"), no repeated text pointing at different destinations, no `target="_blank"` (so no new-window warning owed and no `rel="noopener"` exposure).
- `privacy.html`: clean `h1` → `h2` order throughout, `main` / `footer` / `nav` landmarks present, zero scripts.

---

## Defect summary

| # | Sev | Defect | Fix location |
|---|---|---|---|
| A1 | **High** | No-JS: 29.4% of copy unreachable; carousel fails silently; no `<noscript>` | `styles.css:808-816`, `index.html.tmpl` |
| B1 | **High** | `role="img"` suppresses 330 words (16.7%) from AT; 3 alt strings identical | `index.html.tmpl:104,129,154,366,394,421,491,538,557,577` |
| B2 | **High** | Graph has no accessible name; JS `display:none`s the only labelled text | `build.mjs:180`, `app.js:127-130`, `styles.css:683-685` |
| A2 | Medium | Off-screen story switch burns the graph entrance animation permanently | `app.js:412-421` |
| A3 | Medium | Story switch withholds the answer for 918 ms; fast clicks show nothing | `styles.css:520-563` |
| B3 | Medium | Story change announces nothing; arrow buttons silent; 0 live regions | `app.js:24-32` |
| B4 | Medium | Heading levels skip h2 → h4 twice | `index.html.tmpl:526→560, 530→541` |
| B5 | Medium | Section nav vanishes at 200%/400% zoom with no replacement | `styles.css:185-199` |
| B6 | Medium | Graph drag/hover is pointer-only, no keyboard path | `app.js:339-381` |
| A4 | Low | Carousel state absent from URL/history — unshareable, Back exits page | `app.js:24-32` |
| A5 | Low | No arrow-key support on a `‹ ›` control | `app.js:34-44` |
| A6 | Low | 3 unthrottled resize listeners, each reallocating a canvas bitmap | `app.js:383` |
| B7 | Low | `aria-label` on role-less `<div>` is dropped | `index.html.tmpl:82` |
| B8 | Low | Toggle-button ARIA for a mutually exclusive 3-way choice | `index.html.tmpl:86-91` |
| B9 | Low | Footer `<nav>` has no accessible name | `index.html.tmpl:810` |
| B10 | Low | `.btn:active` transform outside the reduced-motion guard | `styles.css:952-955` |
| B11 | Low | Anchors don't set focus; relies on Chrome's focus-start-point | `index.html.tmpl` (section targets) |
| B12 | Low | No skip link on a ~7,000 px page | `index.html.tmpl` |

Three notes on shape. First, **A1, B1, and B2 are one theme**: every mechanism that makes this page persuasive — the JS carousel, the mocked chat windows, the canvas graph — is a mechanism that fails closed for someone. Fixing them individually is fine; noticing they rhyme is more useful. Second, **the code is genuinely robust where it counts**: no console errors under any abuse, no state desync, no overflow at any width, no keyboard traps, no focusable hidden content, disciplined reduced-motion handling. The defects are gaps in reach, not bugs in logic. Third, **B2 gates B6**, so sequence them.

---

## Requires a real physical device or a human screen-reader user

I could not do any of the following, and nothing above should be read as covering them.

**Screen-reader verification (human, required).** Every finding in Pass 2 is a claim about the accessibility *tree*, not about what a screen reader *says*. Specifically needing a human on VoiceOver (macOS + iOS), NVDA, and JAWS:

- **B1** — is "A Claude chat answering a question from your own notes" actually comprehensible in flow, or does the page just sound like a list of ten pictures? My 16.7% figure is a token count, not a comprehension measure.
- **B2** — what does the graph section sound like end to end? Does the `<figure>` label alone leave a listener wondering what they missed?
- **B3** — confirm the arrow buttons are as silent as the DOM implies, and that the label buttons' `aria-pressed` change is announced usefully rather than as a bare "pressed".
- **B8** — does the three-toggle-button rendering actually confuse people, or is it fine in practice? This is a listening judgement, not a spec question.
- **B11** — anchor focus behaviour in **Safari + VoiceOver** specifically, where the sequential-focus-navigation-starting-point support is historically weaker than Chrome's.
- **Reading order** with the virtual cursor, which no automated check reproduces.

**Real-device testing (physical hardware, required).** All mobile numbers in this report and every prior one are emulated viewports. Untested:

- **Touch interaction with the graph.** `canDrag` is gated on `(pointer: fine)`, evaluated once at load. On a real touchscreen the canvas should stay `pointer-events: none` and never steal a scroll gesture — that is the stated design intent and it is exactly the kind of thing that behaves differently on real hardware. Needs a real finger on a real phone.
- **Hybrid devices** (touchscreen laptop, iPad + trackpad, Surface) where `(pointer: fine)` is ambiguous or changes mid-session. The one-shot evaluation is a plausible failure point.
- **Real iOS Safari and Android Chrome**: `-webkit-text-size-adjust`, `position: sticky` behaviour under rubber-band scroll and dynamic URL-bar resize, and whether the sticky bar's viewport cost is worse with the browser chrome visible.
- **Real 400% browser zoom**, as opposed to my 320×225 viewport proxy. True page zoom also scales fonts and rasterisation; B5 should be re-confirmed with actual Cmd-+.
- **Performance on real mid-range hardware.** The force simulation is O(n²) over ~45 nodes per graph, three graphs, plus 3 unthrottled resize listeners (A6). It was smooth in desktop Chrome and I did not profile it under CPU throttling. Battery and thermal behaviour on a phone is unknown.
- **OS-level `prefers-reduced-motion`.** I verified the CSS structurally and the JS via override; nobody has yet loaded this page on a machine with "Reduce motion" actually switched on in System Settings. That check is 30 seconds of human time and closes the gap properly.

**Production-only checks (deploy, not device).**

- The `_headers` CSP, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` were **not** exercised — `python3 -m http.server` ignores them. Given that A1's failure mode has already occurred once in production from an asset-caching mismatch, verifying the CSP against a preview deploy is worth doing before the next release.
- The immutable `/a/*` caching behaviour, likewise.

**Not covered by scope.** I did not audit colour contrast systematically. My spot checks hit alpha-composited colours (`rgba(60,60,67,.78)` over `color(srgb …)`) that a naive ratio calculation gets wrong, so I deliberately report no contrast numbers except the focus indicator, which is opaque and measurable (3.01:1 / 3.27:1 — passing, narrowly). A proper contrast pass with a tool that composites alpha correctly is still owed, in both light and dark schemes.
