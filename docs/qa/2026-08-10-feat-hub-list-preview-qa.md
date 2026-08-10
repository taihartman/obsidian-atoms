# QA — Hub list preview (#422)

**Date:** 2026-08-10  
**Version:** 0.6.98  
**Plan:** `docs/plans/2026-08-10-002-feat-hub-list-preview-plan.md`

## Automated

| Check | Result |
|-------|--------|
| hubListPreview + runHubProjection + hubProjection + settings | pass |
| tsc | pass |

## Manual residual

- Live Obsidian: toggle on → modal → Update / Not now / Unsorted off
- Refresh hub lists when setting on

## Verdict

Ready with residual (live modal chrome not driven in CI).
