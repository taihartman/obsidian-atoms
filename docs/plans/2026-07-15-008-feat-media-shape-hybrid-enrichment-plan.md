---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: Media dump shape — prompt + structural tags + local repair"
date: 2026-07-15
type: feat
lane: amend
---

# feat: Media dump shape — hybrid enrichment

## Goal Capsule

When a capture is clearly media/watchlist (e.g. “Christian told me to watch My Hero Academia”), file it as an **atom** with **media tags** (`watch`/`show`/…) and a **work-title link**, not only `#preferences`. Hybrid: model judgment + deterministic post-classify repair (same philosophy as person hubs).

## Product decisions (session)

| Decision | Choice |
|---|---|
| Architecture | Hybrid: prompt + local high-precision repair |
| Not | Pure prompt-only, or full Shows app / collections UI |
| Tags | Media tags are **structural** (always eligible, even if Active list is old) |
| Links | Prefer vault title match for the work; else link the extracted work title (may be unresolved) |
| Verdict/title | Repair never changes verdict or title (person repair rule) |

## Implementation Units

### U1. Structural media tags + prompt
- `vocabulary.ts`: add `watch`, `movie`, `show`, `media`, `list` to `STRUCTURAL_TAGS`
- `classify.ts` SYSTEM_PROMPT: media dumps get media tags + work link + person when “X told me”
- Tests: structural eligibility includes media tags

### U2. `enrichMediaLinks` pure repair
- Create `src/media.ts`: detect watch/show/movie patterns; extract work title; ensure tags + link
- Prefer case-insensitive match against vault note titles when provided
- Atom-only; no-op when no media shape
- Wire after `enrichPersonLinks` in `classify.ts`, fixture path in `write.ts`, `backfill.ts`
- Tests: MHA-style capture gets `watch`/`show` + work link; pure preference unchanged

### U3. Version 0.4.4 + install path note
- package/manifest/versions; architecture one-liner
- Install to Remote Vault for phone try

## Verification
Unit tests green; manual: reprocess “watch my hero academia” after removing old marker → media tags + work link.
