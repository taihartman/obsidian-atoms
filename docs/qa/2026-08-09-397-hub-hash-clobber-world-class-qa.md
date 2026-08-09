# World-class QA — #397 hub-hash clobber

- **Branch:** `fix/397-hub-hash-clobber`
- **PR:** [#402](https://github.com/taihartman/obsidian-atoms/pull/402)
- **Worktree:** `/Users/a515138832/StudioProjects/obsidian_plugin-397-hub-hash-clobber`
- **Version under test:** `0.6.91` (`main.js` md5 `dcba0cad81c2ab29cf66fe91c58629d8`, byte-identical to the worktree build)
- **Date:** 2026-08-09
- **Vault lane:** throwaway only — main checkout `test_vault/test vault` (402 atoms, 7 hubs). No personal / Remote Vault.
- **App:** Obsidian 1.13.4, installer 1.12.7, CLI `/opt/homebrew/bin/obsidian`.

## Verdict

**Ready to merge.** The convergence claim is proven live against a **pre-fix control on the same
vault**, and thirteen adversarial scenarios — every destructive, fault, and boundary class that
touches the changed line — converged with **zero holes**.

## Charter

A non-force Ask mirror pass must persist the hash of what it just uploaded, so the next pass finds
that atom clean. Under the bug the hub planner's stale copy of the map overwrote the atom planner's
freshened entries, so every dirty atom re-uploaded forever. Adjacent risk introduced by the fix
itself: it applies **only** the entries each planner freshened, so any path freshened *without* a
payload would now lose its hash update — and the force path must stay delta-only or the orphan
sweep breaks.

**Proof kind:** `product-loop` for the convergence claim (real vault edits → the plugin's own
debounced background pass → device-local hash map), `fixture-plumbing` for the Plus session and the
mirror endpoint (seeded device-local session against a local stub — same shape as #371/#374/#372
QA). **Not** a live plus-service.

**Authority:** issue #397 · `src/platform/askMirror.ts:1169` comment · PR #402 Core user stories.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ `docs/qa/README.md` re-read; no seeded hubs or pre-linked atoms — edits go through the real user loop |
| Build provenance | ✅ `md5 -q` on installed `main.js` matches the fresh `npm run build`, checked again after the control swap |
| Instrument positive control | ✅ stub logged a hand-issued upsert before any claim; every "0 uploads" line below has a non-zero sibling from the same instrument |
| Stale QA servers | ✅ 8787/8799/8800/8801/8802 all clear before start |
| Dev/run | ✅ `npx tsc --noEmit` exit 0 · `npx vitest run` 1453 passed / 84 files · `./scripts/install-to-vault.sh "<main checkout>/test_vault/test vault"` |
| Egress containment | ✅ permissive stub `scripts/qa-mirror-stub.mjs` on `127.0.0.1:8799`; `plusBaseUrl` override points there, so nothing left the machine |
| Screenshots | N/A — no UI surface. The claim is a log/hash count, and nothing visual changes |

## Authority & promises

| Surface | Promise | Acceptance | Story |
|---|---|---|---|
| Background sync | An uploaded atom is recorded as uploaded | Persisted hash moves; next pass sends nothing | S1 |
| Background sync (hub) | A hub edit converges too | Hub hash moves; next pass quiet | S2 |
| `Sync now` (force) | Full reconcile, evidence = exact vault set | Hash map size == vault paths; next non-force pass quiet | S3 |
| Plus spend | Unchanged notes are not re-sent | Zero upsert POSTs on a clean pass | S1/S4 |

## Core stories

### S0 — Build under test is the fixed build — **PASS**

`npm run build` → `main.js` md5 `dcba0cad81c2ab29cf66fe91c58629d8`; installed copy in the test vault
matches byte for byte. Re-verified after the pre-fix control was swapped back out.

### S1 — An edited atom is sent once, not every pass — **PASS**

Seeded from an empty hash map, one priming pass uploaded **407** (400 atoms + 7 hubs) and recorded
407 hashes. A second pass with nothing touched uploaded **0**. Then, through the real user loop —
`vault.modify` on one atom, no command invoked — the plugin's **own debounced background pass**
fired 2.9 s later and uploaded exactly that atom:

```
23:03:25 POST /v1/ask/mirror/upsert bytes=473 atoms=1
23:03:25   UPSERT kind=atom path=Atoms/Bring board games on Yosemite trip.md
```

Persisted hash moved `c679a9e4` → `1da4f8c6`. Three further non-force passes: `uploaded 0, 0, 0`,
hash stable, **zero** upsert POSTs in the log.
Evidence: [`docs/qa/logs/2026-08-09-397-mirror-fixed.log`](logs/2026-08-09-397-mirror-fixed.log).

### S1c — Pre-fix control, same vault, same gestures — **PASS (bug reproduces)**

The one-line fix was reverted, rebuilt (md5 `fa9b3ce66f7a4519c5314e074c92914e` — a different
artifact, confirmed installed), and the identical sequence re-run. The persisted hash **never moved
off `1da4f8c6`**, and the same atom was uploaded on every pass:

| Build | prime | debounced pass | pass 1 | pass 2 | pass 3 | hash after |
|---|---|---|---|---|---|---|
| pre-fix `fa9b3ce6` | 407 | 1 | **1** | **1** | **1** | `1da4f8c6` (frozen — the pre-edit value) |
| fixed `dcba0cad` | 407 | 1 | **0** | **0** | **0** | advanced, then stable |

Six uploads of one unchanged atom in the control run versus one in the fixed run. This is what makes
the empty log above evidence rather than an assumption.
Evidence: [`docs/qa/logs/2026-08-09-397-mirror-prefix-control.log`](logs/2026-08-09-397-mirror-prefix-control.log).

### S1r — The fixed build rescues an already-stuck vault — **PASS**

Reinstalling the fixed build over the control's stuck state: the load-time pass sent the atom once
more (23:05:06, last line of the control log), persisted `bf70ec03`, and three subsequent non-force
passes uploaded **0**. A vault caught in the loop leaves it on upgrade — no reset needed.

### S2 — A hub edit converges — **PASS**

Hub-only edit → `1, 0, 0`, hub hash stable after the first pass. See scenario A below.

### S3 — Force stays delta-only and leaves a correct map — **PASS**

`force` pass uploaded **409** and left exactly **409** hash entries (402 atoms + 7 hubs); the two
following non-force passes uploaded **0**. The orphan sweep's "upsertNext has all when force"
invariant holds live, not just in the unit test.

## Adversarial pass (scenario ledger)

Thirteen scenarios, weighted to the destructive / re-entry / fault classes. **13 solid, 0 holed, 0
blocked, 0 suspected-unproven.** All driven live through the CLI against the fixed build on the
throwaway vault; evidence in
[`docs/qa/logs/2026-08-09-397-mirror-adversarial.log`](logs/2026-08-09-397-mirror-adversarial.log).

| # | Scenario | Result | Verdict |
|---|---|---|---|
| A | Edit a **hub** note only | `1, 0, 0`; hub hash stable | solid |
| B | Edit an atom **and** a hub in the same pass (the crossing case both wrong fixes fail) | `2, 0, 0`; both hashes stable | solid |
| C | Create an atom, sync, then **delete** it | `u1` → `d1` → quiet; hash entry dropped | solid |
| D | **Rename** a synced atom | `u1` → `u1 + d1` → quiet; old path gone, new present | solid |
| E | **Force** pass, then non-force | 409 up, map == 409, then `0, 0` | solid |
| F | 150 dirty atoms — crosses the **100-chunk boundary** | `150, 0, 0` | solid |
| G | Injected **503 mid-run**, then recovery | pass failed, **0** stale-fresh entries persisted; next pass sent all 150; 0 left stale; then quiet | solid |
| G2 | Injected 503 on a **force** pass | failed; force retry 409; then non-force `0`; map == 409 | solid |
| H | Hub becomes an **orphan** (its only wikilink removed) | `u1 + d1` → quiet; hub hash dropped | solid |
| I | Two **concurrent** non-force syncs after one edit | one `worked u1`, one `joined`; settles to `0, 0` | solid |
| K | Hash map **partially corrupted** (5 entries deleted by hand) | exactly `5, 0` | solid |
| N | Hub edited **while** an atom is deleted, same pass | `u1 + d1` → `0, 0`; hub hash stable | solid |
| O | Maximal: every atom dirty + hub dirty + a delete, under force | `409 up, 1 del`, then `0, 0`; map == 409 == 402 atoms + 7 hubs | solid |
| P | **Offline** edit (base URL to a dead port), then reconnect | fails clean, hash unchanged while offline; reconnect `u1`; then `0` | solid |

**Analytical check behind the ledger.** The fix's correctness rests on "payload list == freshened
set". `planAskMirrorUpsert` writes `nextHashes[f.path]` and pushes the payload in the same
iteration, both after the same `continue` guards ([askMirror.ts:394-404](../../src/platform/askMirror.ts#L394)),
so no path can be freshened without a payload — the fix cannot silently drop a hash update. A path
also cannot land in both planners' payload lists: `isFlatAtomPath` requires the `Atoms/` prefix and
`isHubMirrorPath` excludes it.

**Not attacked here (inherited, with reason):** sign-out / consent-withdrawal mid-pass. That is the
`stillPermitted` seam, re-driven in full three commits ago in
[`2026-08-09-372-sign-out-teardown-world-class-qa.md`](2026-08-09-372-sign-out-teardown-world-class-qa.md)
including a slow-stub race; this change does not touch it. The injected-failure and offline
scenarios above cover the mid-run abort paths that *are* adjacent to the changed line.

## Fixes applied / deferred

None — no holes found. Nothing deferred.

## Reproducing this pass

```bash
node scripts/qa-mirror-stub.mjs /tmp/atoms-mirror.log 8799
./scripts/install-to-vault.sh "<main checkout>/test_vault/test vault"
```

Then in the vault: `plusBaseUrl` → `http://127.0.0.1:8799`, seed a device-local Plus session, set
`askEnabled = true` with a current privacy ack, and drive `syncAskMirror({ force: false })` via
`obsidian eval`. The stub answers CORS preflights — without that the plugin reports
`Plus network error (TypeError: Failed to fetch)` and a pass that never left the machine looks like
a dead backend.

## Vault state note

The throwaway vault's atoms carry appended `QA adv …` markers from scenarios F/G/O, and three probe
notes (`QA adv rename B`, `QA adv hub linker`, `QA Adv Hub`) remain. Regenerate with
`npm run seed:vault` when a clean fixture set is wanted. No personal vault was touched.
