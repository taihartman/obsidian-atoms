---
title: Ask search recall + agent honesty - Plan
type: feat
date: 2026-08-06
topic: ask-search-recall-agent-honesty
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
lane: full
origin: docs/handoffs/2026-08-06-ask-search-handoff-2.md
continues: docs/plans/2026-08-06-002-feat-ask-search-atoms-agent-signal-plan.md
---

# Ask search recall + agent honesty - Plan

## Goal Capsule

**Objective.** Stop silent false-negatives on `search_atoms` after the #331 floor: make empty responses machine-honest for agents, restore usable confidence signal, lift paraphrase recall via index-time lexical expansion, and only then graduate to server-side hybrid embeddings if the paraphrase suite still fails.

**Product authority.** Extends the unmisreadable Ask contract (#150, #255/#259, #256, #331/#332). Continues deferred residual of `docs/plans/2026-08-06-002-feat-ask-search-atoms-agent-signal-plan.md` KD4 / accepted residual. Plugin and on-device embeddings stay out.

**Open blockers before `ce-work`.** Hard claim (Issue + assignee + STATUS + draft PR). Phase B (hybrid) additionally requires a **constitution PR** that narrows CLAUDE.md “embeddings” non-goal and Ask D7 — only if Phase A paraphrase suite fails or product chooses hybrid without waiting.

**Product Contract preservation.** New plan (bootstrap). Preserves #331 floor, empty-as-success, no `confidence: low`, non-authoritative snippets, `scope_complete: false`. Does not reopen #331 KD2 suppress-vs-low.

---

## Product Contract

### Summary

After #331, weak lexical junk is gone and empties are clean. That made **vocabulary mismatch silent**: a topical hit with zero shared tokens returns the same shape as a true negative. Handoff #2 dogfood: `how to stop viewers from clicking away` → `[]` while the Ross retention atom is a perfect topical match.

This claim ships three layers in one phased PR sequence:

1. **Agent honesty** — structured retrieval mode so safety does not live only in the word “lexical” inside a hint string; tighten instructions.
2. **Signal polish** — confidence labels that vary for multi-word queries; relative floor vs top hit (still no `low` rows).
3. **Recall** — index-time document expansion (questions / search phrases) folded into lexical scoring; optional **Phase B hybrid** (dense ∪ lexical → RRF → same floor) behind a constitution gate if expansion fails the paraphrase suite.

### Problem Frame

- **Consumer is an agent**, not a human skimming SERP noise.
- Floor is correct and must stay (false presence was worse).
- Lexical-only + clean empty = confident-looking miss on paraphrase.
- Confidence field is live in code (`high|medium|null`) but multi-word agent queries almost always land `medium`, so dogfood saw a constant.
- Embeddings are constitutionally out for plugin/on-device; **server Ask** hybrid was explicitly deferred by #331 KD4 pending this residual.

### Key Decisions

- **KD1. Honesty before recall.** Empty must remain non-claim of vault absence even after hybrid. Machine field `retrieval` (and mode-aware `hint`) carry the contract; hint prose is secondary. *(session-settled: user-approved)*
- **KD2. One claim, phased units (Phase A only).** Protocol + confidence/relative floor → expansion. Prefer two PRs (U1–U2, then U3–U4*) under one Issue. Hybrid is **not** this claim — U5 gate fail opens a **new** Issue/plan. On Phase A pass, **close** the Issue. *(session-settled; lifecycle refined in doc-review)*
- **KD3. Expansion before vectors.** Prefer write-time LLM “questions this atom answers” / search phrases stored beside the mirror row and scored lexically. Amortizes cost on upsert; keeps search path free of a second LLM call. *(session-settled — chosen over query-time multi-query/HyDE)*
- **KD4. Hybrid is Phase B, constitution-gated.** Plan both. Reopen D7 / CLAUDE embeddings non-goal **only if** Phase A paraphrase suite fails or product explicitly chooses hybrid as the durable path without waiting on the spike. Hybrid = lexical ∪ dense + RRF + existing floor. Server Ask only. *(session-settled)*
- **KD5. No `confidence: low`.** Keep #331 KD2: suppress weak hits. Relative floor drops tails; retune high/medium so multi-word queries can hit `high` when title/tag strong. *(session-settled)*
- **KD6. Floor stays absolute + gains relative.** Keep null-confidence suppress. Add drop when `score < fraction × topScore` among candidates that already cleared absolute floor (starting fraction ~0.45–0.55; fixture-calibrate).
- **KD7. Content-derived side data is privacy-sensitive.** Expansion text and any future embeddings are derived from body/title. Encrypt at rest like `body_enc` where stored; wipe/delete/reconcile must remove them; self-host docs disclose optional model calls.
- **KD8. Preserve #331 honesty rails.** Snippets non-authoritative; `fetch_atom` for claims; revision status fields; `scope_complete: false`; parent-find still returns medium+ on real titles.
- **KD9. Dual MCP consumers.** Single `instructions.mjs` + tool description cover Claude and ChatGPT.
- **KD10. No plugin bump** unless plugin-facing Ask copy changes (should not). Classify BM25 (`src/pipeline/shortlist.ts`) untouched.

### Actors

- **A1. Coding agent (Claude / ChatGPT via Ask MCP)** — primary consumer.
- **A2. Plus-service Ask mirror** — upsert, expand, search, wipe.
- **A3. Human vault owner** — Sync / Wipe; not a search UI user.

### Key Flows

- **F1. Confident lexical / expanded hit** — query shares tokens with title, tags, body, or expansion blob → medium+/high → agent `fetch_atom`s.
- **F2. Paraphrase hit (Phase A target)** — query shares no significant tokens with raw title/body but matches expansion phrases → hit returns (Ross case).
- **F3. True empty** — no confident match under active `retrieval` mode → `results: []` + structured fields + honest `hint`; agent must not claim vault absence.
- **F4. Upsert expands** — content_hash changes → server generates/stores expansion (best-effort; search still works if expand fails).
- **F5. Wipe / path delete** — expansion (and vectors if Phase B) removed with mirror row.
- **F6. Phase B hybrid (conditional)** — lexical list ∪ dense list → RRF → floor/confidence → results; `retrieval: "hybrid"`.

### Requirements

**Agent honesty**

- R1. Every `search_atoms` response (empty and non-empty) includes `retrieval: "lexical" | "lexical_expanded" | "hybrid"` reflecting the active server mode (not a per-hit guess).
- R2. Empty `hint` remains mode-honest and still forbids vault-wide absence. Prefer keeping the load-bearing “not a claim the topic is absent from the vault” clause. When mode is not pure lexical, do not over-claim “semantic completeness” either.
- R3. MCP tool description + `ASK_MCP_INSTRUCTIONS` teach: empty ≠ vault absence; never tell the user “you have no notes on X” from one empty search alone; score is ranking-only. **Confidence is not a strict fetch order:** `high` is strongest for title/tag identity matches, but under `retrieval: lexical_expanded` (or hybrid), a sole or topically best **`medium` hit is first-class** — agents must not skip medium expand/body hits in favor of unrelated `high` title noise, and must not treat “only medium results” as failure. Optional hit field `match_signals: string[]` (`title`|`tag`|`body`|`expand`) when cheap to attach.

**Confidence + relative floor**

- R4. Returned hits still `confidence: high | medium` only (no `low`).
- R5. Multi-word queries reach `high` when **all content words hit the title**, or an **exact tag** matches a content word / full query, or (optional) coverage ≥ 0.85 with ≥2 title word hits. Single-token exact/prefix title still `high` (AE3). Coverage-only body or expand-only stays `medium`. Replace vague “near-exact.”
- R6. After absolute floor, drop hits with `score < relativeFloor × maxScore` when ≥2 candidates — **except** candidates that qualified via `expandStrong` or full-query phrase-in-expand (they are exempt from relative drop so paraphrase hits survive stronger off-intent title distractors). Default `REL_FLOOR=0.5`; fixture-tune 0.45–0.55 for non-exempt tails.
- R7. Parent-find / proper-noun fixtures from #331 still pass (this plan **AE5**; prior #331/#002 AE4/AE8 lineage). This plan’s AE4 is relative floor; AE8 is tag-empty → `list_tags`.

**Index-time expansion (Phase A recall)**

- R8. On mirror upsert when `content_hash` changes, server derives a short expansion blob (target: 3–5 questions or search phrases the atom would answer; plus key entities already in title/tags if useful). Store encrypted beside the row. Do not block upsert success on expand failure — log/metric and leave expansion empty.
- R9. `scoreSearch` / `buildSearchHits` treat expansion text as an additional scored field (weight below title/tags, above or equal weak body — pin in KTD).
- R10. Backfill job or lazy path: existing rows without expansion get expanded (ops: one-shot script and/or expand-on-read-miss once). Prefer explicit backfill for dogfood accounts over surprising sync latency.
- R11. Path delete, reconcile delete, and `mirrorWipe` clear expansion (and Phase B vectors).
- R12. Expansion uses existing Plus `ANTHROPIC_API_KEY` + cheap/fast model tier (config knob). Cap input chars from body. No client-supplied expansion.

**Phase B hybrid (conditional)**

- R13. Only after constitution reopen: embed title+tags+body(+expansion) on upsert; store per-row vector (or side table) scoped by email; query embed at search; fuse with lexical via RRF; then existing confidence/relative floor.
- R14. Feature flag or config: `ASK_SEARCH_MODE=lexical|lexical_expanded|hybrid` so rollback does not require redeploy of bad rankers only (flag may still need restart).
- R15. Self-host: hybrid/expansion optional; document env keys; DIY without keys keeps lexical (+ empty expansion).

**Eval + ship**

- R16. Automated paraphrase suite: **≥3 distinct positive** paraphrase cases (different atoms, different vocabulary gaps — not Ross variants) **plus** ≥1 true-absent (AE10/P4). **All positives must green** to stop at Phase A (absent case mandatory, not in the numerator). Pure hand-authored-expand scorer tests do **not** count toward the U5/KTD8 quality gate; that gate requires real `buildExpandPrompt`→model→parse (or live dogfood after backfill) on held-out queries.
- R17. plus-service tests green; Fly deploy for live dogfood; plugin version bump **expected** for privacy ack (R18).
- R18. Privacy/self-host: disclose expand (and hybrid if gated) in `docs/ask-self-host.md` **and** hosted Ask privacy ack / in-product Ask privacy copy before expand-on-upsert is enabled for real accounts (plugin bump expected for ack text). Wipe semantics for side data.
- R19. Expand plaintext is **server-internal for scoring only** — never include `expand` / `expand_enc` on MCP search or fetch payloads. `fetch_atom` remains the body path.
- R20. On every content_hash-changing upsert, clear `expand_enc` in the same write as body; only set expand after successful generate. Soft-fail leaves empty expand, not stale phrases.
- R21. Skip expand work only when `content_hash` matches **and** `expand_enc` is present. Hash-match + empty expand must re-enqueue expand (soft-fail recovery without waiting solely on backfill).
- R22. Search responses expose expand health when expand scoring exists: e.g. `expand_coverage` (0–1 fraction of rows with non-empty expand) and/or keep `retrieval: lexical` until coverage meets a pinned floor. Degraded index must not look like full paraphrase mode.

### Acceptance Examples

- **AE1 (honesty empty).** Mirror has only unrelated notes. Query topic-absent multi-word. → `results: []`, `retrieval` present, `hint` forbids vault absence, instructions/tests pin agent contract strings.
- **AE2 (Ross paraphrase).** Corpus includes Ross retention atom (title/body without “clicking away” / “viewers”). Query `how to stop viewers from clicking away`. → target in results at medium+ after Phase A expansion (or Phase B hybrid).
- **AE3 (true high).** Exact or prefix title query → `confidence: high`.
- **AE4 (relative floor).** Top hit strong; weak off-topic companion below half top score → companion dropped.
- **AE4b (expand vs distractor).** Corpus: off-intent title match clearing absolute floor at high score + topical expand-only hit at lower score → **expand hit retained** (relative-floor exempt).
- **AE5 (parent-find).** Reasonable title/name query still returns parent medium+ (#331 AE4 lineage).
- **AE6 (expand fail soft).** Upsert succeeds when expand API 503; row searchable lexically; expansion empty.
- **AE7 (wipe).** After wipe, no mirror rows and no orphan expansion/vector rows for email.
- **AE8 (tag empty).** Tag-filter empty still steers `list_tags` (#256).
- **AE9 (mode field).** Non-empty hit payload includes same top-level `retrieval` as empty path.
- **AE10 (absent after expand).** Paraphrase suite includes one query that should stay empty (no topical atom) so expansion does not hallucinate matches from generic phrases alone — floor must still suppress.

### Scope

**In**

- plus-service search scoring, MCP tool/instructions, mirror schema side fields, expand on upsert, hosted privacy ack copy, tests, self-host note, Fly deploy notes. Phase B only as gate record / deferred-plan pointer.

**Out**

- Plugin UI search; on-device/plugin embeddings; classify shortlist BM25 changes; nested neighbor titles on hits (handoff optional); cross-encoder rerank (later); HyDE/multi-query at search time as default; `confidence: low`; reverse-sync; changing body encryption scheme beyond adding parallel encrypted fields; hybrid implementation in this claim.

**Deferred**

- Phase B hybrid — new plan/Issue only if U5 gate fails.
- Cross-encoder rerank if hybrid precision noise appears.
- Neighbor titles on hits.

### Success Criteria

- All ≥3 distinct positive paraphrases green under live/model expand + AE10 empty + `expand_coverage` floor; else open hybrid plan (not soft-pass).
- Live dogfood: Ross returns Ross atom; sourdough-style absent empty; confidence varies title-strong vs body/expand medium.
- Agents cannot honestly claim vault absence from empty alone without ignoring structured fields + instructions; medium expand hits treated as fetchable.
- Wipe leaves no expansion residue; Issue closed on Phase A pass.

### Sources / Research

- Handoff: `docs/handoffs/2026-08-06-ask-search-handoff-2.md`
- Shipped signal: `docs/plans/2026-08-06-002-feat-ask-search-atoms-agent-signal-plan.md` (KD4 residual)
- Ask D7: `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md`
- Classify analogy (not copy): `docs/research/2026-07-29-retrieval-techniques.md`, `docs/research/2026-07-29-ondevice-and-providers.md`
- External: hybrid BM25+dense RRF as minimum viable baseline; rerank largest second-stage gain; HyDE weak for precise domains (2026 text-and-table RAG benchmark survey) — supports hybrid destination, expansion-first cost control for this product.
- Code: `plus-service/src/store/askHelpers.mjs` (`scoreSearch`, `buildSearchHits`), `plus-service/src/mcp/tools.mjs`, `instructions.mjs`, `askPostgresMethods.mjs` / `askSqliteMethods.mjs` / `memory.mjs`, `mirror/http.mjs` upsert plaintext path, `anthropic.mjs` + `ANTHROPIC_API_KEY`.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. `retrieval` top-level field (R1).** Values: `lexical` | `lexical_expanded` | `hybrid`. Always present on search JSON. Default stays **`lexical` until expand scoring is enabled and account expand coverage is usable** (e.g. backfill complete, or non-null `expand_enc` on a pinned fraction of rows / any row for tiny mirrors). Do **not** emit `lexical_expanded` solely because the column exists or config is “wired.” Empty `hint` must match the advertised mode (no paraphrase-completeness claim under partial coverage).

- **KTD2. Confidence retune without `low` (R4–R5).** Keep match-kind base from #331. Multi-word → `high` iff all content words hit title, or exact tag, or coverage ≥ 0.85 with titleWordHits ≥ 2. Single-token exact/prefix title / exact tag / title-contains with q.length ≥ 3 stay `high` as today. Body-only and expand-only → `medium` max. Attach `match_signals` on hits when any of title/tag/body/expand contributed (for agent fetch priority under R3).

- **KTD3. Relative floor (R6, AE4, AE4b).** After absolute floor: `top = max(score)`. For each candidate with ≥2 total candidates, drop if `score < REL_FLOOR * top` **unless** `expandStrong || expandPhrase` (full query in expand). `REL_FLOOR` default `0.5`. Fixture: 158 vs **70** drops weak; AE4b keeps expand-only under higher off-intent title.

- **KTD4. Expansion storage (R8, R11).** New column `expand_enc TEXT` (or `search_expand_enc`) on `atom_mirror` — encrypted via same `encryptMirrorField` as body. Empty string / null = none. Schema migrate all three backends (postgres ALTER IF NOT EXISTS, sqlite PRAGMA pattern like `created`, memory map field). Wipe/delete paths clear with row.

- **KTD5. Expansion generation (R8, R12, R20–R21).** Pure helper `buildExpandPrompt(title, tags, bodySlice)` + `parseExpandResponse` → newline or JSON list of 3–5 short phrases/questions. Call Anthropic Messages API with small max_tokens, temperature 0, Haiku-class model via config `ASK_EXPAND_MODEL`. Body slice cap ~2–4k chars.

  **v1 execution (pinned):** respond to upsert **after DB write**; expand **off the HTTP request path** via in-process queue (concurrency ≤2, enqueue cap e.g. ≤10 new expands per upsert request; overflow → backfill). **Forbid** awaiting N sequential multi-second LLM calls inside the upsert handler. Persist expand with `UPDATE … SET expand_enc=? WHERE email=? AND path=? AND content_hash=?` (expected hash at job start); 0 rows = no-op (survives wipe/newer upsert). On failure: expand stays null, counters only (no body/prompt/expand text in logs).

  **Contrast with classify:** this is the first Ask path that may send **body plaintext** to a third party (classify is titles-only). Document that in privacy ack + self-host.

- **KTD6. Expansion in scorer (R9) — pinned numbers** (align to current `scoreSearch` constants in `askHelpers.mjs`):
  - Expand field text lowercased like body.
  - Full-query phrase in expand: `+20 + count×8` (cap count 20), `expandPhrase=true` — same shape as body phrase (`+20+count*8`).
  - Per content-word hit in expand only (not already counted as title/tag): `expandWordHits * 12` (between tagWord 18 and bodyWord 6).
  - Content words matched via expand count toward `coverage` / `matched`.
  - **`expandStrong`** (confidence medium, never high): `(expandPhrase && contentWords ≥ 2) || (expandWordHits ≥ 2 && longExpandWordHits ≥ 2 && coverage ≥ 0.5)` where long = token length ≥ 4.
  - Expand alone never yields `high`.
  - `parseExpandResponse`: max 5 phrases, each ≤ 120 chars; drop empty; drop phrases with no token overlap of length ≥ 4 with title∪tags∪bodySlice (anti-generic); reject vault-generic templates (`how to improve`, `what is success`, etc. small deny list).

- **KTD7. Backfill (R10).** `plus-service/scripts/backfill-ask-expand.mjs` (or npm script): walk accounts/rows missing expand, decrypt body, expand, write. Rate-limit. Document for Fly one-shot. Optional: search path if expand null and `ASK_EXPAND_LAZY=1` — default off to avoid search latency spikes.

- **KTD8. Phase B hybrid sketch (R13–R15) — deferred plan only if gate fires.**  
  - Encrypt vectors at rest like body (KD7); side table must CASCADE on wipe/delete.  
  - One embed provider only; document egress.  
  - Search: top-K dense ∪ lexical → RRF k=60 → confidence (dense-only ≤ medium) → floors (expandStrong-style denseStrong exempt from relative drop if needed).  
  - Constitution: narrow CLAUDE.md embeddings non-goal to on-device/plugin; Ask server may hybrid.  
  - **Gate (U5):** Phase A fails if any of: (a) &lt;100% of the ≥3 **positive** automated live/model paraphrase cases green; (b) live Ross miss after backfill with `expand_coverage` ≥ floor (0.8 default for dogfood account); (c) product pulls hybrid early. Pure planted-expand unit tests do not satisfy (a).

- **KTD9. Test-first.** Extend `ask-search-signal.test.mjs` (relative floor, AE4b, confidence, expand weights). New `ask-search-expand.test.mjs` (parse, validators, upsert soft-fail mock). MCP shape: `retrieval`, `expand_coverage`, instructions no unqualified “prefer higher confidence.” Phase B tests only in deferred plan.

- **KTD10. Cost / abuse.** Expand only when hash changed or expand empty (R21). Per-upsert enqueue cap (≤10). **Per-email rate limit:** e.g. 60 expands/hour and/or 200k body-chars expanded/day (config); over limit → leave expand null, soft-fail. Backfill uses same limiter. Compromised `sess_` implies expand spend until revoke — document.

### Approach

```
mirror upsert (plaintext body available)
  → encrypt body, write row
  → if hash changed: expand LLM → encrypt expand_enc (soft-fail)

search_atoms
  → load pubs (body + expand decrypt)
  → scoreSearch(title, tags, body, expand) → score + confidence
  → absolute floor (null conf out)
  → relative floor vs top
  → sort, limit
  → JSON + retrieval mode + empty hint

Phase B (gated): + dense rank → RRF → same floors; retrieval=hybrid
```

### Assumptions

- Anthropic key already required in prod for classify; expand rides same secret.
- 75–few thousand notes: full-table decrypt search remains acceptable; vectors not required for scale yet — only for recall quality.
- Expansion hallucinations are bounded by floor + AE10 absent case.
- Single `instructions.mjs` still covers both connectors.

### Sequencing

```
U0 hard claim (Issue, STATUS, draft PR)
U1 protocol field + instructions/tool copy          ─┐ Phase A1 (mergeable alone)
U2 confidence retune + relative floor + tests        ─┘
U3 expand scorer + parse helpers + pure tests       ─┐ Phase A2
U4a schema + wipe/delete clear expand_enc            │
U4b upsert expand call + soft-fail + hash/expand skip│
U4c backfill script (ops)                            ─┘
U5 live paraphrase dogfood / suite gate + coverage %
U6–U7 [deferred plan only if gate fails] constitution + hybrid
U8 self-host + privacy notes; Fly deploy
```

Prefer **two Phase A PRs** (U1–U2, then U3–U4*) under one Issue. Hybrid is **not** coded in this claim unless gate fails → new plan.

### Risks

| Risk | Mitigation |
|---|---|
| Expansion too generic → false hits | Tight prompt; floor; AE10; weight expand &lt; title |
| Expand latency on Sync | Soft-fail; optional async; hash skip; batch cap |
| Relative floor kills parent-find | AE5; only apply when ≥2 candidates |
| Agents ignore `retrieval` | Instructions + tool description first lines |
| Constitution delay blocks hybrid | Phase A may be enough; Issue stays open for B |
| Privacy surprise (plaintext-derived expand) | Encrypt; disclose; wipe; self-host opt-out |
| Cost spike on full-vault re-sync | Expand only on hash change; backfill rate-limit |

---

## Implementation Units

### U1. Protocol honesty — `retrieval` + copy

- **Goal.** Machine-readable mode on every search response; agent instructions stop “no notes on X” from empty alone.
- **Files:** `plus-service/src/mcp/tools.mjs`, `plus-service/src/mcp/instructions.mjs`, `plus-service/test/mcp-unmisreadable-shape.test.mjs`, `plus-service/test/ask-search-signal.test.mjs` (assert empty payload keys if tested via helper).
- **Approach.** Add `retrieval` + `expand_coverage` (0 when expand off). Default mode `lexical` until coverage floor (KTD1). Update tool description + instructions per R3 (medium expand first-class; no unqualified “always prefer high”). Keep vault-absence ban.
- **Test scenarios:**
  1. Empty search JSON includes `retrieval` (+ `expand_coverage` when expand enabled)
  2. Non-empty includes same
  3. Instructions: empty ≠ vault absence; medium expand not second-class; forbid single-empty absence claims
  4. Tool description aligned
  5. Tag-filter empty still steers `list_tags` (AE8)
- **Verification:** `cd plus-service && npm test`
- **Traces:** R1–R3, R22, AE1, AE8, AE9

### U2. Confidence retune + relative floor

- **Goal.** Labels vary; weak tail under top score dropped; no `low`.
- **Files:** `plus-service/src/store/askHelpers.mjs` (`scoreSearch`, `buildSearchHits`), `plus-service/test/ask-search-signal.test.mjs`
- **Approach.** Test-first. Implement KTD2–KTD3. Preserve #331 AE1 empty and title-high paths.
- **Test scenarios:**
  1. Exact/prefix title → high (AE3)
  2. Multi-word all-in-title → high
  3. Body-only medium coverage → medium
  4. Two candidates scores 158 vs 70 at REL 0.5 → only top (AE4)
  5. AE4b: high off-intent title + lower expandStrong → expand hit kept
  6. Single candidate weak-but-medium → kept
  7. Parent title query still medium+ (AE5)
  8. Topic-absent still empty (AE1)
- **Verification:** `node --test test/ask-search-signal.test.mjs`
- **Traces:** R4–R7, AE3–AE5, AE4b

### U3. Expansion field in pure scorer + parse helpers

- **Goal.** Paraphrase can score via expand blob without live API.
- **Files:** `plus-service/src/store/askHelpers.mjs`; new `plus-service/src/ask/expandSearch.mjs` (prompt + parse); `plus-service/test/ask-search-expand.test.mjs`; extend `ask-search-signal.test.mjs` with Ross-shaped pure fixture (hand-written expand string).
- **Approach.** Pure Ross fixture: title/body without viewer/click tokens; expand contains “how to keep viewers watching” etc.; query handoff string → medium+ hit. AE10: expand generic fluff must not surface unrelated atom for absent topic.
- **Test scenarios:**
  1. Ross-shaped pure (AE2 without API)
  2. Phrase-in-expand boosts score
  3. parseExpandResponse accepts JSON array and newline list
  4. Rejects empty/garbage → []
  5. AE10 absent still empty with noisy expand on wrong docs
- **Verification:** focused node --test on new + signal files
- **Traces:** R9, R16, AE2, AE10

### U4. Schema + upsert expand + wipe + backfill script

- **Goal.** Persist expand_enc; generate on hash change; wipe clean; backfill tool.
- **Files:** `askPostgresMethods.mjs`, `askSqliteMethods.mjs`, `memory.mjs`, `askHelpers.mjs` (`prepareMirrorRow` / `rowToPublicAtom`), expand call helper in `plus-service/src/ask/expandSearch.mjs` or `anthropic.mjs` (no separate `expandClient.mjs` unless a second caller appears), `plus-service/scripts/backfill-ask-expand.mjs`, tests `store-ask.test.mjs` / new expand integration with mock fetch.
- **Approach.** Migrate column. On upsert after successful write when hash changed, call expand (mockable). Soft-fail (AE6). Wipe/delete assertions (AE7). Script dry-run flag.
- **Test scenarios:**
  1. Hash unchanged → no expand call
  2. Hash changed → expand stored (mock)
  3. Expand throws → upsert still ok, expand null (AE6)
  4. mirrorWipe removes expand with rows (AE7)
  5. path delete removes expand
  6. rowToPublicAtom search path exposes expand for scoring only (not necessarily in MCP hit payload — **do not** return full expand text to agents by default)
- **Verification:** `cd plus-service && npm test`
- **Traces:** R8, R10–R12, AE6, AE7

### U5. Gate evaluation (no code if pass)

- **Goal.** Decide whether Phase A is enough.
- **Approach.** After U1–U4* merge/deploy + backfill: record `expand_coverage`, live Ross, ≥3 positive model/live paraphrases (all must pass), AE10 absent. **Pass → merge Phase A, close Issue, open linked deferred Issue only if product wants hybrid backlog** (default: close; hybrid is a new claim when needed). **Fail → open new hybrid plan/Issue** (not implement under this spine). Pure planted-expand tests alone cannot pass the gate.
- **Traces:** R16, KTD8 gate, success criteria

### U6–U7. Deferred — not in this claim’s active units

Phase B constitution + hybrid RRF stay in **KTD8 sketch + gate criteria only**. If U5 fails, open a **new plan/Issue** for constitution + hybrid. Do not implement U6/U7 under this PR spine.

### U8. Docs + deploy + hosted privacy ack

- **Goal.** Self-host + hosted privacy disclosure + shipping.
- **Files:** `docs/ask-self-host.md`, Ask privacy ack / plugin Ask privacy copy (expect version bump per R18), optionally `plus-service/README.md` env table; PR test plan.
- **Approach.** Document `ASK_EXPAND_*`, body egress to Anthropic, wipe clears expand; no hybrid env table until Phase B plan. Fly deploy + backfill runbook (required post-deploy for dogfood, not optional theater).
- **Traces:** R17–R18, R19

---

## Verification Contract

```bash
cd plus-service && npm test
cd plus-service && node --test test/ask-search-signal.test.mjs test/ask-search-expand.test.mjs
```

**Live (post-merge Phase A):** Fly deploy → backfill expand for dogfood account → Claude Ask:

1. `how to stop viewers from clicking away` → Ross atom  
2. `sourdough starter hydration ratio` → empty + `retrieval` + honest hint  
3. Exact title query → `confidence: high`  
4. Wipe on throwaway account → no residue (if safe)

**Execution direction:** test-first on pure scorer/expand parse before upsert I/O.

**No plugin verify.sh** unless plugin touched.

---

## Definition of Done

- [ ] Hard claim: Issue + STATUS + draft PR with `Closes #N`
- [ ] U1–U4 merged and tests green
- [ ] Paraphrase suite automated (≥4 cases: AE2 Ross + ≥2 more paraphrases + AE10/P4 absent; gate ≥3/4 of that suite)
- [ ] Live dogfood notes in PR (Phase A)
- [ ] Gate recorded in PR/`docs/qa/`: Phase A pass (all ≥3 positives + absent + live Ross + expand_coverage floor) **or** new hybrid plan/Issue opened
- [ ] Hosted privacy ack + self-host note for expand body egress; wipe residue tested
- [ ] Fly deploy + backfill; STATUS cleared; **Issue closed on Phase A pass** (hybrid = future Issue if ever needed)
- [ ] Shipping tail: simplify → code-review → compound → world-class-qa N/A UI
- [ ] Plugin bump **expected** for privacy ack copy (R18); no unrelated plugin churn
- [ ] Constitution unchanged in this claim (Phase B = separate plan)

---

## Appendix

### Paraphrase suite seed (fill before claim / U5)

| ID | Query | Target atom sketch | Shared tokens with title/body |
|---|---|---|---|
| P1 | how to stop viewers from clicking away | Ross retention / open loops / stakes | none significant |
| P2 | how do I keep people watching past the first seconds | same Ross atom (different paraphrase — **does not** count as second atom; replace before U5) | none |
| P2′ | **required distinct atom** — pick from dogfood mirror before U5 (e.g. newsletter/Atoms product note vs “how we pitch the second brain”) | different atom from P1 | none significant |
| P3 | **required distinct atom** — third vocabulary-gap pair from mirror | different from P1/P2′ | none significant |
| P4 | sourdough starter hydration ratio | none | must empty (AE10) |

**U5 numerator:** P1 + P2′ + P3 must all hit; P4 empty; P2-same-atom is optional stress only. Pure tests may hand-author expand; gate uses live model expand after backfill.

### Issue lifecycle (session-settled via doc-review)

On Phase A gate **pass:** close the claim Issue (`Closes #N`). Do not leave an open “Phase B deferred” umbrella. Hybrid later = new Issue + plan if dogfood regresses or product reopens.

### Session-settled decision log

| Decision | Rejected |
|---|---|
| One claim, phased units (U1–U2 then U3–U4*) | Two claims for honesty vs expand; hybrid-first |
| Constitution / hybrid only if U5 gate fails → **new** plan | Reopen now; never hybrid; same-Issue hybrid spine |
| No confidence:low | Return low rows |
| Expansion before vectors | Query-time multi-query default; drop floor |
| Protocol field + expand_coverage | Hint-string-only safety |
| Medium expand first-class in agent copy | Unqualified prefer-high |
| expandStrong exempt from relative floor | Relative floor on all candidates |
| Close Issue on Phase A pass | Leave umbrella Issue open |
| ≥3 distinct positive paraphrases all green | 3/4 of mixed suite with TBD rows |
| Per-email expand rate limit | Entitlement-only cost control |

### Confidence check (planner)

| Area | Level | Notes |
|---|---|---|
| Problem / scope | high | Handoff + shipped #331 residual |
| Phase A design | high | Matches repo patterns + Anthropic already on service |
| Expansion prompt quality | medium | Needs fixture iteration in U3/U5 |
| Phase B detail | medium | Intentionally sketched until gate |
| Privacy/encrypt expand | high | Parallel to body_enc |
| Cost at scale | medium | Hash-skip + rate-limit; watch full re-sync |

**Doc-review:** 2026-08-06 — multi-persona; safe_auto + gated judgment applied (round 1). Ready for hard claim → `ce-work` on U1–U2.
