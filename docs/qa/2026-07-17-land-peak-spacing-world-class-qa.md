# World-Class QA: fix/land-peak-spacing (+ cascade follow-up)

## Verdict

**Ready after cascade fix (0.6.23).**  
0.6.22 spacing improved the outer card but **row padding was still zero** (ghost text-control override). Re-verified after cascade-specific rule; craft pass on decisive frame.

## Charter

Land peak Done card after Process/Update must not feel cramped. Diff: `styles.css` rhythm vs `land-then-remember` mock. Adjacent: status progress card, Done dismiss, multi-leaf home.

## Preflight

| Item | Status |
|---|---|
| Bootstrap | ✅ |
| Nav map | ✅ land peak on Atoms home |
| Run | ✅ `npm test` 287 · build · install |
| Fixture | ✅ throwaway `test_vault` |
| Device | ✅ Desktop Obsidian + CLI |
| Mock | ✅ `docs/design-handoff/atoms-view/land-then-remember.html` |
| Phone | ❌ not this pass |

## User intent

- **Goal:** After filing/update, see what landed without a dense/glued card.
- **Questions:** What finished? Can I open a note? Where is Done?
- **Distrust:** Cramped list, cut-off titles, tiny tap targets.

## §4a Targets

| Surface | Expected | Evidence |
|---|---|---|
| Land peak card | 16px padding; title/body/list/CTA rhythm | computed + screenshot 08 |
| Landed rows | padding 14×16; min-height 52; title/meta gap | computed `rowPad: 14px 16px` |
| Done button | ≥44px min-height | computed `btnMin: 44px` |
| Mixed headline | Updated N · polished M | DOM h2 + screenshot 08 |
| Polish-only headline | Cleaned up N | view state (single-leaf) |
| Done dismiss | clears peak → idle | `dismissLandPeak` → phase idle |

## Stories

| Story | Status | Evidence |
|---|---|---|
| Card has breathing room vs pre-fix | Passed | 08 vs prior cramped frame |
| Rows not glued (title + meta readable) | Passed after cascade fix | computed padding; craft read 08 |
| Done tappable | Passed | min-height 44–46 |
| Dismiss returns to library | Passed | phase idle after dismiss |
| Multi-leaf stale paint | Residual | second leaf can lag; use one home leaf |

## Craft (§5b) — decisive frame

**Frame:** `docs/qa/screenshots/land-peak-spacing/08-single-leaf-mixed.png`  
**Mock:** land-then-remember `.status` + `.landed` (padding 16, body margin 12, row min-height ~48, CTA 46).

| Check | Result |
|---|---|
| Breathing room | Pass — card pad ~16; body margin-bottom 12px; list margin before Done |
| Stack density | Pass after fix — row pad 14×16 (was **0** under `.atoms-ui-text-control`) |
| Tap targets | Pass — Done ~44px; rows min-height 52 |
| Hierarchy | Pass — green DONE / bold title / muted body / faint meta |
| Clipping | Pass on sample titles; long titles use ellipsis CSS |

**Craft: Passed** (with cascade fix included).

## Adversarial

| Scenario | Tag |
|---|---|
| Cascade: text-control zeros padding | **holed → fixed** in 0.6.23 |
| Multi-leaf home shows wrong/empty peak | residual (detach extra leaves) |
| Dismiss Done | solid |
| Force land peak without full Update run | solid (CLI fixture) |

## Evidence

```bash
npm test   # 287
npm run build
./scripts/install-to-vault.sh  # 0.6.23 after cascade fix
```

Computed (single leaf, mixed peak):

```json
{
  "rowPadding": "14px 16px",
  "rowMinH": "52px",
  "rowGap": "4px",
  "cardPad": "16px 18px",
  "h2": "6px",
  "body": "12px",
  "btnMin": "44px",
  "domH2": "Updated 2 · polished 3"
}
```

Screenshots:

- `08-single-leaf-mixed.png` — craft pass (decisive)
- `07-craft-after-cascade-fix.png` — intermediate
- Earlier multi-leaf frames can show stale “Nothing to update” — not spacing failure

## Findings

| Sev | Finding | Disposition |
|---|---|---|
| P1 craft | `.atoms-ui-text-control { padding: 0 }` overrode `.atoms-home-landed-row` padding | **Fixed** — more specific rule after ghost styles |
| P3 | Multi-leaf home can desync land peak paint | Residual — one home leaf for dogfood |

## Merge decision

**Ready** once cascade fix is on master as **0.6.23**. Outer spacing alone (0.6.22) was incomplete without the cascade fix.
