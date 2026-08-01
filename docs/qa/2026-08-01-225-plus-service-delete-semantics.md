# plus-service delete semantics — the two confirmations U1 depends on

Answers to the two service-side questions the catch-up plan (`docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md`,
on the `#222` branch) makes prerequisites for U1, verified against `plus-service/src` on 2026-08-01.
The plan's Verification Contract and Definition of Done both require these recorded before U1 merges.

## Q1 — Reconcile hard-deletes. There is no recovery path.

`store.mirrorReconcileKeep` issues literal row deletes — Postgres `DELETE FROM atom_mirror WHERE email = $1
AND path = $2` per non-kept path (`plus-service/src/store/askPostgresMethods.mjs:230-243`), SQLite identically
(`askSqliteMethods.mjs:227-239`), memory store `bucket.delete(path)` (`memory.mjs:411-418`). The individual
delete endpoint is the same shape (`askPostgresMethods.mjs:213-216`, driven from `mirror/http.mjs:171`).

No tombstone, soft-delete column, backup table, retention window, or body-retaining audit log exists. The
`atom_mirror` DDL is `email, atom_id, title, path, body_enc, tags_json, links_json, content_hash, updated_at`
with `PRIMARY KEY (email, path)` and no `deleted_at` (`askPostgresMethods.mjs:21-33`).

**What this sets for U1.** Deletion is irreversible server-side. The only recovery is the client re-uploading
from the vault, which is the design — the vault is SSOT. But that recovery only works if the vault still holds
the atoms, which is exactly what an incomplete scan means it does not. So the refusal has to be a hard refusal,
not a warning the user can click past by habit, and the confirmation modal has to name the concrete counts.

## Q2 — Chunked reconcile: 10-minute sliding TTL, deletes deferred to the final chunk

**(a) TTL.** `RECONCILE_TTL_MS = 10 * 60 * 1000` (`plus-service/src/mirror/http.mjs:15`), enforced by
`purgeReconcileSessions()` at the top of every reconcile request (`http.mjs:21-26`, called at `:213`). It is
*sliding* — each staging chunk resets `sess.exp` (`http.mjs:228`), so 10 minutes is the maximum idle gap
between chunks, not a total session budget.

**(b) Abandonment is harmless; expiry-then-commit is not.** Non-final chunks only stage paths into an in-memory
Set and return `{ ok: true, staged, deleted: 0 }` without touching the store (`http.mjs:215-236`); no
`mirrorReconcileKeep` runs until `done: true` (`http.mjs:257`). A client that sends 2 of 5 chunks and stops
leaves the mirror completely untouched.

**(c) `confirmEmpty` is evaluated once, at commit.** Read at `http.mjs:208`, ignored by the staging branch,
checked only after the union is assembled (`http.mjs:250-255`). The client agrees:
`confirmEmpty: last ? confirmEmpty : false` (`src/plugin/main.ts:1414`).

**What this sets for U1.** The chunked-path scenario asserts on deferred-commit semantics: intermediate chunks
cannot delete anything, so only the final chunk's `confirmEmpty` matters.

## Two hazards found in passing — neither is U1's to fix

### 1. An expired chunked session commits the final chunk alone and deletes the rest

If the session entry is missing at commit time — TTL expired because a chunk took over 10 minutes, the machine
restarted, or the request landed on a different instance — `reconcileSessions.get(sk)` returns undefined and the
commit falls through to `keep = keepPaths`, **the final chunk alone** (`http.mjs:239-248`). Every path staged in
chunks 1..n-1 is then treated as an orphan and hard-deleted. There is no chunk index, no expected-total, and no
"session not found" error: the server returns `200 { ok: true, deleted: N }` for what is a mass deletion.

`reconcileSessions` is a module-level `Map` in process memory (`http.mjs:13-14`) with no persistence and no
cross-instance sharing, while `plus-service/fly.toml:26-28` sets `auto_stop_machines = "stop"` with
`min_machines_running = 1` — so losing session affinity is an ordinary operational event, not an edge case.

The client cannot defend against this from the completeness floor: its scan *was* complete, and it sends chunks
sequentially with a single `sid`, treating any `ok` response as success (`src/plugin/main.ts:1405-1417`).
**This needs a server-side fix** (reject the commit when the session is absent rather than falling through) and
is filed separately.

### 2. The empty-reconcile guard's threshold is literally zero

`if (keep.length === 0 && !confirmEmpty)` → 400 (`http.mjs:250-255`). There is no near-empty, percentage, or
ratio check: a reconcile with one keep-path against a 5,000-row mirror deletes 4,999 rows with no confirmation.
`docs/qa/2026-07-27-ask-mirror-sync-security-review.md:102` is satisfied only for the literal-zero case.

The client defeats even that: `src/plugin/main.ts:1397` sets `confirmEmpty = keepPaths.length === 0`, so a
failed or mid-index vault scan returning zero paths auto-supplies the confirmation the guard exists to demand.
**U1 closes the client half of this** — step 3 stops deriving `confirmEmpty` from emptiness and requires a
`DeletionConfirmation` token that only the modal's confirmed branch can construct. The server half — corroborating
the flag rather than trusting it — remains open.
