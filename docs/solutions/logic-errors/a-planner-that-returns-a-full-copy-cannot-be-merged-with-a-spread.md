---
module: platform/askMirror
tags: [ask-mirror, sync, convergence, test-doubles, idempotence]
problem_type: logic-error
date: 2026-08-09
issue: 397
---

# A planner that returns a full copy of your map cannot be merged with a spread

## The problem

Two planners run in one Ask mirror pass — one over `Atoms/*.md`, one over the hub notes those atoms
link to. Each returns the payloads it wants to upload and the hash map to persist afterwards. The
merge looked obviously right:

```ts
const upsertNext = { ...atomNext, ...hubNext };
```

It was not. `planAskMirrorUpsert` returns **a full copy of the map it was seeded with**, not the
entries it freshened (`askMirror.ts:378` — `const nextHashes = { ...lastHashes }`). Both planners
are seeded from the same snapshot on a non-force pass, so `hubNext` carries a stale copy of every
*atom* entry. Spreading it last overwrote the atom planner's freshened hashes with the pre-edit
values.

The result: an edited atom uploaded, its **old** hash was persisted, the next pass found it dirty
again and uploaded it again — forever, on every debounced and background pass. Nothing failed. The
UI reported a healthy "last pushed" either way. The cost was bandwidth, Plus request volume, and
Anthropic spend, since each re-upload re-fires the expand path. It shipped in #225 and ran for eight
days.

## The generalizable shape

**When a function hands you back a whole map rather than a delta, `{ ...a, ...b }` does not merge
the two results — it lets whichever one you spread last win with data it never touched.** The
symptom is not a crash but *non-convergence*: a system that keeps doing work it already did.

Reach for the delta. If you cannot get one, reconstruct it from something the callee already tells
you it acted on.

## Why the two obvious fixes are both wrong

Worth recording, because the issue proposed both:

- **Reverse the spread** to `{ ...hubNext, ...atomNext }` — symmetric. `atomNext` carries stale
  *hub* entries in exactly the same way, so freshened hub hashes get clobbered instead. The bug
  moves; it does not die.
- **Seed the hub planner from `{}`** — breaks the skip check at `askMirror.ts:394`, so every hub
  looks dirty on every pass and re-uploads forever. Non-convergence again, relocated to hubs.

Changing the planner's contract to return a delta was also rejected: direct unit tests feed
`first.nextHashes` back in and rely on it being a full map, so that widens the blast radius for a
bug whose home is the merge site.

## The fix

Apply only what each planner actually freshened, using **its payload list as the authority** for
which paths those are:

```ts
const upsertNext = { ...hashesForUpsert };
for (const p of atomPayloads) { const h = atomNext[p.path]; if (h) upsertNext[p.path] = h; }
for (const p of hubPayloads)  { const h = hubNext[p.path];  if (h) upsertNext[p.path] = h; }
```

This is only sound because the planner writes `nextHashes[f.path]` and pushes the payload in the
same loop iteration, after the same guards — payload list and freshened set are the same set by
construction. **Check that property before reusing this pattern**; if a callee can freshen without
emitting, this fix silently drops updates.

Seeding from `hashesForUpsert` rather than `{}` is load-bearing in the other direction: under
`force` that seed *is* `{}`, which keeps the force path's map delta-only, which the orphan sweep
depends on (`askMirror.ts:1318`, "upsertNext has all when force").

## Why the suite missed it for eight days

This is the part worth carrying to other work. There were tests over this exact function, and they
passed, because **the fake host resolved zero hubs** (`test/askMirror.test.ts:417` returns `[]`).
With no hubs, `hubNext` was an empty planner result and there was nothing to clobber with. The test
double under-populated the very field the bug lived in, so the suite was exercising a shape the
product never has.

A test double that returns "nothing" for a collaborator is not a neutral choice — it deletes a whole
class of interaction from the suite. When a bug turns out to live in how two producers combine, look
first at whether the harness ever ran with **both** producing.

## Guardrails now in place

- A reproduction test seeded through the product loop, **mutation-checked** against the pre-fix
  source (`expected '8625c4c9' not to be '8625c4c9'` — the hash never moving, which is the bug in
  one line).
- Two fences that passed before the fix and exist to stop the wrong fixes landing later: hub-edit
  convergence (kills the reversed spread) and a force-path delta-only assertion (kills the `{}`
  seed).
- A new fake host in that block that resolves a **real hub**, so the clobbering map is populated.
- Live proof with a pre-fix control on the same vault, plus a 13-scenario adversarial pass:
  `docs/qa/2026-08-09-397-hub-hash-clobber-world-class-qa.md`.

## Related

- `docs/solutions/architecture-patterns/a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md`
  — the same family: the harness, not the assertion, is what was wrong.
- `docs/solutions/architecture-patterns/ask-mirror-parity.md` — mirror shape and invariants.
