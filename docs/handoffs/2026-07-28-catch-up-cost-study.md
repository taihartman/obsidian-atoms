---
handoff_date: 2026-07-28
branch: claude/catch-up-cost-study
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/168
status: in-progress
---

# Handoff — measure the real classify cost, then fix the prompt, then re-price #168

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did.

## Goal

You are settling what an Atoms classify call actually costs, because the number the #168 pricing
plan was built on turned out to be roughly ten times too low. Then you are fixing the cause — the
prompt sends every note title in the vault on every request — and re-deriving the catch-up prices
from measured numbers instead of arithmetic. The pricing work is downstream of the measurement;
do not touch prices until the measurement is done.

## Current status

**What is established (do not re-derive):**

- The classify prompt embeds **every note title in the vault, in full, on every request**
  (`src/pipeline/context.ts`, the v1 `MetadataContextProvider`). There is no cap or shortlist.
  Real atom titles average 42 characters, so a 3,000-note vault adds ~144,000 characters to every
  single request. Measured offline against the repo's own request-building code — see
  `docs/research/2026-07-28-classify-prompt-cost-measurement.md`.
- Cost per capture therefore **scales with vault size**: ~0.54¢ empty, 1.4¢ at 500 notes, 3.2¢ at
  1,500, 5.9¢ at 3,000, 9.5¢ at 5,000 (Sonnet rates, batch discount, 250 output tokens, **no cache
  credit**). The plan's 0.63¢ is the cost of filing into an *empty* vault.
- **Prompt caching works.** The owner ran `npm run spike:api` himself on 2026-07-28: call 1 wrote
  1,586 tokens to cache, calls 2 and 3 each read all 1,586 back. Verdict line: `CACHE HIT on call 2`.
  With the cache credit applied, a 3,000-note vault comes back to roughly **0.8¢ per capture** and a
  3,000-capture catch-up to roughly **$17** rather than $71–96.
- **Output tokens run above the assumption.** `ASSUMED_OUTPUT_TOKENS = 250`
  (`src/pipeline/backfill.ts:50`). The owner's run measured 296 and 410 on real atom
  classifications (a third call returned 39 for a trivial `task` verdict). So 20–65% high.

**What is NOT established — this is your job:**

- Whether caching holds at a **38,000-token prefix** inside a **Batch API** job running for hours.
  All the cache evidence is a 1,586-token prefix in realtime calls. This is worth ~$50 on a single
  catch-up and it is the largest open number.
- Exact token counts. Everything above uses characters ÷ 4, not a tokenizer. Order of magnitude is
  solid; precise figures are not.
- Whether a capped/shortlisted context degrades link quality, and at what size it stops mattering.

**Already shipped, do not redo:** [PR #183](https://github.com/taihartman/obsidian-atoms/pull/183)
merged to master — Cloudflare Web Analytics allowed through the CSP, privacy page updated. Verified
on a preview deploy before merge. The live site has NOT been redeployed; when it is, check the
Cloudflare dashboard actually starts showing numbers.

**Not written yet:** `scripts/measure-classify-cost.mjs`. A subagent was building it when the
session ended. It does not exist. Writing it is step 1.

## Next steps

1. **Write `scripts/measure-classify-cost.mjs`** plus a `"measure:cost"` npm script. Reuse the
   offline harness a previous agent built — it constructs the real request body from the repo's own
   functions, and its findings are in
   `docs/research/2026-07-28-classify-prompt-cost-measurement.md`. Follow `scripts/spike-api.mjs`
   conventions exactly: read `process.env.ANTHROPIC_API_KEY`, exit cleanly if absent, **never print
   the key** (fingerprint only). Three phases: (A) free — exact `count_tokens` at vault sizes 0 /
   500 / 1500 / 3000 / 5000; (B) cheap, `--spend` gated — cache behaviour at a realistic ~38K
   prefix, reading `cache_creation_input_tokens` and `cache_read_input_tokens`; (C) `--spend` gated
   — real output tokens including reasoning, replicating plus-service's request shape exactly (it
   deliberately omits `output_config.effort`, see `plus-service/src/anthropic.mjs`). Print a spend
   estimate before B and C; hard-cap paid calls at 30.
2. **Run phase A.** Free. It replaces every characters-÷-4 figure with exact numbers.
3. **Run phases B and C**, then answer the batch-caching question — ideally by submitting a real
   Batch job large enough to run for a while and reading the cache figures off the results.
4. **Re-derive the cost table** from measured inputs and write it into
   `docs/research/2026-07-28-classify-prompt-cost-measurement.md`, replacing the estimates.
5. **Then, and only then, prototype the shortlist.** `ContextProvider` in `src/pipeline/context.ts`
   is already the designed seam — `docs/architecture.md` describes it as "all-titles v1; shortlist
   later." Build a candidate selector (tag / keyword / recency overlap) and measure link quality
   against the full-title baseline at N = 50, 150, 400. Report where quality stops improving. The
   owner must eyeball the disagreements himself — a benchmark can say the shortlist picked a
   *different* link, not a *worse* one.
6. **Rewrite the #168 plan** against the measured numbers, fixing the doc-review findings.

## Key files

- `docs/plans/2026-07-28-003-feat-plus-vault-catch-up-plan.md` — the requirements plan. **Its cost
  assumptions are wrong**; everything else stands.
- `docs/qa/2026-07-28-168-catch-up-plan-doc-review.md` — seven-persona review of that plan. Four P0s
  and a stack of P1s. Read this before rewriting the plan.
- `docs/research/2026-07-28-classify-prompt-cost-measurement.md` — the offline cost measurement.
- `docs/research/2026-07-28-168-catch-up-code-grounding.md` — verified `file:line` dossier of every
  relevant code path (backfill, pricing SSOT, plus-service routes, Stripe, outbox, meter). Saves you
  a fresh code survey.
- `docs/research/2026-07-28-168-catch-up-growth-brief.md` — the pricing/positioning reasoning.
- `src/pipeline/context.ts:127` — `MetadataContextProvider`, the "every title" provider. This is the
  thing to cap.
- `src/pipeline/backfill.ts:50` — `ASSUMED_OUTPUT_TOKENS = 250`, measured too low.
- `src/pipeline/backfill.ts:91` — `estimateBatchCost`, whose "worst case" assumes no cache credit.
- `src/plugin/main.ts:851` — `requireApiKey()` in `runBackfillFlow`; the BYOK gate #168 removes.
- `src/plugin/main.ts:1449` — `requireClassifyAuth()`, the Plus-aware path backfill does not use.
- `plus-pricing.json` — pricing SSOT. No catch-up field yet.

## Decisions & constraints

- **Never handle the API key value.** Do not read it, echo it, write it into a file, or export it.
  The owner places it; you only run tooling that reads it from the environment. He appended an
  export to `~/.zshrc` on 2026-07-28 — verify presence without printing the value, e.g.
  `[ -n "${ANTHROPIC_API_KEY:-}" ] && echo "set, length ${#ANTHROPIC_API_KEY}"`. If it is absent or
  expired, ask him to place a fresh one; do not work around it. The key he used during the session
  had a 3-hour expiry and should be assumed dead.
- **The pricing shape is settled; the numbers are not.** Approved: some free catch-up on any plan,
  much more on yearly as the reason to choose yearly, pay per thousand beyond. Approved figures were
  100 free on trial, 100 on monthly, 3,000 on yearly. **Do not relitigate the shape.** The
  per-thousand price is genuinely open — $10 was agreed, then argued back up to $15 once the cost
  error surfaced. Re-derive it from the measurement.
- **Catch-up must use the same model quality as normal filing** (owner-directed). Today's backfill
  defaults to Haiku while Plus files with Sonnet; that is backwards for the biggest batch a user
  ever runs.
- **Multiplayer repo.** Hard claim before implementation: assigned GitHub Issue + `STATUS.md` row +
  draft PR. Measurement and research do not need a claim; changing `context.ts` does.
- **Vault lanes.** Agent work goes in `test_vault/` or `docs/media/demo-vault/` only. Never write to
  `~/Documents/Remote Vault`.
- **Plain English with this owner.** He has explicitly asked twice for no growth/product jargon —
  no "activation event", "COGS", "D7", "decoy", "entitlement". Say what it costs and what it does.
- **When he says a decision is hard or "I don't know" twice, stop offering menus** and give one
  concrete recommendation with real numbers.

## Open questions / blockers

- **Does caching hold at a 38K prefix across a multi-hour Batch job?** The single most valuable
  unknown. Everything downstream moves by ~4× on the answer.
- **The cache/link-quality conflict.** Refreshing the title context mid-run lets atoms link to atoms
  filed earlier in the same run, but changes the prefix and destroys the cache. Freezing it saves
  ~$50 and produces thousands of atoms that cannot reference each other. Blocks of ~500 are the
  obvious compromise but the block size is unchosen and it is a product decision, not plumbing.
- **Does the existing Plus plan's margin hold?** The same prompt growth applies to ordinary filing —
  a realtime filing against a well-developed vault may cost far more than the 1.26¢ previously
  assumed. Caching probably rescues it, but nobody has checked, and it matters more than #168.
- Four P0s in the doc review are unaddressed: the Stripe webhook collision (any new payment-mode
  price falls into the existing top-up catch-all and grants 50 filings), the variable grant amount
  having no trusted server-side source, "debit only on notes actually filed" being unimplementable
  as written, and the free allowance having no stated lifetime.

## Git state

- Branch `claude/catch-up-cost-study` (base `master`), pushed to `origin`.
- Last real commit before this handoff: `d4d30c1 docs(handoff): #168 Plus vault catch-up, then the
  power-user story`
- WIP snapshot commit: see below
- Contents: the #168 requirements plan, the seven-persona doc review, the cost measurement, the code
  grounding dossier, the growth brief, and two rescued QA reports (dark-mode contrast, adversarial +
  accessibility) that the owner deferred but which contain real measured defects.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
git fetch origin && git switch claude/catch-up-cost-study && git pull --ff-only
npm install
npm test
```

Then continue from **Next steps** above, starting at step 1.
