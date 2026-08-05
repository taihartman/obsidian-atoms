# QA — #239 the production store (postgres) has no test coverage

**Branch:** `test/239-postgres-store-coverage` · **PR:** [#273](https://github.com/taihartman/obsidian-atoms/pull/273)
**Date:** 2026-08-04

## Honesty statement — read this before trusting the evidence

- **There is no postgres and no Docker on the machine this was built on.** Every
  postgres assertion in this report was executed **in CI**, against the
  `postgres:16` service container the change adds. Nothing postgres-related was
  verified locally, and no claim below rests on a local postgres run.
- **No live Stripe, vault, or plugin surface was exercised.** This change touches
  `plus-service/test/**` and one workflow file. Production code is byte-identical
  to master — `git diff origin/master -- plus-service/src/ src/` is empty.
- **No UI.** Screenshots are `N/A` and that is not a dodge; the deliverable is a
  CI job.
- The mutation evidence (below) came from commits deliberately pushed to this
  branch and then reverted. Both the red run and the revert are in the history.

## Core user stories

There is no end user here. The consumers are the next agent and the next PR:

1. **As a developer changing `plus-service/src/store/postgres.mjs`, a wrong query
   parameter turns my PR red instead of reaching production.** This is the whole
   point — the #230 bug (a helper function passed as a bind parameter) survived a
   fully green suite.
2. **As a developer with no database installed, `npm test` still runs clean and
   fast**, so the coverage does not tax local work.
3. **As a reviewer, I can tell the difference between "postgres passed" and
   "postgres never ran."** Absence of coverage must not look like success.

## Evidence

| Claim | Evidence | Result |
|---|---|---|
| Hermetic locally: no database needed | `cd plus-service && npm test` | **252 pass / 0 fail**, ~0.8s |
| Postgres actually executes in CI | run [30964470946](https://github.com/taihartman/obsidian-atoms/actions/runs/30964470946) | **293 pass / 0 fail** (vs 252 local — 41 postgres executions) |
| A wrong postgres bind parameter fails the job | run [30962845239](https://github.com/taihartman/obsidian-atoms/actions/runs/30962845239) | **284 pass / 5 fail** |
| …and each mutation is caught by the wiring it proves | same run | 3 fails in `checkout session binding (postgres)` (U2's `runStoreSuite` row); 2 in `ask mirror + mcp store` postgres (U3's `withStore` mode) |
| Those same bugs are invisible without this change | `npm test` with both mutations applied | **251 pass / 0 fail** — two wrong query parameters in production code, entirely green |
| A CI run with no database fails loudly rather than skipping | Guard step, every run | `Guard OK — the run failed with the missing-database error.` |
| Coverage cannot silently shrink | Floor step | counts test files that opened a real postgres store; fires below 5 |
| `search_path` isolation actually holds on the server | live isolation tests, run 30964470946 | `current_schema()` is the minted schema; `accounts` belongs to it; `to_regclass('public.accounts')` is NULL; two stores cannot see each other's rows; schema dropped on close |
| Production code unchanged | `git diff origin/master -- plus-service/src/ src/` | empty |

### Bugs found *by* this QA work

Three, all fixed on the branch. Worth listing because each was a green check that
meant nothing:

1. **`store-ask.test.mjs` "inactive entitlement cannot use mcp token" only ever
   asserted anything on memory.** It mutated the object returned by `getAccount`
   and branched on `store.kind` to decide whether that needed saving — which only
   persisted on the one store that hands back a live reference. The postgres row
   exposed it on its first run. Rewritten to persist through `grantPeriod` on
   every backend and to assert the token works *before* and not *after*. The twin
   of this pattern in `security-auth-criticals.test.mjs` was fixed too.
2. **The `withStore` mode ternary fell through to memory** for anything that was
   not the literal `"sqlite"`. Caught by doc-review *before* any code — adding
   `"postgres"` as a mode string would have produced a memory store labelled
   postgres. Now an exhaustive switch that throws.
3. **The suite-count floor was itself a false green.** Caught by the adversarial
   pass. `grep -c '(postgres)'` counted three suites as six TAP lines and missed
   25 of 38 postgres tests; deleting two whole suites' coverage left the number
   unchanged. Now counts markers emitted only after a real connect-and-migrate.

### Adversarial pass — attacks that held

Probed and did not break: 13 hostile `TEST_DATABASE_URL` shapes through
`withSearchPath` (literal `@` in password, `%40`, `+`, `%25`, `%20`,
`sslmode=require`, unix-socket host, missing database path, non-postgres scheme)
— all round-trip credentials, host, port and database intact; garbage URLs fail
loudly rather than hanging. Guard-step grep refuses to certify an unrelated crash
(verified by keeping the sentence as a live source line while throwing a
different error). Env mutation in the gate test cannot leak across tests — node's
top-level describes run strictly sequentially and every restore is in a
`finally`/`afterEach`. Determinism: 3 consecutive runs and runs from two
different cwds, 252/252 each time. The `after()` sweep cannot fail a green run.

## Not covered

- **No local postgres run.** All postgres evidence is CI-only.
- **`stripe-incidents.test.mjs` did not get a postgres row.** It exists only on
  PR #268's branch, so this branch cannot see it. Whichever of #239/#268 merges
  second owns adding it — a one-line change. Recorded in the plan and on both PRs.
- **The job does not yet block merges.** `master` lists no required status checks,
  so a red run here is advisory until someone adds `plus-service tests / test` to
  branch protection. The workflow comment says so rather than overclaiming.
  Making it required needs a human with repo settings access, and interacts with
  the `paths:` filter (a required check with a path filter stays pending forever
  on PRs that touch nothing under `plus-service/`).
- **Suites still memory/sqlite-only:** `store.test.mjs`, `meter.test.mjs`,
  `stripe.test.mjs`, and the `http-*` / `mcp-*` suites. Scope, not defect.
- **The migration is always run into an empty schema**, so the job proves the
  queries match the DDL in the same file — not that they match production's
  long-lived, incrementally migrated schema.

## Verification commands

```bash
cd plus-service && npm test                    # hermetic, no database, 252 pass
CI=1 npm test                                  # must fail loudly, naming TEST_DATABASE_URL
TEST_DATABASE_URL=postgres://... npm test      # runs the postgres rows
```
