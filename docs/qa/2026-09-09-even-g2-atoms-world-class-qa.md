# World-Class QA: Even G2 Atoms companion

## Verdict

**Automated and locally drivable QA passed; merge-ready and public-release claims remain BLOCKED on live G2 evidence.** The first formal review findings are fixed, all runnable suites are green, the phone-width Obsidian setup surface passed a live drive, and the adversarial pass closed every reproducible software hole. The headline Create, Ask, Recent, microphone, gesture, background, and recovery workflows still require an active Even Hub simulator or physical G2.

This verdict permits updating the draft PR and private artifact. It does not permit marking the PR merge-ready or submitting publicly until the documented simulator, Private/Beta, and physical-device gates are complete.

## Charter

This pass covers the private Even Reality G2 companion, Plus pairing and consent, voice-to-atom confirmation, grounded recall, recent atom reading, local recovery, provider transport, and delivery receipts. The core promise is that a Plus subscriber can speak an exact atom body, confirm its generated title, and see Saved only after Obsidian has applied the queued write; Ask and Recent must expose only bounded, source-backed vault content.

The live drive used the documented throwaway Obsidian vault and a local fake Plus session for settings chrome. It did not plant atoms as product proof, contact production Plus, or treat a browser render as an Even Hub bridge.

## Preflight

- Product dogfood honesty: PASS. Read `docs/qa/README.md` and preserved the product-loop versus fixture boundary.
- Authority: `docs/plans/2026-09-08-2216-feat-even-g2-atoms-plan.md`, `docs/plans/2026-09-08-even-g2-atoms-design.md`, `docs/g2-private-test.md`, and `STATUS.md`.
- Learnings: PASS. Read `docs/qa/learnings.md`; applied the vault-lock, phone-viewport, loaded-plugin, bundle-fingerprint, and three-capture safeguards. No new reusable drive trap was discovered.
- Navigation map: PASS for Settings -> Atoms -> Connect Claude or ChatGPT. No live glasses route is available in this environment.
- Commands: root `npm test`, `npm run build`, `npm run lint`; Plus `npm test`; companion `npm test`, `npm run typecheck`, `npm run build`, `npm run package`, `npm run package:verify`, `npm run simulator:contract`; security contract validation and generated-view check.
- Viewport/device: Obsidian phone mode at 390 x 844 CSS pixels. No active Even Hub simulator session or attached physical G2.
- Auth/fixture: documented fake Plus local-storage session in `test_vault/test vault/`; no credential, token, personal-vault content, or production data recorded.
- Deploy reality: no production deployment. `G2_ENABLED=0` remains the safe default until exact installed-package Origin and provider controls are verified.

## Authority and promises

| Surface | Promise | Observable acceptance | Evidence |
|---|---|---|---|
| Settings: Even G2 | R1-R3: Plus, disclosure, mirror, and write consent remain separate gates | Inactive Plus cannot pair; active Plus shows setup state and pairing action | Live phone-width drive + settings tests |
| Root: New atom | R4-R8: exact transcript, generated title, explicit confirmation, receipt-backed save | Speech reaches exact-title confirmation; one confirmation queues one item; Saved waits for a vault receipt | Automated and adversarial tests; live G2 blocked |
| Root: Ask | R9-R11: answer only from exact fetched evidence | Strong evidence yields an answer and sources; weak/conflicting evidence yields closest matches | Automated tests; live G2 blocked |
| Root: Recent | R10: atom-only recent list and bounded verbatim fetch | Recent excludes non-atoms; body paging preserves UTF-8 content exactly | Automated tests; live G2 blocked |
| Recovery and exit | R12-R13: monotonic recovery and lifecycle cleanup | Back, discard, socket loss, restart, revoke, and consent withdrawal cannot leak audio or silently lose staged work | Automated tests + focused adversarial repros |
| Release | R14-R16: private artifact only until human evidence exists | Package is deterministic and secret-free; public submission stays unchecked until all live gates pass | Package verification + private checklist |

## Shipped targets

Interactive targets: phone pairing, disclosure acceptance, reconnect and disconnect; glasses New atom, Ask atoms, Recent atoms; confirm/cancel; retry/reconnect/wait/return/discard; source/recent selection; pagination/back; refresh; and system exit.

Informational targets: unpaired, setup required, recording, transcribing, preparing, confirmation, queued, saved, answer, closest matches, recent, empty, body, error, pending writes, connected-device state, and plugin version.

## Product loop versus fixture

| Story | Proof kind | Result |
|---|---|---|
| G2 Settings in active and inactive Plus states | UI-chrome-only local fixture | PASS |
| Create an atom from glasses speech | User loop | NOT TESTED: no live simulator or physical G2 |
| Ask and open a grounded source | User loop | NOT TESTED: no live simulator or physical G2 |
| Open Recent and page an atom body | User loop | NOT TESTED: no live simulator or physical G2 |
| Auth, storage, recovery, query, receipt, and package contracts | Fixture/plumbing | PASS |

## User stories tested

- As an inactive Plus member, I can tell why G2 pairing is unavailable without losing the product name. Acceptance: `Even G2` and `Atoms Plus required.` remain readable at phone width. Evidence: `/tmp/even-g2-qa/04-inactive-copy-fix-3.png`. Status: PASS.
- As an active Plus member who has not finished consent, I see Setup required, Get code, and Connected glasses without an automatic network action. Evidence: `/tmp/even-g2-qa/02-connect-top-3.png` and zero recorded fetches. Status: PASS, UI chrome only.
- As a G2 wearer, I can create one atom from my exact spoken words only after confirming the generated title. Evidence: companion/Plus tests and adversarial state repros. Status: NOT TESTED live.
- As a G2 wearer, I can ask my atoms and inspect a cited source or closest matches without unsupported synthesis. Evidence: Plus query tests. Status: NOT TESTED live.
- As a returning wearer, interrupted recording, transcription, preparation, commit, and delivery retain or discard exactly the documented state. Evidence: recovery suites and focused adversarial repros. Status: PASS in automation; NOT TESTED on hardware lifecycle.

## Risk matrix

| Class | Obligation | Result |
|---|---|---|
| Happy | Pair, Create, confirm, receipt, Ask, Recent | Automated PASS; live G2 NOT TESTED |
| Negative | Inactive Plus, denied mic, revoked device, withdrawn consent, weak evidence | PASS in UI/automation/adversarial repros |
| Edge | Two-minute audio, empty PCM, UTF-8 paging, title collision, unknown receipt, queue age | PASS in automation |
| Re-entry | Rapid New, Back during startup, Return/Discard, reconnect, cold recovery | PASS after pending-start privacy fix |
| Regression | Existing Ask/MCP, mirror, outbox, settings, catch-up | Root and Plus full suites PASS |
| Perception | Setup vs Ready, queued vs Saved, visible action behavior, inactive copy | Driven Settings PASS; glasses display NOT TESTED |
| Security | Revocation and consent stop content at every provider/read/write seam | PASS in contract and adversarial repros |
| Accessibility/craft | Phone-width name, controls, hierarchy, clipping | PASS for driven Settings subset; glasses UI NOT TESTED |

## Evidence

- Root: 116 files, 2,371 tests passed; build and lint passed after merging current `master`.
- Plus service: 705 tests passed after merging current `master`. Focused adversarial G2/Ask set: 82 passed.
- G2 companion: 11 files, 78 tests passed; typecheck and production build passed.
- Package: `atoms-g2.ehpk` verified at 52,774 bytes with exact SDK pins, origins, permissions, CSP, and no secret-like material.
- Simulator contract: pinned `@evenrealities/evenhub-simulator` 0.9.5 input, console, and 576 x 288 screenshot API contract passed. This is not a live simulator drive.
- Security contract: matrix validation passed; generated view includes `G2_SETUP_STATUS_015` and matches its YAML source.
- Settings live drive: version 0.8.20, loaded-plugin and installed-bundle checks passed, with zero `window.error`, `unhandledrejection`, `console.error`, or fetch attempts.
- Craft: `/tmp/even-g2-qa/04-inactive-copy-fix-3.png` has readable hierarchy, adequate row/control size, clear spacing, and no clipping or stacked-chrome collision in the decisive G2 row.
- Live Postgres opt-in tests were not run because `TEST_DATABASE_URL` is unavailable locally; CI owns that configured lane.

## Findings

### Fixed before and during this pass

- All 15 findings from the first formal review were addressed: durable authorization rechecks, atomic consent/write enforcement, transient-safe token refresh, bounded client/provider deadlines, pairing/disclosure/boot single-flight, retry/reconnect/wait/discard behavior, recording startup and denied-mic cleanup, durable transcript recovery, incremental encrypted chunks, serialized rendering, unknown receipt recovery, and indexed source fetches.
- Adversarial QA found Back during a pending recording start could return to root while audio later activated invisibly. A test-first generation/cancellation fix now keeps root stable, stops and discards once, and preserves the normal start path.
- Phone-width inactive Plus copy now renders `Even G2` and `Atoms Plus required.` without clipping.

### Open software findings

None from the completed first review and runnable QA pass.

## Adversarial QA

**CLEAR for runnable software scenarios.** Every original hole and the newly discovered pending-start Back hole was proved closed on the current tree.

| Scenario | Result | Evidence |
|---|---|---|
| Repeated New during startup | SOLID | Re-entry ignored; start/stop ordering remains valid |
| Back during pending startup | SOLID | Root stable, microphone inactive, one cancellation/discard; normal start still records |
| Recording Return then Discard | SOLID | Return preserves recording; Discard cancels exactly once |
| Denied microphone and late PCM | SOLID | Transport/recovery tear down; late PCM ignored |
| Transient refresh, expired bearer, and 401 retry | SOLID | Credentials preserved, refresh precedes send, one retry only |
| Cross-instance revoke during PCM/provider work | SOLID | No provider egress; final state revoked |
| Consent withdrawal at enqueue | SOLID | Zero enqueues; setup required |
| Transcript crash/restart/preparation retry | SOLID | Transcript retained without retranscription |
| Duplicate pair/disclosure/boot and concurrent render | SOLID | Single-flight and request ordering preserved |
| Unknown receipt, Wait, retry, reconnect, discard | SOLID | Operation context and recoverability preserved |
| Empty/max PCM and UTF-8 paging | SOLID | Bounds and verbatim content preserved |
| Live gesture, microphone, display, lock/background behavior | BLOCKED | Requires simulator or physical G2 |

Focused post-fix proof: lifecycle 9/9 passed; the temporary integration repro reported `finalScreen=root`, microphone inactive, one cancellation, one journal discard, and one transport teardown. The normal path reported `finalScreen=recording` with microphone active.

## Not tested

- Live Even Hub simulator rendering, gestures, screenshots, and console export.
- Physical G2 microphone permission/audio quality, temple/R1 gestures, phone lock, interruptions, five-minute foreground resume, two-minute idle, thermal/battery, and reconnect behavior.
- Private/Beta `.ehpk` installation and the installed WebView's actual request `Origin`.
- End-to-end pairing with a real subscribed Plus account.
- Provider-backed voice transcription or metadata generation with private credentials.
- Mirror-confirmed vault receipt loop on a paired throwaway vault.
- Production deployment, key rotation, spend caps, telemetry dashboards, rollback, and live Postgres without `TEST_DATABASE_URL`.

## Learnings

Consulted `docs/qa/learnings.md`. No navigation, fixture, screenshot, or environment trap was discovered that warranted a new row; the pending-start issue is captured directly by its regression test.

## Merge decision

Keep PR #623 **draft / not merge-ready** until the live simulator and physical/private-device checklist is completed. The reviewed implementation, automated contracts, local settings drive, private package, and adversarial software scenarios are green. Public Even submission remains a separate human gate.
