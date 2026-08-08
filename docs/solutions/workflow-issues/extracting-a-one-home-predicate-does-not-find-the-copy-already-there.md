---
title: "Extracting a \"one home\" predicate does not find the copy that was already there"
date: 2026-08-08
category: workflow-issues
module: consent/ask-mirror
problem_type: process_gap
component: egress-gate
symptoms:
  - "A refactor extracts a shared predicate and rewires the callers it knows about, leaving a pre-existing private copy of the same logic untouched"
  - "The duplicate carries the same name, so a grep for the new function's name finds the migrated call sites and skips the one that was never migrated"
  - "The new shared function's docstring warns about exactly the drift the same file still contains"
  - "Three separate review lenses report the identical finding, which is the tell that the refactor was verified against its own diff instead of against the file"
root_cause: refactor_verified_against_its_own_diff
resolution_type: fixed
severity: medium
tags:
  - refactor
  - consent
  - ask-mirror
  - egress-gate
  - code-review
  - duplicate-logic
---

# Extracting a "one home" predicate does not find the copy that was already there

## What happened

`#371`/`#374` needed the settings screen to ask the same question the mirror asks before it
pushes: `askEnabled && askPrivacyAckIsCurrent(settings)`. A simplify pass extracted that
expression out of `AskCoordinator.mirrorPermitted()` into `askMirrorPermitted()` in
`src/shared/askAck.ts`, gave it a docstring saying it was the one home for the egress predicate,
and rewired the coordinator and the new status-line reason to call it.

`src/settings/settings.ts` already had a **private method of the same name** doing the same thing,
and it still gated the toggle's immediate push:

```ts
private askMirrorPermitted(): boolean {
  return (
    this.plugin.settings.askEnabled &&
    askPrivacyAckIsCurrent(this.plugin.settings)
  );
}
```

So the refactor produced one home in name and two in fact — in the same file, under the same
identifier, with the new function's own comment warning about it. Four reviewers found it
independently, including the cross-model peer.

## Why the pass missed it

The extraction was verified against **its own diff**, which was internally consistent: every line
it added called the shared function, and every line it changed had been migrated. Nothing in the
diff pointed at code the diff never touched.

The name collision then hid it a second time. Searching for `askMirrorPermitted` after the change
returns the shared definition, the coordinator's delegate, the new caller — and the duplicate,
which reads as just another correct call site unless you notice `private` and the missing import.

## The rule

**A consolidation refactor is not verified by its diff. It is verified by the search that proves
the thing being consolidated now occurs once.**

Before claiming a predicate, constant, or format string has one home, search for the *shape* and
not the new name:

```bash
# the expression, not the identifier
rg -n "askEnabled\s*&&" src/
# every declaration of the name, including private methods that shadow the import
rg -n "askMirrorPermitted" src/
```

If the search returns a call site the diff did not touch, the refactor is unfinished. The count
that matters is occurrences in the tree afterwards, not lines changed.

## Why it matters here specifically

The duplicate sat on an egress path. A future condition added to the shared gate — a device
entitlement, the both-halves ack check from
[a versioned consent needs both halves in the gate](../security/a-consent-version-only-the-client-checks-does-not-gate-the-server.md) —
would have applied to the mirror and the status sentence and silently not to the toggle that
starts a push. That is the same class of bug `#374` exists to close: a surface and the egress it
describes disagreeing because they asked two different questions.

## Related

- `src/shared/askAck.ts` — `askMirrorPermitted`, the actual home
- `src/plugin/askCoordinator.ts` — the delegate, whose docstring no longer claims to be the home
- `docs/solutions/architecture-patterns/ask-mirror-parity.md` — the status-honesty principle the
  gated line extends
