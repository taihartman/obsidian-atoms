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
| Home | raw `new Modal(app)` — `confirmEnableAutomaticFiling()` (`atomsHomeView.ts:2638`) | inline string literal | `writeEgressAck` via `main.ts:980` → `enableAutomaticFiling()` |

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

## KTD2 — The shared consent primitive moves out of `settings.ts`

`ConsentSheetModal` and the disclosure constants live in `src/settings/settings.ts`. Home importing
from the settings tab is the wrong direction and would couple a view to a settings screen.

**Decision:** move `ConsentSheetModal`, `ConsentSheetSpec`, and the four `*_DISCLOSURE` / `*_TITLE`
constants into a new `src/settings/consent.ts`, re-exported where needed. Settings and home both
import from there. Pure move plus one string edit — no behavior change to the three other sheets
(Ask privacy, vault write), which must keep writing exactly their own field (`settings.ts:290` comment).

**Conflict risk — measured against both open branches.** Two in-flight PRs touch
`src/settings/settings.ts`, and neither goes near our two spots:

| PR | Branch | `settings.ts` hunks | Total |
|---|---|---|---|
| [#322](https://github.com/taihartman/obsidian-atoms/pull/322) (#320) | `feat/320-multi-device-sessions` | 31, 60, 304 (+52), 444, 511 | 56 ins / 0 del |
| [#330](https://github.com/taihartman/obsidian-atoms/pull/330) (#323) | `fix/ask-consent-cross-device` | 455 (+3), 562 (+8), 574 (+2) | 13 ins |

Our work is a string edit at **295–300** and a ~150-line block removal at **2182+**. Nothing above
295 or below 574 is touched by either, so lifting `ConsentSheetModal` out cannot textually conflict.
The one adjacency is #322's 52-line insertion after line 301, within context range of our constants.

**Decision: proceed with the split.** Do not gate U1 on either session.

**The real collision is the version files, not `settings.ts`.** #330 and #322 both bump
`manifest.json`, `package.json`, and `versions.json`. #315 is user-visible and needs a bump too, so
whoever lands last resolves three one-line conflicts. Bump **last**, immediately before merge, not at
the start of implementation.

**Rebase on `master` after #330 lands** — it is small, green, and closest to merging. Not after #322,
which is a prior session's 2236-line #320 implementation, still open and not on the near path.

## KTD3 — #314 is exactly two labels

Per `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md:140`: *do not re-review the
screen.* Rewrite `EGRESS_ACK_TITLE` (*"Data egress acknowledgment"*) and `ASK_PRIVACY_ACK_TITLE`
(*"Ask privacy acknowledgment"*) to the plain first-person voice their own sheet bodies already use.
`egress` is not a user-facing word. Anything beyond these two strings is out of scope and belongs
back on #314.

## Units

1. **U1 — extract.** Move consent modal + constants to `src/settings/consent.ts`. No text changes.
   Build + existing tests green. (Gated on the KTD2 conflict check.)
2. **U2 — union the disclosure.** Extend `EGRESS_DISCLOSURE` to cover today-exclusion and
   device-local scope alongside the existing foreground-resume and Sync-everything clauses.
3. **U3 — home uses the primitive.** Replace `confirmEnableAutomaticFiling()`'s raw modal with
   `ConsentSheetModal` + `EGRESS_DISCLOSURE`. Decline/close must **not** write the ack —
   `ConsentSheetModal.onClose` already treats an unanswered close as `declined`; assert it.
4. **U4 — the two labels** (#314).
5. **U5 — parity test.** A test that fails if either surface drifts: both paths write the same key,
   and the home path renders `EGRESS_DISCLOSURE` rather than a literal. This is the unit that stops
   #315 from recurring; without it the fix is a one-time correction, not a guarantee.

## Out of scope

Ask privacy / vault write sheets beyond the #314 label. The `readEgressPermitted` catch-up boolean
(`autorun.ts:100`). #323's cross-device divergence — that is the other session's, and it is a
*different* bug: this one is two surfaces on one device disagreeing about wording, that one is one
surface on two devices disagreeing about state.

## Test plan

- Unit: home decline writes nothing; home accept writes the same key settings writes.
- Unit: the parity assertion in U5.
- Live vault smoke in `test_vault/test vault` — enable from home, confirm Settings then shows the
  acknowledgment row, and confirm Withdraw from Settings cascades. Screenshots for the PR body.
