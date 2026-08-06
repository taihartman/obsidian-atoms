# World-Class QA: 342-proposed-tags

Branch `fix/342-proposed-tags-dismiss-row` · [PR #345](https://github.com/taihartman/obsidian-atoms/pull/345) ·
version **0.6.82** · Obsidian **1.13.4** (installer 1.12.7) · vault **`test vault`** (asserted on every drive call).

## Verdict

**Ready after fixes** — one hole was found by the adversarial pass, fixed on this branch with a
regression test, and re-proven live. Everything else passed. One P3 copy nuance is reported, not
fixed, and is the user's call.

## Charter

Two settings-screen fixes ride on this branch:

- **[#342](https://github.com/taihartman/obsidian-atoms/issues/342)** — the Proposed section spent
  two full-width rows per tag, the second carrying nothing but a `Dismiss #tag` label. Replaced by
  one section-level `N proposals waiting` · **Dismiss all** row behind a confirm sheet, scoped to
  the proposals it rendered.
- **[#346](https://github.com/taihartman/obsidian-atoms/issues/346)** — on `is-phone`, Obsidian
  stacked every Atoms settings row whose right edge is not a toggle, orphaning chevrons and
  trailing text onto a second line. Fixed with an `.is-phone`-gated block in `styles.css`.

Workflows that must work: approve a proposal; dismiss the queue; decline the confirm; survive a
classify run that lands while the screen sits open. Adjacent regression risk: the other settings
destinations and the desktop layout, since the CSS touches shared row classes.

**Product loop vs fixture.** No Anthropic key is present on this device
(`getApiKey()` → `hasKey:false`), and `atoms:process-fixture-sample` is a dev-build-only command
absent from the production bundle under test, so **live classify was not exercised**. Proposals were
placed on `settings.proposedTags` — the same array `main.ts:1583` writes after a Process or auto-run
— and saved through `saveSettings()`, which is exactly the state a real Process leaves behind for an
already-open settings tab. Every story below is therefore **fixture-plumbing on the real merge
target**, not `user-loop`. That is honest for this change: the surface under test is settings chrome
and a destructive bound, not "does the model propose good tags." The residual gap is named under
**Not Tested**.

## Preflight

| Check | Result |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` § Product dogfood honesty — read, and the fixture/loop split above is stated per that section |
| Authority paths | ✅ [#342](https://github.com/taihartman/obsidian-atoms/issues/342), [#346](https://github.com/taihartman/obsidian-atoms/issues/346), `CONCEPTS.md` § Row grammar (settings) / Confirm sheet / Proposed tag, on-screen copy |
| Navigation map | ✅ followed — `docs/qa/app-navigation-map.md` § Settings → Atoms already describes the new `N proposals waiting` / `Dismiss all` row and the popout behaviour. No drift, no heal needed |
| Run command | ✅ `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"` |
| Viewport/device | ✅ desktop 1675×1084, and phone **390×844** via `getCurrentWindow().setSize(390, 844)` with `document.body.classList.contains("is-phone")` asserted true |
| Auth path | N/A — settings chrome; no API key needed, and none present |
| Fixtures | ✅ reused the existing `test vault` tag state (`proposedTags: ["design","packing","product","ui"]`, 8 active). Nothing re-seeded; state restored at the end |
| Automation | Obsidian CLI `eval` / `dev:screenshot`; vitest. No Playwright/MCP needed for a settings surface |
| Device lock | N/A — no physical-device tooling in this repo |
| Deploy reality | N/A — plugin-local; no server component |

## Authority & promises

| Surface / CTA | Promise (source) | Acceptance (observable) | Story |
|---|---|---|---|
| `N proposals waiting` row name | #342: "the count is in the name so the reach of the button is legible before it is pressed" | Row name states the number of proposals the button will clear | US-1, US-5, H1 |
| `Dismiss all` button | #342 + destructive row grammar | Opens a confirm sheet; does not act on the first tap | US-2 |
| Sheet title `Dismiss N proposals?` | On-screen copy | N equals the row's count and the number actually cleared | US-2, US-5, H1 |
| Sheet body "will not be offered again unless a later capture proposes them. Nothing already tagged changes." | On-screen copy | Queue clears; Active and vault files untouched | US-3, H2 |
| `Keep` | On-screen copy | Queue survives intact | US-4 |
| Scoped dismissal | #342 code contract + `docs/solutions/architecture-patterns/a-bulk-action-inherits-none-of-the-per-item-actions-bounds.md` | Clears only what the row rendered; later arrivals survive | US-6 |
| #346 phone rows | #346: a row's right edge stays on the row | A fixed row's control right edge equals a plain toggle row's control right edge | US-8 |

No generic CTA, no spec/copy conflict except the P3 in **Findings**.

## User Stories Tested

```text
US-1 · As someone reviewing proposed tags, I want one dismissal for the queue rather than one row
per tag, so the section is readable.
Acceptance: 4 proposals render 4 Approve rows + exactly one "4 proposals waiting" / "Dismiss all"
row; no per-tag Dismiss row exists.
Evidence: live DOM dump of the Tag vocabulary destination (24 rows, listed in Evidence);
docs/qa/screenshots/342-proposed-tags/06-proposed-section-and-dismiss-all-phone.png
Status: Passed.

US-2 · As a user about to clear a queue I cannot get back, I want to be asked first.
Acceptance: "Dismiss all" opens a sheet titled "Dismiss 4 proposals?" with Keep and a destructive
Dismiss; the row's button is disabled while the sheet is up.
Evidence: sheet DOM — title, body, buttons ["Keep" (plain), "Dismiss" (mod-destructive mod-cta)],
row button `disabled: true`. Screenshot 07.
Status: Passed.

US-3 · As a user who confirms, I want the queue gone and the section to go with it.
Acceptance: proposedTags empties, the "Proposed (approve to activate)" heading and the waiting row
both disappear, and Active gains nothing it was not approved.
Evidence: post-confirm DOM has neither heading nor waiting row; settings + data.json both [].
Status: Passed.

US-4 · As a user who changes their mind, I want every way out to keep the queue.
Acceptance: Keep, Escape, and a click outside all close the sheet with proposedTags unchanged and
the row re-enabled.
Evidence: three separate drives, each ending {proposed: ["design","packing","product","ui"],
btnDisabled: false}. Keep re-verified at phone width as well.
Status: Passed (all three).

US-5 · As a user who approves one and dismisses the rest, I want both numbers to track.
Acceptance: after approving #design, the row reads "3 proposals waiting" and the sheet reads
"Dismiss 3 proposals?"; #design ends up Active.
Evidence: live drive — row and sheet both 3; activeVocabulary gained "design".
Status: Passed.

US-6 · As a user whose classify run lands while the screen is open, I want Dismiss all to clear
only what I was shown. (The P1 the cross-model peer raised.)
Acceptance: a tag merged into settings.proposedTags after the row was drawn survives the dismissal.
Evidence: merged "latearrival" into the live array + saveSettings with the tab open; row still read
"4 proposals waiting"; after confirm, in-memory and on-disk proposedTags were exactly
["latearrival"]. Repeated with the merge landing *while the sheet was already open* (adversarial
B1') at 40 proposals — same result.
Status: Passed.

US-7 · As a user with one proposal left, I want the grammar to read correctly.
Acceptance: "1 proposal waiting" / "Dismiss 1 proposal?" / "This tag will not be offered again …
proposes it".
Evidence: live sheet text captured verbatim.
Status: Passed.

US-8 · As a phone user, I want a row's control to stay on the row.
Acceptance: at 390×844 with is-phone asserted, each fixed row's control right edge equals the plain
toggle row's control right edge, and the control sits on the same baseline as the name.
Evidence: measured at 390 wide — every destination row, the status row and every toggle row report
ctrlRight 343 and ctrlTop 16; flex-direction "row" (back row "row-reverse", chevron at the leading
edge). Row heights: destinations 105 / 60 / 60, status 53, back 60 — matching the pre-merge
measurements in the handoff.
Status: Passed.

US-9 · As a desktop user, I want nothing to change.
Acceptance: at 1675×1084 with no mobile emulation, every row is flex-direction "row" with a uniform
control right edge.
Evidence: all 13 main-screen rows and all 21 Tag vocabulary rows report ctrlRight 837, dir "row"
(back row "row-reverse"). The same measurement at is-tablet (emulated mobile, desktop width)
reports a uniform 1294 — confirming the .is-phone gate is correctly scoped and the bug is
phone-only.
Status: Passed.

US-10 · Craft read of the decisive frame.
Acceptance: the waiting card clears the craft checklist next to its siblings.
Evidence: screenshot 06 read directly (one frame, per the craft budget).
Status: Passed — see Craft below.
```

## Risk Matrix

| Class | Case | Result |
|---|---|---|
| Happy | Render section; Dismiss all → confirm → clear | Passed (US-1/2/3) |
| Negative | Keep · Escape · click outside | Passed (US-4) |
| Negative | Double/triple tap Dismiss all | Passed — one sheet, button held disabled |
| Edge | Approve one, dismiss the rest | Passed (US-5) |
| Edge | Merge lands after render / during the confirm | Passed (US-6, B1') |
| Edge | Singular grammar at N=1 | Passed (US-7) |
| Edge | 40 proposals incl. a 76-char tag, emoji, non-ASCII | Passed — counts agree, control stays inside the row |
| Edge | Duplicate / mixed-case / whitespace entries in `data.json` | **Failed → fixed** (H1) |
| Edge | Settings closed while the sheet is open, then confirmed | Passed — no throw, dismissal applied and persisted |
| Regression | Desktop layout; is-tablet layout; other destinations | Passed (US-9) |
| Perception | Row name ↔ sheet title ↔ number actually cleared | Failed at H1, passes after the fix |
| Perception | "Nothing already tagged changes" | Passed — `activeVocabulary` and vault files untouched by dismissal |
| Craft | Decisive phone frame | Passed |

## Craft (§5b)

Frame read: `docs/qa/screenshots/342-proposed-tags/06-proposed-section-and-dismiss-all-phone.png`
(one frame, read once).

- **Breathing room** — the waiting card carries the same padding and inter-card gap as the Approve
  cards above and the "Found in your vault" section below. No collapsed spacing.
- **Stack density** — cards are separated, not glued; titles and meta stay readable.
- **Stacked chrome adjacency** — checked the pair **Proposed section ↔ "Found in your vault"**
  heading: a clear gap, no flush seam, no overlap of the `Dismiss all` button by the next block.
- **Tap targets** — `Dismiss all` renders at the same generous height as the Approve CTAs, well
  over 44pt.
- **Hierarchy** — `4 proposals waiting` takes the tag-title weight, and the card is shorter than
  the Approve cards because it carries no description. It reads as a section footer rather than
  another item, which is the intent.
- **Affordance** — `Dismiss all` is red-on-pale-red against the purple Approve CTA. Destructive
  reads as destructive without shouting.

No craft defects.

## Evidence

Every drive call was pinned with `vault="test vault"` and asserted `app.vault.getName()` before
touching state.

```bash
./scripts/install-to-vault.sh "/Users/…/test_vault/test vault"   # Installed Atoms v0.6.82
npm run build                                                     # clean
npx vitest run                                                    # 78 files / 1281 tests pass
obsidian vault="test vault" eval code=…                           # drive + measure (see below)
obsidian vault="test vault" dev:screenshot path=qa-06.png         # frames 06, 07
```

Representative returns:

```text
main screen, phone 390×844, is-phone true
  Set up automatic filing   dir=row  h=105  ctrlRight=343  ctrlTop=16
  Tag vocabulary — 8 active dir=row  h=60   ctrlRight=343  ctrlTop=16
  List atoms in person notes (mod-toggle) dir=row h=189 ctrlRight=343 ctrlTop=16
  Last catch-up (status)    dir=row  h=53   ctrlRight=343  ctrlTop=16
  Tag vocabulary back row   dir=row-reverse h=60 ctrlTop=16   ← chevron beside the name

Dismiss all → sheet
  {"title":"Dismiss 4 proposals?",
   "body":"These 4 tags will not be offered again unless a later capture proposes them. Nothing
           already tagged changes.",
   "buttons":[{"t":"Keep","cls":""},{"t":"Dismiss","cls":"mod-destructive mod-cta"}]}
  row button disabled: true

merge-while-open → confirm
  before: live=["design","packing","product","ui","latearrival"], row still "4 proposals waiting"
  after : inMemory=["latearrival"]  onDisk=["latearrival"]
```

Screenshots (this pass): `docs/qa/screenshots/342-proposed-tags/06-proposed-section-and-dismiss-all-phone.png`,
`07-dismiss-all-confirm-sheet-phone.png`. Five earlier phone frames (01–05) were committed with the
implementation and remain valid.

**Test data mutated:** `test vault` `proposedTags` and `activeVocabulary` were driven through many
states (approve, dismiss, 40-tag bulk, malformed entries). Both were **restored** at the end of the
pass to the pre-QA values `proposedTags: ["design","packing","product","ui"]` and the original eight
active tags; window size and mobile emulation restored to desktop. No vault notes or atoms were
written or deleted.

## Findings

### H1 — the row and the sheet could disagree on how many tags they were about (fixed)

**Severity:** P2. **Status:** fixed on this branch, with a regression test.

`mergeProposedTags` always writes a deduped, lowercased array, but `loadSettings` assigns
`data.json` straight through (`src/plugin/main.ts:1422`). A hand edit, an older build, or an
external writer can therefore leave `["design", "Design", "  #PACKING  ", "packing"]` behind. The
row counted the **raw array** while `confirmDismissProposedTags` counted the **normalized set** it
actually dismisses:

```text
before the fix (live, 0.6.82)
  rows  : #design · #Design · #  #PACKING   · #packing · "4 proposals waiting"
  sheet : "Dismiss 2 proposals?"     ← and it cleared all four
```

A row whose entire purpose is to state its reach before it is pressed was **understating** it. Fixed
by normalizing and deduping at the render boundary
([`src/settings/settings.ts:1872`](src/settings/settings.ts:1872)), so the name, the sheet, and the
set actually cleared are the same number by construction — and the malformed `#  #PACKING  ` row
stops rendering as a tag.

Proof: `test/settings.test.ts` → *"counts the same number in the row and the sheet when settings
hold duplicates"*. Verified failing against the pre-fix source (`expected [ '#design', '#Design',
'#  #PACKING  ', '#packing', '4 proposals waiting' ]`) and passing after. Re-proven live on the
rebuilt plugin: 4 raw entries → 2 rows, "2 proposals waiting", "Dismiss 2 proposals?", and the
dismissal cleared all four raw entries with nothing stranded on disk.

### H2 — "will not be offered again" is true of the queue, not of the whole screen (reported, not fixed)

**Severity:** P3, copy nuance. **Status:** reported — this is a voice call, so it is the user's.

Dismiss a tag that is also **used in the vault** and it leaves the Proposed queue as promised, but
the same tag is still on screen one section down under **Found in your vault** with an `Activate`
button:

```text
proposedTags = ["list"]   (#list has 6 uses in this vault)
→ Dismiss all → confirm
   proposedTags: []
   still rendered: { "#list", "6 use(s) — tap to promote to Active", ctrl "Activate" }
```

The behaviour is right — the vault scan is a different source with different framing, and dismissal
is scoped to the classify queue, which is what #342 decided. Only the word "offered" over-reaches;
"will not come back" or "will not be proposed again" would be exactly true. Pre-existing in spirit
(per-tag Dismiss did the same thing) but the copy that makes the claim is new on this branch.

## Adversarial QA

Ran as the required gate, on this same build, weighted to the destructive and re-entry classes.

### Scenario ledger

| # | Scenario | Result |
|---|---|---|
| A1 | Dismiss all, then reach for it again with an empty queue | `solid` — heading and row both gone; nothing to double-fire |
| A2 | Dismiss a tag that is also used in the vault | `holed` → **H2** (P3 copy) |
| A3 | Dismiss, then a later run proposes the same tag | `solid` — merge re-adds it; the sheet's own escape clause |
| B1' | A merge lands **while the confirm sheet is open**, then confirm | `solid` — only the 40 rendered went; the late arrival survived in memory and on disk |
| B3 | Approve, then reach for Dismiss all in the same frame (stale rendered set) | `solid` — approved tag stayed in Active; the stale set dismissed harmlessly. The sheet transiently counts the set the row drew (3) rather than the live queue (2); the *reach* stays correct because Active is never touched |
| B5 | Close the whole settings window with the sheet up, then confirm | `solid` — no throw, dismissal applied and persisted, no ghost UI |
| B6 | Triple-tap `Dismiss all` | `solid` — one sheet; the in-flight guard holds the row for the sheet's whole lifetime |
| C1 | N = 1 | `solid` — singular in row, title and body |
| C2 | N = 40, incl. a 76-char tag, an emoji tag, a non-ASCII tag | `solid` — row and sheet both 40; control stays inside the row |
| C3 | Duplicate / mixed-case / `#`-prefixed / whitespace entries | `holed` → **H1** (P2, fixed) |
| C4 | Empty-string entry in the array | `solid` after the H1 fix — filtered out of the render entirely |
| D2 | "Nothing already tagged changes" | `solid` — dismissal touches `proposedTags` only; `activeVocabulary` and vault files unchanged |
| E1 | Long names and long trailing text at 390 wide | `solid` — control right edge holds at 343, no clipping |
| E4 | Widths below 390 | `blocked: not driven` — see Not Tested |

### Proven holes

1. **H1** (P2) — count mismatch on malformed settings. Fixed + regression test, re-proven live.
2. **H2** (P3) — copy over-reach on "offered again". Reported for the user's decision.

### Suspected, unproven

None. Every lead above was either proven or cleared by driving it.

### Fixes applied

- `src/settings/settings.ts` — normalize + dedupe `proposedTags` at the render boundary.
- `test/settings.test.ts` — one regression test, verified failing before the fix.

## Not Tested

- **Live classify.** No Anthropic key on this device and no `process-fixture-sample` in the
  production bundle, so no proposal in this pass originated from a real model call. Proposals were
  written to the same array the write path writes to. Residual risk: none for this diff — the
  dismissal reads `settings.proposedTags` and nothing upstream of it — but the end-to-end
  capture → Process → proposal → dismiss chain is unproven **on this branch** (it is unchanged by
  it).
- **Real iOS / Android device.** #346 was verified at a real phone *width* on desktop Electron with
  `is-phone` asserted, which is the class the CSS gates on. A physical phone was not driven.
  Residual risk: low — the rule is width-class-gated, not platform-gated — but native scrolling and
  safe areas were not observed.
- **Widths below 390** (e.g. 320-pt iPhone SE). `is-phone` holds there too, so the rules apply, but
  the measurement was not repeated.
- **Escape / click-outside at phone width.** Verified at desktop; only `Keep` was re-driven on
  phone. The sheet is the same `Modal`, so this is a formality.
- **Themes other than the default.** Only the vault's current theme was observed.

## Merge Decision

**Ready to merge**, with the H1 fix included on the branch.

Both issues do what they claim, the P1 the cross-model peer raised is proven live in two shapes
(merge before the sheet, merge during the sheet), the adversarial pass found one real hole and it is
closed with a test that fails without the fix, and desktop is untouched. **H2 is the only open item
and it is a one-word copy call for the user** — it does not block.

Before merging: confirm CI actually fires on this branch (no run has ever been recorded on it), and
re-derive `STATUS.md` / `versions.json` against `master` rather than resolving either by picking a
side.
