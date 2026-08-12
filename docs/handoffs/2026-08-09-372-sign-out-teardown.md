---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-09T16:35:00Z"
title: "#372 — sign-out leaves the mirror armed, so a different Plus account inherits both consents"
summary: "The shape decision is settled (simple: sign-out disarms and clears device state). Nothing is started; #371/#374 shipped in 0.6.88 and moved the ground under the issue's line numbers."
keywords: ["372", "sign-out", "ask-mirror", "consent", "cross-account", "egress", "settings.ts"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin"
resume_focus: "Plan and ship #372 with the simple shape, then decide whether #284 follows immediately"
repository: "taihartman/obsidian-atoms"
branch: "master"
head: "8104484"
---

# Handoff — #372, sign-out teardown

**Nothing is started.** No claim, no branch, no code. The one decision that was blocking it is now
made. This document exists so a fresh session does not re-derive it.

## The decision, already made

**Simple shape, settled by the owner on 2026-08-09.** Sign-out sets `askEnabled = false` and calls
`clearAskMirrorDeviceState`. That kills the cross-account egress and the stale hash baseline in one
move.

**The accepted cost:** signing back into the *same* account re-uploads all ~407 atoms once, which
also re-fires `expand-backfill` and its Anthropic spend. That was weighed against the alternative
(binding the hash baseline to an account identity and invalidating on email change, which keeps the
same-account fast path) and rejected for now — a security hole should not wait behind an
optimization. **Do not re-litigate this at plan time.** If same-account re-sign-in turns out to be
common in practice, the account-keyed baseline is a follow-up, not a blocker.

The acks stay. Keeping the ack *record* across sign-out is deliberate and correct: withdrawal has
to stay reachable, and the withdrawal row keys off the timestamp. Only `askEnabled` and the device
state go.

## What #372 is

Grant both Ask consents as account A, sign out with the real button, sign in as account C, reload.
No sheet, no prompt, and the vault immediately talks to C's cloud **in both directions** — this
vault's atom bodies upload to C, and C's outbox is polled and may create files here.

Second symptom, same root: A's 407-path hash baseline survives into B, so B's first sync uploads
nothing. One edit later B's cloud held **1 of 407** atoms while Settings read `last pushed just
now`. Ask answers from 1/407 while the plugin reports health.

Full repro and request log: [issue #372](https://github.com/taihartman/obsidian-atoms/issues/372).

## What moved under the issue since it was written

`#371`/`#374` shipped in **0.6.88** (PR #385, merged `ef0130f`). Three things changed that matter
here, and the issue's line numbers predate all of them.

1. **The egress gate has one home.** `askMirrorPermitted(settings)` in `src/shared/askAck.ts:133`
   is now the predicate; `AskCoordinator.mirrorPermitted()` (`askCoordinator.ts:119`) delegates to
   it, and so does the settings screen. If the fix needs to ask "may this push", ask that function.
   Do not add a fourth copy — see
   [the learning](../solutions/workflow-issues/extracting-a-one-home-predicate-does-not-find-the-copy-already-there.md),
   which exists because the extraction itself missed a pre-existing duplicate.

2. **The wipe path already does exactly this move**, and got the ordering right the hard way. In
   `confirmWipeCloudCopy` (`src/settings/settings.ts`), the disarm is set **and persisted** before
   `clearAskMirrorDeviceState` runs. That order is load-bearing: the other way round, a crash
   between the two leaves an armed mirror with an empty baseline, which is `#371` itself. **Copy
   this ordering into sign-out.** Read that block before writing the sign-out version.

3. **There is one sign-out site, not three.** The issue cites `settings.ts:350, :407, :457` from an
   older layout. Verified against `8104484`: `clearPlusSession` has exactly **one** production
   caller, `signOutOfPlus` at `src/settings/settings.ts:1176`, whose body clears the session and
   the refresh record and nothing else (`:1186-1187`). The teardown has a single home to land in.

## Lane and process

This is a design change wearing a bug's clothes, so it is **not** the plain debug lane:
`ce-plan` → light `ce-doc-review` → `ce-work` → the shipping tail (`ce-simplify-code` →
`ce-code-review` → `ce-compound` → `world-class-qa` ending in `adversarial-qa`).

Multiplayer claim before any code: assigned issue (#372 exists), a `STATUS.md` row, and a **draft
PR**. At the time of writing, STATUS holds only `#336` and `#307`, neither touching
`src/settings/settings.ts`.

Worktree at the sibling path `../obsidian_plugin-<branch>/`. Do not work in the owner's main
checkout at `/Users/a515138832/StudioProjects/obsidian_plugin` — it is dirty and tens of commits
behind master.

## The test that does not exist

**No test anywhere signs out one identity and signs a different email in.** Every Ask test uses the
literal `user@example.com`; `readAskMirrorEmail` / `LS_ASK_MIRROR_EMAIL` have zero test hits.
Nothing asserts what sign-out clears. That gap is why this bug shipped, so the fix should land the
identity-switch test as its regression test — at the settings level, through the
`test/helpers/settingsTab.ts` harness, which can seed a session and assert on `plugin.settings`
and device-local keys after the gesture.

## Traps that will cost time

- **Never run `npm test` or `npm run build`** — `npm test` deletes
  `docs/field-notes/published/2026-08-01-sample-loop.json` (issue #343). Use `npx vitest run` and
  `npx tsc --noEmit`. A fresh worktree needs `npm install` first.
- **Vault lane is absolute.** `test_vault/test vault` only, and it lives in the **main checkout**,
  not in a worktree: `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`.
  Never `~/Documents/Remote Vault`.
- **Settings screenshots only at phone width** (390x844, assert `is-phone`); desktop opens a popout
  `dev:screenshot` cannot see.
- **`dev:screenshot` can return the frame from before your last re-render** — verified 2026-08-08,
  it produced a full evidence set shifted by one that looked entirely plausible. Capture twice, keep
  only when the pair is byte-identical *and* differs from the previous state's frame, then look at
  the images. Details in `docs/qa/app-navigation-map.md`.
- **After `plugin:reload` the open Settings tab holds DOM from the dead instance.** Close and reopen.
- All the driving idioms are in `docs/qa/app-navigation-map.md` § Settings → Atoms.

## Verifying it

`scripts/qa-egress-sentinel.mjs` stands in for `plus-service` on localhost, records every request,
and refuses it. Point `plusBaseUrl` at it via Settings → Atoms → Advanced → Plus service URL
override. The claim under test is "signing in as a different account uploads nothing", so an empty
log is the evidence — **and an empty log proves nothing without a positive control**, because a
broken probe looks identical. Reasoning:
`docs/solutions/workflow-issues/prove-a-gate-held-with-an-egress-sentinel-not-an-assumption.md`.

Be honest about what a stub cannot show. The `#371` QA proved the device stops pushing and marked
the server-side effects **Blocked**, because a stub agreeing with itself is not evidence about a
server. Same limit applies here.

## Not this issue

**#284 is not a duplicate of #372** — it is the server-side half, and it stays open either way:
MCP grants are keyed by email and sign-out never calls `mcpRevokeForEmail`, so the connector stays
live for the signed-out account; the previous account's rows become unreachable after a switch; and
the mirror count labels hub notes as atoms. It also carries an unresolved design question — whether
revoking on sign-out should kill the pairing on the user's *other* devices, since grants are
per-email rather than per-device. Decide that deliberately, in its own plan, not as a side effect
of this one. Both issues carry cross-linking comments explaining the split.

Also still open and unrelated to the fix: **`plus-service` is not deployed to Fly.** That is the
owner's act, not a coding task.

## Authoritative references

- [#372](https://github.com/taihartman/obsidian-atoms/issues/372) — repro, request log, both symptoms
- [#284](https://github.com/taihartman/obsidian-atoms/issues/284) — the server-side half
- `src/shared/askAck.ts` — the gate predicates, heavily commented with the reasoning behind each
- `src/settings/settings.ts` — `signOutOfPlus` (`:1176`) is the fix site; `confirmWipeCloudCopy` is
  the ordering to copy
- `docs/qa/2026-08-08-371-374-mirror-consent-truth-world-class-qa.md` — the QA shape this should
  match, including how it reports what it could not reach
