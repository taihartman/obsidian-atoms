# Atoms Plus — UI mocks (pre-impl)

**Status:** draft mock **v3** (Apple language + minimal) · **not implemented**  
**Open:** `index.html`

## Pricing SSOT

**Change prices only in** repo-root [`plus-pricing.json`](../../../plus-pricing.json).  
Plugin UI formats from that file via `src/shared/plusPricing.ts`.  
`plus-service` loads the same JSON.  
This mock HTML is illustrative — if numbers drift, regenerate or edit to match `plus-pricing.json` (do not invent a third price).

## Product (locked)

- See `plus-pricing.json` for $ / filings · Sonnet 5 · top-up · trial days
- Free BYOK forever · never push BYOK on exhaust
- Preview costs when classify runs · cache free re-open
- 14-day trial + card · magic link · capped promos

## UI direction (v3)

- **No ambient counters** on home or Settings while active
- **Numbers only on offer / Get More** sheets
- **Apple-plain limit:** “Monthly Limit Reached” (not “filing paused”)
- **Buttons:** Try Atoms Plus · Use My Own Key · Get More · Not Now · Start Free Trial · Continue / Cancel
- **Why it costs:** once on the offer (real cost + supports development)
- **Free path always named** without pressure
- Limit UI only when the period is used up

## States to approve

| # | Title / primary | Job |
|---|-----------------|-----|
| H1 | 4 Captures Waiting · **Try Atoms Plus** | Two paths |
| H2 | **Monthly Limit Reached** · **Get More** | Allotment used; resets on billing date (not auto top-up) |
| S1 | **Skip the API Key** · **See Plans** | Invite |
| Offer | **Atoms Plus** · $6 · **Start Free Trial** | 150, cost, free path |
| S2 | Status **Active** · Manage Subscription | Quiet |
| S3 | **Monthly Limit Reached** · Get More | Same language as home |
| Top-up | **Additional Filings** · $2 · **Continue** | +50 |

## Gate

1. Review mock  
2. Note copy / hierarchy changes  
3. Only then implement `atomsHomeData` + `settings` chrome  

## Plan

`docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` · U5
