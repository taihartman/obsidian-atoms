# On-device embeddings, and who we buy the paid call from

**Date:** 2026-07-29 · **Method:** web research against primary sources (vendor docs, model cards,
plugin repos, WebKit/ONNX issue trackers). No code was written, no vault touched, no API called.
**System assumed as measured, not re-derived:** BM25 over note text, ~400 candidates from a
3,000-note vault, recall 79–88%, dominant failure = vocabulary mismatch; one paid Anthropic call per
capture writes the title and picks the links.

Cost anchors carried over from [`2026-07-28-classify-prompt-cost-measurement.md`](2026-07-28-classify-prompt-cost-measurement.md):
a 400-title shortlist is **10,095 input tokens** per request, ~260 output tokens, **0.36¢/capture**
on batched, cache-credited Sonnet 5. The uncapped 3,000-title version is 52,930 tokens and 1.00¢.

---

## RECOMMENDATION

**1. Do not ship on-device embeddings. Not this quarter, and not as a mobile feature — ever, on the
current evidence.** The blocker is not model quality; small embedders are good and small. The
blocker is that Obsidian mobile is a Capacitor WebView with no cross-origin isolation, which means
no `SharedArrayBuffer`, which means single-threaded WASM, on a page whose realistic memory budget is
**300–450 MB shared with the editor and the whole vault**. A 23 MB int8 MiniLM is survivable there;
a first index of 3,000 notes is a multi-minute single-threaded grind on a phone, and ONNX Runtime
Web's own iOS tracking issue ([#22776](https://github.com/microsoft/onnxruntime/issues/22776)) is
still open. Shipping this would put a memory-pressure crash into the product's most fragile surface
to buy a few points of recall. That trade is bad.

**2. The cheap lever is bigger than the expensive one: raise `k` before you reason about
embeddings.** Hybrid BM25+dense with reciprocal rank fusion is the standard answer and it is real,
but the *measured* gain on this kind of task is a **few points of Recall@k, not a category change**
— a 2026 benchmark puts Recall@5 at 0.644 for BM25 and 0.695 for hybrid RRF, +5.1 points. Meanwhile
going from a 400-title shortlist to 800 costs about **+0.35¢/capture** and is a one-line change with
zero new runtime, zero download, zero mobile risk. Price the recall you want in tokens first. If
k=800 gets recall to the low 90s, embeddings never needed to enter the conversation.

**3. If the vocabulary-mismatch failure still bites after that, fix it on the document side, not
with a neural runtime.** The classic answer to vocabulary mismatch predates dense retrieval:
document expansion. Atoms already carry model-written tags and reason-bearing link text — folding
tags, aliases, and incoming-link anchor text into the BM25 document field is free, runs everywhere
including iOS, and attacks exactly the failure mode (capture and target share no words) without a
23 MB download. This is the highest ratio-of-recall-to-risk option available and it is not currently
in the plan.

**4. Desktop-only embeddings are technically viable but strategically wrong for this product.**
Transformers.js v4 (Feb 2026) with a WebGPU backend genuinely works well on desktop — a full-vault
index of 3,000 short notes is plausibly under two minutes. But CLAUDE.md non-negotiable #11 forbids
a platform-only product without an explicit plan note, and a retrieval quality that differs between
the user's laptop and their phone is exactly the kind of split that produces "why did it link
differently on my iPhone" bug reports. If you ever do it, do it as a *desktop-computed index the
phone reads*, never as a mobile-computed one.

**5. On providers, there is one dated fact that outranks the rest: Sonnet 5's introductory pricing
ends 2026-08-31 and the rate goes up 50%** ($2→$3 input, $10→$15 output). Every number in the
catch-up cost study becomes 1.5× on 1 September. That deserves a line in the plan this week
regardless of what else you decide.

**6. Do not switch providers for the price. Do consider OpenAI for the *cache terms*.** OpenAI's
cheap floor (`gpt-5.4-nano`, $0.20/$1.25/M) is roughly an order of magnitude below Sonnet 5 for this
call, but the classify call at 0.36¢/capture was never the expensive part — and the quality bar
("write a declarative title, pick real links from 400 candidates") is exactly where cheap models
degrade. The genuinely interesting difference is that **OpenAI caches automatically above 1024
tokens, charges nothing to write the cache on GPT-5.4, and defaults to 24-hour retention**, against
Anthropic's explicit breakpoints, 1.25× write, and **5-minute** default TTL. Sparse interactive
filing — a capture arrives, then nothing for hours — misses Anthropic's cache almost every time.
That is a real structural mismatch, and it is a better reason to look at OpenAI than the sticker
price. Bulk backfill, where requests land in a burst, is unaffected.

**7. "An open AI model" in the open-weights sense is a non-starter here.** Locally it means either
a 3.4–6.6 GB model in a WebView (impossible on iOS) or asking users to run an Ollama server
(desktop-only, breaks non-negotiable #11). Hosted, it is just a third vendor saving 2–4× on the
already-cheap part while giving up instruction-following on the one thing that matters. The one
technical envy is llama.cpp's grammar-constrained sampling, which genuinely guarantees valid JSON —
but OpenAI's strict `json_schema` gets most of that, and note that **neither can express "pick from
these 400 titles" as a schema constraint**; the candidate list has to stay in the prompt and be
validated client-side either way.

**The one experiment worth running before any of this:** a ~20-line probe command in the plugin that
reports `crossOriginIsolated`, `typeof SharedArrayBuffer`, `!!navigator.gpu`, and
`WebAssembly.validate` for a SIMD-using module, run on desktop and on a real iPhone. Every "not
viable on mobile" claim in this document rests on published platform behaviour rather than on
Obsidian's actual runtime, and that probe converts all of it from inference to measurement for the
cost of one command.

---

## 1. What actually runs, in JavaScript, in an Obsidian plugin

### The runtime is mature. The host is the problem.

**Transformers.js v4** shipped **2026-02-09**. The headline is a WebGPU runtime rewritten in C++ in
collaboration with the ONNX Runtime team, covering ~200 architectures, with the same code running in
browsers, Node, Bun, and Deno. It claims BERT-family embedding models run **up to 4× faster** via
ONNX contrib operators (`MultiHeadAttention`, `MatMulNBits`), a **53% smaller** default web bundle,
and a new `ModelRegistry` plus WASM caching so an app works fully offline after first load.
Quantisation dtypes exposed: `fp32`, `fp16`, `q4`, `q4f16`.
([HF blog](https://huggingface.co/blog/transformersjs-v4))

Treat "4× faster" as vendor framing — it is a WebGPU-path number and says nothing about the WASM
path a phone is stuck on.

Underneath it, **ONNX Runtime Web** has since **v1.19.0** dropped non-SIMD and non-threaded builds,
detecting capability at init and falling back otherwise. Multi-threading requires
`SharedArrayBuffer`, which requires cross-origin isolation (`COOP: same-origin` +
`COEP: require-corp`). Without it, ORT falls back to single-threaded WASM at a documented
**2–4× slowdown**. ([onnxruntime.ai/docs/build/web](https://onnxruntime.ai/docs/build/web.html),
[deploy docs](https://onnxruntime.ai/docs/tutorials/web/deploy.html))

### Obsidian mobile specifically

Obsidian desktop is Electron/Chromium; **Obsidian mobile is Capacitor** wrapping WKWebView on iOS
and Android WebView on Android
([Obsidian forum](https://forum.obsidian.md/t/what-framework-are-the-mobile-apps-using-reactnative-native/58571)).
That inheritance decides most of this:

- **Threads: assume no.** Capacitor's own tracker says Android WebView does not support site
  isolation, so `SharedArrayBuffer` cannot be enabled there, and iOS requires COOP/COEP headers the
  app would have to serve
  ([capacitor#3945](https://github.com/ionic-team/capacitor/discussions/3945)). Obsidian serves
  plugin code from a custom `app://` scheme it controls; nothing suggests it sets those headers.
  **Practical read: single-threaded WASM on mobile, so the 2–4× penalty applies on the slowest
  hardware.** (These Capacitor threads are older than 12 months — this is the single most
  probe-worthy claim in the document.)
- **SIMD: probably yes, with history.** iOS Safari 16+ supports WASM SIMD, but ORT has a live
  history of iOS-specific WASM breakage —
  [#15644 "WASM-SIMD broken on iOS 16.4+"](https://github.com/microsoft/onnxruntime/issues/15644)
  and [#22776 "[Web] Support iOS devices"](https://github.com/microsoft/onnxruntime/issues/22776),
  the latter filed Nov 2024 against iOS 17 / ORT 1.20 citing WASM load failures *and* Safari memory
  pressure on reload, **still open** at time of writing. Stale in version terms, unresolved in
  status terms. Both readings are bad.
- **WebGPU: genuinely unclear, and worth ten seconds to settle.** WebKit shipped WebGPU by default
  in **Safari 26** (announced WWDC25, shipped autumn 2025) for macOS/iOS/iPadOS/visionOS
  ([webkit.org](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
  [caniwebview.com](https://caniwebview.com/features/web-feature-webgpu/) (updated **2026-07-25**)
  lists iOS WKWebView and Android WebView as supported. An
  [Apple developer forum thread](https://developer.apple.com/forums/thread/770862) from the
  flag-gated era says WKWebView had no GPU access and would only work once enabled by default —
  which is now the case. **I could not confirm that Obsidian's iOS build exposes `navigator.gpu`.**
  Do not plan on it until probed.
- **Memory is the real ceiling.** WebKit's practical per-page budget on devices in circulation is
  reported at **300–450 MB**, against a hard single-page cap around 1.4–1.5 GB, with jetsam killing
  the app above the process limit
  ([WebKit RAM deep dive](https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit)).
  Obsidian is already spending that budget on the editor, the metadata cache, and the vault.
  Community reports of Obsidian iOS being OOM-killed with heavy plugin loads are easy to find
  ([forum](https://forum.obsidian.md/t/obsidian-crashes-on-mobile/71787)).

**Verdict on the runtime question: WASM inference in an Obsidian plugin works, and there is at least
one shipped counter-example on mobile — `obsidian-plugin-wasm-image` bundles WASM and claims desktop
and mobile support. But that is a codec, not a transformer.** Nothing found demonstrates a
transformer embedding model running on Obsidian iOS.

---

## 2. Model sizes and speeds — real numbers

Exact ONNX artifact sizes from the canonical Transformers.js conversion of the model everyone
actually uses ([Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main/onnx)):

| Artifact | Size |
|---|---|
| `model.onnx` (fp32) | 90.4 MB |
| `model_fp16.onnx` | 45.3 MB |
| `model_q4.onnx` | 54.6 MB |
| `model_q4f16.onnx` | 30 MB |
| `model_int8.onnx` / `model_quantized.onnx` | **23 MB** |
| `model_uint8.onnx` | 22.8 MB |

Model landscape, smallest useful first:

| Model | Params | Dims | Notes |
|---|---|---|---|
| all-MiniLM-L6-v2 | ~22–23M | 384 | 23 MB int8. 2026 write-ups call it a prototyping/edge model, no longer production-grade retrieval quality |
| bge-small-en | 33M | 384 | "runs on virtually any device" |
| gte-small | ~33M | 384 | same weight class; could not confirm a current ONNX size |
| nomic-embed-text | 137M | 768 | 274 MB — described as the practical laptop/edge choice |
| **EmbeddingGemma** | 308M (100M model + 200M embedding) | 768, Matryoshka → 512/256/128 | 622 MB at full precision; **<200 MB RAM quantised (QAT)**; 2K context; MTEB Eng v2 **69.67** ([Google](https://developers.googleblog.com/en/introducing-embeddinggemma/), [HF](https://huggingface.co/blog/embeddinggemma)) |
| Qwen3-Embedding-0.6B | 600M | — | Best small-model quality if you have the RAM. Not a phone model |

**EmbeddingGemma's "<200 MB RAM" is the number Google markets and it is real, but it is 200 MB
*on top of* Obsidian inside a 300–450 MB page budget.** That is a no on iOS, marketing
notwithstanding. The only candidates that fit the mobile budget at all are the 22–33M class.

### Timing

Measured points, all from browser benchmarks rather than this codebase:

- MiniLM-L6-v2, short sequences, **WASM on an M2 MacBook Air: 8–12 ms per inference**
  ([HF benchmark space](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/4)).
- MiniLM at **sequence length 512, batch 1: WASM 386 ms vs WebGPU 23.8 ms**; batch 4: 1,565.8 ms vs
  69.6 ms ([SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)). Sequence
  length dominates everything.

Extrapolations below are **mine, not measured** — flagged as such:

- **Desktop, 3,000 short notes** (captures and atom bodies are short; call it 64–128 tokens): at
  10–30 ms/doc on multi-threaded WASM, **30–90 seconds**. With WebGPU, well under a minute. Fine.
- **Mobile, 3,000 short notes**, single-threaded, phone CPU: I would estimate **5–15 minutes** of
  sustained compute, with thermal throttling and a live OOM risk on older devices. This is the
  number that kills it, and it is an estimate — but it would have to be wrong by 5× to change the
  verdict.
- **One query embedding**: ~10–30 ms desktop, ~50–150 ms mobile. Negligible either way. Query-time
  cost was never the problem; index-time cost is.
- **Storage**: 3,000 × 384 dims = 4.6 MB fp32, 2.3 MB fp16, 1.15 MB int8. Storage is a non-issue.

---

## 3. Hybrid BM25 + embeddings: yes, it is standard; no, it is not a step change

Reciprocal rank fusion is the production default across search platforms precisely because it needs
no score normalisation and no training — it discards scores and combines ranks
([Azure AI Search docs](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)).
It is the correct architecture if dense retrieval is added at all.

What it buys, from published measurement rather than vendor copy:

- A 2026 retrieval benchmark over text-and-table documents:
  **Recall@5 0.644 (BM25) → 0.695 (hybrid RRF)**, +5.1 points / +7.9%; +8.1 points on the hardest
  subset. Adding a cross-encoder reranker moved it much further, to 0.816
  ([arXiv 2604.01733](https://arxiv.org/html/2604.01733v1)).
- BEIR's founding result still stands as the caution: **dense retrievers trained on one domain
  frequently underperform BM25 zero-shot on another.** A personal vault of idiosyncratic daily
  captures is about as out-of-domain as text gets. Expect the low end of the reported range.
- Claims of "+40% Recall@10" circulating in blog posts trace to a scientific *code* search
  benchmark, where lexical retrieval is unusually weak. Do not carry that number into this product.

**So: on a system already at 79–88% recall at k=400, expect hybrid to land somewhere in the high 80s
to low 90s.** That is a real improvement. It is also roughly what you get by widening k, for
0.35¢/capture and no new failure mode. The interesting reranking gain (+17 points) comes from a
*cross-encoder*, which is a much heavier model and firmly out of reach on-device — but note that the
paid classify call is already, functionally, a cross-encoder reranker over the 400 candidates. That
is why the current architecture holds up.

---

## 4. What the Obsidian ecosystem actually shipped

All manifest values fetched **2026-07-29**.

**Exactly one widely-used plugin ships in-plugin on-device embeddings, and it turns itself off by
default on mobile.** Every other plugin found doing local embeddings is `isDesktopOnly: true`.
Everything mobile-enabled calls an API or a server.

### Smart Connections — the only real precedent

`v4.5.3`, `isDesktopOnly: false`, README claims "Works on mobile devices". Runtime is
**Transformers.js → ONNX Runtime Web / WASM**, wrapped in its own `smart-embed-model` package.
Default model is **`TaylorAI/bge-micro-v2`** — `model.onnx` 69 MB, `model_quantized.onnx`
**17.4 MB** ([HF](https://huggingface.co/TaylorAI/bge-micro-v2/tree/main/onnx)) — i.e. it picked a
model even smaller than MiniLM, which is a signal in itself.

The failure pattern is exactly the mobile-webview condition:

- [#749](https://github.com/brianpetro/obsidian-smart-connections/issues/749) logs `Using GPU` then
  `WebAssembly SIMD is not supported in the current environment` → `no available backend found`.
  Same stall in [#634](https://github.com/brianpetro/obsidian-smart-connections/issues/634).
- [#1316](https://github.com/brianpetro/obsidian-smart-connections/issues/1316) (2026, macOS 26.2):
  `Cannot read properties of undefined (reading 'subgroupMinSize')` — a WebGPU-shaped crash.
- **Mobile is opt-in per session.** It shows *"Smart environment loading deferred on mobile"* and
  requires a manual "Load environment" tap
  ([discussion #1170](https://github.com/brianpetro/obsidian-smart-connections/discussions/1170)).
- Open: [#1301](https://github.com/brianpetro/obsidian-smart-connections/issues/1301) (iPad,
  2026-03-15) — load the environment, it loads, refreshes, and re-prompts "repeating indefinitely".
  [#1324](https://github.com/brianpetro/obsidian-smart-connections/issues/1324) Android auto-start.
  Closed but telling: [#1015](https://github.com/brianpetro/obsidian-smart-connections/issues/1015)
  "Failed to load plugin smart-connections on mobile" (iPhone, iOS 18.3.2).
- Obsidian forum, **2026-01-20**: the deferred-loading prompt fires *while writing*, reloading the
  note and losing cursor position; the thread's
  [resolution](https://forum.obsidian.md/t/obsidian-ios-constant-smart-environment-loading-deferred-on-mobile/110252)
  was to disable Smart Connections on iPhone and keep it on the Mac.
- Desktop scale data: [#356](https://github.com/brianpetro/obsidian-smart-connections/issues/356) —
  16,000 notes, `.smart-env` grew to **~500 MB**, embedding unfinished "after a few hours". At 3,000
  notes that is a much smaller problem, but it shows the index is not free.

**Could not confirm** that a full on-device embed completes reliably on iOS or Android at v4.5.3
today. Nobody says yes; the deferral gate and the open iPad loop bug say the maintainer is not
confident either.

### The others

| Plugin | Version | `isDesktopOnly` | Embeddings |
|---|---|---|---|
| **Obsidian Copilot** | 3.3.3 | false | API providers / Ollama / hosted. **No on-device model.** Users report *"Indexing is disabled on mobile devices"* ([#815](https://github.com/logancyang/obsidian-copilot/issues/815)); FAQ still calls mobile "experimental" |
| **Omnisearch** | 1.30.0 | false | None — MiniSearch/BM25, in-RAM index. See below |
| Smart Second Brain | 1.3.0 | **true** | Ollama / OpenAI |
| Vector Search (`ashwin271`) | 0.3.0 | **true** | Ollama `nomic-embed-text` |
| VaultSearch (`erayaydn0`) | 0.1.1 | **desktop only** | BM25 + transformers.js ONNX in a sandboxed iframe (repo fetch 404'd; unverified) |
| Khoj | 2.0.0-beta.28 | false | Server-side only |

### The Omnisearch data is the most useful thing in this section

Omnisearch is our nearest neighbour — same idea (lexical index over the vault), mobile-enabled, no
embeddings. Its author's own measurements
([discussion #152](https://github.com/scambier/obsidian-omnisearch/discussions/152)) on a 1,300-note
+ 4,000-PDF vault: ~250 MB at startup, peak **~700 MB** while indexing and **~1,300 MB** while
writing to IndexedDB. "Loading a 'big' cache makes Obsidian crash instantly at startup" on iOS — and
his read was that the **rate** of memory allocation, not the total, triggers the iOS kill. He
responded by disabling cache serialization on iOS and PDF indexing on all mobile. A 2025 report in
the same thread: disabling Omnisearch dropped idle RAM from ~1.1 GB to ~600 MB on a 6 GB iPhone and
stopped repeated crashes.

**That is the specific mechanism that would bite us.** A batch embedding pass is a sustained
high-allocation loop — precisely the shape that kills Obsidian iOS, according to the one maintainer
who measured it.

**Ecosystem verdict:** the plugin whose stack we would copy (VaultSearch — BM25 + transformers.js)
went desktop-only. The one that shipped mobile-enabled put a manual gate in front of it and still
has an open load-loop bug on iPad. Nobody in this ecosystem has solved on-device embeddings on iOS.
There is no reason to believe we would be the first.

---

## 5. The paid call, reading 1: OpenAI

All prices fetched **2026-07-29**. Neither OpenAI's nor Anthropic's pricing page carries a visible
publication date, so "current" here means "what the page served today".

### Current lineup

The new family is **GPT-5.6**, released **2026-07-09** — `gpt-5.6-sol` ($5/$30),
`gpt-5.6-terra` ($2.50/$15), `gpt-5.6-luna` ($1/$6), all ~1.05M context. OpenAI dropped
mini/nano naming; **Luna is the small tier** and is what their own guidance points at for
high-volume work. The genuinely cheap models are still the **GPT-5.4** generation (400K context,
snapshots `2026-03-17`):

| Model | Input /M | Cached in /M | Output /M |
|---|---|---|---|
| `gpt-5-nano` ⚠️ deprecated, shutdown **2026-12-11** | $0.05 | $0.005 | $0.40 |
| `gpt-5.4-nano` | **$0.20** | **$0.02** | **$1.25** |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 |
| `gpt-5.6-luna` | $1.00 | $0.10 | $6.00 |
| `gpt-5.6-terra` | $2.50 | $0.25 | $15.00 |

Sources: [pricing](https://developers.openai.com/api/docs/pricing),
[changelog](https://developers.openai.com/api/docs/changelog),
[deprecations](https://developers.openai.com/api/docs/deprecations). **Do not build on the $0.05
tier — it is already scheduled for shutdown.** The durable floor is `gpt-5.4-nano`.

### Anthropic, for comparison — and a dated problem

| Model ID | Input | 5m cache write | Cache read | Output | Batch in/out |
|---|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | $1 | $1.25 | $0.10 | $5 | $0.50 / $2.50 |
| `claude-sonnet-5` **to 2026-08-31** | $2 | $2.50 | $0.20 | $10 | $1 / $5 |
| `claude-sonnet-5` **from 2026-09-01** | $3 | $3.75 | $0.30 | $15 | $1.50 / $7.50 |

**Sonnet 5's introductory pricing ends 2026-08-31 — a 50% increase in about a month, on the model
the catch-up study is costed against.** That single fact is worth more to the plan than anything
else in this section. Every figure in
[`2026-07-28-classify-prompt-cost-measurement.md`](2026-07-28-classify-prompt-cost-measurement.md)
becomes 1.5× on 1 September.

Also note: there is no Haiku 5. Haiku 4.5 (Oct 2025) is still the small tier.

### Caching: OpenAI's terms are now better for *our* access pattern

| | Anthropic | OpenAI |
|---|---|---|
| Mechanism | explicit `cache_control` breakpoints, max 4 | **automatic** ≥1024 tokens (explicit mode on 5.6+) |
| Read discount | 0.1× | **0.1×** on all GPT-5.x |
| Write cost | 1.25× (5 min) / 2× (1 hour) | **free** on everything before 5.6; 1.25× on 5.6+ |
| Default TTL | **5 minutes** | `prompt_cache_retention` defaults to **24h** since 2026-05-29 on 5.x (5.6 uses 30m) |
| Min cacheable prefix | Sonnet 5: 1024 · **Haiku 4.5: 4096** · Opus 5: 512 | 1024 |

([Anthropic](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching),
[OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching))

**This is the one place a switch would buy something real.** Our workload is *sparse interactive
filing* — a capture arrives, then nothing for hours. Anthropic's 5-minute TTL means that pattern
mostly *misses* cache and repeatedly pays 1.25× writes, unless you buy the 1-hour tier at 2× write.
OpenAI's 24-hour default retention at no extra charge fits the pattern the product actually has.
Bulk backfill, where thousands of requests land inside minutes, does not care.

### Batch

Both vendors: **50% off, and it stacks with the caching discount.** OpenAI's window is a fixed,
non-configurable 24 hours (50,000 requests / 200 MB per batch); Anthropic's Message Batches mostly
finish in under an hour. OpenAI also has beta **Flex processing** — batch pricing on synchronous
calls, slower, may 429 — which is a genuinely interesting middle lane for catch-up if you want batch
economics without a 24-hour wait.
([OpenAI batch](https://developers.openai.com/api/docs/guides/batch),
[flex](https://developers.openai.com/api/docs/guides/flex-processing),
[Anthropic batch](https://platform.claude.com/docs/en/docs/build-with-claude/batch-processing))

### Modelled cost per capture, at our measured shape

Assumptions, stated so they can be argued with: **10,095 input tokens** (the measured 400-title
shortlist), **260 output tokens**, all input served from cache, no batch discount. Modelled, not
measured — no API calls were made for this document.

| Model | ¢ / capture | ¢ / capture, batched |
|---|---|---|
| `gpt-5.4-nano` | **0.053** | 0.026 |
| `gpt-5.4-mini` | 0.19 | 0.10 |
| `claude-haiku-4-5` | 0.23 | 0.12 |
| `gpt-5.6-luna` | 0.26 | 0.13 |
| `claude-sonnet-5` (to Aug 31) | 0.46 | 0.23 |
| **`claude-sonnet-5` (from Sept 1)** | **0.69** | **0.35** |

Reconciliation: the prior study measured **0.36¢/capture** for batched, cache-credited Sonnet 5 at
400 titles. My 0.23¢ here is lower because it assumes a perfect cache hit with no write amortised;
the measured figure is the one to trust. Read the table for *ratios*, not absolutes. The honest
ratio is that **`gpt-5.4-nano` is roughly an order of magnitude cheaper than Sonnet 5 for this
call**, and Haiku 4.5 sits about halfway.

### Structured outputs, and one limit that bites us

OpenAI's `text.format: { type: "json_schema", strict: true }` is genuine constrained decoding, not
prompting. Limits: all fields must be `required`, `additionalProperties: false` mandatory, no
`allOf`/`not`/root-level `anyOf`, ≤5000 properties, ≤10 nesting levels, **≤1000 enum values and
≤120,000 chars across names + definitions + enum values**.
([guide](https://developers.openai.com/api/docs/guides/structured-outputs))

**Directly relevant:** you cannot express "pick from these 400 titles" as a schema `enum`. The
1000-value cap is fine, but at ~300 chars per atom title the 120,000-char budget binds at roughly
400 titles. Titles stay in the cached prompt text and the model emits free strings you validate
yourself — which is what the plugin already does. No advantage lost, but no schema-level guarantee
gained either.

### CORS

Verified live rather than taken from forums: `api.openai.com` returns
`access-control-allow-origin` echoing the request origin and reflects arbitrary requested headers,
so browser-side calls pass CORS. The JS SDK's `dangerouslyAllowBrowser: true` is a key-exposure
guard, not a CORS one. Anthropic returns `*` and requires the client to send
`anthropic-dangerous-direct-browser-access`. **In Obsidian this is moot — `requestUrl` bypasses CORS
entirely, which is already a non-negotiable in this codebase.** Provider choice is not constrained
by CORS here.

### What switching would actually cost

Small but not free, and concentrated in three places:

- `pipeline/classify.ts` — request assembly, `x-api-key` / `anthropic-version` headers, the message
  shape, and the `cache_control` breakpoint placement all become OpenAI-shaped
  (`prompt_cache_retention`, automatic caching, no explicit breakpoints on 5.4).
- `pipeline/backfill.ts` — different batch endpoint, different job lifecycle, different polling, and
  a fixed 24-hour window instead of Anthropic's usually-under-an-hour.
- `plus-service/src/anthropic.mjs` — the hosted path is named after the vendor. Two providers means
  two code paths or a provider seam that does not exist yet.

Plus the soft costs: two sets of prompt-quality evidence, and Claude 4.7+ models use a new tokenizer
producing **~30% more tokens for the same text**, so any cross-vendor token comparison has to be
recomputed rather than carried over.

---

## 6. The paid call, reading 2: open-weights models

### Could one run locally, in the plugin?

**No, not on mobile, and it is not close.**

- **In-webview inference** means WebLLM (v0.2.83, 2026-04-24, ~140 models, XGrammar-backed
  schema-constrained decoding) which requires **WebGPU**. WebGPU is at ~84% globally and Safari 26
  ships it, but **WebGPU inside iOS WKWebView could not be confirmed** — Apple has made no public
  statement and Apple DTS said in April 2025 there was no roadmap. Even if it works, this is a
  generative LLM, not a 23 MB embedder: the smallest credible candidates are
  **Qwen3.5-4B at 3.4 GB, 9B at 6.6 GB** ([ollama](https://ollama.com/library/qwen3.5)). Against a
  300–450 MB WebView page budget, that is not a marginal call.
- **Desktop via Ollama / llama.cpp** works and llama.cpp's grammar-constrained sampling is genuinely
  better than prompted JSON — invalid tokens are masked at the sampler
  ([grammars README](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)). But it
  means the user installs and runs a server. That is what Smart Second Brain, Vector Search, and
  Copilot's Ollama path all do, and it is why they are desktop-only or degraded on mobile. It
  breaks non-negotiable #11 in the same way on-device embeddings do.
- **Hosted open-weight** is the only shape that respects the mobile constraint, and at that point
  it is just a different API vendor, not "local".

### Is a small open model good enough for this task?

The task is not trivial: read a rough capture, write a declarative title, and pick links from a
**400-item list held in a long cached prefix**. That is long-context instruction-following plus
faithful selection from a supplied set — precisely where small models degrade first (they invent
titles that aren't on the list, or anchor on the first few candidates).

Best-in-class sub-10B today is **Qwen3.5-9B** (Apache 2.0, 262K context); its card claims IFEval
91.5 / BFCL-V4 66.1 ([HF](https://huggingface.co/Qwen/Qwen3.5-9B)) — vendor numbers. Independent
Artificial Analysis scoring puts it at **21** on their Intelligence Index v4.1, against
**gpt-oss-20b 15**, gpt-oss-120b 24, Gemma 4 31B 29
([AA](https://artificialanalysis.ai/models/open-source)). For scale, frontier closed models sit far
above all of these. **gpt-oss-20b/120b** (Apache 2.0, Aug 2025) are MoE with native function calling
and structured output; 20b targets 16 GB devices.

⚠️ Sourcing caution worth recording: several "best small LLM 2026" listicles cite a **"Llama 3.3 8B"
that Meta never shipped.** That entire tier of content is unreliable and should not be cited in
planning docs.

Hosted pricing, $/M in → out:

| | Groq | Together | DeepInfra | Fireworks | OpenRouter |
|---|---|---|---|---|---|
| Llama 3.1 8B | 0.05→0.08 | — | 0.02→0.04 | tiered | 0.02→0.04 |
| Qwen3.5-9B | — | 0.17→0.25 | — | — | 0.10→0.15 |
| gpt-oss-20b | 0.075→0.30 | 0.05→0.20 | not listed | 0.07→0.30 | 0.03→0.13 |
| gpt-oss-120b | 0.15→0.60 | 0.15→0.60 | not listed | 0.15→0.60 | 0.03→0.17 |

Groq offers 50% off cached input and 50% off batch; Fireworks 50% batch and ~10% cached input.
Together's and DeepInfra's batch discounts **could not be confirmed**. No provider page showed a
last-updated date.

**Verdict:** open-weights hosted inference would save maybe 2–4× over `gpt-5.4-nano`, on a call that
is already the cheapest part of the system, in exchange for weaker instruction-following on exactly
the failure mode that matters (picking real links from a supplied list) and a third vendor's caching
semantics to learn. `gpt-5.4-nano` is already an order of magnitude below Sonnet 5. **The remaining
headroom below it is not worth the quality risk.** Local open-weights is a non-starter on mobile.

---

## 7. What I could not confirm

Recorded so the next session does not mistake inference for measurement.

- Whether Obsidian's iOS build exposes `navigator.gpu`, `crossOriginIsolated`, or
  `SharedArrayBuffer`. The probe in the recommendation settles all three.
- Whether a full on-device embed of a 3,000-note vault completes reliably on Obsidian iOS at Smart
  Connections v4.5.3. No primary source says either way.
- WebGPU in iOS WKWebView generally: [caniwebview](https://caniwebview.com/features/web-feature-webgpu/)
  (2026-07-25) marks it supported; Apple has made no statement; an Apple developer forum thread from
  the flag-gated era says no. Genuinely contested.
- Whether Obsidian mobile's Capacitor shell sets COOP/COEP. The Capacitor discussions cited are over
  12 months old.
- My 5–15 minute estimate for embedding 3,000 short notes single-threaded on a phone is an
  extrapolation from desktop benchmarks, not a measurement.
- Together's and DeepInfra's batch discount percentages; Fireworks per-model prices outside its docs
  page; a current ONNX artifact size for `gte-small`.

## Sources

[Transformers.js v4](https://huggingface.co/blog/transformersjs-v4) ·
[ONNX Runtime Web build docs](https://onnxruntime.ai/docs/build/web.html) ·
[ORT #22776 iOS](https://github.com/microsoft/onnxruntime/issues/22776) ·
[ORT #15644 iOS SIMD](https://github.com/microsoft/onnxruntime/issues/15644) ·
[WebKit Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) ·
[caniwebview WebGPU](https://caniwebview.com/features/web-feature-webgpu/) ·
[Apple forum: WKWebView GPU](https://developer.apple.com/forums/thread/770862) ·
[WebKit RAM internals](https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit) ·
[Capacitor SharedArrayBuffer](https://github.com/ionic-team/capacitor/discussions/3945) ·
[Obsidian mobile framework](https://forum.obsidian.md/t/what-framework-are-the-mobile-apps-using-reactnative-native/58571) ·
[Xenova/all-MiniLM-L6-v2 ONNX](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main/onnx) ·
[TaylorAI/bge-micro-v2 ONNX](https://huggingface.co/TaylorAI/bge-micro-v2/tree/main/onnx) ·
[EmbeddingGemma](https://developers.googleblog.com/en/introducing-embeddinggemma/) ·
[EmbeddingGemma on HF](https://huggingface.co/blog/embeddinggemma) ·
[WebGPU vs WASM benchmarks](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/) ·
[Transformers.js embedding benchmark](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/4) ·
[Azure hybrid RRF](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) ·
[arXiv 2604.01733 retrieval benchmark](https://arxiv.org/html/2604.01733v1) ·
[Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) ·
[Omnisearch memory discussion](https://github.com/scambier/obsidian-omnisearch/discussions/152) ·
[Obsidian Copilot](https://github.com/logancyang/obsidian-copilot) ·
[OpenAI pricing](https://developers.openai.com/api/docs/pricing) ·
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) ·
[OpenAI batch](https://developers.openai.com/api/docs/guides/batch) ·
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) ·
[Anthropic pricing](https://platform.claude.com/docs/en/docs/about-claude/pricing) ·
[Anthropic prompt caching](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching) ·
[Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) ·
[Artificial Analysis open models](https://artificialanalysis.ai/models/open-source) ·
[llama.cpp grammars](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)
