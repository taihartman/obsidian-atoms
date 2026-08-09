# QA — Hub projection any hub (#390 / PR #391)

**Date:** 2026-08-09  
**Branch:** `feat/hub-projection-any-hub`  
**Version:** 0.6.89  

## Scope

Opt-in hub projection for qualifying list hubs (Movies etc.) + person hubs; classify list context; toggle-on regen; constitution widen.

## Automated

| Check | Result |
|-------|--------|
| `tsc -noEmit` | pass |
| vitest: hubQualify, runHubProjection, listHubs, hubProjection, classificationContract, people, media | **73 pass** |
| hubProjection.vault-smoke (person + Movies AE1/AE3b) | pass |

## Product dogfood (test_vault / pure plan)

| AE | Method | Result |
|----|--------|--------|
| AE1 Movies + Want to watch | pure `planHubProjection` in vault-smoke | **pass** |
| AE3b Meeting Notes single link | pure plan R3c brake | **pass** |
| AE2 toggle-on | unit/fullRegen path + Notice copy | code path verified; live Obsidian toggle not driven this session |
| Person hub Gift Ideas | existing vault-smoke | **pass** |

## Residual

- Live Obsidian Process + Settings toggle on throwaway vault not driven (CLI/Obsidian optional).
- Screenshots not captured — pure logic + smoke covered; attach UI shots before mark-ready if desired.
- Plus-service template hub_section wording updated; full plus suite not re-run.

## Verdict

**Ready with residual** — automated + pure AE1/AE3b green; live vault Process/toggle is optional human dogfood before release.
