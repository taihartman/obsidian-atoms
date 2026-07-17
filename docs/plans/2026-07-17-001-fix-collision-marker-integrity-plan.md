---
title: "fix: collision body-gate + Process failure surfacing"
date: 2026-07-17
issue: 66
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
version: 0.6.13
---

# Fix: collision body-gate + Process failure surfacing

## Problem

1. `skip_existing_atom` appends `↳ [[existing title]]` under a capture even when the existing atom body is a **different** capture → permanent wrong markers.
2. Classify failures only increment `failed`; reason/snippet discarded.

Investigation: `docs/qa/2026-07-16-process-marker-integrity-investigation.md`.

## Settled decisions (session)

| Decision | Provenance | Rejected | Why |
|---|---|---|---|
| Body-gated collision: mismatch → no marker, leave unprocessed | user-approved | Always mark on title collision | Trust > silent “done” |
| Body match → keep protect (marker only, no overwrite) | user-approved | Overwrite atom on collision | Body sacred / security |
| Surface classify failures (snippet + reason) in report + Notice | user-approved | Count-only `N failed` | Production debuggability |
| No unattended Remote Vault marker rewrite in this PR | user-directed | Auto-repair personal dailies | Agent vault lanes |
| Repair command = follow-up | user-approved | Bundle repair UI now | Minimal integrity ship |

## Scope

**In**

- Gate collision marker on body match (Process write path + backfill apply + race in `applyWrite`)
- `WritePathReport.failures[]` with reason/message/snippet
- Notice/home summary includes failure detail when present
- Tests + version **0.6.13**

**Out**

- Marker repair command
- Prompt-only title hardening as sole fix
- Auto-run UX change beyond shared write path behavior

## Implementation units

### U1 — Pure body match helpers

- Files: `src/pipeline/render.ts` (or small pure export), reuse `extractCaptureBody` from `src/pipeline/refreshAtoms.ts`
- `normalizeCaptureText` / `captureTextsMatch`
- Tests: `test/collision-integrity-repro.test.ts` (invert to regression) + unit cases for whitespace normalize

### U2 — Write path gate + failures

- Files: `src/pipeline/write.ts`, `src/pipeline/backfill.ts`, `src/pipeline/render.ts` (`applyWrite` race)
- On `skip_existing_atom`: read atom, body mismatch → `failed++`, push failure `collision_mismatch`, **skip** `applyWrite`
- On `create_atom` race (file already exists): same body check before marker
- Classify `!ok` → push failure with `outcome.reason` / `message`

### U3 — UX surface

- Files: `src/plugin/main.ts`, `src/home/runProgress.ts` if needed
- Notice: keep counts; if `failures.length`, append first failure reason + snippet
- `devLog` include failures array

### U4 — Version

- `package.json`, `manifest.json`, `versions.json` → 0.6.13

## Test scenarios

1. Collision + body mismatch → no marker; capture stays unprocessed semantics (insert not called / content unchanged)
2. Collision + body match → marker appended; atom not overwritten
3. Classify fail → `failures` entry with reason; `failed` count
4. Race create → existing different body → no foreign marker

## Risks

- Legitimate near-duplicate titles with different wording: mismatch leaves both unprocessed until novel title — correct for integrity
- Whitespace-only differences: normalize collapses whitespace

## Execution note

Test-first on U1/U2. Demo/test vault only for vault smoke if any.
