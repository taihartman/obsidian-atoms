---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-06T02:45:00Z"
title: "#320 multi-device sessions — U1–U7 implemented, shipping tail is next"
summary: "All seven implementation units for #320 are committed and pushed; what remains is simplify, code review, world-class QA, compound, and marking PR #322 ready."
keywords: ["320", "multi-device-sessions", "sign-out-all", "session-cap", "shipping-tail", "plus-service"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin"
resume_focus: "Run the shipping tail and mark PR #322 ready with evidence"
repository: "taihartman/obsidian-atoms"
branch: "feat/320-multi-device-sessions"
head: "9b63625"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin"
---

# Handoff — #320 multi-device sessions: implementation done, shipping tail next

Implementation is **complete**. Do not re-plan it and do not re-implement any unit.
What is left is the mandatory shipping tail from `CLAUDE.md`, then the PR.

## Goal

A paying Atoms Plus customer could not be signed in on desktop and phone at once:
`exchangeMagic` revoked **every** session for the email — verified ones included —
immediately before minting, so each sign-in permanently evicted the other device.
The revoke is now narrowed, and an explicit **"Sign out all devices"** control
replaces the account-recovery property the broad revoke was silently providing.
Both halves ship in one PR (KTD1).

## Current state

**Done — all seven units, one commit each, pushed to `origin`.**

| Unit | Commit | What landed |
|---|---|---|
| U1 | `8aa5532` | `exchangeMagic` calls `revokeUnverifiedSessionsForEmail`; regression tests for a surviving verified session, another email untouched, and KTD8 |
| U2 | `3fe9a21` | `config.maxSessionsPerEmail` (clamped), `enforceSessionCapForEmail` ×3 stores, session test seam ×3 stores, redacted eviction log |
| U3 | `045ea6d` | `POST /v1/auth/sign-out-all` — sessions + MCP grants + checkout bindings; new HTTP test file |
| U4 | `82165e2` | `signOutAllDevices` client helper |
| U5 | `63ec66c` | Settings row (active + exhausted via one helper) and `PlusSignOutAllConfirmModal` |
| U6 | `9b63625` | Sign-in disclosure corrected; supersession notes in the #240 plan |
| U7 | `9b63625` | `0.6.78-beta.1` → `0.6.78-beta.2` in manifest, package, versions |

Diff vs `master`: 23 files, +2233/-26. Worktree clean at `9b63625`.

**Verification already performed — do not redo it:**

- `plus-service`: **516/516** passing (476 baseline + 40 new). `npm test` in `plus-service/`.
- Root vitest: **1095/1095** across 70 files. `npm test` at repo root.
- `npm run build` (tsc + esbuild) clean.
- **Mutation checks, all against the permanent suite, all restored afterwards:**
  - restoring `revokeAllSessionsForEmail` → the two new #320 U1 tests red on all three store arms
  - deleting the exchange revoke entirely → C1 red
  - reversing the memory cap comparator → the eleventh-sign-in test red
  - dropping the MCP revoke, or the binding clear, from the route → each turns its own R10 test red
  - deleting the `verdict !== "confirmed"` gate in Settings → exactly the cancel and dismiss tests red, nothing else

**Not done — this is your work:**

1. **`ce-simplify-code`** on the branch diff.
2. **`ce-code-review`**, cross-model peer routed to grok. `.compound-engineering/config.local.yaml` already sets `cross_model_peer: grok`. Give the peer a *narrow* brief naming two or three files — a 57KB diff burns its whole turn budget just reading (see the global rule).
3. **`world-class-qa`**, ending in its `adversarial-qa` gate. Project adapter: `docs/qa/`. This needs Obsidian open on the throwaway vault: `./scripts/install-to-vault.sh` then `./scripts/verify.sh`. UI changed (a new Settings row and a new modal), so the PR needs **screenshots** committed under `docs/qa/screenshots/<branch>/` and linked with absolute `raw.githubusercontent.com` URLs — repo-relative paths render broken in PR bodies.
4. **`ce-compound`** — the durable learning. The strongest candidate is the U2 near-miss: a comparator copied between backends would have produced a green cap test that read no timestamp at all, because `NaN` sorts as `0` and Map insertion order happens to equal creation order.
5. **PR #322** — currently draft. Mark ready. Body needs `Closes #320`, distilled core user stories, edge cases, and a real Evidence table.

## Decisions already settled — do not relitigate

- Both halves ship in one PR (KTD1). After U1, `revokeAllSessionsForEmail` has zero production callers until U3's route re-earns it.
- "Sign out all devices" signs out the calling device too (KTD2). One code path, no carve-out.
- Soft cap of 10 verified sessions, oldest evicted at exchange time (KTD3).
- **KTD8 — payment-promoted sessions are deliberately not carved out.** `POST /v1/billing/checkout` accepts unverified soft sessions on purpose and `promoteCheckoutSession` flips them to verified, so they now survive the narrowing. Carving them out would kill the desktop session of anyone who pays on desktop then signs in on phone, which is #320 verbatim on the most common paying path. The test is named for the decision so a reviewer sees an accepted consequence rather than an oversight.
- The row appears in both the active and exhausted Settings branches (Q1).

## Decisions made during implementation — these are new since the plan

- **`signOutAllDevices` keeps `code: "unknown"` on a 401**, not `"auth"`. `isSessionRejectedMessage` (`src/platform/plusClient.ts:117`) only claims messages saying "invalid session" or "expired"; the route's own sentence is more actionable, and this matches `/v1/promo`'s existing 401 shape. `"auth"` is also the code that would tempt a caller into faking a local sign-out off a server refusal.
- **`revokeAllSessionsForEmail` and `clearCheckoutBindingsForEmail` now return counts.** The route logs the session count with an account fingerprint.
- **`accountFingerprint` was added to `plus-service/src/store/shared.mjs`** as the one permitted form of account identity in a log. `logSessionCapEviction` uses it too.
- **The rate-limit test mints a fresh session between calls.** Seeding N+1 up front does not work: the first success revokes them all, so calls 2..N would 401 before reaching the limiter.
- **`renderPlusPanel` in `test/settings.test.ts` counts `redisplay()` rather than performing it.** The real one re-renders the whole tab and wants an Obsidian DOM.

## Key files

- `docs/plans/2026-08-06-001-feat-multi-device-sessions-plan.md` — the authority: 10 requirements, 8 KTDs, Verification Contract, Definition of Done. Sections U1–U7 at lines 199–433.
- `plus-service/src/store/{memory,sqlite,postgres}.mjs` — `enforceSessionCapForEmail`, `clearCheckoutBindingsForEmail`, the session test seam, and the narrowed revoke with its do-not-widen comment.
- `plus-service/src/server.mjs` — the new route, immediately after `/v1/auth/sign-out`. The KTD5 asymmetry comment is there.
- `plus-service/test/http-auth-sign-out-all.test.mjs` — new: spawned server, assertions against store state rather than the response body.
- `plus-service/test/security-auth-criticals.test.mjs` — the store-level #320 cases plus the `#320 U2 store parity` scan, which pins both the method surface and the expiry field each backend orders by.
- `src/settings/settings.ts` — `renderSignOutAllRow`, called from the exhausted and active branches.
- `src/settings/plusSignOutAllConfirmModal.ts` — new modal, `signOutAllConfirmCopy` split out for assertion.

## Traps that will cost you time

- **The postgres arm is CI-only.** It keys off `TEST_DATABASE_URL`, not `DATABASE_URL`, returns `[]` silently when unset locally, and throws under CI. There is no docker or local `pg` on this machine. Do not claim local postgres coverage in the PR.
- **The root vitest suite does not run on PRs** — only `plus-service-tests.yml` does, scoped to `plus-service/`. U4–U7 are covered only by the root suite, which runs on a version tag. Run `npm test` at the repo root before tagging.
- **Never `git checkout --` a file to undo a mutation experiment.** It reverts to HEAD, which during this session silently discarded an hour of uncommitted U2 work in `memory.mjs`. Use `cp` to a backup and restore from that.
- **`plusClient.ts` uses `fetch`, not `requestUrl`,** deliberately (`plusClient.ts:4-6`). Desktop `requestUrl` fails to localhost. Do not "fix" it.
- **`markDestructive` is mandatory** for destructive buttons; `setDestructive()` is 1.13+ against a `minAppVersion` of 1.11.4 and previously blanked the settings tab.
- **Fly deploy runs from the repo root**, never `plus-service/`, and must precede any plugin release. Confirm with `fly releases -a atoms-plus`, not the exit code.
- **Do not touch the personal Remote Vault.** Dogfood on `test_vault/` or `docs/media/demo-vault/`.
- **No AI attribution** in commits or the PR body.

## Open questions

- **Q2** (plan): the confirm modal uses two-button consent, not a typed confirmation. The plan recommended this; it is now built that way. Revisit only if review objects.
- **Q4** (plan): the 10-session cap is not disclosed in user-facing copy. The eviction log line makes it diagnosable. Still open.
- **Unrun, not a blocker:** the iOS + Android physical-device release gate for stable `0.6.78` is human-only and still outstanding from #240. `crypto.subtle` on the mobile webview remains assumed.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
git fetch origin && git switch feat/320-multi-device-sessions && git pull --ff-only
```

This is the **main checkout**, deliberately not a sibling worktree: `test_vault/` is
gitignored and `scripts/verify.sh` defaults its vault to `$ROOT/test_vault/test vault`,
so a fresh worktree would have no vault to verify against.

Then start at **Not done, step 1**.
