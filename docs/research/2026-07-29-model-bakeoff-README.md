# Model bake-off harness — how to run it, how to read it

`scripts/model-bakeoff.mjs`

## The question it answers

Do OpenAI's GPT-5.6 tiers file captures as well as Sonnet 5, and at what price?

This exists because the BM25 shortlist plan's cost justification collapsed. Its **$3.65 per
thousand captures** is a *cache-read* price for a **frozen** 400-title prefix. The per-capture
shortlist that plan builds changes the prefix on every capture, so the prefix is never read back
and the real number is **~$11.09 per thousand**. Rather than shrink the shortlist, the owner asked
whether a cheaper model removes the problem instead. If Terra or especially Luna hold quality, the
entire cost trade-off in that plan changes.

So the harness reports cost **both ways** — cached-prefix and uncached — on every arm. Reporting
only one is how the original number went wrong.

## Running it

```bash
# Estimate only. Spends nothing, needs no key. This is the default.
node scripts/model-bakeoff.mjs

# Cheap smoke run — first 50 captures, all five arms.
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... node scripts/model-bakeoff.mjs --limit 50 --confirm

# Full run — 720 captures x 5 models.
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... node scripts/model-bakeoff.mjs --confirm \
  --out docs/research/data/2026-07-29-model-bakeoff.json

# Re-score a saved run. No API calls, nothing spent.
node scripts/model-bakeoff.mjs --replay docs/research/data/2026-07-29-model-bakeoff.json
```

Both keys are read from the environment and **never** printed, persisted, or written to `--out` —
only a `…abcd (len=N)` fingerprint, per `CLAUDE.md` log safety. `--out` contains corpus ids, model
output, usage counters and timings, and nothing else.

**Nothing is billable without `--confirm`.** Without it the harness prints the estimate and exits.
This mirrors `backfill.ts`'s estimate-then-confirm spend gate. A hard `MAX_REQUESTS` ceiling
(5,000) applies whatever the flags say.

| Flag | Meaning |
|---|---|
| `--models a,b,c` | arms to run (default: the five below) |
| `--limit N` | first N captures in date order |
| `--confirm` | required before any billable call |
| `--parallel` | run the arms concurrently; each arm stays strictly chronological |
| `--reasoning EFFORT` | OpenAI reasoning effort — `minimal`/`low`/`medium`/`high`, default `low` |
| `--pre-run N` | extra filler titles in the pre-run vault (default 0 = hub titles only) |
| `--out PATH` | write the full run, re-scorable with `--replay` |
| `--replay PATH` | score a saved run instead of calling any API |

### The arms

| Model | Why it is in |
|---|---|
| `claude-sonnet-5` | the incumbent — every other number is judged against it |
| `claude-haiku-4-5` | known cheap Anthropic floor (~81% on the old 20-fixture bake-off vs Sonnet's ~98%) |
| `gpt-5.6-terra` | balanced mid-tier |
| `gpt-5.6-luna` | **the one to watch** — OpenAI positions this tier for classification, routing and high-volume work, which is exactly what Atoms' classify step is |
| `gpt-5.6-sol` | ceiling check only; nobody is proposing to ship it |

Adding a sixth model is a row in the `PRICES` table at the top of the script. The provider adapter
is chosen off that row's `provider` field.

## What it measures

Ground truth is `scripts/fixtures/chrono-corpus-{a,b,c,d}.json` — 720 dated captures, 576 atoms,
**811 in-run gold links**, plus 677 links to 50 hub titles that existed before the run. The schema
and the authoring bar are in `scripts/fixtures/README-chrono-corpus-schema.md`. The harness asserts
the 811 on startup and refuses to run if the corpus has drifted, because a silently changed answer
key matters more than any score computed against it.

This replaces the 20-fixture rubric in `docs/qa/2026-07-27-plus-model-effort-bakeoff.md`. That
rubric scored a model against hand-written expectations of its own output shape; this one scores it
against links a human declared before any model saw the corpus.

**The chronological seam is the point.** Captures are processed one at a time in date order, and an
atom's model-written title only enters the vault title list *after* it is created. That is what
makes a proposed link resolvable back to a capture id, and it is exactly what today's frozen
pre-run title list (`backfill.ts:268`) cannot reproduce.

Per arm:

- **Link precision / recall / F1** against the 811 — the headline quality number.
- **Verdict agreement** (atom / task / noise) with a confusion breakdown. The corpus declares only
  `atom` and `noise`; a `task` verdict is always wrong and shows up as such.
- **Hub-link precision / recall** against `linksToExisting`, reported separately so the easy links
  (a named recurring person or project) cannot inflate the hard ones.
- **Tokens in / out per capture**, taken from each provider's own `usage` block. Nothing estimated.
- **Cost per thousand captures**, three ways (below).
- **Wall-clock per capture** — median, mean, p90, max.

### Reading the precision numbers

A model returns a *title*; the answer key is *capture ids*. The scorer rebuilds the same title
index the run built and maps each proposed title back to the capture whose atom carries it. A title
matching nothing in the vault is a hallucinated note — a real error, counted as one.

- **`linkP` (strict)** — hallucinated titles count as false positives. *Was the model right?* This
  is the headline.
- **`precisionLenient`** (in `--out`) — hallucinated titles excluded. *Of the links it could
  actually make, was it right?*

### Reading the cost numbers

| Column | Meaning |
|---|---|
| `$/1k unc` | every input token at the full input rate — the honest price of a prefix that changes on every capture |
| `$/1k cach` | stable prefix at the 10% cache-read rate — the optimistic bound the plan was quoting |
| `usdPer1kMeasured` (in `--out`) | what the run actually cost, cache writes included |

The Batch API halves all three.

For Anthropic arms the prefix/suffix split is **exact**: the `cache_control` breakpoint sits at the
end of the context block, so `cache_creation + cache_read` *is* the prefix and `input_tokens` is
the volatile suffix. For OpenAI arms the split is only observable when the automatic prefix cache
actually hits; when it does not, `cachedPrefix` treats the whole input as cacheable. That
**overstates the discount** by the size of the volatile capture message — roughly 40 tokens against
a multi-thousand-token request, under 1%. The error runs toward the optimistic case, so it cannot
rescue a model that looks expensive.

Prices live in **one table** at the top of the script with a source-and-date comment per block, so
a stale price is obvious rather than buried. The Anthropic rows are copied from
`scripts/measure-classify-cost.mjs:53-58` — re-sync from there rather than retyping. The OpenAI
rows are GPT-5.6 list prices checked 2026-07-29; `gpt-5.6` is an alias routing to `gpt-5.6-sol`.

## The prompt is the real one

The harness bundles `src/pipeline/classify.ts` and `src/pipeline/context.ts` with esbuild — same
trick `measure-classify-cost.mjs` uses — and calls `buildMessagesRequest`, `SYSTEM_PROMPT`,
`buildContextUserMessage`, `buildCaptureUserMessage` and `CLASSIFICATION_SCHEMA` directly. Nothing
about the prompt is reimplemented. A bake-off run against a paraphrased prompt measures a prompt
nobody ships.

`scripts/plus-model-bakeoff.mjs` keeps its own copy of the system prompt. That copy is not used
here, and the two will drift; treat this harness as the current one.

## OpenAI structured output — which mechanism, and why

**Structured Outputs on the Responses API: `text.format = { type: "json_schema", strict: true, … }`.**

- **Responses API, not Chat Completions** — GPT-5.6 ships on Responses, and that is where
  structured outputs and the reasoning controls live.
- **Not tool/function calling** — classify has exactly one output shape and no tool to call.
  Wrapping it in a fake tool adds a call/result round trip and a second failure mode for nothing.
- **Not `json_object`** — only `strict: true` json_schema guarantees the grammar. The plugin
  already depends on Anthropic's `output_config` json_schema for exactly that guarantee, so a
  loose-mode OpenAI arm would fail differently from the Anthropic arms and quietly change what the
  bake-off is comparing.

**The one adaptation.** Strict mode requires every declared property to appear in `required`, while
the plugin's schema leaves `hub_section` optional. `openaiStrictSchema()` walks the schema and
promotes every optional field to required (and re-asserts `additionalProperties: false`). No
semantics are lost: the field's own description already asks for the empty string when there is no
fit, which is what the model now always has to supply. This is the only difference between the two
providers' requests.

The system prompt becomes `instructions`; the stable context and volatile capture stay two separate
user turns in the same order, so the cacheable prefix boundary sits in the same place on both
providers.

**Reasoning effort defaults to `low`.** GPT-5.6 tiers are reasoning models and effort moves both
cost and quality, so it is a flag rather than a constant. `low` is the setting that makes the arms
comparable to Sonnet 5 without extended thinking, which is what the plugin ships. If an OpenAI arm
loses on quality, re-run that arm at `medium` before concluding anything — and re-read the cost
column, because reasoning tokens bill as output.

## Offline scorer proof

`scripts/fixtures/bakeoff-scorer-proof.json` is a canned set of model responses for the first 20
corpus captures, hand-authored to exercise the scorer with no API call:

```bash
node scripts/model-bakeoff.mjs --limit 20 --replay scripts/fixtures/bakeoff-scorer-proof.json
```

It goes through the *same* `scoreRecords()` the live path uses. Expected output:

| | Value |
|---|---|
| gold in-run links in scope | 8 |
| gold hub links in scope | 23 |
| link precision (strict) / recall / F1 | 62.5% / 62.5% / 62.5% |
| verdict accuracy | 95.0% |
| hub precision / recall | 95.7% / 95.7% |

Constructed as: 5 of the 8 gold links found, 2 wrong in-run links, 1 title pointing at no such note
(so strict precision is 5/8 and lenient is 5/7), one noise capture called an atom, one hub link
missed and one invented. Usage counters are zero by design, so every cost column reads `$0.00` —
the fixture proves the scorer, not the pricing.

## Caveats worth stating before quoting any number

- **`--pre-run` defaults to 0**, so the vault starts as the 50 hub titles and grows to ~576 atom
  titles over the run. A real three-year vault is larger, and input cost scales with it. Raise
  `--pre-run` to price a bigger vault; the *quality* numbers move less than the cost ones.
- **The pre-flight estimate is chars÷4** with a 250-token output assumption
  (`backfill.ts`'s `ASSUMED_OUTPUT_TOKENS`) and stand-in titles. It exists to gate spend, not to be
  quoted. The reported cost after a run is measured.
- **`--parallel` does not change any score** — each arm's chronological pass is independent — but
  it will hit provider rate limits sooner.
- One arm failing does not abort the others; per-arm `failures` and `unparseable` counts print
  under the table and are in `--out`. **Read them before comparing scores** — a model that failed
  200 requests has an unearned precision number.
