# QA — #230 trial checkout revokes the plugin session

**Branch:** `claude/nervous-hodgkin-cb3f8c` · **Version:** 0.6.60 · **Date:** 2026-08-01
**Vault:** `test_vault/test vault` (throwaway lane) · **Obsidian:** 1.12.7 installer, CLI 1.12.7

## Honesty statement — read this before trusting the evidence

Per `docs/qa/README.md` § Product dogfood honesty, the UI states below were produced by
**writing refresh records and a fake session into device localStorage via `obsidian eval`**. That is
**scripted plumbing, not product proof.** The fake token is the literal string
`sess_FAKE_QA_NOT_A_REAL_TOKEN`; no real credential was used, and the fixture state was cleared from
the vault afterwards (verified: both keys read back `null`).

**The actual fix — "paying for a trial no longer kills your session" — is NOT proven here.** Proving
it requires a real Stripe checkout against the deployed service with a real card, which is an
outward-facing, money-touching action I did not take. What covers it instead:

- `plus-service/test/trial-checkout-session.test.mjs` drives a real `checkout.session.completed`
  through `applyStripeEvent` and asserts the original plugin session still resolves and can file.
- That test was confirmed to **fail on the pre-fix code** (webhook call site stashed →
  `not ok 1 - checkout.session.completed leaves the original plugin session usable`) and pass with it.

**Residual risk that only a human can close: one real trial signup on a fresh email after the Fly
deploy.** Treat that as the release gate, not this document.

## Core user stories

| # | Story | Result |
|---|---|---|
| 1 | A user whose session was rejected sees why, and can recover without hunting | **Pass** — "Sign-in needed" row + inline **Send me a sign-in link** |
| 2 | A user who is offline is not told to sign in again | **Pass** — "Last check didn't go through", no sign-in CTA |
| 3 | A healthy session reports plainly | **Pass** — "up to date", no CTA |
| 4 | Signing out leaves no stale prompt bound to the old account | **Pass** — no row rendered at all |
| 5 | A Plus user can open Settings → Atoms at all | **Pass after fix** — see the crash below |

## Evidence

Assertions were made against the **live rendered DOM**, not by eye; screenshots are artifacts.

| State | DOM assertion | Screenshot |
|---|---|---|
| Session rejected | `signInNeeded:true, sendLinkCTA:true, leaksToken:false` | `screenshots/trial-session-230/01-session-rejected.png` |
| Transport failure | `didntGoThrough:true, sendLinkCTA:false, leaksToken:false` | `screenshots/trial-session-230/02-transport-failure.png` |
| Up to date | `upToDate:true, sendLinkCTA:false, leaksToken:false` | `screenshots/trial-session-230/03-up-to-date.png` |
| Signed out | all row flags `false`, `leaksToken:false` | `screenshots/trial-session-230/04-signed-out-no-stale-cta.png` |

`leaksToken` checks the rendered settings pane for the substring `sess_`. False in every state.

## Bug found *by* this QA pass — settings tab crashed for every Plus user

The first attempt to open Settings → Atoms with a stored session threw:

```
Error: f.setButtonText(...).setDestructive is not a function
```

`setDestructive()` only exists from **Obsidian 1.13**, but `manifest.json` declares
`minAppVersion: 1.11.4`, and the verified dev installer is 1.12.7. Introduced on master in
`5957c50` (2026-07-28) — **pre-existing, not from this branch.**

Impact: the render threw partway down `display()`, so for any user with a stored Plus session on
Obsidian < 1.13, **every control below "Wipe cloud copy" silently vanished.** This is a plausible
contributor to "the whole trial setup process is bugged."

Why nothing caught it: `test/mocks/obsidian.ts` stubs the API, so unit tests cannot see a
typings-vs-runtime mismatch. `tsc` passed because the installed typings are `obsidian@1.13.1` while
the running app is 1.12.7 — **the typecheck validates a newer API than the manifest promises to
support.**

Fixed here via `markDestructive()` (`src/settings/settings.ts`), which prefers `setDestructive()`
where present and falls back to the deprecated-but-shipping `setWarning()`. Verified: the tab now
renders end to end, and the `Wipe` button below the former crash point is present in the DOM.

## Not covered

- Real Stripe trial signup end to end (see honesty statement).
- The Postgres store. `plus-service` tests exercise memory and sqlite only; the production store has
  no integration coverage. A wrong parameter in the new Postgres binding survived a fully green run
  during this very fix and was caught by reading the code, not by a test. A source-level parity test
  now holds all three stores to the same method surface, but that is a guard, not coverage.
- iOS/Android. Changes are platform-neutral, but the settings pane was smoked on desktop only.
- The 40s post-checkout polling window (`plusResume.ts:26`), unchanged — with the root cause fixed it
  degrades to a manual "Refresh status" rather than being broken.

## Verification commands

```bash
npm test                 # 737 passed / 51 files
npm run build            # tsc -noEmit + esbuild production, clean
cd plus-service && npm test   # 213 passed
```
