---
module: plugin/askCoordinator
tags: [ask-mirror, data-loss, guards, confirm-dialog, optional-interface, test-doubles]
problem_type: logic-error
date: 2026-08-04
issue: 246
---

# A safety hook that was declared, tested, and never wired

## The problem

`AskMirrorHost.cancelConfirm` shipped in #248/#249 as the fix for an irreversible-delete dialog that
outlives its own promise. It had a type declaration, a call site, a doc comment explaining exactly
why a UI host must implement it, and passing tests. It did nothing in the running plugin for a week,
because no production host implemented it.

The mirror deletion gate asks the user before it deletes cloud rows, through
`confirmWithTimeout` (`src/platform/askMirror.ts`):

```ts
const timedOut = /* 2-minute race */;
if (timedOut) host.cancelConfirm?.();
```

The `?.` is load-bearing and is also the whole bug. The hook is *optional* on the interface — a host
that cannot cancel still compiles — so the one host that shows real UI could silently not have it.
That host was this block in `main.ts`:

```ts
confirm: (request) =>
  new Promise((resolve) => {
    new AskMirrorDeleteConfirmModal(this.app, request, resolve).open();
  }),
// ...and nothing else. No cancelConfirm.
```

So after two minutes the gate stopped waiting and returned `refused`, while the modal stayed on
screen still offering **Delete from cloud**. Tapping it resolved an already-settled promise: the
user authorised an irreversible delete and nothing whatsoever happened — the one outcome an
irreversible-delete prompt must never produce.

## Symptoms

- A mirror-deletion confirmation dialog left open for more than 2 minutes stays on screen and stays
  clickable.
- Clicking **Delete from cloud** on such a dialog does nothing at all: no delete request, no toast,
  no error. The sync has already ended.
- Nothing fails. Tests are green, the build is clean, and the type declaration reads as if the
  behavior exists.

## What didn't work

**The unit tests did not catch it, and could not have.** `test/askMirrorGate.adversarial.test.ts`
covers the confirm lifecycle thoroughly — against a *fake* host object defined in the test file. The
fake implements `cancelConfirm`, so the gate's side of the contract is proven and the production
side is never touched. A test double satisfying an optional member is indistinguishable, from inside
the test, from a codebase where every real implementation satisfies it too.

**Reading the type did not catch it either.** The declaration carries a five-line comment saying a
host whose `confirm` shows UI *must* implement this. A comment is not a compiler. `cancelConfirm?:`
means the type system will never ask.

**Grep would have caught it in seconds — nobody ran one.** `grep -rn cancelConfirm src/` returns the
declaration, the call site, and no implementation. That asymmetry is the entire tell.

## The fix

The host retains the modal instance and closes it on withdrawal
(`src/plugin/askCoordinator.ts`):

```ts
let pendingConfirmModal: InstanceType<typeof AskMirrorDeleteConfirmModal> | null = null;

confirm: (request) =>
  new Promise((resolve) => {
    try {
      pendingConfirmModal = new AskMirrorDeleteConfirmModal(p.app, request, (choice) => {
        pendingConfirmModal = null;
        resolve(choice);
      });
      pendingConfirmModal.open();
    } catch {
      pendingConfirmModal = null;
      resolve("dismissed");
    }
  }),
cancelConfirm: () => {
  pendingConfirmModal?.close();
  pendingConfirmModal = null;
},
```

`pendingConfirmModal` is a local inside the sync pass, not a field on the coordinator, so it cannot
leak across passes. Closing the real modal re-enters `onClose() -> answer("dismissed") -> onVerdict`,
which is idempotent behind the modal's own `answered` flag, so the re-entrancy is harmless.

The regression test pins the **production** host object rather than a fake
(`test/askCoordinator.test.ts`): it stubs `runAskMirrorSync` to capture the host the coordinator
actually builds, then asserts `cancelConfirm` exists, closes the modal `confirm` opened, and is a
no-op when nothing is open. Deleting the hook from the host fails 3 of those tests — verified by
mutation, which is the only evidence that a test about a missing thing can actually fail.

Live evidence (`docs/qa/2026-08-04-mirror-gate-stricter-floor-smoke.md`): with the modal open on a
real vault, the run was left untouched for 125 seconds. The dialog closed itself, the pass returned
`{kind:"refused", reason:"scan-incomplete"}`, and the request log showed zero delete and zero
reconcile calls.

## Why this works

The gate could always cancel; it just had no one to cancel *through*. Wiring the real host closes
the loop the type always described.

The deeper reason this went unnoticed for a week is worth naming: **the fix and the only host that
had to implement it were in different pull requests.** #248 wrote the hook while #247 was already in
flight relocating the confirm host out of `main.ts`. Whoever landed the hook could not wire it
without conflicting with the open refactor, and the refactor did not know it had inherited an
obligation. The gap was structural, not careless.

## Prevention

**Grep for implementations, not declarations, whenever an optional member is a safety hook.** The
check is one line and belongs in the same PR that adds the hook:

```bash
grep -rn "cancelConfirm" src/          # declaration + call site + N implementations
```

If N is zero, the feature does not exist yet, however green the suite is.

**Prefer a required member when every real host must implement it.** `cancelConfirm?:` was made
optional so a headless or test host still compiles. That convenience is what let the UI host skip
it. A required member with an explicit `cancelConfirm: () => {}` on the hosts that genuinely cannot
cancel documents the same thing and makes the omission a compile error.

**A test that only exercises a fake host proves the caller, never the callee.** When a contract has
exactly one production implementation, write one test that reaches for the *real* object — here, by
capturing the host the coordinator hands to `runAskMirrorSync`. Then mutate the production code and
confirm the test goes red; a test written against a missing member is exactly the kind that can pass
for the wrong reason.

**When a fix's landing site is inside another PR's blast radius, say so in the PR that ships the
hook.** #249 could have carried one line — "the production host is being relocated by #247; wire it
there" — and the week-long inert window would have been a tracked handoff instead of a silent hole.

## Related

- [`a-guard-that-refreshes-its-evidence-only-when-it-refuses.md`](a-guard-that-refreshes-its-evidence-only-when-it-refuses.md)
  — the same gate; H2 there is the sibling lesson about clearing shared state structurally rather
  than on remembered paths.
- [`a-threshold-whose-numerator-and-denominator-count-different-sets.md`](a-threshold-whose-numerator-and-denominator-count-different-sets.md)
  — the completeness-floor fix this branch absorbed from master.
- [`a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md`](a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md)
  — why the device-local evidence the gate reads must be reset by one owner.
