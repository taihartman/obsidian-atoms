# World-Class QA: Even G2 Atoms companion

## Verdict

**Software and simulator QA are green. PR #623 must remain draft until Private/Beta installation, exact installed-package Origin, and physical G2 gates are complete.**

The deterministic Even Hub simulator exercised the real companion, pairing and disclosure handlers, Plus service in memory mode, provider boundary, mirror delivery, and receipt loop. It did not contact production or substitute for physical-glasses evidence.

## Scope and promises

V1 is Atoms Plus-only. A wearer can create an atom from speech after confirming its generated title, ask a grounded question and inspect its source, or browse recent atom bodies. Obsidian remains the source of truth, and the glasses show `Saved` only after a paired vault acknowledges the queued write.

| Surface | Observable acceptance | Result |
|---|---|---|
| Pairing and setup | Plus, mirror, write, and audio disclosure remain separate gates | PASS in contracts, settings UI, and simulator |
| New atom | Exact transcript, generated-title confirmation, one queued write, receipt-backed Saved | PASS live in simulator |
| Ask | Grounded answer, cited source body, explicit Return to answer and root | PASS live in simulator |
| Recent | Atom-only list, verbatim body, explicit Return to list and root | PASS live in simulator |
| Recovery and exit | Back/Return/Discard are truthful; exit stops audio, sockets, subscriptions, and harness children | PASS in tests and adversarial simulator QA |
| Privacy | Loopback-only harness; no credentials or raw PCM in console/package evidence | PASS |
| Release | Private artifact only until installed-package and physical-device evidence exists | BLOCKED by human/device gates |

## Product-loop evidence

- Pair/disclosure/root: the phone showed `G2 is ready`; the glasses showed `Atoms`, `New atom`, `Ask atoms`, and `Recent atoms`.
- Create: `Listening` -> `Create “Simulator capture”?` -> `Queued` -> `Saved`. Outbox `obx_3678efb0501992c80535242a911a73da` was acknowledged at `Atoms/Simulator capture--obx_3678efb0501992c80535242a911a73da.md`.
- Ask: `The Cobalt project ships on Friday.` -> `Cobalt launch` -> exact source body -> Return to answer -> explicit Return to root.
- Recent: list -> exact body -> Return to list -> explicit Return to root.
- Collision: a second `Simulator capture` produced `That title already exists` / `Try again`; it created no second row and did not overwrite the existing atom.
- Cancel and exit: Back -> Return restored recording; Back -> Discard returned to root; root double-click cleared the glasses framebuffer.
- Runtime: all listeners bound to `127.0.0.1`. One Ctrl-C stopped Plus, provider, Vite, the simulator launcher, and its native descendant; ports 8787, 8788, 5173, and 9898 were clear.
- Console: zero raw `[EvenAppBridge] EvenHub event:` entries. Primary flows had no warnings, errors, uncaught exceptions, or failed fetches. The deliberate collision produced one expected, handled 409 and no subsequent bad entries.

Committed simulator captures are in `docs/qa/screenshots/even-g2-simulator/`. Final constructive evidence is also retained for this run at `/tmp/even-g2-final-qa-fixed.DAtZ4k/`; adversarial evidence is at `/tmp/even-g2-adversarial-qa.rP4Cw6/`.

## Review and fixes

The single final code review found eight issues; all were addressed before QA:

1. Bind the Plus simulator service to loopback.
2. Rename the limited supporting-services check so it does not claim live simulator coverage.
3. Test the extracted production bootstrap directly.
4. Bound simulator HTTP requests and propagate caller cancellation.
5. Give simulator delivery rows stable, row-specific paths.
6. Remove a timing-race assertion from the provider test.
7. Probe recovery at the production recording bound.
8. Exercise setup polling and exhaustion.

Per the agreed workflow, fixes were not re-reviewed. No Grok or cross-model review ran for this change. QA then found and closed three additional holes: missing Return rows on populated answer/recent lists, the SDK's raw PCM event log, and orphaned simulator descendants after Ctrl-C. Each has regression coverage.

## Constructive QA

| Story | Result | Evidence |
|---|---|---|
| Pair and accept disclosure through real controls | PASS | Phone/root captures and server consent state |
| Create, confirm title, queue, and receive Saved receipt | PASS | Create captures plus outbox acknowledgement |
| Ask, open exact source, and return to root | PASS | Answer/source/Return captures |
| Browse Recent, open body, and return to root | PASS | Recent/body/Return captures |
| Reject duplicate title without overwrite | PASS | Collision screen and one-item Recent result |
| Cancel recording and exit safely | PASS | Discard/root/blank-frame captures |
| Preserve console visibility without PCM leakage | PASS | Console exports and focused log tests |

The decisive 576 x 288 answer view keeps the grounded answer readable while exposing both the source and a selected Return row. Labels fit, the selection border is visible, and no blank or clipped page was observed.

## Adversarial QA

Final verdict: **CLEAR**.

| Scenario | Result |
|---|---|
| Triple start and double stop | SOLID: one recording and one confirmation |
| Back during recording, then Return or Discard | SOLID: restored recording or clean root |
| Ask source/body/Return chain | SOLID |
| Recent body/Return chain | SOLID |
| Duplicate generated title | SOLID: truthful collision, no overwrite |
| Repeated actions and root double-click | SOLID |
| Raw PCM suppression while real warnings/errors remain visible | SOLID |
| One-signal harness shutdown with detached native descendant | SOLID after regression fix; one Ctrl-C, exit 0, no remaining PID/group/port |

## Automated evidence

- Root: 116 test files, 2,371 tests; build and lint pass.
- Plus service: 707 tests pass. The opt-in Postgres CI lane previously passed 794 tests, including encrypted transcript tamper detection.
- G2 companion: 128 tests pass; typecheck, production build, private package, package verification, simulator contract, and supporting-services check pass.
- Private package: 53,163 bytes before the final cleanup-only harness test additions; exact SDK pins, origins, permissions, CSP, and secret/simulator exclusion checks pass. The harness is not packaged.
- Security contract validation and generated-view determinism pass.

## Not tested

- Physical G2 microphone permission/audio quality, temple and R1 gesture feel, phone lock, interruption, foreground resume, thermal/battery, and reconnect behavior.
- Private/Beta `.ehpk` installation and the installed WebView's actual request `Origin`.
- End-to-end use with a real subscribed Plus account and a physical throwaway vault.
- Production provider credentials, deployment, spend caps, telemetry, rollback, or public Even Hub submission.

## Merge decision

Push the reviewed and simulator-tested changes to draft PR #623. Do not mark it ready, merge it, enable `G2_ENABLED`, or submit publicly until the unchecked Private/Beta and physical-device gates in `docs/g2-private-test.md` are complete.
