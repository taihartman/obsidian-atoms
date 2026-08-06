# QA — #240 magic-link handoff (U9 + U10 + service lane)

**Date:** 2026-08-05 · **Branch:** `feat/240-magic-link-handoff` · **PR:** [#298](https://github.com/taihartman/obsidian-atoms/pull/298)
**Vault lane:** throwaway `test_vault/test vault` only. Remote Vault was never targeted, never written, and never had plugin files copied into it.
**Service:** local `plus-service` on `127.0.0.1:8899`, dev posture (`env=dev dogfoodAutoGrant=true stripe=false`), sqlite store, magic links delivered to the server console. Plugin pointed at it via the **Plus service URL override**.

## Verdict

**Merge-ready for the desktop path. Not release-ready** — the release gate (a link opened from a mail client's in-app browser on a physical iOS device *and* a physical Android device) is human-only and still open. Nothing below was measured on a phone.

## What is product proof and what is plumbing

Following `docs/qa/2026-08-01-trial-session-invalid-world-class-qa.md`, the distinction is stated rather than blurred.

| Result | Kind |
|---|---|
| Sign-in link requested from the real **Send sign-in link** button, link taken from the service's own output, deep link fired through macOS `open`, confirmation answered by clicking the real buttons | **Product proof** — the user loop, end to end |
| Cold-open sign-in with Obsidian fully quit before the link was fired | **Product proof** |
| Landing-page renders (bound / unbound / troubleshooting open) | **Product proof** for markup and gating; the troubleshooting shot is the same served HTML with `<details open>` injected, because headless Chrome cannot click |
| `peek → peek → exchange → replay` over HTTP with a real PKCE pair | **Plumbing** — a scripted contract probe, not a user path |
| 1062 plugin tests, 473 service tests | **Plumbing** |
| Anything about iOS or Android | **Not run** |

## Core user stories

| # | Story | Result | Evidence |
|---|---|---|---|
| 1 | I tap the emailed link on the device running Obsidian, confirm, and the vault is signed in with nothing typed | **Pass** — running app, `dogfood2@atoms.test`: session stored `trialing`, pending verifier cleared, notice "Signed in to Atoms Plus as …", Settings reads signed in | `01-confirm-modal.png`, `02-signed-in-settings.png` |
| 2 | The confirmation tells me the account it verified **and** that approving signs my other devices out, before I choose | **Pass** — "Atoms Plus verified this sign-in link for …", then "Signing in here signs this account out on your other devices. They can sign back in with a new link.", then `Not now` / `Sign in` | `01-confirm-modal.png` |
| 3 | Cancelling costs nothing and the link still works | **Pass** — zero server calls on cancel, no session written, pending verifier intact, and the same token completed a sign-in on the next tap | notice "Left signed out. This sign-in link still works — tap it again if you change your mind." |
| 4 | A link that reaches the wrong vault refuses visibly instead of silently | **Pass** — dismiss-only modal "Atoms Plus sign-in … The link still works — open it from the vault that asked for it." with a single `Got it` | `04-refusal-modal.png` |
| 5 | The link opens a vault that was closed | **Pass** — Obsidian fully quit, `open obsidian://atoms-signin?...` launched it, routed to the test vault, and the queued handoff drained after settings loaded; approving signed in as `coldopen@atoms.test` (AE10, KTD8) | `05-cold-open-confirm.png` |
| 6 | A link minted by a build that cannot complete the bound exchange is not offered a dead-end handoff | **Pass** — the unbound token's landing page carries **no** `obsidian://atoms-signin` anchor and promotes the paste fallback instead (KD9) | `07-landing-unbound.png` |

## Edge cases and negative paths

| Case | Result |
|---|---|
| Peek is non-consuming | **Pass** — two consecutive peeks both returned `usable` with the account email and the server-attested requesting vault, and the token then exchanged |
| Token is single-use | **Pass** — replaying the exchange returned `401 invalid` |
| Verifier binding | **Pass** — a peek with no verifier and a peek with the wrong verifier both returned `403 refused / verifier_mismatch`, twice each, and the token survived to be exchanged by the right verifier |
| Exchange without a verifier against a bound row | **Pass** — refused, nothing consumed |
| Expired link | **Pass** — a 40-minute-old token's landing page renders "Link expired" (15-minute TTL) |
| Bogus token in the deep link | **Pass** — refusal modal, no session, no crash |
| No pending record on this device | **Pass** — refusal names **no** vault at all rather than echoing the deep link's `vault=` param |
| Hostile `vault=` in the deep link | **Not reachable as designed** — see "Dead ends", below. Obsidian consumes `vault=` for its own routing before the plugin sees it. The plugin's own guarantee (never render that param) is covered by unit tests, including a 10 000-character payload with an `onerror` attribute |
| Terminal notice from an earlier tap | **Fixed during this pass** — a finished handoff's "Left signed out" sat beside the next tap's confirmation. A new tap now retires the previous surface |
| Stale "Checking this sign-in link…" | **Fixed during this pass** — the progress line now reads "Confirm the sign-in to finish." while the question is open, since nothing is running |

## Dead ends with no in-app signal (by construction)

Both are unchanged by this work and neither can be mitigated inside the plugin:

1. **No vault of the named name on the device.** Obsidian resolves `vault=` itself. Measured on 1.13.4: an unknown name leaves the app wedged (reproduced with `obsidian://open?vault=NoSuchVaultXYZ`, no plugin involved — upstream, not ours).
2. **A vault whose installed build does not register `atoms-signin`.** Nothing runs; nothing can report it.

The only mitigation is R18's pre-tap vault naming on the landing page. The unit tests covering AE7 exercise the **reachable** case only — a link that reaches a vault whose build does register the action.

## Environment findings worth carrying forward

Recorded in `docs/qa/testing-fixtures.md` as well, because each one costs an hour to rediscover:

- **Obsidian 1.13+ gates external links.** "Run action from external link?" appears before the plugin's handler runs, once per action per app session. A cold-launch URI was not gated. **The product copy does not mention this extra tap** — see Follow-ups.
- **Launch Services goes stale after an app auto-update.** Every `obsidian://` URI was silently dropped until `lsregister -f /Applications/Obsidian.app` and a restart. A URI that "does nothing" is this before it is a plugin bug.
- **An unknown `vault=` name wedges the app** until force-restart.

## Gates and gaps — stated, not checked

| Gate | Status |
|---|---|
| `npm test` (plugin) | **1062 passed** |
| `cd plus-service && npm test` | **473 passed** |
| `npm run build` | clean (typecheck + bundle) |
| Deliberate mutation, U10 | **Ran and passed** — dropping the consent gate turns exactly the three consent tests red |
| Deliberate mutation, U13 (`verifierMatches` → `return false`) | **Never ran.** The permission classifier blocks it, correctly, since it removes a security control |
| Postgres store parity | **Never run locally** — no docker, no `pg`, `TEST_DATABASE_URL` unset. Every "all three backends" claim here is memory + sqlite. CI runs the postgres arm and fails if the rows skip; this closes at PR time, not before |
| `crypto.subtle` on the mobile webview | **Assumed, never measured.** U7's absence tests stub the global in node, which proves the error path and nothing about a phone |
| Release gate: physical iOS **and** Android, link opened from a mail client's in-app browser | **Open. Human-only** — an agent cannot satisfy it. Beyond the happy path the human must check (a) that `crypto.subtle` exists in that webview, and (b) what the in-app browser does with the `obsidian://` anchor |
| M9 (magic tokens stored plaintext) | **Closed** by U1's `hashToken` keying |
| M10 (session printed into browser HTML) | **Open by design**, retires with the paste fallback in #286 |

## Follow-ups (not blockers)

1. **Copy does not anticipate the 1.13+ trust prompt.** The landing page says "Open Obsidian" and Settings says "Obsidian signs itself in"; on 1.13+ the first tap raises a system-level confirmation first. Worth one sentence on the landing page rather than a support thread.
2. **`Ask mirror: push failed — Plus network error`** appeared in the signed-in panel during this pass. Ask mirror is out of scope for #240 and was pointed at a local server it was not seeded against; noted so the screenshot's red line is not mistaken for a #240 regression.
3. **The no-pending-record refusal says "requested by a different vault"** when the truthful statement is "this vault has no record of asking for a link". Same shipped constant, one lane wider than it needs to be.

## Screenshots

All under `docs/qa/screenshots/240-magic-link/`, captured with `obsidian dev:screenshot` (plugin UI) and headless Chrome (landing pages).

| File | What it shows |
|---|---|
| `01-confirm-modal.png` | The confirmation: verified email, sign-out disclosure, `Not now` first |
| `02-signed-in-settings.png` | Settings → Atoms reading signed in after approval |
| `03-obsidian-1134-trust-prompt.png` | Obsidian 1.13.4's "Run action from external link?" gate for `atoms-signin` |
| `04-refusal-modal.png` | The dismiss-only refusal |
| `05-cold-open-confirm.png` | The confirmation after the link launched a closed vault |
| `06-landing-bound.png` | Landing page for a bound token — offers the `obsidian://` handoff |
| `07-landing-unbound.png` | Landing page for an unbound token — no handoff offered, fallback promoted |
| `08-landing-troubleshooting-open.png` | The troubleshooting `<details>` expanded (served HTML, `open` injected) |

## Adversarial half

Ran as part of this pass rather than as a separate document; the hostile inputs tried were: a 10 000-character `vault=` payload carrying `onerror` and an ANSI escape (unit-level, since Obsidian intercepts the param), a bogus token, a replayed token, a verifier-less peek and exchange against a bound row, a wrong verifier, an expired token, a second link request minted *while* the confirmation was open (the older link still completed), cancel-then-retry, dismiss-by-close, and a deep link fired at a vault name that does not exist. Two real defects came out of it — both listed above as "Fixed during this pass" — and one upstream wedge that is not ours.
