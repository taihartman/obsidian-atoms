---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-06T02:10:00Z"
title: "#320 multi-device sessions: claimed, planned, doc-reviewed — implementation not started"
summary: "The plan is committed and has survived three reviewers; U1's three-line prototype is applied and uncommitted; nothing else is built."
keywords: ["multi-device", "sessions", "320", "exchangeMagic", "sign-out-all", "session-cap", "plus-service", "implementation-next"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin"
resume_focus: "Implement U1-U7 of docs/plans/2026-08-06-001-feat-multi-device-sessions-plan.md, then run the shipping tail"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e"
branch: "feat/320-multi-device-sessions"
head: "0421008"
---

# #320 is claimed and planned; implementation has not started

## State

| Thing | Status |
|---|---|
| [#320](https://github.com/taihartman/obsidian-atoms/issues/320) | Open, assigned to taihartman |
| [PR #322](https://github.com/taihartman/obsidian-atoms/pull/322) | Open, **draft** |
| `STATUS.md` | Row added (commit `2eb3917`) |
| Plan | **Committed** at `0421008` — `docs/plans/2026-08-06-001-feat-multi-device-sessions-plan.md` |
| Doc review | Complete — coherence, feasibility, security-lens; every finding applied |
| Implementation | **Not started**, except U1's three lines (see below) |

**Working tree:** three uncommitted lines — the `revokeAllSessionsForEmail` →
`revokeUnverifiedSessionsForEmail` swap in `exchangeMagic` at
`plus-service/src/store/memory.mjs:276`, `sqlite.mjs:410`, `postgres.mjs:474`.
That is U1's change, deliberately left in place. Do not rewrite it.

## Read the plan, not this file

The plan is the authority: 10 requirements, 8 KTDs, 7 units, all with test
scenarios. This handoff only carries what the plan cannot tell you about itself.

## The three decisions the user made, which are settled

1. **Both halves ship in one PR** (KTD1). Narrowing the revoke alone leaves a
   60-day window with no way to evict a live session, and after U1
   `revokeAllSessionsForEmail` has *zero* production callers — U3's route is
   what re-earns the export.
2. **"Sign out all devices" signs out the calling device too** (KTD2). Chosen
   over revoke-others-keep-current. One code path, no carve-out.
3. **Soft cap of 10 verified sessions, oldest evicted** (KTD3). Chosen over no
   cap and over a hard cap that refuses the sign-in.

Do not re-open these. Q1 (the exhausted Settings branch also gets the control)
is also resolved — yes.

## What the review found that the first draft got wrong

These are the reasons the plan is longer than "swap three lines and add a
button". Each is now a KTD or requirement; this is the short version of *why*.

- **`verified: true` does not mean "proved email ownership."**
  `POST /v1/billing/checkout` accepts unverified soft sessions on purpose, and
  `promoteCheckoutSession` then flips the row to verified. So a session can be
  verified on the strength of a payment. Those now survive the narrowing.
  **Accepted deliberately (KTD8)** — carving them out would kill the desktop
  session of anyone who pays on desktop then signs in on phone, which is #320
  verbatim on the most common paying path.
- **The recovery control was undoable.** `promoteCheckoutSession` sets
  `revoked = false` with no check on *why* a row was revoked, and checkout
  bindings live 24h — so a retried webhook resurrects a session the user
  explicitly evicted, and after U1 nothing reaps it again. U3 now clears
  bindings (R10).
- **MCP grants survived it entirely.** They authenticate off
  `mcpAccess`/`mcpRefresh`, not `sessions`. `mcpRevokeForEmail` is already
  called on `revokeSubscription` and `mirrorWipe`, so omitting it was the
  inconsistency. U3 now calls it (R10).
- **The rate-limit test was unreachable by construction.** KTD2 means the
  caller's own session dies on first success, so call 2 401s *before* the
  limiter. The limiter bounds session farming, not repeat calls; the test must
  seed sessions directly.
- **The memory store has no `exp_ms`.** Its rows are
  `{ email, exp, revoked, verified }`. A shared `a.exp_ms - b.exp_ms`
  comparator yields `NaN`, sorts as 0, falls back to Map insertion order —
  which equals creation order today, so the cap test would pass against code
  that read no timestamp. Order by `row.exp` in memory, `exp_ms` in the SQL
  stores.
- **The expired-row cap test cannot be written today.** No backend exposes a
  way to plant a session with an arbitrary expiry. U2 adds
  `writeSessionRowForTest` / `sessionRowsForTest` across all three stores.

## Traps that will cost time

- **`plusClient.ts` uses `fetch`, not `requestUrl`**, against the CLAUDE.md
  rule. It is a documented exception (`plusClient.ts:4-6`) — desktop
  `requestUrl` fails to localhost. Do not "fix" it.
- **`markDestructive` is mandatory** for destructive buttons
  (`src/settings/destructiveButton.ts`). Calling `setDestructive()` directly is
  1.13+ against a `minAppVersion` of 1.11.4 and previously blanked the whole
  settings tab.
- **The postgres arm keys off `TEST_DATABASE_URL`**, not `DATABASE_URL`. It
  returns `[]` silently when unset locally and **throws** under CI. No docker
  or local `pg` on this machine, so U1/U2's postgres arm is CI-verified only.
  Do not claim local coverage.
- **The root vitest suite does not run on PRs** — only `plus-service-tests.yml`
  does, scoped to `plus-service`. U4/U5/U6 are only tested by the root suite,
  which runs on a version tag. Run it locally before tagging.
- **Fly deploy runs from the repo root**, never `plus-service/`, and an earlier
  attempt exited 0 having deployed nothing — confirm with
  `fly releases -a atoms-plus`, not the exit code.
- **`renderPlusSection` has four branches that each `return` early.** The
  control goes in two of them (active + exhausted), so extract the row once;
  two pasted copies will drift.

## Verified prototype evidence (do not re-derive)

- `plus-service` suite: 476/476 before the swap, 476/476 after.
- C1 passes for the right reason — its prior session is `startWithEmail`
  (unverified).
- Mutation-tested both directions: deleting the revoke turns C1 red; restoring
  `revokeAll` turns the multi-device probe red.
- A scratch probe confirmed two exchanges leave two live verified sessions that
  can both file.

## Next step

One path: implement U1 → U7 in dependency order from the plan, then the
shipping tail (`ce-simplify-code` → `ce-code-review` with the cross-model peer
routed to grok → `world-class-qa` including its adversarial half →
`ce-compound`). The plan's Verification Contract and Definition of Done are the
gates.

Start with U1 — and per its Execution note, stash the three staged lines long
enough to watch the new surviving-verified-session test fail, then restore and
commit. The point is seeing the red, not re-authoring the fix.
