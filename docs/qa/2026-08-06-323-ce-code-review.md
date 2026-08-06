# Code review — #323 cross-device consent fix (PR #330)

**Verdict: Not ready to merge.** The fix is directionally right and its mechanism works, but it
closes the gate for *future* egress entries only. An in-flight or already-scheduled mirror pass
still uploads note bodies after the withdrawal lands, and the tests assert a proxy that stays
green while that happens.

Branch `fix/ask-consent-cross-device` @ `1b069b8`, base `19bc489`.

## Coverage

| Lens | Ran | Note |
|---|---|---|
| correctness | yes | session model |
| security | yes | session model; privacy/consent posture |
| adversarial | yes — **cross-model** | `grok-cli`, `model_requested: grok-4.5`, `effort_requested: high`, `model_actual: unverified`, `effort_actual: unverified`, `receipt_supported: false`, `independence_verified: true` |
| testing | **not run** | reduced roster, session budget; both local reviewers and the peer covered the test gap independently |
| project-standards | **not run** | reduced roster |
| learnings | **not run** | reduced roster. The corpus hit that motivated selecting it — `docs/solutions/logic-errors/read-modify-write-lost-update-synced-file.md` — describes the exact race two reviewers found independently. Read it before fixing F2. |

Three reviewers ran in genuinely separate contexts; the peer's `independence_verified: true`
attests a different serving family, so convergence below is real corroboration, not one model
agreeing with itself. Untracked files: none. Fast pass: no urgent candidates, none withdrawn.

## Findings

### F1 — P1 — A withdrawal mid-pass still uploads note bodies

`src/plugin/askCoordinator.ts:234` (`runSyncOnce`) has **no consent gate**. The only check is in
`sync()` at :212, before the single-flight begins. `src/plugin/catchUp.ts:74-88` then runs
follow-up passes in a `do { await host.once(...) } while (s.followUp)` loop that never re-enters
`sync()`.

The concrete sequence, from the cross-model pass (confidence 100):

1. `sync()` passes the gate; `inFlight = true`; `runSyncOnce` starts upserting.
2. A vault edit calls `scheduleSync`, which still sees consent, so `followUp = true`.
3. The phone's withdrawal arrives; `onExternalSettingsChange` replaces `plugin.settings`.
4. The first pass finishes.
5. `while (followUp)` runs `runSyncOnce` **again** and uploads bodies under revoked consent.

All three reviewers reached this independently. **This is why the PR is not ready:** #330 narrows
the bypass window rather than closing it, and the PR body currently claims the stronger result.

Fix: gate `runSyncOnce` itself, and on a withdrawal observed by the hook, clear
`askMirrorFlight.followUp` / `forceFollowUp`, cancel `askMirrorDebounceTimer`, and set
`askMirrorDirty = false` so no second pass is owed. Aborting an in-flight HTTP upsert mid-body is
the ideal and is a larger change; the re-check alone stops the post-withdrawal follow-up.

### F2 — P1 — External reload can clobber an in-flight local withdrawal

`main.ts:1440`. Local ack writes mutate in place then `await saveSettings()`. The hook can resolve
`loadData()` during that window and re-point `this.settings` at the pre-withdrawal copy — leaving
memory *more permissive than disk*. The next `saveSettings()` then persists the resurrected grant
back through Sync to every device.

Two reviewers, both at confidence 50 (neither could drive it deterministically). It is the classic
read-modify-write lost update on a synced file, which this repo has already documented at
`docs/solutions/logic-errors/read-modify-write-lost-update-synced-file.md`.

Fix: serialize the two writers — track the in-flight save on the plugin and drain it at the top of
the hook, or use a generation counter bumped by `saveSettings()` and re-checked after the load.

### F3 — P2 — `main.ts:247` aliases `plugin.settings`, contradicting the stated invariant

```
      settings: this.settings,
```

Passed into `signInHandoff.ready()` at load. `plusSignIn.ts:365` stores that host permanently
(`host = next`), and `plusSignIn.ts:231` reads `host.settings.plusBaseUrl` at token-exchange time.
Because `loadSettings()` **replaces** the object rather than mutating it, the sign-in path keeps
reading the startup copy forever after any reload.

All three reviewers found it. The consent acks are not reachable through this alias, so it is not
itself a bypass — but the code comment I added declares "never alias `plugin.settings`" as the
invariant that makes the fix work, and this is a live violation of it sitting in the same file.
Either fix the alias or stop claiming the invariant.

Fix: pass a live getter facade rather than the object by value.

### F4 — P1 — A non-throwing empty read wipes every setting at runtime

`main.ts:1416`: `const raw = ((await this.loadData()) ?? {}) as Partial<LinkerSettings>;`

The `?? {}` is correct at startup (fresh install). Reached from the hook it means a `data.json`
that reads as null/undefined — not a throw, so the catch never sees it — silently replaces every
setting with `DEFAULT_SETTINGS` at runtime, and the next save persists that wipe to every device.
Consent fails closed, which is the safe direction, but `plusBaseUrl`, `atomFolder`, and the active
vocabulary are all lost.

The unreadable-file test only covers the *throwing* shape — the one the catch already handles.

Fix: have the hook reject a wipe-shaped read (`raw == null || typeof raw !== "object"`) before
applying, extracting the shared merge tail so only startup keeps `?? {}`.

### F5 — P3 — An open consent sheet survives an external refresh

`settings.ts:565`. `refreshFromExternalSettings()` only calls `redisplay()`, while `hide()` settles
an open sheet with `this.openSheet?.close()`. A Review/grant modal can therefore stay open above a
rebuilt Settings DOM that already reflects the remote withdrawal, so the user acts on a sheet whose
underlying state was replaced mid-decision.

Fix: close `openSheet` in `refreshFromExternalSettings` the way `hide()` does, then redisplay.

## The test problem, stated plainly

`test/askConsentCrossDevice.test.ts` asserts `plugin.settings.askPrivacyAckAt === ""` and a fake
tab's refresh counter. It never constructs `AskCoordinator`, never calls `scheduleSync`/`sync`
after a withdrawal, and never observes a refused push.

So the production failure mode is *post-withdrawal body upload*, and the tests assert a **proxy**
for it that can be true while that upload still runs. The mutation testing I did proves the reload
mechanism works; it does not touch the safety property. That is the silent-pass shape — a green
check about something adjacent to what matters.

Any fix for F1 must land with a test that drives a real egress path: stub the network upsert, run
the withdrawal through the hook, and assert no upsert occurs — plus the follow-up case, where a
pass is already in flight with `followUp` set.

## Residual risks worth recording

- Withdrawal purges nothing already mirrored to Plus. Pre-existing and consistent across local and
  remote paths, so not a regression — but a user reading "withdraw" as "delete my bodies from the
  server" is not served by either path.
- A remote *grant* is adopted as silently as a remote withdrawal, so a device can begin mirroring
  with no gesture on that device. Confirm that is the intended reading of the ack.
- Mixed-version write ping-pong: the legacy Ask-hash strip saves on load; with the hook installed,
  an older device that rewrites the key produces an external change here, which strips and saves,
  which is an external change there. Bounded per write, unbounded across a mixed-version pair.
- `JSON.stringify` equality gates only the re-render, never whether settings are applied, and it
  can produce false *inequality* but not false equality. A stale screen is its worst case, not a
  stale gate.

## What was sound

The diagnosis and the mechanism. `onExternalSettingsChange` was genuinely absent, `loadData()`
genuinely had one call site, and implementing the hook is the right fix for the part it addresses.
The re-render skip guard and the deliberate non-invention of a blank withdrawal both survived
adversarial review. The gap is scope, not direction: the hook closes the front door while the
follow-up loop keeps a side door open.
