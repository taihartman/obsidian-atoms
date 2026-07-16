# Adversarial review — Update notes (plan 015)

**Date:** 2026-07-16  
**Plan:** `docs/plans/2026-07-16-015-feat-atoms-quality-stamp-and-improve-plan.md`  
**Issue:** #29  
**Gate:** light headless + architecture re-align + this adversarial pass (LFG before ce-work)

## Product / integrity

| Attack | Risk | Mitigation in plan |
|---|---|---|
| Model returns `noise` → delete atom | High | R13 keep-as-atom |
| `planWrite` skip blocks refresh | High | R12 in-place modify only |
| Body rewritten by model | Critical | extract → classify(capture) → re-embed same capture |
| Hand-edited titles/reasons overwritten | Med | Confirm copy; future lock FM |
| Title rename breaks daily marker | Med | Marker repair + aliases fallback |
| Auto-refresh on phone open | High | R8 user-initiated only |
| Cost surprise | Med | Batch ≤15 + confirm N |
| Shortcut banner confusion | Low | Do not reuse `.atoms-home-update-banner` |

## Architecture

| Check | Result |
|---|---|
| Hybrid paths (`pipeline/` / `home/` / `plugin/` / `ui/`) | Aligned in plan |
| UI kit for strip/progress | Aligned |
| Dependency rule (pipeline ↛ home/ui) | Aligned |
| Third write type documented | Architecture amend in U1/U5 |

## Verdict

**Approved for implementation** with defaults: batch 15, Modal confirm, `CURRENT_ATOMS_QUALITY = 2`, no review-sheet UI.

No critical blockers. Proceed U1→U5.
