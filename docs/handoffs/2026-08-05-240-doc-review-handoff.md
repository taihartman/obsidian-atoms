---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T03:20:00Z"
title: "#240 — requirements plan written, needs doc-review before any code"
summary: "The magic-link handoff brainstorm is done and the requirements plan is committed and pushed. Next session runs a light ce-doc-review on it, then the hard claim, then ce-plan. Do not start implementing."
keywords: ["plus", "magic-link", "240", "obsidian-uri", "doc-review", "brainstorm-done"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
resume_focus: "Run a light ce-doc-review on docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md, then hard-claim #240"
repository: "taihartman/obsidian-atoms"
branch: "feat/240-magic-link-handoff"
head: "3441a4f"
---

# #240 — requirements plan written, needs doc-review before any code

**Start with `ce-doc-review`, not `ce-work`.** The project's plan quality gate requires at least a light
doc-review after a plan lands in `docs/plans/` and before implementation. The plan is unreviewed.

## Where everything is

| Item | Path / ref |
|---|---|
| Worktree | `/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link` (proper sibling, not nested) |
| Branch | `feat/240-magic-link-handoff`, pushed, tracking origin |
| The plan | `docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md` (commit `3441a4f`) |
| Issue | [#240](https://github.com/taihartman/obsidian-atoms/issues/240) — **not yet assigned, no STATUS row, no draft PR** |

The hard claim has **not** been made. Do it after doc-review, before implementation: assign #240,
add the `STATUS.md` row, open a draft PR.

## What the brainstorm settled

Four decisions are marked `session-settled` in the plan. They are the user's own calls — inherit them
into plan KTDs, do not re-open them:

1. **Same-device only.** The link opens in the phone browser and hands off to Obsidian on that phone.
2. **No fallback code in this change.** A page that cannot reach Obsidian tells the user to reopen the
   email on the device running Obsidian. The typable code is [#286](https://github.com/taihartman/obsidian-atoms/issues/286), explicitly ordered after this.
3. **`Advanced: paste session` is deleted here**, not kept until #286 ships. The user accepted the
   resulting recovery gap knowingly; it is written into the plan's Scope Boundaries.
4. **Always confirm the account email before writing a session.** The device-local pending flag only
   shapes the confirmation copy — it never silently rejects. A silent gate would rebuild #240's own
   symptom: "I tapped it and nothing happened."

Four more decisions came from the design falling out of those constraints (KD5–KD8): the URI carries the
**magic token, never the session**; the landing-page GET stops consuming (which retires the mail-prefetch
burn for free); the link is stamped with the requesting vault; the page checks validity without consuming.

## The risk that matters

`obsidian://` firing from mobile mail clients and in-app browsers on iOS and Android is **unverified**.
The plugin registers no protocol handler today — `registerObsidianProtocolHandler` has zero matches in
`src/`, `test/`, or `plus-service/`. This is net-new surface, and it is the single biggest thing that
could invalidate the design.

The release gate is a real-device test. This echoes #230, where the automated test proved the mechanism
and a human still had to walk the live path. **A green test suite is not this feature working.**

If doc-review or planning wants to de-risk early, the cheapest probe is registering a trivial handler and
opening an `obsidian://` URL from a real phone's mail client before building anything else.

## Also filed this session — all unclaimed

Three issues from the same dogfood, all grounded in code with `file:line`, none started:

| Issue | What |
|---|---|
| [#284](https://github.com/taihartman/obsidian-atoms/issues/284) | Sign-out revokes one session row and nothing else. The old account's MCP grants stay live, and the device-global `atoms-ask-mirror-*` state (hashes, cached count, cached email) carries into the next account. Explains both the "MCP still connected" and the stale-count symptoms. |
| [#285](https://github.com/taihartman/obsidian-atoms/issues/285) | "Wipe cloud copy" resets the local hash map to `{}`, so the next sync re-uploads the whole vault and the wipe appears to undo itself. The one-way rule is **not** violated — the atoms came back from the vault. |
| [#286](https://github.com/taihartman/obsidian-atoms/issues/286) | The typable cross-device claim code. Depends on #240. Reuse shape, not code: Ask MCP pairing codes are 8-char Crockford Base32, hashed, 10-min TTL. |

One correction worth carrying: the reported "mirror says 90, vault has 60" was **partly a labelling bug**,
not only stale state — the mirror also uploads hub notes from outside `Atoms/` and the server counts those
rows. Both halves are in #284.

## State of everything else

- **PR #283 merged** (`cd8adfe`) — `STATUS.md` in-flight table is empty. Nothing is claimed.
- #280/#282 shipped in PR #281 at **0.6.72**. **[#241](https://github.com/taihartman/obsidian-atoms/issues/241) still must land on top of that** — widening the post-checkout poll window without #281's atomic announce is #280 again, worse.
- [#242](https://github.com/taihartman/obsidian-atoms/issues/242) (obsidian typings pin) still unclaimed.

## Machine-local warnings

- `.compound-engineering/config.local.yaml` (`cross_model_peer: grok`) is gitignored and **does not exist in
  this worktree**. Recreate it before running `ce-code-review` here.
- The grok peer produced no usable output in the previous session (double-encoded its findings inside a
  `text` field). One-strike rule applies — do not pay for a retry expecting a different shape.
- The old nested worktree `.claude/worktrees/qa-phase-a-data-loss-be9fb1` still holds the merged
  `chore/status-clear-280` branch, which is why that branch could not be deleted locally. Both are safe to
  remove.
- No local postgres and no Docker — `plus-service` postgres coverage only runs in CI.
