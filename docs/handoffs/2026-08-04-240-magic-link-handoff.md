---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T02:50:00Z"
title: "#240 — the sign-in link signs in the browser, not the plugin"
summary: "Root cause confirmed in code: the magic-link exchange mints a session the browser holds and the plugin never receives, so Refresh status has nothing to refresh. Needs design, not a patch."
keywords: ["plus", "magic-link", "sign-in", "240", "exchange", "session-handoff", "brainstorm"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/qa-phase-a-data-loss-be9fb1"
resume_focus: "Run ce-brainstorm on #240 — how a browser-completed magic link reaches the plugin without copy-paste"
repository: "taihartman/obsidian-atoms"
branch: "fix/280-single-flight-plus-resume"
head: "a0c3112"
---

# #240 — the sign-in link signs in the browser, not the plugin

Next session's job. **Start with `ce-brainstorm`, not code** — this is a missing channel, not a bug in an existing one.

## What the user hit (2026-08-04, real device)

Tapped **Send sign-in link** in Settings → Atoms Plus, opened the emailed link on the phone. The page said:

> **Signed in** — Email: tai.piplup@gmail.com — Status: **trialing** · remaining 131
> **Switch back to Obsidian → Settings → Atoms Plus → Refresh status.**

Switched back, pressed **Refresh status**. Nothing happened — Settings still showed the signed-out state (Start free trial / Sign in on another device / Advanced: paste session).

## Root cause — confirmed in code, not inferred

The instruction on that page is wrong for the case the button exists to serve.

- `plus-service/src/server.mjs` — `GET /v1/auth/exchange` calls `store.exchangeMagic(token)` and renders HTML. The minted session lands in the **browser**, displayed behind `<summary>Advanced: session token</summary>`. Nothing transmits it to the plugin.
- `plus-service/src/server.mjs` — `POST /v1/auth/exchange` exists and would do the right thing, but it needs the token, and the token was consumed by the browser opening the link.
- Plugin-side, **Refresh status** refreshes an *existing* local session (`refreshPlusEntitlementRecord` in `src/platform/plusRefresh.ts`, reached from `src/settings/settings.ts`). On a device that has never had a session there is nothing to refresh, so the button is a no-op by construction.

So "Refresh status here" only works on a device that is *already* signed in — precisely not the "Sign in on another device" case. The `Advanced: paste session` field is the only working path, and #240 exists to delete it.

**Not** a regression from tonight's work. #280/#282 (PR #281) touched the post-checkout poll, which is a different flow: it is armed by the **awaiting-checkout** flag, which a magic-link sign-in never sets.

## Design space (for the brainstorm — none of these is chosen)

1. **Obsidian URI deep link.** The exchange page redirects to `obsidian://…` carrying the session. Zero user steps. Needs a protocol handler registration and a think about putting a session token in a URI — see the constitution's log-safety and secret-handling rules.
2. **Plugin-side pending-exchange poll.** Plugin remembers "I emailed a link to X" and polls a short-lived endpoint until the browser completes the exchange. Reuses the shape the post-checkout poll already has — and that poll's hard-won lesson applies directly: announce atomically, keep requests redundant (`docs/solutions/logic-errors/a-shared-promise-dedupes-the-retries-too.md`).
3. **Pairing code, reversed.** The repo already has an **Ask MCP pairing code** (see `CONCEPTS.md`) — short-lived, single-use, minted *from* a verified plugin session. This is the opposite direction (no plugin session exists yet), so it is a sibling design, not a reuse.

Option 2 is the most conservative and the closest to existing machinery. Option 1 is the best user experience. Decide in the brainstorm, not here.

## State of everything else — all clear

| Item | Status |
|---|---|
| [#280](https://github.com/taihartman/obsidian-atoms/issues/280) / [#282](https://github.com/taihartman/obsidian-atoms/issues/282) — duplicate notices + listener leak | [PR #281](https://github.com/taihartman/obsidian-atoms/pull/281) open, CI green, `CLEAN`, ready for review. **0.6.72** |
| #238 reconcile + alerts | Merged, **deployed** (Fly v43). `ATOMS_PLUS_ALERT_EMAIL` set to taihartmandevelopment@gmail.com |
| #239 postgres coverage | Merged |
| `test` required check on `master` | **Live.** `paths:` filter removed so it cannot wedge unrelated PRs |
| #230 release gate — real trial signup | **PASSED tonight.** First real card, entitlement granted, session survived |
| STATUS.md | Carries the #280 row; clear it after PR #281 merges |

Still unclaimed: [#241](https://github.com/taihartman/obsidian-atoms/issues/241) (polling window) and [#242](https://github.com/taihartman/obsidian-atoms/issues/242) (obsidian typings pin).

**#241 has a hard ordering dependency:** it widens the post-checkout polling window, and it must land *after* PR #281. More polls in flight without #281's atomic announce is #280 again, worse.

## Machine-local warnings

- This worktree is the **nested** `.claude/worktrees/qa-phase-a-data-loss-be9fb1`, which CLAUDE.md prohibits. Start #240 in a proper sibling worktree (`ce-worktree`).
- `.compound-engineering/config.local.yaml` (`cross_model_peer: grok`) is gitignored — recreate it in any new checkout that runs `ce-code-review`.
- **The grok peer returned no usable output this session.** It ran and produced findings, but double-encoded them inside a `text` field, so the schema fold-in dropped them. Budget for that route being unreliable; per the one-strike rule, do not pay for a retry expecting a different shape.
- No local postgres and no Docker on this machine — `plus-service` postgres coverage only runs in CI.
