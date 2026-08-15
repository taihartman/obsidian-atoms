---
handoff_date: 2026-08-15
branch: claude/plus-session-issuer
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/508
pr: https://github.com/taihartman/obsidian-atoms/pull/526
status: in-progress
units_done: U1, U2
units_left: U3, U4, U5, U6, U7
---

# Handoff — #508: a Plus session records the base that issued it

Read this file top to bottom, run **How to resume**, then start at **Next steps**. Do not re-plan
what the plan already decided and do not ask the user what to work on. The blocking decision that
opened this work is **answered**; nothing is waiting on a human.

## Where this stands

The design is settled, the plan has been through a four-lens doc-review against the real code, and
**U1 and U2 are implemented, verified and pushed**. Five units remain, and U3 is the substantial one.

**The plan is the authority: [`docs/plans/2026-08-15-001-fix-plus-session-issuer-plan.md`](../plans/2026-08-15-001-fix-plus-session-issuer-plan.md).**
Read it in full before writing code. It carries four KTDs, the six gated call sites, the copy, the
risks, and the open questions. This handoff does not restate it.

## The bug, in one paragraph

A user signed in to their own Plus server who clears `Plus service URL` silently starts sending their
session token **and their verbatim capture text** to `plus.tryatoms.app`. Empty has always resolved
to the hosted default. #500 guarded *invalid* base URLs and deliberately refused to fall back; that
covered every input class except the one that is not invalid at all: **absent**. Proven live in the
#500 adversarial pass with a fetch recorder that blocked real egress.

## What is done

| Unit | Commit | What landed |
|---|---|---|
| U1 | `4513adb` | `issuedBase` (immutable, branded) + `verifiedBase` (mutable) on `PlusSession`; both added to all **three** allowlists between disk and the gate; `normalizePlusBase` / `plusBaseMatches` / `issuedBaseFromResponse` in `plusClient.ts` |
| U2 | `7105839` | `installPlusSession(host, session, issuedBase)` with the third arg required; brand minted inside the helpers that made the successful request; magic-link port and `AtomsPlugin` wrapper widened end to end; all four acquisition paths stamp |

Both are behaviour-neutral. **Nothing gates yet.** `npm run build && npm test && npm run lint` was
green at each commit (1963 tests at U2).

Each unit was verified by neutering its guard and watching tests go red, then restoring. Do the same
for every unit you write — it is U7 and it is not optional. Two #500 tests passed against a broken
guard until someone checked.

## Next steps

1. **U3 — the verification module.** `src/platform/plusBaseVerify.ts`. This is the largest unit and
   the one the rest hang off. Read the plan's U3 section carefully; the accept condition is not what
   the original design said (see **Corrections** below).
2. **U4 — gate classify.** `resolveClassifyAuth` plus the `classify.ts:761` egress backstop. The plan
   lists the three signature facts that will otherwise stall you: `resolveClassifyAuth` is
   synchronous today and has no request fn or storage, the ripple set is `requireClassifyAuth` and
   its five call sites, and `ClassifyDeps.plus` needs a new field for the backstop to compare.
3. **U5 — gate mirror push**, including the backstop inside `askMirrorUpsert` / `Delete` / `Reconcile`.
4. **U6 — docs stop hedging.** The #508 comment at `plusClient.ts:259-268` and the warning in
   `docs/ask-self-host.md` both currently describe this as an open gap. Rewrite both or the docs lie
   in the other direction. Bump `manifest.json` + `package.json` + `versions.json` to `0.8.0-beta.7`.
5. **U7 — both checks**, not just neutering: also the source-enumeration test that re-derives the
   sender inventory, because neutering cannot catch a sender nobody listed.
6. **Shipping tail:** `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa`
   (ending in `adversarial-qa`). Then the PR body per `CLAUDE.md`, with real Test plan checkboxes and
   vault screenshots.

## Corrections the doc-review made to the original design

**Do not revert to the handoff-era shape. These were changed for reasons, with evidence.**

- **A bare 2xx is not proof of issuance.** The original design said stamp the base that returns 2xx.
  But 2xx proves a server is *willing to accept* a token, not that it minted one — a host that
  accepts everything passes trivially, becomes the permanent stamped issuer, and capture text then
  flows there unchecked. **Re-stamp only when the returned entitlement email matches
  `session.email`.** Found independently by the security and adversarial lenses. Route the probe
  through the existing `getEntitlement`, not a hand-rolled request, so it inherits `plusRequest`'s
  #500 guard and error mapping; map results the way `plusRefresh.ts:100-104` already does.
- **KTD1 is decided: an absent stamp means *unknown*, never *production*.** With a carve-out that is
  load-bearing: unknown stamp **plus an empty field** must **not** auto-probe, because an empty field
  already resolves to the hosted default, so probing would send a self-hoster's token to production
  on first run — the exact user this protects. Surface it as a Settings state, not a dialog.
- **The carve-out is bounded to the upgrade cohort.** `plusBaseUrl` ships as `""`
  (`shared/types.ts:225`), so empty is the *normal* state for every hosted user. An earlier framing
  would have made empty mean "not connected" generally; that would strand nearly the whole install
  base. From U2 onward a hosted session is stamped at sign-in and its empty field matches its stamp
  forever, so the field never needs to mean anything.
- **Two fields, not one.** A single mutable stamp erases its own evidence: after one tunnel rotation
  nothing on disk records that the session began at a private host.
- **The inventory is six sites, not four.** The outbox ack (which sends `plan.reason`, free text, not
  just id and status) and the Connect destination (which publishes an origin for Claude or ChatGPT to
  OAuth against, then sends the token there). Sorting the Connect screen as "content-free" was the
  wrong axis, and that is precisely the #500 learning.
- **This closes the capture-text half of #508, not the token half.** The 17 content-free calls still
  send the token to whatever base resolves, and the `/v1/me` probe deliberately does too — a check
  cannot gate itself. Say so; do not let the issue read as "the token no longer leaks".

## Traps that already bit, or will

- **There are three allowlists between disk and the gate, and U3/U4 may create a fourth.**
  `parsePlusSession`, `serializePlusSession`, and the `FilingAuth` plus variant that
  `resolveFilingAuth` fills field by field. `resolveClassifyAuth` never sees a `PlusSession`, only
  that projection. If U3 threads the stamp through `ClassifyAuthOk` into `ClassifyDeps.plus`, that
  return literal is a fourth with the same silent-drop hazard. Give it the same round-trip assertion.
- **`tsconfig.test.json` typechecks only a named list of test files.** A `@ts-expect-error` in an
  unlisted file is inert and a drifted stub signature is caught by nobody. `test/plusSignIn.test.ts`
  and `test/plusSignInAccountRefresh.test.ts` are **not** on the list; U2 had to fix their stubs by
  hand. Add any file carrying a compile-time assertion in the same unit that writes it.
- **`main.ts`'s `onRemaining` closure had zero test coverage before U1.** It is one of two paths that
  write a session directly. U1 added coverage; do not let it regress.
- **No em dashes in any string, template, or regex literal under `src/**`.** `test/copyVoice.test.ts`
  enforces it plugin-wide and fails CI. Comments are exempt.
- **Test at the level that proves nothing left the device.** `expect(request).not.toHaveBeenCalled()`
  is the assertion. A returned error object only proves a branch was chosen.
- **The throwaway QA vault is shared.** A peer session's `install-to-vault.sh` can replace your build
  mid-pass. `install-to-vault.sh` now takes a worktree lock (exit 3 if held), but still assert build
  identity by grepping the installed `main.js` for a string your branch introduced, before and after
  every capture batch.
- **An unfocused Obsidian window fires no `focus`/`blur` events at all.** Chromium suppresses them
  when `document.hasFocus()` is false, which it is whenever the CLI drives. Attach CDP and
  `Emulation.setFocusEmulationEnabled`. Full detail in `docs/qa/learnings.md`.
- **Reading `plus.sqlite` or service logs to complete a magic link is credential extraction.** Do not.

## Open questions (none blocking)

Recorded in the plan's Open questions section. Summarised:

- Should the *resolver* stop falling back, rather than six consumers being gated? Deferred with
  reasons, not rejected. Worth its own issue.
- Should a hosted session verify silently onto a self-host base, or does that direction need a
  gesture?
- ~~What identity field does `/v1/me` return, and is it stable?~~ **Answered against the service
  source; U3 is unblocked.** `email`, and nothing else identity-bearing. It is the `accounts` primary
  key with no route that changes it, normalized `trim().toLowerCase()` service-side. Tokens are
  opaque `randomBytes(16)`, so a host that did not issue one cannot name its account — the predicate
  is a real proof of issuance, not a heuristic. Full detail and the threat-model boundary are in the
  plan's Open questions.
- Should the outbox-ack refusal surface anything, or stay silent like the existing `return idle`?

## Git state

- Branch `claude/plus-session-issuer`, base `master` at `f544110`, tracking
  `origin/claude/plus-session-issuer`.
- Draft PR [#526](https://github.com/taihartman/obsidian-atoms/pull/526), `Closes #508`.
- `STATUS.md` row is claimed and current.
- **Head `1f5e6b3` (this doc). Working tree clean, everything pushed. There is no WIP snapshot
  commit — nothing was left uncommitted.**
- Diff since base: 18 files, +1334/-39.
- Recent commits, newest first:
  - `f952c53` docs: confirm the `/v1/me` identity field against the service
  - `8062881` docs(handoff): U1 and U2 landed, U3 next
  - `7105839` feat(plus): U2 — stamp the base that actually issued the session
  - `4513adb` feat(plus): U1 — a session can record the base that issued it
  - `7cc88f2` docs(plan): KTD1 decided, absent issuer means unknown
  - `f2811a0` docs(plan): fold in four-lens doc-review findings
  - `2eae679` docs(plan): a Plus session records the base that issued it
- Version still `0.8.0-beta.6`; the bump is U6.
- You are in a **linked worktree** (`--git-common-dir` is the main checkout's `.git`). Reuse it. Do
  not create another.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
git fetch origin && git switch claude/plus-session-issuer && git pull --ff-only
npm run build && npm test && npm run lint
```

Then read the plan and start at **Next steps** above.
