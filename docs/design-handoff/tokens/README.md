# Atoms — design tokens & direction (handoff, v2 editorial)

**Date:** 2026-07-16 · **Status:** settled with human review (v2 supersedes v1 same day)
**Grounded in:** shipped `styles.css`, `docs/design-handoff/atoms-view/`, `docs/design-handoff/belief-rehearsal/` (master @ c0dad02)
**Mocks in this folder:** `Atoms Design Tokens.dc.html` (token sheet), `Direction - Current vs Editorial.dc.html` (4a = settled direction; 3a/3b = rejected extremes), `Belief Rehearsal - Hero Native + Open Pair.dc.html` (v1 pair structure; visual treatment superseded by 4a in Direction mock)
**Repo location:** `docs/design-handoff/tokens/` (this folder)

**Note:** `.dc.html` files are Claude Design canvas exports. They reference `./support.js` (Design Canvas runtime). Prefer reading this README as the durable token authority; open the `.dc.html` files in Claude Design or accept partial render without the runtime.

## What changed in v2 (human-driven)

The v1 system read as generic "AI-designed" iOS-dark. v2 keeps the semantic color map and grouped-list bones but:

- **Serif claim voice.** Claim bodies (hero, pair view, atom open) render in a quiet serif inside quotation marks: your past self, cited. App chrome stays sans.
- **Flat cards.** No gradients, no accent-tinted card fills, no accent borders. Hero and claim cards are plain grouped surfaces; emphasis comes from the serif voice and scale.
- **Purple is typographic only.** Mind-change accent renders as text (uppercase kicker, small-caps connector, citator text). Purple never fills anything.
- **Colored chips stay.** Person orange / work cyan soft-fill chips are functional wayfinding and were explicitly kept.
- **No em dashes** anywhere in app copy. Periods and colons.

## Direction — six rules

1. **Native to the pocket.** Mobile-first iOS-dark grouped-list energy inside an Obsidian leaf. System font chrome, 16px gutters, ≥44px targets.
2. **Quiet by default.** No counts-as-guilt, no due queues, no confetti. Empty states fall through silently.
3. **One hero per screen.** At most one For-you hero per day; status cards never compete with it.
4. **Accents are semantic.** Color states a category, never decorates. Purple is typographic only.
5. **Theme-respecting.** Ship CSS resolves through Obsidian variables; hard hex lives only in mocks and fallbacks.
6. **Your words are quoted.** Serif quotation for claim bodies; sans for chrome; plain punctuation.

## Color tokens

| Token | Ship CSS | Dark hex | Meaning / scope |
|---|---|---|---|
| Tint / action | `var(--interactive-accent)` | `#0a84ff` | Primary buttons, links, active state, progress fill, revised-claim reference |
| Person | `var(--color-orange, #ff9f0a)` | `#ff9f0a` | Person chips, waiting/attention card tint, setup hints |
| Work / media | `var(--color-cyan, #64d2ff)` | `#64d2ff` | Work/media chips only |
| Mind-change | `var(--color-purple, #bf5af2)` | `#bf5af2` | Typographic only: hero kicker (uppercase), pair connector (small caps), citator text. Never a fill, border, or gradient |
| Done | `var(--color-green, #30d158)` | `#30d158` | Progress success state only |
| Error | `var(--text-error)` | `#ff453a` | Failed badges, error card state |
| Surfaces | `var(--background-primary / -secondary / modifier-border)` | `#000` / `#1c1c1e` / `#2c2c2e` / sep `rgba(84,84,88,.55)` | bg / grouped card / elevated fill / separator |
| Text | `var(--text-normal / -muted / -faint)` | `#fff` / 60% / 32% of `rgba(235,235,245,x)` | label / secondary / tertiary |

**Known debt:** shipped `styles.css` hard-codes `#bf5af2`. Route through `var(--color-purple, #bf5af2)`.

**Soft-fill recipe (narrowed):** `color-mix(in srgb, ACCENT 9–18%, transparent)` fills apply to typed chips and transient status cards (waiting, progress, done, error) only. Hero and claim cards are flat with neutral hairlines.

**New chip categories:** allowed but rationed — must map to a stable classifier output. Mint from Obsidian named accents (yellow → place, pink → health next). Caps: 2 chips/row, ≤5 categories app-wide; overflow renders neutral (`#2c2c2e` fill, secondary text). Blue/green/red stay reserved for action/done/error. Purple is never a chip.

**User-configurable colors:** no settings picker; themes/snippets already recolor via the vars above.

## Type scale

System sans for chrome; serif for claims. No uppercase except eyebrows/kickers.

| Token | Spec |
|---|---|
| display | 1.85rem · 700 · −0.035em |
| title-open | 1.35rem · 700 · −0.03em |
| card-title | 1.05–1.15rem · 650 · −0.02em |
| **claim-serif** | 'New York', ui-serif, Georgia · 1.05–1.3rem · 400 · lh 1.42–1.5 · quote chrome “ ” |
| row-title | 0.98rem · 500–550 · −0.015em |
| body-muted | 0.85–0.9rem · 400 · lh 1.4 · text-muted |
| chip / meta | 0.75–0.8rem · 500–600 · −0.01em |
| eyebrow / kicker | 0.68–0.72rem · 600 · +0.12–0.14em · caps |

## Shape, space & touch

- **Radius:** 6–8 badges · 12 buttons · 14–16 cards/list groups · 980 pills (chips only)
- **Spacing:** steps 4/6/8/10/12/14/16 · gutter 16 · card padding 14–18 · nothing >24 in-frame
- **Touch:** targets ≥44px; press `scale(0.98)` + opacity 0.92, 120–150ms. No hover-dependent affordances.
- **Motion:** progress bars 6px/3px radius. No confetti, no bounce.

## Component grades

- **Hero (mind-change):** flat grouped card, neutral hairline border, radius 16. Uppercase purple kicker (text), serif-quoted fossil body, hairline-separated "Twelve days later you revised this: [blue title]" line, Open (solid blue) + Next (elevated) + quiet full-width "Not a mind-change".
- **Open pair:** two flat cards. Fossil: date + serif quote, no title. Connector: small-caps purple text on hairline (`revised by` / `contradicted by`). Newer: date + sans title + serif quote. Exactly two claims, never a timeline. Exits: Open in vault (primary), Done (elevated), Not a mind-change (quiet).
- **Status cards** (waiting/progress/done/error): 16 radius, 9–10% accent soft fill, 28–40% border mix. Transient states only.
- **Plain group:** grouped surface, rows ≥58px, hairline separators.
- **Buttons:** primary (solid tint) · secondary (elevated `#2c2c2e`) · quiet (transparent, secondary 60% text). Max one primary per card. Interactive text never below 60% label opacity; tertiary 32% is non-interactive meta only.
- **Citator ribbon:** typographic, no pills. Small-caps purple edge label (`revises` / `contradicted by`) + peer title in label color, hairline below. Hard edges only; "relates" never appears.

## Light theme

Obsidian vars carry surfaces/text. Two extra rules: fills mix into the card surface, not transparent (`color-mix(in srgb, ACCENT 12–16%, var(--background-secondary))`); accent text darkens on light (`color-mix(in srgb, ACCENT 75%, black)`) — raw orange/cyan/purple on white fails contrast.

## Truncation & width

Hero claim: clamp 4 lines (Open reveals). Pair claims: 8 lines. Library titles: 2. Citator peers: 1 line ellipsis. Chips: ≤45% row width. Serif quotes ≤65ch; desktop content column caps at 560px.

## Copy rules

- No em dashes in app-authored copy (periods and colons). The ban never touches user capture text, which stays verbatim.
- Quotation marks around claims are chrome, rendered outside the text node. Never inserted into the capture.
- Claim bodies verbatim, always in quotation marks when set in serif.
- No calendar/guilt language in cues ("Twelve days later you revised this", never "due" or "overdue").
