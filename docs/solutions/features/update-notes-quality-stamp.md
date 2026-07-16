---
module: pipeline/refreshAtoms
tags: [update-notes, quality-stamp, process-parity]
problem_type: feature
date: 2026-07-16
---

# Update notes — quality stamp + Process parity refresh

## Problem

After classify quality improved (0.6.6), existing atoms kept weak titles/reasons forever. Users expected old notes to catch up when the algorithm changed.

## Solution

1. Stamp every new Process atom with `atoms-quality` + `quality-updated` (`CURRENT_ATOMS_QUALITY = 2`).
2. **Update notes**: list eligible (`generated-by: linker` and quality missing/`< CURRENT`), run same `classifyCapture` path, rewrite model surfaces in place (body sacred), optional rename + marker repair.
3. Home strip (flatCard kit) → Modal confirm → progress via shared runPhase `"update"`. Never auto-run.

## Key files

- `src/pipeline/atomQuality.ts`
- `src/pipeline/refreshAtoms.ts`
- `src/home/atomsHomeView.ts` (strip + confirm)
- `src/plugin/main.ts` (`runUpdateNotes`)

## Gotchas

- Do not use `planWrite` create/skip for refresh (R12).
- Force keep-as-atom if model returns noise/task (R13).
- Do not reuse `.atoms-home-update-banner` (shortcut CTA).
