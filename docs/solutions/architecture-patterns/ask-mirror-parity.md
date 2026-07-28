---
title: "Ask mirror parity — hybrid C vault events + hash evidence + Sync now"
date: 2026-07-27
category: architecture-patterns
module: ask-mirror
problem_type: architecture_pattern
component: plus-service
severity: high
applies_when:
  - "Changing Ask mirror push, delete, reconcile, or vault watchers"
  - "Touching askMirrorHashes, Sync now, or wipe"
  - "Adding multi-device or offline catch-up for Claude’s copy"
tags:
  - ask
  - mirror
  - reconcile
  - device-local
  - multi-device
  - hybrid-c
---

# Ask mirror parity — hybrid C

## Context

Claude’s Ask tools read a **cloud copy** of `Atoms/`, not the vault live. After read + write/outbox shipped, hand-edits/deletes/renames in the vault left ghosts or stale bodies until a manual full push. A naive “always full remote inventory delete on every sync” is unsafe on a second device with an incomplete vault. A pure “events only” path misses drops with no self-heal.

## Guidance

1. **Vault is SSOT.** Mirror is vault→cloud only. Never reverse-sync body. No CRDT, no conflict UI, no MCP delete-atom as the primary delete path.
2. **Hybrid C (three legs):**
   - **Events** — create/modify/delete/rename on flat `Atoms/*.md`, debounce ~2s, single-flight mutex.
   - **Delta** — upsert dirty + delete only paths in **this device’s hash evidence** missing from vault.
   - **Force / Sync now** — full `keepPaths` reconcile (orphans this device never hashed). Empty keep set requires `confirmEmpty: true`.
3. **Hash evidence is device-local** (`loadLocalStorage` / `saveLocalStorage`), not synced `data.json`. Prevents Obsidian Sync from copying another device’s “I never saw path P” map and wiping P from the cloud.
4. **No mirror poll interval.** Layout-ready delta + events + Process/Update/outbox cover the happy path. Missed events heal via Sync now. Connectivity-restore catch-up is **P1**, not silent scope creep.
5. **Server allowlist** hardcodes flat `Atoms/*.md` (`assertMirrorPath`) on upsert/delete/reconcile. Never take atom folder from the request body.
6. **Auth:** `sess_` mutates mirror and applies outbox; `mcp_` read + enqueue only. Wipe may run on valid `sess_` even when not entitled (exit path).
7. **Commit hashes after each successful HTTP sub-step**; on failure leave prior map + stamp error; one Notice/session pointing at Sync now.
8. **Status honesty:** “Claude sees N” = last **server** status count, not local vault file count.
9. **Chunking:** upsert/delete max 100; reconcile ≤500 one-shot or accumulate by `reconcileSessionId` then delete against the **union** on `done: true`.

```text
vault event / layout-ready / Process
  → syncAskMirror(force:false)
      upsert dirty → delete hash-orphans → stamp

Sync now
  → syncAskMirror(force:true)
      upsert dirty → reconcile keepPaths → rebuild evidence → stamp
```

Code: `src/platform/askMirror.ts`, `src/plugin/main.ts` (`syncAskMirror`), `plus-service` mirror HTTP + store. Constitution pointer: `docs/architecture.md` § Ask mirror sync; vocabulary: `CONCEPTS.md`.

## Why This Matters

Without the delta/force split, multi-device users lose cloud atoms that still exist on another phone. Without device-local evidence, Sync copies the wrong prune map. Without allowlist + sess_/mcp_ split, the mirror becomes a full-vault exfil or write path for connector tokens. Agents that only read the old “push after Process” code will reintroduce early-return-on-empty and ghost rows.

## When to Apply

- Any change to Ask mirror sync, wipe, status line, or vault watchers
- New “make Claude’s copy smarter” features (interval, websocket, hash-on-wire)
- Multi-device or offline catch-up work

Do **not** invent bidirectional body sync, desktop-only watchers, or full-vault/dailies mirror without a constitution PR.

## Related

- Plans: `docs/plans/2026-07-27-004-arch-ask-mirror-sync.md`, `005-feat-ask-mirror-parity-plan.md`
- Security: `docs/qa/2026-07-27-ask-mirror-sync-security-review.md`
- Dogfood: `docs/qa/2026-07-27-ask-mirror-parity-dogfood.md`
