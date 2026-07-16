# Design: multiplayer + agent collaboration

Date: 2026-07-16  
Status: adopted (docs landed)  
Owners: both humans (Tai + cousin)

## Problem

Two people both touch the whole product, mostly via AI agents. Risks:

1. **Code conflict** — parallel edits to the same modules  
2. **Product drift** — agents invent scope outside the north star  
3. **Context blindness** — new sessions don’t know what’s in flight  

## Decision

Hybrid coordination:

| Layer | Tool |
|---|---|
| Tickets + review + merge | GitHub Issues / PRs |
| Agent radar | `STATUS.md` (in repo) |
| Process law | `docs/collab.md` |
| Product constitution | `CLAUDE.md` + `docs/architecture.md` (change via PR only) |

**Hard claim:** Issue assigned + `STATUS.md` row + draft PR before implementation.

**Product authority:** shared. Constitution is boss; either human can steer via written plan/PR. AI is staff PM (challenges drift), not a third founder.

## Constitution tweaks (same change set)

From adversarial review during design:

- Product sentence includes file → home → gentle resurface (not pipeline-only).  
- Capture UI stays out of scope; capture method may differ by OS (iOS today, Android later).  
- “Never today” → default exclude; explicit user force allowed.  
- Dry-run → required evidence for untrusted/new classify logic; gated auto-run remains valid.  
- U1–U10 build order demoted to historical core plan.  
- Cross-platform consumers (desktop / iOS / Android) called out.  
- Resurfacing no longer listed as wholly “out of scope v1” (partially shipped; extend via plans).

## Artifacts

| Path | Role |
|---|---|
| `docs/collab.md` | Full multiplayer + agent process |
| `STATUS.md` | Live claims table |
| `CLAUDE.md` | Pointers + constitution wording updates |
| This file | Design record |

## Non-goals (this design)

- Linear/Notion/Slack as source of truth  
- File-level locks or CODEOWNERS (can add later if needed)  
- Automated bot that assigns Issues  
- Permanent single human PM  

## Success criteria

- New agent session can answer “what’s in flight?” from `STATUS.md` + GitHub alone  
- Two humans rarely open conflicting PRs on the same hot files  
- Feature work traces to Issue + plan; constitution edits are explicit PRs  
- Cousin can start work without a verbal handoff beyond GitHub + these docs  

## Follow-ups (optional)

- GitHub Project board columns mirroring STATUS states  
- Branch protection on `master` (PR required)  
- Short “cousin onboarding” checklist in README  
- CODEOWNERS only if review load demands it  
