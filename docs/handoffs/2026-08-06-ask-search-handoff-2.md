# Atoms Search — Handoff #2 (post-implementation)

**Source:** verification testing against the shipped changes, same Claude session, 2026-08-06. Mirror is now 75 notes.
**Supersedes:** nothing in handoff #1 — this closes out two items and reprioritizes the rest.
**Related shipped:** #331 / #332 — Ask `search_atoms` confidence + true empties
**Plan that deferred hybrid:** `docs/plans/2026-08-06-002-feat-ask-search-atoms-agent-signal-plan.md` (KD4, accepted residual)

---

## Status of handoff #1


| # | Item | Status |
|---|---|---|
| 1 | Relevance floor / true empty results | **Shipped.** Working well. |
| 2 | Normalized score or confidence label | **Partial.** Field exists, carries no information. |
| 3 | Hybrid (semantic + lexical) retrieval | **Not shipped.** Now the top priority. |
| 4 | Snippet artifact cleanup | **Shipped.** Fully resolved. |
| 5 | Return neighbor titles with hits | Not shipped. Still optional. |


### What shipped well — don't touch these

Empty-result handling works. `sourdough starter hydration ratio` returns `results: []` with a hint that reads:

> *no confident lexical match for this query in this account's mirror_scope—not a claim the topic is absent from the vault*

That wording is better than what was asked for. It scopes the claim to lexical matching and explicitly refuses to assert absence. Keep this sentence intact — the reasoning in section 1 below depends on it, and right now it is the only thing preventing a wrong answer.

Snippets are clean. No more duplicated summary tails. `snippet_truncated` was not requested and is a genuine improvement — it distinguishes a fragment from a complete short atom, which changes whether a follow-up `fetch_atom` is needed.

Precision improved measurably. `Zeigarnik Effect open loops stakes` returned exactly one result, the correct atom, where the same shape of query previously padded with unrelated hits.

---

## 1. Hybrid retrieval — now the top priority, and the reason has changed

This was ranked third in handoff #1. It should now be first, because **the relevance floor changed its risk profile.**

Test: `how to stop viewers from clicking away` → `results: []`

The mirror contains `Ross's retention framework- stack open loops and manufacture stakes`, whose body is entirely about keeping viewers watching past the first few seconds. It is a perfect topical match. Zero shared tokens, so zero results.

Before the floor shipped, a lexical gap produced visible noise — obviously irrelevant results that signalled the query had missed. After the floor, the same gap produces a clean, confident empty response that is **structurally identical to a correct negative.** The failure mode went from loud to silent.

That is not an argument against the floor, which is correct and should stay. It is an argument that the floor and lexical-only retrieval are a bad pairing: together they make the system look more certain than it is. Right now the only thing standing between this and an agent telling a user "you have no notes on that" is the word "lexical" in the hint string. That is a load-bearing adjective in a log message, which is not where safety should live.

**Recommendation:** hybrid retrieval — embeddings over atom bodies and titles, unioned with the existing lexical pass, then reranked. Keep lexical as-is for exact names, tags, and titles, where it performs well and where embeddings are typically worse. At 75 notes the index is small and cheap; the point is to make the architectural decision now rather than after the vault is large enough that gaps stop being noticeable.

**Suggested acceptance test:** a query that is topically correct but shares no significant tokens with the target atom must return that atom. `how to stop viewers from clicking away` → the Ross retention atom is a ready-made case. A few more, each targeting an atom by paraphrase only, would make a decent regression suite.

**Constitution note (agent):** CLAUDE.md lists `embeddings` as out of scope; Ask plan D7 is lexical-only; #331 KD4 deferred hybrid to a constitution/D7 reopen. Server-side Ask hybrid is **not** the rejected on-device path (`docs/research/2026-07-29-ondevice-and-providers.md`). Reopen requires explicit product approval + plan.

---

## 2. Confidence is a constant, not a signal

Every result across every test query returned `confidence: "medium"`:


| Query | Top score | Lowest returned | All confidence values |
|---|---|---|---|
| `Zeigarnik Effect open loops stakes` | 182 | 182 | medium |
| `newsletter use case Atoms app` | 158 | 88 | medium |


A near-exact match at 182 and a marginal hub match at 88 are labelled identically. A field with one observed value cannot be thresholded on, so the caller is back to interpreting the raw score — which is the exact problem the label was meant to remove.

Scores were rescaled (the old ~24 baseline is now ~90–180) but the scale still has no documented ceiling or reference point, so it is not independently usable either.

Two things to check:

- Are `high` and `low` reachable at all, or is the mapping effectively hardcoded? Worth confirming the bands are wired up before tuning them.
- If they are reachable, the bands are too wide. A useful starting shape: `high` for results that are near-certain matches on title or tag, `low` for anything within the band just above the floor, `medium` for the middle. The specific cutoffs matter less than the labels varying across a normal result set.

The simplest validation: run the two queries above and confirm at least two distinct confidence values appear.

**Code note (agent, verified 2026-08-06):** `high` **is** reachable in unit tests (exact title, title prefix, exact tag, full-query phrase in title). Multi-word agent queries almost never take that path — they land on the multi-word coverage branch, which only assigns `medium`. So the field is live but inert for the dominant query shape. Plan KTD2 intentionally omitted `low` (suppress instead). Handoff #2’s “low above floor” would reopen that KD.

---

## 3. Minor: floor could come up slightly

On `newsletter use case Atoms app`, the hub note `Personal notes/Social/Nichita` returned at score 88 against a top score of 158 — roughly 56% of the top hit, and not relevant to the query.

Low severity, since one weak tail result is cheap compared to the failures above. But if scores are being normalized for item 2 anyway, a relative floor — drop results below some fraction of the top score, in addition to the absolute floor — would be nearly free to add at the same time and would clean up cases like this.

---

## Priority

1. **Hybrid retrieval.** Silent misses on topically-correct queries. Highest risk of a confidently wrong answer reaching a user.
2. **Confidence bands.** Field is shipped but inert; low effort to make useful.
3. **Relative floor.** Cosmetic. Bundle with #2 if convenient.
