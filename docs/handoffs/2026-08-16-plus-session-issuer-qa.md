---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-16T19:20:00Z"
title: "#508 plus session issuer: code is done and reviewed, QA is not"
summary: "R1, R2 and D1 landed and a full multi-agent + cross-model review closed out; what remains on #508 is world-class-qa, the PR body, and one filed risk."
keywords: ["508", "plus", "issuer-gate", "plusRefresh", "world-class-qa", "PR-526"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c"
resume_focus: "Run world-class-qa ending in adversarial-qa, then write the PR body on #526."
repository: "taihartman/obsidian-atoms"
branch: "claude/plus-session-issuer"
head: "a093310913b6b7b5cfa1dad74e98ac58cade304f"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c"
---

# Handoff — #508: the code half is finished; QA has never run

**Supersedes [`2026-08-15-plus-session-issuer.md`](2026-08-15-plus-session-issuer.md).** That doc's Traps
section is still worth reading and is not repeated here in full. Its "two known regressions at head"
and its D1 question are both resolved.

**The plan remains the authority:**
[`docs/plans/2026-08-15-001-fix-plus-session-issuer-plan.md`](../plans/2026-08-15-001-fix-plus-session-issuer-plan.md).

## State in one line

Every unit, every regression fix, and the whole review tail are landed and pushed. **No QA of any kind
has run against a live vault.** That, the PR body, and one filed issue are all that is left.

## What this session did

| Commit | What |
|---|---|
| `aaaf75e` | **R1** — a `/v1/me` 2xx naming a different account records `kind: "failed"`, not `"rejected"`, so no sign-in-link CTA points back at that base. **R2** — `refreshPlusEntitlementRecord` re-reads the disk session after its await instead of spreading the pre-await argument, so a stamp landing mid-flight survives. |
| `62b87f5` | **D1** — a Settings → Account row, `Confirm the Plus address`, shown only when the session has no stamp and `plusBaseUrl` is empty. Its button writes `DEFAULT_PLUS_BASE_URL`. The user chose to fold this into #508 rather than ship and file. |
| `a093310` | The code review's surviving findings, applied. |

`npm run build && npm test && npm run lint` green at each. **2044 tests** at head. Every new guard is
neuter-verified: broken, watched go red on a named test, restored.

## The review, and what it changed

A full `ce-code-review` ran on `0f31b35..62b87f5`: correctness, security, reliability, testing and
project-standards locally, with the adversarial lens on **grok-4.6 at medium** (`independence_verified:
true`; the route carries no receipt, so served model and effort are unverified). Medium effort produced
two real findings, so it cleared the bar this once — the 4.6-high precedent from PR #526 still stands as
the thing to compare against if peer output ever looks thin.

Three fixes came out of it, all in `a093310`:

1. **One guard before every write.** The R2 mid-flight check only covered the success path, and the
   record it wrote was hung on whoever signed in next, because `plusRefreshRowRecord` asks only whether
   *a* session exists. The guard now runs once before any branch, and the session-changed record is
   **returned but not written**. Found independently by correctness, security and the peer.
2. **Both storage writes wrapped.** `writePlusSession` failing is now a failed check with its own
   sentence (`PLUS_REFRESH_SAVE_FAILED_MESSAGE`); `writePlusRefreshRecord` swallows, because it is a
   memo and three of the four callers are fire-and-forget polls with no catch.
3. **The D1 Notice stopped overpromising.** It said the next Process "files as usual"; writing an
   address is not a stamp, so it now says the address was saved and the next Process checks it.

**One finding was dropped by the validator and is the first thing to file:** a **401** from a base the
session was not issued by still records `rejected`, which still renders **Send me a sign-in link** aimed
at that base. The validator's read is that the path is unchanged by this diff and is the ordinary
sign-in bootstrap already covered by [#529](https://github.com/taihartman/obsidian-atoms/issues/529).
That is defensible, but R1's own reasoning argues the CTA should be gated on the stamp. It is a residual
risk, not a merge blocker.

Review artifacts (**machine-local, `/tmp`, will not survive a reboot**):
`/tmp/compound-engineering-502/ce-code-review/20260816-144123-1b82fe80/` — per-reviewer JSON, the peer
artifact, and the adversarial brief. Nothing in them is load-bearing; this section is the durable record.

## What is left

1. **`world-class-qa`, ending in `adversarial-qa`** per that skill's hard gate. None of it has run. Read
   [`docs/qa/README.md`](../qa/README.md) and [`docs/qa/learnings.md`](../qa/learnings.md) first,
   especially the CDP focus-emulation note: an unfocused Obsidian window fires no `focus`/`blur` events
   at all. Reuse the #500 fetch recorder that blocks real egress.
2. **The PR body on [#526](https://github.com/taihartman/obsidian-atoms/pull/526)**, which is still
   unwritten: `Closes #508`, core user stories, edge cases and testing, Test plan boxes checked only
   after they ran, and vault screenshots committed under `docs/qa/screenshots/` linked with **absolute**
   `raw.githubusercontent.com` URLs.
3. **File the 401-CTA risk** onto #529 or its own issue.

## The states QA has to reach, and how

The gate's whole surface is base-versus-stamp, and most of it is invisible without deliberately
constructing the state. In the throwaway vault (`test_vault/`, in the **main checkout**, not this
worktree — `scripts/install-to-vault.sh` resolves it and takes a worktree lock, exit 3 if held):

- **The upgrade cohort.** A session on disk with no `issuedBase`/`verifiedBase` and `plusBaseUrl` empty.
  Process must refuse and say so; Settings → Account must show `Confirm the Plus address`; pressing it
  must write the address and stop asking; the next Process must probe, stamp, and file.
- **The mismatch.** A stamped session with a different `plusBaseUrl`. Content must refuse. Account shows
  **nothing** here by design, which is the thing adversarial-qa should push on.
- **The concurrent refresh.** Process (which stamps) racing Settings → Refresh status. The stamp must
  survive; that is R2.
- **Sign-out mid-flight.** A refresh in flight while the session is cleared must not resurrect it and
  must leave no record behind.

Version is `0.8.0-beta.7`, already bumped on this branch and not yet released. R1, D1 and the review
fixes all add user-visible surface but ride that same unreleased bump; bump again only if something ships
separately.

## Traps that still apply

Read the superseded handoff's Traps section. The ones this session re-confirmed:

- **Three allowlists between disk and the gate**, plus a fourth shape in `ClassifyAuthOk`. A field on the
  type but missing from one reads as `undefined` at the gate, which is fail-open.
- **`tsconfig.test.json` typechecks only a named list**, and it *does* include `test/settings.test.ts` —
  a mock-only symbol imported from `"obsidian"` instead of `"./mocks/obsidian"` fails the build, not the
  test run. `vitest` aliases the module; `tsc` does not.
- **The KTD14 nine** in `test/settings.test.ts` pin the account screen's exact row lists. Their fixtures
  are now stamped, which is what every session minted since U2 carries; an unstamped fixture there will
  pull the D1 row into all eight signed-in cases.
- **No em dashes in any string, template or regex literal under `src/**`.** Comments are exempt.
  `test/copyVoice.test.ts` enforces it.
- **Reading `plus.sqlite` or service logs to complete a magic link is credential extraction.** Do not.
- **Vault lanes.** Demo and throwaway vaults only. Never Remote Vault.

## What deliberately did not ship — say this in the PR

- **The token half of the leak.** Content-free calls, including the `/v1/me` probe, still send the
  session token to whatever base resolves. A check cannot verify the host it is asking.
- **The email predicate is a bar raise, not host authentication.** A targeted host that knows the address
  can echo it back. [#529](https://github.com/taihartman/obsidian-atoms/issues/529).
- **`sendPlusMagicLink` is ungated** — there is no session at magic-link time, so nothing to compare.
- **The resolver still falls back.** Six consumers are gated instead. Worth its own issue.
- **The 401 CTA** above.
- **Two narrower risks the review surfaced.** A self-hoster whose `plusBaseUrl` is empty on one device can
  move every device onto the hosted address with one tap, undoable only in Advanced, because
  `plusBaseUrl` syncs through `data.json`. And `installPlusSession` never clears the refresh record, so a
  pre-upgrade `rejected` record keeps its CTA until the next refresh overwrites it.

## Git state

- Branch `claude/plus-session-issuer`, tracking `origin/claude/plus-session-issuer`, working tree clean,
  everything pushed. Base `master` at `f544110`.
- **Last commit before this doc: `a093310`.**
- Draft PR [#526](https://github.com/taihartman/obsidian-atoms/pull/526), `Closes #508`. Body not written.
- `STATUS.md` row says "U1 + U2 landed, U3 to U7 left" and is **stale** — every unit is landed. Worth
  correcting in the same commit as the QA work.
- You are in a **linked worktree**. Reuse it.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
git fetch origin && git switch claude/plus-session-issuer && git pull --ff-only
npm run build && npm test && npm run lint
```

Then `world-class-qa`, and let it run through to `adversarial-qa`.
