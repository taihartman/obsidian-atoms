# QA — #186 BM25 shortlist shipping tail (2026-07-30)

## Charter

Prove the BM25 shortlist shipping tail: tests green after P1 fixes, throwaway vault CLI smoke, no Remote Vault mutation. Settings screenshots deferred to human.

**Proof kind:** plumbing + CLI smoke (not full product dogfood loop with live classify API spend).

## Preflight

| Check | |
|---|---|
| Product dogfood honesty | present in docs/qa/README.md |
| Authority | plan `docs/plans/2026-07-29-001-feat-bm25-shortlist-retrieval-plan.md` |
| Vault | throwaway `test_vault/test vault/` only |
| Obsidian | 1.12.7 open; plugin install + reload OK |

## Automated

| Gate | Result |
|---|---|
| `npm test` (plugin) | 716 pass |
| `npm run build` | clean |
| `plus-service` `npm test` | 194 pass (after `npm ci` post-merge) |

## Vault CLI smoke

| Command | Result |
|---|---|
| `./scripts/install-to-vault.sh` | Atoms v0.6.53 installed + reloaded |
| `atoms:dry-run-preview` | Executed |
| `atoms:backfill-estimate-confirm` | Executed |
| `atoms:open-home` | Executed |
| `atoms:list-unprocessed-captures` | Executed |
| `atoms:process-fixture-sample` | N/A — not registered in production build |

## Not run / residual

- Settings UI screenshots (shortlist size + expand linked notes) — human
- Paid classify dogfood against throwaway captures
- Adversarial chaos pass on Process mid-run (unit-covered; no live multi-capture API run this session)
- Fly plus-service deploy

## Verdict

**Ready for human review / merge** pending Settings screenshots if PR evidence policy requires UI shots, and Fly deploy of plus-service with the plugin.
