# world-class-qa — #347 form rows + #348 back chevron

**Date:** 2026-08-06 · **Branch:** `claude/settings-form-rows-back-chevron` · **Version:** 0.6.83
**Vault:** `test vault` only, asserted on every measuring call · **Obsidian:** 1.13.4 (installer 1.12.7)
**PR:** [#349](https://github.com/taihartman/obsidian-atoms/pull/349) · **Plan:**
[`docs/plans/2026-08-06-004-…`](../plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md)

**Verdict: PASS after one fix.** The adversarial half found a regression this branch introduced on
iPad; it is fixed at `25e395c` and re-measured. Four smaller holes are real but out of scope — filed
rather than smuggled in.

## Core user stories

### 1. A field and the button that commits it are one card

Signed out, Settings → Atoms → Account renders **exactly**: `Account` (back), `Skip the API key`,
`Email`, `Sign in with a link`, `Advanced: paste session`. The row names `Start free trial`,
`Send sign-in link` and `Save session` **do not exist as rows** at either width — they are button
labels on the field rows now. Tag vocabulary carries one `Add a custom tag` row whose button reads
`Add to Active`; no orphan button row. Each pair is a single `.setting-item` containing both the input
and the button. **PASS.**

### 2. The back chevron sits at the row's leading edge

The invariant — the chevron's left edge equals the row's content-box left edge — holds at **0px delta,
both widths**. Desktop's absolute numbers shift because Settings is a popout window; read the last
column.

| | row | content-box L | chevron box | in from content edge |
|---|---|---|---|---|
| Phone 390 — before | 16→359 | 16 | 120→148 | **+104** |
| Phone 390 — after | 16→359 | 32 | 32→60 | **0** |
| Desktop — before | 16→612 | 16 | 252→278 | **+236** |
| Desktop — after | 257→868 | 273 | 273→299 | **0** |

Same on the Tag vocabulary back row. **PASS.**

### 3. Nothing else moved

Every non-back row's control right edge still lands on its row's trailing content edge, at both
widths — Account (852 of 868), Tag vocabulary (837 of 853, all 20 toggle/Approve/Activate/Dismiss
rows), and all 20 rows on the main screen checked programmatically. **Zero off the trailing edge.**
**PASS.**

## Edge cases & testing

Adversarial pass — the break-it half. Every row driven live unless noted.

| Scenario | Verdict |
|---|---|
| Trim reaches `onSubmit` — `"  sess_aqaTrimmed  "` | PASS — stub received `sess_aqaTrimmed` |
| Trim on the tag row — `"  aqaspaced  "` | PASS — stored `aqaspaced` |
| Empty and whitespace-only submit, all four rows | PASS — local Notice, **zero egress** |
| `sess_` token with an embedded newline | PASS — the input sanitizer strips it before code sees it |
| Enter in the field: with text, empty, and mid-flight, all four rows | PASS — inert, as designed |
| In-flight guard on `plus:save-session`: double- and triple-tap, `display()` mid-flight, press the rebuilt button | PASS — **exactly one** request; the rebuilt button rendered disabled and inherited the run |
| In-flight guard on `plus:start-trial`, four taps | PASS — exactly one request |
| `Add to Active` double/triple tap, tap-then-toggle race, tap-then-navigate, tap-then-close-Settings | PASS — one add, no duplicate row, no stray Notice |
| Tag validation: `#`, `!!!`, `two words`, 90 chars, `#AqaHealth`, `aqa/sub` | PASS — correct Notice, draft preserved on reject |
| Half-typed tag survives toggle-redisplay, nav away and back, phone width | PASS |
| Back chevron still a button after the CSS collapse (chevron and row body, both widths) | PASS — `openRoute` fires exactly once from either |
| Rapid nav — four route flips in one tick | PASS — one back row, correct route |
| Resize desktop↔phone with Settings open on a merged row | PASS — layout and typed content both survive |
| Merged control at desktop: input width vs the ~54px squeeze precedent | PASS — 164px on all four, identical to the `Atom folder` reference row |
| **Merged control at `is-tablet`** | **FAILED, then fixed — see below** |
| Real trial signup / real magic-link email / real session install | NOT TESTED, deliberately — all network redirected to a `127.0.0.1` stub and restored after. A QA pass must not create a real trial or email a real address. |
| Physical iOS touch input | NOT TESTED — desktop emulation only |
| Signed-in Plus state | NOT TESTED — the three account form rows only render signed out |

### The regression, and its fix

`styles.css`'s wrap rule was gated on `.is-phone`. Obsidian stacks settings rows only under
`.is-phone` — verified in the running app's own `app.css` — so on **`is-tablet`** neither that rule nor
Obsidian's stacking fired, and the merged field and button shared one control edge. Measured at a
1100px window:

| Row | before | after |
|---|---|---|
| `Email` | **98px** | 164px |
| `Sign in with a link` | **76px** | 164px |
| `Advanced: paste session` | 199px | 199px |
| `Add a custom tag` | 258px | 258px |
| `Atom folder` (reference) | 172px | 172px |

`you@example.com` did not fit. Before this branch those fields had their own row, so this was a
regression to ~44% width on a first-class platform — `CLAUDE.md` #11.

The fix (`25e395c`) is a **floor, not a second stacking gate**: forcing the four to stack on tablet
would fight Obsidian's deliberate design and would restack two rows that were never squeezed. 164px is
the placeholder plus its padding measured in the field's own font, and is exactly desktop's width, so
desktop cannot move. Re-measured at all three states after the fix: desktop 164 unchanged, phone
311 unchanged, tablet no longer squeezed and still inline.

### Holes found and deliberately not fixed here

Filed rather than folded in — each widens scope past what #347/#348 claim.

1. **A failed trial wipes the email the failure tells you to reuse.** `startTrial` ends in
   `finally { this.redisplay(); }`, which rebuilds the row on *every* outcome. The sharpest variant is
   the `needsMagicLink` branch, whose Notice reads "This email already has Plus — send a sign-in link
   below" while erasing the address from both rows. `requestSignInLink` does the same after a failed
   send. **Pre-existing** — the field was cleared by the same `redisplay()` before this branch too.
2. **Draft persistence is incoherent across the four merged rows.** `customTagDraft` survives a full
   Settings close and reopen, while the three account rows lose their content on any rebuild. Same row
   grammar, three different answers to "does my typing survive?".
3. **Adding a tag that already exists is a silent no-op.** `idea` and `#Idea` both clear the field and
   say nothing. Every other outcome of that button speaks. Pre-existing.
4. **Whitespace-only tag submit leaves the whitespace in the field.** The Notice says "Type a tag
   first" over a field that looks empty but holds `"   "`.

## Evidence

Phone, 390×844, `is-phone` asserted. Desktop Settings is a popout window and `dev:screenshot` captures
the main window only, so desktop is verified numerically rather than visually — the invariants there
are geometric and were measured.

| Frame | What it shows |
|---|---|
| `01-account-back-chevron-leading.png` | The back chevron at the leading edge, with `Email` and `Sign in with a link` as single cards |
| `02-account-three-merged-rows.png` | All three merged Account rows in one frame |
| `03-vocab-add-custom-tag.png` | `Add a custom tag` and `Add to Active` in one card |

Under `docs/qa/screenshots/settings-form-rows/`.

## Environment notes worth keeping

- Settings opens as a **popout window** in 1.13.4 (`app.vault.getConfig("settingsPopoutWindow")`), so
  `document.querySelector` in the main window finds nothing. Go through
  `app.setting.modalEl.ownerDocument`.
- The **running** app's `app.css` is at `~/Library/Application Support/obsidian/obsidian-1.13.4.asar`.
  The one under `/Applications` is the stale 1.12.7 *installer*. Read the former when a question is
  about what Obsidian's CSS actually does.
- `is-mobile` covers both phone and tablet, but carries no row layout of its own — all the stacking
  lives under `.is-phone`. Tablet keeps rows inline by design.
- Two `obsidian eval` calls at phone width took over 120s to return while succeeding. Budget long CLI
  timeouts there.
