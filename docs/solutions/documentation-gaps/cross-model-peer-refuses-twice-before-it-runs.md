---
title: "The cross-model peer refuses twice before it runs, and both refusals look like success"
date: 2026-08-05
category: documentation-gaps
module: tooling
problem_type: documentation_gap
component: ce-code-review
severity: medium
applies_when:
  - "Running ce-code-review's independent adversarial pass on a large diff"
  - "A cross-model or peer-review step reports no findings and you cannot tell whether it ran"
  - "Wiring any non-blocking helper script whose failure path exits 0"
tags:
  - code-review
  - cross-model
  - grok
  - tooling
  - silent-skip
---

# The cross-model peer refuses twice before it runs, and both refusals look like success

## Context

`ce-code-review` satisfies its adversarial lens with an independent cross-model
peer — on this machine, grok. The standing guidance already records that this
route has repeatedly cost real money and returned nothing, and that the fix is to
give the peer less to read.

Running it against the settings row-grammar branch
([#304](https://github.com/taihartman/obsidian-atoms/issues/304), 30 files)
surfaced why it so often produces nothing: **the script refuses to dispatch until
two preconditions are met, neither is documented in the skill's prose, and both
refusals exit 0.** The invocation looks like it worked. The review continues. The
adversarial lens is silently uncovered.

Once both were satisfied it ran for about 430 seconds and returned four real
findings, including a **P1 that all three local reviewers missed** — a consent
race where an enable path's in-flight save could resurrect an acknowledgment the
user had just withdrawn. The route is worth getting running; it just will not
tell you why it is not.

## Guidance

**Both preconditions are enforced in the `ce-code-review` skill bundle's
`cross-model-adversarial-review.sh`** — a plugin file, not a path in this repo;
resolve it under the installed compound-engineering plugin directory. **It is
non-blocking by design: every failure logs to stderr and exits 0 without writing
an output file.** The caller detects success purely by the presence of
`<run-dir>/adversarial-<provider>.json`. If you do not check for that file, you
cannot distinguish "ran and found nothing" from "never ran".

**1. A large diff requires an orchestrator-written review map.** The script skips
with `large diff requires a compact orchestrator review map; skipping peer
dispatch` unless `<run-dir>/adversarial-review-brief.md` already exists. This is
the "give the peer less to read" lever made mandatory — the brief is a compact
semantic map of where the risk is, written by the orchestrator, **not** a copy of
the diff.

**2. A fixed route must be resolved before egress.** Even with the brief, the
script skips with `host must resolve one fixed route before egress` unless
`CROSS_MODEL_FIXED_ROUTE` is set. A candidate list is not a resolved route:
passing `grok` as the candidates argument is insufficient, because `grok` names a
provider while the route names the transport (`grok-cli` vs `grok-cursor`).

The invocation that actually dispatches:

```bash
PEER_MAX_TURNS=40 CROSS_MODEL_FIXED_ROUTE=grok-cli \
  bash "$SKILL_DIR/scripts/cross-model-adversarial-review.sh" \
  claude grok <merge-base-sha> "$RUN_DIR"
```

`PEER_MAX_TURNS=40` matters separately and is already recorded in standing
guidance: the script's own default is 15, low enough that a multi-file diff
spends every turn reading. The script does self-escalate to 40 for a large diff
via `CROSS_MODEL_LARGE_DIFF_MAX_TURNS`, but setting it explicitly costs nothing.

**Write the brief to name the surfaces that matter and to rule things out.** The
brief for this run listed four risk areas in priority order, and — as valuable —
a section headed *"Deliberate decisions — do NOT report these"* naming the
duplicated consent sheets, the `void`-returning row builders, and the
`const _exhaustive: never` switches. Without that section the peer spends its
budget rediscovering settled decisions and reporting them as findings.

## Why This Matters

Both guards are *correct*. They exist to prevent exactly the failure the standing
guidance documents: paying for a run that reads a 57KB diff for fifteen turns and
returns an empty result. Fail-closed is the right design.

The gap is that a fail-closed guard which exits 0 is indistinguishable from
success at the call site, and the preconditions it enforces appear nowhere in the
skill's instructions. The skill's Stage 3d does say to write the brief and
resolve a route — but as prose about attestation and sanctioning, not as "these
two things are hard preconditions and the script will silently no-op without
them." An agent following the prose reasonably believes it has dispatched a peer.

The cost of the gap is not the wasted invocation; it is the **false coverage
claim**. The review's Coverage section will report an adversarial lens that never
ran, and the findings that lens would have caught — here, a P1 consent race —
ship.

## When to Apply

- Before trusting any `ce-code-review` run that claims cross-model coverage:
  **check that `<run-dir>/adversarial-<provider>.json` exists.** Its absence is
  the only reliable signal, because the script exits 0 either way.
- When the log says `skipping`, read *which* skip. `large diff requires a compact
  orchestrator review map` and `host must resolve one fixed route before egress`
  are both fixable in one step; `not an eligible reachable candidate` is a
  different problem (allowlist or availability).
- More generally: **when wiring a non-blocking helper whose failure path exits 0,
  the caller must assert on the artifact, never on the exit status.** That is the
  same shape as
  [a-signal-nobody-receives-is-not-a-signal](../architecture-patterns/a-signal-nobody-receives-is-not-a-signal.md).
- Note the egress: the peer sends the reviewed diff to an external provider. This
  repo is public, and the route is the user's standing configuration in
  `.compound-engineering/config.local.yaml` (`cross_model_peer: grok`, gitignored
  and machine-specific), but the send is real and should be disclosed when it
  happens.

## Examples

The two silent refusals, verbatim, both from invocations that exited 0:

```
[cross-model] reachable cross-model candidates for adversarial: grok (host claude excluded)
[cross-model] large diff requires a compact orchestrator review map; skipping peer dispatch
```

```
[cross-model] large diff routed through orchestrator review map: files=30 estimated_tokens=161828
[cross-model] host must resolve one fixed route before egress; skipping
```

And the dispatch, once both preconditions were satisfied:

```
[cross-model] peer run: provider=grok route=grok-cli model=grok-4.5 (effort high)
              lens=adversarial read-only in-tree (idle 480s / hard 1200s; grok-cli hard-only 600s)
[cross-model] peer alive (60s elapsed)
...
[cross-model] wrote 4 finding(s) to .../adversarial-grok.json (reviewer adversarial-grok)
```
