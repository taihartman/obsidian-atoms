# Ask mirror parity dogfood — 0.6.39 / #137

**Vault:** `test_vault/` only (never unattended personal Remote Vault).  
**Depends on:** plus-service with delete/reconcile routes deployed.

## Checklist (AE1–AE5 + F6)

| ID | Steps | Pass? |
|---|---|---|
| AE1 | Edit atom body in vault → wait ~2s → Claude `fetch_atom` matches | |
| AE2 | Delete atom → Claude search/fetch miss | |
| AE3 | Rename atom title/path → old miss, new hit | |
| AE4 | Create orphan on server (or drift) → **Sync now** → count matches vault | |
| AE5 | Incomplete second-device vault runs background sync → does **not** wipe paths it never hashed | |
| F6 | Process/Update after edit → no double-body; hash-skip cheap | |

## Settings

- Status line: `Claude sees N · last pushed …` (N from server status)
- Sync now warns multi-device incomplete vault
- Wipe clears cloud + local evidence map

## Residual (known)

- Missed vault events during long open session → heal with Sync now (no interval)
- Connectivity-restore catch-up = P1 (not this release)
