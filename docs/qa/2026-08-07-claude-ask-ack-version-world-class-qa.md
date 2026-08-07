# World-class QA — `claude/ask-ack-version` (#360 / PR #361)

**Verdict: Ready to merge.** Six proven adversarial holes were found and all six are fixed with
regression tests. Craft failed on three findings: two are pre-existing Obsidian chrome (filed, not
blocking) and the third — a stale ack being visually quiet — is a **user-deferred** product gap
with a follow-up filed.

Build under test: `atoms` **0.6.86**, live on `test vault`, Obsidian 1.13.4 (installer 1.12.7).
Suite at sign-off: **1397 passed / 81 files**, `tsc --noEmit` clean.

---

## Charter

Two Ask consent acknowledgments (`askPrivacyAckAt`, `askWriteAckAt`) previously recorded *when* the
user agreed and never *what* to; every gate read `Boolean(timestamp)`. Each now carries a version,
and a consent is live only when the timestamp is a real moment **and** the version equals the
shipped constant.

Workflows that must work: the upgrade re-prompt, grant, withdraw, and the mixed-version states a
synced vault produces. Adjacent regression risk: the egress ack shares the record-row component,
and the mirror/outbox gates share the predicates.

**Authority for acceptance:** on-screen disclosure copy and row descriptions; the shipped
`EGRESS_ACK_VERSION` contract in `src/platform/autorun.ts`; CLAUDE.md non-negotiables #6
(nothing destroyed) and #12 (Ask mirror shape); issue #360. Handler bodies were used to *exercise*,
never to author acceptance.

## Preflight

| Check | Result |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Authority paths | ✅ named above |
| Navigation map | ✅ followed; 🔧 **2 rows healed** (see Findings N1/N2) |
| Dev/run command | ✅ `./scripts/install-to-vault.sh "<test vault>"` |
| Viewport/device | ✅ phone 390×844 — desktop Settings is a popout `dev:screenshot` cannot capture |
| Auth path | ➕ no Plus-session fixture existed; seeded one and **added it to the catalog** |
| Fixtures | ✅ catalog read before driving; none fitted; new one contributed |
| Mockup | N/A — no design handoff for this surface |
| Automation | vitest ✅ · Obsidian CLI ✅ · Playwright N/A (not a web surface) |
| Deploy reality | N/A — plugin-only; no server component. `ASK_EXPAND_ENABLED` stays `"0"` |
| Device lock | N/A — no shared physical device |

## Product loop vs fixture

Stated up front because two of these states **cannot** be produced by this build's product — they
are what a *previous* build or *another device* wrote.

| Story | Proof kind |
|---|---|
| A — legacy grant reads as stale | `fixture-plumbing` (a pre-#360 device's record) |
| B — re-prompt and stamp | **`user-loop`** — real sheet, real tap |
| C — orphaned version gate | `fixture-plumbing` (an older device's withdrawal) |
| D — withdraw clears both acks | **`user-loop`** — real Review row, real withdraw |
| E — write-ack staleness | `fixture-plumbing` |

No hub, graph, or pre-linked record was planted to force a green screenshot. The fixture states are
labeled as such and are not offered as day-one product proof.

## Authority & promises

| Surface / CTA | Promise (source) | Acceptance | Story |
|---|---|---|---|
| `Ask mirror` toggle | `EGRESS_ACK_VERSION` doc-comment: *"Acked against the disclosure this build actually shows. Anything else is not consent."* | A stale or absent grant renders the toggle **off** and re-poses the sheet on enable | A, B, C |
| Consent sheet | `ASK_PRIVACY_DISCLOSURE` six clauses (on-screen copy) | Sheet shows that exact text; accept stamps both halves | B |
| `What Ask stores and shares` row | On-screen `Acknowledged <date>` | Renders whenever a real timestamp is on record, current or not; `Review` withdraws | A, D |
| Row staleness suffix | On-screen copy, mirroring the egress row's distinction | `, against earlier wording` (legacy) vs `, against different wording` (unrecognised stamp) | A, E |
| `Allow filing from Claude or ChatGPT` | CLAUDE.md #12 + sheet copy | Off unless privacy **and** write acks are both current | E |

No spec/copy conflicts found.

## User stories

```
A. As a user upgrading from a build that predates versioned acks, I want Ask to stop pushing until
   I have read the current disclosure, so that I never consent to text I have not seen.
   Acceptance: Ask mirror renders OFF despite askEnabled:true; the record row says
     "Acknowledged 2026-08-01, against earlier wording".
   Evidence: screenshots/claude-ask-ack-version/A-legacy-grant.png
   Status: Passed.

B. As that same user, I want turning Ask back on to show me the disclosure again, so that my new
   consent is to the words on screen.
   Acceptance: the sheet re-poses with the six-clause text; accepting writes version 2026-08-06 and
     a fresh timestamp; the row loses its staleness suffix.
   Evidence: B-sheet-reposed.png, B-after-accept.png. Observed: askPrivacyAckVersion "2026-08-06",
     askPrivacyAckAt "2026-08-07T14:58:13.476Z" (≠ the 2026-08-01 it replaced).
   Status: Passed (user loop).

C. As a user who withdrew Ask on my phone, I want my desktop to honour that withdrawal even though
   the phone is on an older build, so that a withdrawn consent cannot silently keep spending.
   Acceptance: with askPrivacyAckAt:"" and a current version, mirrorPermitted() is false, no record
     row renders, and tapping the toggle re-poses the sheet rather than enabling.
   Evidence: C-orphan-version.png. Observed mirrorPermitted() === false; sheet appeared.
   Status: Passed. (This is the P0 four independent reviewers found.)

D. As a user withdrawing the Ask privacy acknowledgment, I want the vault-write consent to die with
   it, so that the narrower permission cannot outlive the broader one.
   Acceptance: all four ack fields empty and askEnabled false from one gesture.
   Evidence: D-after-withdraw.png. Observed all four "" and askEnabled false.
   Status: Passed (user loop).

E. As a user whose vault-write disclosure has been reworded, I want filing from Claude to stop until
   I re-read it, so that files are never created under superseded terms.
   Acceptance: the toggle renders off; the row names which wording it holds.
   Evidence: E-write-ack-stale.png. Observed "against earlier wording" then "against different
     wording" on a mismatched stamp.
   Status: Passed.
```

## Risk matrix

| Risk | Covered by |
|---|---|
| Happy — grant stamps both halves | B (live) + `askConsentVersion.test.ts` |
| Negative — decline writes nothing | `askConsentVersion.test.ts` |
| Edge — legacy / mismatched / orphaned / degenerate values | A, C, E (live) + `askAckAdversarial.test.ts` |
| Regression — egress ack + record row shared component | full suite; `egressConsentParity.test.ts` green |
| Perception — staleness suffix copy | A, E (live) |
| Promise — toggle state vs actual gate | A, C (toggle off ⇔ `mirrorPermitted()` false) |

## Evidence

| Kind | Path / result |
|---|---|
| Live screenshots | `docs/qa/screenshots/claude-ask-ack-version/{A,B,C,D,E}-*.png`, `adv-s3*.png`, `adv-s4-*.png` |
| Suite | `npx vitest run` → 1397 passed / 81 files |
| Typecheck | `npx tsc --noEmit` clean |
| Build | `npm run build` clean |
| Craft | **Failed** — see Findings C1–C3 |

## Findings

### Adversarial (all six fixed, each with a regression test)

| Sev | Hole | Fix |
|---|---|---|
| P1 | Write ack outlived a privacy ack that went **stale** (not withdrawn). Enforced at one call site only, so the next `ASK_PRIVACY_ACK_VERSION` bump would leave every device with a current write ack; re-accepting privacy reopened filing with no write sheet re-posed | `settleAckRecords()` at the settings boundary and before the privacy re-grant |
| P1 | An in-flight outbox pass kept creating vault files after the write ack was withdrawn — one entry check, then ten round trips | `writePermitted()` on `AskOutboxHost`, asked live before every item, mirroring the second gate `runSyncOnce` has carried since #323 |
| P2 | A non-string timestamp (`true`, `{}`) read as live consent **and** threw in `renderAckRecord` — taking out the Ask *and* egress withdrawal rows | `ackStampIsReal()`; a consent's *when* must parse as a time |
| P2 | A non-string version threw inside the predicate itself | `typeof` guard in `askAckIsCurrent` / `askAckStanding` |
| P3 | `{}` or `[]` from a mid-write `data.json` crossed the blank-file guard and reset every setting | reject array and keyless objects |
| P4 | Write sheet's verdict handler never re-checked the privacy precondition | re-check at the moment of grant |

### Craft — Failed

- **C1 (pre-existing, filed)** — the translucent settings header has no opaque backing, so scrolled
  rows read through it. Stock Obsidian chrome, not introduced here.
- **C2 (pre-existing, filed)** — `Review` renders as a full-bleed CTA-purple button while the
  toggles that actually grant consent are quiet 52×30 switches: the loudest control on screen is
  the audit trail, not the decision.
- **C3 (introduced, user-deferred)** — a stale record card is pixel-identical to a current one but
  for a trailing gray clause, and nothing ties the OFF toggle to the stale ack that caused it. Ask
  goes dark on upgrade and the screen does not say why. **Owner deferred** on 2026-08-07: keep the
  quiet clause for consistency with the egress ack, ship, and file the UI beat as a follow-up.

Passes: no horizontal overflow (scrollWidth 390 = viewport); consistent 8px gutters and ~16px
interior padding; `Review` hits 44pt exactly; the staleness sentence is well-voiced and honest
about *earlier* vs *different*.

### Navigation-map drift (healed in this PR)

- **N1** — `close(); open(); openTabById()` in one `eval` leaves Settings closed; the close settles
  after the open. Needs two separate calls ~1s apart.
- **N2** — `dev:screenshot path=` does not create intermediate directories; it fails with a bare
  `ENOENT`. `mkdir` first.

### Incidental (not this diff — follow-up filed)

The Connect destination renders a *previous* session's cached status line (count, email, last
error) after the session is swapped.

## Adversarial ledger

| # | Scenario | Result |
|---|---|---|
| 1 | Sheet outlives an external withdrawal, then Accept | solid — both tab and whole-plugin paths |
| 2 | Write sheet accepted after privacy withdrawn beneath it | **holed** → P1 (fixed) |
| 3 | Double-tap accept / double-tap toggle | solid (unit + live) |
| 4 | `Review` on a row already withdrawn | solid — rows and detached nodes both gone |
| 5 | Withdraw mid-`saveSettings` / mid-outbox | **holed** on the outbox half → P1 (fixed); save half solid |
| 6 | 60-second outbox interval under an orphaned write version | solid — drove the real `registerInterval` under fake timers |
| 7 | Write-only skew on the F2 race path | solid — `revokePaired` clears it, privacy untouched |
| 8 | `askEnabled` off while both halves current | solid — no re-prompt, mirror resumes |
| 9 | Degenerate `data.json` values | **holed** ×2 → P2 (fixed) |
| 10 | Blank / truncated `data.json` | **holed** → P3 (fixed) |

Suspected-unproven, carried forward: a net-off double-tap leaves a live sheet whose accept turns
the mirror on (cosmetic — the user did press "I understand"); the mirror upload has the same
per-pass gap the outbox just closed (`askCoordinator.ts` documents it as deliberate).

## Not tested

- **Real multi-device Sync.** The mixed-version skew is proven by unit tests and by seeding the
  exact `data.json` shapes an older build writes — not by running two physical devices. Residual
  risk: Sync's own merge behaviour under a genuine version skew.
- **iOS / Android.** Driven on desktop Obsidian under phone emulation, not on hardware.
- **The `ASK_EXPAND_ENABLED` flip.** Deliberately out of scope; it is a separate four-step change
  documented in the handoff.

## Merge decision

**Ready.** The P0 that motivated the pass is closed and proven closed on the live surface; every
adversarial hole is fixed with a regression test that was verified to fail without the fix. The one
craft gap that this change introduced is explicitly owner-deferred with a follow-up filed.
