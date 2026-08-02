---
handoff_date: 2026-08-02
branch: claude/plus-trial-followups
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/238
status: in-progress
---

# Handoff — Atoms Plus trial follow-ups (#238–#242)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

The trial-signup bug that broke every Atoms Plus signup is **fixed and merged** (#230 / PR #231,
v0.6.62). Your job is the five follow-ups it exposed, filed as #238–#242. They are all unclaimed and
unstarted. Start with **#238** (webhook reconciliation + alerting) — it is the same silent-failure
class as the bug that just shipped, and it is the one that can still cost a paying customer.

## Current status

- **#230 is DONE and on master.** Merged as `3bf186f`, version 0.6.62. STATUS.md is cleared.
  Nothing is in flight. Do not re-fix it.
- What #230 fixed: `grantPeriod` revokes every *unverified* session for an email (the #163 C1
  fixation fix). That hotfix shipped `markSessionVerified` as the repair but wired it into the
  **dogfood branch only** — the production Stripe branch returns at `server.mjs:438` and never
  reached it. So the Stripe webhook revoked the paying user's only session and every
  `Refresh status` returned 401 forever. Fix: bind the Stripe Checkout Session id to the plugin
  session that opened it, consume it in the webhook right after `grantPeriod`.
- Verified green on master: `npm run build` clean, `npm test` 771/53 files,
  `cd plus-service && npm test` 213 passed.
- **Two things a human still owes, which you cannot do:** deploy `plus-service` to Fly (the #230 fix
  is server-side and does nothing until it ships), and one real trial signup on a fresh email to
  close the release gate. Do not attempt either — no real cards, no deploys. Remind the user once if
  it looks like they have forgotten.
- The client half (recovery CTA, settings crash fix) is on master but **not released**; plugin users
  get it only when a Release is cut for BRAT. Only cut one if the user explicitly asks.

## Next steps

1. **Claim and implement #238** — webhook reconciliation + alerting. Entitlement is webhook-only:
   the single production grant path is `store.grantPeriod` inside `applyStripeEvent`'s
   `checkout.session.completed` branch (`plus-service/src/stripe.mjs:326`), and there is **no
   reconciliation job anywhere in `plus-service/`**. A wrong or rotated `STRIPE_WEBHOOK_SECRET`
   makes `constructEvent` throw (`stripe.mjs:187`) → 400 + a `[plus] webhook reject` log line
   (`server.mjs:275`) that nobody reads, while the customer has paid and has nothing. Want: a
   reconciliation pass over Stripe subscriptions with no matching entitled account, plus a real
   alert when signature verification fails or a completed checkout produces no grant. Server-only;
   no plugin release. Lane: **light**.
2. **Then #239** — postgres has zero test coverage. Independent of #238; can run in parallel in a
   separate session if you prefer. See "Decisions & constraints" for why this one is not optional.
3. **Then #242** — pin the `obsidian` typings so the typecheck stops validating a newer API than
   `minAppVersion` promises. Small, and it closes a class of bug rather than an instance.
4. **Then #241** — the 40s post-checkout polling window. Amend lane. **Coordinate: it touches
   `src/platform/plusResume.ts`, which the resume/catch-up work (#222 / PR #223) also touches.**
   Check whether #223 has landed before editing that file.
5. **#240 last, and in its own session** — a real magic-link handoff to the plugin. This is a design
   problem, not a patch. Start it with `ce-brainstorm`, not with code.

Each needs the repo's hard claim before implementation: GitHub Issue assigned + a STATUS.md row +
a draft PR. See `docs/collab.md`.

## Key files

- `plus-service/src/stripe.mjs:326` — the only production grant path (`grantPeriod` in
  `checkout.session.completed`). #238 centres here.
- `plus-service/src/stripe.mjs:187`, `plus-service/src/server.mjs:275` — where a bad webhook secret
  dies silently. This is the hole #238 must close.
- `plus-service/src/store/{memory,sqlite,postgres}.mjs` — three parallel store implementations;
  `bindCheckoutSession` / `promoteCheckoutSession` were added to all three in #230.
- `plus-service/test/trial-checkout-session.test.mjs` — #230's regression coverage, including the
  `#230 store parity` stopgap test. #239 replaces that stopgap with real postgres coverage.
- `src/platform/plusRefresh.ts` — new in #230; owns the refresh record and the inline recovery row.
- `src/platform/plusResume.ts:26` — `MAX_POLLS` / `INTERVAL_MS`, the 40s window (#241).
- `src/settings/settings.ts` — `markDestructive()` is the #242 point fix; the class is still open.
- `docs/solutions/logic-errors/security-fix-repair-wired-into-only-one-branch.md` — why #230
  happened. Read this before #238; the lesson generalises.
- `docs/qa/2026-08-01-trial-session-invalid-world-class-qa.md` — what was and was not proven.

## Decisions & constraints

**Do not relitigate these.**

- The #230 fix design is settled: checkout↔session binding, single-use, 24h TTL, hash only. C1 is
  preserved because a soft session that never opened checkout has no binding and stays revoked.
- #239 is not optional busywork. During #230 a rename left the postgres binding passing the imported
  `id()` **helper function** as a query parameter, and a second call site was never rewritten. **The
  full suite stayed green through both** — `plus-service` tests only exercise memory and sqlite. It
  was caught by reading code, not by a test. The parity test added is a stopgap that catches a
  *missing* method, not a wrong parameter.
- The existing store suites are already parameterised via `runStoreSuite(name, create)`, so postgres
  should become a third row when a DB is available — not three hand-written suites.
- Prefer server-only fixes where possible; #163's own acceptance criteria said so, and it avoids a
  plugin release.
- Vault lanes are non-negotiable: `test_vault/` and `docs/media/demo-vault/` only. **Never** touch
  Remote Vault or any personal vault. Never cut a GitHub Release unless asked.
- Never log or render a session token, even truncated.

**Environment traps that cost real time — do not rediscover:**

- **Do not run `npx prettier`.** There is no prettier config in the repo, so it applies its own
  defaults (tabs, single quotes) to a 2-space/double-quote codebase. One run produced a 2740-line
  diff. Hand-format to match surrounding code.
- **Never `git checkout <ref> -- <path>` mid-merge** — it destroys your working tree for that path.
  Use `git merge --abort` and redo, or inspect with `git show <ref>:<path>`.
- **`master` moves fast** — it advanced twice during the #231 merge, and one attempt failed with
  "Base branch was modified". Fetch and merge immediately before merging.
- **`plus-service/` needs its own `npm install`** or its tests will not run.
- **This worktree is nested** inside the main repo (`.claude/worktrees/...`), against CLAUDE.md's
  sibling-worktree rule. Its `node_modules` is empty and Node resolves up to the parent repo's. It
  works, but it is not hermetic — if you create a *new* worktree, use the sibling path
  `../obsidian_plugin-<slug>/`.
- **`install-to-vault.sh` defaults to `<repo-root>/test_vault/`, but the Obsidian CLI drives
  whatever vault Obsidian actually has open** — in a worktree those differ. Pass the path
  explicitly: `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`,
  and confirm the live version via `obsidian eval` before trusting any vault evidence.
- **Mocked unit tests cannot see an Obsidian typings-vs-runtime mismatch** — that is exactly #242.

## Open questions / blockers

- **#241 vs #222/#223 overlap.** Both touch `src/platform/plusResume.ts`. PR #223 was still open at
  handoff time. Check its state before editing; land the other one first or coordinate.
- **PR #226 (issue #225) is still OPEN and draft with two unfixed P0 data-loss blockers** — separate
  work, not yours unless asked, but do not assume master is quiet. Its handoff is preserved in the
  second half of `.remember/remember.md` (local-only, untracked).
- **#238 alerting mechanism is undecided.** There is no existing alerting infrastructure in
  `plus-service/`. Decide between logging to a queryable table, an email via the existing Resend
  integration, or an external hook — and say which you chose and why in the PR.

## Git state

- Branch `claude/plus-trial-followups` (base `master`), pushed to `origin`.
- Branched from `844eeb8 Merge pull request #237 from taihartman/chore/clear-status-230`, which was
  `origin/master` at handoff time.
- Handoff commit is the branch tip: `wip: handoff snapshot — plus-trial-followups`. (No SHA quoted
  on purpose — this commit was amended to backfill this section, so any SHA written inside it would
  be stale by definition. Use `git log -1 claude/plus-trial-followups`.)
- `git diff --stat origin/master...HEAD` → **1 file, +154**: this doc only. **There is no
  work-in-progress code** — #230 shipped and the follow-ups have not been started. Nothing is
  half-finished and waiting for you.
- Note: `git diff master...HEAD` is misleading here — there is no local `master` branch in this
  worktree. Always compare against `origin/master`.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c
git fetch origin && git switch claude/plus-trial-followups && git pull --ff-only
npm install
npm test                      # expect 771 passed / 53 files
cd plus-service && npm install && npm test   # expect 213 passed
```

Then continue from **Next steps** above — begin with #238.
