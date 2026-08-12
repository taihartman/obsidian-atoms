---
module: ask-outbox
date: 2026-08-12
problem_type: logic-error
tags: [outbox, open-loops, set_loop, payload, kind]
---

# Outbox apply must forward the full payload and recognize every write kind

## Problem

Open loops shipped `open_loop` on create and `relation`/`close_answer` on continue, but vault apply never saw them. `runAskOutboxApply` rebuilt a narrow `{ title, body, tags?, links? }` object. Separately, store `outboxEnqueue` collapsed unknown kinds to `create`, so a new kind like `set_loop` would land as create unless every store path was widened.

## Root cause

Two strip points:

1. **Plugin apply** treated the payload as create-shaped only and dropped fields it did not need for the original write path.
2. **Server enqueue** used a two-way ternary (`continue` vs `create`) that silently rewrote any new kind.

## Fix

- Pass the pulled payload through (kind-aware validation: create/continue need body; `set_loop` needs state).
- Branch apply on `item.kind`; `set_loop` uses FM-only modify via `applyOpenLoopFm`.
- Enqueue kind allowlist includes `set_loop` in memory, sqlite, and postgres.

## Prevention

When adding an outbox field or kind, add a regression that fails if apply receives a stripped object or if pull returns `kind: "create"` for a non-create enqueue. Do not rebuild allowlists by omitting optional keys.

## Related

- #461 open loops
- #467 set_loop
