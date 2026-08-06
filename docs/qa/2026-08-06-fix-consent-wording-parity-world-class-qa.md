# World-class QA — consent wording parity (#315 + #314)

**Date:** 2026-08-06 · **Branch:** `fix/consent-wording-parity` · **PR:** [#329](https://github.com/taihartman/obsidian-atoms/pull/329) · **Version:** 0.6.81

## Verdict

**Ready to merge.** All five user stories passed against the live plugin in the throwaway vault, on
Obsidian 1.13.4. One finding, doc-only, fixed in this pass. Craft passed. Adversarial half run — see
§ Adversarial.

## Charter

Atoms home's "Turn on automatic filing" and the Settings egress sheet wrote the **same** device-local
consent behind **different** disclosure text, and Settings rendered it as *"Acknowledged on this
device"* whichever surface wrote it — so a user could grant from home, never open Settings, and hold
a consent record for wording they never saw (#315). #314 renames the two jargon row labels #304
deferred.

Workflows that must work: enabling automatic filing from either surface; reviewing and withdrawing
the acknowledgment; the upgrade path for devices holding a pre-stamp consent. Adjacent regression
risk: the auto-run gate itself (this consent is what permits paid, unattended sends to Anthropic),
and the Ask-privacy consent that shares the same sheet chrome.

Platform: desktop Obsidian **1.13.4** (installer 1.12.7), vault `test_vault/test vault`.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` § 35 |
| Authority paths | ✅ `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md`, issues #315 / #314 |
| Navigation map | ➕ **row added** — `docs/qa/app-navigation-map.md` § "Settings → Atoms" documented the destination shape but not the conditional consent-record rows. Added a table covering all three, their render conditions, and the either-grant keying |
| Dev/run command | ✅ `./scripts/install-to-vault.sh "<test vault>"` |
| Viewport/device | ✅ desktop Obsidian window |
| Auth path | ✅ device-local consent only; no sign-in needed for the egress path |
| Fixtures | ✅ catalog read (`docs/qa/testing-fixtures.md`); device-local keys seeded directly, disclosed below |
| Mockup | N/A — no redesign; row grammar unchanged |
| Automation | ✅ Obsidian CLI (`obsidian command` / `eval` / `dev:screenshot`); vitest |
| Device lock | N/A — no shared physical device |
| Deploy reality | N/A — plugin-only change, no server or CDN component |

## Authority & promises

Read: the plan (KTD4 = the ack version stamp; U3 = home grants through the shared sheet), issues
#315 and #314, and on-screen copy.

| Surface / CTA | Promise | Acceptance (observable) | Story |
|---|---|---|---|
| Home "Turn on automatic filing" | #315 + U3 — home grants through the **shared** sheet | Sheet titled "What Atoms sends to Anthropic", CTA "I understand", four numbered clauses; accept writes ack = version string + enabled = true | US-1 |
| Settings automatic-filing toggle | Same shared sheet (parity is the whole point) | Byte-identical title and disclosure to US-1; same two keys, same values | US-2 |
| Settings "Review" on the ack row | Consent sheet concept — a granted ack stays inspectable and revocable | Withdraw clears every grant; gate shut on both `catchUp` branches; row disappears | US-3 |
| The ack row's existence | Fix `a3ce40d` — the row keys on **either** grant | Legacy ack + notice → row present, reading "against earlier wording"; legacy ack alone → no row | US-4 |
| #314 row labels | Decided in the plan | "What Atoms sends to Anthropic" / "What Ask stores and shares" render as real Settings rows | US-5 |

No spec/copy conflicts found — on-screen copy and the plan agree.

## Product loop vs fixture

| Story | Proof kind |
|---|---|
| US-1 enable from home | **user-loop** — pressed the real home hero, real sheet, real accept |
| US-2 enable from Settings | **user-loop** — real toggle, real sheet, real accept |
| US-3 withdraw | **user-loop** — real Review button, real Withdraw |
| US-4 upgrade case | **fixture-plumbing** — the legacy state is a *pre-upgrade* device shape that cannot be produced by today's product; seeded deliberately and labelled |
| US-5 Ask row label | **ui-chrome-only** — `askPrivacyAckAt` set directly; the Ask consent *flow* needs a Plus session this vault does not have. Label checked, flow **not** driven |

**Disclosed seeds** (both removed afterwards; vault returned to all-keys-absent, no API key,
`askPrivacyAckAt` empty):

1. A fake API key was written to SecretStorage so the home hero would resolve to the enable-filing
   card at all — that card requires BYOK or Plus. **No classify call was ever made**; only the
   consent sheet was exercised.
2. `settings.askPrivacyAckAt` was set directly to render the Ask row for the US-5 label check.

## User stories

**US-1 — enable from Atoms home.** As someone who has never opened Settings, I want turning on
automatic filing to tell me what leaves my vault, so that my consent record matches what I read.
*Acceptance:* shared sheet, four clauses, accept writes the stamped ack. **Passed.**

**US-2 — enable from Settings.** As a user who starts in Settings, I want the same disclosure the
home path shows, so that neither surface is the weaker one. *Acceptance:* byte-identical strings,
same keys. **Passed** — strings compared by `diff` on the captured DOM text, not eyeballed.

**US-3 — withdraw.** As someone who changes their mind, I want Review → Withdraw to actually stop the
sending, so that revoking means revoked. *Acceptance:* toggle off, all grants cleared, gate false on
both branches, row gone. **Passed.**

**US-4 — the upgrade case (the P1 regression).** As a user upgrading with a pre-stamp consent still
on file, I want the review surface to survive the upgrade, so that a grant that is still spending is
still revocable. *Acceptance:* row present, reading "against earlier wording"; withdrawal shuts both
paths; and the negative — a legacy ack with **no** notice shows **no** row, because that device is
not permitting anything. **Passed, both directions.**

**US-5 — the #314 labels.** As a reader of Settings, I want row names in plain language.
*Acceptance:* both render as real `.setting-item` rows with a Review button. **Passed.**

**Adversarial extra — Cancel.** Cancelling the sheet writes nothing and leaves the toggle off.
**Passed.**

## Observed strings (verbatim)

- Title, both surfaces, identical: `What Atoms sends to Anthropic`
- CTA: `I understand` (buttons `Cancel`, `I understand`)
- Disclosure: `I understand: (1) Atoms sends my vault title graph and each capture to the Anthropic API over TLS, unattended — when Obsidian opens and when it returns to the foreground; (2) tapping "Sync everything now" classifies even when automatic filing is turned off; (3) today's daily note is never auto-touched; (4) this setting stays on this device only.`
- Granted row description: `Acknowledged on this device`
- Legacy/notice-only row description: `Acknowledged on this device for Sync everything now, against earlier wording`
- Withdraw sheet buttons: `Close`, `Withdraw acknowledgment`
- Ask row: `What Ask stores and shares` / `Acknowledged 2026-08-06` / `Review`

## Risk matrix

| Risk | Story | Result |
|---|---|---|
| Happy — grant from either surface | US-1, US-2 | Passed |
| Promise — copy ↔ destination parity between surfaces | US-2 | Passed (byte-identical) |
| Negative — decline the sheet | Adversarial extra | Passed (nothing written) |
| Negative — legacy ack with no notice must NOT show a row | US-4 | Passed |
| Edge — legacy ack + notice (the P1) | US-4 | Passed |
| Regression — the egress gate itself | all | Passed, `readEgressPermitted` exercised as compiled code across five states |
| Perception — the row must name *which* grant is on record | US-4 | Passed |
| Craft — row density and adjacency | §Craft | Passed |

## Evidence

`readEgressPermitted` was exercised as the **real compiled function** (esbuild bundle of
`src/platform/autorun.ts`) against the literal store values observed live:

| Device state | `catchUp: true` | `catchUp: false` |
|---|---|---|
| clean (all absent) | false | false |
| granted (stamped ack) | true | true |
| legacy ack + notice | **true** | false |
| legacy ack, no notice | false | false |
| post-withdraw | false | false |

Row three is the P1 premise, live: the gate is open and, before the fix, nothing on screen could
close it.

| Kind | Path / result |
|---|---|
| Screenshots | `docs/qa/screenshots/consent-wording-parity/` (8 frames — both sheets, granted row, the legacy row, withdraw sheet, post-withdraw, Ask row, craft frame) |
| Automated | `npm run build` clean; `npm test` — see PR body for counts |
| Craft | Passed — `us5-craft-granted-rows-in-context.png`, adjacency checked |
| Manual | Full CLI drive on Obsidian 1.13.4, throwaway vault only |

## Craft

Frame: `us5-craft-granted-rows-in-context.png`, plus a main-thread read of
`us4-legacy-review-row-against-earlier-wording.png`.

- Breathing room / density: rows 76–89px, uniform 16px vertical padding, 7–8px inter-card gaps.
- **Stacked chrome adjacency: no collision.** The ack row is a distinct card between "File
  automatically when Obsidian opens" and "Sync when you return to Obsidian"; no rule doubling, no
  flush seam.
- Tap targets: `Review` measures 90×44 — at the 44pt floor, passes.
- Clipping: none. The long "…for Sync everything now, against earlier wording" description renders on
  one line without truncation (confirmed visually, not only by DOM assertion).
- Hierarchy: one soft observation, **not** a defect — `Review` is a filled accent button identical in
  weight to `Sync everything now`, so "read a disclosure" and "run everything" look equally
  consequential in the same section. Worth a later look at button weight; not blocking.

## Findings

**F1 — doc-only, fixed in this pass.** The comment on `writeEgressAck` (`src/platform/autorun.ts`)
claimed *"Withdrawing keeps writing `false`"*. At runtime the keys read **absent**, because
Obsidian's `saveLocalStorage` deletes the entry for any falsy value — probed directly. Behaviour is
correct and unchanged (`readEgressAckVersion` → null either way); the comment misdescribed what lands
on disk. Corrected.

No P0 or P1 found.

## Adversarial

Run via `adversarial-qa` against this build — scenarios and outcomes recorded in the section the
skill appends. Fold its scenario list forward for the next consent change.

## Not tested

- **The Ask-privacy consent *flow*** (sheet → accept → row). Blocked at "Sign in to Atoms Plus"; no
  Plus session in the throwaway vault. US-5 covers the row **label** only. Residual risk: the Ask
  sheet shares `ConsentSheetModal` with the egress sheet, which was driven end to end, so the chrome
  is covered; the Ask-specific spec and its write path are not.
- **Escape / click-outside dismissal** not driven separately. `Cancel` was, and all three share the
  same `onClose` → `declined` path; the parity test covers dismissal at unit level.
- **iOS / Android.** Desktop only this pass. The change is device-local storage plus Settings
  chrome — no platform-specific code — but mobile rendering of the longer row description is
  unverified.

## Merge decision

**Ready.** The behavioural contract is proven live on both surfaces and on the upgrade path,
including the negative case. The one finding was a comment, and it is fixed. The gaps above are named
rather than papered over, and none of them touch the change's own claim.
