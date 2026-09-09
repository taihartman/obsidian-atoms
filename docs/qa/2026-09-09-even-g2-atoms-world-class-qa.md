# World-Class QA: Even G2 Atoms companion

## Verdict

**BLOCKED for merge-ready or public-release claims.** The final branch is green in automated verification, and the Obsidian settings subset passed a live phone-width drive after one copy fix. The headline Create / Ask / Recent loop was not exercised in an Even Hub simulator session or on physical G2 glasses. The formal review also left security, recovery, and concurrency findings that require human judgment or a non-mechanical implementation pass.

This verdict does not block opening or updating the draft PR. It blocks marking that PR merge-ready and blocks public Even submission.

## Charter

This pass covers the private Even Reality G2 companion, its Plus pairing and consent surface, voice-to-atom confirmation, grounded recall, local recovery, Plus-service transport, and delivery receipts. The primary workflow is: pair a Plus account, choose New atom or Ask, speak, confirm creation when applicable, and see only receipt-backed or source-grounded output.

The live drive used the documented throwaway Obsidian vault and a local fake Plus session only to render settings chrome. It did not use planted atoms as product proof, call production Plus, mint a pairing code, or claim that a generic browser proves the Even Hub bridge.

## Preflight

- Product dogfood honesty: PASS. `docs/qa/README.md` contains the required product-proof boundary.
- Authority paths: `docs/plans/2026-09-08-2216-feat-even-g2-atoms-plan.md`, `docs/plans/2026-09-08-even-g2-atoms-design.md`, `docs/g2-private-test.md`, `STATUS.md`.
- Learnings: PASS. Read `docs/qa/learnings.md`; applied the vault-lock, phone-viewport, loaded-plugin, bundle-fingerprint, and three-capture safeguards.
- Navigation map: PASS for Settings -> Atoms -> Connect Claude or ChatGPT. The glasses route has no mapped live harness in this environment.
- Run commands: `npm test`, `npm run lint`, `npm run build`; Plus `npm test`; companion `npm test`, `npm run typecheck`, `npm run build`, `npm run package`, `npm run package:verify`, `npm run simulator:contract`.
- Viewport/device: Obsidian phone mode at 390 x 844 CSS pixels, DPR 2. No physical G2 or active Even Hub simulator session was available.
- Auth path: documented fake Plus local-storage session, restored after the pass. No credential, token, or personal vault data was recorded.
- Fixture: `test_vault/test vault/`; vault lock acquired and released. Source and installed `main.js` hashes matched.
- Browser automation: the LFG browser stage was blocked before route exercise. No approved `agent-browser` binary was installed, and a generic page cannot supply `waitForEvenAppBridge()`.
- Deploy reality: no production deployment was performed. G2 stays feature-off by default; private origin/provider/retention configuration and real package origin remain operator gates.

## Authority and promises

| Surface | Promise | Observable acceptance | Evidence |
|---|---|---|---|
| Settings: Even G2 | R1-R3: Plus and each consent remain separate gates | Inactive Plus cannot pair; active Plus shows setup state and a short-lived code action | Live UI-chrome drive + settings tests |
| Root: New atom | R4-R8: exact transcript, generated title, explicit confirmation, receipt-backed save | Speech reaches a title confirmation; one confirmation creates one queued item; Saved appears only after the vault receipt | Automated tests; live G2 blocked |
| Root: Ask | R9-R11: answer only from exact fetched evidence | Strong evidence shows answer plus sources; weak/conflicting evidence shows closest matches | Automated tests; live G2 blocked |
| Root: Recent | R10: atom-only recent list and bounded verbatim fetch | Recent excludes non-atoms; opening a result pages UTF-8 text without rewriting it | Automated tests; live G2 blocked |
| Recovery and exit | R12-R13: monotonic recovery and lifecycle cleanup | Background, revoke, disclosure withdrawal, socket loss, and cold start preserve or discard exactly the documented state | Partial automated proof; review residuals remain |
| Release | R14-R16: private artifact only until human evidence exists | Package is deterministic and secret-free; public submission remains unchecked until Private/Beta and physical-G2 checks pass | Package verification + private checklist |

## Shipped targets

Interactive targets in scope: phone pairing form, disclosure acceptance, reconnect; glasses New atom, Ask, Recent; create/cancel confirmation; retry/reconnect/wait/return/discard actions; source and recent selection; body pagination/back; device refresh/disconnect; system exit.

Informational targets in scope: unpaired, setup required, recording, transcribing, preparing, confirmation, queued, saved, answer, closest matches, recent, empty, body, error, pending-write count, connected-device state, and plugin version.

## Product loop versus fixture

| Story | Proof kind | Result |
|---|---|---|
| G2 Settings in active and inactive Plus states | UI-chrome-only local fixture | PASS after copy fix |
| Create an atom from glasses speech | User loop | NOT TESTED: no simulator session or physical G2 |
| Ask and open a grounded source | User loop | NOT TESTED: no simulator session or physical G2 |
| Open Recent and page an atom body | User loop | NOT TESTED: no simulator session or physical G2 |
| Transport, auth, storage, query, and receipt contracts | Fixture/plumbing | PASS in automated suites, subject to review residuals |

## User stories tested

- As an inactive Plus member, I can tell why G2 pairing is unavailable without losing the product name. Acceptance: the row shows `Even G2` and `Atoms Plus required.` at phone width. Evidence: `/tmp/even-g2-qa/04-inactive-copy-fix-3.png`. Status: PASS.
- As an active Plus member who has not finished consent, I see Setup required, Get code, and an empty Connected glasses state. Acceptance: all three are visible, unclipped, and no action runs by itself. Evidence: `/tmp/even-g2-qa/02-connect-top-3.png`; zero recorded fetches. Status: PASS, UI chrome only.
- As a G2 wearer, I can create one atom from my exact spoken words after confirming its title. Acceptance: Create confirmation preserves the canonical title and Saved waits for a receipt. Evidence: companion and Plus tests. Status: NOT TESTED live.
- As a G2 wearer, I can ask my atoms and inspect the cited source or closest matches. Acceptance: answers contain only exact fetched evidence and weak/conflicting evidence does not become an answer. Evidence: Plus query tests. Status: NOT TESTED live.
- As a returning wearer, I can recover interrupted recording, preparation, commit, and delivery without silent loss. Acceptance: recovery is monotonic across cold start and revocation. Evidence: partial automated tests. Status: FAILED readiness because formal-review recovery and race findings remain.

## Risk matrix

| Class | Obligation | Result |
|---|---|---|
| Happy | Pair, Create, confirm, receipt, Ask, Recent | Automated PASS; live G2 NOT TESTED |
| Negative | Inactive Plus, denied microphone, revoked device, withdrawn disclosure, weak evidence | Inactive UI PASS; remaining paths automated/blocked, with review findings |
| Edge | Two-minute audio, UTF-8 pagination, title collision, unknown receipt, queue age | Automated PASS; storage-cost and recovery risks remain |
| Regression | Existing Ask/MCP, mirror, outbox, settings, catch-up | 2,367 root tests + 688 Plus tests PASS |
| Perception | Setup vs Ready, queued vs saved, visible retry meaning, inactive copy | Settings PASS after fix; error-action finding remains |
| Promise | On-screen action reaches the stated continuation | FAILED readiness: error actions currently return to root |
| Security | Revocation and consent stop content at every egress/write seam | FAILED readiness: cross-instance socket and commit race findings remain |
| Accessibility/craft | Phone-width name, controls, hierarchy, clipping | PASS for driven Settings subset; glasses UI NOT TESTED |

## Evidence

- Root: 116 files, 2,367 tests passed; `npm run lint` and `npm run build` passed.
- Plus service: 688 tests passed, including the post-review finalize regression.
- G2 companion: 11 files, 49 tests passed; typecheck and Vite production build passed.
- Package: `atoms-g2.ehpk` verified at 49,499 bytes with exact SDK pins, origins, permissions, CSP, and no secret-like material.
- Simulator contract: pinned `@evenrealities/evenhub-simulator` 0.9.5 API check passed. This is not a live simulator drive.
- Security contract: validate, generated view, and checked diff passed.
- Settings live drive: version 0.8.20, loaded-plugin check, installed-bundle hash equality, zero `window.error`, `unhandledrejection`, `console.error`, or fetch attempts.
- Screenshots: `/tmp/even-g2-qa/01-main-3.png`, `/tmp/even-g2-qa/02-connect-top-3.png`, `/tmp/even-g2-qa/04-inactive-copy-fix-3.png`.
- Live Postgres opt-in rows were not run because `TEST_DATABASE_URL` was unavailable locally; CI remains configured to fail closed when that lane is expected.

## Findings

### Fixed in this pass

- Phone-width inactive Plus copy clipped `Even G2` to `Ev... / G2`. Changed the status to `Atoms Plus required.`, added a settings assertion, and re-drove the exact 390 x 844 state successfully.
- GitHub's Node 24 runner cancelled the metadata timeout test because the only deadline timer was unreferenced. Kept metadata and query deadline timers alive until the model request settles; both focused suites pass under local Node 26.

### Open review findings

- P0: an already-open socket on another service instance can outlive device revocation or disclosure withdrawal because subsequent PCM/finalize work lacks a durable live-authorization recheck.
- P1: consent can be withdrawn between the commit gate and outbox enqueue.
- P1: completed transcription can lose its resumable state before preparation becomes durable.
- P1: visible retry/reconnect/wait/discard actions currently return to root instead of performing their labels.
- P1: refresh-token, token-expiry, denied-microphone, repeated-gesture, duplicate-boot, render serialization, HTTP/provider deadline, incremental-journal, and selected-source lookup findings remain in the PR checklist.

The full validated list and suggested fixes are carried under `## Unapplied review findings` in PR #623.

## Adversarial QA

**FAILED: seven proven holes remain.** Each hole matches a validated formal-review finding; the adversarial pass did not prove a new defect class.

| Scenario | Result | Evidence |
|---|---|---|
| Double/triple New atom during startup | HOLED | Stop can run before recording start resolves |
| Microphone denial and late PCM | HOLED | Denial throws while the live session can still journal a later chunk |
| Transient refresh and expired access token | HOLED | Network failure purges credentials; an expired bearer is sent |
| Retry/reconnect/wait actions | HOLED | Primary error action returns to root without retrying |
| Transcript-to-preparation crash seam | HOLED | Audio journal is deleted before failed preparation becomes durable |
| Cross-instance revocation | HOLED (P0) | Worker B revokes while worker A still completes provider transcription |
| Consent withdrawal during commit | HOLED | Consent is false while one enqueue still completes as `queued` |
| Duplicate pairing/disclosure/boot | BLOCKED | No single-flight guard, but no live or failing user-visible repro |
| Confirm idempotency, unknown receipts, stale sources | SOLID | Existing exact-key and state-transition tests passed; truly concurrent different-key title creation remains unproven |
| Two-minute and UTF-8 pagination boundaries | SOLID | Byte cap and empty/long/multibyte page preservation passed |
| Recovery and query scale | SUSPECTED | Whole-journal append cost and account-wide Postgres lookup were not measured with production-scale/live Postgres data |
| Public release boundary | BLOCKED | Private/Beta, live simulator, and physical-G2 evidence are absent |

The read-only pass ran all 49 companion tests and 72 focused Plus G2/Ask tests, plus isolated repro harnesses for the seven holes. No fixes were applied during adversarial QA. Because these holes are neither fixed nor explicitly accepted, the adversarial gate remains failed.

## Not tested

- Even Hub simulator rendering, gesture input, and screenshot capture.
- Physical G2 microphone permission, audio quality, lock-screen behavior, interruption, idle, thermal, battery, and reconnect behavior.
- Private/Beta package installation and its actual WebView Origin header.
- End-to-end Plus pairing with a real subscribed account.
- Provider-backed voice transcription or metadata generation with private G2 credentials.
- Mirror-confirmed vault receipt loop on a paired throwaway vault.
- Production deployment, key rotation, spend caps, telemetry dashboards, and rollback.
- Live Postgres migration/store lane without `TEST_DATABASE_URL`.

## Merge decision

Keep PR #623 **draft / not ready**. Automated implementation and package gates are green, and the driven Settings surface is visually sound. Resolve or explicitly accept the validated security, recovery, and concurrency findings, then run the Private/Beta and physical-G2 checklist before marking the integration merge-ready. Public Even submission remains a separate human gate.
