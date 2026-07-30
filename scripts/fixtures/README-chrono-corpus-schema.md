# Life-story corpus — authoring brief

You are writing **three years of one person's phone captures**, in order, as they actually happened.
Not a dataset. A life. The realism is the point: this corpus gets run through the real Atoms
pipeline, and everything we conclude about whether a note can find its earlier self depends on the
captures being as hard to link as real ones are.

Output is JSON in the schema at the bottom. Read the whole brief before writing anything.

---

## 1. Why this exists (read this or you will write the wrong thing)

We are testing one question: **when a note is created, can the system find the earlier notes it
belongs with?**

To test that honestly, *you* must declare which captures belong together — `linksToEarlier` — and you
must do it **before any model sees the corpus**. That field is the answer key. If a model wrote the
links and we scored retrieval against them, we would be grading the search against its own output;
the answer comes out 100% and means nothing.

So the job is not "write plausible notes." It is: write notes that genuinely belong together, and
make finding that out **hard in the specific ways real life is hard**. A corpus where every linked
pair repeats the same nouns is a corpus that proves nothing — we already know keyword search finds
those.

The previous corpus (720 captures, 811 links) had **23.4%** of its linked pairs sharing *no* content
word at all. That is the number that matters, and it is roughly the real-vault rate. Hold it or
beat it. Everything in §4 exists to produce it honestly rather than by sprinkling in synonyms.

---

## 2. The register bar — how a real capture reads

Measured against the owner's real vault (37 atoms) and the previous corpus:

| Property | Target | Hard limit |
|---|---|---|
| Mean capture length | **95–125 chars** | — |
| Median | **~100 chars** | — |
| Over 200 chars | **≤ 3%** | none over 260 |
| Under 50 chars | **≥ 15%** | — |
| Noise verdict | **20%** | 18–22% |

Real captures are thumbed into a phone one-handed, usually while doing something else. They are:

- lowercase-dominant; capitalisation is accidental, not consistent
- fragments — no subject, trailing off, two half-thoughts jammed together
- occasionally typo'd or autocorrect-mangled, and left that way
- written **in** the moment, not **about** the moment

**The tell to avoid.** Models asked to write messy notes write tidy prose *about* messiness. These
are all rejects:

- `had an interesting thought today about how my relationship with work has shifted` — self-narrating
- `Realized that the constraint isn't time, it's attention.` — an aphorism, capitalised, punctuated
- `just wanted to note that the thing with mom felt different this time` — "just wanted to note"
- anything with an em dash, a semicolon, or a colon used rhetorically

These are the shape we want:

- `sleep thing again. 3 nights now. its the coffee after 2pm i think`
- `she was right about the deposit`
- `cant keep doing tuesdays like this`
- `bought the wrong gauge wire ugh`
- `whole point of the rewrite was to delete code and its now bigger than before`

Never prefix a capture with "remember:", "note:", "thought:", or "TIL".

**Never pad a capture to hit the length target.** This is the failure that killed the first attempt.
Told to average ~110 characters, a model writes 60 characters of real thought and bolts on a stock
closing phrase — `and that is the whole mess i guess`, `for what that is worth right now`, `which is
on me honestly and for real`. It reads fine one capture at a time and is fatal in bulk: the same
filler tokens land in hundreds of captures, which inflates the measured similarity between unrelated
notes and shifts the pool's average document length. That artefact has already invalidated one round
of measurements on this branch.

The mean is a **description of a real distribution**, not a quota to hit per capture. Let short
thoughts be short. If your captures average 70 characters because that is how the person writes,
the corpus is better, not worse — and the gate that matters is the one below, not the mean.

Two checks enforce this and both are cheap to fail:

- **Recurring closing phrases** — captures sharing a trailing 4-gram with two or more others: **≤5%**.
  A padded corpus measures 33%; an honest one measures 0%.
- **Contentless tails** — captures whose last six words are all corpus-common: **≤5%**. Padded: 29%.
  Honest: 0.6%.

---

## 3. Structure of the story

**Scale.** Target is set per run — assume **~1,200 atoms** unless told otherwise, plus 20% noise on
top. Split across authoring agents (§6).

**Span.** 2023-01-01 → 2025-12-31. Captures appear in **ascending date order** within each file.
Real capture rhythm is bursty: 4 captures on a Tuesday, then nine days of nothing. Do not spread
them evenly. Some weeks have none.

**Threads.** 20–30 running threads, interleaved. A thread is a strand of the person's life, not a
topic label — `kitchen-renovation`, `dads-diagnosis`, `the-rewrite`, `running-again`,
`sarah-and-the-move`. Consecutive captures should almost never be from the same thread; the person's
day jumps. **At most 8% of captures may sit inside a run of three or more consecutive same-thread
captures** — a longer run means the file was written thread-by-thread rather than lived, and it
destroys the interleaving the whole corpus depends on. Write chronologically, not thread-first.

**Life shape.** Threads must start, run, go quiet, and resume — or end. At least four threads go
dark for **8+ months** and come back. At least two end and are never mentioned again. One or two
run the entire three years at low frequency. This is where long reach-back links come from, and
they are the hardest and most valuable links in the corpus.

**Reach-back distribution** for `linksToEarlier`, measured in days between the two captures:

| Span | Share of links |
|---|---|
| under 30 days | ~25% |
| 1–6 months | ~35% |
| 6–18 months | ~30% |
| over 18 months | ~10% |

Median around 100 days. A corpus of last-week links tests nothing — recency alone would win it.

---

## 4. The failure modes the story must contain

This is the core of the brief. Each of these is a distinct reason a real link is hard to find.
Hit every quota. Quotas are shares of your **linked pairs**, not of captures.

**A. Vocabulary drift — 20–35% of pairs, and this is the headline number.**
Banded, not floored: below 20% the corpus proves nothing keyword search cannot already do, and above
35% it is harder than any real vault, so every recall figure measured on it is a pessimistic fiction.
Do not manufacture the rate by making every second capture a two-word stub — that inflates the
number without adding a single realistic hard case.

The same referent, named differently months apart, with **zero shared content words** between the
two captures. Not synonyms — *renaming*. The new apartment becomes "the place on vine" becomes
"home" becomes "upstairs". A person is "sarah's brother", then "mike", then "he". A project is
"the rewrite", then "v2", then "the thing i've been on since spring". Write the drift into the
timeline: the name changes *because something happened*, not to be tricky.

**B. Deixis-only reference — ≥ 8%.**
A capture that refers back with a pronoun or a bare demonstrative and names nothing:
`she was right`, `same thing again`, `this keeps happening`. Meaningful to the person, invisible to
keyword search. Every one of these must have a real, declared earlier partner.

**C. Term collision / false friends — ≥ 10% of captures (not pairs).**
Two unrelated threads sharing vocabulary, so that a term match pulls the wrong one. `run` the
half-marathon vs `run` the migration. `the deposit` on the flat vs `the deposit` at the bank.
`mom's place` vs `the place on vine`. These captures must **not** be linked to each other — they
are the precision test. Getting them wrong should look wrong.

**D. Contradiction and revision — ≥ 10% of pairs.**
A later capture reverses, doubts, or complicates an earlier one. `turns out i was wrong about the
tuesdays thing`. The link is semantic, not additive — the two captures may share almost nothing
lexically because one is a claim and the other is its retraction. These are the links a naive
"more of the same topic" search misses entirely.

**E. Very short captures — ≥ 15% under 50 chars, and 40–75% of those carry a link.**
`he did it again`. `not the coffee`. `finally`. Almost no signal to retrieve on. If every short
capture is noise, the corpus is easy in a way real vaults are not — but if *every* short capture is
meaningful, that is just as fake, and it is what maxing this gate looks like. The band is two-sided
on purpose. Some short captures lead nowhere, because some short thoughts do.

**F. Hub-mediated vs orphan pairs — roughly half and half.**
Some linked pairs both mention a shared recurring name (a person, a place, a project) — these are
reachable by following the graph. The other half share **no** recurring name at all; the only route
to them is the words in the capture. Keep the split near 50/50. If everything is hub-mediated the
corpus overstates what graph expansion can do; if nothing is, it understates it.

**G. Genuine noise — 20% of captures, linking to nothing.**
`milk oat not almond`. `dentist moved to the 14th`. `pin is 4402`. `park on the odd side after 6`.
Real chores, real one-offs, real fragments with no thought in them. Both link arrays empty. Noise
must be genuinely unlinkable — not a thought in disguise. This is what measures false links.

**H. Near-duplicates that are not the same thought — ≥ 4% of captures, cross-thread and 90+ days
apart.** Two captures that look almost identical lexically but are about different things, and are
**not** linked. `bad night again` about sleep vs `bad night again` about the bar shift.

The qualifiers are the whole test. Two near-identical captures **in the same thread on adjacent
days** are not a precision test — they are the same person saying the same thing twice, and a system
that links them is *right*. Repeating yesterday's capture verbatim satisfies nothing and the gate
counts only pairs that are in **different threads** and at least **90 days apart**. Exact duplicate
capture text anywhere in the corpus is an automatic reject.

---

## 5. The story bible — write this first, before any captures

Before anyone writes a capture, one shared bible is authored and every agent works from it:

1. **Cast** — 10–20 recurring people, places and projects, each with the **exact title string** used
   in `linksToExisting`. Reuse the strings byte-for-byte; a hub that is spelled two ways is two hubs.
2. **Alias table** — for each cast member subject to drift (A above), the sequence of names and the
   approximate date each takes over. This is what makes drift consistent across threads and agents.
3. **Timeline skeleton** — the 20–30 threads, their start/quiet/resume/end dates, and which agent
   owns each.
4. **The collision list** — the shared-vocabulary pairs from C, and which two threads carry them.

The bible goes in `scripts/fixtures/chrono-corpus-bible.md` and is committed with the corpus.

---

## 6. Splitting across authoring agents

Each agent gets its own file and its own **id prefix** and owns a disjoint set of threads.

- Links (`linksToEarlier`) are **within your own file only** — you cannot see another agent's ids.
- Hubs (`linksToExisting`) are **shared** — that is what the bible is for, and it is how cross-file
  structure appears without cross-file ids.
- Ids ascend within a file. Dates ascend within a file.
- Every agent covers the full 2023–2025 span; do not divide the story by time period, or the corpus
  loses its interleaving.

Authoring is deliberately delegated to a **different model family** than the one that classifies.
If the same model writes and classifies, the vocabulary drift under test is artificially easy —
the classifier recognises its own phrasings. That is a methodological requirement, not a preference.

---

## 7. Acceptance gate

Run `node scripts/validate-corpus.mjs scripts/fixtures/chrono-corpus-*.json` before anything is
spent on the corpus. It checks the schema, the §2 length distribution, the §3 reach-back
distribution, and the §4 quotas including the zero-overlap rate, and it fails loudly.

A corpus that passes the schema but comes back at 200 chars in tidy complete sentences is
**rejected and re-briefed**, not patched. Validation is cheap; a paid pipeline run over a bad
corpus is not.

---

## 8. Schema

```json
{
  "id": "E0042",
  "date": "2024-03-17",
  "thread": "kitchen-renovation",
  "capture": "bought the wrong gauge wire ugh",
  "verdict": "atom",
  "linksToEarlier": ["E0018", "E0031"],
  "linksToExisting": ["Sarah", "The flat on Vine"]
}
```

| Field | Rule |
|---|---|
| `id` | your assigned prefix + 4 digits, ascending within the file |
| `date` | ISO, 2023-01-01 → 2025-12-31, **ascending** within the file |
| `thread` | kebab-case strand name from the bible |
| `capture` | the note, per §2. Never prefixed with "remember:" / "note:" / "TIL" |
| `verdict` | `"atom"` for a real thought worth keeping, `"noise"` for chores and one-offs. 20% noise |
| `linksToEarlier` | ids of **earlier** captures in **this file** that this one genuinely belongs with — a thought it continues, contradicts, or refers back to. Empty when there is nothing. **This is the answer key.** |
| `linksToExisting` | exact title strings from the bible's cast, for notes that existed before the run |
| — | `noise` captures link to nothing: both arrays empty |

A file is a JSON array of these objects.

---

## Appendix — what the previous corpus measured

Kept as the baseline the new one must match or beat. `scripts/fixtures/chrono-corpus-{a,b,c,d}.json`,
720 captures / 576 atoms / 811 links / 21 threads:

| | Value |
|---|---|
| Capture length mean / median | 113 / 113 chars |
| Over 200 chars | 18 of 720 (2.5%) |
| Noise | 20.0% |
| Link span median / p90 / max | 98 / 511 / 1,084 days |
| **Zero-shared-term linked pairs** | **190 of 811 (23.4%)** |

Its weakness was never the register — it was that it never went through the pipeline, so it has no
model-written titles, no tags, and no reason-bearing link prose. The new corpus fixes that by being
*processed*, which is why the authoring bar has to be at least this high going in.
