---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T01:06:00Z"
title: "#239 postgres store coverage shipped as PR #273; #242/#241/#240 next"
summary: "#239 is done and awaiting review as PR #273 alongside #268; three follow-ups remain unclaimed and four human-only actions are owed."
keywords: ["plus-service", "postgres", "test-coverage", "ci", "239", "273", "268", "branch-protection"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-239-postgres-tests"
resume_focus: "Claim #242 (pin the obsidian typings) — smallest of the three remaining follow-ups; or chase #273/#268 to merge"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "test/239-postgres-store-coverage"
head: "75bdbb52cacd0df48a2c68abd2e0e70be63b9f27"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-239-postgres-tests"
---

# Handoff — #239 shipped as PR #273; #242 / #241 / #240 remain

Supersedes `docs/handoffs/2026-08-04-plus-trial-followups-238-done.md`, which listed #239–#242 as
unclaimed. **#239 is now done.** The rest of that document is still accurate for #240–#242 and its
"Environment traps" section is unchanged.

## Human-only actions owed — none of these are code

1. **Make the new CI check binding.** `master` lists **no required status checks**
   (`docs/collab.md` § master branch protection; `docs/security` H8), so #239's job runs on PRs but a
   red run does not block a merge. Add `plus-service tests / test` to branch protection.
   **Trap:** a required check with a `paths:` filter stays *pending forever* on PRs that touch nothing
   under `plus-service/`. Either pair it with an always-run companion job of the same check name or
   drop the `paths:` filter. The workflow header documents this rather than overclaiming.
2. **`fly secrets set ATOMS_PLUS_ALERT_EMAIL=… -a atoms-plus` before PR #268 deploys.** `prodGate`
   now requires it and the next boot hard-fails without it. Deploy-ordering dependency.
3. **One real trial signup on a fresh email.** Still owed from #230, still unchecked. The server fix
   is live (Fly `atoms-plus` v41); nobody has paid and watched the session survive. Needs a real
   card, so no agent can close it.
4. **Merge-order chore for #273 / #268:** whichever lands **second** must add the postgres row to
   `plus-service/test/stripe-incidents.test.mjs`:
   `for (const [name, create] of postgresStoreRows()) runStoreSuite(name, create);`
   That file exists only on #268's branch, so neither PR's CI can see the gap.

## What #239 was, and what shipped

Postgres is the only store that runs in production and was the only store no test executed. During
#230 a rename left the postgres binding passing the imported `id()` **helper function** as a query
parameter and a second call site was never rewritten — the whole suite stayed green through both.

- **PR:** https://github.com/taihartman/obsidian-atoms/pull/273 — OPEN, ready for review, `CLEAN`.
  Closes #239. 13 files, **zero production-code change**.
- **Branch:** `test/239-postgres-store-coverage` @ `75bdbb5`, pushed. Base merge-base `02c563d`;
  `origin/master` has since moved to `da1946b` (diff against the merge-base, not master).
- **Plan:** `docs/plans/2026-08-04-239-postgres-store-test-coverage-plan.md`
- **QA:** `docs/qa/2026-08-04-239-postgres-store-coverage-world-class-qa.md`
- **Learning:** `docs/solutions/architecture-patterns/a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md`
- **STATUS.md:** row is `In review`. Clear it after merge.

## Decisions — do not relitigate

- **Real `postgres:16` service container, never `pg-mem`.** The bugs in scope are engine-behaviour
  bugs; a fake that accepts a query real postgres rejects is a green check that means nothing.
- **Isolation is a schema per store instance, expressed in the connection URL**
  (`?options=-c search_path=<schema>`). This is why there are **zero production-code changes** —
  tests reach the real `createPostgresStore` the same way production does. A test-only branch inside
  the store would have been a fifth thing to keep in parity.
- **The gate is asymmetric on purpose.** No `TEST_DATABASE_URL` locally → rows absent, `npm test`
  stays hermetic. `CI` set without it → **throws at load**. A suite that vanishes when an env var is
  renamed is #238's lesson verbatim.
- **Count executions, not reporter text.** The suite floor counts a marker emitted only after a real
  connect-and-migrate, one per test file. The first version grepped `'(postgres)'` and was itself a
  false green — see below.
- **Per-test schemas stay.** A truncate-based reset saves ~3s of CI wall time and costs a whole new
  isolation mechanism. Rejected during the simplify pass.
- **Two short-lived admin connections stay.** A held-open client leaks if `close()` is ever missed;
  robustness beats 36 localhost connects.

## Four bugs this work found, each a green check that meant nothing

Recorded because they are the substance of the learning doc, not incidental:

1. **Doc-review, before any code** — the ask suites' `withStore` ternary fell through to memory for
   anything not literally `"sqlite"`, so adding `"postgres"` would have produced a memory store
   labelled postgres. The scope decision had been priced as "one more mode string."
2. **First CI run** — `store-ask.test.mjs` "inactive entitlement cannot use mcp token" mutated the
   object returned by `getAccount` and branched on `store.kind`; it only ever asserted anything on
   memory. Its twin in `security-auth-criticals.test.mjs` was fixed too.
3. **Code review** — isolation was asserted as a URL string round-tripping through
   `URLSearchParams`; nothing asked postgres. The live test then failed for a *different* reason:
   `to_regclass('accounts')::text` renders unqualified exactly when the schema is on the search path,
   so it could not distinguish the two cases it was written for.
4. **Adversarial QA** — the anti-fake-green floor was fake green. `grep -c '(postgres)'` counted three
   suites as six TAP lines and missed 25 of 38 tests; two suites could lose all coverage without
   moving the number. Also `grep` prints nothing (not `0`) on a missing file, so `[ "$RAN" -lt 5 ]`
   errored *inside an if*, which `set -e` does not catch — the check failed open.

## Verification performed

- Local (no database): **252 pass / 0 fail**, ~0.8s.
- CI green: run `30965225964` — **302 pass / 0 fail**, `test files with live postgres coverage: 6`,
  guard step fired.
- **Mutation proof (the acceptance bar):** run `30962845239` — two deliberately wrong bind parameters
  (`promoteCheckoutSession` looking its binding up by email; `accountFromMcpToken` passing the raw
  token instead of its hash) produced **284 pass / 5 fail**, 3 in `checkout session binding
  (postgres)` and 2 in `ask mirror + mcp store` postgres — each caught by the wiring it proves. Both
  reverted. **With both bugs in place the local suite stayed 251/251 green** — the blind spot,
  measured.
- **Not proven:** no local postgres and no Docker exist on this machine, so every postgres claim is a
  CI run. The adversarial review lens ran as a local subagent, **not** the configured grok
  cross-model peer — no different-model corroboration.

## Next steps

1. **#242 — pin the `obsidian` typings** so typecheck stops validating a newer API than
   `minAppVersion` promises. Smallest of the three; closes a class rather than an instance.
2. **#241 — the 40s post-checkout polling window.** Amend lane. **Coordination note is now stale:**
   the prior handoff said "check whether #223 landed first" — **PR #223 is CLOSED, not merged**;
   `#222` shipped instead as **PR #266** (merged 2026-08-04, `0.6.67`, "catch-up on foreground + Sync
   everything now"). Re-check `src/platform/plusResume.ts` against #266's version, not #223's.
3. **#240 — a real magic-link handoff to the plugin.** Design problem, not a patch. Start with
   `ce-brainstorm`, not code. Own session.

Each needs the repo's hard claim first: assigned Issue + STATUS.md row + draft PR.

## Fragile / machine-local state

- **This worktree is a correct sibling** at `/Users/a515138832/StudioProjects/obsidian_plugin-239-postgres-tests`
  (machine-local). Everything is committed and pushed, so it is disposable. `plus-service/node_modules`
  was installed here this session.
- **The previous session's worktree is nested** at
  `/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/qa-phase-a-data-loss-be9fb1`
  (machine-local), against CLAUDE.md's sibling rule, and holds `ops/plus-stripe-reconcile-alerts`
  (PR #268). Clean; also disposable.
- `.compound-engineering/config.local.yaml` (`cross_model_peer: grok`) is gitignored and was created
  in this worktree. Recreate it in any new checkout where `ce-code-review` runs.
- `git worktree list` shows ~10 worktrees from older work. Not this work's concern.
- **No local postgres, no Docker.** Any future work on this harness cannot run the postgres path
  locally; use CI or install one.

## Relevant skills

`ce-plan` / `ce-work` for #242 and #241; `ce-brainstorm` for #240 only; `ce-doc-review` (light) before
implementing from any plan rewrite — it caught a P0 before a line of code this session;
`ce-code-review` then `adversarial-qa` before merge — the adversarial pass found the sharpest bug of
the session; `ce-compound` to close.
