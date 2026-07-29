---
handoff_date: 2026-07-29
branch: feat/bm25-shortlist
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/187
status: in-progress
---

# Handoff — implement the BM25 body-scored shortlist (#186)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Replace the all-titles classify context with a shortlist scored against each capture — ranked on
note bodies, tags and link prose, not titles alone. Route it through the `ContextProvider` seam that
already exists and is currently dead code. This is #186, and the plan is written, reviewed and
committed: **`docs/plans/2026-07-29-001-feat-bm25-shortlist-retrieval-plan.md`**. That plan is your
implementation authority — read it before writing any code.

Three facts justify the change, all verified this session against real code or the owner's real
vault:

- `plus-service` shows the model the **alphabetically-first 40** titles. Scored against the owner's
  real vault links it retrieves **0%** of them. Plus is the revenue path; the owner called this the
  most important part.
- Uncapped context does not scale — input grows ~11 tokens per vault title, so a catch-up runs
  $3.23/thousand at a 200-note vault and $13.32 at 5,000. Capped at 400 it is flat at $3.65.
- `write.ts:120` (the everyday **Process** path) and `backfill.ts:268` both build context **once,
  before the loop over captures**, so an atom created early in a run is invisible to every capture
  after it.

## Current status

**The claim is complete and no implementation code exists yet.** That is the intended state.

- Issue [#186](https://github.com/taihartman/obsidian-atoms/issues/186) created and assigned.
- Draft PR [#187](https://github.com/taihartman/obsidian-atoms/pull/187) open against `master`,
  carrying `Closes #186`, core user stories, edge cases, and an unchecked Test plan.
- `STATUS.md` row added for #186 with the hot-file list.
- The plan is written, committed, and has had a coherence + feasibility review pass applied. One
  real contradiction was found and fixed in it — see KTD4a below.
- No `src/` changes. Working tree clean, everything pushed.

This branch also carries ~30 commits of research on #168 (measurement harnesses under `scripts/`,
findings under `docs/research/`). That is deliberate: `scripts/lib/shortlist.mjs` is the code U1
ports from, and the research is the evidence for the change. Do not strip it.

## Next steps

1. **Read the plan in full**: `docs/plans/2026-07-29-001-feat-bm25-shortlist-retrieval-plan.md`.
   It has eight units, U1–U8, dependency-ordered, each with enumerated test scenarios.
2. **Start `ce-work` on that plan.** U1 is the only unit with no dependencies — porting the
   tokeniser and BM25 from `scripts/lib/shortlist.mjs` into `src/pipeline/shortlist.ts` as pure,
   Obsidian-free code. Its execution note says write the parity test *before* the port: pin
   research fixtures and their expected ranking, then make the TypeScript reproduce them.
3. Work U2 → U8 in order. U4 and U7 each carry a regression test that **must fail on `master`
   before it passes** — that is the proof the plan fixed something real, so run them against the
   pre-change behaviour first.
4. **Run the mandatory shipping tail** before calling it done — `ce-simplify-code`,
   `ce-code-review`, `ce-compound`, then `world-class-qa` including its adversarial half. This is
   non-optional per `CLAUDE.md`; stopping at "tests green + committed" is a shipping-tail bug.
5. **Fill in PR #187's Test plan checkboxes only after each command actually ran**, and attach
   vault screenshots for the Settings → Atoms surface (U8) under
   `docs/qa/screenshots/feat-bm25-shortlist/`, linked with absolute
   `https://raw.githubusercontent.com/...` URLs — repo-relative image paths do not render in PR
   descriptions.

## Key files

**Your authority**

- `docs/plans/2026-07-29-001-feat-bm25-shortlist-retrieval-plan.md` — the plan. U1–U8, KTDs,
  verification contract, definition of done.
- `docs/handoffs/2026-07-29-atoms-corpus-build.md` — the research record, including a
  "Why the corpus was stopped" section and corrections to three figures that were wrong.

**The seam you are changing**

- `src/pipeline/context.ts:19` — `ContextProvider.getCandidates(capture)`. It takes the capture,
  ignores it, and delegates to `buildContext()`. Making it real is U3.
- `src/pipeline/write.ts:120` — the daily **Process** path. `buildContext()` called once before the
  capture loop. U4.
- `src/pipeline/preview.ts:247` — dry-run. U4.
- `src/pipeline/backfill.ts:268` — batch path, same build-once bug. U5.
- `src/pipeline/refreshAtoms.ts:727` and `:862` — update path. U5.
- `plus-service/src/anthropic.mjs:47` and `plus-service/src/config.mjs:162` — the alphabetical-40
  truncation. U7.

**What you port from**

- `scripts/lib/shortlist.mjs` — `tokens()`, `bm25Rank()`, field weighting. Every finding on this
  branch was measured with this code; U1 ports it rather than reimplementing.
- `scripts/analyze-vault-shortlist.mjs` — read-only real-vault scoring. Source of the 0% figure and
  of the Sync-placeholder read tolerance U2 needs.

**Do not touch**

- `docs/plans/2026-07-28-003-feat-plus-vault-catch-up-plan.md` — Plus billing and delivery, still
  requirements-only with four open blockers. Explicitly out of scope; do not enrich or depend on it.

## Decisions & constraints

**Do not relitigate these — they were settled with the owner this session.**

- **Plus is in scope.** The owner was explicit: it is the revenue path and the most important part.
- **The Plus fix is order preservation, not server-side scoring.** The device scores and sends a
  *ranked* shortlist; the server must honour that order and cap at `k` instead of re-sorting
  alphabetically. Scoring server-side would require shipping note bodies to the service, which
  `CLAUDE.md` non-negotiable 12 forbids. Note bodies never leave the device.
- **Graph expansion is in this plan** (U6), not deferred. The owner asked for it directly to make
  daily filing better. It is behind a setting so its contribution can be measured.
- **KTD4a is load-bearing and easy to get wrong.** KTD4 says build the body corpus once per run;
  R4 says an atom created mid-run must be visible to later captures. Those conflict unless the
  corpus is **seeded once from the vault and appended to as the run writes atoms**. No re-read is
  needed — the run already holds each new atom's text. A provider that caches for the plugin's
  lifetime rather than the run's reintroduces the exact bug this plan fixes.
- **Port the research BM25, don't reimplement it.** Divergence between shipped behaviour and what
  was measured is the risk being avoided.
- **k=400 default, configurable.** BYOK backfill and Plus have different bars ("as good as
  uncapped" vs "better than alphabetical-40").
- **Graph expansion does nothing for catch-up** — 0% by construction, since the only edges there are
  atom→hub and traversal through hubs is blocked. The code must not imply a backfill win.
- **Vault lanes.** All CLI verification runs against the throwaway vault `test_vault/test vault/`
  with Obsidian open. Never against the owner's Remote Vault. The owner interrupted once this
  session to enforce this — respect it.
- **No AI attribution** in commits or PR bodies. Hard rule, no exceptions.

**Trust levels on the research numbers.** Zero-score counts are trustworthy (byte-identical across
every corpus variant). Recall@k *magnitudes* from the synthetic corpus are ±10 points and should not
be quoted. In particular the "+7 points" for graph expansion is not reliable, though the mechanism
(29% of zero-score misses are hub-reachable) is. Do not put a recall number in a changelog.

## Open questions / blockers

- **None blocking.** U1 can start immediately.
- One judgement call is deferred to implementation by design: whether note bodies need a truncation
  limit in U2. Real atom captures average 123 chars (median 97, only 5 of 37 over 200), so the plan
  says decide it on memory rather than recall. Measure before adding a limit.

## Git state

- Branch `feat/bm25-shortlist` (base `master`), pushed to `origin`, upstream set.
- Reused the existing linked worktree at
  `/Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study` — nothing new was created.
- Last real commit: `665606a chore(#186): claim the BM25 shortlist work`
- WIP snapshot commit: the tip of this branch, subject `wip: handoff snapshot — bm25-shortlist-impl`
  (a commit cannot record its own SHA inside itself — use `git log -1`).
- Diff since base: 56 files changed, +28,975 / −3 (mostly the #168 research; zero `src/` changes).

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
git fetch origin && git switch feat/bm25-shortlist && git pull --ff-only
npm install
npm test                  # 545 tests, all passing at handoff
npm run build             # typecheck + production bundle
```

For CLI verification later in the work, Obsidian must be open on the throwaway vault, then
`./scripts/install-to-vault.sh` and `./scripts/verify.sh`.

Then continue from **Next steps** above.
