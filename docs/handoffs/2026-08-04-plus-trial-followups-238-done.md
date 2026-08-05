---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-04T23:30:00Z"
title: "Atoms Plus trial follow-ups — #238 shipped as PR #268, #239 next"
summary: "#238 (Stripe reconcile + alerting) is done and awaiting review as PR #268; #239, #242, #241, #240 remain unclaimed, and two human gates are still owed."
keywords: ["plus-service", "stripe", "reconciliation", "webhook", "entitlement", "postgres-tests", "238", "239", "268"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/qa-phase-a-data-loss-be9fb1"
resume_focus: "Claim and implement #239 — real postgres test coverage, replacing the source-inspection parity stopgap"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "ops/plus-stripe-reconcile-alerts"
head: "449c4466e68401ecf8a2463675a9a62c307d56b5"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/qa-phase-a-data-loss-be9fb1"
---

# Handoff — Plus trial follow-ups: #238 done (PR #268), #239 next

This supersedes `docs/handoffs/2026-08-02-plus-trial-followups.md`, which listed #238–#242 as all
unclaimed. That was still true as of this session's start — nothing had been picked up in two days.
**#238 is now done.** The other four remain exactly as that doc described them; it is still worth
reading for #239–#242 detail, and its "Environment traps" section is unchanged and still accurate.

## Do these first — neither is code

1. **Set the Fly secret before PR #268 is deployed.** `prodGate` now requires
   `ATOMS_PLUS_ALERT_EMAIL` in production, so the next boot hard-fails without it:
   `fly secrets set ATOMS_PLUS_ALERT_EMAIL=ops@yourdomain.example -a atoms-plus`.
   This is deliberate — it is what stops alerting from booting silently off — but it makes the
   secret a deploy-ordering dependency. The boot error names that exact command.
2. **One real trial signup on a fresh email.** Still owed from #230, still unchecked. The
   `plus-service` deploy carrying #230's server fix *has* shipped (Fly `atoms-plus` release v41,
   2026-08-04 21:30 UTC — verified this session), so the mechanism is live; nobody has yet paid and
   watched the session survive. Needs a real card, so no agent can close this.

## What #238 was, and what shipped

Entitlement is webhook-only. Every way that path can fail degraded to a `console.error` line nobody
reads — #230 was one instance, #238 is the class. Three failure classes, all now covered:

| Class | Failure | Coverage |
|---|---|---|
| A | Webhook rejected (bad/rotated `STRIPE_WEBHOOK_SECRET`) | recorded + alerted |
| B | Applied but granted nothing (`missing_email`, `email_mismatch`, `unknown_price`, renewal and revoke variants) | recorded + alerted |
| C | Webhook never arrived (endpoint unsubscribed, retries exhausted) | reconciliation sweep — nothing in-process can see this |

Shipped: a `stripe_incidents` table across memory/sqlite/postgres; a throttled ops-email alert via
Resend (`sendOpsEmail` extracted from `email.mjs`); and `src/reconcile.mjs` +
`scripts/reconcile-stripe.mjs`, report-only by default with an opt-in `--repair`.

- **PR:** https://github.com/taihartman/obsidian-atoms/pull/268 — OPEN, **ready for review, not
  merged**, mergeable. Closes #238.
- **Branch:** `ops/plus-stripe-reconcile-alerts` @ `449c446`, pushed. Seven commits off master.
- **Plan:** `docs/plans/2026-08-04-238-stripe-reconcile-alerts-plan.md`
- **Learning:** `docs/solutions/architecture-patterns/a-signal-nobody-receives-is-not-a-signal.md`
- **STATUS.md:** row is `In review`. Clear it after merge.

## Decisions — do not relitigate

- **Alert channel is Resend**, reusing the one outbound channel the service already has and already
  requires in prod. Rejected a Sentry/webhook-out vendor for roughly one alert a week.
- **No scheduler.** There is none anywhere in `plus-service` — no `setInterval`, no cron, no Fly
  schedule. The sweep is a manual CLI at a **stated weekly cadence**, so class-C detection latency
  is ≤7 days by decision rather than by accident. The user chose this explicitly over wiring a Fly
  scheduled machine now. Scheduling it later is config, not code.
- **The sweep's oracle is `hasProcessedEvent`, never account entitlement.** Comparing against
  `getAccount` is wrong in both directions: a top-up for a customer with an active subscription
  looks entitled (false negative), and a granted session whose period expired looks unentitled
  (false positive) — which `--repair` would then "fix" by granting a fresh period for a months-old
  payment. Reconcile against *what you did*, not *what the state looks like now*.
- **`--repair` restores entitlement only, never the session.** `promoteCheckoutSession` works only
  while a checkout binding is live and that TTL is 24h, so a sweep run after Stripe gave up is
  always past it. Repair prints, per customer, that they must sign in again.
- **`--repair` uses Stripe as the cancel oracle, not the account.** Account state cannot distinguish
  "revoked after cancellation" from "soft account that never got its webhook" — both read
  `inactive` / `remaining: 0`. Refusing on `inactive` would refuse the entire #230 signup-repair
  case, so repair makes one `GET /v1/subscriptions/{id}` per flagged subscription session.
- **`--force` widens the age window but does NOT bypass the cancel skip.** Re-entitling someone
  Stripe says is gone is never an ops judgement call. If an override is ever wanted there, it
  should be its own flag.
- **The revoke-path `missing_email` is recorded but not repaired.** Making revokes self-healing is
  out of scope (revenue leakage, opposite harm direction from this issue's bar), but leaving it
  invisible was the exact bug #238 exists to kill, so it records under its own kind.

## Verification performed

- `cd plus-service && npm test` → **319 pass / 0 fail** (241 before this branch, 298 before the
  review-fix round). Root `npm test` → **909 pass / 57 files**. `npm run build` clean.
- Every unit's tests were written red-first and confirmed failing before implementation.
- A light `ce-doc-review` (coherence + feasibility) ran **before** any code and caught two design
  errors that would have shipped: `payment_status` is not a valid Checkout Sessions list filter (the
  sweep's core call would have 400'd on first run), and the `getAccount` oracle above.
- An adversarial pre-merge review found nine defects, all fixed in `cda4677` — worst were a CLI that
  could silently sweep an empty in-memory store and "repair" every real customer into it, and a
  repair path that reported success for outcomes that granted nothing while still claiming the
  event so it would never resurface.

**Not proven, deliberately:** no live Stripe call anywhere (the sweep is exercised against an
injected fetch stub), and **postgres has no live-DB test** — parity is behavioral for memory/sqlite
and source-inspection for postgres. That gap is precisely #239.

## Next steps

1. **#239 — postgres has zero test coverage.** This is the immediate next item and it is not
   busywork. During #230 a rename left the postgres binding passing the imported `id()` **helper
   function** as a query parameter, and a second call site was never rewritten; the full suite
   stayed green through both, because `plus-service` tests only exercise memory and sqlite. It was
   caught by reading code. #238 has now added a fourth store surface (`stripe_incidents`, four
   methods × three backends) under the same stopgap, so the untested surface grew.
   The existing suites are already parameterised via `runStoreSuite(name, create)` — defined
   locally in `test/trial-checkout-session.test.mjs:20` and `test/security-auth-criticals.test.mjs:14`,
   and now also `test/stripe-incidents.test.mjs`. Postgres should become a **third row** when a DB
   is available, not three hand-written suites. Decide how CI gets a postgres (docker service,
   `pg-mem`, or a skip-unless-`DATABASE_URL` guard) — that is the real design question in #239.
2. **#242** — pin the `obsidian` typings so typecheck stops validating a newer API than
   `minAppVersion` promises. Small, and closes a class rather than an instance.
3. **#241** — the 40s post-checkout polling window. Amend lane. **Coordinate:** it touches
   `src/platform/plusResume.ts`, which #222 / PR #223 also touches. Check whether #223 landed first.
4. **#240 last, in its own session** — a real magic-link handoff to the plugin. Design problem, not
   a patch. Start with `ce-brainstorm`, not code.

Each needs the repo's hard claim before implementation: assigned Issue + STATUS.md row + draft PR.

## Fragile / machine-local state

- **This worktree is nested** at `.claude/worktrees/qa-phase-a-data-loss-be9fb1`, against CLAUDE.md's
  sibling-worktree rule, and its name is unrelated to the work (it was inherited). It functions, but
  is not hermetic — its `plus-service/node_modules` was installed this session; `node_modules` at
  the worktree root resolves up to the parent repo. **If you create a new worktree, use the sibling
  path `../obsidian_plugin-<slug>/`.** Nothing uncommitted is left here; the branch is fully pushed,
  so this worktree is disposable.
- `.compound-engineering/config.local.yaml` (`cross_model_peer: grok`) was created this session in
  both the main repo and this worktree. It is gitignored and machine-specific — recreate it in any
  new checkout where `ce-code-review` will run.
- Two open worktrees from unrelated older work still exist (`nervous-hodgkin-cb3f8c`,
  `one-132c40`, and others); `git worktree list` shows the full set. Not this work's concern.

## Relevant skills

`ce-plan` / `ce-work` for #239; `ce-doc-review` (light, coherence + feasibility) before implementing
from any plan rewrite — it earned its cost twice this session; `ce-code-review` before merge;
`ce-compound` to close. `ce-brainstorm` for #240 only.
