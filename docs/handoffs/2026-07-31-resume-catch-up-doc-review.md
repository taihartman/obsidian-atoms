---
handoff_date: 2026-07-31
branch: claude/obsidian-resume-sync-filing-072be6
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/one-132c40
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/222 · https://github.com/taihartman/obsidian-atoms/pull/223
status: in-progress
---

# Handoff — Catch up on resume: plan doc-reviewed, ready for ce-work

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Ship a foreground/resume trigger so Obsidian files phone captures when the app comes back to the
foreground, instead of the user force-quitting to make it happen — plus a manual "Sync everything
now" escape hatch. Three pre-existing data-loss paths that the trigger converts from rare to routine
get fixed first, in Phase A.

The plan is written and has now been through two doc-review rounds. **Implementation has not
started.** Your job is `ce-work`, but read *Open questions / blockers* before you start — three
questions still change the unit set, and one of them decides whether most of the plan exists.

## Current status

- The plan lives at [`docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md`](../plans/2026-07-31-001-feat-resume-catch-up-plan.md) and is committed. 1456 lines.
- **Round 1 doc-review (previous session)** — 5-reviewer pass plus a 7-reviewer adversarial pass. 14
  corrections landed in commit `5dc0526`. That round left ~15 decisions unapplied.
- **Round 2 doc-review (this session)** — 7 personas (coherence, feasibility, product-lens,
  security-lens, scope-guardian, design-lens, adversarial), all dispatched as separate contexts. 42
  raw findings → 32 after dedup. **27 edits applied; 6 findings appended as Outstanding Questions.**
  This is the commit immediately preceding this handoff.
- No cross-model peer pass ran — no sanctioned runner is installed on this host (`cursor-agent`,
  `cursor`, `composer`, `opencode` all absent). Nothing left the machine.
- No code has been written. No tests added. `src/` is untouched on this branch.
- The draft PR ([#223](https://github.com/taihartman/obsidian-atoms/pull/223)) exists and contains
  only plan/STATUS docs so far.

### What round 2 changed structurally (don't re-derive these)

- **New unit U0** — a device spike at the front of Phase B that gates whether Phase C is built at
  all. It registers the three DOM signals on a throwaway build and checks, on a real iOS and a real
  Android device, whether `visibilitychange` actually fires. The whole feature rests on that
  assumption and it is *inferred from other plugins' source, not documented anywhere*. A negative
  result stops Phase C and routes to the interval-drain alternative.
- **New unit U14** — the egress acknowledgment copy, pulled out of U8 (which depends on every other
  unit) into its own unit that U5 depends on, so the recorded consent lands no later than the
  behavior it describes. Its carry-forward question is settled there as KTD16: existing acks carry
  forward with a one-time disclosure notice; **no re-ack gate**, because that would silently stop
  filing for every user who missed the prompt.
- **U1 and U9 each gained an extraction step** as a stated precondition. Their regression proofs are
  a merge gate and cannot be written where the logic currently lives — no test in the repo imports
  `src/plugin/main.ts` (`test/mocks/obsidian.ts` stubs `Plugin` as an empty class). Move the mirror
  loop into `src/platform/askMirror.ts` and the outbox loop into `src/plugin/catchUp.ts`, both behind
  an injected host, *before* writing the failing test.
- **U7 now owns the deletion-confirmation gesture**, and U1 forbids that flag being derived from
  `force`, scan size, or emptiness. Previously the safety floor had no exit — a user who legitimately
  deleted many atoms would have had a permanently divergent mirror.
- **U1 step 5 was reversed.** The plan used to say "persist evidence before issuing deletes"; that
  strands server rows permanently, because a failed delete drops the path from evidence and deletes
  derive solely from evidence. The existing delete-then-persist order self-heals via an idempotent
  retry. Keep it.
- **KTD5 was narrowed.** The drain's promise-join is a single-flight lock *and* a result-share. U4
  now retires only the result-share and keeps the lock. Dropping both would double-append, because
  U2's dedupe deliberately lets a genuine same-second duplicate through (shipped decision Q2 at
  `src/pipeline/inbox.ts:826`).
- **Q6 closed** — the returning-from-absence cooldown exemption is adopted, specified in KTD4 and
  tested in U3, so the headline acceptance example is now true rather than false for ten minutes.
- **Q7–Q9 added** (the manual action's name, whether U11 belongs here, paid-stage consent).

## Next steps

1. **Get Q2, Q3 and Q4 answered by the user before writing any code.** They are marked BLOCKING in
   the plan's Goal Capsule. Ask all three together, plainly, and recommend as noted below. Do not
   answer them yourself — they are scope and product calls.
   - **Q4 first and hardest:** what is the maximum acceptable delay between reopening Obsidian and a
     capture being filed? If the answer is "within the hour", the plan's own analysis says the
     event trigger loses to adding `drainInboxOnce()` to the existing hourly `maybeAutoRun` tick
     (`src/plugin/main.ts:633`) — a few lines — and U3, U4, U5, U6 and U11 should not be built.
   - **Q3:** split U1 + U9 into their own PR ahead of the feature? Plan leans yes. Note the Problem
     Frame now states the wipe's precondition explicitly, so re-check the lean against the corrected
     (conditional, not unconditional) frequency.
   - **Q2:** cut U13 and R14 (the first-run backlog gate)? Plan leans cut; three reviewers agreed.
     Nothing else depends on them. U13's dismissal-stall defect is already fixed in place, so the
     unit is safe either way.
2. **Then run `ce-work`** on the plan, scoped by whatever Q2/Q3/Q4 resolved to. Start at Phase A
   (U1, U2, U9) regardless of how they resolve — Phase A is unaffected by all three.
3. **Run the shipping tail** afterwards, in separate sessions: `ce-simplify-code` →
   `ce-code-review` → `ce-compound` → `world-class-qa` (ending in `adversarial-qa`). The user has
   explicitly said code review comes after the work.
4. Update the STATUS.md row as phases land; clear it after merge.

## Key files

- [`docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md`](../plans/2026-07-31-001-feat-resume-catch-up-plan.md) — the implementation authority. Goal Capsule carries the
  BLOCKING callout; Outstanding Questions Q1–Q9 are the live decision surface.
- `src/plugin/main.ts` — 2171 lines. The delete loop at `:1385-1392` (sits *outside* the `if (force)`
  block at `:1395` — this is hazard 1), the forced reconcile at `:1394-1418`, `confirmEmpty` derived
  from an empty scan at `:1397`, `applyAskOutbox` at `:1098` with the bad ack at `:1189-1196`,
  `drainInboxOnce` at `:294`, `maybeAutoRun` at `:719`, the hourly interval at `:633`.
- `src/platform/askMirror.ts:264` — `planAskMirrorDeletes`; `:11` — `LS_ASK_MIRROR_SERVER_COUNT`.
- `src/pipeline/inbox.ts:826` — the comment recording that two identical same-second captures must
  **both** file. `:836` and `:859` — the two `vault.modify` sites U2 migrates. `:849` — the existing
  re-read before the marker write.
- `src/platform/connectivity.ts` — `:44` `safeErrorBits` (the redaction helper U10 must reuse), `:58`
  and `:98` the two probes KTD7 forbids on the resume path.
- `src/platform/autorun.ts:24` `shouldRunAutoProcess`, `:38` the same-day re-entry, `:105`
  `waitForVaultIndexReady`.
- `STATUS.md:10` — this work's claim row.

## Decisions & constraints

- **Do not relitigate the round-2 structural changes listed above.** They came from seven
  independent reviewers and are already written into the plan.
- **Verified facts — do not re-derive:** `src/plugin/main.ts` is 2171 lines. `applyAskOutbox` is
  called at `:593` (was missing from the plan's caller table; now added). `Vault.process` exists in
  the installed `obsidian` 1.13.1 typings. `askMirrorStatus` (`src/platform/plusClient.ts:532`)
  requires a `sessionToken`, so it is **not** usable as the uncredentialed probe. `PER_LAUNCH_CAP` is
  `maxCaptures` **per pass**, not per launch — deleting it uncaps a pass.
- **No AI attribution in commits or PR bodies.** No `Co-Authored-By: Claude`, no "Generated with
  Claude Code". This is a hard global rule for this user.
- **Vault lanes:** all QA runs against `test_vault/` or `docs/media/demo-vault/`. Never touch
  `~/Documents/Remote Vault`. Never install plugin files into a personal vault.
- **Constitution wins:** `CLAUDE.md` non-negotiables override the plan. Notably #3 (never process
  today's daily on an automatic path) and the log-safety rule (never store raw error objects or
  keys — this is why U10 must redact).
- **Session hygiene:** hand off again at a phase boundary rather than running plan → work → review in
  one window.

## Open questions / blockers

**Blocking — must be answered before implementation:**

- **Q4 — the latency requirement.** Unanswered. Decides whether Phases B and C exist at all.
- **Q3 — split Phase A (U1 + U9) into its own PR?** Plan leans yes.
- **Q2 — cut U13 and R14?** Plan leans cut.

**Non-blocking, open:**

- Q1 midnight edge · Q5 passive "last caught up" surface (leans add, new product surface) · Q7 is
  "Sync everything now" the right name (counter-proposal: "Process everything now") · Q8 does U11
  belong in this plan (leans split out) · Q9 should the manual action ask before the paid stage when
  automatic filing is off.

**Unconfirmed against `plus-service`** — both affect U1 and neither is answerable from this repo:
does the server hard-delete or tombstone on reconcile, and what are the TTL/abort semantics for a
chunked reconcile session abandoned mid-flight by a suspended webview?

## Git state

- Branch `claude/obsidian-resume-sync-filing-072be6` (base `master`), pushed to `origin`.
- Last real commit: `fbff81e` — `docs: apply ce-doc-review round 2 to the resume catch-up plan`
- Handoff commit: the tip of this branch — `docs: handoff snapshot — resume-catch-up-doc-review`
- Diff since base: 3 files changed, +1631 (`STATUS.md`, the plan, this doc). No `src/` changes.
- This is a **linked worktree nested under `.claude/worktrees/`**, which is against the usual sibling
  convention. It already exists and is where the work lives, so use it rather than creating another.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/one-132c40
git fetch origin && git switch claude/obsidian-resume-sync-filing-072be6 && git pull --ff-only
npm install
npm test
npm run build
```

Then continue from **Next steps** above — step 1 is asking the user Q2, Q3 and Q4.
