---
title: "Title collision cannot see the same capture under a new name"
date: 2026-08-20
category: logic-errors
module: write-path
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "A friend with both an Anthropic API key and Atoms Plus got two atoms from one daily capture"
  - "Desktop BYOK and phone Plus each filed yesterday's unmarked bullet before Sync delivered the marker"
  - "Re-Process after a lost marker minted a second file because the model picked a new title"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - write-path
  - filing-auth
  - auto-run
tags:
  - collision
  - plus
  - byok
  - multi-device
  - markers
  - integrity
  - process
---

# Title collision cannot see the same capture under a new name

## Problem

Having a personal API key **and** a Plus session looks like dual-engine filing. One Process does not call both engines: `resolveFilingAuth` prefers Plus while it can classify and uses the stored key only after Plus is exhausted. The duplicate is two independent filers.

Plus session, API key, and auto-run are all device-local. The usual setup is desktop still holding the key and phone signed into Plus. Both scan the same unmarked capture before Sync delivers the marker. Collision only keyed on **title**. The two classifies almost always pick different titles for the same verbatim body, so `planWrite` creates a second file.

## What didn't work

- Treating "both credentials" as a single-device dual-call. `classifyCapture` is Plus XOR BYOK.
- Relying on #66 title-path + body-gate. That gate only fires when the *new* title already exists. A renamed classify never hits it.
- Markers as the only idempotency key. They work once Sync converges; they cannot see an atom that already holds the capture under another name.

## Fix (0.8.14)

Identity is `(whitespace-normalized capture body + source daily)`. `findAtomForSameCapture` + `planWrite`'s optional `existingAtomIdentities` reuse the existing path and mark to that title. Write and backfill feed the run's corpus (and mid-run `addWrittenAtom` with `sourceDaily`). The same wording on a later day still creates a new atom.

Title-path collision still wins when the new title's path already exists — #66 body-gate is unchanged.

## Residual

Both devices can still write two files if neither the atom nor the marker has synced before the second `create`. This gate helps once either side's atom is visible. It does not merge already-minted duplicates.

## Prevention

- A capture's identity is the sacred body plus the daily it came from, not the model's title
- Device-local credentials mean two devices can both file; title-only collision cannot reconcile them
- Tests in `test/render.test.ts`, `test/collision-integrity-repro.test.ts`, `test/write.test.ts`

## See also

- Issue #586 / PR #587
- `docs/solutions/logic-errors/exhausted-plus-ignored-a-stored-key.md` — same credentials; key files only after Plus cannot
- `docs/solutions/logic-errors/collision-foreign-marker-integrity.md` — same title, foreign body
- `docs/qa/2026-07-15-feat-invisible-filing-autorun-world-class-qa.md` — multi-device auto-run race left untested
