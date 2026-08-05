# Handoff — resume catch-up: all blocking questions answered (#222 / PR #223)

**Status:** Plan is doc-reviewed (round 2) and re-scoped. All five blocking questions are
answered and recorded. **Implementation not started.**

Supersedes `docs/handoffs/2026-07-31-resume-catch-up-doc-review.md`, whose open questions
are now closed.

## Resume with

The plan changed materially — the unit set shrank by two units and a requirement — so the
project's plan-quality gate applies before implementation:

```
/ce-doc-review mode:headless docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md
```

Then, if it comes back clean:

```
/ce-work docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md
```

Branch `claude/obsidian-resume-sync-filing-072be6`. Issue
[#222](https://github.com/taihartman/obsidian-atoms/issues/222), draft PR
[#223](https://github.com/taihartman/obsidian-atoms/pull/223). Every path referenced below is
committed.

## Ship Phase A first — it is a separate PR

This is the most actionable thing in this document. **U1, U9, and U2's marker-time
re-verification ship as their own PR ahead of the feature**, because a partially-synced phone
mass-deletes cloud atoms on every relaunch today — `onLayoutReady` calls `syncAskMirror` and the
delete loop sits outside the `if (force)` guard. That hazard does not wait behind a 12-unit
feature.

**The deletion-confirmation modal ships in that PR.** Non-negotiable. U1's completeness floor
refuses deletion unless the user confirmed, and if the only gesture that can confirm lands in
Phase C, a user who legitimately pruned their atoms gets a permanently divergent mirror with no
way out. The guard and its escape hatch land together or the guard is a trap.

U2's `Vault.process` migration stays behind in the main plan; only step 3 goes early.

## The five answers, and why

| Q | Answer | Reason |
|---|---|---|
| **Q2** backlog gate | Keep U13/R14, scoped to **inbox-stranded captures only**, threshold **50**, persistent banner not a launch modal | Auto-run's counter enumerates daily notes, so the behaviour "users already live with" is captures already drained. The gate protects a population auto-run never reached |
| **Q3** split Phase A | **Yes** | Live data-loss path shipping today |
| **Q4** latency | **Filing underway within a few seconds of reopening** — start, not finish | The bar is latency relative to *attention*, not elapsed time. An hourly timer can fire while the phone is in a pocket and still miss someone who opened the app minutes earlier |
| **Q5** passive surface | **Add it** (U15, R16) | The complaint is a trust problem. A silent fix to a trust problem is not a fix |
| **Q8** checkout-poll migration | **Cut U11** | Zero requirements; a regression there is invisible to this feature's QA |

## R4 was cut — this is the load-bearing change

R4 promised that a capture Obsidian Sync delivers *after* the resume signal is still filed in
that same session. It is gone, along with:

- **U6** (bounded post-resume inbox watch) — deleted entirely
- **U4's dirty-re-run half** — the unit is now "Reclaimable chain" and keeps only the liveness
  half, which is a real bug fix
- **KTD5's premise** — the decision was retitled, because its title and opening paragraph *were*
  the dirty/epoch mechanism

A capture arriving 30 seconds late files on the next app open. That is not data loss, and the
60-second watch window was sized on a single forum anecdote.

**The confirmation this was right:** the review's F11 finding — where either R4 or the alt-tab
acceptance example had to give — dissolved outright. A contradiction that evaporates under a
scope cut was scope that never earned itself. The alt-tab example now simply holds.

R4, U6 and U11 are tombstoned in place. Numbers are retired, not reused.

## Still open, all non-blocking

**Q10 (connectivity-restore scope) is the most likely next cut** — KTD7 admits it is "not
requested" and defends it as free, then states it needs its own probe and its own file. Same
shape as Q8. Q1, Q6, Q7 and Q9 also remain open.

## Things a fresh session should not re-derive

- **The plan's factual base was verified and holds.** Every `src/plugin/main.ts` line citation
  resolves to the described code (`:210`, `:229`, `:233`, `:352`, `:633`, `:750`, `:1385`,
  `:1397`), as do the cited lines in `src/pipeline/inbox.ts`, `src/platform/connectivity.ts`,
  `askMirror.ts`, `autorun.ts` and `plusClient.ts`. `Vault.process` is in the installed 1.13.1
  typings with a synchronous callback; `minAppVersion` is 1.11.4. "13 `vault.modify`, zero
  `vault.process`" and "no test imports `main.ts`" are both confirmed.
- **The completeness floor is `max(5, highWaterMark × 0.8)` with a 30-day decay.** Reviewers
  split 0.8 vs 0.9; 0.8 was chosen and the plan flags the ratio as the value most open to
  revision.
- **Three units now contend for Atoms home's status region** — U1's refusal, U13's banner, U15's
  line. A precedence order is recorded in System-Wide Impact. Do not let a fourth surface land
  there without updating it.
- **Obsidian exposes no first-party resume event.** That mobile `visibilitychange` fires is
  inferred from shipping plugins, not documented. U0 is the spike. The cheapest first check is
  whether `src/platform/plusResume.ts`'s post-Stripe refresh has ever worked on someone's phone —
  it already ships a production `visibilitychange` listener on mobile.
- **U0's spike may not be agent-runnable.** It calls for BRAT installs on real iOS and Android
  devices, but BRAT pulls from GitHub Release assets and cutting a Release needs explicit user
  request. A manual sideload may be needed, and no unit names who runs the spike or what happens
  if only iOS can be tested.

## Known nits left alone

- U7 carries a duplicate test scenario ("Kill switch off → the manual action still runs fully"
  and "→ still works"). Pre-existing, out of scope for these decisions.
- `BACKLOG_GATE_THRESHOLD` is now 50 everywhere; `QUARANTINE_EXPIRY_DAYS` was committed at 14 and
  `CONNECTIVITY_PROBE_MIN_INTERVAL` at 5 min, both by the round-2 review rather than by explicit
  user decision. Worth a glance.

## Artifacts

| Path | What |
|---|---|
| `docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md` | The plan. 1879 lines, implementation-ready |
| `docs/qa/2026-07-31-222-resume-catch-up-doc-review-r2.md` | Round-2 review: 37 findings, 7 reviewers, full evidence |
| `docs/handoffs/2026-07-31-resume-catch-up-doc-review.md` | Prior handoff — superseded, kept for provenance |
