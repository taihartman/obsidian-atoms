---
status: canonical
owner: product-engineering
last_verified: 2026-09-09
canonical_for: [atoms-plus-mcp-security-contract-governance]
supersedes: []
superseded_by: null
---
# Contract governance

`access-matrix.yaml` is the machine-readable source of truth. Stable row IDs are
never reused. A row is `verified` only when the referenced test file declares
that ID in a `Matrix coverage` block and exercises the real enforcement path.
The generated `access-matrix.md` must never be edited by hand.

Canonical documents use the frontmatter keys declared in the schema and are
reviewed whenever their enforcement files change. Conflicts between live policy,
application code, tests, and this contract are marked `needs-decision`; they are
not resolved by guessing from the easiest implementation.
