---
title: "Give the cross-model peer a brief, not a diff — the budget is spent on exploration, not reasoning"
date: 2026-08-06
category: workflow-issues
module: workflow/ce-code-review
problem_type: workflow_issue
component: tooling
applies_when: "Dispatching the ce-code-review cross-model adversarial peer (grok), or any buffered non-streaming reviewer with a turn cap, against a non-trivial diff."
resolution_type: process_change
severity: medium
tags:
  - ce-code-review
  - cross-model-review
  - grok
  - adversarial-review
  - prompt-scoping
  - token-budget
---

# Give the cross-model peer a brief, not a diff

## Context

The `ce-code-review` cross-model peer runs with `--json-schema`, which forces **buffered**
(non-streaming) output: the model reads for N turns and emits its whole result in one final step. A
run that dies before that step yields literally nothing — an empty `"text": ""`, not truncated prose
— and costs the same as one that succeeds. It is also the only route with no idle guard, precisely
because there is no stream to watch.

A prior run on this repo burned its entire turn budget exploring the diff and returned an empty
artifact. The obvious inference was "the diff was too big, and the turn cap too low," and the turn cap
was duly raised. That inference was only half right, and the wrong half is the useful learning.

## Guidance

**Spend your effort on the brief, not on the budget.** The peer's turns are consumed by *finding out
what the change is*. A brief that tells it where the risk lives converts exploration turns into
reasoning turns, which is the only thing you were paying for.

Concretely, the brief that worked was ~4KB against a ~119KB diff, and had this shape:

```
# Adversarial brief — <feature> (<issues>)

## Intent
  What the change is, in one paragraph, plus one sentence on what it protects
  (here: "the consent gates real money and real egress").

## Material risk divisions
  Three to five numbered divisions. Each names:
    - the specific files/symbols that carry that risk
    - the attack framing to apply ("attack this as a migration")
    - concrete questions ("does anything still read the raw key and compare it to `true`?")
    - prior repo learnings that rhyme, by path

## Cross-division interaction to test
  The one coupling between divisions that neither division catches alone.
```

Note what the size numbers say: the run that **failed** had a smaller diff than the run that
**succeeded**. Diff size is not the lever. The lever is whether the peer has to discover the shape of
the change before it can attack it.

Two more rules that follow:

- **Naming a risk as "known and accepted" in the brief does not cap the verdict.** Division 2 of this
  brief described the notice/withdraw hole as a known accepted edge. The peer escalated it to P1 at
  confidence 100 anyway, and it was right — that became the blocking fix. A brief directs attention;
  it does not pre-decide severity, so you can safely point the peer at things you think are settled.
- **One strike, then change route.** If a run still returns nothing after a real brief, the schema is
  the problem, not the budget — no amount of turns fixes a structured-output failure. Do not pay a
  third time to confirm it.

## Why This Matters

Every other reviewer route streams, so a run that dies leaves partial output you can salvage. This one
does not. Its failure mode is binary and silent: full price, zero product, and — worse — the review
*appears* to have covered the adversarial lens, because the dispatcher recorded a job id. The lost
coverage is invisible unless you check the artifact.

Raising the turn cap treats the symptom. It buys more exploration, which is the thing that was never
worth buying, and it moves the failure from the turn cap to the wall-clock cap where it costs more to
discover. The brief is the only intervention that changes the ratio of reasoning to reading.

## When to Apply

Write the brief whenever the diff spans more than two or three files, or whenever the change's *risk*
is not legible from the diff alone (a storage-format migration, a permission gate, an ordering
change). Skip it for a single-file mechanical change where the diff is self-explanatory.

The brief costs a few minutes of the orchestrator's context. That is cheap next to a run that returns
nothing, and cheap next to a review that silently ships without its independent lens.

## Examples

The payoff, from the run this doc came out of: two findings returned in roughly four minutes, both
real, both actionable, and both mapping cleanly onto divisions the brief had named —

| Finding | Division it came from | Outcome |
|---|---|---|
| Stale ack hides the withdraw row while the notice still permits filing (P1, confidence 100) | 2 — "whether the gate actually closed everywhere" | Fixed before merge; became a solution doc of its own |
| The freeze map can be edited in place, keeping an old stamp current (P2, confidence 75) | 4 — "the drift guard's own fidelity" | Accepted as residual risk; documented |

Both were escalations of things the brief had listed as understood. That is the brief working as
intended: it bought the peer enough orientation to argue with the premises.

## See also

- `docs/solutions/logic-errors/narrowing-one-grant-removed-the-only-way-to-revoke-the-other.md` — the
  P1 above, written up as its own learning.
- `docs/solutions/best-practices/a-golden-value-in-the-same-file-is-defended-only-by-a-comment.md` —
  the P2 above.
- `.compound-engineering/config.local.yaml` — `cross_model_peer: grok` is the file the skill actually
  reads to pick the route; it is machine-specific and gitignored.
