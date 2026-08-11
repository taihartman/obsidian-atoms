---
handoff_date: 2026-08-11
branch: claude/plus-meter-keeps-ask-441
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mcp-entitlement-debug-7e9fce
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/441
status: in-progress
---

# Handoff — #441: a spent filing meter must not revoke Ask/MCP

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then **start executing Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

A paying Atoms Plus subscriber who uses up their monthly **filing** allotment currently loses **Ask/MCP** as well — Claude and ChatGPT stop being able to read a brain that is already mirrored and already paid for. Fix that. Reading mirrored atoms has nothing to do with the filing meter.

The owner made the product call explicitly, in these words: **"their filings should not revoke mcp access if they are still subscribed."** That decision is settled — implement it, do not reopen it.

## Current status

Nothing is implemented yet. This branch has only this handoff doc. What exists is a verified map of the defect, below — trust it, but re-read the cited lines before editing, because they are the whole job.

Just-shipped context you are building on (all merged, nothing in flight):

- **#442 / PR #443 → released 0.7.2.** The *client* half of the same collapsed distinction: an expired trial was described as a spent monthly meter. Introduced `plusLapse` as the one home for "period ended" vs "meter spent".
- **#446 / PR #447 → released 0.7.3.** Mid-word truncation in Ask error copy. Unrelated except that it was found during #442's QA.
- The learning from #443 is at `docs/solutions/logic-errors/a-device-may-not-assert-an-entitlement-the-server-has-not-confirmed.md`. **Read it first** — #441 is the server-side mirror of the exact same bug, and that doc explains the shape.

## The defect, mapped (verified on master at handoff time)

The service writes one `exhausted` status for two unrelated situations:

- the billing/trial **period ended** — `applyStatusRules`, `plus-service/src/store/shared.mjs:285`
- this period's filing allotment is **spent** — the meter's `UPDATE`, `plus-service/src/store/postgres.mjs:620` (`status = CASE WHEN remaining - 1 <= 0 THEN 'exhausted' ELSE status END`)

Two independent layers then reject `exhausted`, and **they are not the same code path**:

### Layer 1 — the MCP token lookup (this is the one that kills Claude/ChatGPT)

`accountFromMcpToken` returns `null` when status is not `active`/`trialing`, which makes a perfectly valid MCP token read as invalid:

- `plus-service/src/store/askPostgresMethods.mjs:849`
- `plus-service/src/store/askSqliteMethods.mjs:802`
- `plus-service/src/store/memory.mjs:1038`

All three say `if (a.status !== "active" && a.status !== "trialing") return null;`. **Three copies — a fix that changes one and not the others will pass tests on the wrong store.** Postgres is production (`ATOMS_PLUS_STORE=postgres` in `plus-service/fly.toml`).

Note `accountFromMcpToken` calls `refreshAccountStatus` immediately before this check, so the status it tests is freshly normalized through `applyStatusRules`.

### Layer 2 — `entitled()` on the Plus-session routes

`plus-service/src/mirror/http.mjs:23` — `a.status === "active" || a.status === "trialing"` — guards eight routes:

| Line | Route |
|---|---|
| 86 | `GET /v1/ask/mirror/status` |
| 97 | `POST /v1/ask/mcp/pair` |
| 140 | `POST /v1/ask/mirror/expand-backfill` |
| 178 | `POST /v1/ask/outbox/pull` |
| 196 | `POST /v1/ask/outbox/ack` |
| 225 | `POST /v1/ask/mirror/delete` |
| 260 | `POST /v1/ask/mirror/reconcile` |
| 346 | `POST /v1/ask/mirror/upsert` |

These are the *plugin's* surface (sync, pairing, status), not Claude's read path.

**Issue #441's own text is wrong about this** — it blames `entitled()` for search failing. Search goes through MCP, which never touches `entitled()`. Correct the issue as part of this work rather than leaving the wrong map on it.

## Next steps

1. **Re-verify the three `accountFromMcpToken` lines and the `entitled()` gate still read as described.** They are the load-bearing claims; master may have moved.
2. **Claim the work** per `docs/collab.md` — #441 already exists and needs assigning to you; add the STATUS.md row and open a **draft** PR before implementing. `STATUS.md` is currently `_Nothing in flight._`.
3. **Split the two meanings server-side.** The server has everything it needs: `period_end` in the future + `remaining <= 0` is a spent meter; `period_end` in the past is an ended period. This mirrors what `plusLapse` does on the client in `src/platform/filingAuth.ts` — prefer making the server's split legible in one named helper rather than inlining the comparison in four places, for the same reason the client has one home.
4. **Let a spent meter keep Ask/MCP reads.** Layer 1 must stop returning `null` for a spent-meter account. Layer 2's read-ish routes (`mirror/status`, and pairing — see open question) follow.
5. **Keep an *ended period* revoking.** That is correct behavior and #443 built the whole client story around telling the user about it. Do not widen this fix into "exhausted always works".
6. **Tests across all three stores.** `plus-service/test/` — a spent-meter account keeps MCP; an ended-period account does not; the boundary at `period_end` behaves. The three-copy shape is exactly where a partial fix hides.
7. **Shipping tail** per CLAUDE.md: `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa`, then PR with `Closes #441`.
8. **This is server-side — it needs a Fly deploy to take effect.** A merged PR alone changes nothing for users. Say so explicitly in the PR.

## Key files

- `plus-service/src/store/askPostgresMethods.mjs:849` — production MCP gate
- `plus-service/src/store/askSqliteMethods.mjs:802` — same, sqlite
- `plus-service/src/store/memory.mjs:1038` — same, memory
- `plus-service/src/mirror/http.mjs:23` — `entitled()`, 8 Plus-session gates
- `plus-service/src/store/shared.mjs:285` — `applyStatusRules`, sets exhausted on period end
- `plus-service/src/store/postgres.mjs:620` — the meter sets exhausted on the last filing
- `src/platform/filingAuth.ts` — `plusLapse` / `plusNeedsPeriodRefresh`, the client's split; the server's should rhyme
- `docs/solutions/logic-errors/a-device-may-not-assert-an-entitlement-the-server-has-not-confirmed.md` — read before starting
- `CONCEPTS.md` § "Ended period vs spent meter" — the vocabulary

## Decisions & constraints

- **Settled by the owner: a spent monthly meter does not revoke Ask/MCP while the subscription is active.** Implement, do not relitigate.
- **An ended period still revokes.** Different situation, different remedy — that distinction is the entire point of #442/#443.
- The plugin is a **multiplayer repo**: hard claim (assigned issue + STATUS row + draft PR) before implementation. See `docs/collab.md`.
- Three store implementations must stay in agreement. Postgres is production.
- Never point automation at the personal Remote Vault; agent QA uses `test_vault/test vault` only.
- A local dev Plus service runs on `http://127.0.0.1:8799` and the **test vault is pointed at it** (`plusBaseUrl` in that vault's `data.json`). Remote Vault correctly points at production. This tripped up a live debugging session — a sign-in link requested from the test vault goes to localhost and only prints to that server's console.

## Open questions / blockers

- **Do Ask *writes* survive a spent meter?** The owner's decision names MCP *access*, and reading is unambiguous. But the Ask outbox lets Claude create atoms, and an atom created that way is arguably a filing — which is the metered thing. `accountFromMcpToken` already returns `mcpScopes` (default `["atoms:read"]`), so withholding write scope while keeping read is a clean available shape. **Raise this with the owner; do not decide it silently.**
- **Does pairing survive a spent meter?** Pairing is setup rather than read. A subscriber adding a second device mid-period has a fair claim to it; the argument the other way is weaker than for reads.
- Nobody has yet reproduced #441 live — it is reachable by construction from the code above, but no account has hit the cap with an active subscription. Consider seeding a spent-meter account against the local dev service rather than waiting for production.

## Git state

- Branch `claude/plus-meter-keeps-ask-441` (base `master`), pushed to `origin`.
- Last real commit on master: `1ab2dab fix(ask): a shortened error message stops on a whole word (#447)`
- WIP snapshot commit: `146656e` — `wip: handoff snapshot — plus-meter-keeps-ask-441`
- Diff since base: this handoff doc only; no code changes yet.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mcp-entitlement-debug-7e9fce
git fetch origin && git switch claude/plus-meter-keeps-ask-441 && git pull --ff-only
npm install
npm test          # root plugin suite
cd plus-service && npm install && npm test   # the service you are actually changing
```

Then continue from **Next steps** above.
