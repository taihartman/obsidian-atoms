# Sonnet 5.5 and Haiku 5.5 effort comparison

Research date: 2026-10-20. Initial comparison: 1,900 requests, $10.96685 against a $15 cap. Completed incumbent follow-up: 640 fresh requests, $7.69260 against a separate $10 cap. Combined: **2,540 requests, $18.65945**, no unsettled requests.

**Updated recommendation: keep Sonnet 5.5 at low effort for daily Plus filing.** The matched 300-case follow-up found 85 reference atom links versus Sonnet 5 low's 51, improved atom F1 from 26.8% to 35.1%, and reduced median latency from 2.76 to 2.16 seconds, at similar cost and verdict accuracy. The fresh low result is also close to the earlier medium run (85 vs 86 reference links; 35.1% vs 34.7% F1), so there is no demonstrated reason to increase production effort. Medium and low were not run concurrently, and this is not a formal equivalence claim.

Haiku xhigh with 8,192 output tokens remains a credible budget alternative: its strict link F1 is close, at about one-tenth the synthetic benchmark cost, with slower filing. The initial holdout did not establish a clear quality winner between the best 5.5 candidates. The recommendation prioritizes filing speed and useful connections; a cost-first choice can reasonably differ. The completed incumbent control is reported below, including paired uncertainty and real-data review.

The owner-requested token-budget fix succeeded: increasing the **test** allowance from 2,048 to 8,192 removed xhigh truncations, from 5/50 failures to 0/320 responses across synthetic and real-data checks. Production remains Sonnet 5.5, effort low, 2,048 tokens. No live effort/model/ceiling change was made by this comparison.

Question: Can Haiku 5.5 at higher effort preserve Atoms' linking and title quality at lower total cost than Sonnet 5.5?

The owner requested this comparison and explicitly authorized using real production data. The live Plus service remains on Sonnet 5.5 throughout. No vault writes, note rewrites, production classification-meter calls, or model changes are part of this benchmark.

## Protocol

- Four pilot arms: Sonnet 5.5 medium/high and Haiku 5.5 medium/high. Explicit `output_config.effort`, 8,192 maximum output tokens including thinking, 60-second request deadline, no automatic request retries, concurrency two.
- Pilot: 50 evenly spaced captures from the existing first 300 chronological synthetic captures. This covers later difficult links rather than treating the easiest first 50 as representative.
- Confirm one effort per model on all 300, reusing the corresponding pilot results. Report the 250 cases not used for effort selection separately as a holdout.
- Select the strongest pilot effort by request reliability and in-run atom-link F1; keep medium when high's F1 gain is below two percentage points at equal reliability. This is a pilot-selection rule, not proof of statistical equivalence.
- Production code constructs the prompt/schema, parses responses and applies classifier enrichment. Shared production `CandidateCorpus`, `ContextRun`, BM25 selection and graph expansion construct each capture's context. Every model receives identical context for each capture.
- Seed 1,200 background notes using the existing coherent synthetic fixture builder. At 300 captures the pool grows to 1,441 notes. Median shortlist: 285.5 titles; 79/300 cases reach the 400-match cap. Maximum graph expansion adds the existing reserved slots.
- Prior gold atom captures are registered under deterministic, model-neutral abbreviated titles; prior gold links seed the graph. This is an oracle-history, paired-context test isolating classification/linking. It does not measure model-written history or end-to-end accumulation of errors, so it is not directly comparable to July's growing model-specific title histories.
- Score atom links separately from easier hub links. Report gold-link precision/recall/F1, retrieval coverage and recall conditional on retrieved targets, verdict accuracy including failed cases, unavailable-target links, truncations, response/body-field violations, median/p95 latency and all billed output including thinking.
- Gold links are authored independently, but may not enumerate every reasonable extra link. Background notes use held-out synthetic captures; an extra link may be defensible. Strict precision is agreement with this answer key and needs a blinded disagreement audit before a product decision.

## Real-data check and privacy

Read-only desktop production vault snapshot: 161 flat atom files were available locally, compared with 204 in the account's server mirror earlier today. This is a partial desktop snapshot, not a claim of current phone convergence. Twenty captures of 30–800 characters were sampled across the local atom collection. Each is reclassified against other available atoms, excluding its original file and any note with identical normalized capture text, to prevent answer leakage from its current title/body.

These cases have no independently adjudicated truth and are selected from already-filed atoms. They check real-world title/link relevance, reliability and latency; they do not establish unbiased atom-versus-noise accuracy or linkage recall. Existing production titles/links are not used as gold labels. The current real-data fixture omits discovered hub metadata and graph edges; interpret it as an atom-library audit rather than full mobile configuration fidelity.

Private captures, contexts, outputs and request checkpoints are stored only under `/tmp/atoms-model-eval-20261020/` (directory mode 0700; JSON files mode 0600), outside Git. The durable report contains aggregate results and anonymized findings only. No personal vault file is written.

## Accounting and stopping

A $15 API ceiling covers smoke, pilot, confirmation and real-data checks. Before a request, reserve a conservative byte-based input upper bound plus the full 8,192-output-token allowance. Include concurrent reservations. Replace the reservation with actual provider usage on a known response; retain the full reserved cost for an ambiguous unanswered request. Stop rather than exceed the ceiling. Checkpoint each response and ledger update. Completed pilot requests are reused rather than billed twice in confirmation.

The four-request smoke succeeded on both efforts/models with no truncation or malformed result, costing about $0.064. A single capture cannot establish comparative quality.

## Sources and reusable tooling

- [Sonnet 5.5 specifications/prices](https://platform.claude.com/docs/en/models/sonnet-5-5/overview): $2 input / $10 output per million tokens; cache reads $0.10 per million.
- [Haiku 5.5 specifications/prices](https://platform.claude.com/docs/en/models/haiku-5-5/overview): $0.10 input / $0.50 output up to 100k input tokens, five times those rates above 100k. Cache reads $0.01 per million in the lower band.
- [Effort controls](https://platform.claude.com/docs/en/build-with-claude/effort): higher effort can use more thinking tokens; thinking consumes output budget. More effort is not evidence of equal quality.
- Entry point: `scripts/model-effort-bakeoff.mjs`; accounting/scoring: `scripts/lib/effort-eval.mjs`; shared production bundle: `scripts/lib/pipeline.mjs`.
- Five focused accounting/scoring tests passed with `node --test test/model-effort-eval.test.mjs`.
- [Aggregate metrics, source hashes, costs and paired comparisons](data/2026-10-20-model-effort-summary.json). Private captures, raw outputs and per-case qualitative judgments are excluded.

## Pilot results (50 paired cases per arm)

The sampled captures contain 44 expected atom links; 31 are available in their contexts. Zero request errors, truncations, body-field violations or unavailable-target links occurred in any arm.

| Configuration | Atom precision | Atom recall | Atom F1 | Verdict accuracy | Median / p95 latency | Measured pilot cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet medium | 40.4% | 43.2% | 41.8% | 98% | 2.76 / 6.38 s | $0.6711 |
| Sonnet high | 43.8% | 47.7% | 45.7% | 96% | 2.72 / 6.61 s | $0.6967 |
| Haiku medium | 31.6% | 13.6% | 19.0% | 88% | 1.97 / 4.71 s | $0.0372 |
| Haiku high | 48.3% | 31.8% | 38.4% | 92% | 4.88 / 6.79 s | $0.0496 |

Selected high effort for each model under the predeclared rule. On the same 44 reference links, Sonnet high found 21 and Haiku high 14, compared with Haiku medium's 6. Haiku high costs about 14 times less than Sonnet high but is slower at the median. The completed 300-case confirmation and separate 250-case holdout are reported below.

Haiku's substantial medium-to-high gain triggered the planned conditional xhigh check. The payload-parity discovery below routed that check to the exact Plus configuration, sharing the same $15 ledger with no simultaneous writer. Advancement required at least two percentage points more pilot atom F1 than high with zero errors/truncations. No production model switch followed from the pilot alone.

Raw checkpoints and per-case outputs remain outside the repository.

## Plus payload check and prospective protocol amendment

Before making a product recommendation, compared all 320 prepared inputs through the plugin request builder and `plus-service/src/anthropic.mjs:buildClassifyPayload`. The output schema, title lists and capture messages match. The system prompt and stable context differ: the plugin adds stronger same-thread linking instructions and a list-hub context block; Plus retains the older sparse-link wording. Therefore the initial four-arm experiment measures the desktop BYOK classifier, not the exact live Plus classifier.

A read-only SSH probe of the started production machine verified the live system-prompt SHA-256 equals the local Plus template (`159646a0a33ef6d1ad69779cc9771a70a0083c63863010225fac644f9a5812f0`). Live settings observed: `claude-sonnet-5-5`, effort `low`, default output ceiling 2,048. Only these non-secret settings and the prompt digest were inspected; no environment dump was taken.

A completion probe also verified the entire deployed `anthropic.mjs` matches the evaluated local builder (`b4228d2aff5cc46b9edcad76c0cedf5027b57f30cfa7d7651793a707ae1ee573`) and observed the same 400-title shortlist / 40-title legacy limits. This establishes payload-builder fidelity, while the experiment still bypasses live auth, metering and proxy transport.

Prospective amendment, before seeing Plus experiment outputs:

- Reuse the exact same prepared cases/context and shared $15 ledger; use the production Plus builder and 2,048-token ceiling. Distinct `plus-` record IDs prevent reuse of a different request configuration.
- Plus pilot: Sonnet low/medium/high, Haiku medium/high/xhigh, 50 paired cases each. Including Sonnet low establishes the actual live baseline. The promised xhigh check now targets Plus directly rather than extending only the BYOK experiment.
- Advance one effort per model to the 300-case confirmation and 20-case real-data check. Exclude arms above 5% errors/truncations. Xhigh requires zero errors/truncations and at least two percentage points more atom F1 than Haiku high. Among reliable efforts within two points of the best atom F1 at equal error count, prefer the lowest effort.
- Use four concurrent requests for this extension. Run phases sequentially so the budget ledger has one writer; the runner refuses outstanding reservations on restart. Preserve separate 250-case holdout results.
- No prompt synchronization, service deployment or production effort change is part of this amendment. A model recommendation will distinguish exact Plus evidence from BYOK evidence.

During this pilot, Haiku xhigh exhausted the entire 2,048-token budget on multiple captures, including responses with 2,048 thinking tokens and no text. On the owner's explicit instruction to fix the limit and retry, a separate Plus xhigh configuration used 8,192 tokens. It re-ran all 50 pilot inputs under distinct record IDs so capped responses were preserved. It shared the same budget and zero-failure/+2-point F1 advancement rule against Haiku high, running after the existing ledger writer finished. Any resulting recommendation must include the larger token allowance and measured latency/cost.

## BYOK confirmation results

| Configuration | Atom hits / 269 | Atom precision | Atom recall | Atom F1 | Verdict accuracy | Median / p95 latency | Cost / 300 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet high, 8,192 | 102 | 33.2% | 37.9% | 35.4% | 93.3% | 2.72 / 5.60 s | $3.9822 |
| Haiku high, 8,192 | 77 | 42.3% | 28.6% | 34.1% | 93.3% | 4.39 / 7.12 s | $0.2780 |

Both completed all 300 with zero errors/truncations/body fields. Non-exact target strings: Sonnet 5, Haiku 3. Some shorten deterministic fixture titles or drop their IDs; these are input-title exactness failures, not proof that the model invented an unrelated concept. Sonnet proposes 307 atom links and Haiku 182, so incomplete reference links particularly affect precision.

On the 250-case holdout, Sonnet found 81/225 reference atom links versus Haiku 63/225 (36% vs 28% recall); atom F1 was 33.47% vs 33.33%, verdict accuracy 92.8% vs 93.6%. A paired case bootstrap (10,000 resamples, seed 20261020) gives Sonnet-minus-Haiku atom recall +8.0 percentage points, percentile 95% interval +3.6 to +12.6; F1 difference +0.14 points, interval −4.1 to +4.5. These describe this fixed fixture set and ignore dependence between related captures; they are not a population-quality guarantee.

The real-data pass completed 20 per model with zero errors/truncations/non-exact target strings. Sonnet proposed 25 links, Haiku 16; neither count establishes correctness without review. Median latency 1.93 vs 4.21 seconds. Across all 320 selected-arm responses, Sonnet's maximum output was 745 tokens; Haiku's was 1,781, with 49 exceeding the plugin's 1,024-token default. Higher-effort Haiku therefore also needs explicit output-budget qualification before any BYOK adoption.

## Plus pilot results

All use the exact Plus prompt and its current 2,048-token ceiling. The 50 cases contain the same 44 reference atom links.

| Configuration | Atom hits | Atom F1 | Verdict accuracy | Errors / truncations | Median / p95 latency | Pilot cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet low (live effort) | 16 | 41.0% | 98% | 0 / 0 | 2.29 / 3.53 s | $0.6579 |
| Sonnet medium | 18 | 44.4% | 98% | 0 / 0 | 2.53 / 3.34 s | $0.6609 |
| Sonnet high | 18 | 39.6% | 96% | 0 / 0 | 2.53 / 5.36 s | $0.6809 |
| Haiku medium | 3 | 10.9% | 86% | 0 / 0 | 1.76 / 3.58 s | $0.0352 |
| Haiku high | 9 | 28.6% | 94% | 0 / 0 | 4.20 / 6.33 s | $0.0465 |
| Haiku xhigh, capped | 10 | 32.3% | 84% | 5 / 5 | 6.40 / 9.92 s | $0.0595 |

Sonnet medium and Haiku high advance under the declared rule. Capped xhigh failed 10% of requests, so it cannot advance as configured. The explicit retry will isolate whether more output headroom fixes this failure without silently omitting those cases.

## Exact Plus confirmation

| Configuration | Atom hits / 269 | Atom precision | Atom recall | Atom F1 | Verdict accuracy | Median / p95 latency | Cost / 300 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet medium, 2,048 | 86 | 38.1% | 32.0% | 34.7% | 95.7% | 2.19 / 3.43 s | $3.7456 |
| Haiku high, 2,048 | 64 | 50.4% | 23.8% | 32.3% | 94.7% | 3.92 / 6.24 s | $0.2654 |

Both completed all 300 with zero request errors, truncations or body fields. Non-exact target strings: 4 vs 7. Sonnet found more reference atom links; Haiku was about 14.1 times cheaper and proposed fewer extra atom links (127 vs 226).

On the 250-case holdout, Sonnet-minus-Haiku atom recall is +5.8 percentage points (paired-bootstrap percentile 95% interval +1.8 to +9.7). Atom F1 difference is −0.18 points (−4.7 to +4.4), and verdict accuracy difference +0.4 points (−1.6 to +2.4). Strict F1 does not establish a clear winner; the recall advantage, latency and qualitative review matter to the product decision.

### Read-only real-data review

Twenty cases per model completed with zero errors/truncations. Sonnet proposed 21 links, including one non-exact target; Haiku proposed 17 with zero non-exact targets. Median latency 1.76 vs 3.90 seconds; cost $0.0794 vs $0.0099 for these 20 cases. This smaller library is cheaper than the synthetic stress library, so the latter's per-filing price is not a user-wide forecast.

The main assistant reviewed randomized A/B labels independently per case, with original captures and actual bodies of proposed target notes, wrote judgments, then opened the label key. Preferences: Sonnet 8, Haiku 5, ties 7. This is a single-assistant qualitative preference audit, not independent human gold, a statistically established winner or a measured link-precision estimate. Sonnet sometimes retained attribution and specific identifying details better; Haiku sometimes avoided speculative extra links. Both invented chronology when reclassifying historical captures against later existing notes, which this non-chronological real-data setup cannot resolve from titles alone. No private excerpts or per-case judgments are published here.

## Owner-requested xhigh retry

Changing the test configuration to 8,192 maximum output tokens removed the pilot failures: 50/50 usable responses, zero truncations. Haiku xhigh found 13/44 reference atom links (29.5% recall), atom precision 52.0%, atom F1 37.7%, verdict accuracy 92%. Median/p95 latency 6.40/11.25 seconds; cost $0.0610. Its F1 exceeds Haiku high by 9.1 points, so it advances under the stated rule. The completed 300-case confirmation and 20-case real-data pass are reported below.

The 2,048-token capped and 8,192-token runs are distinct configurations; this retry does not modify the production service's output ceiling.

### Completed xhigh confirmation

| Configuration | Atom hits / 269 | Atom precision | Atom recall | Atom F1 | Verdict accuracy | Median / p95 latency | Cost / 300 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet medium, 2,048 | 86 | 38.1% | 32.0% | 34.7% | 95.7% | 2.19 / 3.43 s | $3.7456 |
| Haiku high, 2,048 | 64 | 50.4% | 23.8% | 32.3% | 94.7% | 3.92 / 6.24 s | $0.2654 |
| Haiku xhigh, 8,192 | 75 | 47.5% | 27.9% | 35.1% | 93.3% | 6.31 / 11.59 s | $0.3572 |

Xhigh completed all 300 with zero failures/truncations and four non-exact target strings. Among 241 gold atoms / 59 gold noise captures, Sonnet medium rejected 2 atoms and kept 11 noise captures; Haiku high rejected 0 and kept 16 noise captures; xhigh rejected 0 and kept 20 noise captures. Haiku's lower verdict accuracy here comes from extra filing, not missed atoms.

On the 250-case holdout, xhigh found 62/225 reference atom links (27.6% recall), atom F1 34.6%, verdict accuracy 93.6%. Sonnet medium found 68/225 (30.2% recall), atom F1 32.9%, verdict accuracy 95.2%. Sonnet-minus-xhigh paired-bootstrap intervals: atom recall +2.7 points (95% −1.8 to +7.0), F1 −1.8 points (−6.7 to +3.1), verdict accuracy +1.6 points (−0.8 to +4.0). This sample supports a practical speed/cost tradeoff, not a statistically established quality advantage or equivalence claim.

All 20 real-data xhigh cases returned usable atoms, with 17 links, zero non-exact targets, zero errors/truncations. Median/p95 latency 5.25/8.92 seconds; cost $0.0145. A separate unblinded follow-up inspected every output and linked target body: some attribution improved compared with high, but multi-fact title omissions, weak project-wide links and invented chronology persisted. This follow-up is qualitative and has no preference/precision score.

Across xhigh's 320 confirmed responses, 197 exceeded 1,024 output tokens and 28 exceeded 2,048; maximum 2,852, p95 2,292. The 8,192 allowance provides headroom while actual billing follows used tokens. Returning to the current lower ceiling would reintroduce the observed truncation risk.

## Completion and limits

Owner follow-up at 16:40 EDT asked how this compares with the old model. The [July applied configuration](../qa/2026-07-27-plus-model-effort-bakeoff.md#decision--applied) records Sonnet 5 at low effort. The initial experiment included only Sonnet 5.5 and Haiku 5.5; at that point even Sonnet 5.5 low had only received the 50-case pilot. The [July 300-capture Sonnet 5 result](2026-07-29-model-bakeoff-results.md) was 55.4% atom-link F1 and 98.3% verdict accuracy, but used a smaller full-vault context, model-specific growing histories, different prompt-era behavior and no explicit Anthropic effort setting. Those scores cannot establish an upgrade/regression against today's saturated paired-context/Plus test. The missing control was Sonnet 5 low versus Sonnet 5.5 low on identical prepared inputs. The owner then explicitly requested this follow-up at 16:42 EDT; completed results follow.

All five observed API failures belong to the deliberately tested xhigh/2,048 configuration. The xhigh/8,192 retry completed 320/320. The ledger reconciles exactly with the 1,900 saved request records and includes all thinking tokens, capped failures, smoke/pilots, confirmation and the real-data checks. No additional experiments or production-meter calls ran.

The scorer/accounting's five focused tests passed; the runner passed Node syntax checking and its actual paid phases. Project ESLint ignores these `.mjs` tools, so its ignored-file warnings are not claimed as lint coverage. The existing runtime timeout/model-default fix was verified separately in the [phone investigation](2026-10-20-phone-sync-and-model-audit.md); these model tests do not qualify a phone release or prove phone Sync convergence.

The recommendation is scoped to the current classification prompts and fixed paired contexts. It does not qualify Ask, G2, transcription, per-day batching or a backfill model switch. The 71% atom-link retrieval ceiling, incomplete reference links, artificial prior titles, related-case dependence, one run per case, partial real-data snapshot and absent hub/graph metadata limit broader conclusions. Fixing Plus/BYOK prompt drift is separate work; the experiment did not silently synchronize prompts or deploy code.

## Sonnet 5 low versus Sonnet 5.5 low: authorized follow-up

Requested at 16:42 EDT, after the owner identified the missing incumbent control. Compare `claude-sonnet-5` and `claude-sonnet-5-5`, both explicit low effort and 2,048 maximum output tokens. Rerun both fresh on the same 300 synthetic cases and 20 owner-authorized private captures. Do not reuse the earlier 50 Sonnet 5.5 low pilot responses: this allows latency measurements from the same execution window.

The cases are byte-for-byte copies of the initial prepared inputs; canonical input digest remains `2d509dcfe8cb2f2de0e06a6f4674e35eee9dc21c8c11d336992fcf01dfc97585`. Use the same verified Plus builder, production classifier/enrichment, fixed contexts and gold scoring. Four concurrent workers interleave the two models; a two-call synthetic smoke precedes the full run and is reused when that case appears. No pilot-based effort selection or optional stopping. Primary comparison uses all 300; report paired case bootstrap intervals with the same fixed-corpus limitations.

The new ledger lives under `/tmp/atoms-sonnet-incumbent-20261020/`, with a **$10 additional hard cap**, separate from the completed $10.96685 study. Expected cost from prior measured token usage is **$7.81**, including 20 real cases per arm. The owner was informed of the additional cap before paid requests. Private raw inputs/outputs remain outside Git; no live model/effort setting, production filing meter or vault content is changed.

Pricing checked 2026-10-20: [Sonnet 5 specifications](https://platform.claude.com/docs/en/models/sonnet-5/overview) and [provider price list](https://platform.claude.com/docs/en/about-claude/pricing) give $2/$10 input/output per million tokens, 5-minute cache writes $2.50, reads $0.20. Sonnet 5.5 uses the same base rates but $0.10 cache reads. The historic $3/$15 assumption is not used. [Effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) supports low on Sonnet 5. Six focused accounting/scoring tests pass, including the two different Sonnet cache-read rates.

### Matched incumbent results

| Configuration | Atom hits / 269 | Atom precision | Atom recall | Atom F1 | Verdict accuracy | Median / p95 latency | Cost / 300 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet 5 low | 51 | 45.9% | 19.0% | 26.8% | 96.0% | 2.76 / 4.30 s | $3.7948 |
| Sonnet 5.5 low | 85 | 39.5% | 31.6% | 35.1% | 95.7% | 2.16 / 3.65 s | $3.7365 |

Both completed all 300 with zero errors, truncations or body fields. Sonnet 5.5 found 34 additional reference atom links (67% more), while proposing more atom links overall (215 vs 111). Strict precision decreases; incomplete gold labels mean extra links require qualitative judgment rather than being automatically considered wrong. Non-exact target strings decreased from 16 to 5. The identical candidate contexts contain 191/269 reference atom targets, so conditional atom recall is 26.7% versus 44.5%.

On 241 gold atoms and 59 noise captures, both models rejected 2 atoms. Sonnet 5 kept 10 noise captures versus 5.5's 11: the one-case accuracy difference does not show a meaningful classification regression.

Paired case bootstrap across all 300 cases (10,000 resamples, seed 20261020), 5.5 minus 5:

- Atom recall: **+12.6 percentage points**, percentile 95% interval **+7.9 to +17.6**.
- Atom F1: **+8.3 points**, interval **+2.9 to +13.9**.
- Verdict accuracy: −0.3 points, interval −2.7 to +1.7.

The positive linking intervals support an improvement on these fixed paired fixtures. Case dependence, incomplete reference links and artificial titles still limit generalization. Median latency improved about 22%; costs were similar, about 1.5% lower for 5.5 in this run. These are measured request latencies and usage-based list-price costs, not guarantees for every vault or server load.

### Incumbent real-data check and completion

Both models completed 20 owner-authorized private cases with zero errors/truncations/non-exact targets. Sonnet 5 proposed 12 links, versus 5.5's 22. Median/p95 latency: 2.66/3.72 seconds versus 1.70/2.66; cost $0.0816 versus $0.0796. The old model returned one already-published status capture as noise; the reviewer preferred preserving that durable record, without treating the original filed status as independent gold.

A/B labels were randomized independently per case. Judgments were saved before opening the model key. Single-assistant qualitative preferences: **Sonnet 5.5: 10; Sonnet 5: 3; ties: 7**. The newer model often preserved observations and intended actions more faithfully and connected concrete related facts, while sometimes adding weak links. Both still invented relative chronology in historical reclassification, and sometimes inferred another person's identity or intent from insufficient context. This subjective 20-case audit is supporting evidence, not an independently established accuracy or link-precision measure. No personal excerpts or per-case judgments are in Git.

All **640 requests** reconcile to the new ledger: **$7.6926037**, below the **$10 additional cap**. The two synthetic smoke calls were reused within this run. All other 638 responses recorded the provider model ID, confirming 319 responses from each distinct requested model; the two smoke records predate that metadata field. Across all 320 responses per model, maximum output was 359 tokens for Sonnet 5 and 350 for Sonnet 5.5, with none above 1,024. The existing 2,048-token production ceiling is adequate for this tested low-effort sample.

Source manifests, aggregate metrics, provider model counts, verdict confusion, bootstrap comparisons and qualitative totals are saved in the [incumbent aggregate artifact](data/2026-10-20-sonnet-incumbent-summary.json). The original study's artifact and budget ledger are unchanged. Production remains on its already-configured **Sonnet 5.5 / low / 2,048**; this follow-up deployed nothing and wrote no personal vault notes.

### Owner decision and live verification (16:55 EDT)

Owner selected **Sonnet 5.5 at low effort**. A fresh read-only console check on the running Plus machine confirmed `claude-sonnet-5-5`, `low`, and 2,048 output tokens. Fly reports both model and effort settings Deployed; public health returned HTTP 200 in 0.110 seconds. The requested configuration was already active, so no restart, secret mutation, source deployment or plugin release was needed.

