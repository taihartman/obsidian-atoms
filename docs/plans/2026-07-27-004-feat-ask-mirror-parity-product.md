# Product verdict — Ask mirror parity (Claude ≡ vault Atoms/)

**Date:** 2026-07-27  
**Role:** Product director  
**Authority:** CONCEPTS Ask · CLAUDE.md non-negotiables · #112 / #127 shipped surface  
**Status:** Locked product contract for next plan (not implementation)

---

## One-line promise

**When Ask is on and Obsidian has been open online, Claude searches the same `Atoms/` you have in the vault — not a second library you maintain.**

Vault remains source of truth. Mirror is a projection. User never “manages sync” as a job.

---

## Answers (decisive)

### 1. User promise

See above. Not “eventually consistent if you remember Sync now.” Not “bidirectional cloud vault.” Claude’s brain = last successful projection of flat `Atoms/*.md`.

### 2. Invisible vs visible

| Invisible (default, no UI noise) | Visible (Settings + rare Notices) |
|---|---|
| Upsert after Process / Update / outbox land | Enable Ask + privacy ack |
| Debounced vault create/modify/rename/delete under atom folder → mirror | Allow filing (write path consent) |
| Hash-skip unchanged files | **Sync now** (escape hatch) |
| Best-effort retry when back online (plugin open) | **Wipe** (nuclear, confirm) |
| Outbox pull on open + interval (already) | Quiet fail Notice → “Sync now” once |
| Delete-from-vault → delete-from-mirror | Status line: count + last pushed (or last fail) |

No toast spam on every hand-edit. No progress modal for background catch-up. Match auto-run honesty: silent when healthy.

### 3. When “Sync now” is still needed

Keep the button. Narrow role:

1. **Recovery** after a failed auto-push (Notice already points here).
2. **First enable / post-Wipe reseed** — full folder upsert.
3. **Catch-up** after long offline or bulk vault changes while Ask was off.
4. **Trust check** — user wants proof before a big Claude session.

Not required in the happy path: Process → ask Claude; edit atom in Obsidian → ask Claude; delete atom → Claude no longer finds it (after open+online).

### 4. Drift surface

**Yes, but soft — never a conflict browser.**

- Settings: `Claude sees N atoms · last pushed <relative time>` (from `GET /v1/ask/mirror/status` + local last-success stamp).
- Optional light mismatch: if local atom count ≠ N by more than a small threshold **or** last push failed → one line + Sync now CTA. No per-file diff UI.
- Do **not** invent merge/conflict UX. Vault wins always; mirror is overwritten or deleted to match vault. Hand-edit drift is fixed by the next auto-push, not by user reconciliation.
- MCP empty-mirror / stale-hint copy stays server-side (“sync from Obsidian”) — Claude admits unknown; user is not shown a red badge on home.

Home does **not** get a permanent “out of sync” guilt card (second brain, not task app).

### 5. Settings copy changes

Today is mechanism-heavy (“Upload changed Atoms/ notes”). Rewrite toward promise + honesty:

| Control | Copy intent |
|---|---|
| Section blurb | “Claude (phone + desktop) searches a cloud copy of your Atoms folder. Vault stays the source of truth.” |
| Enable Ask mirror | “Keep Claude’s view of Atoms/ current while Obsidian is open.” |
| Allow filing | Keep new-files-only / never rewrite bodies (already good). |
| Sync now | “Force a full refresh of Claude’s copy. Usually automatic.” |
| Status | “Claude sees N atoms · last pushed …” not bare “Cloud mirror status / Refresh”. |
| Wipe | Keep nuke language; stress vault files stay; outbox + tokens go. |
| Privacy ack | Keep KTD19 honesty; no soft-pedal on host decrypt or Anthropic tool results. |

Drop “mirror” from primary names where possible in user chrome; keep “mirror” in CONCEPTS/engineering. User word: **Claude’s copy** / **Ask copy**.

### 6. Offline / phone background — MUST work

| Must | Must not assume |
|---|---|
| Process / Update / hand-edit / delete work fully offline | iOS/Android background push while Obsidian is killed |
| When vault opens + network + Ask on → **catch-up** (upsert delta + deletes + outbox apply) | Continuous background daemon / OS push notifications for sync |
| Same code path desktop + iOS + Android (no desktop-only freshness) | Phone alone keeps mirror fresh if Obsidian never opens |
| Auto-push failures never fail Process | Real-time Claude sees edits milliseconds after save |

**Honest product truth (ship in copy if needed):** Claude’s copy updates when **any** device with this vault runs Obsidian online with Ask on. Obsidian Sync moves files; Atoms Ask projects them. Two systems, one user mental model if we stay quiet and catch up on open.

Outbox filing already requires Obsidian open — same bar for mirror catch-up. Do not promise “always live while phone is in pocket.”

### 7. Overkill / anti-product (do not build)

- Bidirectional sync or treating Plus as a second vault
- CRDT / OT / conflict UI / “which version wins?” dialogs
- Full-vault or dailies in the mirror
- Zero-knowledge as a P0 gate (ack already honest about host decrypt)
- Per-atom sync status in Library
- Forcing Sync before Process or before Claude chat
- Home guilt cards / streaks / “you’re 12 atoms behind”
- Desktop-only file watchers that leave mobile stale by design
- MCP-side vault write or delete tools (outbox create/continue only; vault delete stays human/Obsidian)
- Replacing Obsidian Sync
- Real-time WebSocket mirror for “as you type”
- Metered “sync health dashboard” for v1

---

## Architecture stance (product, not eng detail)

```
Vault Atoms/  ──project──►  Plus atom_mirror  ──read──►  Claude MCP
     ▲                            │
     │         outbox apply       │ (create/continue only)
     └──────── pending writes ────┘
```

- **SSOT:** vault files.
- **Projection rules:** every leaf under configured atom folder that is a product atom path; hash upsert; **delete vault path → delete mirror row**; rename = delete old + upsert new (or upsert new + delete old path).
- **Write from Claude:** outbox → new files only → then project. Never `vault.modify` existing bodies.
- **Multi-device:** any open client may project; last successful upsert/delete wins per path. Idempotent hashes. No device affinity.

---

## P0 scope (ship next — closes the “identical” promise)

1. **Vault event projection** — debounced create/modify/rename/delete under atom folder → upsert or delete on Plus (Ask on + ack + session).
2. **Mirror delete API + client** — `POST` delete-by-paths or reconcile; wipe already exists.
3. **Open/online catch-up** — on load + connectivity restore: full plan (hash upsert + remove mirror paths missing locally). Prefer one **reconcile** over silent orphan rows.
4. **Last-success / last-fail stamp** in settings data; Status line in Ask settings.
5. **Settings copy** rewrite (table above).
6. **Sync now** = force reconcile (not “upload only”); clears orphans.
7. Tests: delete atom → mirror gone; hand-edit body → fetch shows new text; offline Process then online open → Claude finds it.

**P0 acceptance:** Hand-edit or delete an atom on phone Obsidian → wait for open+online debounce → phone Claude search/fetch matches vault. No manual Sync in happy path.

## P1 scope (polish, not blockers for promise)

1. Smarter status mismatch (local count vs server count) with single CTA.
2. Targeted upsert of only touched paths (perf) if full scan hurts large libraries.
3. Optional “Apply pending from Claude” manual button if interval feels slow (outbox already polls).
4. CONCEPTS: add **Ask reconcile** / **projection** vocabulary if useful.
5. Soft Notice only on first failure per session (dedupe spam).

## Explicit non-goals

- Bidirectional / conflict resolution
- Background OS sync without Obsidian
- Delete/replace atom tools in MCP
- Process/classify from Claude
- Home sync chrome
- ChatGPT/DIY changes (separate issues)
- ZK encryption upgrade
- Pagination / neighbors tools (#129 etc.)

---

## Why this shape (not alternatives)

| Alternative | Verdict |
|---|---|
| Keep Process-only push + Sync now | **Reject as end state** — hand-edits and deletes lie to Claude; dogfood already felt the gap. |
| Manual-only sync | **Reject** — makes Ask a chore; anti second-brain. |
| Full bidirectional cloud brain | **Reject** — violates vault SSOT, body sacred, collision rules, multiplayer complexity. |
| Live typewriter sync | **Reject** — battery, mobile limits, noise; second brain is not collab docs. |
| **Vault-event projection + reconcile + Sync escape** | **Ship** — matches “Claude ≡ Atoms/” with honest offline/open bar. |

---

## Copy snippets (ship-ready)

**Enable:** Keep Claude’s view of your Atoms folder current while Obsidian is open online.

**Sync now:** Force-refresh Claude’s copy from this vault. Normal edits sync automatically.

**Status:** Claude sees {n} atoms · last pushed {relative}  
on fail: Last push failed · Sync now to retry

**Section:** Ask lets Claude search (and optionally file new) atoms. Your vault files stay authoritative; Plus holds a copy of Atoms/ only.

---

## Next decision

Approve this contract → open Issue + `ce-plan` implementation plan for P0 reconcile/delete/vault-events (no code until hard claim).
