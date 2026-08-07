---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-07T20:05:00Z"
title: "Fix the four Ask mirror consent holes found by #340 QA"
summary: "PR #340 shipped at 0.6.87; its adversarial QA proved four pre-existing holes in the Ask mirror surface, filed as #371-#374 and not yet started."
keywords: ["ask-mirror", "consent", "wipe", "plus-account", "371", "372", "373", "374", "settings.ts"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-340-ask-expand"
resume_focus: "Fix #371 and #374 together, then #372 with a real plan, then #373"
repository: "taihartman/obsidian-atoms"
branch: "master"
head: "5d922b9"
---

# Handoff — the four Ask mirror consent holes (#371–#374)

**Nothing here is started.** No branch, no claim, no code. Four GitHub issues exist with full
repros. This document explains what they are, what is already settled, and where the one real
design decision sits.

## What just finished (context, not work)

[PR #340](https://github.com/taihartman/obsidian-atoms/pull/340) merged to `master` as `8bcb5c9`.
**0.6.87 is released and live for BRAT users.** `ASK_PRIVACY_ACK_VERSION` moved to `2026-08-07` for
a seven-clause disclosure whose new clause (4) names Anthropic search-expansion egress, so every
existing device re-accepts before its mirror resumes. `STATUS.md` was cleared in #375; nothing from
that work is in flight.

`world-class-qa` + `adversarial-qa` ran live on the throwaway vault before merge. Scenarios A–F all
passed, both disclosures matched their source constants byte-for-byte, and zero bytes left the
device in any state without a current ack. Full record, including 17 committed screenshots:
`docs/qa/2026-08-07-340-ask-expand-world-class-qa.md`.

The adversarial half is what produced the four issues below. **All four are pre-existing on
`master`** — they live in `src/settings/settings.ts` and `src/platform/filingAuth.ts`, which #340
never touched. They were deferred deliberately, on the owner's call, so the consent improvement
could ship rather than wait behind a wider fix.

## The four holes

Read the issues for the full repros; this is the shape and the connective tissue between them.

### #371 — Wipe cloud copy undoes itself (P1)

`confirmWipeCloudCopy` (`src/settings/settings.ts:855`) wipes the server, then calls
`clearAskMirrorDeviceState`, which sets `LS_ASK_MIRROR_HASHES` to `{}` (`src/platform/askMirror.ts:659`)
— the device's record of what it has already pushed. It never touches `askEnabled` or either ack,
so the mirror is still armed while the device now believes it has uploaded nothing. That is exactly
the precondition for a full re-upload.

Measured: wipe → 407 rows → 0; **bare plugin reload, zero clicks → 407 rows back in 4 seconds**, with
`expand-backfill` re-firing. Wipe only sticks today if the ack is withdrawn first.

Suggested fix: Wipe also sets `askEnabled = false`, and the confirm-modal copy says so. Leave the
acks alone — they are the consent record, and the withdrawal row keys off the timestamp. **No ack
version bump needed**: clause (6) only becomes more true, and clause (7) is about the other direction.

### #372 — the mirror stays armed across sign-out (P1, plus a P2 symptom)

`signOutOfPlus` (`src/settings/settings.ts:1166`) clears the session and the refresh record and
nothing else. `mirrorPermitted()` (`src/plugin/askCoordinator.ts:122`) is
`askEnabled && askPrivacyAckIsCurrent` — no identity component. So signing in as a *different* Plus
account resumes upload **and** outbox-pull with no sheet: this vault's bodies go to a stranger's
cloud, and that cloud's outbox is polled for files to write here.

Keeping the ack **record** across sign-out is deliberate and correct — the source comment explains
it, and withdrawal has to stay reachable. What looks unconsidered is that `askEnabled` survives too.

The P2 symptom shares the root: account A's 407-path hash baseline survives into account B, so B's
first sync uploads nothing. One edit later B's cloud held **1 of 407 atoms** while Settings read
`last pushed just now`. Ask then answers from 1/407 while the plugin reports health.

### #373 — an unresponsive backend wedges the mirror (P2)

With the server hanging, `askMirrorFlight.inFlight` never releases. Later forced `Sync now` calls
return `{kind:"joined"}` with no network attempt, while the toast
(`src/shared/mirrorOutcome.ts:79`) says to press it again when the running sync finishes. It never
finishes; only a plugin reload clears it. Proven to 75 s plus a reload, not to infinity.

**This is the one nobody has read the code for yet.** Size it after reading the latch — it may want
an abort rather than a timer.

### #374 — the status line ignores consent (P2)

`mirrorStatusLine` (`src/settings/settings.ts:2109`) reads only device-local stamps and never
consults the gate. After withdrawing consent the Connect row still reads
`Ask mirror: 407 · as you@… · Sync now to retry`. Not a leak — zero egress was proven in that state
— but it tells someone who just revoked consent that their vault is still pushing, on the very
surface #340 exists to make honest. Reachable by **every** device that takes this upgrade.

## The one real decision, and it belongs at plan time

**#372's fix has two shapes and they trade differently.**

- **Simple:** sign-out sets `askEnabled = false` and calls `clearAskMirrorDeviceState`. Kills the
  cross-account egress and the stale baseline in one move. Cost: signing back into the *same*
  account re-uploads all 407 atoms once.
- **Careful:** key the hash baseline to an account identity and invalidate it when the signed-in
  email changes. Keeps the same-account fast path; larger change, more surface.

Settle this before writing code. It is the only question in the batch that a code reviewer cannot
answer for you.

## Suggested sequencing

Not a work order — this is how the pieces group, and the owner agreed to the shape on 2026-08-07.

1. **#371 + #374 together.** Both small, both in `settings.ts`, both about telling the truth on the
   consent surface. One branch, one PR.
2. **#372 on its own**, after the decision above is made. This is the one that deserves a real plan.
3. **#373 last**, after reading the latch.

## Before implementing anything

This is a multiplayer repo. `docs/collab.md` requires a **hard claim before code**: an assigned
GitHub Issue (they exist — #371–#374), a `STATUS.md` row, and a **draft PR**. `STATUS.md` is
currently clear of this work; two unrelated rows are in flight (#336, #307), neither touching
`src/settings/settings.ts`.

Lane: these are bugs, so `ce-debug` rather than the full feature loop — except #372, which is a
design change wearing a bug's clothes and wants `ce-plan` + a light `ce-doc-review` first. The
shipping tail is not optional: `ce-simplify-code` → `ce-code-review` → `ce-compound` →
`world-class-qa` (ending in `adversarial-qa`) → PR with `Closes #<issue>`.

Worktree: create at the sibling path `../obsidian_plugin-<branch>/`. **Do not reuse
`/Users/a515138832/StudioProjects/obsidian_plugin-340-ask-expand`** (this one — #340's, now spent)
and do not touch the owner's main checkout at `/Users/a515138832/StudioProjects/obsidian_plugin`.

## Traps that will cost you time

- **Never run `npm test` or `npm run build`** — they delete
  `docs/field-notes/published/2026-08-01-sample-loop.json` (issue #343). Use `npx vitest run` and,
  in `plus-service`, `node --test test/*.test.mjs`. The install script does call `npm run build`;
  that turned out to be harmless on a clean tree, but check `git status` after.
- **Vault lane is absolute.** `test_vault/test vault` only, never `~/Documents/Remote Vault`. Note
  the test vault lives in the **main checkout**, not in a worktree — pass it explicitly:
  `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`.
- **Settings can only be screenshotted at phone width.** On desktop it opens in a popout window that
  `dev:screenshot` cannot see. Resize to 390×844 and assert `is-phone` first. All the driving
  idioms — two-eval reopen, second-modal selection, vault-relative screenshot paths — are in
  `docs/qa/app-navigation-map.md` § Settings → Atoms, and they were correct as of 2026-08-07.
- **After `plugin:reload` the open Settings tab holds DOM from the dead instance.** Close and reopen
  it or every row lookup fails for reasons that look like a bug.
- **`git diff --name-only origin/master...HEAD` before believing any claim about what a branch
  changed.** The whole reason these four are filed rather than fixed is that they turned out to be
  in files #340 never touched — which took one command to establish and would have derailed the
  merge otherwise.

## Verifying a fix

`scripts/qa-egress-sentinel.mjs` (landed with this handoff) stands in for `plus-service` on
localhost, records every request, and refuses it. Point `plusBaseUrl` at it — Settings → Atoms →
Advanced → Plus service URL override — and the log becomes evidence of what the client *tried* to
send. Essential for #371 and #372, where the whole claim is "this no longer uploads."

**Pair every empty log with a positive control**, or an empty file proves nothing but a broken
probe. The reasoning is written up in
`docs/solutions/workflow-issues/prove-a-gate-held-with-an-egress-sentinel-not-an-assumption.md`.

Test coverage is thin exactly where these bugs live, so each fix should ship the regression test
that was missing:

| Hole | The test that does not exist |
|---|---|
| #371 | `grep -rn "mirror/wipe\|expand-backfill" test/` → 0 hits; `plusClient.test.ts` has no `askMirrorWipe` case, and nothing asserts clause (6)'s promise |
| #372 | **No test anywhere signs out one identity and signs a different email in.** Every Ask test uses the literal `user@example.com`. Nothing asserts what sign-out clears |
| #373 | Nothing asserts that a never-settling request wedges single-flight |
| general | Stale-version tests assert the `mirrorPermitted()` boolean only — none drives `sync({force:true})` under a stale version and asserts zero network |

## Also open, unrelated to these four

**`plus-service` is not deployed to Fly.** Search expansion is inert in production whatever
`ASK_EXPAND_ENABLED` says, because egress is double-gated on `config.anthropicApiKey`. That is the
owner's act, not a coding task, and it has no issue.

## Authoritative references

- Issues [#371](https://github.com/taihartman/obsidian-atoms/issues/371),
  [#372](https://github.com/taihartman/obsidian-atoms/issues/372),
  [#373](https://github.com/taihartman/obsidian-atoms/issues/373),
  [#374](https://github.com/taihartman/obsidian-atoms/issues/374) — repros and suggested fixes
- `docs/qa/2026-08-07-340-ask-expand-world-class-qa.md` — the pass that found them; § Adversarial
  has the full scenario ledger, including the ~20 attacks that came back **solid**, so you do not
  re-run them
- `docs/qa/app-navigation-map.md` § Settings → Atoms — how to drive this surface
- `docs/solutions/security/a-consent-version-only-the-client-checks-does-not-gate-the-server.md` —
  the accepted risk; do not re-litigate it or quietly implement a server-side gate
- `src/shared/askAck.ts` — the gate predicates, heavily commented with the reasoning behind each
