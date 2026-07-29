# Plan — Inbox self-healing, the stuck card, and home spacing

**Date:** 2026-07-29
**Source:** `docs/handoffs/2026-07-29-inbox-stuck-card-and-home-spacing.md`
**Branch:** `claude/inbox-stuck-card-home-spacing-d5557d` (worktree, off `master` @ 44e6ef4)
**Lane:** **full** — escalated from `light` after the 2026-07-29 doc-review. The review showed the change reaches the drain's non-null time contract, the daily bullet shape, the dedupe key, marker placement, and idempotency on re-drain — not the ~4 files first scoped. Per `docs/workflow-lanes.md`, ambiguity resolves to the heavier lane.
**Doc-review:** done 2026-07-29 (coherence · feasibility · design-lens · product-lens). Findings folded in below; two safe-auto fixes applied silently.

---

## The governing constraint (from the user, this session)

> "I don't ever expect the user to actually manually change this inbox file.
> This should only be what we do to it with our plugin."

`Atoms System/Inbox.md` is **plugin-owned machinery, not a user surface.** Every
design choice below follows from that, and it invalidates the handoff's suggested
direction ("make the card tappable straight into `Atoms System/Inbox.md` scrolled
to the first unparseable line") — that routes the user into internal plumbing to
perform a repair they should never have to perform.

Corollary: in steady state with the shipped v2.0.0 recipe, an unreadable stamp is
**always** a misconfigured shortcut, never something to fix in the note. So the
only honest user-facing action is "check your capture shortcut," and the only
honest plugin action is to heal the capture rather than strand it.

---

## What was verified (not assumed)

Every handoff claim re-checked against live source and the live vault.

| Claim | Verdict |
|---|---|
| `STAMP_RE` is ISO-only and requires trailing text | Confirmed — `src/pipeline/inbox.ts:44-45` |
| `parseStamp` → null → `unparseable: true` | Confirmed — `inbox.ts:135-156`, `inbox.ts:206` |
| Card has no click handler, two `<p>`s only | Confirmed — `atomsHomeView.ts:1866-1875` |
| Exactly 4 unparseable bullets | Confirmed by **full-file** scan (29 lines, 8 bullets, 4 filed markers) — the handoff's "tail only" caveat is discharged; nothing older lurks above |
| Content sits outside every capture extent | Confirmed — vault lines 15, 17, 19 |

## The handoff's open question is closed

Not transient, not a plugin regression: **the shortcut was misconfigured, and
`docs/capture-shortcut.md` already documents both pitfalls the user hit.**

1. `7/28/26, 12:00 PM` is named verbatim at `capture-shortcut.md:55` as what
   Shortcuts emits when the custom format string is set on the `Current Date`
   *variable* instead of the **Format Date action**.
2. A correct ISO stamp reading `12:00:00` is the doc's other tell
   (`capture-shortcut.md:63-65`): the `Current Date` variable was inserted with
   the **Date component only**, truncating the time to noon.

User confirmed: *"our shortcut is set up correctly, it's just that the old stuff
from before is the wrong format because we were testing."* The four bullets are
leftover development junk. **No shortcut-side bug to chase, and no content worth
preserving in this particular data** — but the code paths that stranded it are
real and would strand a real capture.

## Rejected: widening `STAMP_RE` to locale-short

The handoff floats this as "the higher-leverage fix." Recommend against:

1. `7/8/26` is unresolvably ambiguous across locales; the line carries none.
2. The `12:00 PM` is noon-truncation, not the capture time — accepting it files a
   lie that *looks* successful.
3. The shipped recipe never emits this shape. Widening the parser to accept only
   what a *broken* shortcut produces permanently commits us to supporting it.

---

## KTDs

**KTD1 — a capture with content is never held for a bad stamp.** Reverses the
rule at `inbox.ts:61` ("held, never guessed at"). That rule assumed the user
could open the inbox and repair the line. Under the governing constraint they
cannot, so "never guess" degrades to "never arrives." The body is sacred
(non-negotiable #1); the stamp is only routing metadata. Approximate date beats
absent capture.

**KTD2 — inherit the date from the neighbor, not from today.** The inbox is
append-ordered, so a stampless capture sits between two stamped ones. It takes
the date of the **nearest preceding stamped capture**, falling back to today only
when none exists. Filing a three-day-old thought into today reads as a thought
you had today — wrong in a way that is hard to notice later.

**KTD3 — a bullet that is only a stamp is empty, not unreadable.** No guessing
required; it carries no content. Today it counts as work purely because
`parseStamp` demands trailing text and the body falls back to the raw stamp
string, which is non-empty. This is a false alarm, and fixing it is the one
change here that needs no design judgement at all.

**KTD4 — orphan column-0 lines are absorbed, not reported.** They are
continuations that lost their indentation. Under the governing constraint,
counting them only tells the user about a file they will not open.

---

## Units

### U1 — Bare-stamp bullets read as empty (KTD3)
`src/pipeline/inbox.ts` — a bullet whose entire body is a valid stamp with no
trailing text joins the existing `isEmptyCaptureText` skip path rather than
counting as `unparseable`. Test-first against the literal
`- 2026-07-28T12:00:00-04:00`.

Fold in the trailing-space twin while here: `- 2026-07-28T12:00:00-04:00 ` (note
the trailing space) already *parses* with `text === ""` and is caught only by
`pendingInboxCaptures`'s `isEmptyCaptureText` guard, not by the skip at
`inbox.ts:198`. Same guard, same test, negligible extra cost.

### U2 — Absorb orphan column-0 lines (KTD4, core of #177)
`src/pipeline/inbox.ts` + `test/inbox.test.ts`

A non-blank line that is not a bullet, not a continuation, and not the filed
marker folds into the preceding capture's body. **Anchor to lines after the first
top-level bullet** — not "the first parsed capture," which is ambiguous between
"first bullet" and "first bullet with a readable stamp" and is observable on the
live vault's leading junk bullets if U2 lands before U3. This keeps the note's own
template prose (lines 5–11) exempt; #177 calls that out and the live file proves
it matters.

**Reconcile with the marker path (do not skip).** Absorption extends `endLine`,
and `endLine` is what `appendFiledMarkers` splices against
(`lines.splice(c.endLine + 1, …)`, `inbox.ts:492`) and what
`inboxMarkerLineInRegion` scans from — and that scan currently *breaks* on
exactly the non-indented non-blank line being absorbed (`inbox.ts:106`). So:
absorb inside the capture's own extent loop, scanning forward from the bullet
**before** `inboxMarkerLineInRegion` runs, and **terminate absorption at the
filed marker**. A line after a marker starts a fresh region and never folds into
the already-filed capture above it — folding there would rewrite that capture's
`text` and therefore its `captureKey` (`inbox.ts:506`), changing the dedupe key
for something already written to a daily.

Tests: prose before the first bullet ignored; orphan after a bullet absorbed;
`bullet / marker / orphan` leaves the filed capture's `text` unchanged.

### U3 — Neighbor-inherited dates (KTD1, KTD2)
`src/pipeline/inbox.ts` + `test/inbox.test.ts`

A capture with body text but no readable stamp is filed rather than held. Six
mechanics, all decided here so the implementer invents nothing:

1. **Date = nearest preceding stamped capture → nearest *following* stamped
   capture → today.** The following-neighbor step is not optional: with a bare
   `else today`, a stampless capture with no preceding neighbor gets whatever day
   the drain happens to run, which breaks idempotency (non-negotiable #6). The
   re-file path is documented as expected, not exotic (`inbox.ts:630-635`), so a
   drain the next day would check a *different* daily, find nothing, and append
   the capture a second time. Preceding→following makes the date a pure function
   of note content in every case but an inbox with no readable stamp anywhere.
2. **Clamp the inherited date to today.** A stampless capture following a
   future-stamped one would otherwise inherit that future date, hit
   `FutureDailyNoteError` (`inbox.ts:611`), and be classified `held`
   (`inbox.ts:255`) — stranded, the exact outcome KTD1 exists to prevent. A phone
   running ahead of the vault's timezone produces future stamps routinely.
3. **`time` stays `null`, and the daily bullet carries no time prefix.**
   `drainInbox` currently calls `inboxDailyBulletLines(c.time!, c.text)` and
   `dailyHasCapture(dailyContent, c.time!, c.text)` behind non-null assertions
   (`inbox.ts:601-602`) that only held because `pendingInboxCaptures`
   (`inbox.ts:219`) filtered every unparseable capture out. Making them pending
   without deciding this ships a literal `- null buy milk` bullet — it compiles
   clean. So: emit `- body` when `time` is null, matching `parse.ts`'s
   already-optional `timestamp: string | null` (`parse.ts:52-58`). `dailyHasCapture`
   then dedupes on `timestamp === null && text === body`, still a correct key.
   **This doubles as the honesty tell** — a missing time reads as "we did not know
   when," and untimed bullets are already a normal daily shape.
4. **Strip the unreadable stamp out of the body.** At `inbox.ts:179` the body is
   `parsed ? parsed.text : bullet[1]!` — when the stamp does not parse, the
   *entire* bullet including the junk stamp becomes `text`. Since body is sacred
   (non-negotiable #1), `7/28/26, 12:00 PM buy milk` would carry that stamp
   verbatim into the daily *and* into the atom, permanently. When the leading
   token is stamp-shaped but unreadable, strip it before the body is built.
   Test-first: `- 7/28/26, 12:00 PM buy milk` → `text === "buy milk"`.
5. **Record the inferred date durably**, not just in memory — a `~`-style tell in
   the daily is covered by (3); the inbox line additionally carries an
   inferred-date marker so the guess is auditable in the plugin-owned file.
6. `unparseable` becomes reachable only for shapes with no content, which U1
   already routes to empty — so the state effectively retires. Update the
   `inbox.ts:61` doc comment to state KTD1 and why.

**Existing tests invert.** Six assertions in `test/inbox.test.ts` (~195-250,
~556-570) encode `unparseable === true` / `r.unparseable === 1` as correct. The
rewrite is larger than "add tests."

### U4 — Retire the dead-end *repair state*; point at the shortcut instead
`src/home/atomsHomeData.ts` + `src/home/atomsHomeView.ts` + `src/settings/settings.ts`
+ `src/settings/captureShortcut.ts` + `src/plugin/main.ts` + `src/pipeline/inbox.ts`
+ `styles.css` + `test/atomsHomeData.test.ts`

**Scope, precisely:** this unit retires the `needsRepair` **branch only**. The
`.atoms-home-inbox-stuck` card itself survives, and so do its `held`
("N held for a future day") and `pending` ("N waiting to file") sub-lines —
those are not dead ends and nothing else in this plan replaces them. Do not read
"retire the card" as deleting the card.

**Retire `unparseable` everywhere, not just on the card.** It has three other
surfaces the original unit missed, and leaving them yields a permanently-zero
counter plus orphaned CSS:

- The card branch: the `"N captures need a fix"` text, the `needsRepair` field on
  `InboxStuckSummary`, and the `.is-repair` rules at `styles.css:1819-1826`.
- The manual-drain toast: `src/plugin/main.ts:323` pushes `` `${r.unparseable} unreadable` ``
  into the "Atoms inbox: …" Notice.
- The contract: the `unparseable` field on `InboxDrainResult` (`inbox.ts:423`) and
  its doc comment still describing the state as "needs a human."

**The replacement signal — mechanism, decided.** The original unit named a
destination and no data path. Home reads
`inboxStuckSummary(inboxCounts(content, new Date()))` at `atomsHomeView.ts:664` —
**read-time note content, not the drain result** — so "a drain inferred a date"
has no channel unless the counts carry it. And "show it once" is unimplementable
from either source: the inbox is append-only and never cleaned, so a read-time
flag stays true forever, while a drain-result flag is true only during the pass
that files it. Therefore:

- Add **`inferredDates: number`** to `InboxCounts`, computed read-time in
  `inboxCounts` over captures carrying the inferred-date marker from U3 (filed
  *and* unfiled).
- Render it as a calm line on the surviving `.atoms-home-inbox-stuck` card whose
  CTA opens **Settings → Atoms**.
- Gate repeat display on a **device-local ack key** (mirroring
  `LS_INBOX_BOOKMARK_NOTICE_ACK` in `main.ts`) **keyed to
  `CAPTURE_SHORTCUT_VERSION`**, so it re-arms after the user updates the shortcut
  rather than staying dismissed forever against an append-only file.
- **Copy must name the repair, not the button.** Settings → Capture Atom cannot
  fix this: "Install or update Capture Atom" re-opens the user's *own* pasted
  iCloud link, reinstalling the same misconfiguration, and it is
  `setDisabled(!urlSet)` (`settings.ts:618`) — dead for anyone who built the
  shortcut by hand from the doc. So the line states the symptom and the fix
  inline ("your shortcut's Format Date action is emitting a non-ISO stamp — set
  the Format String on the *action*, not the Current Date variable") and links
  `docs/capture-shortcut.md` § traps. The install/update button stays a secondary
  action, shown only when a link exists. Copy through `voice-designer`.

**Detection gap, named rather than implied.** This signal fires on the
non-ISO-stamp trap only. The Date-component-only trap emits a *valid* ISO stamp
reading `12:00:00`, so no inheritance happens and nothing fires — those captures
land at noon forever, silently. The available tell is a run of captures all
stamped exactly `12:00:00`. Deferred, not solved here; U4's copy must not imply
it covers all shortcut misconfiguration.

### U5 — Spacing (independent, CSS only)
Both gaps confirmed in `styles.css`:

- **Header:** `.atoms-home-title` is `margin: 0` (`styles.css:42-43`) directly
  under `.atoms-home-header-top`, a `min-height: 40px` row of 44px icon buttons.
  Zero gap by construction. Give `.atoms-home-title` a **`margin-top: 8px`** —
  enough to unstick it from the 44px icon row without materially growing the
  header. (No comparable icon-row-to-heading pair exists elsewhere in
  `styles.css` to inherit a value from, so this unit names the number rather
  than leaving the implementer to pick one cold.)
- **Card stack:** `.atoms-ui-flat-card` (`styles.css:1547-1552`) carries **no
  margin**; every home card supplies its own ad-hoc bottom margin
  (`.atoms-home-wait-card` 16px, `.atoms-home-resurface-card` 18px,
  `.atoms-home-also-about` 14px). `.atoms-home-inbox-stuck` is the one card that
  never got one — that is precisely why it fuses with "Also about Nichita".
  Whatever card survives U4 gets a margin matching the 14–16px rhythm.

**Deliberately not refactoring** the stack to own its rhythm
(`.atoms-home-scroll > * + *`). That is the correct long-term shape and would
kill this whole class of "one card forgot its margin" bug, but it touches ~10
card classes and the standing rule is that a shared substrate does not get
unified without snapshot coverage in the same change. Follow-up.

### U6 — Version bump
`manifest.json` + `package.json` → **0.6.52** (user-visible), and `versions.json`
gains a new `"0.6.52": "1.11.4"` row (matching the current 0.6.51 entry's minimum
app version) — not just a bumped string.

---

## Upgrade behavior — MUST be called out before anyone installs 0.6.52

U3 makes previously-unparseable captures **pending**, so the **first drain after
upgrading files every stuck capture that is currently sitting in the inbox** into
a real daily, where the pipeline then classifies it into an atom.

On the user's live vault that means the four leftover development bullets
(`Test capture`, `Test again`, `New test`, `Test`) get filed and classified. It is
not reversible without hand-deleting atoms and daily lines.

**Mitigation, and it is the user's action, not an agent's:** clear those four
bullets from `Atoms System/Inbox.md` — or append a `<!--atoms:filed-->` line under
each — *before* installing the build. This belongs in the PR body and the release
note, not only here. Agents do not touch Remote Vault (`CLAUDE.md` vault lanes).

---

## Deferred and rejected (explicitly)

| Item | Why |
|---|---|
| [**#190**](https://github.com/taihartman/obsidian-atoms/issues/190) — substantive captures classified `noise` | Filed this session with live evidence (`Quick Notes/2026-07-28.md:14-15`). User: "file it, fix it later." Highest stakes of anything here; needs a real fixture set before touching the classify prompt. |
| #177's linker-sentinel continuation divergence | Changes `isContinuationLine` semantics with blast radius into `parse.ts`, the correctness core. Own PR. |
| #177's `pending` copy when Daily Notes is disabled | Different failure mode — a hard error worded as self-healing. Related to the user's "1 waiting to file" confusion; worth its own pass. |
| Home card stack vertical-rhythm refactor | Shared substrate; needs snapshot coverage in the same change. |
| Widening `STAMP_RE` | Rejected outright — see above. |

---

## Risks accepted, not resolved

Raised by the doc-review, deliberately not acted on. Recorded so the next session
does not re-derive them.

- **The reversal rests on a hypothetical.** The only observed stuck captures are
  junk, the shortcut is confirmed correct, and no real capture has ever been
  stranded. Holding is recoverable forever; a filed guess is quietly absorbed and
  never revisited. Accepted: KTD1/KTD2 are user-settled, and the mitigations in
  U3 (no fabricated time, stamp stripped, durable inferred marker) make the guess
  auditable rather than invisible.
- **Neighbor ordering assumes append order.** Obsidian Sync can interleave lines
  from two devices, so a capture could inherit a neighbor it was never temporally
  adjacent to. Blast radius is a day or two of error.
- **The inbox stops carrying a health signal.** Once it only ever holds captures
  the plugin can file, future capture-path failures must be discovered elsewhere.
  No replacement named long-term.
- **`unparseable` may want deleting outright** rather than surviving as a
  permanently-false compatibility flag — check the Ask mirror and other consumers
  during implementation.
- **Open question for later:** should the inferred-date flag reach the classify
  prompt, so the model does not reason about a fabricated date as real?

## Claim (required before implementation)

Done. Issue [#191](https://github.com/taihartman/obsidian-atoms/issues/191)
covers U1/U3/U4/U5/U6; [#177](https://github.com/taihartman/obsidian-atoms/issues/177)
covers U2 (partially — its two other honesty gaps stay open, so the PR closes
#191 and references #177 rather than closing it). STATUS.md row added.
Remaining: draft PR before implementation.

## Shipping tail

`ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa`
(incl. `adversarial-qa`) → PR with `Closes #<issue>`, real Test-plan checkboxes,
and vault screenshots under
`docs/qa/screenshots/inbox-stuck-card-home-spacing/` linked with absolute
`raw.githubusercontent.com` URLs.

QA runs against `test_vault/` only. The user's Remote Vault stays read-only for
agents; the four stuck captures there are theirs to clear.
