# The real vault, read-only — what it can and cannot settle

Date: 2026-07-29 · Issue #168 · free, read-only, no network
Harness: `scripts/analyze-vault-shortlist.mjs` (now with `--hops`), run against
`~/Documents/Remote Vault` with the owner's permission. No vault content left the machine; every
number here is an aggregate.

Three questions were blocked on this run: does graph reach transfer to a real link graph, do tags
work as document expansion, and is the 200-char body truncation right. **The vault is too small to
answer any of the three on recall.** It did settle two facts that were wrong or unknown, and one of
them changes which lever looks biggest.

## Why it can't answer the recall questions

| | value |
|---|---|
| notes | 373 |
| atoms | 37 |
| atoms with resolvable links | 25 |
| gold links | **30** |
| links scoring zero under BM25 | **1** |

At k=400 every selector scores 100%, because 400 exceeds the whole vault — k is not a cap here at
all. That is the same limitation the handoff already flagged: **recall@400 has still never been
measured on a genuinely 3,000-note vault.** All discrimination happens at k=40, where two links
separate the selectors:

| selector | k=40 | k=100 | k=200 | k=400 |
|---|---|---|---|---|
| alphabetical (what Plus ships) | 0% | 23% | 27% | 100% |
| recency | 73% | 87% | 87% | 100% |
| keyword (title only) | 80% | 87% | 87% | 100% |
| bodyPlusTitle | 93% | 97% | 97% | 100% |
| hybridBody | 97% | 97% | 97% | 100% |

**Alphabetical-40 scoring 0% is the one robust result here** — it is the behaviour Plus ships today,
and on this vault it surfaces none of the 30 links a body-scored shortlist finds.

The hop measurement is likewise starved: of 30 links, 19 are already in the top-10 seeds, 10 are
ranked below, and exactly **one** scores zero. The ranked population reaches 80% at 1 hop
(70% hub-blocked), which is directionally consistent with the synthetic corpus's 56%/42% — but n=10
and n=1 support nothing. **The synthetic hop result stands unconfirmed.**

## What it did settle

### 1. The "mean body is 1,943 chars" figure was measuring the wrong thing

The handoff cites 1,943 chars as the mean body and concludes the 200-char index "discards ~90% of
the text." Measured over **atom captures specifically**, the mean is **123 chars** (median 97), and
only **5 of 37** atoms exceed 200 characters at all. The 1,943 figure came from averaging over all
373 notes, where non-atom notes are read with a 2,000-character slice and dominate the mean.

So the 200-char truncation discards almost nothing, and the recall difference is the *same single
link* the handoff already identified as inside the noise floor — reproduced directly here:
bodyPlusTitle scores 97% at k=40 truncated and 93% untruncated, one link out of 30, and hybridBody
is 97% either way. **The 200-char question is not a real question at this body-length distribution.**
It becomes one only if captures get much longer; it should be decided on memory, not recall.

### 2. Tags are the largest untapped source of index terms — larger than the captures

Indexable tokens across all 37 atoms:

| field | tokens | vs capture |
|---|---|---|
| capture (all that is indexed today) | 650 | — |
| link prose tail | 315 | +48% |
| **frontmatter tags** | **714** | **+110%** |

**All 37 atoms have tags.** Indexing tags and link prose together would take the index from 650 to
1,679 tokens — **+158% more terms**, and terms are the only thing that moves an absolute miss.

This reframes `docs/research/2026-07-29-doc-expansion.md`. That experiment measured link prose alone
(+16 links won, 0 lost) and called its result a floor because the corpus's link prose is only hub
titles. The floor is lower than assumed: on a real vault the field it *could not* test contributes
more vocabulary than the field it did.

**It is still unmeasured.** The chrono corpus has no tags, and inventing them would be fabricating
the evidence. Measuring this needs either a corpus with model-written tags (a paid generation run)
or a real vault big enough to discriminate — and 37 atoms is not it.

## What would unblock the rest

Not this vault. Every open question needs a corpus with more links and enough notes for k=400 to
bite:

- **hop distance on a real graph** — needs a real vault with hundreds of linked atoms
- **tags as expansion** — needs any corpus that has tags
- **recall@400** — needs ~3,000 notes; at 373 the cap never engages

Until one exists, the synthetic chronological corpus (576 atoms, 811 links) remains the only
instrument with enough resolution, and its limits are the branch's limits.
