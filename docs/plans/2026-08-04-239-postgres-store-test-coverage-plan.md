# Plan — #239 the production store (postgres) has no test coverage at all

**Issue:** https://github.com/taihartman/obsidian-atoms/issues/239
**Lane:** light (clear scope, test infrastructure, no product decision)
**Doc-review:** light `ce-doc-review` (coherence + feasibility) before implementation — no UI, no product claim

## Product bar

Postgres is the only store that runs in production (`prodGate` requires `DATABASE_URL`), and it is the
only store no test executes. Every one of `plus-service`'s 319 tests runs against memory or sqlite.

This is not hypothetical. During #230 a rename left the postgres binding passing the imported `id()`
**helper function** as a query parameter, and a second call site was never rewritten. The suite stayed
green through both; a human reading the final diff caught it. #238 then added a fourth store surface
(`stripe_incidents`, four methods × three backends) under the same blind spot, so the untested
surface grew rather than shrank.

The stopgap in place — a source-inspection parity test asserting all three stores export the same
method names — catches a *missing* method and nothing else. It cannot catch a wrong parameter, a bad
predicate, a missing `ON CONFLICT`, or a transaction bug. Those are exactly the bugs that ship.

**Bar:** a wrong postgres query fails a test. Not "postgres has a test file" — a deliberately broken
binding must turn the job red, and we prove it by breaking one.

## KTDs

### KTD1 — Real postgres in a service container. Not `pg-mem`, not a fake.

The issue lists `pg-mem` as a cheaper option. Reject it. The bugs this issue exists to catch are
*engine-behaviour* bugs — parameter binding, `ON CONFLICT` semantics, `TIMESTAMPTZ` round-tripping,
predicate correctness. A reimplementation of SQL in JS that happily accepts a query real postgres
would reject is worse than no test: it is a green check that means nothing. GitHub Actions gives us a
real `postgres:16` service container for free.

### KTD2 — Isolation is a schema per store instance, expressed in the connection URL.

The suites call `create()` **per test**, and `createPostgresStore` runs `CREATE TABLE IF NOT EXISTS`
against whatever it connects to. Sharing one database across tests would leak state between them.

Each `create()` therefore mints a unique schema (`t_<counter>_<pid>`) and hands
`createPostgresStore` a URL carrying `?options=-c%20search_path%3D<schema>`, dropping the schema on
close. Verified against the installed `pg` 8.22.0: `pg-connection-string` copies every query param onto the
config (`index.js:40-42`) and the pure-JS client puts `options` in the startup packet for every
pooled connection (`pg/lib/client.js:558-560`). Note that `connection-parameters.js:151` is the
`pg-native`/libpq path, which this project does not use — do not verify against that line.

The payoff is that **no production code changes**. Tests exercise the real `createPostgresStore` with
its real migration SQL, reached the same way production reaches it — a URL. A test-only branch inside
the store would be a fifth thing to keep in parity.

### KTD3 — Skipping is silent locally and fatal in CI.

Local `npm test` with no database must stay hermetic and green (testing doctrine; also the issue's
acceptance). So the postgres row is added only when `TEST_DATABASE_URL` is set.

That is a trapdoor. A suite that silently vanishes when an env var is unset is the #238 lesson
verbatim — *a signal nobody receives is not a signal*. If the CI job's env is ever renamed, moved, or
dropped, the postgres row disappears and every check stays green while coverage returns to zero.

So the gate is asymmetric: **no `TEST_DATABASE_URL` and no `CI`** → skip quietly. **`CI` set and no
`TEST_DATABASE_URL`** → throw at load. The build fails loudly rather than passing emptily.

### KTD4 — This puts `plus-service` under CI for the first time.

There is no workflow that runs `plus-service` tests today. `.github/workflows/` holds `release.yml`
(root vitest, on version tags only) and `tryatoms-pages.yml`. The 319 plus-service tests have never
gated a PR; they run when an agent runs them.

So "the store suites run in CI" cannot be satisfied by editing an existing job — it requires creating
one. The consequence is larger than the issue's title: **the whole plus-service suite starts gating
pull requests.** That is the right outcome and it is a scope expansion worth naming.

### KTD5 — The mutation check is the acceptance criterion, not a formality.

Acceptance requires that a deliberately wrong postgres query parameter fails the job. This is run
deliberately, on the branch, and the output is pasted into the PR — because the failure mode this
whole issue guards against is a test that *looks* like it covers postgres and does not.

### KTD6 — The ask suites' `withStore` silently downgrades an unknown mode to memory. Fix it first.

Found by the feasibility doc-review before any code, and confirmed at
`store-ask.test.mjs:12-17`, `store-ask-outbox.test.mjs:6-11`, `store-ask-mirror-sync.test.mjs:6-11`:

```js
const opts = mode === "sqlite" ? { mode: "sqlite", path: ":memory:" } : { mode: "memory" };
```

Every value that is not the literal `"sqlite"` falls through to memory. No error, no skip. So adding
`"postgres"` to the mode loop — the "one more mode string" the scope decision was priced on —
produces **a memory store labelled postgres**: the ask suite goes green having executed zero postgres
SQL, and the PR reports coverage it does not have.

That is the same bug this entire issue exists to kill, one layer up: a green check that means
nothing. `withStore` must therefore resolve each mode explicitly and **throw on an unrecognised
mode**, so a typo or a future fourth backend fails loudly instead of quietly testing memory twice.

The general rule, which is the compound learning here: **a test parameterised by a string needs a
total mapping.** A fallback branch in test setup converts an unsupported case into a silent pass.

## Units

Each unit is test-first: the test is written, run, and confirmed failing before implementation.

- **U1 — `test/helpers/postgresTestStore.mjs`.** Schema mint/drop, the `?options=` URL builder, a
  wrapped `close()` that drops the schema and ends the pool, and the KTD3 gate exported as
  `postgresStoreRow()` — returns `[]` or `[["postgres", create]]`, throwing when `CI` is set without
  `TEST_DATABASE_URL`. Own test file covering the gate's three states.
  **Teardown order:** `close()` ends the store's own pool first, then drops the schema over a
  short-lived admin connection on the base URL. Dropping from the store's own pool would be racing
  its own teardown, and `DROP SCHEMA` cannot run from a connection whose `search_path` is the schema
  being dropped.
  **The postgres row binds `createPostgresStore` directly**, not `createStore({ mode: "postgres" })` —
  the latter only delegates to it (`src/store.mjs:49-56`), so it would double the runtime for no new
  coverage.
- **U2 — postgres row on the three parameterised billing suites.** `trial-checkout-session.test.mjs`,
  `security-auth-criticals.test.mjs`, `stripe-incidents.test.mjs` each gain the postgres row from U1.
  (Each already calls `runStoreSuite` three times — `memory`, `sqlite`, `createStore-memory` — so
  postgres is a fourth call site covering a third *backend*.)
  **Close hygiene, all three, with their real gaps:** `trial-checkout-session.test.mjs` 9 tests / 5
  awaited closes, `stripe-incidents.test.mjs` 10 / 8, `security-auth-criticals.test.mjs` 7 / 5. Every
  test that calls `create()` must `await store.close()`. An unclosed memory store costs nothing; an
  unclosed postgres pool keeps `node --test` alive and hangs the CI job U4 creates.
- **U3 — postgres mode on the ask store suites. Rewrite `withStore` first (KTD6).** Three files carry
  a byte-identical `withStore` and the identical `for (const mode of ["memory", "sqlite"])` loop:
  `store-ask.test.mjs` (**two** loops, lines 30 and 261), `store-ask-outbox.test.mjs` (line 28),
  `store-ask-mirror-sync.test.mjs` (line 43). In each:
  1. Replace the ternary with explicit per-mode resolution that **throws on an unrecognised mode**;
     postgres routes to U1's `create()`.
  2. `await store.close()` in the `finally` — it is currently un-awaited (`store-ask.test.mjs:22`),
     harmless when memory has no `close()` and sqlite's is synchronous, but the postgres store's is
     `async close()` (`src/store/postgres.mjs:759`). Un-awaited, the next test's schema mint races an
     in-flight `DROP SCHEMA`.
  3. Only then add the third mode to all four loops.
  `askPostgresMethods.mjs` is 26KB — the single largest untested postgres file in the repo, larger
  than the billing surface this issue was filed about.
- **U4 — `.github/workflows/plus-service-tests.yml`.** `postgres:16` service container with a health
  check, Node 22 (`node:sqlite` needs ≥22.5), `npm ci` + `npm test` in `plus-service/`. Sets
  `TEST_DATABASE_URL` and `CI` — and **deliberately never sets `DATABASE_URL`**: `createStore`
  promotes a `memory` request to postgres when `isProduction()` and `DATABASE_URL` are both true
  (`src/store.mjs:36-43`), which would silently re-point the existing `createStore-memory` rows.
  Triggers on pull request and push to master, path-filtered to `plus-service/**` plus the workflow
  file itself.
- **U5 — mutation verification, run twice.** The two surfaces are wired differently — U2 through a
  `runStoreSuite` row, U3 through `withStore` mode resolution — so one mutation proves only one of
  them. Break a query parameter in `src/store/postgres.mjs` (proves U2), capture red; revert. Break
  one in `src/store/askPostgresMethods.mjs` (proves U3), capture red; revert. Then capture green.
  All of it goes in the PR body.

## Explicitly out of scope

- Bringing the plugin's vitest suite into the new workflow — separate concern, separate PR.
- `store.test.mjs` and the remaining memory-only tests: not parameterised, and converting them is a
  refactor this issue does not need.
- Any change to production store code. If a postgres bug surfaces, it gets fixed — but the fix is the
  finding, not the plan.
- A managed test database, docker-compose, or any local database requirement. Local stays hermetic.

## Verification

- `npm test` in `plus-service` with no database → green, postgres rows skipped, contributing zero
  tests. The local total rises above today's 319 only by the cases U1's own gate test file adds.
- `TEST_DATABASE_URL` set against a local postgres → green with the postgres rows executing; report
  the new count. Expect the run to be dominated by setup, not assertions: `create()` is per test, so
  the four suites run roughly 50 cycles of `CREATE SCHEMA` + the full `MIGRATE_SQL` (~20 tables plus
  `ASK_PG_DDL`) + `DROP SCHEMA CASCADE` against a ~1s baseline. Not a blocker; if it becomes one, the
  lever is per-file rather than per-test schemas, not a fake database.
- `CI=1` with no `TEST_DATABASE_URL` → fails loudly at load (KTD3).
- U5's deliberate break → red; revert → green. Both pasted in the PR.
- CI job green on the draft PR before review.

## Known residual risk

A bare per-schema `search_path` drops `public` from the path. Verified that no SQL in
`src/store/postgres.mjs` or `src/store/askPostgresMethods.mjs` currently references `public.`, an
extension, or a non-catalog function — so isolation holds today. **If a future migration adds one,
per-schema isolation breaks and it will not be obvious.** The symptom would be a postgres row failing
on an object it cannot resolve; the fix is to append `,public` to the `search_path`.

## Scope decision — resolved 2026-08-04

**Does #239 cover the ask store surface, or only the billing surface it was filed about?**
**Answer: include the ask surface.** U3 is in scope.

The issue names the three billing suites. But `askPostgresMethods.mjs` is the biggest untested
postgres file we have, its suite is already parameterised, and the marginal cost once U1 exists is
close to zero — it is one more mode string. The argument for deferring is that it widens a light-lane
issue and lengthens the CI job.

**Recommendation: include it.** The blind spot #239 describes is not "billing is untested", it is
"postgres is untested", and leaving the larger half uncovered would file the same issue again in a
month.
