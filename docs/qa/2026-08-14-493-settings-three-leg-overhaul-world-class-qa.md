# QA — Settings three-leg overhaul (#493 / PR #494)

- **Branch:** `claude/settings-ux-redesign-69acd6` · **Version:** 0.8.0
- **Plan:** `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md`
- **Mock SSOT:** `docs/design-handoff/settings/overhaul.html`, `account.html`
- **Vault lane:** throwaway `test_vault/test vault` (agent QA). No personal vault touched.
- **App:** Obsidian 1.13.6 (installer 1.12.7), plugin `atoms` 0.8.0, mobile emulation on.

Status: **device evidence captured** (this section). Story coverage and the adversarial half
follow at the `world-class-qa` step of the shipping tail.

## Gates at HEAD

| Gate | Result |
|---|---|
| `npm test` | **1863 passed / 97 files** |
| `npm run lint` | clean |
| `npm run build` | clean |
| `npm run typecheck:test` | clean |
| `git status` after the suite | clean (no `www/dist` drift) |

## How the frames were taken

`./scripts/install-to-vault.sh "…/test_vault/test vault"` printed
`Reloaded plugin via CLI (vault=test vault): atoms`. Viewport is a real Electron window resize,
not a CSS clamp:

1. `require("@electron/remote").getCurrentWindow().setContentSize(w, h)`
2. `app.emulateMobile(false)`, wait for the reload
3. `app.emulateMobile(true)`, wait for the reload
4. assert the body class before capturing

Verified `is-phone` at 390×844 and **`is-tablet`** at 768×1024. Skipping step 2–3 leaves the
renderer pinned at its previous emulated metrics — `window.innerWidth` read 1400 with the window
already 390 wide, and the body class stayed `is-tablet`.

**Every frame was captured twice and kept only when the two were byte-identical**, guarding the
known trap where `dev:screenshot` hands back the frame from *before* the last re-render. That
guard fired on almost every capture: the first shot after any scroll or navigation was reliably
the previous state. Two 768px Advanced frames came back identical to each other *and* tiny (34KB)
because Settings had closed under the emulation reload; both were deleted and recaptured.

**The byte-identical guard is not enough on its own, and it failed twice here in two different
ways.** First, a scripted sweep of the phone routes mis-navigated after the account screen's back
row — one back tap did not register — and captured the engine screen four times under four
different filenames. Every one of those frames was perfectly stable, so the guard passed them all.
Second, a settled *pair* can still be the previous screen: `u7-advanced-top-768x1024` came back
byte-identical to the root-bottom frame, twice in a row, because the navigation had not repainted
yet. Stability proves the renderer settled; it proves nothing about which screen settled.

Third, and worst: **a sheet left open from an earlier step greys out the whole page, and a JS
`.click()` still changes routes underneath its scrim.** So the sweep went on navigating and
capturing, every shot settled, every shot differed from the last, every row assertion passed — and
14 of 16 frames showed the capture sheet over a dimmed screen. Nothing in the harness noticed. A
reviewer looking at the images did.

That one is not a product bug, and it was worth checking rather than assuming: `elementFromPoint`
over a row behind the sheet returns `modal-bg`, so a real tap cannot reach it. Only a synthetic
click can.

All three holes are closed in the harness now. A frame is kept only when the two shots agree, they
differ from the last frame written, the route's expected first row is what renders, **and** the
count of modals over the settings tab is what that frame expects — zero, or exactly one for the
two frames that are meant to show a sheet. Sheets are dismissed with the close button *and*
Escape, then the count is re-read, because the close button is absent on some sheets and a silent
no-op is what poisoned the set the first time. Every frame here was recaptured under all four
rules.

**The lesson is not "add a fourth check".** Each of these three guards was added after a reviewer
found the frames it would have caught, and the harness reported success every time. Automated
capture can only prove the things it was told to look for; somebody has to look at the pictures.

`u2-status-group-390x844.png` and `u2-status-group-768x1024.png` were deleted rather than kept:
they predate the mobile-card fix below, so they show a row shape the plugin no longer produces.
The status group they documented is the first group in every root frame here.

## Measurement — the signed-out root at 390px

The plan's U11 step 5: re-measure against the **3,444px / 30-term** baseline taken at 0.7.11.

| | 0.7.11 baseline | 0.8.0 measured | |
|---|---|---|---|
| Root height at 390px | **3,444px** (4.1 phone screens) | **2,121px** (2.51 phone screens) | **−38%** |
| Tallest single row | 211px (`Anthropic API key`) | **150px** (`Atom folder`) | −29% |
| Rows over 144px | 6 | **2** (`Atom folder`, `Refresh hub lists`) | −4 |
| Undefined terms on the root | 30 | **11** | −63% |
| …before the first control | 9 | **2** | −7 |

The height was 2,225px when first measured and 2,121px after the mobile-card fix below removed
the 8px margin Obsidian was putting under every row.

**It does not reach the mock's 1,081px.** That number is the proposed-root drawing, which has
neither of this device's two conditional rows nor Obsidian's own row chrome. The honest read is
that the overhaul removed nearly two fifths of the screen and two thirds of the vocabulary, and
that the remaining height is concentrated in the `2 · File` group — 653px of it.

### The state measured

Signed out of Plus, Daily Notes core plugin **on**, hub lists on, three egress acks on record.
Thirteen non-heading rows — the eleven the tests pin, plus `Refresh hub lists` (hub lists enabled)
and `Privacy and consents` (this device has acks to take back, KTD6):

```
[H] Atoms · Choose who files your captures · Daily notes · Capture on your phone ·
Who does the filing · File automatically when Obsidian opens · Atom folder ·
Tag vocabulary — 8 active · List atoms on hub notes · Refresh hub lists · Atoms home ·
Ask in Claude and ChatGPT · Privacy and consents · Advanced
```

Daily Notes was enabled deliberately before measuring: with it off the status group shows the
`Turn on Daily Notes` setup nag instead of the canonical `Choose who files your captures`, which
is a different screen from the one the plan measured.

### Height, block by block

| Block | px | | Block | px |
|---|---|---|---|---|
| Heading + version line | 56 | | `3 · Resurface` group | 97 |
| `Get started` group | 80 | | Resurface footer | 50 |
| Get started footer | 50 | | `Ask` group | 61 |
| `1 · Capture` group | 142 | | Ask footer | 50 |
| Capture footer | 67 | | `Your data` group | 149 |
| **`2 · File` group** | **653** | | Your-data footer | 50 |
| File footer | 83 | | eyebrows (6 × 19) | 114 |

Sum 1,702px of content; 2,225px of scroll once inter-group margins are counted.

### The term count, enumerated

The baseline's 30 terms were never written down, so this list is the auditable half of the
comparison. Rule applied: a term counts when the root screen uses it and never says what it is.

**Undefined on the root (11):** hub notes / hub lists · Tag vocabulary · marker line ·
marked block · backfill · session · Atoms service · Process (the named command, in the version
line) · Capture Atom (the shortcut's name, in a status string) · consents ("3 on record") ·
Atom folder's `..` path rule.

**Defined on the root, so not counted:** atom (Get started footer), capture and daily note and
top-level / indented bullet (Capture footer), filing (Get started footer), Atoms home (row
description and footer), Resurface (footer), Ask (footer), Advanced (footer).

**Before the first control:** the first row is itself the first control (`Choose who files your
captures`, marked Required). Above it sits only
*"Version 0.8.0 · Capture with your shortcut; Process turns past bullets into linked atoms."* —
two undefined terms, `Process` and `atoms`, against the baseline's nine.

## Measurement — the between-row hairline

`.atoms-setting-group .setting-item + .setting-item` had never been rendered on a device: every
group captured before this pass had exactly one row. Computed styles on the signed-out root, all
six groups:

| Group | Rows | `border-top-width`, first → last |
|---|---|---|
| Get started | 1 | 0px |
| 1 · Capture | 2 | 0px, 1px |
| **2 · File** | **6** | 0px, 1px, 1px, 1px, 1px, 1px |
| 3 · Resurface | 1 | 0px |
| Ask | 1 | 0px |
| Your data | 2 | 0px, 1px |

One hairline between neighbours, none at the rounded edges, on the six-row group as well as the
two-row ones. `border-radius` 14px, fill `--background-secondary` — both matching the mock's
`.group` rule.

**That measurement was true and, on its own, misleading — see F1.** The rule was drawing
correctly onto rows that Obsidian had already turned into separate floating cards, so the hairline
existed in the computed styles and was invisible on screen. A CSS assertion is not a fidelity
verdict; it took looking at a frame to find that out.

## Measurement — `formActionsRow` at 390px inside a group (KTD8)

Account screen, signed out. The three commit buttons stay stacked and thumb-sized:

| Button | x | y | w × h |
|---|---|---|---|
| Send sign-in link | 30 | 493 | 315 × 44 |
| Start free trial | 30 | 545 | 315 × 44 |
| Use promo code | 30 | 597 | 315 × 44 |

Same x, same width, 52px apart, 44px tall. The group's 14px side padding shifts them in without
clipping — 315px of a 390px viewport.

## Measurement — Advanced at 768px (`is-tablet`)

The known #347/#348 class of defect, where Obsidian's own phone rules never fire. It is worse
than the window width suggests: at 768px the settings pane keeps its nav sidebar, so the pane is
489px and a **group inside it is 410px** — the row's content line is about 366px, not 768.

| Row | label column | input | row height | |
|---|---|---|---|---|
| `Plus service URL` | 300px → **366** | **66px** → **382** | 122 → 161 | fixed, F2 |
| `Custom shortcut link` | **54px** → **366** | 276 → 346 | **311** → **145** | fixed, F2 |
| `Paste a session` | collapsed → **366** | — → 199 | — → 146 | fixed, F2 |
| Advanced screen total | | | **2,127px → 1,685px** | −21% |

`Custom shortcut link` reproduced exactly as the handoff predicted — label ellipsed into a 54px
column, 311px tall row. Two rows the handoff did not predict had the same failure: `Plus service
URL` in mirror image (a 66px input for a URL against a 300px name column), and `Paste a session`,
which the frame review caught. No name is ellipsed after the fix.

## Frames

`docs/qa/screenshots/settings-ux-redesign/`

| Frame | Surface |
|---|---|
| `u3-root-top-390x844.png`, `u3-root-mid-390x844.png`, `u5-root-bottom-390x844.png` | main screen, phone |
| `u3-root-top-768x1024.png`, `u5-root-bottom-768x1024.png` | main screen, tablet |
| `u4-engine-390x844.png`, `u4-engine-bottom-390x844.png` | engine destination |
| `u8-account-signedout-top-390x844.png`, `u8-account-signedout-bottom-390x844.png` | account, signed out |
| `u6-privacy-390x844.png` | privacy destination |
| `u7-advanced-top-390x844.png`, `u7-advanced-bottom-390x844.png` | Advanced, phone |
| `u7-advanced-top-768x1024.png`, `u7-advanced-bottom-768x1024.png` | Advanced, tablet |
| `u9-capture-sheet-390x844.png`, `u9-capture-sheet-768x1024.png` | capture procedure sheet |

## Route walk

Every route rendered to its last row, and every back row returned:

| Route | Rows rendered |
|---|---|
| `main` | 14 (13 + heading) |
| `engine` | `Set up automatic filing`, `Anthropic API key`, `Device-local key fallback`, three egress facts |
| `account` (signed out) | `Skip the API key`, `Email` + the three commit buttons |
| `privacy` | `What Atoms sends to Anthropic`, `What Ask stores and shares`, `Vault write acknowledgment` |
| `advanced` | `Model`, `Sync when you return to Obsidian`, `Sync everything now`, `Last filing run`, `Last catch-up`, `Plus service URL`, `Self-host guide`, `Custom shortcut link`, `Paste a session` |
| sheet | `<ol class="atoms-capture-steps">`, 3 steps, rendered as the second `.modal` |

## Findings

Frames were reviewed by looking at them, not only by asserting CSS. Three defects were found and
fixed on this branch; the rest are recorded and left alone, with the reason in each case.

### Fixed

**F1 · P1 · The group block did not exist on mobile, so the hairline was invisible.** Redesign-
owned. Obsidian's mobile settings style every `.setting-item` as its own card: opaque
`--background-primary` fill, 30px radius, 8px bottom margin. Measured at `is-tablet` before the
fix — rows `rgb(255,255,255)` floating on a group fill of `rgb(246,246,246)`, 8px gaps, 30px
corners. So the six groups rendered as strings of detached pills rather than the mock's single
inset block, and the between-row hairline that seven units were built around was being painted
across the curved top edge of a floating card, where nothing could see it. The computed-style
check earlier in this report passed the whole time.

Fix, part one: inside `.atoms-setting-group`, rows go `background: transparent; border-radius: 0;
margin-bottom: 0` (`styles.css`). Rows are now flush (measured gap 0) and the hairline lands
between two rows that touch. Side effect: the root screen lost 104px, since that 8px margin was
being paid thirteen times.

Fix, part two — and part one was wrong without it. Taking the fill off the rows left nothing to
put it back on, because the group's own fill was `--background-secondary` and **Obsidian's settings
pane is already `--background-secondary`**: measured `rgb(246,246,246)` for the pane, the modal and
the group alike, against `--background-primary` `#ffffff`. So the block had no edge, and a text
field — also `--background-secondary` — stopped looking like a field. The second frame review
caught it: 90% of the root frame was one flat colour, and the `Review` buttons on Privacy were
labels floating on nothing.

The mock maps `.group` to `--background-secondary` because it draws a full-screen page, where the
ground is primary. The settings modal inverts that. The group now takes `--background-primary`,
which is not an invented fill — it is the fill Obsidian was already painting behind each of the
thirteen row cards, moved onto the one block they belong to. The mock's actual requirement, a block
a step off its ground, survives in both themes. Measured after: group `rgb(255,255,255)` on a
`rgb(246,246,246)` pane, fields and secondary buttons `rgb(246,246,246)` and legible again.

**F2 · P1 · Three text rows collapsed at `is-tablet`.** Pre-existing in kind (#347/#348), but on a
screen this branch reshaped, and worse than the handoff predicted: `Custom shortcut link` ellipsed
its own title mid-word and turned its description into a 20-line ribbon beside a tall white void,
and `Plus service URL` and `Paste a session` failed the same way. Root cause is that Obsidian's
row stacking gates on `.is-phone`, `.is-mobile` carries no row layout, and the one existing floor
(#349) is a `@media (min-width: 700px)` query on the *window* — while the thing that is actually
366px wide is the *group*.

Fix: a floor on both halves plus `flex-wrap`, so flexbox keeps the row inline wherever both floors
fit and stacks it exactly where they do not — no platform class to get wrong, and it catches a
hand-narrowed desktop window too. `settingRow` now marks text rows with `atoms-setting-text`
(`src/settings/rows.ts`) so one rule covers every text row instead of each site rediscovering the
squeeze. Regression test: `test/settingsRows.test.ts`, "marks text rows for the width floor, and
only text rows".

The first attempt at F2 charged desktop for a tablet fix — letting the field take the surplus
shrank `Atom folder`'s name column from 371px to 240px and made the row 16px taller. The shipped
rule grows the name column far harder than the field, which restores desktop to 384/168 at 69px
while still giving the field its whole line once it has wrapped. Verified at all three widths.

**F3 · P3 · The design README described a group shape neither the mock nor the code used** —
`--background-primary-alt` and a 13px radius, against `--background-secondary` and 14px in both
`overhaul.html` and `styles.css`. Corrected. This is a fourth item for the § Coverage audit
reconciliation list, which U11 had taken to three.

### Recorded, not fixed

### Fixed on request

Both of these were first recorded as follow-ups, with the reasoning below for leaving them. The
user read that reasoning and asked for them anyway, which settles it.

**F4 · P1 · The engine screen's API-key row was written for a developer.** It named SecretStorage,
`emulator pm clear`, and the secret-id charset, on the screen where a new user decides who pays,
and `Anthropic API key` is the same row the plan measured at 211px, the tallest on the old screen.

The case for leaving it: the copy predates this branch (`01f7624`), and a comment at
`settings.ts:2646` recorded why the secret-id example sat in that description — as prose it had
been *between* the key row and the fallback toggle, splitting a pair that answers for the same
key. The field also takes a secret **id**, not the key, so the charset line is load-bearing.

What shipped keeps both of those true and still gets the jargon off the screen. The naming rule
moved to the **group footer**, which renders under *both* rows: the pair still touches, and the
rule is out of the path of somebody who only wanted to pick an engine. That is the third option
the earlier decision did not consider, and it is the grammar the plan already asks for. The row
now reads *"Kept on this device only, never synced and never in your vault files. A different
vault, or a reinstall, asks for it once more."* `Device-local key fallback` lost its
`SecretStorage` / `data.json` phrasing the same way.

The test that pinned the old decision was rewritten rather than deleted. Its real invariant — the
naming rule stays reachable and does not come between the pair — survives; it now also asserts the
pair is adjacent and that no implementation noun (`SecretStorage`, `emulator`, `data.json`,
`alphanumeric`) appears anywhere on the screen, which is the half that would otherwise rot.

**F5 · P2 · Em dashes in settings copy, against `docs/voice.md:54`** ("No em dashes in
product-authored copy. Use period, colon, or comma"). Seventeen strings across the tab. **This
branch introduced none of them** — every em dash it adds to `src/` is in a code comment, which the
rule does not cover.

All seventeen are gone. One was a row name, `Tag vocabulary — N active`, checked for doc lockstep
(KTD10) first and found to have none outside tests; it now reads `Tag vocabulary · N active`,
matching the `·` the version line and the group eyebrows already use.

Verified on device: **no settings route renders an em dash.** Not "no screen" — the consent sheets
still do, because their text is the frozen wording below and a sheet is not a route. The claim has
to be worded that precisely or it is false.

`src/settings/consent.ts` is deliberately untouched and deliberately exempt. Its standing
disclosure strings carry em dashes and cannot be reworded without an `EGRESS_ACK_VERSION` bump —
they name the exact wording a stored acknowledgment was recorded against, so editing them without
the bump leaves every existing device holding a record for text it never saw (KTD5, #315). That is
a data-integrity bug wearing a typography fix.

New guard: `test/settingsCopyVoice.test.ts` reads the settings sources, strips comments — the rule
is about copy a user reads, not prose for the next maintainer — and fails on any em dash. It also
asserts the consent exemption is still needed, so the exemption cannot quietly outlive its reason.

**The same violation is plugin-wide, and that part is not fixed.** About **102 non-comment lines
across 28 files** outside `src/settings/` still use em dashes: `src/plugin/main.ts` alone has 24,
then `atomsHomeData.ts` 7, `atomsHomeView.ts` 6, `preview.ts` 6, `askMirror.ts` 6,
`connectivity.ts` 6, and twenty-two more. Sweeping those means touching home, notices, the preview
path and the mirror, several of which are single-sourced across two surfaces. That is a change of
a different size than this PR, and folding it in would make the settings diff unreviewable. Filed
as its own piece of work.

### Recorded, not fixed

**F6 · P3 · Raw ISO dates in user copy** — `Acknowledged 2026-08-07`, `Last filing run
2026-08-11`, against the mock's `Agreed 7 August`. Mixed in the same group with relative time
(`1m ago: caught up`). `Last catch-up` is single-sourced with Atoms home through
`LAST_CATCHUP_LABEL`, so a format change is a two-surface change. Follow-up.

**F7 · P3 · The capture procedure renders as a centred dialog, not a bottom sheet.** The mock
anchors it to the bottom with `border-radius: 16px 16px 0 0`; Obsidian's `Modal` centres it, and
at 390px that leaves dead space above the title. The three steps themselves are legible and
correctly indented. Changing it means custom modal chrome, which the plan did not ask for.

**F8 · P3 · Privacy records are button rows where the mock has chevron rows.** Not a defect: the
`Review` button is the withdrawal affordance, which is what `recordRow` exists to carry (U6, and
the nav map's note that a record row appears only once an ack has been granted). The mock predates
that decision.

**F9 · P3 · The sticky header title overlaps scrolled body text** on every mid/bottom frame. The
back and close circles are opaque and the bar between them is not. This looks like Obsidian's own
mobile chrome with a backdrop filter that does not render under desktop mobile emulation, rather
than a plugin bug — it needs one real-device check before anyone spends time on it.

**F10 · P3 · Value placement is not uniform** — right-aligned on some rows (`Daily notes / On`),
carried as a description on chevron rows (`Who does the filing / Not chosen`). Defensible, but the
mock's `.val` is uniformly right-aligned.
