---
title: "An Obsidian component is a thenable, so never let one be a promise callback's return value"
date: 2026-08-05
category: logic-errors
module: settings
problem_type: logic_error
component: settings
severity: critical
symptoms:
  - "Obsidian pins at 100% CPU and never repaints"
  - "No error, no growing stack, no re-render loop — force-quit is the only recovery"
  - "Triggered by clicking a settings button whose handler is async"
root_cause: "A concise arrow returned a ButtonComponent into a promise chain; BaseComponent.then made it a self-adopting thenable"
resolution_type: code_fix
tags:
  - obsidian
  - promises
  - thenable
  - renderer-freeze
  - settings
---

# An Obsidian component is a thenable, so never let one be a promise callback's return value

## Problem

Clicking any settings action button backed by an async handler froze the Obsidian renderer at 100%
CPU, permanently. No error, no repaint, no recovery short of force-quitting the app.

## Symptoms

- Renderer pegged at 100% CPU immediately on click; UI never repaints again.
- **No stack growth** — so it does not present as recursion.
- **No re-render loop** — a tripwire on `display()` never fired at 120 calls.
- Reproducible every time on *Activate* in the tag vocabulary destination, and on every other action
  row whose `onClick` returned a promise.
- Synchronous action rows were completely unaffected.

## What Didn't Work

The obvious reading was wrong, and it cost time. The guard did this:

```ts
btn.setDisabled(true);
void pending.finally(() => btn.setDisabled(false)).catch(() => {});
```

and the handler called `redisplay()`, which does `containerEl.empty()`. So the natural story was
*"the `finally` runs against a button the re-render already destroyed."* That story is **wrong** in
both directions: `setDisabled` on a detached component is a harmless no-op, and the freeze
reproduces with `onClick: async () => {}` — no `redisplay()`, no `empty()`, no destroyed button.

Chasing the destroyed-button theory also mis-scoped the trigger. It is not "handlers that
re-render". It is **any handler that returns a promise**, which is broader and worse.

## Solution

The defect is the **return value**, not the target.

```ts
// node_modules/obsidian/obsidian.d.ts:508
export abstract class BaseComponent {
    /** Facilitates chaining */
    then(cb: (component: this) => any): this;
    setDisabled(disabled: boolean): this;
}
```

Every Obsidian component has a `then` method, so **every component is a thenable**. `setDisabled`
returns the component. A concise arrow has an implicit return. So `() => btn.setDisabled(false)`
returns a thenable, `Promise.prototype.finally` resolves its result through `promiseResolve(...)`,
that sees `.then`, and adopts it. Obsidian's implementation is:

```js
e.prototype.then = function (e) { return e(this), this }
```

It hands the resolve function **the same thenable back**. The machinery re-adopts, calls `then`
again, and repeats — each turn a fresh `NewPromiseResolveThenableJob` microtask. The microtask queue
never drains, so the event loop never runs again. That is why there is no stack growth and no
repaint: it is not recursion, it is microtask starvation.

The fix is to make the callback a **statement, never an expression**:

```ts
const release = (): void => {
  btn.setDisabled(false);   // braces — the arrow returns undefined
};
void pending.then(release, release);
```

`then(release, release)` also covers the rejection arm, so a failed action leaves a usable row
rather than a dead one.

## Why This Works

A concise-bodied arrow silently adopts whatever its expression evaluates to as the resolution value.
Chaining APIs — which return `this` by design — are therefore landmines inside promise callbacks,
and Obsidian's fluent builder API returns `this` from nearly everything: `setDisabled`, `setName`,
`setValue`, `setDesc`, `addButton`. Any of them at the tail of a concise arrow inside `.then`,
`.finally`, or an `async` return reproduces this.

Braces around the body break the chain by discarding the value. That is the whole fix.

## Prevention

**Never end a promise callback with a bare chaining call.** In this codebase that means: no
`() => component.setAnything(...)` inside `.then` / `.catch` / `.finally`, and no `return
component.setAnything(...)` from an `async` function. Use a braced body.

**Model `then` in your test double.** This bug survived **1091 passing tests**, and the reason is
exact: `test/mocks/obsidian.ts` modelled `BaseComponent` *without* `then`, even though it is public
API. The mock could not express the failure, so no test could catch it. The regression test now caps
adoptions at 20 so a recurrence **fails an assertion instead of hanging the whole vitest run**:

```ts
// mock BaseComponent
then(cb: (c: this) => unknown): this {
  thenCallCount += 1;
  if (thenCallCount > 20) throw new Error("thenable adoption loop");
  cb(this);
  return this;
}
```

**The general rule this instance teaches:** a mock that omits a method the real API has does not
merely lose coverage of that method — it can make an entire class of defect *unrepresentable*, and a
green suite then reads as evidence of safety. When a bug escapes a large passing suite, ask what the
double could not express, not just what the tests forgot to assert.

**How it was actually found:** the freeze had no stack and no logs, so static reading was hopeless.
Attaching CDP to the live renderer (`--remote-debugging-port=9222`), triggering the hang, and issuing
`Debugger.pause` interrupted the spin mid-loop and showed exactly one frame — `e.then` inside
`app.js` — whose only local was the native promise resolve function. That single paused frame was
the whole diagnosis. Keep that technique for any "100% CPU, no stack" hang.

**Where it came from, which is its own lesson:** this guard was itself a fix, added to stop a
double-tap firing two concurrent network calls. The fix for a mild bug introduced a fatal one, in a
shared primitive every row on the screen routes through — the blast radius the project's own
unification doctrine warns about. A shared primitive earns a stricter review than the bug it was
written to fix.
