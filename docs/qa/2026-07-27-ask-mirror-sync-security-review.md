# Security review: vault↔cloud Atoms/ mirror continuous sync

**Role:** security reviewer  
**Date:** 2026-07-27  
**Code authority:** `plus-service/src/mirror/http.mjs`, `plus-service/src/mcp/handler.mjs`, `plus-service/src/store/askHelpers.mjs`, `src/platform/askMirror.ts`, plan KTDs in `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md`

**Verdict:** Continuous sync is acceptable **only** as **vault-SSOT, plugin-pushed, Atoms-folder-scoped reconcile** under `sess_`. Reject server-authoritative sync, full-vault watchers, and any write/delete surface on `mcp_`.

---

## 1. Hard security constraints

### Auth audiences (load-bearing, already coded)

| Token | Audience | Allowed |
|-------|----------|---------|
| `sess_` | Plugin / Plus HTTP | Mirror upsert, wipe, status, outbox pull/ack |
| `mcp_` | Anthropic → `/mcp` | Tools only (read + outbox *enqueue*) |
| OAuth cookie (KTD17) | Browser authorize hop | **Never** `/mcp` or mirror write |

Evidence:

```35:48:plus-service/src/mirror/http.mjs
  // Reject mcp_ tokens on Plus routes
  if (token.startsWith("mcp_")) {
    json(res, 401, { message: "Invalid session" });
    return true;
  }

  const a = await store.accountFromSession(token);
```

```39:48:plus-service/src/mcp/handler.mjs
  if (!token || token.startsWith("sess_")) {
    // ... 401 + WWW-Authenticate resource_metadata
    return;
  }
```

KTD11 / D3: `mcp_` ≠ `sess_`; MCP bearer never writes mirror rows; tenant email from session/token lookup **never** from body (`http.mjs:178–179`).

### Least privilege

- **Entitlement gate:** `active|trialing` on every mirror route (`entitled()` in `http.mjs:10–12`) and on `accountFromMcpToken` (null if not entitled).
- **MCP scope today:** minted as `atoms:read` but tools already include **write-via-outbox** (`create_atom`, `continue_atom`, `cancel_pending` in `tools.mjs`). Treat scope string as **honestly incomplete** until split (`atoms:read` vs `atoms:outbox`) or document filing as separate consent (plugin already has separate “Allow filing” ack).
- **Rate limits:** IP+email on Ask routes; write tools rate-limited per email (`ask-write:${email}`).
- **Size caps:** 100 atoms/upsert, 100k chars/body, 2M bulk (`http.mjs:6–8`). Keep; continuous sync must batch under these.

### Wipe

- Canonical: `POST /v1/ask/mirror/wipe` under `sess_` only (KTD15; CORS is GET/POST/OPTIONS).
- Store: hard-delete `atom_mirror` + `ask_outbox` + `mcpRevokeForEmail` (access **and** refresh) — see `askSqliteMethods.mjs:247–252`.
- Product: wipe ≠ disable Ask; privacy ack must say so (KTD19).
- **Do not** expose wipe on MCP. **Do not** auto-wipe on disable without explicit user action.

### Encryption

- D1 / KTD10b: app-level AES-256-GCM (`mirror/crypto.mjs`); prod fail-closed on `ATOMS_ASK_MIRROR_KEY`.
- **Not ZK:** host decrypts for search/fetch/tool results. Privacy ack must stay honest.
- Encrypt at rest does **not** reduce Anthropic exposure: tool results leave Plus in plaintext to Claude.

### Product / constitution egress bounds

- Plan R4 / KTD19 / non-goal: **only `Atoms/`** leaves device for Ask mirror — not dailies, not whole vault.
- Vault remains SSOT (D2). Cloud is a **read replica for Ask**, plus outbox queue — never the authority that rewrites vault atoms from MCP.

---

## 2. Risks of continuous vault watchers

| Risk | Why it matters | Severity |
|------|----------------|----------|
| **Accidental full-vault upload** | Watcher on `vault.on('modify')` without hard path prefix → daily notes, hubs, attachments metadata, secrets in frontmatter. Client filter in `planAskMirrorUpsert` (`startsWith(folder + "/")`) is **client-only**; server `prepareMirrorRow` accepts **any non-empty path** (`askHelpers.mjs:27–29`). Compromised/buggy plugin or hand-crafted `sess_` client can upload `Daily/…`, `../…`, absolute paths. | **Critical** without server path allowlist |
| **Path traversal / weird keys** | No rejection of `..`, `\`, absolute paths, NUL, or non-`.md`. Unique key is `(email, path)` — garbage paths pollute tenant mirror and MCP search surface. | **High** |
| **Rename storms** | Rename = delete old path + create new. Upsert-only mirror leaves **orphan rows** under old path → stale “facts” in Claude after rename/delete. Continuous watch without delete/reconcile **guarantees drift**. | **High** (integrity / privacy of wrong content) |
| **Delete lag** | User deletes sensitive atom locally; cloud keeps it until wipe or per-path delete. Continuous *upload* without *delete* is a privacy hole. | **High** |
| **Multi-device race** | Desktop + phone both watch/push. Last-writer-wins on `(email, path)` content_hash is OK for same path; device A deletes while B still has file → B re-upserts ghost. Need vault-SSOT + reconcile tombstones or “present set” from each device carefully (prefer explicit present-set from the device that just scanned). | **Medium–High** |
| **Event storms / battery / cost** | Rapid edits → N upserts; hits 100/batch and rate limits; mobile background watchers are unreliable and encourage overly broad sync. Prefer debounce + hash-skip (already in planner) + Process/Update hooks over raw FS spam. | **Medium** |
| **Ack bypass** | Watcher must not fire before `askEnabled && askPrivacyAckAt` (`main.ts:964–966`). Any path that skips that gate is a product-security bug. | **High** if regressed |
| **Outbox feedback loop** | Outbox apply creates atom → watcher re-pushes. Harmless if hash-stable; dangerous if apply mutates body and re-triggers classify/mirror loops. Keep apply → mirror one-shot, hash skip. | **Medium** |

**Decision on watchers:** Optional **debounced Atoms-folder-only** watcher is OK as a *hint* to push. It is **not** sufficient as the sole consistency mechanism. Mandatory: periodic or on-focus **reconcile** (present-set + deletes).

---

## 3. Required API shape for safe delete/reconcile

**Today:** upsert + full wipe only. **No per-path delete.** Continuous sync without delete API is unsafe.

### Mandatory additions (all `sess_` + entitled + email from session)

1. **`POST /v1/ask/mirror/delete`**
   - Body: `{ paths: string[] }` (cap e.g. 500).
   - Server: normalize + **same path allowlist as upsert**; delete only `(email, path)` rows that pass.
   - Response: `{ deleted, missing }`.
   - Never accept body.email; never `mcp_`.

2. **`POST /v1/ask/mirror/reconcile`** (preferred over client inventing wipe+full reupload)
   - Body: `{ paths: string[], mode: "exact" }` where `paths` is the **full present set** under Atoms/ (or paginated with a generation token if huge).
   - Server: delete any mirrored row for that email whose path ∉ present set **and** whose path matches allowlist prefix (do not delete rows outside allowlist if you ever had junk — or delete junk always).
   - Cap: if present set empty → **reject** unless `confirmEmpty: true` (prevents “failed scan wiped brain”).
   - Optional: return `{ removed, kept, count }`.

3. **Keep wipe** as nuclear UX: wipe mirror + outbox + revoke MCP tokens. Reconcile empty ≠ wipe tokens unless product says so (prefer: empty reconcile does **not** revoke OAuth; only explicit wipe/Settings disconnect does).

4. **Upsert path validation (server, fail closed)** — before any continuous design ships:
   - Path must match: `^Atoms/[^/\\]+\\.md$` **or** configured folder equivalent if multi-tenant folder names ever exist — today product is flat `Atoms/`; server should default-allowlist `Atoms/*.md` only (no nested folders — constitution: flat Atoms only).
   - Reject: `..`, leading `/`, `\`, NUL, non-`.md`, nested `/`, empty title segment.
   - Prefer reject over silent strip.

5. **Do not** implement “server pulls vault” or webhook from arbitrary hosts.

6. **Idempotency:** content_hash skip stays; delete is idempotent; reconcile is idempotent for same present set.

---

## 4. What must stay `sess_`-only vs `mcp_`-only

### `sess_`-only (plugin device, long-lived paste session)

- `POST /v1/ask/mirror/upsert`
- `POST /v1/ask/mirror/wipe`
- `POST /v1/ask/mirror/delete` (new)
- `POST /v1/ask/mirror/reconcile` (new)
- `GET /v1/ask/mirror/status`
- `POST /v1/ask/outbox/pull` + `ack` (vault apply authority)
- Plus account, billing, magic-link exchange for **plugin** session
- Any operation that **mutates mirror rows** or **drains outbox into vault**

### `mcp_`-only (Claude connector, short-lived access + refresh)

- `POST /mcp` tools: `search_atoms`, `fetch_atom`, `neighbors`, `list_atoms`
- Outbox **enqueue** only: `create_atom`, `continue_atom`, `cancel_pending` (never direct vault FS; never mirror upsert)
- OAuth authorize/token/refresh for connector
- **Must reject** `sess_` on `/mcp` (already)

### Neither (or cookie-only browser)

- KTD17 OAuth cookie: authorize continue only — never API bearer substitute

### Explicit forbids

| Action | `sess_` | `mcp_` |
|--------|---------|--------|
| Upsert/delete/reconcile/wipe mirror | ✅ | ❌ |
| Read mirror via tools | ❌ (use plugin status only) | ✅ |
| Enqueue outbox write | ❌ | ✅ (if filing ack product-side) |
| Apply outbox to vault | ✅ | ❌ |
| Revoke all MCP tokens | ✅ (wipe / settings) | refresh revoke only own token |

---

## 5. Mandatory security requirements (any chosen sync design)

These are **non-negotiable**. Design may vary (Process-hook vs debounced watch vs periodic reconcile); these do not.

1. **Audience split preserved forever** — reject cross-use of `sess_`/`mcp_` as coded today; tests stay green.
2. **Server-side Atoms path allowlist** on every write/delete/reconcile — client filter is insufficient.
3. **Vault is SSOT** — cloud never pushes atom body edits back except via **outbox create/continue** applied by plugin under separate filing ack.
4. **Privacy ack gate** before first upsert and before enabling any watcher (`askPrivacyAckAt`); ack text includes KTD19 (Atoms-only, host can decrypt, Anthropic sees tool results, wipe vs disable).
5. **Delete path exists** before continuous sync ships — orphan cloud rows after local delete/rename are a ship blocker.
6. **Empty-present-set safety** — reconcile must not wipe on scan failure; require explicit confirm or non-empty/heartbeat.
7. **Wipe = hard delete + MCP revoke** (already) — keep; document; no soft-delete recovery that leaves ciphertext for host ops without policy.
8. **Encryption required in prod** (KTD10b) — no plaintext fork in production.
9. **Tenant isolation** — email only from token tables; never body; mirror queries always `WHERE email = ?`.
10. **Caps + rate limits** on upsert/delete/reconcile and MCP tools; no unbounded list dump without pagination (list_atoms already capped).
11. **Logging** — never Authorization, raw tokens, or `body_text` / tool payloads (KTD18).
12. **Multi-device:** last-writer-wins on content is OK; deletes must reconcile; no device may upload outside its configured atom folder after clamp.
13. **Watcher scope:** register only under clamped atom folder; ignore non-`.md`; debounce; never watch vault root.
14. **Filing vs read consent stay separate** — mirror enable ≠ allow outbox apply (`askFilingAck` / settings).
15. **Cancel / lapsed Plus** — `accountFromMcpToken` fails; Stripe cancel revokes MCP tokens; mirror write routes 403 when not entitled (consider whether lapsed users may still wipe — **yes, wipe should remain available while session valid** even if not entitled, so users can exit cleanly; today wipe requires `entitled()` — **fix: allow wipe on valid session without active entitlement**).

---

## 6. Deal-breakers

Ship-blockers. Do not merge continuous sync if any remain true:

1. **Server accepts arbitrary paths** on upsert (current `prepareMirrorRow`) once continuous push is on by default.
2. **No per-path delete / reconcile** while advertising “mirror ≡ vault Atoms/”.
3. **`mcp_` can upsert, wipe, delete, or pull outbox for apply.**
4. **`sess_` accepted on `/mcp`.**
5. **Server-authoritative sync** (cloud overwrites vault atoms’ bodies, or MCP edit-in-place of mirror presented as vault truth).
6. **Full-vault or daily-note sync** “for better answers.”
7. **Auto-wipe on disable** without confirmation, or wipe without revoking MCP tokens.
8. **Reconcile with empty path list** that nukes mirror on a failed folder read.
9. **ZK claims** while host holds `ATOMS_ASK_MIRROR_KEY` and serves decrypted tool results to Anthropic.
10. **Shared long-lived token** used for both plugin paste session and Claude connector.
11. **Authless or DIY static bearer in production** (KTD14).
12. **Continuous watcher enabled without privacy ack + Plus session + askEnabled.**

---

## Recommended design (decisive)

**Choose:** Vault-SSOT **push reconcile**, not server-authoritative, not full wipe-only.

1. **Triggers (client):** Process/Update success paths + Settings “Sync now” + optional **debounced** `Atoms/` watcher + on-layout ready / app foreground periodic reconcile (e.g. every N minutes while Ask enabled).
2. **Algorithm per sync:**
   - List markdown under clamped atom folder only.
   - `planAskMirrorUpsert` hash-skip → upsert batches of ≤100.
   - Send full present path set → `reconcile` deletes orphans.
3. **Server:** path allowlist + delete + reconcile APIs; keep wipe nuclear; fix wipe-without-entitlement for account exit.
4. **Do not:** mirror watch on vault root; do not give MCP delete; do not skip ack.

This matches D2 (vault SSOT), R4 (Atoms only), KTD11 (sess write / mcp read+outbox), and closes the orphan-row hole continuous sync would otherwise open.
