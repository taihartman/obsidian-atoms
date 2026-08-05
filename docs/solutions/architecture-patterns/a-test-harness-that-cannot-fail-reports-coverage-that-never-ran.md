---
title: "A test harness that cannot fail reports coverage that never ran"
date: 2026-08-04
category: architecture-patterns
module: plus-service-tests
problem_type: architecture_pattern
component: plus-service
severity: high
applies_when:
  - "Adding a test backend, environment, or device that only some runs have"
  - "Writing a CI gate, guard step, or any check whose job is to fail"
  - "Parameterising a suite by a mode string"
  - "Asserting that an isolation or configuration mechanism works"
tags:
  - testing
  - ci
  - postgres
  - store-parity
  - fake-green
---

# A test harness that cannot fail reports coverage that never ran

## Context

`plus-service` had 241 tests and none of them touched postgres — the only store
that runs in production. During [#230](https://github.com/taihartman/obsidian-atoms/issues/230)
a rename left the postgres binding passing the imported `id()` **helper
function** as a query parameter, and a second call site was never rewritten. The
whole suite stayed green through both; a human reading the diff caught it.
[#238](https://github.com/taihartman/obsidian-atoms/issues/238) then added a
fourth store surface under the same blind spot.

[#239](https://github.com/taihartman/obsidian-atoms/issues/239) closed it by
wiring postgres in as a third backend and adding the first CI job that runs
plus-service tests at all. Building that harness surfaced the same failure shape
**four separate times, in four different disguises** — which is what makes it a
pattern rather than an anecdote.

Every instance has one form: **a mechanism that is supposed to catch a problem,
built so that it cannot report one.** Coverage that opts itself out, an
assertion that cannot fail, a guard that certifies for the wrong reason. Each
produces the same artifact — a green check that means nothing — and each is
invisible precisely because green is what you were hoping for.

## Guidance

### 1. Opt-in coverage must be loud where it is supposed to run

Postgres tests need a database, so the rows are gated on `TEST_DATABASE_URL`.
Locally absent means skip, which keeps `npm test` hermetic. That same silence in
CI is a trapdoor: rename the variable and coverage returns to zero while every
check stays green.

Make the gate asymmetric — quiet where absence is expected, fatal where it is not:

```js
export function postgresStoreRows() {
  if (baseUrl()) return [["postgres", createTestPostgresStore]];
  if (process.env.CI) {
    throw new Error(
      "CI is set but TEST_DATABASE_URL is not. The postgres store suites would " +
        "skip silently and postgres — the only store that runs in production — " +
        "would go untested behind a green check.",
    );
  }
  return [];
}
```

### 2. A suite parameterised by a string needs a *total* mapping

Three ask suites resolved their backend with a byte-identical ternary:

```js
const opts = mode === "sqlite" ? { mode: "sqlite", path: ":memory:" } : { mode: "memory" };
```

Anything that is not the literal `"sqlite"` falls through to memory. Adding
`"postgres"` to the mode loop — priced as "one more mode string" — would have
produced **a memory store labelled postgres**: green, zero postgres SQL, and a
PR reporting coverage that did not exist.

A fallback branch in test setup converts an unsupported case into a silent pass.
Use an exhaustive `switch` with no default, and throw on anything unrecognised so
a typo or a fourth backend fails loudly instead of testing memory twice.

### 3. Assert identity and discriminators, not shape

Two assertions written to guard exactly this could not have caught it:

```js
assert.equal(typeof rows[0][1], "function");     // satisfied by () => createMemoryStore()
assert.deepEqual(seen, ["undefined", "function"]); // "memory lacks close(), sqlite has it"
```

The first passes for any function, including one returning the wrong backend.
The second uses method-presence as a proxy for backend identity — it breaks on a
harmless refactor and passes on a real routing bug whose shapes happen to agree.

Assert the thing itself: the factory reference (`rows[0][1] === createTestPostgresStore`)
and the backend's own discriminator (`store.kind`).

### 4. Test the mechanism against the real thing, not against a string

Per-test isolation rests on `?options=-c search_path=<schema>` reaching the
server. Every assertion stopped at the URL — `URLSearchParams` round-tripping the
string the test had just written. If `options` ever stopped reaching the startup
packet (a `pg` major bump, a pooler in front of the connection), every store
would migrate into `public`, all suites would share one table set, and the run
would stay green with isolation gone.

The fix is to ask the server: `SELECT current_schema()`, confirm the migration's
tables belong to the minted schema via `pg_class`/`pg_namespace`, confirm
`to_regclass('public.accounts')` is NULL, and confirm two live stores cannot see
each other's rows.

Writing that test immediately paid for itself — and *by failing*. The first
version asserted `to_regclass('accounts')::text` equals `<schema>.accounts`. It
returns a bare `accounts`, because postgres omits the schema prefix exactly when
that schema is on the search path — so the assertion returns the same value
whether isolation works or everything landed in `public`. A test written to
distinguish two cases could not distinguish them. Only running it against a real
server revealed that.

### 5. A guard step must match on the reason, not a nearby string

The CI guard proves the missing-database throw fires by running a suite with the
variable cleared and grepping the output. Grepping for `TEST_DATABASE_URL`
matches the helper's own source, which node prints in a code frame for *any*
load-time crash in that file — so a broken gate would still print "Guard OK".
Match a distinctive fragment of the thrown message instead.

The same reasoning applies one level up: nothing proved the postgres rows *ran*
when a database was present. Delete one suite's row and coverage shrinks
silently. The job now floors the count of postgres suites that executed.

### 6. Count what executed, not what was printed

The floor above — "at least 5 postgres suites must have run" — was implemented as
`grep -c '(postgres)'` over the reporter output. An adversarial pass then broke
it, and it is the sharpest instance in this document because it is the *guard
against the pattern* exhibiting the pattern.

Three of the six postgres suites are named ``describe(`… (${mode})`)`` and match.
The other three use a bare `describe(mode)` with no parentheses and never match.
So the count of 6 was three suites × two TAP lines each, and **25 of the 38
postgres tests were invisible to it**. Deleting two entire suites' postgres
coverage left the number at 6 and the guard passing — exactly the trapdoor the
step's own comment claimed to close. A suite *name* was also enough to satisfy
it: a test titled `"binds the right parameter (postgres)"` in a memory-only file
counted the same as a real suite.

Reporter text is a description of work, not evidence of it. Count something only
real execution can produce — here, a marker emitted after `createPostgresStore`
has actually connected and migrated, one per test file, tallied with `sort -u`:

```js
function announceOnce() {
  if (announced) return;
  announced = true;
  console.log(`[#239] postgres-active ${basename(process.argv[1])}`);
}
```

Two related shell traps came with it. `grep` prints *nothing* — not `0` — when
its file is missing, so `[ "$RAN" -lt 5 ]` errored; and because that error
happens inside an `if` condition, `set -e` does not catch it and the check
**passed**. The one branch whose entire job is to fail was failing open. Set
`RAN=${RAN:-0}` and let a missing log abort the step.

### 7. Prove the harness fails, by breaking something on purpose

The acceptance bar for #239 was not "postgres has a test file" but "a wrong
postgres query fails the job". That was demonstrated, not assumed: two
production bindings were deliberately broken in the shape of the #230 bug —
`promoteCheckoutSession` looking its binding up by email, and
`accountFromMcpToken` passing the raw token where the hash belongs.

Both turned the job red, and each was caught by the wiring it was meant to prove
(3 failures in the `runStoreSuite` row, 2 in the `withStore` mode). The mutations
were then reverted. Run one mutation per wiring path — a single break only
exercises the path it happens to touch.

The number that matters most from that exercise: **with both bugs in production
code, the local suite stayed 251/251 green.** That is the blind spot stated as a
measurement.

## Why This Matters

These bugs are not caught by review, because the code looks correct — a ternary
with a sensible default, an assertion that names the right concept, a guard that
greps for the obvious token. They are caught only by asking "what would this
report if the thing it checks were broken?" and finding the honest answer is
*"green"*.

The cost of getting it wrong is worse than having no test. A missing test is a
known gap. A test that cannot fail is a **claimed** gap-closure, and it stops
anyone from looking again.

## When to Apply

Any time you add a check whose purpose is to fail — a CI gate, a guard step, an
opt-in test backend, a parity assertion, a lint rule. Before merging it, answer:

- If the condition I am guarding against were true right now, would this go red?
- Does this assert the thing, or a proxy that correlates with the thing?
- Can this silently become a no-op — an unset variable, a fallback branch, a
  filter that stops matching?
- Have I *seen* it fail, or only seen it pass?

The last question is the cheapest and the most decisive. See
[a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor](../logic-errors/a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md)
for the same shape in a runtime guard, and
[security-fix-repair-wired-into-only-one-branch](../logic-errors/security-fix-repair-wired-into-only-one-branch.md)
for the #230 bug that motivated this work.
