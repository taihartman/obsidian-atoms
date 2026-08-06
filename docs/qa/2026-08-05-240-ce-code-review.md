# Code review — #240 magic-link handoff (PR #298)

**Date:** 2026-08-05 · **Branch:** `feat/240-magic-link-handoff` · **Base:** `cb041ea`
**Scope:** 52 files, ~2,584 executable changed lines (plugin + `plus-service`)
**Verdict:** **Ready with fixes** — all P1s fixed on-branch; one unrelated pre-existing blocker named below.

## Coverage

| Lens | Ran | Notes |
|---|---|---|
| correctness | yes | session model |
| security | yes | session model |
| project-standards | yes | root `CLAUDE.md` + `AGENTS.md` govern all changed files |
| reliability | yes | |
| api-contract | yes | `plus-service` deploys separately from the plugin |
| testing | yes | |
| maintainability | yes | |
| data-migration | yes | inline DDL in the store drivers is the migration |
| previous-comments | yes | one prior comment on the PR |
| **adversarial** | **cross-model** | see below |
| performance | not run | correctness/reliability already own the changed semantics |
| learnings | not run | corpus matched only docs this branch itself authored |

**Cross-model adversarial pass:** route `grok-cli`, target `grok`,
`model_requested: grok-4.5`, `effort_requested: high`,
`model_actual: unverified`, `effort_actual: unverified`,
`receipt_supported: false`, `independence_verified: true`.
Host family is `claude`, so the pass counts as independent and its agreement
promotes. Reviewed code and diff content were sent to xAI.

**Scope caveats:** untracked files: none. The Postgres arm of the service suite
cannot run locally (no database on this machine) and is proven only by CI.

## What was fixed on-branch

### P1 — A superseded tap still spent its token
`src/platform/plusSignIn.ts`. **Four independent confirmations** (correctness,
reliability, the Grok pass, and a direct read). `live?.hide()` retired the
previous *Notice*, but a run parked on `await host.confirmSignIn(...)` kept
going and spent its token when the user finally answered. Grok traced the
cascade the local lenses stopped short of: `exchangeMagic` revokes the account's
other sessions before minting, so two exchanges revoke each other and the loser
writes a session the server has already killed — the vault shows "signed in"
while every Plus call 401s.

Fixed with a generation counter on the queue, checked after the confirmation
resolves. A superseded run stands down silently, because the newer run owns the
screen. Also closes Grok's `ready()`-drain variant, since the counter is bumped
in `accept` regardless of whether `host` is set yet.

Two regression tests added, both **verified to fail with the guard disabled**.
Every pre-existing supersede test fully awaited the first tap, so none of them
ever had two handoffs alive at once — which is why this survived to review.

### P1 — Unguarded session write after a spent link
The exchange succeeded, then `writePlusSession` / `clearPendingSignIn` ran with
no `try`. A storage failure fell through to "tap it again" — advice that cannot
work, because the link is already spent and the other devices are already
signed out. Now reports what actually happened.

### P1 — Invisible characters in an attested vault name
The mint accepts an arbitrary `vault` string that later renders as the
*attested* "requested by" name. `sanitizeVaultLabel` now strips zero-width and
bidi ranges (`U+200B-200F`, `U+202A-202E`, `U+2066-2069`), which render as
nothing while reordering surrounding text. Stripped at render rather than
rejected at mint, so no legitimate non-Latin vault name is turned away.

### P1 — Missing version bump
`manifest.json` / `package.json` / `versions.json` were untouched on a
user-visible change. Bumped to **0.6.78**.

### Also
`MAX_VERIFIER_HASH_CHARS` was documented as "hex sha256 ... its 64"; the wire
value is base64url and 43 chars. That stale comment pointed at the exact
hex-vs-base64url confusion this branch already had to correct once.

## Verified sound (no finding)

- `verifierMatches` length-guards before `timingSafeEqual`, borrows only
  `pkceChallengeS256`, is base64url at both ends, and treats an absent verifier
  against a bound row as a refusal.
- `skipVerifierCheck` is **not** reachable from the plugin's
  `POST /v1/auth/exchange` — that route builds `{ verifier }` as a literal and
  never reads the flag from the body.
- All three backends refuse *before* deleting the row (Postgres inside
  `FOR UPDATE` with a `ROLLBACK`), so a refusal is non-destructive.
- The consent gate has real coverage: exactly three tests go red if it is
  dropped, matching the author's claim. `declined` and `dismissed` both cost
  zero exchange calls.
- The store re-keying to hashed tokens orphans in-flight links across a deploy —
  documented in the plan (KTD11/KTD14), bounded by the 15-minute TTL, tested.
- `platform/` stayed UI-free and `plugin/main.ts` stayed a thin shell.
- No `console.*` in any new plugin file; `redact()` covers `mt_`, `sess_`, and
  the 43-char verifier shape.

## Open — needs a decision, not fixed here

1. **Mint-side vault allowlist (security, P1 half).** The reviewer also proposed
   narrowing `MAX_VAULT_NAME_CHARS` 256 -> 64 and requiring a charset allowlist
   at mint. Not applied: it can reject legitimate vault names, which is a
   product call. The render-side strip above removes the spoofing teeth without
   that risk.
2. **`verifierHash` shape check (P2).** Mint accepts any 1-128 char string;
   could require `/^[A-Za-z0-9_-]{43}$/`.
3. **404 leaks raw server text (P2, two reviewers).** A new plugin against an
   undeployed server surfaces the literal string "Not found" as the dead-end
   message. `failureMessage` should fall back to the unknown-failure copy for
   unmapped codes.
4. **Re-tapping a spent link (P2).** After `clearPendingSignIn`, a re-tap hits
   the empty-pending branch and claims another vault requested the link.
5. **Rate-limiter `hits` Map never evicts.** Pre-existing on master; #240 adds
   four more unauthenticated key prefixes to it.
6. **Two confirm modals can still be visible at once.** The generation guard
   stops the *spend* and the crossed messaging; actually closing the stale modal
   needs a cancellable `confirmSignIn` contract.
7. **Shared verdict-modal base class** — filed; deliberately deferred because
   the pre-existing `AskMirrorDeleteConfirmModal` has no direct latch test, and
   unifying an untested consent surface without its gate is what the repo's
   blast-radius rule forbids.
8. `plusClient.ts` crossed 1,000 lines. Demoted to advisory — no codified line
   limit in `CLAUDE.md` or `AGENTS.md`.

## Blocker not caused by this branch

`test/personInvite.test.ts` — two tests ("ranks Mom over older Dom when Mom is
newer", "groups two Dom atoms") began failing **permanently** at UTC midnight on
2026-08-06. `PERSON_INVITE_RECENT_DAYS = 14` is applied against a wall-clock
cutoff, and the fixtures are hard-dated `2026-07-20` / `2026-07-22`. Reproduced
on a clean tree with every #240 change stashed; the same suite passed at 19:52
EDT and failed at 20:21 EDT. Filed separately. Bumping the dates would only
reset the same time bomb — it needs an injected clock.

## Verification

- `npm run build` — clean (tsc + esbuild).
- Plugin suite — 1,063 pass, 2 fail (both the unrelated `personInvite` pair).
- `plus-service` — 473 pass, 0 fail.
- Guard mutation-tested: disabling `isCurrent()` turns exactly the two new tests
  red.
