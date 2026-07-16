---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: Person hub miss explain + phone-frame README screenshots"
date: 2026-07-16
---

# feat: Person hub miss explain + phone-frame README screenshots

## Goal Capsule

Close the two Apple polish gaps from world-class QA on PR #17:

1. **Explain** when a person-shaped atom has **no person hub matched** (dry-run card + preview/process Notice).
2. **Phone-frame** tutorial screenshots for the README (replace desktop chrome frames).

Bump **0.6.4**. Land on same branch / update PR #17 when possible.

## Settled decisions

| Decision | Provenance | Rejected | Why |
|---|---|---|---|
| Surface “no person hub matched” on person-shaped atoms with no hub link | user-directed | Silent file-only | Apple explainability (QA P1) |
| Message in dry-run **card + Notice** and process **Notice** | user-approved | Settings-only | Decision points are Preview/Process |
| Pure helper on result after enrich | user-approved | Guess names without hubs list | Same gates as repair |
| Phone-frame README screenshots (375-class) | user-directed | Keep desktop full-window shots | Apple “show the product” (QA P2) |
| Synthetic dogfood only | user-directed | Personal vault | Privacy |

## Implementation Units

### U1. Person hub miss signal

**Files:** `src/people.ts`, `test/people.test.ts`, `src/preview.ts`, `src/write.ts`, `src/main.ts`, `src/runProgress.ts` (if needed), `test/preview.test.ts` as needed

**Approach:**

- Export `isPersonShapedCapture(capture, result)` and `personHubMissAfterEnrich(capture, result, hubs)` — true when atom + person-shaped + no link targets any hub canonical title.
- `buildPreviewEntry` takes optional hubs; sets `personHubMiss: boolean` and optional short `personHubNote`.
- Preview card: muted line “No person hub matched” when true.
- Markdown preview: same line.
- `showDryRunNotice` / process Notice: append `· N no person hub` when N>0.
- Write path: count after enrich; include on report aggregate.

**Tests:** person-shaped no hubs → miss; with hub link → not miss; noise/task → not miss; repair inject → not miss.

### U2. Phone-frame README screenshots

**Files:** `docs/media/readme/*.png`, `README.md` if captions need tweak, version bump

**Approach:**

- Prefer compositing design-handoff phone mocks + cropped Atoms home from demo vault into 375-wide phone chrome, **or** open design HTML in Chrome at phone size and capture states; for daily/settings use narrow window crop or mock-aligned frames.
- Keep synthetic dogfood labels (Jordan/Riley).
- Replace all seven tutorial images (or document if a subset is mock-backed).

**Verification:** images ≤ ~phone aspect; README paths unchanged.

### U3. Version 0.6.4

manifest + package + versions.json.

## Definition of Done

- Miss signal unit-tested and wired to dry-run + process Notice
- README images phone-framed
- tests green, PR updated

## Out of scope

- Auto-create hubs
- Changing discovery scores
- Phone Sync install
