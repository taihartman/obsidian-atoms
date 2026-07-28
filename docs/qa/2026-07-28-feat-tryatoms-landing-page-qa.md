# QA — tryatoms.app landing page (#159 / PR #160)

**Date:** 2026-07-28 · **Branch:** `claude/tryatoms-landing-page-e46194` · **Version:** 0.6.46

**Scope note, stated plainly:** this is a measured browser verification pass over
the live production build, not a full `world-class-qa` run. The formal QA skill
and its adversarial half were parked by the repo owner ("I cleared qa, let's do
that when I think we're ready"). What follows is what actually ran, with numbers.
Treat the gap as real, not as a formality that was waived.

## What was verified, and how

Driven with Playwright against the deployed site at `https://tryatoms.app`,
measured against stylesheet `/a/styles.d701bc8a.css` (hash confirmed to differ
from the prior build, so no cached-asset false pass).

### Contrast — both colour schemes, forced via `emulateMedia`

All six `.fineprint` blocks, the hero `.lead`, and the hero `.note`. AA for
normal text is 4.5:1.

| Mode | Tightest measured | Worst element |
|---|---|---|
| Light | **4.72:1** | `--faint` fine print on `rgb(242,242,247)` |
| Dark | **4.61:1** | `--faint` fine print on `rgb(0,0,0)` |

Nothing on the page sits below 4.5:1 in either mode.

**Known headroom risk:** dark `--faint` clears by 0.11. Darkening that token, or
placing faint text on any surface lighter than pure black, drops it under AA.
It is a floor, not a comfortable margin.

This pass exists because the previous build measured **1.81:1** in light for the
same copy — the card-requirement and cancellation terms, i.e. the text a buyer
most needs to read.

### Horizontal overflow

| Viewport | scrollWidth | clientWidth | scrollX after horizontal wheel |
|---|---|---|---|
| 390×844 | 375 | 375 | 0 |
| 375×812 | 360 | 360 | 0 |

`clientWidth` reads 15px under the viewport because headless Chromium renders a
classic scrollbar; that is the harness, not the page. The off-stage hero panels
still extend to x=378.5, which is intended — `.hero-stories` has computed
`overflow-x: clip`, which absorbs them without creating a scroll container (so
the sticky bar is unaffected).

### Story carousel, after the clipping change

Arrow advances `rel → work → self`, one panel visible at a time. The visible
`.claude` panel measures left 20 / right 355 at 390px in all three states —
fully inside the viewport, not chopped by the clip.

### Sticky bar and anchors

`#pricing` and `#graph` both land at `getBoundingClientRect().top === 68` after a
nav click, clearing the 56px bar. Exactly one nav link carries `is-current` at a
time and it matches the section in view. Links hidden below 720px, leaving the
wordmark and the CTA.

### Footer legal pages

| Link | href | Result |
|---|---|---|
| Privacy | `/privacy` | 200, `Privacy · Atoms`, 2676 chars of real content |
| Terms | `/terms` | 200, `Terms · Atoms`, 2550 chars of real content |

### Console

One error, known and open: Cloudflare Web Analytics injects
`static.cloudflareinsights.com/beacon.min.js`, which this site's own
`script-src 'self'` blocks. The beacon collects nothing and errors on every
page. Decision pending — disable it in the Pages dashboard, or allow the host.
No application JS errors.

## Automated gates

474 vitest tests, including the pricing two-way gate (built HTML asserted
against both `plus-pricing.json` and the plugin's own `plusPricing.ts`), the
claims tripwires, and the nav/anchor guards. `npm test` now rebuilds `www/dist`
first, so the suite can no longer pass against a stale artifact.

## Not covered

- No formal adversarial break-it pass.
- Real iOS and Android devices. All mobile numbers are emulated viewports.
- Screen-reader pass over the sticky bar and the story carousel.
- The graph canvas under a real reduced-motion OS setting (the code path exists
  and is exercised, but was not verified on a machine with the setting on).
