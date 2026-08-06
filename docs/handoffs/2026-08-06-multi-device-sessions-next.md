---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-06T01:15:06Z"
title: "#240 shipped as 0.6.78-beta.1; multi-device sessions is the open question"
summary: "Magic-link handoff is merged, deployed, and released for BRAT dogfood, but exchangeMagic revokes every session so desktop and phone are mutually exclusive — analyze that before the release-gate testing."
keywords: ["multi-device", "sessions", "revokeAllSessionsForEmail", "exchangeMagic", "magic-link", "240", "320", "plus-service", "beta"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin"
resume_focus: "Decide and plan whether exchangeMagic should stop revoking verified sessions, so a paying customer can be signed in on desktop and phone at once (#320)"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e"
branch: "master"
head: "01671a4"
---

# #240 shipped; multi-device sessions is the open question

## Why this handoff exists

#240 is done and released for dogfood. The user was about to run the iOS/Android
release-gate test when they raised a product objection that outranks it:

> "we want to be able to log in on two different devices … if someone buys an
> account, they should be able to log in on the desktop and phone."

They are right, and the current design does not allow it. They chose to analyze
that **before** dogfooding the beta. Nothing is blocked technically — the beta is
installable today — this is a deliberate sequencing choice.

Full analysis is in **[#320](https://github.com/taihartman/obsidian-atoms/issues/320)**;
read that first, it is the authoritative statement of the problem.

## The open question, in one paragraph

`exchangeMagic` calls `revokeAllSessionsForEmail(row.email)` right before minting
(`plus-service/src/store/{memory.mjs:276,sqlite.mjs:410,postgres.mjs:474}`), and
that helper revokes **every** session for the email including verified ones
(`memory.mjs:167`). So signing in on the phone kills the desktop session and vice
versa, forever. A narrower sibling exists — `revokeUnverifiedSessionsForEmail`
(`memory.mjs:174`) — and that is what the C1 session-fixation property actually
needs.

**Unverified hypothesis:** swapping the call in `exchangeMagic` to the
unverified-only variant preserves C1 and enables multi-device. Evidence for it:
the C1 test (`plus-service/test/security-auth-criticals.test.mjs:59`) builds its
prior session with `startWithEmail`, which is unverified, and no test was found
asserting a *verified* session must die on exchange. **This was read-only
analysis. The suite has not been run against the change.** Verify before
trusting it.

**What the change costs:** revoke-all is currently the only account-recovery
path — signing in boots an attacker holding a live session. Narrowing it removes
that with no replacement, so the honest change pairs it with an explicit
"Sign out all devices" control. #320 lists the follow-on edits (confirm-modal
copy, plan R4/KD4, session cap).

## What shipped this session

All merged to `master` and verified:

| PR | What |
|---|---|
| [#298](https://github.com/taihartman/obsidian-atoms/pull/298) | #240 magic-link handoff — 13 units, plus `ce-simplify-code` and `ce-code-review` with 4 P1 fixes |
| [#317](https://github.com/taihartman/obsidian-atoms/pull/317) | `personInvite` tests anchored to a fixed clock |
| [#318](https://github.com/taihartman/obsidian-atoms/pull/318) | Landing-page vault-name sanitize + `verifierHash` shape gate |
| [#319](https://github.com/taihartman/obsidian-atoms/pull/319) | `0.6.78-beta.1` bump, `#240` STATUS row cleared |

- **Deployed:** `plus-service` on Fly, release **v44**. Verified live, not
  assumed: `POST /v1/auth/peek` answers `401` on a bogus token where it returned
  `404` before the deploy.
- **Released:** tag `0.6.78-beta.1`, published as a **prerelease** with
  `main.js` / `manifest.json` / `styles.css` / `SHA256SUMS.txt`.
- `#240` auto-closed. Working tree clean at `01671a4`.

Review report with every finding, including what was left open:
`docs/qa/2026-08-05-240-ce-code-review.md`.

## Decisions worth not relitigating

- **Beta, not stable.** `STATUS.md` recorded the iOS + Android physical-device
  test as human-only and hard-blocking the release, and that test is the reason
  a build needs to reach a phone. Stable would have shipped to every BRAT user
  before the gate meant to precede it. User chose beta when asked.
- **The `personInvite` failure was pre-existing, not caused by #240.**
  `PERSON_INVITE_RECENT_DAYS = 14` against a wall clock with fixtures dated
  `2026-07-20`/`22`; they aged out at UTC midnight on 2026-08-06. Reproduced on
  a clean tree with all #240 changes stashed. Fixed by injecting the clock
  through the seam that already existed (`opts.now`), **not** by bumping the
  dates — that would only reset the same bomb.
- **The mint-side vault charset allowlist was deliberately not taken.** A code
  reviewer proposed narrowing `MAX_VAULT_NAME_CHARS` to 64 plus a charset
  allowlist; that rejects legitimate non-Latin vault names and does not stop
  plausible plain-text spoofing. #318 strips invisible/bidi characters at render
  in both the plugin and the landing page instead — strips, never rejects.
- **The shared verdict-modal base class stays deferred.** `PlusSignInConfirmModal`
  and the pre-existing `AskMirrorDeleteConfirmModal` carry a byte-identical
  consent latch, but the pre-existing one has **no direct latch test**, and
  unifying an untested consent surface without its gate is what the repo's
  blast-radius rule forbids. Do it *with* tests for both or not at all.

## The #240 P1 worth understanding before touching this code

`createSignInHandoffQueue` had no generation guard: `live?.hide()` retired the
previous `Notice`, but a run parked on `await host.confirmSignIn(...)` kept going
and spent its token when the user finally answered. Because `exchangeMagic`
revokes other sessions, two exchanges revoked each other and the loser wrote a
session the server had already killed — the vault reads "signed in" while every
Plus call 401s.

Four independent reviewers converged on it (correctness, reliability, the Grok
cross-model pass, and a direct read). Fixed in `a6e3e70` with a generation
counter; two regression tests in `test/plusSignIn.test.ts` were **mutation-tested**
— disabling the guard turns exactly those two red.

**This is directly relevant to #320**: that failure mode exists *because* of the
broad revoke. Narrowing the revoke changes the blast radius of the same race.

## Still open from the #240 review

Listed with evidence in `docs/qa/2026-08-05-240-ce-code-review.md`:

- A 404 from an undeployed server surfaces the raw string "Not found" as the
  user-facing dead-end message (two reviewers).
- Re-tapping a spent link claims another vault requested it.
- The rate limiter's `hits` Map never evicts (pre-existing on `master`; #240
  added four more unauthenticated key prefixes to it).
- Two confirm modals can still be *visible* at once — the generation guard stops
  the spend and the crossed messaging, but actually closing the stale modal
  needs a cancellable `confirmSignIn` contract.

## Not done, and not started

- **The iOS + Android release-gate test has not been run.** It is human-only and
  hard-blocks stable `0.6.78`. `crypto.subtle` on the mobile webview is still
  **assumed, never verified** — if it is missing, the failure appears at "Send
  sign-in link" time, before any email is sent.
- A test plan was written for the user in-session but not committed anywhere;
  reconstruct from #240's requirements if needed.
- Postgres has still never run locally on this machine (no docker, no `pg`);
  that arm is proven by CI only.

## Environment traps that cost real time

- **Fly deploy must run from the repo root**, not from `plus-service/` — the
  Dockerfile copies `plus-service/...` and `plus-pricing.json` relative to the
  root. The runbook command is
  `fly deploy -a atoms-plus -c plus-service/fly.toml --dockerfile plus-service/Dockerfile`
  (`docs/runbooks/atoms-plus-prod.md:96`). A wrong-context run failed the build;
  an earlier attempt exited **0 with no output and deployed nothing** — always
  confirm with `fly releases` rather than the exit code.
- Only `plus-service-tests.yml` runs on PRs, and it runs `npm test` with
  `working-directory: plus-service`. The **root vitest suite runs only on a
  version tag** via `release.yml` — which is why a broken root test blocks a
  release but shows green on every PR.
- Obsidian 1.13+ shows "Run action from external link?" before the plugin's
  handler runs, and an **unanswered** prompt silently queues later URIs, so
  repeated taps pile up invisibly.

## Suggested next step

One path, not a menu: read #320, decide whether to narrow the revoke, and if so
run `ce-plan` for the two-part change (narrow revoke + "Sign out all devices").
It is a security-adjacent auth change and warrants a plan, a full
`ce-code-review` with the cross-model peer routed to grok
(`.compound-engineering/config.local.yaml` already sets this), and adversarial QA.

Prototyping first is reasonable and cheap: make the one-line swap in the three
stores, run `npm test` in `plus-service`, and see whether C1 and the other 476
tests stay green. That converts the central hypothesis into evidence before
anyone commits to a design.
