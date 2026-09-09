---
status: canonical
owner: product-engineering
last_verified: 2026-09-09
canonical_for: [atoms-plus-mcp-security-change-workflow]
supersedes: []
superseded_by: null
---

# Atoms Plus MCP security change workflow

Use this workflow before changing pairing, OAuth identity, MCP token access, or
reviewer provisioning.

1. Read `access-matrix.yaml` and classify the change as contract, implementation,
   test-only, docs-only, or needs-decision.
2. For a contract change, update matrix rows first, add row-ID-linked tests
   second, and change production code last.
3. Preserve the public eight-character, ten-minute, one-time pairing contract,
   hashed-at-rest credentials, remint invalidation, entitlement checks, PKCE,
   scopes, and email tenant boundaries unless a separately reviewed contract
   change explicitly says otherwise. Reusable credentials require explicit
   reviewer mode, a reserved `@review.tryatoms.app` identity, at least 128 bits
   of entropy, and a bounded lifetime.
4. Run `python3 scripts/security/validate_contract.py validate --config docs/security/atoms-plus-mcp/contract.config.yaml --root docs/security/atoms-plus-mcp`.
5. Run `generate-view` with the same config/root and then rerun `validate` to
   prove the generated view is current.

For this reviewer-access change, old and new public clients both mint
eight-character, ten-minute, one-time codes under old and new server code. The
new operator script works only after the new server/store code is deployed.
Shipping the script before those methods would fail closed because the existing
store does not recognize reviewer credential mode; it cannot silently broaden
public access.
