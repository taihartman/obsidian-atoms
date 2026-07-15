---
title: "Multi-cue resurface stream (on-this-day, connected, quiet)"
date: 2026-07-15
category: architecture-patterns
module: resurface
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Building recall after dump + file"
  - "Avoiding Anki-style review queues"
tags:
  - resurface
  - recall
  - psychology
  - stream
---

# Multi-cue resurface stream

## Context

A second brain that only files never rehearses. Psychology: cue-dependent recall, retrieval practice, spacing. Product allergy: review queues and badge guilt.

## Guidance

Priority cues on one home card:

1. **On this day** — same MM-DD, not today  
2. **Connected** — shares link chips with a small set of recent seeds  
3. **Quiet** — aged mtime / spacing  

Body snippet primary. Soft throttle after show. Keep seed set thin so connected can fire.

## Why This Matters

Completes Capture → File → Resurface without becoming a task app for notes.

## When to Apply

When expanding Beyond pure library + search.

## Related

- `docs/plans/2026-07-15-009-feat-full-brain-recall-stream-plan.md`
- Spec amendments: stream vs queue / epistemic rot
