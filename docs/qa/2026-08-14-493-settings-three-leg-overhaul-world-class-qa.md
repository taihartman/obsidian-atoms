# QA — Settings three-leg overhaul (#493 / PR #494)

- **Branch:** `claude/settings-ux-redesign-69acd6` · **Version:** tested at 0.8.0, ships as **0.8.0-beta.1**
- **Plan:** `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md`
- **Mock SSOT:** `docs/design-handoff/settings/overhaul.html`, `account.html`
- **Vault lane:** throwaway `test_vault/test vault` (agent QA). No personal vault touched.
- **App:** Obsidian 1.13.6 (installer 1.12.7), plugin `atoms` 0.8.0, mobile emulation on.

Status: **complete**. Device evidence and measurements were captured first; story coverage, the
live state walk, and the adversarial half were added at the `world-class-qa` step of the shipping
tail and are the second half of this file.

## Gates at HEAD

| Gate | Result |
|---|---|
| `npm test` (at capture time) | **1863 passed / 97 files** |
| `npm test` (at story-coverage time, `fbd9d9c`) | **1880 passed / 99 files** |
| `npm test` (after the H1 fix, this commit) | **1881 passed / 99 files** |
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

> **Superseded by #500/#502.** The selector below is now `~` rather than `+`. Adjacency only
> expressed "every row after the first" while a group held nothing but rows; the first element
> rendered between two of them — the refused-URL error line — silently took the separator off the
> row beneath it, measured on device as `border-top: 0px none` in every state. The measurements in
> this section still hold; the rule that produces them is one character different.

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

## Charter

The Atoms settings tab was restructured around the product's three legs: a status group that says
whether Atoms is filing, then `1 · Capture`, `2 · File`, `3 · Resurface` + `Ask`, then a `Your data`
utility group holding the two destinations nobody opens on an ordinary day. Explanation moved out of
rows and into one footer per group; consent records, diagnostics and the escape hatches moved to
destinations. Eleven units, 67 files, +8,961 / −660 against `master`.

**What must work:** a new user can tell whether Atoms is filing and what the one next step is; the
one mandatory decision (who does the filing) is reachable and lands on a screen that asks it; every
consent gate still stands where it stood; no setting was deleted; the screen does not lie about a
first arrival. **Adjacent regression risk:** consent gates and the egress ack (the sheets are
shared with Atoms home), account/Plus rows (restyled), and the tag vocabulary screen.
**Platforms:** desktop Obsidian 1.13.6 under mobile emulation at `is-phone` 390×844 and `is-tablet`
768×1024. No physical phone.

**Product loop vs fixture.** This branch changes no pipeline, Ask, or plus-service behavior — it is
a settings surface. So the "user loop" for these stories is the configuration loop itself: open
Settings, read what it says, tap the thing it says to tap, and see the screen change under a real
state change. That is what was driven. Two claims cannot be proved that way inside one session and
are labelled as such: the day-one promise ("first atoms arrive tomorrow morning") is proved against
the device-local run stamp rather than by waiting a day, and the Plus signed-in variants are proved
by test rather than by paying. Nothing here was made green by planting data — see § Not tested.

## Preflight

| Check | Result |
|---|---|
| Product dogfood honesty | ✅ present, `docs/qa/README.md` § Product dogfood honesty |
| Authority paths | ✅ plan `docs/plans/2026-08-14-001-…-plan.md`, mock SSOT `docs/design-handoff/settings/overhaul.html` + `account.html`, `docs/architecture.md` § North star, `docs/voice.md` |
| Learnings | ➕ read before driving, and one row added this pass |
| Navigation map | 🔧 `docs/qa/app-navigation-map.md` § Settings → Atoms healed in this PR — it still described the pre-overhaul flat screen, the four-route shape, and consent records on the main screen |
| Dev/run command | ✅ `./scripts/install-to-vault.sh "…/test_vault/test vault"` → `Reloaded plugin via CLI (vault=test vault): atoms` |
| Viewport | ✅ `is-phone` 390×844 and `is-tablet` 768×1024, asserted by body class, not by window width |
| Auth path | ✅ signed out is the state under test. Plus sign-in via `installPlusSession` only, labelled; the emailed magic-link tap stays Not Tested by policy |
| Fixtures | ✅ throwaway `test_vault/test vault`; no new fixture minted |
| Mockup | ✅ `overhaul.html`, `account.html` |
| Automation | ✅ Obsidian CLI (`eval`, `command`, `dev:screenshot`). No Playwright — this is a desktop Electron app |
| Device lock | N/A — no shared physical device; emulated viewports only |
| Deploy reality | N/A — plugin-only change, no service or rules component. Version 0.8.0, unreleased |

## Authority and promises

Acceptance below comes from the plan's requirements, the mock, and on-screen copy. Where a promise
is a rendered string, the string is the promise — no acceptance in this table was read out of a
handler.

| Surface | Promise (authority) | Acceptance (observable) | Story |
|---|---|---|---|
| Status group, nobody files | R9 / R18 | Screen opens by saying what Atoms does, above every control, and names exactly one next step marked `Required` | US-1 |
| The `Required` row | R18 + its own name | `Choose who files your captures` opens the engine screen; `Turn on Daily Notes` opens Obsidian's core-plugins tab | US-2 |
| Status group, somebody files | R12 | States filing is on and when the first atoms arrive; the promise retires once a run is on the books | US-3 |
| Automatic-filing toggle | U2 seam / KTD | Renders in exactly one group — the status group once setup is finished, the File group while it is not. Never both | US-4 |
| `1 · Capture` footer | R10 | Says Atoms never captures for you, and that an indented bullet is read as part of the one above it | US-5 |
| `2 · File` footer | R11 | Names all three writes: atom files, one marker line, a list inside its own marked block | US-6 |
| Engine screen | R6 / KD4 | Both engines offered; price quoted from the pricing SSOT; the egress facts stated without repeating versioned disclosure wording | US-7 |
| `Privacy and consents` | R7 / KTD6 | Renders while any of the three records, a Plus session, or a known cloud copy exists; subtitle counts what is on record | US-8 |
| `Your data` footer | R20 + `UTILITY_GROUP.footerAdvancedOnly` | Does not name Privacy when no Privacy row rendered | US-9 |
| Every group | R2 | Header, rows, exactly one footer; hairline between neighbouring rows and none at the rounded edges | US-10 |
| Advanced at `is-tablet` | R14 / #347–#349 | No row name ellipsed, no row collapsed into a ribbon beside a void | US-11 |
| `Capture on your phone` | R19 / U9 | The six-step iOS procedure opens as a sheet rather than living in a row caption | US-12 |
| Main screen size | plan U11 step 5 | Re-measured against the 3,444px / 30-term baseline at 390px | US-13 |
| Destination rows | R21 | Keyboard reachable, 44px target | US-14 |
| Settings copy | R15 / `docs/voice.md:54` | No em dash renders on any settings route | US-15 |
| Coverage audit | R5 | Every row in the 34-row audit still has a home; no setting removed | US-16 |

## Live state walk

A second live session drove the state variants the frames cannot show, on the same build
(`install-to-vault.sh` → `Reloaded plugin via CLI (vault=test vault): atoms`, manifest 0.8.0,
`is-phone` asserted before every read). Every string below was read off the rendered DOM.

**The QA device was not virgin, and that changes how S1 reads.** `resolveFilingAuth().mode` was
`none` and Ask was signed out as intended, but device-local auto-run state was already populated:
enabled, egress ack `2026-08-06`, last run `2026-08-11`, three privacy grants. So the baseline
screen exercises the File group's `hasFiled` branch (`settings.ts:1629`), not a fresh install.

| # | State driven | What rendered | |
|---|---|---|---|
| S1 | Signed out, Daily Notes on, no engine | Six groups, **exactly one footer each**, **exactly one** automatic-filing toggle on the screen | PASS |
| S2 | Tap `Choose who files your captures` | Engine screen: back row `Who does the filing`, groups `Pick one` + `What gets sent` | PASS |
| S3 | Daily Notes off | Step flips to `Turn on Daily Notes` / `Required`; tapping it switches `app.setting.activeTab` to `Core plugins`; `Daily notes` value flips to `Off`. Restored, and the step flipped back | PASS |
| S4 | Engine configured through the tab's own controls | Header flips `Get started` → `Status`; `File automatically` + `Next run` / `Tomorrow, when Obsidian opens.`; `Who does the filing` flips `Not chosen` → `Your own key`; the File group **sheds the toggle** | PASS |
| S4 | All three `filingStateDesc` lines | off → `Atoms files a past day only when you ask it to.` (and `Next run` disappears); on, never run → `First atoms arrive tomorrow morning.`; on, has run → `Atoms files each past day when Obsidian opens.` | PASS |
| S4 | Egress consent sheet, ack withdrawn first | Sheet raises on toggle-on, `Cancel` + `I understand`, the `(1)…(4)` disclosure. **Cancel writes no grant** — ack stayed null and `enabled` was cleared | PASS |
| S5 | `Your data` footer, both variants | With the Privacy row: `Privacy holds what you have allowed and the way to take it back. Advanced holds the settings almost nobody needs.` Without it (all three grants cleared, no session, no cloud copy): the group holds only `Advanced` and the footer is `Advanced holds the settings almost nobody needs.` | PASS |
| S6 | Committed frames vs this build | Bottom frame **SHA-256 identical** to the committed file on a fresh capture; top frame differs only in the 12 pixel rows carrying the state-dependent subtitle. Block fill, flush rows, hairlines, eyebrows all match. No sheet over a dimmed page | PASS |

The engine was configured the honest way — the `Device-local key fallback` toggle was clicked, the
password row it reveals was typed into, and that row's own `onChange` stored the value. A throwaway
placeholder, never a real key, never printed. Everything was put back afterwards; see
§ Test data mutated.

**The stale-frame trap fired again during S6**, exactly as `docs/qa/learnings.md` describes: the
first post-scroll capture came back byte-identical to the *top* frame. It was discarded and
recaptured. Two new environment notes went into the learnings file this pass.

## Stories under test

Acceptance is copied from § Authority and promises. Evidence is either the live walk above, a
committed frame, a measurement in this report, or a named test — a test alone is never the whole
evidence for a story about what a user sees.

**Primary**

**US-1 · As a new user opening Settings, I want to know whether Atoms is doing anything, so that I
am not guessing.** Acceptance: the screen opens by saying what Atoms does, above every control, and
names exactly one next step marked `Required` (R9, R18). Evidence: S1 + `u3-root-top-390x844.png`;
`settings.test.ts` "opens the screen by saying what Atoms does, above every control". **Passed.**

**US-2 · As that user, I want the one thing it tells me to do to actually take me somewhere, so that
the instruction is not decoration.** Acceptance: `Choose who files your captures` opens the engine
screen; `Turn on Daily Notes` opens Obsidian's core-plugins tab. Evidence: S2 and S3, both driven
live, including the `activeTab` flip to `Core plugins`. **Passed.**

**US-3 · As a user who just set up filing, I want to know when the first atoms arrive, so that
day-one silence does not read as breakage.** Acceptance: the status group states filing is on and
when the first atoms land, and stops promising a first arrival once a run is on the books (R12).
Evidence: S4 — all three lines rendered live, including the retirement; `settings.test.ts` "states
filing is on and when the first atoms arrive", "stops promising a first arrival once a run is behind
it", "keeps the day-one promise until a run is actually on the books". **Passed.**

**US-4 · As a user, I want one automatic-filing switch, so that I never wonder which one is real.**
Acceptance: the toggle renders in exactly one group — status once setup is finished, File while it
is not, never both. Evidence: S1 (one toggle, in File) and S4 (File sheds it when the status group
takes it); `settings.test.ts` "sheds the toggle from the auto-run section rather than rendering it
twice". **Passed.**

**US-5 · As a new user, I want to know Atoms will not capture for me, so that I do not wait for
something that never happens.** Acceptance: the Capture footer says Atoms never captures for you and
that an indented bullet is read as part of the one above it (R10). Evidence: S1 footer verbatim;
`settings.test.ts` "says Atoms never captures for you, under the Capture group (R10)". **Passed.**

**US-6 · As a user deciding whether to trust this with my vault, I want to know exactly what it
writes.** Acceptance: the File footer names all three writes — atom files, one marker line, a list
inside its own marked block (R11). Evidence: S1 footer verbatim; `settings.test.ts` "names every
kind of write Atoms makes, under the File group (R11)". **Passed.**

**US-7 · As a user picking who pays, I want both engines offered on one screen with the price and
what leaves the device.** Acceptance: both engines, price quoted from the pricing SSOT, egress facts
stated without repeating versioned disclosure wording (R6, KD4). Evidence: S2 route walk +
`u4-engine-390x844.png` / `u4-engine-bottom-390x844.png`; `settings.test.ts` "offers both engines:
Plus one tap in, and the key field in place", "quotes the price from the pricing SSOT rather than a
literal in the screen", "states what leaves the device without repeating the versioned disclosure".
**Passed.**

**Continuation**

**US-8 · As a user who allowed something, I want to be able to take it back, whatever I allowed.**
Acceptance: `Privacy and consents` renders while any of the three records, a Plus session, or a
known cloud copy exists, and its subtitle counts what is on record (R7, KTD6). Evidence: S1
(`3 on record`) and S5 (row gone once all three grants were cleared); `u6-privacy-390x844.png`;
`settings.test.ts` § "each grant alone keeps the way out reachable", plus "renders for a Plus session
with nothing acked, so the cloud copy is never stranded" and "renders for a known cloud copy with no
session and no ack". **Passed.**

**US-9 · As a user on a fresh install, I want the screen not to describe a row that is not there.**
Acceptance: the `Your data` footer drops its Privacy clause when no Privacy row rendered. Evidence:
S5 — both footer strings observed live; `settings.test.ts` "does not name Privacy in the footer when
there is no Privacy row", "names Privacy again once there is something to take back". **Passed.**

**Negative**

**US-N1 · As a user who opens the consent sheet and changes their mind, I want cancelling to grant
nothing.** Acceptance: the sheet is dismissable without writing an ack, and the toggle does not
stick on. Evidence: S4 — `Cancel` + Escape left the ack null and cleared `enabled`;
`settings.test.ts` § "declining" and § "dismissing", and `consentGate.adversarial.test.ts`.
**Passed.**

**US-N2 · As a user with a bad folder path, I want the rule stated rather than silently applied.**
Acceptance: `..` and subfolders are rejected and the row still states the rule. Evidence:
`settings.test.ts` "still rejects .. and subfolders", "still states that rule to the user, because
nothing else reports the fallback"; the rule was read live on the `Atom folder` row in S1.
**Passed — logic by test, copy live.**

**Edge**

**US-11 · As a user on a tablet, I want the rows readable.** Acceptance: no row name ellipsed, no
row collapsed into a ribbon beside a void, at `is-tablet` (R14, #347–#349). Evidence:
§ Measurement — Advanced at 768px; `u7-advanced-top-768x1024.png`, `u7-advanced-bottom-768x1024.png`;
`settingsRows.test.ts` "marks text rows for the width floor, and only text rows". Advanced dropped
2,127px → 1,685px and no name is ellipsed. **Passed (F2 fixed on this branch).**

**US-12 · As an iPhone user, I want the shortcut procedure without a wizard in a caption.**
Acceptance: the six-step procedure opens as a sheet (R19, U9). Evidence:
`u9-capture-sheet-390x844.png`, `u9-capture-sheet-768x1024.png`, route walk;
`settings.test.ts` § "capture on your phone (U9, R2/R19)". **Passed** — with F7 recorded: the sheet
is centred rather than bottom-anchored.

**US-13 · As a phone user, I want the screen to stop being four screens long.** Acceptance:
re-measured against the 3,444px / 30-term baseline. Evidence: § Measurement — the signed-out root at
390px. 3,444px → **2,121px (−38%)**, 30 → **11 terms (−63%)**, nine → **two** before the first
control. **Passed**, and it does not reach the mock's 1,081px — the honest read is in that section.

**Regression**

**US-16 · As the maintainer, I want no setting to have quietly disappeared.** Acceptance: every row
in the 34-row coverage audit has a home (R5). Evidence: `settings.test.ts` "holds every moved row",
"holds the plumbing, the sync, the self-host route and the escape hatches, in that order", plus the
live route walk of all five routes. **Passed** — four reconciliation items are recorded against
`docs/design-handoff/settings/README.md`, F3 being the fourth.

**US-R1 · As a device that already granted consent, I want the restructure not to re-prompt me.**
Acceptance: no ack version bumped, standing strings unchanged (R8). Evidence:
`egressConsentParity.test.ts` `FROZEN_CONSENT`; `settings.test.ts` "keeps the frozen egress standing
strings exactly as they were"; live, the QA device's `2026-08-06` ack survived the whole pass and
was never re-asked. **Passed.**

**Perception**

**US-P1 · As a user reading a value, I want it to say something rather than nothing.** Acceptance:
every derived value declares an unknown state rather than rendering blank (R20). Evidence: S1 and S4
— `Daily notes / On` → `Off`, `Who does the filing / Not chosen` → `Your own key`,
`Privacy and consents / 3 on record`, `Ask in Claude and ChatGPT / Off`; `settings.test.ts` "reports
Daily Notes as a fact, and never as a blank right edge (R20)", "counts what is on record, and says so
when the answer is none". **Passed**, with F10 recorded on value placement not being uniform.

**Craft**

**US-C1 · As a user, I want the screen to look like one designed thing.** Acceptance: group block a
step off its ground, rows flush inside it, one hairline between neighbours and none at the rounded
edges, no accent-tinted card fills (R2, R14). Evidence: § Measurement — the between-row hairline;
frames re-reviewed by looking at them; S6 confirms the committed frames still match this build.
Breathing room, stack density, hierarchy and clipping were read on the decisive root frame; the
stacked-chrome check is the group-to-group rhythm, and the six groups sit apart with their eyebrows
reading as one sequence. **Passed — after F1**, which is exactly this gate catching a screen that
passed every computed-style assertion while rendering as strings of detached pills.

**Accessibility**

**US-14 · As a keyboard user, I want the chevron rows this plan created to be reachable.**
Acceptance: keyboard-activatable, 44px target (R21). Evidence: `settingsRows.test.ts` "activates a
chevron row from the keyboard and gives it a 44px target"; the `formActionsRow` measurement in this
report puts the three account buttons at 44px tall on device. **Passed by test and by measurement;
no screen-reader pass ran** — see § Not tested.

**Copy**

**US-15 · As a reader, I want the product's voice, not a maintainer's.** Acceptance: no em dash
renders on any settings route (R15). Evidence: F5 — seventeen strings removed, verified on device
across every route, guarded by `settingsCopyVoice.test.ts`. **Passed**, with the consent-sheet
exemption stated precisely: no *route* renders an em dash; the frozen consent sheets still do, and
must (KTD5).

## Risk matrix

| Risk | Row | Story | Evidence |
|---|---|---|---|
| Happy | New user reads status, taps the one step, lands on the engine screen | US-1, US-2 | S1, S2, frames |
| Happy | Configured user sees filing state and next run | US-3, US-4 | S4 |
| Negative | Consent declined or dismissed grants nothing | US-N1 | S4, adversarial tests |
| Negative | Invalid atom-folder path | US-N2 | test + live copy |
| Edge | `is-tablet` pane is 489px and the group 410px | US-11 | measurement, frames |
| Edge | Daily Notes off under a configured engine | US-3, F11 | S3, S4 |
| Edge | Device with nothing on record | US-9 | S5 |
| Regression | No setting lost in the move | US-16 | tests + route walk |
| Regression | No device re-prompted for consent | US-R1 | frozen-string tests, live ack survived |
| Perception | Derived values never blank | US-P1 | S1, S4 |
| Perception | Group footers carry the explanation the rows lost | US-5, US-6 | S1 verbatim footers |
| Promise | Status step's name matches where it lands | US-2 | S2, S3 |
| Promise | Filing line matches what the device is doing | US-3, F11 | S4 |
| Craft | Group block, flush rows, hairline | US-C1 | measurement + frames + S6 |

## Findings

Frames were reviewed by looking at them, not only by asserting CSS. Three defects were found and
fixed on this branch; the rest are recorded and left alone, with the reason in each case.

### Fixed on device evidence

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

**F11 · P3 · With Daily Notes off and a run already on the books, the toggle's line is
present-tense about something that cannot happen.** Found in the live state walk. **The engine half
of this was a real bug and is fixed — see H1.** What follows is the Daily-Notes half, which is a
different question and stays as it is. That device shows
`Turn on Daily Notes` / `Required` at the top and, four rows down,
`Atoms files each past day when Obsidian opens.` Nothing can be filed without daily notes, so the
second line is not true while the first one stands.

Recorded rather than fixed because it is a **chosen** trade-off, not an oversight: both existing
lines are wrong in that state, and the test at `settings.test.ts` "does not promise a first arrival
to a device that is already filing" pins this one deliberately — the alternative,
`Filing starts with tomorrow's note`, promises a silence window the device already spent, which is
the worse of the two. The screen is also not silent about the problem: the `Required` step is the
first thing on it.

The real fix is a **third** line for the state where filing is configured but blocked, along the
lines of *"Paused until Daily Notes is on."*, which needs its own copy pass and its own test. That
is new product copy on a settled decision, so it is a follow-up rather than a QA-time edit.

**F12 · P3 · The consent sheet's `.modal-title` is empty** (`src/settings/consent.ts`). The title
text `What Atoms sends to Anthropic` renders as the first element inside `.modal-content` instead,
so the sheet reads correctly and loses its native title semantics. Pre-existing, and in the one file
this branch must not disturb (KTD5). Follow-up, together with F6.

**F13 · P3 · Two File-group rows still carry prose subtitles.** `Atom folder` and `Refresh hub
lists`. The first is the R19 carve-out and is meant to be there — it is the rule that lets a user
predict the fallback. The second is descriptive rather than predictive, and is the one row on the
screen a further footer sweep could still take.

**Driving note, not a product finding.** Disabling the `daily-notes` core plugin in the same `eval`
as `app.setting.close()` threw `Cannot read properties of null (reading 'setQuickActions')` from
Obsidian's own settings teardown. The disable still took effect and it did not recur on re-enable.
Recorded so it is not mistaken later for a plugin crash.

## Adversarial pass

`adversarial-qa`, run against this build as the required gate. Seventeen scenarios weighted to the
destructive and re-entry classes, each one traced in the source, checked against the existing tests,
and then driven. Three holes proven, all live-reproduced first and locked behind a test.

**A harness correction worth keeping.** On desktop 1.13.6 Settings opens in a **separate popout
window**, so the `.modal-container .modal` count this project has been using is a main-window
signal. The live handle is `activeDocument.body.contains(plugin.settingTab.containerEl)`. The
renderer console cannot be scraped from `obsidian eval`, so the pass installed a `window.onerror` +
`unhandledrejection` + `console.error` collector instead; it stayed **empty through every
scenario**.

### Scenario ledger

| # | Scenario | |
|---|---|---|
| 1 | Configure a device-local key → status group takes the toggle → delete the key → read the screen | **holed** — H1 |
| 2 | Grant the egress ack, withdraw it from Privacy, re-enable the toggle | solid |
| 3 | `Atom folder` = `../escape`, subfolder, empty, 300 chars, emoji, dot-folder (+9 more) | **holed** — H2, H3 |
| 4 | Withdraw the last grant while standing on the Privacy destination | solid |
| 5 | Walk into the engine screen, delete the key there, press back | solid |
| 6 | The Plus-only `connect` destination with no session | solid |
| 7 | Double- and triple-tap a destination row, `Preview…`, the filing toggle, a commit button | solid |
| 8 | Race the filing toggle on → off → on, with and without the ack | solid — the scrim blocks it, and the stale-handler path is already test-covered |
| 9 | Open `Capture on your phone` twice | solid, with a caveat below |
| 10 | Escape a sheet, walk into a destination, come back, toggle again | solid |
| 11 | Close Settings with a sheet open, reopen | solid |
| 12 | External `data.json` change under an open sheet | solid — test-covered, not driven |
| 13 | Bottom of Advanced → route change → back | solid |
| 14 | 320×568 (iPhone SE), the `2 · File` group | solid |
| 15 | Tag vocabulary: empty, blank, duplicate, `#IDEA`, emoji, 80 chars, `9lives`, `../evil` | solid |
| 16 | A device with nothing on record and no session | solid |
| 17 | Offline: `Sync everything now`, `Preview…`, request a sign-in link | solid, one copy leak |

### H1 · P1 · A device with no engine was told it files every past day — **fixed**

`src/settings/settings.ts:1629`. Repro: engine screen → `Device-local key fallback` on → paste a
key → back, and the status group takes the toggle; then engine screen → fallback off, which deletes
the key → back. The main screen then rendered `Choose who files your captures · Required` and
`Who does the filing · Not chosen` **and**, four rows down,
`File automatically when Obsidian opens / Atoms files each past day when Obsidian opens.` with the
toggle on. `resolveFilingAuth()` reports `none` — no key, no session — so nothing can be sent and
nothing is filed. Reproduced a second way: withdraw the egress ack from Privacy, then re-enable the
toggle and accept the sheet.

`hasFiled` was `automaticFilingOn(state) && Boolean(state.lastRunDay)` — device stamps only, never
the engine, although `renderFileGroup` already had `filing` in hand. Fixed by requiring an engine.
The Daily-Notes twin is deliberate and stays: a spent window argues filing *was* happening, and that
tab has a real engine. A deleted key argues nothing can be sent at all. Regression test:
`settings.test.ts` "does not claim a device with no engine is filing each past day", written
directly beside the twin it must not break.

This supersedes **F11** below on the engine half; F11's Daily-Notes half stands as recorded.

### H2 · P2 · `Atom folder` accepts a dot-folder, and every atom lands where Obsidian will not look — **not fixed, out of scope**

`src/pipeline/render.ts` `clampAtomFolder` rejects `.`, `..` and anything containing `..`, but not a
**leading dot**. Typing `.hidden` persists. Measured in the live vault:
`app.vault.create(".hidden/QA Probe Hidden.md")` succeeds on disk, then
`getAbstractFileByPath` returns null, `getMarkdownFiles()` under that folder returns 0, and
`metadataCache.getFirstLinkpathDest("QA Probe Hidden", "")` returns null. So atoms are absent from
the explorer, from search and from the graph, and the `↳ [[title]]` sentinel the pipeline appends to
the daily note is a permanently unresolvable link. `.obsidian` is accepted too, which points atoms
at the config directory.

Pre-existing, and in `src/pipeline/`, which this plan's scope boundary excludes: *"Restructures the
settings tab only. No pipeline, Ask, or plus-service behavior changes."* The fix is a leading-dot
guard beside the existing `..` guard, plus widening the row subtitle at `settings.ts:2996`, which is
the only surface that ever reports the fallback — those two belong in one change. Filed as
follow-up; the repro above is the test.

### H3 · P2 · `Atom folder` has no length cap — **not fixed, out of scope**

Same function. 300 characters are stored verbatim; macOS caps a path component at 255 bytes, so
`createFolder` and `create` both threw `ENAMETOOLONG` in the live vault and Obsidian's own scanner
logged `{"errno":-63,"code":"ENAMETOOLONG","syscall":"scandir"}`. Nothing on screen reports it —
the field keeps the value and filing silently stops producing atoms. Same file, same scope boundary,
same follow-up as H2.

### H4 · P3 · A raw exception string reaches a Notice — **not fixed, pre-existing**

`src/platform/plusClient.ts:230`. With `plusBaseUrl` pointed at an unreachable host,
`Send sign-in link` surfaced `Atoms Plus: Plus network error (TypeError: Failed to fetch)`. It is
redacted and the `Email` row correctly did **not** claim a link was sent, but
`TypeError: Failed to fetch` is not something a user can act on. Outside `src/settings/`.

### Suspected, unproven

- **`captureSheet` has no single-instance latch**, unlike `ConsentSheetModal`'s module-level
  `openSheet`. A programmatic double-click stacks two identical sheets. A real tap cannot reach it —
  `elementFromPoint` over the row after the first open returns `modal-bg` — so it is a harness
  artifact today. It stops being one the moment a second surface can open that sheet.
- **A dangling `apiKeySecretId`** (an id set with nothing behind it in SecretStorage) was the live
  baseline. The engine screen and the status group both read it correctly as "not chosen", so no
  wrong claim was found; whether any *other* surface treats a dangling id as a configured engine was
  not chased.
- **Emoji folder names** are accepted and macOS took one without complaint. Not called a hole, but
  it shares the unbounded-segment shape with H2 and H3.

## Test data mutated

All in the throwaway `test_vault/test vault`. No personal or Remote Vault was touched, and no
product code was edited during the drive. Every mutation was restored and the restore was verified
by re-reading the state afterwards.

| Changed | Restored to |
|---|---|
| `daily-notes` core plugin disabled | enabled |
| `useDeviceLocalKeyFallback` on | off |
| Device-local placeholder key written (never a real key, never printed) | cleared; `resolveFilingAuth().mode === "none"` |
| `atoms-last-run-day` cleared | `2026-08-11` |
| `atoms-auto-run-egress-ack` withdrawn | `2026-08-06` |
| `atoms-auto-run-enabled` cleared by the declined sheet | `true` |
| `askPrivacyAckAt`, `askWriteAckAt` cleared | both original stamps |
| Six temporary PNGs in the vault root | deleted |

The one thing not restored exactly is the desktop window size: emulation was turned off and the
window set to 1400×900, its original size being unknown. The adversarial pass mutated a further
fourteen `atomFolder` values, the tag vocabulary, `plusBaseUrl`, both Ask acks and a `.hidden`
probe directory in the vault, and restored every one of them, verified after a `plugin:reload`.

## Not tested

Named rather than implied, because each one is residual risk somebody could otherwise read as
covered:

- **A real phone.** All evidence is desktop Obsidian under mobile emulation at `is-phone` and
  `is-tablet`. F9 — the sticky header title overlapping scrolled body text — is the one finding that
  specifically needs a real device before anyone spends time on it, because it looks like Obsidian's
  own backdrop filter not rendering under emulation.
- **A screen reader.** R21 is proved by a keyboard-activation test and a 44px measurement, not by
  VoiceOver or TalkBack.
- **The emailed magic-link tap.** Policy: finishing a magic link by reading `plus.sqlite` or the
  service console is credential extraction. A Plus session can be installed on the open tab and
  labelled, which is how the signed-in variants are covered; the email tap stays for a human.
- **A real filing run across a day boundary.** The day-one promise is proved against the device-local
  run stamp, in both directions, not by waiting until tomorrow.
- **Paid Plus states.** `active`, `exhausted` and `periodEnded` renders are covered by test, not by a
  live subscription.
- **The plugin-wide em-dash sweep.** Settings is clean and guarded; about 102 non-comment lines
  across 28 other files are not, and that is a separate change (F5).

## Learnings

`docs/qa/learnings.md` was read before driving, and three rows were added this pass: the
`emulateMobile` call that silently does not take when it shares an eval with the resize, the
`settingTab.containerEl` handle that stays non-null after Settings closes, and how to put a QA
device into a configured engine state through the plugin's own controls rather than by hand-writing
storage. `docs/qa/app-navigation-map.md` § Settings → Atoms was healed in the same change: it still
described the pre-overhaul flat screen, four routes, and consent records on the main screen.

## Verdict

**Ready to merge.**

Sixteen stories carry evidence and a status. Every gate is green at the fix commit — `npm test`
**1881 passed / 99 files**, lint, build, `typecheck:test`, and a clean tree afterwards. Three
defects found by looking at frames were fixed on this branch (F1, F2, F3), two more were fixed at
the user's request (F4, F5), and the adversarial gate found one real hole in this branch's own code
(H1), which is fixed with a regression test beside the test it had to not break.

What merges knowingly unfixed: five P3s recorded with their reasons (F6–F10), the Daily-Notes half
of F11, and three findings outside this branch's scope — H2 and H3 in `clampAtomFolder`, H4 in
`plusClient`. H2 and H3 are the ones worth acting on soon: a dot-folder or an over-long folder name
is accepted silently and atoms then land where Obsidian will not index them. They are pre-existing,
they are in `src/pipeline/`, and this plan's scope boundary excludes pipeline behavior, so fixing
them here would widen a settings diff into the write path. Filed as follow-up.
