# Plan — a field and its button are one row; the back chevron sits at the leading edge

**Status:** claimed — [#347](https://github.com/taihartman/obsidian-atoms/issues/347) (form row) +
[#348](https://github.com/taihartman/obsidian-atoms/issues/348) (back chevron), branch
`claude/settings-form-rows-back-chevron`, draft
[PR #349](https://github.com/taihartman/obsidian-atoms/pull/349). **Lane:** full (new shared primitive
+ four call sites + CSS on a shared substrate). **Doc-review:** light `ce-doc-review` (coherence,
feasibility, design) ran 2026-08-06; its corrections are folded in below and marked *(doc-review)*.
**Depends on:** [PR #345](https://github.com/taihartman/obsidian-atoms/pull/345) — it touches
`src/settings/rows.ts`, `src/settings/settings.ts`, `styles.css` and `test/settings.test.ts`, which is
all of this plan's surface. GitHub has fired no CI run on #345 since `a0c7665`, so rather than idle,
this branch is **stacked on its head** and rebases onto `master` the moment #345 merges.

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
104px in on phone, 236px in on desktop. Every other row's control lands on its row's trailing edge;
the back chevron lands on nothing, which is exactly the "not lined up" the user is describing.
*(doc-review: the trailing-edge figures originally quoted here — 343 and 837 — could not be
reconciled with the back row's own 359/612 right edge, so the claim stands on the table above and
U2's live A/B rather than on two numbers whose derivation was lost.)* The screenshot reads as a chevron floating near the middle of the card.

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

**Free win:** `onSubmit` receives the field's current value, so the account callers stop reaching back
into the DOM. `inputEl.dataset.plusEmail = "1"` / `dataset.plusMagicEmail` / `dataset.plusSession` and
the `accountInput(containerEl, key)` helper that reads them by attribute selector all disappear — a
real deletion, not a rename.

Four things the contract must say out loud, all *(doc-review)*:

- **`onSubmit` receives a trimmed value.** `accountInput` ends in `.value.trim()`, and
  `savePastedSession`'s `startsWith("sess_")` check only survives on a trimmed string. Deleting the
  helper without moving its `.trim()` into `formRow` would silently break a pasted token with a
  leading space. `formRow` passes `text.getValue().trim()`.
- **`formRow` adds the class `atoms-setting-form` to `settingEl`.** Every kind that needs styling
  already does (`atoms-setting-destination`, `atoms-setting-back`, `atoms-setting-status-row`), and
  the `.is-phone .modal .setting-item.atoms-setting-*` block in `styles.css` keys off exactly those.
  KTD5's phone rule is unwritable without it.
- **Enter in the field does not submit.** Today the button lives in its own row, so Enter does
  nothing; wiring it now would add a new interaction on two money/identity paths that nobody asked
  for. Specified rather than left to four call sites to each guess. Revisit deliberately, not by
  accident.
- **Pair 4 keeps `customTagDraft`.** It does not fall out. Toggling any existing tag off calls
  `redisplay()`, and `.setValue(this.customTagDraft)` is what puts a half-typed tag back afterwards —
  the field survives a rebuild, which `onSubmit` receiving the value does nothing about. It is
  restored through `configure`, and a test types-then-toggles to prove it.

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
| `Add a custom tag` | **Add to Active** |

No copy is invented — every string already exists on the screen; **three** duplicated row names are
deleted.

*(doc-review)* Pair 4 is not one of the three. Its button row is named `Add to Active` and its button
already reads `Add` — two different strings, not a duplicate — so there is nothing to de-duplicate
there. Shortening it to **Add** would be new information loss, dropping *which* list the tag joins.
The merged card keeps `Add a custom tag` as the field label and **Add to Active** as the verb.

### KTD4 — the grammar guard grows a case, and the budget ratchets down

`test/settingsRows.test.ts` gets `formRow` coverage rather than an exemption: exactly one input and
exactly one button, the button carries an `action` id, and no *other* row kind may pair an input with
a button. Four `actionRow` call sites disappear from `settings.ts`, so the direct `new Setting(`
budget of 5 is unaffected but the row-count assertions in `test/settings.test.ts` tighten — the same
"assert the exact rendered list" style #342 used, so a regression that re-splits a pair fails.

Two existing assertions move with it *(doc-review)*: `test/settingsRows.test.ts`'s "no builder hands
back a chainable" case enumerates every builder and asserts an array of five `undefined`s — it becomes
six; and `test/settings.test.ts` asserts the rendered account row names contain `Start free trial`,
which KTD3 deletes as a row name. Both are updates the change owns, not collateral.

### KTD5 — on phone the pair stacks inside one card, which is the right shape

On `is-phone`, Obsidian stacks every row outside
`:not(:is(.mod-toggle, .mod-navigable, .mod-action, .setting-item-heading))` — the gate `styles.css`
already documents *(doc-review: the plan first said "any row that is not `mod-toggle`", which is
narrower than the real selector; the conclusion is unchanged, and the measured heights above already
show button rows stacking)*. So a form row renders as name → desc → input → button, full width. That
is correct for a form and is what the user is asking for — the point is that it is now **one card**
instead of two. One `.is-phone` rule, keyed on the new `atoms-setting-form` class, so the input takes
the full control width instead of splitting it with the button (`styles.css` already carries
precedent: the reset-icon row, where a trailing control squeezed an input down to ~54px).

**Desktop needs the same check, and did not have one** *(doc-review)*. At desktop width the field and
the button now share one control box for the first time, which is exactly the shape that produced the
~54px reset-icon squeeze. U3 and U4 verify the input stays readable at desktop, not only at 390.

## Units

| U | Work | Verify |
|---|---|---|
| U1 | `formRow` in `src/settings/rows.ts` + grammar doc-comment table gains its sixth kind | `test/settingsRows.test.ts` cases; `npm run build` |
| U2 | `.atoms-setting-back` control no longer grows; phone form-row width rule | live measurement at 390 and desktop; desktop A/B empty diff |
| U3 | Convert pairs 1–3 (account) and delete `accountInput` + the three `dataset` keys | `test/settings.test.ts` account rows as an exact list; live drive at 390 **and desktop** |
| U4 | Convert pair 4 (Tag vocabulary), **keeping** `customTagDraft` and restoring it through `configure` | custom-tag tests tightened to the exact rendered list, plus a type-then-toggle case proving the draft survives `redisplay()`; desktop width check |
| U5 | Shipping tail: `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa` + `adversarial-qa` | per CLAUDE.md |

## Risks

- **Shared substrate, four callers.** Per the standing rule, the primitive ships with its state
  coverage in the same change: empty value, whitespace-only, **surrounding whitespace on a `sess_`
  token** *(doc-review — the trim is load-bearing)*, in-flight double-tap, redisplay mid-flight (the
  `InFlightActions` case `actionRow` already documents), and password-typed fields.
- **Two handlers read the DOM, not three** *(doc-review)*. `startTrial(containerEl)` and
  `savePastedSession(containerEl)` call `accountInput`; `sendPlusMagicLink(email: string)` **already
  takes a value**, has a second caller elsewhere in `settings.ts`, and keeps its signature — the DOM
  read on that path lives in the row's own `onClick`, which `formRow` deletes anyway. Validation is
  carried verbatim on both: `includes("@")` for the email paths and `startsWith("sess_")` for the
  session path. This unit moves where the string comes from, nothing else.
- **`buttonRow` cannot be reused as written** *(doc-review)*. It builds its own `Setting` via
  `baseRow` before calling `addButton`, so `formRow` needs a small extraction to attach the
  button-plus-in-flight logic to a `Setting` that already carries a text control. That extraction is
  U1's real work; do not fork the in-flight guard.
- **KTD2's selector is weaker than the `.is-phone` rules around it.** The proposed base rule is
  (0,3,0) against an existing (0,5,0) phone rule and Obsidian's own (0,4,0)+ — those set `width` and
  `justify-content`, not `flex`, so the base rule should win. If Obsidian's phone rule also sets
  `flex`, the fix lands on desktop only, and U2's live measurement at 390 is what catches it.
- **PR #345's files.** These two branches touch all four of the same files, which is why this one is
  stacked on #345's head rather than cut from `master`.

## Decisions taken, not blocked on

Both questions this plan opened went unanswered before the session ended. Rather than stall, each was
taken as its own recommendation and is flagged in [PR #349](https://github.com/taihartman/obsidian-atoms/pull/349)
as a decision. Either reverses cheaply before merge.

1. **Two issues, one branch** — [#347](https://github.com/taihartman/obsidian-atoms/issues/347) (form
   row) and [#348](https://github.com/taihartman/obsidian-atoms/issues/348) (back chevron). One user
   complaint, two independent fixes, the shape #342 + #346 rode in.
2. **KTD3 goes ahead** — three duplicated row names deleted, and pair 4 left alone per the correction
   above.

Two smaller ones the doc-review surfaced, both resolved toward *preserve today's behaviour*:

3. **In flight, the button is guarded; the field stays editable** — so a user who mistyped can fix the
   value while a request is out, rather than being locked out of their own form.
4. **A typed email is not preserved across the `redisplay()` `startTrial` runs** — it is not preserved
   today either, and preserving it is a separate improvement, not this change's business.
   `customTagDraft` is the exception, and only because it already works that way.

Still open and unrelated, from #345's QA pass: the **H2** copy nuance on the dismiss sheet ("will not
be offered again" vs "will not come back"). Yours to call.
