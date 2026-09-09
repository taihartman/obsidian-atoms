---
status: canonical
owner: product-engineering
last_verified: 2026-09-08
canonical_for: [generated-access-matrix-view]
supersedes: []
superseded_by: null
---

# Access matrix

Generated from `access-matrix.yaml`. Do not edit by hand.

| Row | Route | Operation | Authority | Status |
|---|---|---|---|---|
| `G2_NONCE_007` | `/v1/g2/auth/nonce` | read | packaged companion origin | verified |
| `G2_SESSION_MINT_001` | `/v1/g2/pair/code` | create | verified Plus plugin session | verified |
| `G2_SESSION_LIST_002` | `/v1/g2/devices` | list | verified Plus plugin session | verified |
| `G2_SESSION_REVOKE_003` | `/v1/g2/devices/{deviceFamilyId}/revoke` | delete | verified Plus plugin session owning the device | verified |
| `G2_REDEEM_004` | `/v1/g2/pair/redeem` | call | holder of unused code presenting a valid initial DPoP proof | verified |
| `G2_REFRESH_005` | `/v1/g2/auth/refresh` | call | current g2r_ family member with matching DPoP proof | verified |
| `G2_CONTENT_006` | `/v1/g2/{transcribe|prepare|commit|status|query|recent|fetch}` | call | current scoped g2a_ family member with matching DPoP proof and live Plus entitlement | verified |
