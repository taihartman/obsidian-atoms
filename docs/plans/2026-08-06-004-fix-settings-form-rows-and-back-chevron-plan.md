# Plan — a field and its button are one row; the back chevron sits at the leading edge

**Status:** proposed, not claimed. **Lane:** full (new shared primitive + four call sites + CSS on a
shared substrate). **Doc-review:** light `ce-doc-review` before `ce-work`, per the plan quality gate.
**Depends on:** [PR #345](https://github.com/taihartman/obsidian-atoms/pull/345) merging first — it
touches `src/settings/rows.ts`, `src/settings/settings.ts`, `styles.css` and
`test/settingsRows.test.ts`, which is all of this plan's surface.

## What the user reported

Two things, both on Settings → Atoms → Account at phone width:

1. **The back row's chevron is not lined up with anything.**
2. **The account screen is all separated** — "Start free trial" is its own card away from the Email
   field, "Send sign-in link" away from its email field, "Save session" away from its session field.
   And: build a common component so this stops recurring.

## What I measured before proposing anything

Live in `test vault`, plugin 0.6.82, Obsidian 1.13.4.

### The back chevron is parked mid-row, and always has been

```text
back row "Account", phone 390 wide            back row "Account", desktop
  row        16 → 359                           row        16 → 612
  control    16 → 148   (w 133, flex 1 1 auto)  control    16 → 278  (w 262, flex 1 1 auto)
  chevron   120 → 148   (w 28)                  chevron   252 → 278  (w 26)
  name      164 → 327                           name      278 → 564
```

The cause is not `.atoms-setting-back` and not #346. Obsidian's `.setting-item-control` is
`flex: 1 1 auto` with `justify-content: flex-end`. In a `row-reverse` row it therefore **grows to
fill the leftover space** and then parks its 28px chevron at the far end of the box it grew into —
104px in on phone, 236px in on desktop. Every other row's control lands on the row's trailing edge
(343 on phone, 837 on desktop); the back chevron lands on nothing, which is exactly the "not lined
up" the user is describing. The screenshot reads as a chevron floating near the middle of the card.

**This is pre-existing and cross-platform.** #346 fixed the axis (the chevron used to sit *below* the
name); it did not touch how far in the chevron sits.

### The account screen spends two cards on every one thing

```text
Skip the API key         h 165   name + desc + "See plans"     ← a real standalone action, fine
Email                    h 149   name + desc + input
Start free trial         h 111   name + "Start free trial"     ← name repeated as the button label
Sign in with a link      h 149   name + desc + input
Send sign-in link        h 111   name + "Send sign-in link"    ← same
Advanced: paste session  h 165   name + desc + input
Save session             h 111   name + "Save session"         ← same
```

796px of card for three fields and three buttons. Each button card's entire content is its own label
— **the identical shape as the `Dismiss #tag` row [#342](https://github.com/taihartman/obsidian-atoms/issues/342)
just deleted**, in a second place.

It is not an accident, and the code says so out loud at
[`src/settings/settings.ts:1832`](src/settings/settings.ts:1832):

> "Field and button were one row, which the grammar allows only one right edge for. Splitting them
> keeps both rather than dropping the field or committing on every keystroke."

So the split is the row grammar working as written. And the verdict is the same one #342 reached:
**the grammar is right and was applied mechanically to a surface it does not fit.**

### There are four of these pairs, not three

| # | Field row | Button row | Where |
|---|---|---|---|
| 1 | `Email` | `Start free trial` | [settings.ts:1199](src/settings/settings.ts:1199) / [1209](src/settings/settings.ts:1209) |
| 2 | `Sign in with a link` | `Send sign-in link` | [1216](src/settings/settings.ts:1216) / [1227](src/settings/settings.ts:1227) |
| 3 | `Advanced: paste session` | `Save session` | [1245](src/settings/settings.ts:1245) / [1258](src/settings/settings.ts:1258) |
| 4 | `Add a custom tag` | `Add to Active` | [1834](src/settings/settings.ts:1834) / [1848](src/settings/settings.ts:1848) |

Pair 4 is on Tag vocabulary, so the fix is not account-only. **8 rows → 4.**

Deliberately *not* pairs, and left alone: `Device-local key fallback` (toggle) beside
`Device-local API key` (a stored field that commits on change, no button); `Sync when you return to
Obsidian` (toggle) beside `Sync everything now` (an unrelated action that submits nothing).

## Key technical decisions

### KTD1 — `formRow` is a sixth row kind, not a flag on `settingRow`

A field and the single button that commits it is **one** grammar — "type this, then commit it" — the
way a `destinationRow` is one grammar made of a name and a chevron. The button is not an independent
action: its only job is to submit the input beside it, and it is meaningless without it. So this does
not weaken the "no row carries two grammars" rule; it names a grammar the rule never had a kind for.

The rejected alternative is `settingRow({ control: { kind: "text" }, button: {...} })`. That is the
god-widget the standing rule forbids: an optional `button` on the shared preference row is one PR away
from a button on a toggle row, and then the grammar means nothing. `formRow` is a *composition* of
existing pieces (the text control config, `ButtonRowSpec`'s action id and in-flight guard), not a
configuration flag on a shared widget.

```ts
export function formRow(
  containerEl: HTMLElement,
  row: RowInfo & {
    placeholder?: string;
    /** Field-level setup — password type, autocomplete, initial value. Never adds a control. */
    configure?: (text: TextComponent) => void;
    submit: {
      action: string;                            // in-flight guard id, same contract as ButtonRowSpec
      label: string;
      onSubmit: (value: string) => void | Promise<void>;
      inFlight: InFlightActions;
    };
  },
): void
```

**Free win:** `onSubmit` receives the field's current value, so the three account callers stop
reaching back into the DOM. `inputEl.dataset.plusEmail = "1"` / `dataset.plusMagicEmail` /
`dataset.plusSession` and the `accountInput(containerEl, key)` helper that reads them by attribute
selector all disappear — a real deletion, not a rename. Pair 4 likewise stops needing the
`customTagDraft` field on the tab.

### KTD2 — the back chevron sits at the row's leading edge

One rule, in the **base** `.atoms-setting-back` block rather than the `.is-phone` block, because the
measurement above shows desktop has it too:

```css
.setting-item.atoms-setting-back .setting-item-control { flex: 0 0 auto; }
```

Collapsing the box to its 28px content puts the chevron at x = padding, where a back affordance
belongs, with the title following it. No `justify-content` needed once the box no longer grows.
Verify by the same invariant #346 used: the back chevron's **left** edge equals the row's content-box
left edge, at both widths, and desktop's own A/B shows every other row unmoved.

### KTD3 — the button label stops repeating the row name

Once field and button share a card, `Email` / **Start free trial** reads correctly and
`Start free trial` / **Start free trial** does not. The name becomes the field's label and the button
keeps the verb:

| Row name | Button |
|---|---|
| `Email` | **Start free trial** |
| `Sign in with a link` | **Send sign-in link** |
| `Advanced: paste session` | **Save session** |
| `Add a custom tag` | **Add** |

No copy is invented — every string already exists on the screen; three duplicated row names are
deleted.

### KTD4 — the grammar guard grows a case, and the budget ratchets down

`test/settingsRows.test.ts` gets `formRow` coverage rather than an exemption: exactly one input and
exactly one button, the button carries an `action` id, and no *other* row kind may pair an input with
a button. Four `actionRow` call sites disappear from `settings.ts`, so the direct `new Setting(`
budget of 5 is unaffected but the row-count assertions in `test/settings.test.ts` tighten — the same
"assert the exact rendered list" style #342 used, so a regression that re-splits a pair fails.

### KTD5 — on phone the pair stacks inside one card, which is the right shape

On `is-phone`, Obsidian stacks any row that is not `mod-toggle`, so a form row renders as name → desc
→ input → button, full width. That is correct for a form and is what the user is asking for — the
point is that it is now **one card** instead of two. One `.is-phone` rule so the input takes the full
control width instead of splitting it with the button (`styles.css` already carries precedent for
this: the reset-icon row, where a trailing control squeezed an input down to ~54px).

## Units

| U | Work | Verify |
|---|---|---|
| U1 | `formRow` in `src/settings/rows.ts` + grammar doc-comment table gains its sixth kind | `test/settingsRows.test.ts` cases; `npm run build` |
| U2 | `.atoms-setting-back` control no longer grows; phone form-row width rule | live measurement at 390 and desktop; desktop A/B empty diff |
| U3 | Convert pairs 1–3 (account) and delete `accountInput` + the three `dataset` keys | `test/settings.test.ts` account rows; live drive |
| U4 | Convert pair 4 (Tag vocabulary) and drop `customTagDraft` plumbing if it falls out | existing custom-tag tests, tightened to the exact rendered list |
| U5 | Shipping tail: `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa` + `adversarial-qa` | per CLAUDE.md |

## Risks

- **Shared substrate, four callers.** Per the standing rule, the primitive ships with its state
  coverage in the same change: empty value, whitespace-only, in-flight double-tap, redisplay
  mid-flight (the `InFlightActions` case `actionRow` already documents), and password-typed fields.
- **`startTrial`, `sendPlusMagicLink`, `savePastedSession` currently read the DOM.** Changing them to
  take a value is a real signature change on money and identity paths. Each keeps its existing
  validation (`includes("@")`, the Notice copy) verbatim — this unit moves where the string comes
  from, nothing else.
- **PR #345 must land first** or these two branches conflict on all four files.

## What I need from you

1. **Claim shape.** This wants a GitHub Issue + STATUS row + draft PR before any code, per
   `docs/collab.md`. Two issues or one? They are one user complaint but two independent fixes — I'd
   file **two** (form row; back chevron) and put both on one branch, the way #342 and #346 rode
   together.
2. **KTD3 confirmation** — dropping the repeated row names is a copy change, small but yours.
3. Still open from the QA pass, unrelated: the **H2** copy nuance on the dismiss sheet
   ("will not be offered again" vs "will not come back").
