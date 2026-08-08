# World-class QA — #371 / #374 Ask mirror consent truth

- **Branch:** `fix/371-374-mirror-consent-truth`
- **Worktree:** `/Users/a515138832/StudioProjects/obsidian_plugin-371-374-mirror-consent-truth`
- **Version under test:** `0.6.88` (read live from `Settings → Atoms`, not from `manifest.json`)
- **Date:** 2026-08-08
- **Vault lane:** throwaway QA vault only — `test_vault/test vault`. No personal / Remote Vault was
  opened, read, or written at any point in this run.
- **App:** Obsidian 1.13.4, installer 1.12.7, driven through `/opt/homebrew/bin/obsidian` CLI at
  phone width (390×844, `document.body.classList.contains("is-phone") === true`).

## How this was driven, and why that is legitimate

The claim under test is **what the settings surface says for a given consent state**. So the method
is: seed the device-local state and plugin settings directly with `obsidian eval`, re-render the
Settings tab, and read the **actually rendered** strings and CSS classes back out of the live DOM.
Nothing here is asserted from source; every string below was lifted from `textContent` of a real
rendered element in a running Obsidian.

Two things were *not* faked and are worth calling out:

1. **The wipe path ran for real.** A throwaway HTTP stub on `127.0.0.1:8799` (returning `200 {ok:true}`
   with permissive CORS) was set as `Plus service URL override`, so `Wipe` actually issued
   `POST /v1/ask/mirror/wipe` and then took the real success branch — the one that persists the
   disarm. This is what makes the #371 verdict a live verdict rather than a code read.
2. **The #371 regression itself was reproduced end-to-end**: wipe → `plugin:reload` → count the
   upload requests the stub received. Zero.

A device-local Plus session (`atoms-plus-session`) was seeded so the Connect destination renders.
It is a fabricated token against a local stub; see *Not reachable* for what that costs.

---

## Core stories

### S0 — Version reads 0.6.88 in Settings → Atoms — **PASS**

Rendered prose, first line of the Atoms tab:

> `Version 0.6.88 · Capture with your shortcut; Process turns past bullets into linked atoms.`

Tree was clean before and after `./scripts/install-to-vault.sh` (`git status --short` empty both
times), so the build that produced this line is the branch build with no stray edits.

### S1–S5 — the five consent states, exact strings — **PASS (5/5)**

For every row below: `entryDesc` is the main screen's `Connect Claude or ChatGPT` row description,
`destLine` is the prose at the top of the Connect destination. **They were byte-identical in all
five states** (asserted in-page with `prose.textContent.trim() === entryDesc`), which is story 3.

| # | State seeded | Rendered line (both surfaces) | `atoms-ask-mirror-error` |
|---|---|---|---|
| S1 | gate open, `last-error = "HTTP 500 upstream unavailable"` | `Ask mirror: 407 · as qa@tryatoms.test · push failed — HTTP 500 upstream unavailable · Sync now to retry` | **present** (correct) |
| S2 | ack stamp + version cleared, toggle still on, error still on record | `Ask mirror: off · no current privacy acknowledgment · 407 in the cloud at last check, Wipe cloud copy to delete` | absent |
| S3 | `askPrivacyAckVersion = "2026-08-06"` (stale) | `Ask mirror: off · privacy acknowledgment out of date, Review to resume · 407 in the cloud at last check, Wipe cloud copy to delete` | absent |
| S4 | `askEnabled = false`, ack current | `Ask mirror: off · 407 in the cloud at last check, Wipe cloud copy to delete` | absent |
| S5a | toggle off, server count **cleared** (`""`) | `Ask mirror: off` | absent |
| S5b | toggle off, server count **recorded zero** (`"0"`) | `Ask mirror: off` | absent |

Every expected string matched **exactly**, including the middle dots, the em dash in the error arm,
and the absence of a cloud clause when the count is cleared or zero.

The S2 row is the one that carries the #374 fix's weight: the toggle was still `true` and a push
error was still on record, and the line still refused to claim a running mirror. Before the fix that
state printed a count, an identity, a push failure and a retry call-to-action — four true-looking
facts about a mirror that is not running.

### S3-b — the way back out survives a stale ack — **PASS**

In the S3 render the `What Ask stores and shares` row was still present on the main screen, with its
`Review` button, described as:

> `Acknowledged 2026-08-06, against different wording`

So a device whose ack went stale can still see the record and still withdraw or re-grant it. The
status line's `Review to resume` names a control that is genuinely on screen.

### S4-story — wipe confirm modal copy — **PASS**

Modal title: `Wipe cloud copy?` — buttons `Cancel`, `Wipe`. Body, read from the live DOM:

> `Wipe cloud atom mirror, pending Ask writes, and revoke Ask connector access (Claude + ChatGPT)? Local vault files are kept. Ask mirror turns off, so nothing uploads again until you turn it back on.`

The new final sentence is present verbatim.

### S6 — #371: the wipe actually disarms, and the disarm sticks — **PASS**

Armed the mirror (`askEnabled = true`, current ack, `server-count = 407`, a non-empty hash baseline),
pointed `plusBaseUrl` at the local stub, and ran `Wipe → Wipe`.

Immediately after (`obsidian eval`, live objects):

```
askEnabled : false
ackAt      : 2026-08-07T10:00:00.000Z   (acks left standing — the way back out survives)
ackVer     : 2026-08-07
count      : null                        (cleared, not zeroed)
hashes     : {}
```

`data.json` on disk read `"askEnabled": false` — the disarm was persisted, not merely held in memory.

Success Notice, captured from the live `.notice` element:

> `Ask mirror wiped and turned off`

Re-rendered status line after the wipe: `Ask mirror: off` — no cloud clause, because the count was
cleared rather than set to zero. Correct: an absence must not be rendered as a sentence about atoms
that are still there.

### S7 — #371 regression: post-wipe reload does not re-upload — **PASS**

This is the actual bug (`a bare plugin reload put all 407 rows back in four seconds`).

- Stub request log immediately before: 17 lines (the last being the wipe `POST`).
- `obsidian plugin:reload id=atoms`, then waited 12s.
- Stub request log after: **17 lines. Zero new requests.** No `OPTIONS`/`POST /v1/ask/mirror/upsert`,
  no `GET /v1/ask/mirror/status`.

For contrast, the same stub *did* receive four `POST /v1/ask/mirror/upsert` batches plus a status
`GET` moments earlier, while the mirror was armed — so the stub was demonstrably reachable and the
upload path demonstrably live. The silence after the wipe is the gate holding, not a broken stub.

---

## Adversarial ledger

Every case below was seeded into the live plugin and rendered. The question asked of each: **does the
sentence ever throw, print `undefined`/`NaN`, or claim a mirror is on when the gate is shut?**

| # | Attack | Result | Verdict |
|---|---|---|---|
| A1 | `askPrivacyAckAt = true` (boolean, hand-edited `data.json` shape) | `Ask mirror: off · no current privacy acknowledgment · 407 in the cloud at last check, Wipe cloud copy to delete`; no throw; ack row still rendered with `Review`, described `Acknowledged` (no date) | **Held** |
| A2 | `askPrivacyAckAt = "yes"` | identical to A1 — gate shut, no throw, `Review` still reachable | **Held** |
| A3 | `askPrivacyAckAt = ""` with `askPrivacyAckVersion` **current** (the orphaned-version state a not-yet-upgraded phone can sync in) | gate shut (`no current privacy acknowledgment`); ack row correctly absent — there is no record to withdraw, and the re-enable path will re-raise the sheet | **Held** |
| A4 | `askPrivacyAckVersion = "2099-01-01"` — **newer** than the build ships | read as **stale**: `privacy acknowledgment out of date, Review to resume`. A future stamp is a downgrade, not consent to what is on screen | **Held** |
| A5b | non-numeric server count `"banana"`, gate **shut** | `Ask mirror: off` — the cloud clause is correctly suppressed (`Number.isInteger && > 0`), no `NaN` | **Held** |
| A5c | server count `"-5"`, gate shut | `Ask mirror: off` — no clause | **Held** |
| A5d | server count `"3.7"`, gate shut | `Ask mirror: off` — no clause (non-integer rejected) | **Held** |
| A5e | server count `"1e309"` (parses to `Infinity`), gate shut | `Ask mirror: off` — no clause | **Held** |
| A5a | non-numeric server count `"banana"`, gate **open** | `Ask mirror: banana · as qa@tryatoms.test · last pushed never` — see F1 below | **Cosmetic leak, not a gate failure** |
| A6 | stored mirror email empty, gate open | falls back to the session email — `Ask mirror: 407 · as qa@tryatoms.test · last pushed never`; no `undefined` | **Held** |
| A7 | refusal record on file **and** gate shut | `Ask mirror: off · 407 in the cloud at last check, Wipe cloud copy to delete` — the gated arm outranks the refusal arm, so a shut gate is never described as a sync that refused, and no error class | **Held** |
| A8 | refusal record on file, gate open | `Ask mirror: 407 · as qa@tryatoms.test · sync refused — vault scan incomplete · Sync now to retry`, error class present | **Held** |
| A9 | `Review` → `Withdraw acknowledgment` | see below | **Held** |
| A10 | toggle off → on through the live control | see below | **Held** |
| A11 | gate shut (`ackAt` and version cleared) but `askEnabled` left **true**, baseline cleared, then `syncAskMirror({ force: true })` | **zero** requests reached the stub — see below | **Held** |
| A12 | same state — does any *control* still claim the mirror is on? | the `Ask mirror` toggle renders **off**, by design | **Held** |

### A9 — withdrawal changes the sentence in the same render

Driven through the real UI: `What Ask stores and shares` → `Review` → the sheet opened in withdraw
shape (buttons `Close`, `Withdraw acknowledgment`) → `Withdraw acknowledgment`.

Read back **without closing or reopening the Settings tab**:

| | value |
|---|---|
| line before | `Ask mirror: 407 · as qa@tryatoms.test · last pushed never` |
| line after | `Ask mirror: off · no current privacy acknowledgment · 407 in the cloud at last check, Wipe cloud copy to delete` |
| `askEnabled` | `true` → `false` |
| `askPrivacyAckAt` / `askPrivacyAckVersion` | both cleared |
| `askWriteAckAt` | cleared — the narrower write ack does not outlive the one it sits on |
| consent row | correctly gone (no record left to withdraw) |

`redisplay()` runs before the `saveSettings()` await, so there is no window in which the old sentence
is on screen next to a withdrawn consent.

### A10 — the sentence tracks the toggle

Clicking the live `Ask mirror` toggle, not seeding the field:

- **off:** line became `Ask mirror: off`, `askEnabled === false`, same render, no reload.
- **on:** ack was current so no consent sheet was posed (correct — `askPrivacyAckIsCurrent` short-circuits);
  line became `Ask mirror: 407 · as qa@tryatoms.test · last pushed never`, `askEnabled === true`.

One thing that looked like a bug and was not: the first toggle-off printed `Ask mirror: off` with **no**
cloud clause despite a seeded count of 407. The cause is my own stub — while the mirror was armed it
answered `/v1/ask/mirror/status` with `count: 0`, and `saveAskMirrorStatus` correctly overwrote the
seeded value. A recorded zero earns no clause (S5b). Resetting the count to 407 restored the clause.

### A11 — the egress agrees with the sentence, not just the wording

The sharper version of #374: it is not enough that the line *says* off, the mirror must actually not
push. Gate shut (`askPrivacyAckAt` and version cleared) with the toggle deliberately left **on** and
the hash baseline cleared — the exact precondition for a full re-upload — then a **forced** sync:

- stub request log before: 35 lines
- `syncAskMirror({ force: true })`, waited 8s
- stub request log after: **35 lines. Zero requests.**

Force did not buy a way past the consent gate.

### A12 — the *toggle* tells the truth too, not just the sentence

Noticed while composing the A11 screenshot and worth recording, because it is the same thesis one
control over. With `askEnabled === true` stored but the ack cleared, the `Ask mirror` **switch renders
off**:

```
p.settings.askEnabled  : true
p.settings.askPrivacyAckAt : ""
rendered toggle        : OFF
```

By design — `tog.setValue(this.plugin.settings.askEnabled && ack)` (`src/settings/settings.ts:2255`),
with a comment making the same argument #374 makes about the sentence: a switch that still showed on
would report a push that is not happening. So under a shut gate the status line, the toggle, and the
actual egress all agree. There is no surface left that claims the mirror is running.

This did require renaming a screenshot: the frame is `09-gate-shut-toggle-reads-off.png`, not
"toggle on", because the toggle does not read on — which is the correct behavior and the more
interesting fact.

---

## Findings

### F1 (low, pre-existing, not introduced by this branch) — a corrupt server count renders verbatim in the **on** arm

With the gate **open**, a hand-edited or corrupted `atoms-ask-mirror-server-count-v1` prints straight
through: `Ask mirror: banana · as … · last pushed never`.

`formatAskMirrorServerCount` (`src/platform/askMirror.ts:606`) returns `String(raw)` for any non-empty
value and only the **off** arm applies the `Number.isInteger(n) && n > 0` guard
(`src/platform/askMirror.ts:666`). So the arm this branch hardened is safe and the older arm is not.

Severity is low and this is **out of scope for #371/#374**: the value is device-local, only a hand
edit or a corrupted write produces it, it does not affect the gate, and it cannot claim a mirror is
on when it is off. Noted so it is not rediscovered as a regression later.

### Observation — the main-screen entry row never carries the error class

`destinationRow` renders the status line as a plain description, so on the main screen a push
failure is worded but not styled red; only the destination's prose gets
`atoms-ask-mirror-error`. This matches the spec as written (the requirement is that **no off-state**
line carries the class) and matches previously shipped behavior. Not a defect — recorded so the
asymmetry is deliberate rather than discovered.

### Observation — a garbage ack stamp renders `Acknowledged` with no date

By design (`renderAckRecord`, `src/settings/settings.ts:572` — `ackStampIsReal` guards the
`.slice(0, 10)` that would otherwise throw on a hand-edited `true`). The row degrades to a dateless
label rather than taking the whole settings tab down. Correct trade; the withdrawal path survives,
which is the property that matters.

---

## What I could NOT reach, and why

Reported as **blocked**, not as passing.

1. **No real Atoms Plus session.** The session was a fabricated device-local token
   (`atoms-plus-session`). Everything gated on server-side entitlement — real `status`/`remaining`
   values, a real session that the server would honor, expiry/invalid-session handling — was not
   exercised. It does not affect the verdicts above, all of which are client-side rendering off
   device-local state, but it does mean **no claim is made here about server behavior**.
2. **No live Plus service.** The wipe ran against a permissive local stub that answers `200 {ok:true}`
   to everything. So: the wipe *client* path is proven (request issued, success branch taken, disarm
   persisted, device state cleared, Notice shown, no re-upload after reload). The wipe *server* path
   — that mirrored atoms, the outbox, and connector tokens are actually deleted and tokens actually
   revoked — is **not** proven by this run.
3. **Wipe failure branch not driven.** The stub always succeeds, so the `if (!r.ok)` branch (Notice
   `Ask: <message>`, **no** disarm, baseline untouched) was read in source but not executed. The
   ordering argument in the code — a crash inside the save leaves an armed mirror with an *intact*
   baseline — is therefore reasoned, not measured.
4. **Real Claude / ChatGPT connector pairing** was not attempted (needs a real account and a real
   service). `MCP connector URL` / `Link Claude / ChatGPT` were rendered but not used.
5. **Desktop-width settings** were not screenshotted — on desktop the tab opens in a popout window
   `dev:screenshot` cannot see. All frames are phone width, per the navigation map.
6. **No cross-device sync scenario.** The orphaned-version case (A3) was simulated by editing the
   fields directly rather than by actually syncing from a not-yet-upgraded phone.
7. **`data.json` was edited through the live plugin object, not on disk.** Cases A1–A4 set
   `plugin.settings.*` to the malformed values a hand edit would produce and then saved, rather than
   writing a corrupt `data.json` and restarting. The predicates under test read `plugin.settings`, so
   the values they saw are the values a corrupt file would have produced — but the *load* path
   (`applyLoadedSettings`, `coerceAskAckFields`) was only exercised incidentally, on the reload in S7,
   and not against deliberately malformed input.
8. **The wipe Notice has no screenshot.** It is a transient toast, and under the settle-and-confirm
   protocol described in F2 it could not be captured without risking a lagged frame. The evidence for
   `Ask mirror wiped and turned off` is the `.notice` `textContent` read quoted in S6 — a DOM read, not
   an image. No frame was committed for it rather than committing one I could not verify.

### F2 (QA tooling, important) — `dev:screenshot` returns the *previous* frame, and it silently produced a whole set of mislabeled evidence

This is the most useful thing this run found, and it is about the QA method rather than the branch.

The first pass of screenshots looked fine by filename and contained two byte-identical pairs. Probing
the command — three consecutive captures at one fixed state — showed it is perfectly deterministic
(identical bytes every time), so it is not returning noise. It returns the frame from **before** the
most recent re-render composited.

Because every capture in that pass was taken immediately after the `eval` that changed the state, the
entire set came out **shifted by one**: each file showed the state before the one its name claimed.
Verified by having a separate agent read the images and transcribe them — `02-no-ack.png` actually
rendered the *push-failed* line, `07-wipe-confirm-copy.png` contained **no confirm dialog at all**, and
the lead frame `01-gate-open-push-failed.png` was not Settings at all but an empty `New tab` workspace,
about 75% blank.

Had that set been committed as-is, the PR would have carried a full set of screenshots that all looked
plausible and none of which proved what they asserted. **A single `dev:screenshot` taken after a state
change is not evidence.**

Every screenshot in this report was therefore re-taken under a **settle-and-confirm protocol**: for each
state, capture twice a few seconds apart and keep the frame only if the two captures are byte-identical,
retrying up to four times otherwise. Two of the resulting hashes independently corroborate the new
labeling against the transcribed contents above.

Recommended follow-up: fold this into `docs/qa/app-navigation-map.md` beside the existing
`dev:screenshot` notes, since the current guidance covers the vault-relative path and the missing-`mkdir`
`ENOENT` but not this, which is the failure that actually produces wrong evidence quietly.

### A note on process hygiene

Two `obsidian eval` CLI invocations wedged mid-run (the CLI process hung; the app itself stayed
responsive and answered a fresh `eval` immediately). They were killed and the affected cases — A5d,
A5e, A6, A7, A8 — were re-run individually. Every result in this document comes from an invocation
that returned. Nothing here is inferred from a case that did not complete.

## Evidence

Screenshots (phone width, 390×844), committed under
`docs/qa/screenshots/371-374-mirror-consent-truth/`:

All ten frames have **distinct** hashes, and every one was **read back and transcribed by a separate
agent** before being committed — because of F2 below, a filename is not evidence in this repo.

| File | Shows | Verified |
|---|---|---|
| `01-gate-open-push-failed.png` | S1 — push error, line rendered **red** | transcribed, matches |
| `02-no-ack.png` | S2 — `no current privacy acknowledgment`, grey not red | transcribed, matches |
| `03-stale-ack-destination.png` | S3 — `privacy acknowledgment out of date, Review to resume` | transcribed, matches |
| `04-stale-ack-main-review-row.png` | S3-b — main screen: `What Ask stores and shares` + `Acknowledged 2026-08-06, against different wording` + `Review` | transcribed, matches |
| `05-toggle-off-ack-current.png` | S4 — toggle off, ack current | transcribed, matches |
| `06-off-no-count.png` | S5 — `Ask mirror: off`, nothing after it | transcribed, matches |
| `07-wipe-confirm-copy.png` | S4-story — the confirm dialog, new final sentence, `Cancel` / red `Wipe` | transcribed, matches |
| `08-after-wipe-off-no-count.png` | S6 — the genuine post-wipe frame | transcribed, matches |
| `09-gate-shut-toggle-reads-off.png` | A11/A12 — main screen, `Ask mirror` toggle reads **off** under a shut gate | matches; see caveat |
| `10-after-withdraw-same-render.png` | A9 — after `Withdraw acknowledgment`; the `What Ask stores and shares` row is **confirmed absent** | transcribed, matches |

Notes a careful reader will spot in the frames, all expected:

- `08` shows the MCP URL as `http://127.0.0.1:8799/mcp` while its siblings show
  `https://plus.tryatoms.app/mcp`. That is the point: `08` is the frame from the run where the wipe
  actually executed against the local stub. The differing URL is provenance, not contamination.
- `07`'s dimmed background line reads `last pushed never` rather than the push-failure state in `01`,
  because the wipe was driven from a freshly armed state rather than from the S1 state.
- `09` has the `Ask mirror` row's description partly occluded by the floating modal header. The toggle
  itself is legibly off and the `Connect Claude or ChatGPT` line is fully readable, so the claim stands,
  but it is the weakest frame in the set. `10` shows the same row unoccluded.
- There is **no screenshot of the wipe Notice.** It is a transient toast and could not be captured under
  the settle-and-confirm protocol below without risking a lagged frame. The evidence for
  `Ask mirror wiped and turned off` is the `.notice` `textContent` read quoted in S6 — a DOM read, not
  an image. Said plainly rather than shipping a frame I could not verify.

Unit tests re-run on the branch (via `npx vitest run`, never `npm test` — see issue #343):
`test/askMirrorConsentTruth.test.ts` (10), `test/askMirror.test.ts` (52),
`test/askConsentVersion.test.ts` (36) — **98 passed, 0 failed.**

## Verdict

**Merge-ready for #371 and #374 on the client side.** Both fixes do what they claim, proven against a
running Obsidian rather than against source. The one finding (F1) is pre-existing, low severity, and
outside the scope of this branch. The gaps above are all server-side or account-side and none of them
undermine the consent-truth claims that this branch is about.
