---
handoff_date: 2026-08-15
branch: claude/plus-session-issuer
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/508
pr: https://github.com/taihartman/obsidian-atoms/pull/526
status: in-progress
units_done: U1, U2, U3, U4, U5, U6, U7
units_left: none — shipping tail only
---

# Handoff — #508: a Plus session records the base that issued it

Read this file top to bottom, run **How to resume**, then start at **Next steps**. Do not re-plan
what the plan already decided and do not ask the user what to work on. The blocking decision that
opened this work is **answered**; nothing is waiting on a human.

## Where this stands

**All seven units are implemented, verified and pushed.** Nothing is left to build.
What remains is the shipping tail, and it is the whole of the remaining work.

**The plan is still the authority: [`docs/plans/2026-08-15-001-fix-plus-session-issuer-plan.md`](../plans/2026-08-15-001-fix-plus-session-issuer-plan.md).**
Read the Corrections and Traps sections below before touching any of this; they are still live.

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
| U2 | `7105839` | `installPlusSession(host, session, issuedBase)` with the third arg required; brand minted inside the helpers that made the successful request; all four acquisition paths stamp |
| U3 | `57cae42` | `src/platform/plusBaseVerify.ts` — verified / refused / unreachable, the email predicate, the KTD1 carve-out, the re-stamp through `writePlusSession` |
| U4 | `4e0c989` | `resolveClassifyAuth` async + gated with a required injected verifier; `unverified_base` refusal; `ClassifyDeps.plus.verifiedBase` and the `classify.ts` egress backstop |
| U5 | `313125d` | Mirror config + outbox ack gated in `askCoordinator`; `PlusMirrorConfig` and per-call backstops in `askMirrorUpsert` / `Delete` / `Reconcile`; the Connect destination gated against the stamp |
| U6+U7 | `d3401a9` | `plusClient` comment and `docs/ask-self-host.md` rewritten; version `0.8.0-beta.7`; `test/plusSenderInventory.test.ts` re-derives the sender census from source |
| KTD1 state | `767e867` | Settings shows the needs-address state in the Plus service URL row's existing inline error region |

`npm run build && npm test && npm run lint` green at every commit. **2021 tests** at head.

**Every guard was neuter-verified**: the guard was broken, the tests were watched go red, and the
guard was restored. Fourteen neuters across the five units, each recorded in its commit message. Do
the same for anything you add. Two #500 tests passed against a broken guard until someone checked.

## Next steps — the shipping tail, in order

1. **`ce-simplify-code`** on the branch diff. Nothing has been simplified yet.
2. **`ce-code-review`**, cross-model peer routed to **grok** (see the global rule; create
   `.compound-engineering/config.local.yaml` with `cross_model_peer: grok` and gitignore it if it is
   not there). Give the peer a brief that names `plusBaseVerify.ts`, `classifyAuth.ts` and
   `askCoordinator.ts` rather than the whole 25-file diff, or it burns its turn budget reading.
3. **`ce-compound`** — the durable learning. Candidates, all real: a bare 2xx is not proof of
   issuance; a required *type* enforces presence but a required *brand* enforces provenance; an
   optional field cannot be pinned by an assignability assertion; `Object.create(Prototype)` skips
   class fields, so a dependency held as a class field is undefined in tests built that way.
4. **`world-class-qa`**, ending in **`adversarial-qa`** per its hard gate. This is the largest
   remaining item and none of it has run. The adversarial pass should reuse the #500 fetch recorder
   that blocks real egress. Read `docs/qa/learnings.md` first, especially the CDP focus-emulation
   note — an unfocused Obsidian window fires no `focus`/`blur` events at all.
5. **PR body** on [#526](https://github.com/taihartman/obsidian-atoms/pull/526) per `CLAUDE.md`:
   `Closes #508`, distilled Core user stories, Edge cases & testing, real Test plan checkboxes, and
   vault screenshots committed under `docs/qa/screenshots/` and linked with **absolute**
   `raw.githubusercontent.com` URLs. The PR is still a draft.

## What deliberately did not ship

Say this in the PR body, or the issue reads as more closed than it is.

- **The token half of the leak.** The seventeen content-free base resolutions still send the session
  token to whatever base resolves, and so does the `/v1/me` probe this fix added, because a check
  cannot verify the host it is asking. `docs/ask-self-host.md` now says so in both directions.
- **`sendPlusMagicLink`** carries `vault` (the vault name, often self-descriptive) and is not gated:
  there is no session at magic-link time, so there is nothing to compare a base against.
- **The resolver still falls back.** Six consumers are gated instead. Deferred with reasons, not
  rejected; worth its own issue.

## Decisions taken during implementation, beyond the plan

- **No verdict cache anywhere.** The plan asked for one so an unreachable host is probed once per
  run. Both call paths already ask exactly once — classify at `resolveClassifyAuth`, the mirror where
  the config is built — so the bound is already met, and a longer-lived memo would leave a briefly
  unreachable host refused until the plugin reloaded. `createPlusBaseVerifyCache` exists and is
  tested; nothing in `src/` passes one.
- **The Connect destination compares, it does not probe.** A render must not egress, and a screen
  that opened a network call to name its own address would be sending the token to the host it is
  trying to decide about. A stale stamp therefore reads as "not yet confirmed" there until a Process
  or mirror push re-verifies.
- **The Settings state shows only the needs-address case,** not a mismatch. A mismatch is unsettled;
  the next push probes and may re-stamp, and a refusal announced before anything tried would alarm a
  self-hoster who rotated their tunnel.
- **`PLUS_BASE_REFUSED_MESSAGE` lives in `plusClient`,** re-exported from `plusBaseVerify`. The
  request layer returns it now, and importing it the other way is a cycle.

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
  `origin/claude/plus-session-issuer`. Working tree clean, everything pushed.
- Draft PR [#526](https://github.com/taihartman/obsidian-atoms/pull/526), `Closes #508`. Still a
  draft, body not yet written.
- `STATUS.md` row is claimed and current.
- **Last code commit: `767e867`.** (This section does not pin the head SHA: the commit that carries
  this doc cannot state its own hash.)
- Version `0.8.0-beta.7`. The bump has landed; do not bump again.
- You are in a **linked worktree** (`--git-common-dir` is the main checkout's `.git`). Reuse it. Do
  not create another.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
git fetch origin && git switch claude/plus-session-issuer && git pull --ff-only
npm run build && npm test && npm run lint
```

Then read the plan and start at **Next steps** above.
