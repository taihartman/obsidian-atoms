# Home UI components

Shared presentation for Atoms home. Visual authority: [`docs/design-handoff/tokens/README.md`](design-handoff/tokens/README.md).

## Where things live

| Path | Role |
|---|---|
| `src/ui/factories.ts` | DOM factories (`button`, `flatCard`, `claimQuote`, …) |
| `src/ui/index.ts` | Public barrel |
| `styles.css` (`.atoms-ui-*`) | Tokens + component styles |
| `src/home/atomsHomeView.ts` | Composes kit into home surfaces |
| `src/resurface/resurface.ts` | Domain copy helpers (later line, connector, citator lines) |

**Dependency rule:** `home` and `resurface` may import `ui`. `pipeline` must not. `ui` must not import `home`, `pipeline`, or `plugin`.

## Factories

| Factory | Use for |
|---|---|
| `button(parent, { grade, label, onClick, disabled? })` | `primary` · `secondary` · `quiet` |
| `flatCard(parent)` | Neutral grouped card (hairline, radius 16) |
| `statusCard(parent, { tone })` | Transient soft-fill only: `wait` · `progress` · `done` · `error` |
| `claimQuote(parent, { text, maxLines? })` | Serif claim body; CSS quote chrome outside the text node |
| `kicker(parent, { text, variant? })` | Caps eyebrow; `variant: "mind"` = purple **text only** |
| `citatorLine(parent, { relationLabel, peerTitle, onPeerClick? })` | Typographic supersession row (no pill chips) |
| `linkChip(parent, { label, kind })` | Soft-fill `person` · `work` · `neutral` only |
| `listGroup` / `listRow` | Grouped list bones |
| `sectionLabel(parent, text)` | Section headers |
| `backLink(parent, { label, onClick })` | Plain `‹ For you` |
| `actionRow(parent)` | Flex row of buttons |
| `filterTabs(parent, { modes, active, onChange })` | Library All / Linked |

## Contributing a component

1. Prefer extending an existing factory over inventing a one-off class in the view.
2. Add the factory in `src/ui/factories.ts`, re-export from `src/ui/index.ts`.
3. Style under `.atoms-ui-*` in `styles.css` using design tokens (`--atoms-mind`, `--atoms-person`, `--atoms-work`, Obsidian vars).
4. Keep domain copy in `resurface/` (or pure helpers next to factories only if tiny and presentation-only).
5. Do **not** invent purple fills, borders, or gradients for mind-change or citator.
6. Do **not** rewrite capture bodies or inject quote characters into stored text.
7. Run `npm test`, `npm run typecheck`, `npm run build`.

## Hard product locks (mind-change)

- Fossil (old body) is primary on the hero.
- Open is **pair-open** (Then / connector / Now), never single-atom only.
- Purple `#bf5af2` is typographic only on kickers and connectors.
- Hard edges only: `revises` | `contradicts`.
- One mind-change hero per calendar day + pair throttle.
- No em dashes in app-authored copy (user body stays verbatim).
