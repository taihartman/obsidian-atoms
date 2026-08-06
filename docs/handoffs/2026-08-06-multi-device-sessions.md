---
handoff_date: 2026-08-06
branch: feat/320-multi-device-sessions
worktree: /Users/a515138832/StudioProjects/obsidian_plugin
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/322
status: in-progress
---

# Handoff — #320 multi-device sessions: implement U1–U7

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then **start executing Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

A paying Atoms Plus customer cannot be signed in on desktop and phone at the same time: `exchangeMagic` revokes **every** session for the email — verified ones included — right before minting, so each sign-in evicts the other device permanently. You are narrowing that revoke so devices coexist, and adding an explicit **"Sign out all devices"** control to replace the account-recovery property the broad revoke was silently providing. Both halves ship in one PR.

## Current status

- **The plan is committed and is your authority:** `docs/plans/2026-08-06-001-feat-multi-device-sessions-plan.md` — 10 requirements, 8 KTDs, 7 implementation units, every unit carrying explicit test scenarios. Read it before writing code.
- **It has already been through doc review** (coherence, feasibility, security-lens). Every finding was applied. The six substantive ones are summarized under *Decisions & constraints* — inherit them, don't rediscover them.
- **Nothing is implemented yet except U1's three lines**, which are committed on this branch as a WIP snapshot: `revokeAllSessionsForEmail` → `revokeUnverifiedSessionsForEmail` inside `exchangeMagic` at `plus-service/src/store/memory.mjs:276`, `sqlite.mjs:410`, `postgres.mjs:474`. Keep that change; do not re-author it.
- **The claim is live:** issue #320 assigned, `STATUS.md` row added, draft PR #322 open.
- **Prototype evidence already gathered — do not re-derive any of this:**
  - `plus-service` suite is 476/476 both before and after the three-line swap.
  - The C1 session-fixation test passes for the *right* reason: its prior session comes from `startWithEmail`, which is unverified.
  - Mutation-tested both directions — deleting the revoke turns exactly C1 red; restoring `revokeAll` turns a multi-device probe red.
  - A scratch probe confirmed two exchanges leave two live verified sessions that can both file.

## Next steps

1. **Implement U1** — commit the revoke narrowing with its regression tests. Per U1's Execution note, temporarily revert the three staged lines long enough to watch the new surviving-verified-session test fail, then restore them. The point is seeing the red, not rewriting the fix. Add the KTD8 test too (a payment-promoted session survives a later exchange).
2. **Implement U2** — the session cap. This is bigger than it looks: it needs a config value with a floor clamp, one new store method per backend with a **backend-specific ordering field**, and a new `writeSessionRowForTest` / `sessionRowsForTest` seam across all three stores because the expired-row test cannot otherwise be written.
3. **Implement U3** — `POST /v1/auth/sign-out-all`. Also grew: it revokes sessions, revokes MCP grants, and clears checkout bindings. All three are required (R10).
4. **Implement U4** — the `signOutAllDevices` client helper, modelled on `signOutPlus`.
5. **Implement U5** — the Settings control and confirm modal, in both the active and exhausted branches via one shared row helper.
6. **Implement U6** — correct the now-false sign-in disclosure copy, its docstring rationale, its test regex, and add a supersession note to the #240 plan.
7. **Implement U7** — bump `manifest.json`, `package.json`, `versions.json` together.
8. **Run the shipping tail:** `ce-simplify-code` → `ce-code-review` with the cross-model peer routed to grok (`.compound-engineering/config.local.yaml` already sets `cross_model_peer: grok`) → `world-class-qa` including its `adversarial-qa` gate → `ce-compound`. Then mark PR #322 ready with real evidence.

## Key files

- `docs/plans/2026-08-06-001-feat-multi-device-sessions-plan.md` — your authority; units, test scenarios, Verification Contract, Definition of Done
- `plus-service/src/store/memory.mjs:276` · `sqlite.mjs:410` · `postgres.mjs:474` — the narrowed revoke (U1)
- `plus-service/src/store/memory.mjs:167,174` — `revokeAllSessionsForEmail` and its narrow sibling
- `plus-service/src/store/memory.mjs:203-226` — `promoteCheckoutSession` / `markSessionVerified`; both set `verified = true; revoked = false`
- `plus-service/src/server.mjs:586-591` — the per-device `/v1/auth/sign-out`; insert the new route just after it
- `plus-service/src/server.mjs:832-852` — `POST /v1/promo`, the auth pattern to copy (`requireVerified`, 401 with an instruction)
- `plus-service/src/config.mjs:156-158` — `sessionTtlDays` (60); add the cap value alongside
- `plus-service/test/security-auth-criticals.test.mjs:59-81` — the C1 test; `:636-641` the three-store matrix; `:758-798` the source-scanning parity test
- `plus-service/test/http-auth-peek.test.mjs:13-40` — the spawn-server-plus-shared-sqlite harness U3's test must copy
- `src/platform/plusClient.ts:738-753` — `signOutPlus`, the template for U4
- `src/settings/settings.ts:302-505` — `renderPlusSection` and its four early-returning branches
- `src/settings/plusSignInConfirmModal.ts:37-52` — `signInConfirmCopy`, whose disclosure is now false (U6)
- `src/settings/destructiveButton.ts:16` — `markDestructive`, mandatory for destructive buttons

## Decisions & constraints

**Settled by the user — do NOT relitigate:**

- **Both halves ship in one PR** (KTD1). Part 1 alone leaves a 60-day window with no way to evict a live session, and after U1 `revokeAllSessionsForEmail` has *zero* production callers — U3's route is what re-earns the export.
- **"Sign out all devices" signs out the calling device too** (KTD2), chosen over revoke-others-keep-current. One code path, no carve-out. The plugin must clear local session state after a 200, or the vault reads "signed in" while every call 401s.
- **Soft cap of 10 verified sessions, oldest evicted** (KTD3), chosen over no cap and over a hard cap that refuses the sign-in.
- **Both the active and exhausted Settings branches get the control** (Q1, resolved). Extract the row once — those branches each `return` early, so two pasted copies will drift.

**What doc review caught that the first draft got wrong — inherit these:**

- **`verified: true` does not mean "proved email ownership."** `POST /v1/billing/checkout` accepts unverified soft sessions on purpose (`server.mjs:854-857`), and `promoteCheckoutSession` then flips the row to verified. Those sessions now survive the narrowing. **Accepted deliberately (KTD8)** — carving them out would kill the desktop session of anyone who pays on desktop then signs in on phone, which is #320 verbatim on the most common paying path.
- **The recovery control was undoable.** `promoteCheckoutSession` sets `revoked = false` with no check on *why* a row was revoked, and checkout bindings live 24h — so a retried webhook resurrects a session the user explicitly evicted, and after U1 nothing reaps it again. U3 clears bindings (R10).
- **MCP grants survived it entirely.** They authenticate off `mcpAccess`/`mcpRefresh`, not `sessions`. `mcpRevokeForEmail` is already called on `revokeSubscription` and `mirrorWipe`, so omitting it was the inconsistency. U3 calls it (R10), and U5's copy must say connected apps are disconnected.
- **The rate-limit test is unreachable the obvious way.** KTD2 means the caller's own session dies on first success, so a second call 401s *before* the limiter. The limiter bounds session farming, not repeat calls — seed sessions directly in the test.
- **The memory store has no `exp_ms`.** Its rows are `{ email, exp, revoked, verified }`. A shared `a.exp_ms - b.exp_ms` comparator yields `NaN`, sorts as 0, and falls back to Map insertion order — which equals creation order today, so the cap test would pass against code that read no timestamp. Order by `row.exp` in memory, `exp_ms` in the SQL stores.
- **R6's cap is a soft ceiling at exchange time, not a global invariant.** The promote paths raise the count outside it by design.

**Hard constraints and traps that will cost you time:**

- **`plusClient.ts` uses `fetch`, not `requestUrl`**, against the CLAUDE.md rule. It is a documented exception (`plusClient.ts:4-6`) — desktop `requestUrl` fails to localhost. Do not "fix" it.
- **`markDestructive` is mandatory** for destructive buttons. Calling `setDestructive()` directly is 1.13+ against a `minAppVersion` of 1.11.4 and previously blanked the whole settings tab.
- **The postgres arm keys off `TEST_DATABASE_URL`**, not `DATABASE_URL`. It returns `[]` silently when unset locally and **throws** under CI. There is no docker or local `pg` on this machine, so U1/U2's postgres arm is CI-verified only — do not claim local coverage for it.
- **The root vitest suite does not run on PRs.** Only `plus-service-tests.yml` does, scoped to `plus-service`. U4/U5/U6 are only covered by the root suite, which runs on a version tag. Run `npm test` at the repo root locally before tagging.
- **Fly deploy runs from the repo root**, never `plus-service/`, and must precede any plugin release. An earlier attempt exited 0 having deployed nothing — confirm with `fly releases -a atoms-plus`, not the exit code.
- **Do not touch the personal Remote Vault.** Dogfood on `test_vault/` or `docs/media/demo-vault/` only.
- **No AI attribution in commits or the PR body.** PR body needs `Closes #320`.

## Open questions / blockers

- **Q2** (plan): does the confirm modal need a typed confirmation rather than two-button consent? Recommendation in the plan is no; decide when you build U5.
- **Q4** (plan): should the 10-session cap be disclosed in user-facing copy? Currently silent, with the U2 log line making it diagnosable.
- **Not a blocker, but unrun:** the iOS + Android physical-device release gate for stable `0.6.78` is human-only and still outstanding from #240. `crypto.subtle` on the mobile webview remains assumed, never verified.

## Git state

- Branch `feat/320-multi-device-sessions` (base `master`), pushed to `origin`.
- Last real commit: `0421008 docs(plan): #320 multi-device sessions plan, doc-reviewed`
- WIP snapshot commit: the branch tip, subject `wip: handoff snapshot — multi-device-sessions`. It carries the three-line U1 revoke narrowing, this doc, and the removal of an earlier duplicate handoff doc. (Named by subject rather than SHA — the SHA changed when this doc was amended into the same commit.)
- Diff since base: 6 files changed, +633/-3

## How to resume

Check out the work exactly here — this is your branch and worktree. This is the **main checkout**, deliberately not a sibling worktree: `test_vault/` is gitignored (`.gitignore:41`) and `scripts/verify.sh:7` defaults its vault to `$ROOT/test_vault/test vault`, so a fresh worktree would have no vault to verify against.

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
git fetch origin && git switch feat/320-multi-device-sessions && git pull --ff-only
cd plus-service && npm ci && npm test    # server suite: expect 476+ passing
cd .. && npm install && npm test         # root vitest suite (does NOT run on PRs)
```

For any unit touching the plugin, verify through the CLI with Obsidian open on the throwaway vault:

```bash
./scripts/install-to-vault.sh
./scripts/verify.sh
```

Then continue from **Next steps** above.
