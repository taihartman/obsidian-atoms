---
title: "The filing engine is not the Plus account"
date: 2026-08-21
category: logic-errors
module: src/platform/filingAuth.ts
problem_type: logic_error
component: plugin
symptoms:
  - "Spent-meter Plus still showed Uses your Anthropic API key on Update notes"
  - "Confirming Update notes billed a leftover BYOK key and wrote the heard key"
  - "Settings Account stayed Plus while the spend confirm named the key"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - update-notes
  - plus
  - byok
  - filing-auth
---

# The filing engine is not the Plus account

## Problem

`resolveFilingAuth` answers "what will classify this capture." Exhausted Plus falls through to a stored Anthropic key so Process can keep working. Update notes confirm copy answers "who is paying." Those are different questions. Feeding the engine resolver into the spend confirm made a leftover key look like BYOK, then spent it, then silenced Home for the quality.

## Symptoms

- A Plus subscriber with a leftover device key never sees the spent-meter sentence.
- Confirm says `Uses your Anthropic API key`, Update runs, `updated > 0` writes `atoms-update-notes-dismissed-q`.
- Settings Account still shows Plus. The mismatch is the leftover-key install base, not an edge case.

## What Didn't Work

- **Reuse `resolveFilingAuth` at the confirm.** That helper is load-bearing for Process fallback. Changing it would stop Process when the meter is spent.
- **Fix only the copy.** Showing spent-meter Plus then classifying with the key is a worse lie.

## Solution

Project Plus identity with the key stripped (`projectPlusIdentityAuth`). If a Plus session still exists, Update notes confirm and `requireClassifyAuth` for that run use that view. Process keeps `resolveFilingAuth`. Settings Account already did this via `deriveAccountState`; it now shares the helper.

A leftover key on exhausted Plus stays `plus_exhausted`: confirm names filings used up, classify refuses, heard key is not written.

## Prevention

- Spend-confirm billing must not call the filing-engine resolver.
- Tests that pass `billing: "plus_exhausted"` as a literal never catch the leftover-key cascade. Drive `projectPlusIdentityAuth({ byokApiKey, exhaustedSession })` through `filingPathFromAuth`.
- Do not "fix" Process to match Update notes. Engine fallback is intentional.

## Related

- `docs/solutions/features/update-notes-quality-stamp.md`
- Plan R4 / F6 / AE9 in `docs/plans/2026-08-21-002-feat-update-notes-once-settings-plan.md`
- Constitution: Plus absorbs complexity (#540 shape)
