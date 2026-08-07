# World-class QA — #340 Ask consent re-prompt (0.6.87)

- **Date:** 2026-08-07
- **Branch:** `feat/339-ask-search-recall-honesty` · **PR:** [#340](https://github.com/taihartman/obsidian-atoms/pull/340) · **Issue:** [#339](https://github.com/taihartman/obsidian-atoms/issues/339)
- **Build under test:** plugin **0.6.87**, installed to the throwaway `test vault` and reloaded via CLI
- **Mode:** Full automation (live drive) — Obsidian 1.13.4 desktop at phone width (`is-phone`), Obsidian CLI

## Verdict

**The change under test PASSES.** All six planned scenarios (A–F) passed on the live vault. Both
disclosures match their source constants byte-for-byte, the re-prompt fires on every stale-ack
shape, and **zero request bodies left the device in any state without a current ack** — proven by a
localhost egress sentinel, not inferred.

**Two P1 holes were proven in the surrounding Ask surface. Both are pre-existing on `master` and
untouched by this branch** (`src/settings/settings.ts` and `src/platform/filingAuth.ts` are not in
this diff; settings.ts was last changed on master by `35cc37b`). They do not regress here, and
holding this PR would leave every device on the *older, less honest* six-clause consent.

> **Merge recommendation: ship #340, file the two P1s as separate issues.** The wipe hole deserves
> priority — it is a privacy-surface defect in the product's only "delete my cloud copy" gesture,
> and clause (6) of the *new* wording extends the promise it fails to keep.
>
> **Owner's call required** (adversarial-qa §5: proven holes are fixed or explicitly deferred).

## Charter

`ASK_PRIVACY_ACK_VERSION` moved to `2026-08-07` because `ASK_PRIVACY_DISCLOSURE` gained a seventh
clause naming Anthropic search-expansion egress. Every existing device must therefore re-accept
before the Ask mirror resumes. What must work: the re-prompt fires, the wording on screen is the
shipped constant, accepting stamps the new version, declining changes nothing and sends nothing,
the write ack re-prompts under its own unchanged wording, and the version is visible.

Adjacent regression risk: the consent gate is read by both Settings and `askCoordinator`, so a
UI-only pass would miss a runtime gate that disagrees with the toggle.

**Proof kind:** `user-loop` for every consent gesture — sheets were raised and settled by clicking
the real controls in the real Settings tab. `fixture` for two pieces of plumbing that only exist to
*reach* that surface: a synthetic device-local Plus session (the Ask section does not render signed
out) and a `data.json` written to the pre-upgrade ack state. Neither manufactures a result; both put
the device in the state a real upgrading user is already in. No product claim rests on seeded data.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` § Product dogfood honesty — read |
| Authority paths | ✅ `src/settings/consent.ts` (`ASK_PRIVACY_DISCLOSURE`, `ASK_WRITE_DISCLOSURE`), `src/shared/askAck.ts` (both version constants) |
| Navigation map | ✅ followed `docs/qa/app-navigation-map.md` — its 2026-08-07 rows (phone-mode modal selection, two-eval settings reopen, vault-relative `dev:screenshot`) were correct and load-bearing; no drift, no row healed |
| Dev/run command | ✅ `./scripts/install-to-vault.sh "<test vault>"` (build + copy + `plugin:reload`) |
| Viewport/device | ✅ 390×844, `is-phone` asserted — required, since desktop Settings opens in a popout `dev:screenshot` cannot capture |
| Auth path | ✅ synthetic device-local Plus session fixture (`atoms-plus-session`); token never printed |
| Fixtures | ✅ read `docs/qa/testing-fixtures.md`; no catalog fixture covers a staged consent-version state, so `data.json` was written directly and restored from `/tmp/atoms-data-backup-pre340qa.json` |
| Egress containment | ✅ `plusBaseUrl` pinned to `http://127.0.0.1:8787` with a logging sentinel; **nothing reached the real internet at any point** |
| Deploy reality | ⚠️ N/A for the client gate. `plus-service` is **not deployed** — expansion is inert in production regardless of the flag (double-gated on `config.anthropicApiKey`). Separate act from merging. |
| Device lock | N/A — no shared physical device |

## Authority & promises

| Surface | Promise (authority) | Acceptance (observable) | Story |
|---|---|---|---|
| `Ask mirror` toggle, stale ack | #360 gate: a grant against superseded wording is not consent | Toggle renders **off** despite `askEnabled:true`; turning it on raises the sheet | A |
| Privacy sheet body | `ASK_PRIVACY_DISCLOSURE` (`consent.ts:31`) — the constant is the spec | On-screen text == `"I understand: " + constant`, exactly | B |
| Accept | `ASK_PRIVACY_ACK_VERSION` (`askAck.ts:38`) | `askPrivacyAckVersion` becomes `2026-08-07`, fresh timestamp | C |
| Cancel / Escape / click-out | `ConsentSheetModal.onClose` — "closing without choosing is a decline, never consent" | Nothing stamped, mirror off, **zero egress** | D |
| `Allow filing…` toggle | `settleAckRecords` (`askAck.ts:172`) clears the write ack when privacy goes stale | Write sheet re-posed; `ASK_WRITE_ACK_VERSION` stays `2026-08-06` | E |
| Settings header | CLAUDE.md § Versioning | `Version 0.6.87` | F |

**Spec/copy conflict found:** privacy clause (6) promises *"Wipe deletes the cloud mirror, search
expansions, pending outbox writes, and connector tokens."* Wipe deletes them, then the device
re-uploads everything unprompted — see P1-1. The stricter user-visible promise is the one that
governs, so this is recorded as a **promise/destination mismatch against pre-existing code**.

## User stories

| # | Story | Acceptance | Evidence | Status |
|---|---|---|---|---|
| A | As a user upgrading from 0.6.86, I am asked again before my vault resumes mirroring, so a reworded disclosure never rides on my old consent. | Mirror toggle off despite `askEnabled:true`; record row reads "Acknowledged 2026-08-06, against different wording"; turning it on raises the sheet. | `01-A-mirror-off-after-upgrade.png`, `02-B-privacy-sheet.png` | **Passed** |
| B | As a user, the sheet tells me exactly what this build does, so I am not agreeing to text I cannot see. | Exact-string compare of DOM text against `ASK_PRIVACY_DISCLOSURE`: **match, 597 == 597 chars**, seven clauses, clause (4) names Anthropic search-expansion egress. No clipping (scrollHeight == clientHeight). | `02-B-privacy-sheet.png` | **Passed** |
| C | As a user who accepts, my agreement is recorded against this wording. | `askPrivacyAckVersion` `2026-08-06` → `2026-08-07`; `askPrivacyAckAt` → `2026-08-07T19:10:27.429Z`. Write ack correctly left empty (separate consent). | `03-C-after-accept-privacy.png` | **Passed** |
| D | As a user who declines, nothing about my vault changes and nothing is sent. | Cancel, Escape, and click-outside all: toggle off, version still `2026-08-06`, **egress log empty**. | `07-D-after-cancel.png` | **Passed** |
| E | As a user, letting Claude write into my vault is a second, separate decision. | Distinct sheet "Vault write acknowledgment"; exact match vs `ASK_WRITE_DISCLOSURE` (322 == 322 chars); stamps `askWriteAckVersion: 2026-08-06` — unchanged on purpose. | `04-E-write-sheet.png`, `05-E-write-ack-granted.png` | **Passed** |
| F | As a user on a phone, I can tell which build I am running. | `Version 0.6.87` in Settings → Atoms; manifest agrees. | `06-F-version.png` | **Passed** |

## Risk matrix

| Class | Covered by | Result |
|---|---|---|
| Happy | A, C, E | Passed |
| Negative | D (three dismissal paths) | Passed |
| Edge | Adversarial 4–6: legacy grant, whitespace, numbers, booleans, future stamp, non-date timestamp, orphaned version | Passed — gate closed in every not-current case, zero throws |
| Regression | Runtime gate (`askCoordinator.mirrorPermitted`) vs the Settings toggle; vault-modify event under a stale ack | Passed — they agree; zero network |
| Perception | Record-row standing copy ("against earlier wording" vs "against different wording"); status line | 1 P2 (stale status line) |
| Promise | Clause (6) Wipe promise vs live behavior | **Failed — P1-1 (pre-existing)** |
| Craft | §5b read of the decisive frame | Passed, 2 × P3 |

## Evidence

**Egress sentinel** (`127.0.0.1:8787`, logs method/path/bytes, answers 503). Total bytes shipped
across the entire constructive run: **0**.

| Window | Recorded |
|---|---|
| Upgrade boot with `askEnabled:true`, stale ack | *empty* |
| Scenarios A, B (pre-accept) | *empty* |
| Immediately after accept (C) | `OPTIONS /v1/ask/mirror/upsert bytes=0`, 207 ms after the stamp — expected: consent granted |
| All three declines (D) | *empty* |
| `Sync everything now` under a stale ack | *empty* after 8 s |
| Positive control: same button after accepting | two `OPTIONS /v1/ask/mirror/upsert` — the sentinel demonstrably catches mirror traffic, so the empty windows are a real gate, not a broken probe |

**Screenshots** — `docs/qa/screenshots/340-ask-expand/` (17 frames; `01`–`13` constructive + adversarial round 1, `adv2-01`–`adv2-04` adversarial round 2).

**Craft (§5b)** — decisive frame `02-B-privacy-sheet.png` read in full. Sheet 366×532 in a 390×844
viewport: all seven clauses on screen, no clipping or overflow, buttons well separated with
"I understand" clearly primary. **Passed**, with two P3 notes: ~130 px of dead space above the
title (occupied only by the ✕), and the disclosure is one dense 597-character paragraph — the
numbering is the mitigation the source comment describes, but at phone width it still reads as a
13-line block. Neither is a regression; the 0.6.86 wording had the same shape one clause shorter.

**Automated** (per the handoff, `npm test` / `npm run build` are avoided — issue #343):

| Suite | Result |
|---|---|
| `npx vitest run` | 1399 pass / 81 files |
| `plus-service` `node --test test/*.test.mjs` | 512 pass |
| `npx tsc --noEmit` | clean |
| `npm run build` (via install script, this run) | clean; no tracked file deleted |

## Adversarial pass

Two rounds. Round 1 attacked mutation, stale state, and weird sequences; round 2 attacked the
classes round 1 under-weighted — offline/flaky network, re-issue, identity churn, the runtime gate,
and version downgrade.

### Scenario ledger

| Scenario | Verdict |
|---|---|
| Withdraw then re-grant (does the narrow consent outlive the broad one?) | solid — withdrawing privacy cleared **both** acks |
| Accept privacy, decline write | solid |
| Stale/detached sheet accepted after a withdrawal made in front of it | solid — modal latch replaced rather than stacked; nothing granted |
| Triple-click the toggle | solid — exactly one sheet, no grant |
| Legacy grant (empty version) | solid — re-prompts, row reads "against earlier wording" |
| Garbage versions: `"   "`, `12345`, `true`, `null`, `{}`, `[]`, future stamp, `askPrivacyAckAt:"yes"` | solid — 8 fixtures, zero throws, Settings painted every time, gate closed in every case |
| Trailing-space version `"2026-08-07 "` reads as current | solid — the documented deliberate trim in `askAckIsCurrent`, exercised on purpose |
| Orphaned version (empty ts + current version) | solid — gate closed, record row correctly absent |
| Plugin reload / Settings close mid-sheet | solid — nothing granted |
| Revoke a granted write toggle | solid — clears immediately, no sheet (revocation needs no consent) |
| Offline / 500 / hang / socket-killed mid-sync during accept | solid — ack stamps, no half state, no rollback |
| Runtime gate: vault-modify event + `sync-everything-now` + forced sync under a stale ack | solid — zero network; stale write ack refuses outbox |
| Version downgrade 0.6.87 → 0.6.86 → 0.6.87 (0.6.86 built for real) | solid — nothing grants silently at either boundary |
| **Wipe cloud copy, then reload** | **holed — P1-1** |
| **Sign out, sign in as a different Plus account** | **holed — P1-2, P2-1** |
| Unresponsive backend + repeated Sync now | **holed — P2-2** |

### Proven holes

All are in code this branch does not touch. Ranked.

**P1-1 — "Wipe cloud copy" undoes itself with no user action.** `src/settings/settings.ts:855`
(`confirmWipeCloudCopy`).
Wipe calls `askMirrorWipe`, then `clearAskMirrorDeviceState` — which zeroes the local hash baseline
— and never touches `askEnabled` or either ack. The mirror stays permitted and the device now
believes it has uploaded nothing: the exact precondition for a full re-upload.
*Live repro:* wipe → cloud 407 → 0; touch one atom → **17 s later all 407 rows are back**, and
`expand-backfill` re-fires, which per clause (4) re-sends title/tags/body slices to Anthropic —
the search expansions clause (6) just promised Wipe removed. Wipe again → 0; **plugin reload, zero
clicks, zero edits → 407 rows back in 4 s.** Restarting Obsidian is enough.
*Why it matters here:* this is the only gesture the product offers for "delete my cloud copy," and
clause (7) ("turning Ask off does not wipe") steers users to press it *while Ask is on* — precisely
the state where it does not hold. Wipe only sticks if the ack is withdrawn first.
Evidence: `adv2-01-connect-before-wipe.png`, `adv2-02-ask-section-after-wipe-undone.png`.

**P1-2 — Both Ask consents are inherited by a different Plus account, silently.**
`src/settings/settings.ts:1166` (`signOutOfPlus`) + `src/plugin/askCoordinator.ts:122`
(`mirrorPermitted`).
Sign-out clears only the session and the refresh record. `askEnabled`, both acks, the hash baseline
and the cached mirror email all survive, and `mirrorPermitted()` has no identity component.
*Live repro:* granted both acks as account A → signed out with the real button → staged account C →
reloaded. **No sheet, no prompt**, and the log shows `POST /v1/ask/outbox/pull` and
`POST /v1/ask/mirror/upsert ×5` against account C's fingerprint. Both directions cross: bodies
upload to a different account's cloud, and that cloud's outbox is polled for files to write into
this vault.
The source comment justifying ack survival reasons about keeping the *record* so withdrawal stays
reachable — sound. What looks unconsidered is that `askEnabled` survives too, so egress resumes on
its own.

**P2-1 — After an identity change the mirror is silently, permanently incomplete.** Account A's
407-path hash baseline survives into account B, so B's first sync uploads nothing. One edit later
B's cloud held **1 of 407 atoms** while Settings read `Ask mirror: 1 · … · last pushed just now` —
no error, no warning. Ask then answers from 1/407 while the plugin reports health. Only a forced
`Sync now` repairs it, and nothing suggests it. Same root as P1-2: device-local mirror evidence is
not bound to an account or a cloud generation. Directly counter to this PR's recall-honesty goal.

**P2-2 — An unresponsive backend wedges the mirror until a plugin reload.** With the server
hanging, the layout-ready sync never settles and `askMirrorFlight.inFlight` stays true. Two later
forced `Sync now` calls, 60 s apart, both returned `{kind:"joined"}` with **zero further network
attempts**. The toast (`src/shared/mirrorOutcome.ts:79`) says *"a sync was already running — press
Sync now again when it finishes"*; it never finishes. Honest wording, unreachable recovery. No
timeout on the mirror pass. (Proven to 75 s + a reload, not to infinity.)

**P2-3 — The mirror status line survives consent withdrawal.** `src/settings/settings.ts:2109`
(`mirrorStatusLine`) reads only device-local stamps and never consults the ack. After withdrawing
everything, the `Connect Claude or ChatGPT` row still reads `Ask mirror: 407 · as … · push failed
… · Sync now to retry` — an active mirror, an identity, and a retry CTA, for a mirror that is gated
off and will not sync. Not a leak (zero egress proven in that state), but a copy-honesty defect on
the very surface #340 exists to make honest, and it is reachable by **every** device that takes
this upgrade. Evidence: `13-adv-connect-row-stale-mirror-status.png`.

**P3** — ~130 px dead space above the consent sheet title; translucent sticky "Atoms" header lets
scrolled body text show through (pre-existing, present regardless of this change).

### Suspected, unproven

- `settleAckRecords`' write-ack revocation is in-memory only and is not persisted unless something
  later calls `saveSettings()`. The downgrade round-trip restored `askWriteAckVersion: "2026-08-06"`
  and `outbox/pull` resumed. Defensible in that path (0.6.87 still ships that write wording) and the
  intended re-accept path does persist the clear — but the doc comment's "it can revoke" is weaker
  in practice than it reads. Not proven harmful.
- After an async push failure the Connect status line stays stale until a re-render. Cosmetic.

### Test coverage gaps

| Scenario | Missing test |
|---|---|
| Wipe leaves `askEnabled`/acks intact → next event re-uploads | `grep -rn "mirror/wipe\|expand-backfill" test/` → **0 hits**; `plusClient.test.ts` has no `askMirrorWipe` case |
| Clause (6) — Wipe removes expansions / outbox / tokens | nothing asserts the disclosure's own promise |
| Sign out of one identity, sign in as another | **no test anywhere.** `grep -rn "readAskMirrorEmail\|LS_ASK_MIRROR_EMAIL" src test` → src-only; every Ask test uses the single literal `user@example.com` |
| What sign-out clears | hashes, cached email and counts all survive, untested |
| Runtime gate depth | stale-version tests assert the `mirrorPermitted()` boolean only — none drives `sync({force:true})` under a stale version and asserts zero network, and none fires a real vault `modify` event under a stale ack |
| Consent path × network | no "ack still stamps offline", no "failed sync does not roll back", no `askEnabled` flipped mid-flight |
| Single-flight wedge | no test that a never-settling request wedges the mirror |

Already well covered: outbox refusal on orphaned/legacy write versions
(`askConsentVersion.test.ts:285,298`), downgrade and future-stamp reads
(`consentGate.adversarial.test.ts:249,262,447`), withdrawal mid-save
(`askAckAdversarial.test.ts:349`).

### Fixes applied / deferred

**None applied.** Every proven hole is pre-existing in code outside this diff; fixing them here
would widen a PR that is one gate from merge, and the fixes (binding mirror state to an account
generation; making Wipe disarm the mirror) are design decisions, not patches.

**Deferred by the owner on 2026-08-07, and filed:**

| Hole | Issue |
|---|---|
| P1-1 Wipe undoes itself | [#371](https://github.com/taihartman/obsidian-atoms/issues/371) |
| P1-2 consents inherited across accounts, P2-1 silently incomplete mirror | [#372](https://github.com/taihartman/obsidian-atoms/issues/372) |
| P2-2 unresponsive backend wedges the mirror | [#373](https://github.com/taihartman/obsidian-atoms/issues/373) |
| P2-3 status line ignores consent | [#374](https://github.com/taihartman/obsidian-atoms/issues/374) |

Agreed plan: merge #340 first so the seven-clause consent reaches devices, then fix these on their
own branch.

## Not tested

- **Server-side half of clause (6)** — whether the backend truly drops expansions and connector
  tokens. Out of reach from the client; only the client call is proven.
- **`plus-service` deployed to Fly** — not deployed, so search expansion is inert in production
  whatever the flag says. Separate act from merging; the owner drives it.
- **Connector OAuth tap-through** (`Connect Claude or ChatGPT`) — deliberately not clicked; it may
  launch a browser to a real host, leaving the sentinel's containment and the test-vault lane.
- **The Atoms home egress card's consent sheet** — `consent.ts` shares its strings with a second
  surface; only the Settings surface was driven.
- **Desktop-width rendering** of either sheet — the window was held at phone width for the run,
  because that is the only mode `dev:screenshot` can capture Settings in.
- **iOS / Android** — desktop only. Residual risk for mobile-specific sheet layout.
- **Real Anthropic egress** — no API key in play; classify paths never exercised.

## Merge decision

**Ready to merge on the change under test.** A–F all pass, the wording is byte-exact, the gate holds
against every malformed and adversarial state tried, and no bytes leave the device without a current
ack.

Blocking on the two P1s would be the wrong trade: they exist on `master` today, this PR does not
make either worse (it extends clause (6) by one item, which is honest about intent, not a new
defect), and holding it keeps every user on the older six-clause consent that does not mention
Anthropic search-expansion egress at all.

**Owner decided (2026-08-07):** merge #340; the five holes are filed as #371–#374 and fixed on their
own branch afterwards. Note that merging now also **ships a
Release automatically** (`beab58f`), so BRAT users get 0.6.87 with no separate step — which is the
faster propagation the accepted client-side-only-gate risk leans on.

## Vault lane

`test_vault/test vault` only, throughout. Remote Vault was never touched. All Plus traffic was pinned
to `127.0.0.1`. The vault was restored to its pristine `data.json` and the staged session cleared;
final state verified `{v:"0.6.87", plusBaseUrl:"", askEnabled:false, privV:"", writeV:"", session:""}`.
