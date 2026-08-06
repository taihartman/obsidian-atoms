# Plan — consent wording parity (#315 + #314)

**Lane:** light, escalated. Small diff, but it touches a consent/access-control surface, which per
`CLAUDE.md` auto-escalates out of the amend lane. Light plan + `ce-doc-review` before implementation.

**Issues:** [#315](https://github.com/taihartman/obsidian-atoms/issues/315) (home grants the egress ack
behind weaker text) · [#314](https://github.com/taihartman/obsidian-atoms/issues/314) (two
acknowledgment row labels, scope narrowed by #304's QA).

**Why now:** #315 is the only #304 follow-up that gets *worse* by shipping. Every 0.6.79 install
widens a consent-wording mismatch on the surface new users hit first. It is a release input, not a
queued bug.

## Verified current state

Read on `origin/master` at `19bc489`, not taken from the issue — its line numbers predate #304.

| Surface | Modal | Disclosure | Writes |
|---|---|---|---|
| Settings | `ConsentSheetModal` (`settings.ts:2182`) | `EGRESS_DISCLOSURE` (`settings.ts:296`) | `writeEgressAck` |
| Home | raw `new Modal(app)` — `confirmEnableAutomaticFiling()` (`atomsHomeView.ts:2640`) | inline string literal | `writeEgressAck` via `main.ts:980` → `enableAutomaticFiling()` |

Both write **the same device-local boolean** (`LS_AUTO_RUN_EGRESS_ACK`, `autorun.ts:85`). Settings
later renders that boolean as *"Acknowledged on this device"* regardless of which surface wrote it.

## KTD1 — Union, not swap. The home text is not strictly weaker.

The issue frames this as home being weaker and the fix as pointing home at `EGRESS_DISCLOSURE`. That
is half right. Each string carries something the other lacks:

- **`EGRESS_DISCLOSURE` only:** foreground-resume runs; that *"Sync everything now"* classifies **even
  when automatic filing is turned off**.
- **Home modal only:** today's daily note is **never** auto-touched; the setting **stays on this
  device only**.

A naive swap therefore *weakens* home on two points while strengthening it on two others, and leaves
the settings sheet silently missing the today-exclusion and the device-local scope it has always
lacked. **Decision: extend `EGRESS_DISCLOSURE` to the union of both, then point both surfaces at it.**
One string, two callers, nothing dropped. This is the whole reason the fix is not a one-line import.

**"Nothing dropped" is not the only bar.** Doc-review: a four-clause run-on is itself a consent
defect — the wall of text people click through — and two of the four clauses are *reassurances* that
soften the risk the sheet exists to convey. `ASK_PRIVACY_DISCLOSURE` (`settings.ts:299`) already
solved this shape: discrete numbered clauses, not one sentence. **U2 inherits that structure, with
the two risk clauses ahead of the two scope-limit clauses.** The text is drafted here so this plan's
review round covers the words, rather than leaving them to implementation time:

```
(1) Atoms sends my vault title graph and each capture to the Anthropic API over TLS,
unattended — when Obsidian opens and when it returns to the foreground; (2) tapping
"Sync everything now" classifies even when automatic filing is turned off; (3) today's
daily note is never auto-touched; (4) this setting stays on this device only.
```

**Author it in first person.** `ConsentSheetModal` renders the body as `I understand: ${disclosure}`.
Home's current literal is second person ("When you open Obsidian, Atoms can send…"), so concatenating
the two strings instead of rewriting would produce a mixed-voice sentence.

## KTD2 — The shared consent primitive moves out of `settings.ts`

`ConsentSheetModal` and the disclosure constants live in `src/settings/settings.ts`. Home importing
from the settings tab is the wrong direction and would couple a view to a settings screen.

**Decision:** move `ConsentSheetModal`, `ConsentSheetSpec`, the `ConsentVerdict` type
(`settings.ts:2159`), and the **six** `*_DISCLOSURE` / `*_TITLE` constants — all three sheets' pairs,
at `settings.ts:294/295`, `298/299`, `302/303` — into a new `src/settings/consent.ts`, re-exported
where needed. Move the six together: splitting them would strand the vault-write pair in
`settings.ts` while the modal all three render through lives in `consent.ts`, recreating the
cross-file coupling this KTD exists to remove. Settings and home both import from there. Pure move
plus one string edit — no behavior change to the two other sheets (Ask privacy, vault write), which
must keep writing exactly their own field (`settings.ts:292` comment).

**Conflict risk — measured against both open branches.** Two in-flight PRs touch
`src/settings/settings.ts`, and neither goes near our two spots:

| PR | Branch | `settings.ts` hunks | Total |
|---|---|---|---|
| [#322](https://github.com/taihartman/obsidian-atoms/pull/322) (#320) | `feat/320-multi-device-sessions` | 31, 60, 304 (+52), 444, 511 | 56 ins / 0 del |
| [#330](https://github.com/taihartman/obsidian-atoms/pull/330) (#323) | `fix/ask-consent-cross-device` | 455 (+3), 562 (+8), 574 (+2) | 13 ins |

Our work is a string edit at **294–303** and a ~150-line block removal at **2159+**. None of #322's
or #330's hunks fall inside those two edit windows, so lifting `ConsentSheetModal` out cannot
textually conflict. (#322's hunks at 31 and 60 sit below our windows and are unrelated to both.)
The one adjacency is #322's 52-line insertion after line 301, within context range of our constants.

**Decision: proceed with the split.** Do not gate U1 on either session.

**The real collision is the version files, not `settings.ts`.** #330 and #322 both bump
`manifest.json`, `package.json`, and `versions.json`. #315 is user-visible and needs a bump too, so
whoever lands last resolves three one-line conflicts. Bump **last**, immediately before merge, not at
the start of implementation.

**Never resolve a version conflict by picking a side — re-derive from `master`.** Verified state:

| | `manifest.json` |
|---|---|
| `master` | **0.6.79** |
| #330 | 0.6.80 |
| #322 | **0.6.78-beta.2** ← branched before #304 landed |

Taking #322's side is wrong **three** ways at once, all inside one three-line conflict a reviewer
would plausibly wave through:

```
master  … "0.6.77", "0.6.78-beta.1", "0.6.79"
#322    … "0.6.77", "0.6.78",        "0.6.78-beta.1", "0.6.78-beta.2"
```

1. `manifest.json` moves **backwards**, 0.6.79 → 0.6.78-beta.2.
2. The **`0.6.79` mapping disappears** from `versions.json`.
3. A **fictional stable `0.6.78`** appears — verified `"0.6.78":` occurs 0× on master and 1× on #322.
   No stable 0.6.78 was ever cut; releases go 0.6.77 stable, then `0.6.78-beta.1` prerelease.

(0.6.79 is on master but **not released** — latest stable 0.6.77, latest prerelease `0.6.78-beta.1`.
So this is a regression against master, not against a shipped build. The rule is unchanged.)

Concretely: #330 lands at 0.6.80, so **ours is 0.6.81 unless #322 lands first**. Which is exactly why
the number is derived at merge time and not written now.

**Rebase on `master` after #330 lands** — it is small, green, and closest to merging. Not after #322,
which is a prior session's 2236-line #320 implementation, still open and not on the near path.

## KTD3 — #314 is exactly two labels

Rewrite `EGRESS_ACK_TITLE` (*"Data egress acknowledgment"*) and `ASK_PRIVACY_ACK_TITLE` (*"Ask
privacy acknowledgment"*). `egress` is not a user-facing word. Anything beyond these two strings is
out of scope and belongs back on #314.

`docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md:140` says *do not re-review the
screen* — that scoped the **row-grammar layout** pass, not new consent copy. It is not a reason to
skip reviewing these two strings.

**The strings are named here, not at implementation time.** They are the entire user-visible
deliverable of #314; deferring them to U4 means nobody ever reviews them, on a surface this plan's
own lane rationale escalates *because* it is a consent surface.

| Constant | Was | Becomes |
|---|---|---|
| `EGRESS_ACK_TITLE` | "Data egress acknowledgment" | **"What Atoms sends to Anthropic"** |
| `ASK_PRIVACY_ACK_TITLE` | "Ask privacy acknowledgment" | **"What Ask stores and shares"** |

**Not first person — that instruction was wrong.** Each title renders in *two* places: the Settings
row name (`settings.ts:1684`) and the `ConsentSheetModal` heading (`settings.ts:2196`). The row
grammar #304 established is second-person/imperative sentence case — "Sync when you return to
Obsidian", "Allow filing from Claude or ChatGPT", "File automatically when Obsidian opens" — so a
first-person row label would clash with every neighbour in the list. The replacements above are
plain, jargon-free, scannable as rows, and read correctly as modal headings; the *body* keeps its
first-person "I understand:" voice.

## KTD4 — Acks already on disk (added by doc-review)

**The harm #315 names survives the fix for the users who already have it.** A device that accepted
through the home modal keeps `LS_AUTO_RUN_EGRESS_ACK` set, and Settings goes on rendering
*"Acknowledged on this device"* for wording that user never saw. U2 then rewrites the disclosure,
which **re-creates the same mismatch for everyone who acknowledged in Settings**. Fixing only the
wording leaves the consent *record* wrong.

`writeEgressAck` (`autorun.ts:85-90`) stores a bare boolean, so staleness is undetectable. The
codebase already carries the pattern that fixes this: `writeShortcutAck`
(`src/settings/captureShortcut.ts:141`) stores a version string, and `readAckVersion` reads it back.

**Decision: version-stamp the egress ack.** A missing or older stamp reads as unacknowledged, so the
next automatic-filing attempt re-prompts once with the union text. The one-time re-prompt is expected
release behavior, not a regression.

> ⚠️ **This is the one scope-widening decision in the plan.** It touches the write path, the read
> path, the auto-run gate, and the withdrawal cascade — more than a string edit. It is U6, sequenced
> last so it can be dropped without unpicking U1–U5 if the re-prompt is judged not worth it. Dropping
> it means shipping a known-stale consent record for existing devices.

## Units

1. **U1 — extract.** Move `ConsentSheetModal`, `ConsentSheetSpec`, `ConsentVerdict`, and all six
   `*_DISCLOSURE` / `*_TITLE` constants to `src/settings/consent.ts`. No text changes.
   **Also lower `DIRECT_SETTING_BUDGET` in `test/settingsRows.test.ts:784` from 6 to 5** — the file
   sits at exactly 6 direct `new Setting()` sites and `ConsentSheetModal`'s (`settings.ts:2205`) is
   one of them, so the move drops it to 5 while the budget silently buys back a slot. The guard stays
   green either way; nothing signals it. Build + existing tests green.
2. **U2 — union the disclosure.** Replace `EGRESS_DISCLOSURE` with the drafted four-clause numbered
   text in KTD1, first person, risk clauses first.
3. **U3 — home uses the primitive.** Replace `confirmEnableAutomaticFiling()`'s raw modal with
   `ConsentSheetModal` + `EGRESS_DISCLOSURE`. Three decisions this unit **makes**, not discovers:
   - **Export an `egressConsentSpec(onVerdict)` factory** from `src/settings/consent.ts`; both the
     settings sheet and home construct their modal from it. This is what gives U5 a seam (see U5).
   - **Home adopts the shared chrome unchanged** — the shared title (U4's `EGRESS_ACK_TITLE`) and the
     shared "I understand" / "Cancel" buttons. `ConsentSheetSpec` is **not** widened. This is a real
     copy change: home today is titled "Automatic filing" with an **"Enable"** CTA
     (`atomsHomeView.ts:2642-2657`), and the shared sheet hardcodes "I understand"
     (`settings.ts:2219`). KTD1 audited the disclosure string and stopped; this is the rest of that
     audit.
   - `enableAutomaticFilingFromHome()` fires **only** on the `accepted` verdict. Decline/close must
     not write the ack — `ConsentSheetModal.onClose` already treats an unanswered close as
     `declined` (`settings.ts:2225-2229`, verified); assert it rather than rebuilding it.
4. **U4 — the two labels** (#314). Land the two strings named in KTD3. **Update the hardcoded ack row
   names in `test/settings.test.ts` in the same commit** — both titles are hardcoded at ~8 sites
   (lines 697-698, 785-786, 793-794, 822-823, 834, 860), as row names and as
   `press(tab, "Data egress acknowledgment", "Review")` targets, so this unit red-lines the suite
   until they move. Glance at `settings.ts:1683`, where `EGRESS_ACK_TITLE` is interpolated into an
   action id (`ack:review:${EGRESS_ACK_TITLE}`); nothing outside `settings.ts` reads it.
5. **U5 — parity test.** The unit that stops #315 from recurring. **Assert on disclosure identity,
   not on the write key** — both surfaces already wrote the same key on master, so a same-key
   assertion would have passed green throughout the entire bug and guards nothing. It is also
   inaccurate as originally written: `enableAutomaticFiling()` (`autorun.ts:111-116`) writes
   **two** keys (`LS_AUTO_RUN_EGRESS_ACK` *and* `LS_AUTO_RUN_ENABLED`) while the settings egress
   sheet writes only the ack. Assert:
   - both call sites build their modal from `egressConsentSpec` (U3's factory), and a modal opened
     from it renders `EGRESS_DISCLOSURE` itself rather than an equal-looking literal — **this is the
     drift guard**;
   - home accept writes the egress ack **and** the auto-run-enabled flag; the settings sheet writes
     only the ack; home decline writes neither.

   Use the existing `captureObsidianUi` harness in `test/mocks/obsidian.ts` (precedent:
   `test/plusSignInConfirmModal.test.ts`). **Do not** stand up an `AtomsHomeView` harness — no test
   imports `src/home/atomsHomeView.ts` today, `confirmEnableAutomaticFiling()` is private on a
   2671-line `ItemView`, and a full `AtomsPlugin` stub is why U5 has no seam without U3's factory.
6. **U6 — version-stamp the egress ack** (KTD4). Optional; drop-able without unpicking U1–U5.

## Out of scope

Ask privacy / vault write sheets beyond the #314 label. The `readEgressPermitted` catch-up boolean
(`autorun.ts:100`). #323's cross-device divergence — that is the other session's, and it is a
*different* bug: this one is two surfaces on one device disagreeing about wording, that one is one
surface on two devices disagreeing about state.

## Test plan

- Unit: home decline writes neither key; home accept writes the egress ack **and** the
  auto-run-enabled flag; the settings egress sheet writes only the ack.
- Unit: the disclosure-identity parity assertion in U5 — both call sites go through
  `egressConsentSpec`, and the rendered body is `EGRESS_DISCLOSURE` itself.
- Unit: `test/settings.test.ts` green against the new labels (U4).
- Unit: `DIRECT_SETTING_BUDGET` lowered to 5 and still passing (U1).
- Live vault smoke in `test_vault/test vault` — enable from home, confirm Settings then shows the
  acknowledgment row, and confirm Withdraw from Settings cascades. Screenshots for the PR body.

## Open questions (from doc-review, not blocking U1–U5)

1. Does the settings **review/withdraw** sheet (`settings.ts:1690`) want the full unioned disclosure,
   or only the enable-time sheet? Both share `EGRESS_DISCLOSURE`, so U2 changes the withdrawal
   surface's copy too.
2. Do the new U4 labels need a matching update to the row-name inventory in
   `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md`?
