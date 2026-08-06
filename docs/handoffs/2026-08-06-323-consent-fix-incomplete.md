---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-06T16:05:00Z"
title: "#323 consent fix narrows the bypass but does not close it — F1 is the work"
summary: "PR #330 implements the missing onExternalSettingsChange hook correctly, but runSyncOnce has no consent gate so a follow-up mirror pass still uploads note bodies after a withdrawal; the tests assert a proxy that stays green while it happens."
keywords: ["323", "330", "consent", "ask-mirror", "onExternalSettingsChange", "runSyncOnce", "egress", "code-review"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c"
resume_focus: "Gate runSyncOnce on consent, clear the pending follow-up when a withdrawal lands, and land a test that drives a real egress path"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e"
branch: "fix/ask-consent-cross-device"
head: "2762612"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c"
---

# #323 — the consent fix is real but incomplete

> **Where this file lives.** On branch `fix/ask-consent-cross-device`, **not on master**. It is
> linked from [PR #330](https://github.com/taihartman/obsidian-atoms/pull/330) so it is reachable
> from the issue. This session lost ~an hour to exactly this trap in reverse — see "The mistake
> that cost the most" below — so if you are resuming and cannot find a referenced file, search the
> remote branches before concluding it does not exist.

## State

[PR #330](https://github.com/taihartman/obsidian-atoms/pull/330) — **draft**, deliberately.
Branch `fix/ask-consent-cross-device` @ `2762612`, four commits, working tree clean.
Version bumped to **0.6.80**; master is still `0.6.79`, so that bump is uncontested today.
CI green on both required checks (`test` and `test + build` — the latter became required this
morning and #330 was the first PR to exercise it).

Master has moved to `9fb4fa4` since this branch's base. The new work (#331/#332, Ask
`search_atoms` signal) is **server-side only** — `plus-service/src/mcp/*` — so it does not touch
this branch's files. A rebase should be clean apart from `STATUS.md`.

## What the fix does, and what it misses

**Does:** implements `Plugin.onExternalSettingsChange()` in `src/plugin/main.ts`, which did not
exist. Before this, `loadData()` had exactly one call site (startup) and nothing repopulated
`plugin.settings` ever again — so a consent withdrawn on the phone never reached an already-running
desktop. That diagnosis is confirmed, not suspected. The hook reloads, re-renders an open Settings
screen, skips the rebuild when nothing changed, and deliberately declines to read a half-written
file as a withdrawal.

**Misses:** the hook closes the gate for *future* egress entries. It does not stop a pass that is
already running or already scheduled.

Full review with evidence: [`docs/qa/2026-08-06-323-ce-code-review.md`](../qa/2026-08-06-323-ce-code-review.md).
Read it before touching the code — it carries the reproduction sequences.

## F1 is the work — P1, and the reason the PR is draft

`runSyncOnce` (`src/plugin/askCoordinator.ts:234`) has **no consent gate**. The only check lives in
`sync()` at `:212`, before the single-flight begins. `src/plugin/catchUp.ts:74-88` then runs
follow-up passes in a `do { await host.once(...) } while (s.followUp)` loop that never re-enters
`sync()`.

Sequence:

1. `sync()` passes the gate, `inFlight = true`, `runSyncOnce` starts upserting.
2. A vault edit calls `scheduleSync`, which still sees consent, so `followUp = true`.
3. The phone's withdrawal lands; the hook replaces `plugin.settings`.
4. The first pass finishes.
5. `while (followUp)` runs `runSyncOnce` again and uploads bodies **under revoked consent**.

Fix shape: gate `runSyncOnce` itself, and when the hook observes a withdrawal, clear
`askMirrorFlight.followUp` / `forceFollowUp`, cancel `askMirrorDebounceTimer`, and set
`askMirrorDirty = false` so no second pass is owed. Aborting an in-flight HTTP upsert mid-body is
the ideal and is a bigger change; the re-check alone closes the follow-up hole.

## The test problem — do not skip this

`test/askConsentCrossDevice.test.ts` asserts `plugin.settings.askPrivacyAckAt === ""` and a fake
tab's refresh counter. It never constructs `AskCoordinator`, never calls `scheduleSync`/`sync`
after a withdrawal, never observes a refused push.

The production failure mode is *post-withdrawal body upload*. The tests assert a **proxy** for it
that is true while that upload still runs. The mutation testing in the commit messages is real but
proves only the reload mechanism, which was never the risk.

Any F1 fix must land with a test that drives a real egress path: stub the network upsert, run the
withdrawal through the hook, assert no upsert — plus the follow-up case, where a pass is already in
flight with `followUp` set.

## The other four findings

| # | Sev | Where | What |
|---|---|---|---|
| F2 | P1 | `main.ts:1440` | External reload can clobber an in-flight local withdrawal and persist the resurrected grant back through Sync. Classic read-modify-write lost update on a synced file — this repo already documented that pattern at `docs/solutions/logic-errors/read-modify-write-lost-update-synced-file.md`. **Read it first.** |
| F3 | P2 | `main.ts:247` | `settings: this.settings` aliases the object into `signInHandoff.ready()`, which stores it permanently. `loadSettings()` *replaces* the object, so sign-in reads the startup `plusBaseUrl` forever. Not a consent bypass, but it is a live violation of the "never alias `plugin.settings`" invariant the fix's own comment declares. Fix the alias or stop claiming the invariant. |
| F4 | P1 | `main.ts:1416` | `(await this.loadData()) ?? {}` is right at startup, wrong from the hook: a non-throwing empty read wipes every setting at runtime and the next save persists that wipe to every device. The catch only covers the *throwing* shape. |
| F5 | P3 | `settings.ts:565` | `refreshFromExternalSettings()` only calls `redisplay()`, while `hide()` settles an open sheet with `openSheet?.close()`. A consent sheet can stay open above a rebuilt DOM reflecting the remote withdrawal. |

## Review provenance

Three reviewers in genuinely separate contexts: correctness, security, and a cross-model
adversarial pass on `grok-cli` with `independence_verified: true` (`model_requested: grok-4.5`,
`effort_requested: high`; served model/effort unverified — that route carries no receipt). All
three independently found F1 and F3, which is why they are stated as fact rather than suspicion.

**Reduced roster, disclosed:** testing, project-standards, and learnings did **not** run — session
budget. The learnings corpus hit that motivated selecting it (`read-modify-write-lost-update-synced-file.md`)
describes F2 exactly, so read it manually.

## Do not redo

- **The diagnosis.** `onExternalSettingsChange` was genuinely absent; `loadData()` genuinely had one
  call site. Verified against `node_modules/obsidian/obsidian.d.ts:5085`.
- **The `JSON.stringify` re-render guard.** It survived adversarial review. It gates only the
  re-render, never whether settings are applied, and it can produce false *inequality* but not false
  equality — worst case is a stale screen, never a stale gate.
- **Not inventing a blank read as a withdrawal.** Also survived; blank and withdrawn are
  indistinguishable and the swallow is correct for the *throwing* case. F4 is about the
  non-throwing case, which is a different path.
- **`devLog` is a no-op everywhere** and throws under vitest (`ATOMS_DEV_COMMANDS` is esbuild-injected).
  Do not "restore convention" by calling it in the catch — that breaks the tests and buys no
  diagnostics. A background task is filed to fix `devLog` itself.

## Adjacent claims, so you do not collide

- **#320 is unowned.** [PR #322](https://github.com/taihartman/obsidian-atoms/pull/322) is a
  *complete* U1–U7 multi-device-sessions implementation from a prior session, unreviewed since
  02:41 UTC. **Its version is `0.6.78-beta.2`, behind master, and its `versions.json` both drops the
  `0.6.79` entry and invents a `"0.6.78"` stable mapping that was never cut.** Re-derive the version
  from master; never resolve that conflict toward the branch. My own #328 was closed as a duplicate
  of it.
- **Another session owns #315/#314** (`fix/consent-wording-parity`, draft
  [PR #329](https://github.com/taihartman/obsidian-atoms/pull/329)) and edits `settings.ts` at the
  295–300 constants and extracts `ConsentSheetModal` from 2182+. F5 above touches `settings.ts:565`,
  clear of both — but F5 and their extraction are the same seam conceptually, so coordinate.
- Their rebase target was #330; I have told them it is no longer landing first.

## The mistake that cost the most

This session opened by resuming from the wrong handoff. The user named
`docs/handoffs/2026-08-06-multi-device-sessions.md`; it was not on master, so I substituted the
closest-matching filename and proceeded. The file existed the whole time — on the unmerged
`feat/320-multi-device-sessions` branch — and it said in its own words that #320's implementation
was complete and must not be re-implemented. I re-derived U1 anyway.

**Search the remote branches before declaring a referenced file missing.** A handoff that lives only
on a feature branch is invisible to `ls` on master, and that is the normal case, not the exception.
