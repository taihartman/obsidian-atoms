---
handoff_date: 2026-07-29
branch: feat/bm25-shortlist
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/187
issue: 186
status: implementation-complete-shipping-tail-remaining
---

# Handoff — #186 shipping tail

**All eight implementation units are landed and committed.** What remains is the shipping tail:
`ce-compound`, `world-class-qa` (including its adversarial half), and the PR. A `ce-code-review`
pass was dispatched at the end of the prior session — check whether its findings landed before
assuming this branch is clean.

Read this file, run **How to resume**, then start at **Next steps**.

## State

| | |
|---|---|
| Branch | `feat/bm25-shortlist`, 13 commits ahead of `master` |
| Tests | **645** plugin (vitest), **180** plus-service (`node --test`) |
| Build | `npm run build` clean |
| Version | **0.6.51** (`manifest.json`, `package.json`, `versions.json` all bumped) |
| Diff | 26 files, +4467 / −450 across `src/`, `plus-service/src/`, `test/` |

**Nothing has been pushed.** All commits are local. The draft PR
[#187](https://github.com/taihartman/obsidian-atoms/pull/187) still shows the pre-implementation
state and its Test plan is entirely unchecked.

## What shipped, by unit

| Unit | Commit | What it does |
|---|---|---|
| U1 | `896a7d5` | Pure BM25F + tokeniser in `src/pipeline/shortlist.ts`, ported from the research code |
| U2 | `a1463ab` | `src/pipeline/candidates.ts` — corpus of body + title + tags + link prose, one read per note |
| U3 | `9eabb32` | `ContextProvider.getCandidates(capture)` made real; run-scoped corpus with explicit append |
| U4 | `dc4c063` | Process + preview route per capture; cache breakpoint split; `messagesRequest` dropped |
| U5 | `6014d14` | Backfill + refreshAtoms chunked by calendar month |
| U6 | `95390a1` | `src/pipeline/expand.ts` — hub-blocked 2-hop expansion, daily filing only |
| U7 | `496ed23` | plus-service honours the device's ranking instead of capping at alphabetical 40 |
| U8 | `be22418` | Settings surface + redacted diagnostics, v0.6.50 |
| — | `a217e0b` | Simplification pass: `Bm25Index` indexes once per run (4552ms → 269ms at 200×3000) |

Also on the branch: `9867d0c` (plan corrections), `9519cc6` (bake-off harness), `7903a7b` and
`4c9eec0` (bake-off results).

## Next steps

1. **Check the `ce-code-review` result.** A full-roster review was dispatched at the end of the
   prior session (`mode:agent plan:… base:master depth:full`) and may not have been folded in.
   If its findings never landed, re-run it. Fix P0/P1 before proceeding.
2. **`ce-compound`** — write the durable learnings to `docs/solutions/`. At minimum: the
   cache-breakpoint-versus-per-capture-context trap (below), and the fact that a "corpus built once"
   claim can be true for I/O and false for CPU at the same time.
3. **`world-class-qa`, including the adversarial half.** This is the gate that needs a human
   prerequisite — see **Blocked on a human** below.
4. **Update `STATUS.md`** — its #186 row still reads "Claimed, no code yet — U1 next", which is
   badly stale.
5. **Rewrite PR #187's body and push.** It needs `Closes #186`, distilled core user stories, edge
   cases, and vault screenshots of the new Settings controls committed under
   `docs/qa/screenshots/feat-bm25-shortlist/` and linked with **absolute**
   `https://raw.githubusercontent.com/...` URLs — repo-relative image paths do not render in PR
   descriptions.

## Blocked on a human

**`world-class-qa` cannot run unattended.** It requires Obsidian open on the throwaway vault
(`test_vault/test vault/`), then `./scripts/install-to-vault.sh` and `./scripts/verify.sh`. The
prior session had no Obsidian instance, so **every CLI verification gate in the plan's Verification
Contract is still unrun**:

```
obsidian command id=atoms:dry-run-preview
obsidian command id=atoms:process-fixture-sample
obsidian command id=atoms:backfill-estimate-confirm
```

Never against the owner's Remote Vault — `CLAUDE.md` vault lanes.

The Settings screenshots for the PR have the same prerequisite.

## Decisions taken this session — do not relitigate

- **Stay on Claude Sonnet 5.** The GPT-5.6 bake-off is settled and written up in
  `docs/research/2026-07-29-model-bakeoff-results.md`. Sonnet 48.7% link recall against Terra's
  30.9% and Luna's 20.8% at n=300 over 269 real links, with precision a three-way tie. ~$16 spent.
- **U5 chunks by month, deviating from the plan.** The plan said route backfill per capture like
  U4. Measured research (`docs/handoffs/2026-07-29-shortlist-and-model-study.md:50`) prices frozen
  at $30.79 / 0% links recovered, monthly at $18.81 / 71%, weekly at $23.18 / 79%, per-capture at
  $52.26 / 100%. Monthly beats the status quo on **both** axes; per-capture pays 2.8× monthly for
  the last 29%. Granularity is configurable.
- **Two plan figures were wrong and are corrected in the plan body.** "11 tokens per vault title"
  had no source (real: 16.47 per atom title, 13.83 per vault file). And the $3.23/$13.32/$3.65
  costs are **cache-read** prices for a *frozen* prefix — they do not survive a per-capture
  shortlist.

## The trap worth carrying forward

`classify.ts` renders `### Note titles` inside the block carrying `cache_control`. A per-capture
shortlist changes bytes inside the cached prefix, so **nothing is ever read back** — and leaving the
marker in place is *worse than removing it*, because you pay a 1.25–2× write premium on an entry
nobody reads. Measured per thousand captures: ~$29.40 marker-left-in, ~$15.84 marker-removed,
~$11.09 with the breakpoint split correctly.

Two structural hazards follow from that, both live:

- `assertBatchUsesHourCache` (`backfill.ts:239-251`) is a **runtime gate** that hard-codes
  `messages[0].content[0].cache_control.ttl`. Block A must stay at index 0.
- U5 added an **opt-in second breakpoint** at `messages[0].content[1]` for chunked backfill, because
  byte-identical titles buy nothing if they sit after the only breakpoint.

`test/context.test.ts:145` used to claim it guarded the cache prerequisite while calling the
renderer twice with the *same* context — it passed vacuously and would have stayed green through
exactly the change that invalidated it. It has been rewritten to assert the real property. Watch for
that failure shape elsewhere.

## Follow-up issues filed (handle in a separate session)

- [#196](https://github.com/taihartman/obsidian-atoms/issues/196) — **the big one.** With every
  title visible and nothing hidden by retrieval, Sonnet still found only 48.7% of connections. The
  classify prompt is written almost entirely in prohibitions. ~$7.76 to test; the baseline already
  exists. Possibly a larger lever than all of #186.
- [#197](https://github.com/taihartman/obsidian-atoms/issues/197) — re-test Terra once a
  recall-tuned prompt exists (blocked on #196).
- [#198](https://github.com/taihartman/obsidian-atoms/issues/198) — graph expansion blocks person
  hubs but not topic hubs; topic hubs have no plugin-side definition.
- [#199](https://github.com/taihartman/obsidian-atoms/issues/199) — every `$/1k` figure came from an
  unsaturated vault (~250 titles, below the 400 cap), so none is the real cost of a capped prompt.

**Not filed, worth knowing:** a three-year catch-up now submits ~36 Batch API requests back to back,
because cross-chunk visibility requires each chunk's atoms to exist before the next resolves. Small
batches usually clear in minutes; the stated ceiling is 24h each. Nobody has run it end to end.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
git switch feat/bm25-shortlist
npm install
npm test                          # 645
npm run build
cd plus-service && npm ci && npm test && cd ..   # 180
```

For the QA gates, open Obsidian on `test_vault/test vault/` first, then
`./scripts/install-to-vault.sh` and `./scripts/verify.sh`.

The bake-off harness is `scripts/model-bakeoff.mjs`. It reads keys from the environment and refuses
to spend without `--confirm`. Note that `~/.zshrc` carries both keys but non-interactive shells read
`~/.zshenv`, so tool calls need `zsh -ic '…'` to see them.
