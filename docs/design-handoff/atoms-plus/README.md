# Atoms Plus — UI mocks (pre-impl)

**Status:** draft mock v2 (minimal) for U5 review · **not implemented**  
**Open:** `index.html`

## Product (locked)

- $5/mo or $50/yr · Sonnet 5 · **150** processes/mo (server-side) · top-up **+50 / $2**
- Free BYOK forever · never push BYOK on exhaust
- Preview costs when classify runs · cache free re-open
- 14-day trial + card · magic link · capped promos

## UI direction (v2)

- **No ambient counters** (no 118/150, no progress bars) on home or Settings while active
- **Numbers only on buy / top-up / trial** sheets
- **Why it costs:** model usage costs us money; Plus helps cover it and support Atoms
- **Free path always named:** own Anthropic key, full product forever
- Limit UI only when plan is full (soft “paused”), not as daily chrome

## States to approve

| # | Surface | State | Primary job |
|---|---------|--------|-------------|
| H1 | Home wait | **none** | Plus or own key (quiet) |
| H2 | Home wait | **plan full** | Pause copy + add more (no numbers) |
| S1 | Settings | **out** | Why Plus + free path → See plans |
| Buy | Sheet | **purchase** | Price, 150/mo, cost reason, free path, trial |
| S2 | Settings | **on** | Status on · email · renews (no meter) |
| S3 | Settings | **full** | Paused + top-up sheet (+50/$2) |

## Gate

1. Review mock  
2. Note copy / hierarchy changes  
3. Only then implement `atomsHomeData` + `settings` chrome  

## Plan

`docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` · U5
