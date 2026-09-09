---
status: canonical
owner: product-engineering
last_verified: 2026-09-08
canonical_for: [security-change-workflow]
supersedes: []
superseded_by: null
---

# Security change workflow

Classify changes touching identity, pairing, authorization, validation, or data access before implementation. Contract changes update `access-matrix.yaml` first, add row-linked failing tests second, and change enforcement third. Implementation-only and test-only changes preserve row semantics. Any unresolved disagreement is `needs-decision` and stops implementation.

Run `python3 scripts/security/validate_contract.py validate` after changes and `python3 scripts/security/validate_contract.py generate-view` after matrix changes. Security tests live under `plus-service/test/`; each verified row ID must appear in a linked test.

## Rollout compatibility

| | old server | new additive G2 server |
|---|---|---|
| old plugin / MCP client | Current behavior | Current behavior unchanged; no G2 calls |
| new plugin / G2 client | G2 routes unavailable; client remains unpaired | Target behavior |

The server must deploy before a G2-capable client is enabled. Reversing that order produces an explicit unavailable/unpaired state, not a credential fallback. G2 tables and routes are additive; existing `sess_` and `mcp_` semantics remain unchanged.

## Review stops

Stop when a row is `needs-decision`, when a change widens an approved actor set, when tests require production credentials, or when generic denials begin revealing tenant, entitlement, token, or device state.
