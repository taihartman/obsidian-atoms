---
title: "A property test is only as strong as its observers, and it has more than one"
date: 2026-08-05
category: logic-errors
module: settings
problem_type: logic_error
component: settings
severity: high
applies_when:
  - "Writing a test that asserts a property over whatever the screen renders, rather than a list of names"
  - "Pinning the contents of a screen, route, or module against a safety requirement"
  - "Reviewing a guard that passed while the thing it guards was violated"
  - "Using a recording test double to assert which methods a surface may call"
tags:
  - testing
  - property-tests
  - fake-green
  - consent
  - settings
---

# A property test is only as strong as its observers, and it has more than one

## Context

Requirement **R5** of the settings row-grammar work ([#304](https://github.com/taihartman/obsidian-atoms/issues/304))
says every gate on money, cloud egress, or vault writes stays on the main
settings screen and never moves behind **Advanced**. The plan called for
asserting this *as a property* rather than as a list of the four row names
Advanced was expected to hold — the plan's own words: assert the property
against the definition, not the current list, because a list assertion passes
forever and catches nothing.

That was the right instinct, and the test written from it is genuinely
property-shaped. `exerciseEveryControl` walks whatever `.setting-item` rows are
rendered, clicks every toggle and button, types into every input, and never
names a row. Then it asserts nothing moved.

It passed while R5 was violated, and then passed through two more violations
after that. Three reviewers, in three separate contexts, each found a different
blind spot — none of which was the "is it a list in disguise?" question everyone
was asking.

## Guidance

**A property test asserts `f(state_before) == f(state_after)`. Its strength is
entirely in `f` — the observers it reads state through. Audit the observers, not
the shape of the loop.**

The R5 test had three observers, and each was blind on its own axis:

**1. The state snapshot — what it forgot to sample.** `gateState()` captured the
two Ask consent timestamps, `askEnabled`, and the two auto-run local-storage
flags. It did not capture `useDeviceLocalKeyFallback` or the stored device-local
API key. Those two rows are a *complete credential path*: `getApiKey()` falls
back to the device-local key, so pasting one there is exactly what lets the
plugin call Anthropic and bill the user. They sat in Advanced, the test was
green, and R5 was violated the whole time.

**2. The call recorder — what it was constructed not to see.** The plugin test
double is a `Proxy` that records member access into a `calls` array, but only for
members *not* already present in its `known` object. `syncAskMirror` and
`applyAskOutbox` were both in `known` — so the recorder was deaf to precisely
the vault-egress call and the vault-write call. The assertion read
`expect([...new Set(calls.slice(from))]).toEqual(["saveSettings"])`, which looks
like an exhaustive whitelist and was not one. Proven by adding
`fireAndForgetAsk(this.plugin.syncAskMirror({ force: true }))` to the Model row's
`onChange`: that pushes the entire vault to the cloud from the Advanced screen,
and the test stayed green.

**3. The DOM walk — the part of the page it never visited.** `exerciseEveryControl`
walks `tab.containerEl`. Obsidian's `Modal.open()` mounts on `document.body`. So
a consent-gated gate on Advanced was invisible: clicking its toggle opens the
sheet, the sheet is never answered, and by design *no value moves until accept is
pressed* — so the state snapshot matched, the call recorder matched, and the test
was green with a live consent-gated egress gate sitting on the screen it exists
to keep clean.

The fixes are one line each, and all three are about widening `f`:

```ts
// 1. Sample the credential path too.
function gateState(tab, local) {
  return {
    askEnabled: tab.plugin.settings.askEnabled,
    askPrivacyAckAt: tab.plugin.settings.askPrivacyAckAt,
    askWriteAckAt: tab.plugin.settings.askWriteAckAt,
    autoRunEnabled: local.get(LS_AUTO_RUN_ENABLED),
    egressAcked: local.get(LS_AUTO_RUN_EGRESS_ACK),
    keyFallback: tab.plugin.settings.useDeviceLocalKeyFallback,  // added
    deviceKey: local.get(LOCAL_STORAGE_API_KEY),                 // added
  };
}

// 2. Record known members too — wrap, invoke, return the real value.
//    Otherwise the whitelist is deaf to exactly the dangerous calls.

// 3. An open sheet is itself proof the screen holds a gate.
expect(sheetOpen()).toBe(false);
```

## Why This Matters

The failure is not "someone wrote a weak test". The test was written *by* someone
deliberately avoiding the weak version, following a plan that explicitly warned
against it. The list-in-disguise question — *would this fail if a new row
appeared?* — was asked and answered correctly. It was simply the wrong question,
because a property test does not fail on rows appearing. It fails on `f`
changing, and `f` is where the blind spots live.

This compounds badly because a property test *earns trust*. A list assertion is
visibly narrow; everyone knows to distrust it. A property test that iterates
whatever exists reads as thorough, so the next reviewer stops looking — which is
exactly what happened three times here.

Note also that blind spots 2 and 3 are **properties of the harness, not of the
test**. The `known`-members exclusion and the `document.body` mount are decisions
made in `test/helpers/settingsTab.ts` and `test/mocks/obsidian.ts`, files a
reviewer reading the test will not open. A property test inherits every blind
spot of the harness beneath it.

## When to Apply

Any test whose assertion is *"nothing bad happened"* rather than *"this specific
thing happened"*. Before trusting one, answer three questions in order:

1. **What does the state snapshot sample, and what did it leave out?** Diff the
   snapshot's fields against the actual set of things the requirement protects.
   Here: five fields sampled, two omitted, and the two omitted were the violation.
2. **Can the recorder see the calls that matter?** A recording double built on
   pass-through-what-I-know-about is blind to everything it knows about — which
   tends to be the important calls, because those are the ones the double needed
   to stub.
3. **Does the DOM walk cover where the framework actually mounts things?**
   Modals, portals, tooltips, and overlays mount outside the component subtree in
   most frameworks. A walk rooted at the component misses all of them.

Then **prove each answer by mutation**: introduce the violation the observer
should catch, watch the test fail, revert. An observer that has never been shown
to fire is an assumption, not a check. This is the same shape as
[a-test-harness-that-cannot-fail-reports-coverage-that-never-ran](../architecture-patterns/a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md),
one level in: that doc is about a mechanism that cannot fail at all, this one is
about a mechanism that fails correctly on one axis and is blind on three others.

**Mutation-proving has a process hazard worth naming.** Proving these blind spots
required inserting a real vault-push call into production code. A reviewer doing
this without reverting in the same step tripped a data-exfiltration alarm
mid-session, and verifying nothing had landed cost a full audit of the working
tree, `HEAD`, and `git log -S` across the branch. If you dispatch an agent to
mutation-test, require it to revert and prove the tree clean in the same step.

## Examples

The mutation that proved blind spot 2, and the failure it produced only after the
recorder was widened:

```
# Mutation: add a vault push to the Model row's onChange in renderAdvancedDestination
fireAndForgetAsk(this.plugin.syncAskMirror({ force: true }));

# Before the fix — green. The whole vault ships from Advanced, undetected.

# After wrapping known members:
AssertionError: expected [ 'saveSettings', 'syncAskMirror' ]
                to deeply equal [ 'saveSettings' ]
  at test/settings.test.ts:1402
```

And blind spot 3, where the other two observers stay green and only the new
assertion fires:

```
# Mutation: make the Model row's onChange call presentConsent(...)
AssertionError: expected true to be false
  at test/settings.test.ts:1406
```
