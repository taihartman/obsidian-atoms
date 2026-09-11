---
status: canonical
owner: product-engineering
last_verified: 2026-09-10
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
| `G2_SESSION_CONSENT_008` | `/v1/g2/consent` | read | verified Plus plugin session | verified |
| `G2_SESSION_CONSENT_009` | `/v1/g2/consent` | update | verified Plus plugin session | verified |
| `G2_REDEEM_004` | `/v1/g2/pair/redeem` | call | holder of unused code presenting a valid initial DPoP proof | verified |
| `G2_REFRESH_005` | `/v1/g2/auth/refresh` | call | current g2r_ family member with matching DPoP proof | verified |
| `G2_SETUP_STATUS_015` | `/v1/g2/setup/status` | read | current g2a_ family member with g2:status scope; matching DPoP proof; and live Plus entitlement | verified |
| `G2_CONTENT_006` | `/v1/g2/{captures|setup/status|recent|fetch}` | call | current scoped g2a_ family member with matching DPoP proof and live Plus entitlement | verified |
| `G2_PREPARE_METADATA_013` | `/v1/g2/{prepare|prepare/local|commit|status|transcribe|query}` | create | current scoped g2a_ family member with matching DPoP proof; live Plus entitlement; current G2 disclosure; and current authorization generation | deprecated |
| `G2_CAPTURE_ENQUEUE_016` | `/v1/g2/captures` | create | current g2a_ family member with g2:capture scope; matching DPoP proof; live Plus entitlement; current G2 disclosure; and current authorization generation | verified |
| `G2_CAPTURE_CLAIM_017` | `/v1/g2/captures/claim` | update | verified Plus plugin session for the owning account | verified |
| `G2_CAPTURE_ACK_018` | `/v1/g2/captures/ack` | update | verified Plus plugin session for the owning account holding the current claim token | verified |
| `G2_GROUNDED_QUERY_014` | `/v1/g2/{query|recent|fetch}` | read | current scoped g2a_ family member with matching DPoP proof; live Plus entitlement; current Ask mirror consent; and current authorization generation | verified |
| `G2_STREAM_TICKET_010` | `/v1/g2/transcribe/ticket` | create | current g2a_ family member with matching DPoP proof; live Plus entitlement; and current G2 disclosure | verified |
| `G2_STREAM_AUDIO_011` | `RFC6455 /v1/g2/transcribe/stream?ticket={single-use-ticket}; authenticated HTTPS status/retry/cancel compatibility routes` | call | consumer of a current single-use stream ticket or current scoped g2a_ owner of the recording with matching DPoP proof | verified |
