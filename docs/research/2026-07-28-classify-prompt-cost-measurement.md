# Atoms classify prompt: how it grows with vault size, and what a capture actually costs

**Date:** 2026-07-28 · **Method:** local measurement only. No API calls. No vault writes.
**Code measured:** `/Users/a515138832/StudioProjects/obsidian_plugin` — `src/pipeline/classify.ts`,
`src/pipeline/context.ts`, `src/pipeline/backfill.ts`. Verified identical between `master` and the
`docs/handoff-168` branch that carries the plan (`git diff --stat master docs/handoff-168 -- src/pipeline/`
returned empty).

**Verdict up front:** the reviewer is right and the plan is wrong by roughly 10x. At a 3,000-title
vault the classify request is **~38,000 input tokens**, not ~2,950. The plan's 0.63¢ is arithmetically
the cost of classifying into an **empty vault**.

---

## 1. The code that assembles the prompt

`src/pipeline/classify.ts:397` — the whole request body:

```ts
export function buildMessagesRequest(opts: BuildRequestOptions): Record<string, unknown> {
  const cacheTtl = opts.cacheTtl ?? "5m";
  const contextText = buildContextUserMessage(opts.context);
  const captureText = buildCaptureUserMessage(opts.capture);

  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: [{ type: "text", text: contextText,
          cache_control: { type: "ephemeral", ttl: cacheTtl } }] },
      { role: "user", content: [{ type: "text", text: captureText }] },
    ],
    output_config: { format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA } },
  };
}
```

`src/pipeline/classify.ts:159` — the part that scales with the vault. **Every note title in the
vault is rendered as its own `- Title` line, in full, on every request:**

```ts
const titles = context.titles.length
  ? context.titles.map((t) => `- ${t}`).join("\n")
  : "(empty vault)";
...
  "### Note titles",
  titles,
```

`src/pipeline/context.ts:130` — where `titles` comes from. This is the v1 provider and it is
unfiltered: **every markdown file in the vault**, plus every frontmatter alias.

```ts
buildContext(): VaultContext {
  const files = this.app.vault.getMarkdownFiles();
  const caches = files.map((f) => ({ path: f.path, cache: this.app.metadataCache.getFileCache(f) }));
  const titles = collectLinkTargets(caches);
```

The doc comment above it says so plainly: *"v1 ContextProvider: every markdown title + every vault
tag. Reads metadataCache synchronously; no index, no embeddings."* The shortlist seam (KTD6) exists
but is not implemented — there is no truncation, no top-K, no cap anywhere on the path.

`src/pipeline/backfill.ts:91` — the cost model the plan cites. Note it prices the **full prefix on
every request** and explicitly refuses to credit cache reads:

```ts
const worstCaseInputTokens = perIn * n;
const estimatedOutputTokens = perOut * n;
const worstCaseUsd =
  ((worstCaseInputTokens * rates.input + estimatedOutputTokens * rates.output) / 1_000_000) * disc;
```

with `BATCH_DISCOUNT = 0.5`, `ASSUMED_OUTPUT_TOKENS = 250`,
`MODEL_RATES_USD_PER_MTOK["claude-sonnet-5"] = { input: 3, output: 15 }`.

`src/pipeline/backfill.ts:222` (`buildBatchCreateBody`) takes a **single** `context` and reuses it
for every request in the batch, and `prepareBackfillEstimate` (line 268) builds that context once,
before the run. This matters for section 6.

---

## 2. Measured title and tag distribution

Real atom filenames, not invented ones.

| Source | Count | Mean chars | Median | Min | Max |
|---|---|---|---|---|---|
| `test_vault/test vault/Atoms` | 84 | 42.6 | 45.5 | 16 | 64 |
| `docs/media/demo-vault/Atoms` | 9 | 38.0 | 33 | 21 | 69 |
| **Combined (used as the sample)** | **93** | **42.13** | **45** | 16 | 69 |

p10 = 24 chars, p90 = 53 chars. Examples: `Ask-your-brain could be Claude plus an Atoms mirror`,
`Short walk fixed design block better than more desk time`. These are declarative sentence-shaped
titles by design — the product mandates them — so ~42 chars is structural, not an artifact.

All markdown files in the test vault (129 files, i.e. what `getMarkdownFiles()` actually returns,
including daily notes) mean 31.98 chars. Daily notes are short and pull the average down, but they
**add to the count** — a 3-year vault contributes ~1,100 daily-note titles on top of its atoms. The
model below counts titles only, so it is if anything conservative.

**Tags:** bounded and negligible. `STRUCTURAL_TAGS` (8) ∪ `DEFAULT_ACTIVE_VOCABULARY` (8) = 13
distinct tags, ~7 chars each. Scanning both vaults for user tags found essentially none beyond
those. The tag block is ~150 chars regardless of vault size. **The dispute is entirely about titles.**

---

## 3. Method for the request-body measurement

A throwaway script (`scratchpad/measure.ts`) **imports the real repo functions** —
`buildMessagesRequest`, `buildVaultContext`, `SYSTEM_PROMPT`, `CLASSIFICATION_SCHEMA`,
`DEFAULT_ACTIVE_VOCABULARY` — bundled with esbuild using the repo's own vitest `obsidian` mock alias.
Nothing about the prompt was reimplemented.

Synthetic vaults are built by cycling the 93 measured real titles and appending a numeric suffix
after the first pass to keep them unique. **Approximation flagged:** that suffix inflates mean title
length from 42.13 to 44.76 chars, i.e. **+6.2%**. Every char and token figure below is therefore
about 6% high. Correcting for it, the 3,000-title body is ~145,000 chars ≈ **36,200 tokens** rather
than 38,139. This does not change any conclusion.

**Approximation flagged:** token counts are chars ÷ 4, not a real tokenizer. The repo's own
`countTokensForClassifyRequest` (`backfill.ts:140`) calls Anthropic's `/count_tokens`, which was off
limits here. A range at 3.5 and 4.5 chars/token is given throughout. English prose with heavy
newline-and-hyphen list structure tends to run slightly *worse* than 4 chars/token, so the central
estimate is more likely low than high.

Fixed costs measured directly: `SYSTEM_PROMPT` = 7,018 chars (~1,755 tokens);
`output_config` with `CLASSIFICATION_SCHEMA` = 1,584 chars (~396 tokens); capture message = 213
chars. **Approximation flagged:** whether the structured-output schema is billed as input tokens,
and where it sits relative to the cache breakpoint, is not something local measurement can settle. It
is 396 tokens — irrelevant at any vault size above ~200 titles.

---

## 4. Vault size → request size → cost per capture

Model `claude-sonnet-5` ($3 in / $15 out per Mtok), 50% batch discount, no cache credit — exactly the
`estimateBatchCost` worst case the plan invokes.

| Titles | Context chars | Total body chars | Tokens @4.5 | **Tokens @4.0** | Tokens @3.5 | ¢/cap @250 out | ¢/cap @1,000 out | ¢/cap @3,000 out |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 466 | 9,281 | 2,062 | **2,320** | 2,652 | **0.536¢** | 1.098¢ | 2.598¢ |
| 500 | 23,816 | 32,631 | 7,251 | **8,158** | 9,323 | **1.411¢** | 1.974¢ | 3.474¢ |
| 1,500 | 71,554 | 80,369 | 17,860 | **20,092** | 22,963 | **3.201¢** | 3.764¢ | 5.264¢ |
| 3,000 | 143,740 | 152,555 | 33,901 | **38,139** | 43,587 | **5.908¢** | 6.471¢ | 7.971¢ |
| 5,000 | 240,002 | 248,817 | 55,293 | **62,204** | 71,091 | **9.518¢** | 10.081¢ | 11.581¢ |

Subtract ~6% for the suffix inflation (section 3) and the 3,000-title row becomes ~36,200 tokens and
**~5.6¢**.

**Back-solve confirms the diagnosis.** Solving `0.0063 = (X·3 + 250·15)/1e6 × 0.5` gives
**X = 2,950 input tokens**. The measured request at **zero titles** is 2,320 tokens. So the plan's
0.63¢ is the cost of a request whose vault-context section is the literal string `(empty vault)`.
The number is not wrong by a modelling subtlety; it simply omits the vault.

**Reviewer's claim checked:** they said 26,000–38,000 tokens for a 3,000-title vault. Measured
33,900–43,600 (34,000–41,000 after the suffix correction). Their range is correct at the top and a
little low at the bottom.

**Context-window note:** at 5,000 titles the request is ~62,000 tokens on its own. Nothing breaks at
Sonnet's window, but a 20,000-note vault would be ~250,000 tokens and would start to.

---

## 5. Output tokens

`ASSUMED_OUTPUT_TOKENS = 250` and `max_tokens` defaults to 1,024, so 250 is a plausible cap-respecting
assumption for the JSON verdict itself. But `buildMessagesRequest` sets `output_config` with no
`effort` field, so a Sonnet-class model keeps its default reasoning behaviour and can spend
substantially more than 250 tokens before the JSON appears. Columns at 1,000 and 3,000 output tokens
are in the table above. At 3,000-title scale the effect is modest — input dominates so heavily that
tripling output moves 5.9¢ to 6.5¢. **At small vaults it dominates:** the empty-vault number swings
from 0.54¢ to 2.60¢. **Approximation flagged:** actual reasoning-token spend is unmeasurable without
a live call.

---

## 6. What a real 3,000-capture catch-up costs

Catch-up grows the vault while it runs, so one flat per-capture number is wrong in both directions.
Integrated numerically (body rebuilt every 25 captures), 250 output tokens, batch, no cache credit:

| Starting vault | Atom rate | **Total** | Effective avg |
|---|---|---:|---:|
| Empty | 100% | **$95.56** | 3.19¢/cap |
| Empty | 70% | **$71.46** | 2.38¢/cap |
| 1,000 titles already | 70% | **$125.42** | 4.18¢/cap |

At 1,000 output tokens those become $112 / $88 / $142. At 3,000 output tokens, $157 / $133 / $187.

**But the run shape changes the answer more than any of this.** Three shapes, 3,000 captures, 250
output tokens:

| Shape | Worst case (no cache credit) | Cache-credited |
|---|---:|---:|
| **Frozen context, one batch, empty start** — what `prepareBackfillEstimate` does today (builds context once at line 268) | **$16.07** (0.54¢/cap) | $8.49 (0.28¢/cap) |
| **Blocks of 1,000, context rebuilt per block, 70% atom rate** — the plan's KD | **$53.26** (1.78¢/cap) | $12.30 (0.41¢/cap) |
| **Fully growing context** (integrated, 70% atoms) | **$71.46** (2.38¢/cap) | — |

The cache-credited column assumes Anthropic's 1h-cache multipliers (write 2.0× base, read 0.1× base),
one write per frozen-context block, batch discount applied to all of it.
**Approximations flagged:** (a) the Batch API does not guarantee cache warmth across requests —
`estimateBatchCost`'s comment calls this out as the KTD3 batch caveat, and it is the reason the
worst-case column exists; (b) it assumes the schema and system prompt sit inside the cached prefix;
(c) it assumes every block's prefix is byte-stable, which the code does achieve within a block via
the deterministic sort in `buildVaultContext`.

The frozen-context row is cheap precisely **because** the context never grows — which means atom
#2,999 cannot link to atom #1. That is the product-quality cost of the cheap shape, and the plan's
"a deep, well-linked vault on day one" premise argues against it.

---

## 7. Verdict

**0.63¢ is not defensible.** It is the empty-vault cost, reached by an arithmetic path that back-solves
exactly to 2,950 input tokens against a measured 2,320 at zero titles. It happens to be *nearly right*
for the very first captures of a first-run catch-up on a brand-new vault, and it is wrong by ~10x by
the time that same run finishes.

**What should replace it,** for a 3,000-capture catch-up, Sonnet-class, batch, no cache credit:

- **Headline replacement number: ~2.4¢ per capture** (empty start, 70% atom rate, growing context,
  250 output tokens) — a **$71 total** for the 3,000-note run, against the plan's implicit ~$19.
- **If the context is rebuilt per 1,000-note block rather than per capture: ~1.8¢**, $53 total.
- **Worst plausible case** (starting from an already-large vault, or reasoning output above the 250
  assumption): **4–6¢ per capture**.
- **If cache reads genuinely land in batch: 0.3–0.4¢** — but nothing in the code verifies this, and
  `estimateBatchCost` deliberately refuses to promise it. Do not price on it.

**Direct consequences for the plan's numbers:**

- **The trial-abuse line is wrong.** "100 free notes per trial costs roughly 63¢" (line 194) assumes
  0.63¢. Against a real vault it is **$2.40–$6.00** per abandoned trial, 4–10x the stated figure.
- **The $30-for-2,897-notes block pricing (line 155) is at or below cost.** $30 buys 2,897 notes at
  1.04¢ each. The measured growing-context cost is 1.8–2.4¢ before any margin. **The pricing is
  underwater by roughly 2x** unless catch-up runs the frozen-context shape or cache reads reliably
  land.
- **"Roughly 0.2¢ realistically" is only reachable with a cache hit that the code does not guarantee.**
  Measured best case with full cache credit is 0.28¢, and that is the frozen-context shape.
- **"Normal Plus filing costs roughly 1.26¢ per note — realtime, no batch discount" (line 205) is
  wrong by the same 10x factor**, and worse, because realtime filing runs against the user's *full,
  current* vault by definition. At 3,000 titles a single realtime filing is ~38,000 input tokens =
  **~11.8¢** with no batch discount, or ~1.2¢ if the 5-minute cache is warm from a previous filing in
  the same session. Interactive one-off filings usually will *not* have a warm cache.
- The plan's own caveat — *"Unverified against a real batch — worth measuring before the prices
  ship"* (line 203) — was correct and should now be treated as blocking.

**The real lever is not the price, it is `MetadataContextProvider`.** Sending every note title on
every request is what makes cost grow linearly with vault size forever. The KTD6 shortlist seam
already exists in `context.ts` and is documented as swappable. Capping the title list at, say, the
300 most relevant candidates would hold the request near 15,000 chars (~3,800 tokens) at any vault
size and would make something close to the plan's original 0.63¢ true again — this time honestly.

---

## Everything approximated, in one list

1. Token counts are chars ÷ 4, not a tokenizer. Range given at 3.5 and 4.5. Real counts need
   `countTokensForClassifyRequest`, which requires an API call.
2. Synthetic titles run 6.2% longer than the real measured mean because of the uniquifying suffix.
   All chars/tokens/costs are ~6% high.
3. Title sample is 93 atoms from two dev vaults. The test-vault set is seeded and repetitive
   (`Morning thought number 42 about focus`); the demo-vault set is more natural. Both land at 38–43
   chars mean, which is why I trust the number.
4. Title counts model atoms only. A real vault also contributes daily notes, people hubs, projects
   and frontmatter aliases as titles — so the real request at "3,000 atoms" is **larger** than
   measured here.
5. Whether the JSON schema is billed as input, and its position relative to the cache breakpoint, is
   unresolved. It is 396 tokens; immaterial above ~200 titles.
6. Reasoning-output tokens are unmeasurable locally. 250 / 1,000 / 3,000 columns bracket it.
7. Cache-hit behaviour inside the Batch API is assumed, not verified. The code refuses to assume it,
   and so should the pricing.
8. Model rates are the repo's own constants, described in `backfill.ts:35` as "Conservative mid-2026
   public rates — estimate only, not a quote." Not independently verified.
