---
title: "Same-day library order from capture position, not title A–Z"
date: 2026-07-16
category: logic-errors
module: home-library
problem_type: logic_error
component: created-frontmatter
symptoms:
  - "Recents shows later captures under earlier ones on the same day"
  - "Mind-change pair appears inverted (claim above the revise)"
  - "All same-day atoms share created: YYYY-MM-DD and sort by title"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - library
  - created
  - recents
  - within-day-order
  - backfill
---

# Same-day library order from capture position

## Problem

Untimestamped captures got day-only `created: YYYY-MM-DD`. Home sorts by `created` (newest first); ties break alphabetically by title. Later bullets could appear *above* earlier ones when titles sorted that way.

## Solution

1. **Process:** `resolveCreatedField(date, ts, startLine)` — real `HH:mm` when present; else `dateT12:00:00 + startLine seconds` (stable within-day order, labels stay midday-clustered).
2. **Silent backfill:** On home load, day-only atoms re-stamp `created` only by **body-matching** the source daily (not ↳ marker title). Ambiguous matches skip.
3. Do **not** use file mtime or process wall-clock (Update notes / bottom-up batch invert).

## Prevention

- Never treat day-only `created` as sufficient for within-day Recents order.
- Backfill identity = capture body first line ↔ atom body first line.
- Marker mis-attachment is a separate bug; do not use markers for order heal.
