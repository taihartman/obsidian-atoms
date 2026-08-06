# #323 follow-up — code review of the fix that closes the first review's findings

Reviewed: `48fa63e..9ae4ed9` on `fix/ask-consent-cross-device` — the two commits that close
F1–F5 from [`2026-08-06-323-ce-code-review.md`](2026-08-06-323-ce-code-review.md).
456 executable changed lines across `src/plugin/askCoordinator.ts`, `src/plugin/main.ts`,
`src/settings/settings.ts`, and three test files.

## Verdict

**Ready with fixes — the fixes are applied.** One P0 was found in the new code and closed in
`6248b77`. Two smaller findings closed in the commit after it. What remains is a documented
residual, not a defect.

## Coverage

| Lens | Ran | Note |
|---|---|---|
| correctness | yes | dispatched, independent context |
| security | yes | dispatched, independent context |
| adversarial | yes | **in-process persona, not the cross-model peer** — see below |
| project-standards | **no** | budget; root `CLAUDE.md` applies and was not audited |
| testing | **no** | budget; the three reviewers that ran all returned test gaps anyway |
| learnings | **no** | budget; `read-modify-write-lost-update-synced-file.md` was read by hand instead |

**Reduced independence, disclosed.** The adversarial lens ran as a dispatched subagent rather
than the sanctioned cross-model peer. That was a deliberate call, not a failure: the `grok-cli`
route is buffered under `--json-schema`, so a run that exceeds `UNGUARDED_HARD_SECS` (600s) or
`PEER_MAX_TURNS` returns an empty string at full cost, and a cross-model pass had already run on
this branch's earlier commits. Three separate dispatched contexts is real independence; a
different *model* is not among them.

## F6 — P0 — a withdrawal could be lost to an unrelated local save (closed in `6248b77`)

Found independently by correctness (confidence 65) and adversarial (78); security reached a
related version at 80. Three contexts, one sequence:

1. The phone withdraws. Sync lands the cleared `data.json`.
2. `onExternalSettingsChange` snapshots `settingsGeneration` and starts `loadData()`.
3. Anything local saves mid-read. **This needs no user gesture** — `maybeAutoRun` merges
   `proposedTags` and saves on load, on an interval, and on every resume signal
   (`main.ts:1098`). `saveSettings()` bumps the generation *and* persists the whole in-memory
   object, which still holds the grant, straight over the withdrawal on disk.
4. The read resolves, the generation mismatches, the hook returns.

The withdrawal was then gone from memory and disk at once, and Sync would carry the resurrected
grant back to the device that revoked it.

The guard was right about its direction and wrong about its mechanism. Note the sting: **without
the guard, step 4 would have applied the withdrawal.** The fix for F2 made this case worse than
the code it replaced — a good argument for reviewing a fix as new code rather than as a patch.

Closed by `adoptExternalWithdrawal`: on a lost race, only an explicitly-falsy consent field
crosses, mutated in place so the winner keeps every other field, then persisted and followed by
`cancelPendingSync()`. A grant crosses in neither direction — not inferred from a losing read,
not revoked by one.

## F7 — P1 — the gate's own comment overstated it (closed in the follow-up commit)

The commit message and code comment called the `runSyncOnce` gate "the last check before the
upsert." It is not. After it, `runSyncOnce` still does four dynamic imports and then
`runAskMirrorSync`, which scans the vault, resolves hubs, and upserts **in chunks** with no
re-check between them. A withdrawal landing in that stretch still ships the rest of the pass.

The mid-pass abort was deliberately scoped out (see the handoff), and that is still the right
call — but the prose claimed a guarantee the mechanism does not provide, which is how the next
reader stops looking. Comment corrected to say what the gate does: it closes the follow-up pass,
per pass, not per request.

## F8 — P2 — `applyOutbox` kept its own copy of the predicate (closed)

`mirrorPermitted()` was introduced with the explicit rationale that a second copy is how a
future condition gets added to one gate and missed at the other — and `applyOutbox`, in the same
file and the same diff, still re-derived `askEnabled && askPrivacyAckAt` by hand. No live
divergence today, since the two conditions agree; the next change to the gate is when it bites.
Now `this.mirrorPermitted() && Boolean(askWriteAckAt)`.

## Residual risks — carried, not closed

1. **A pass already past the gate finishes.** #323 is narrowed to the follow-up loop, which was
   the reported defect. Closing the rest needs a live predicate threaded into `AskMirrorHost` and
   checked before each chunked `upsert`. Worth its own issue.
2. **Withdrawal does not purge what is already mirrored.** Pre-existing, and relevant to any user
   who reads "withdraw" as "delete my bodies from the server."
3. **A remote *grant* is adopted as silently as a remote withdrawal** on the non-race path, so a
   device can begin mirroring with no local gesture. Confirm that is the intended reading of a
   synced ack.
4. **The local same-device withdrawal does not call `cancelPendingSync()`.** Traced: costs at most
   one no-op follow-up that dies at the gate before any network call. A missed tidy, not a leak.

## Testing gaps still open

- No test drives a withdrawal landing *inside* a pass — between `scanAtoms` and `upsert`, or
  between two chunks. The current tests mock `runAskMirrorSync` to upsert once, so they cannot
  see that window. This is the test that residual risk 1 needs when someone closes it.
- No test drives `applyOutbox`'s multi-item loop with `askWriteAckAt` withdrawn mid-loop.

## What was sound

- The `mirrorPermitted()` gate on `runSyncOnce` genuinely closes the follow-up hole. Security
  traced every egress path — `sync`, `scheduleSync`, `runSyncOnce`, `applyOutbox`,
  `createOutboxHost`, the settings-tab handlers, and `platform/askMirror` — and found all of them
  reaching the predicate live at call time.
- The wipe-shape guard (F4) and the sheet settle (F5) survived all three reviewers untouched.
- No secrets, bodies, or full error objects logged anywhere in the diff.
- Every guard in the change is mutation-tested: nine mutations run, each killing only its own
  tests. That is how F6's second regression test was found to be necessary — the first one passed
  an over-restrictive mutation, so a second case was added.
