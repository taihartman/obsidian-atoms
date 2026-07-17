# STATUS — in flight

Agent radar for multiplayer work. **Update this when you claim, block, or finish.**  
Process: [`docs/collab.md`](docs/collab.md) · Issues/PRs on GitHub.

## In flight

| State | Issue | Owner | Branch | Plan | Hot files | Notes |
|---|---|---|---|---|---|---|
| In progress | #66 | agent | fix/collision-marker-integrity | docs/plans/2026-07-17-001-fix-collision-marker-integrity-plan.md | write.ts, render.ts, backfill.ts, main.ts, runProgress.ts | body-gate collision + surface Process failures |

## How to claim (copy)

1. Create/assign GitHub Issue  
2. `git checkout master && git pull && git checkout -b feat/<name>`  
3. Add a row above (State = `In progress`)  
4. Push branch and open **draft** PR  
5. Only then implement  

States: `Queued` · `In progress` · `Blocked` · `In review` · `Done` (then remove row)

## Recently merged (optional, last ~5)

| Merged | Issue / PR | Summary |
|---|---|---|
| 2026-07-16 | #63 / #64 | library within-day created order (0.6.12) |
| 2026-07-16 | — | remove PR Closes CI; agent-checked only |
| 2026-07-16 | #53 / #54 | drop junk link reasons (0.6.10) |
| 2026-07-16 | #48 / #49 | aliases/prior as self (0.6.9) |
| 2026-07-16 | #40 / #41 | Recents use created not mtime |
