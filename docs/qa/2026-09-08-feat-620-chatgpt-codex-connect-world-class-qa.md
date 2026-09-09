# World-Class QA: ChatGPT custom app connection (#620)

## Verdict

**Ready pending post-deploy validation.** The real ChatGPT production entrypoint, hosted callback, and installed Atoms Plus app were exercised successfully. The branch's new OAuth and setup wording was exercised locally in Safari, including spoof-resistant client labeling and error redisplay. The copy is not deployed, so the combined production journey remains a named post-deploy gate and PR #621 stays draft.

## Charter

Verify that an Atoms Plus subscriber can add the production MCP in ChatGPT web, understand the Atoms Plus sign-in/permission screens, recover from an accidental localhost flow, and retain the existing Claude path. Blast radius is the OAuth HTML and public/self-host setup copy; OAuth tokens, scopes, redirect acceptance, account binding, and atom-content tools are intentionally unchanged.

## Preflight

- **Product dogfood honesty:** ✅ present in `docs/qa/README.md`; real ChatGPT installation evidence is separated from local UI-chrome evidence.
- **Authority paths:** ✅ `docs/plans/2026-09-08-620-chatgpt-custom-app.md`, Issue #620, `STATUS.md`, and the changed on-screen copy.
- **Learnings:** ✅ `docs/qa/learnings.md` read. The local in-memory Plus-service fixture and the prohibition on extracting magic-link credentials were applied.
- **Navigation map:** 🔧 followed for existing Plus surfaces and extended with the external ChatGPT custom-app route and its local/deployed evidence boundary.
- **Run commands:** ✅ `cd plus-service && PORT=<unused-loopback-port> npm start`; repository checks listed under Evidence.
- **Fixture:** ✅ in-memory Plus service with synthetic client IDs, redirects, and pairing-code failures. No production data or account fixture was created.
- **Viewport/device:** ✅ desktop Safari for changed web copy; ChatGPT web for the real production connection. Mobile is not a primary surface for custom-app creation.
- **Auth path:** ✅ safe OAuth entry/error paths and production hosted callback. Real email dispatch, one-time-link extraction, and atom access were excluded.
- **Automation:** ✅ Node route tests, Vitest setup-guide tests, build, lint, and Safari computer-control drive. The in-app browser was attempted first but blocked loopback with `ERR_BLOCKED_BY_CLIENT`.
- **Device lock:** N/A — no Obsidian vault or physical device was driven.
- **Deploy reality:** ⚠️ target is `https://plus.tryatoms.app/mcp` plus the public setup site. The branch copy is not deployed; merge and deploy are separate gates.

## Authority & Promises

| Surface | Promise / authority | Observable acceptance | Story |
|---|---|---|---|
| ChatGPT setup guide | Plan R1-R3; guide copy | Starts in ChatGPT web, creates `Atoms Plus`, uses `https://plus.tryatoms.app/mcp` with OAuth, and expects a `chatgpt.com` return | US1 |
| OAuth sign-in/error pages | Plan R5; visible headings and helper copy | Names Atoms Plus and a trusted ChatGPT client consistently, including after validation errors | US2 |
| Account chooser and consent | Plan R6-R7 | Remembered session stops at chooser; consent keeps account, client, scopes, mirror boundary, filing boundary, and provider-egress disclosure visible | US3 |
| Untrusted/loopback client | Security boundary + localhost recovery copy | Does not infer ChatGPT from attacker-controlled `client_id`; page says `your AI app` | US4 |
| Claude setup and callback | Plan R4 | Existing Claude connector recipe remains, and the exact Claude callback labels Claude | US5 |

No spec/copy conflict was found. No new interactive control was introduced; existing forms and actions received changed informational context only.

### Changed informational targets

| Surface | State/input | Expected visible result | Evidence |
|---|---|---|---|
| Sign-in heading and pairing guidance | Allowed ChatGPT hosted redirect | Atoms Plus + ChatGPT | Safari screenshot 01 + route tests |
| Error redisplay | Invalid pairing code in ChatGPT request | Error appears without losing ChatGPT context | Safari screenshot 02 + route tests |
| Client display name | ChatGPT-looking ID + loopback redirect | `your AI app`; no ChatGPT label | Safari screenshot 03 + redirect tests |
| Claude sign-in heading | Exact Claude callback | Atoms Plus + Claude | Safari screenshot 04 + preservation test |
| Public setup guide | ChatGPT instructions | Both Developer-mode paths, Create app, production URL, OAuth, sign-in action, hosted return, localhost recovery | Safari screenshot 05 + setup tests |
| Chooser/consent/magic-link message | Remembered/signed-in ChatGPT flow | Trusted client label and unchanged account/scope disclosures | HTTP tests; live signed-in state not exercised |

## Product Loop vs Fixture

| Story | Proof kind | Boundary |
|---|---|---|
| US1 | `user-loop` | Real ChatGPT web created and installed the production Atoms Plus custom app through the hosted callback. No atom-content tool was called. |
| US2, US4, US5 | `ui-chrome-only` + automated route evidence | Local in-memory service and synthetic values prove the branch HTML, not deployment. |
| US3 | automated contract evidence | Route tests prove chooser-before-consent and disclosures; a live signed-in account was deliberately not used. |

## User Stories Tested

### US1 — Direct ChatGPT connection

As an Atoms Plus subscriber, I want to add Atoms Plus inside ChatGPT web, so that I can use the production MCP without a Codex or local-client detour.

- **Acceptance:** Create `Atoms Plus` with `https://plus.tryatoms.app/mcp` and OAuth; authorization returns through ChatGPT's hosted callback; ChatGPT lists the app as installed.
- **Authority:** Plan R1-R3 and AE1.
- **Evidence:** Real ChatGPT setup completed on 2026-09-08; hosted callback observed; installed-app page observed; no atom tool invoked.
- **Status:** Passed for the currently deployed flow; new wording awaits deployment.

### US2 — Clear client-aware sign-in and recovery

As a ChatGPT user, I want every Atoms Plus sign-in/error page to name the service and client, so that I know what I am connecting.

- **Acceptance:** Initial and invalid-code pages retain `Atoms Plus` and `ChatGPT` context.
- **Authority:** Plan R5 and AE2.
- **Evidence:** Safari screenshots 01-02; focused HTTP tests.
- **Status:** Passed locally.

### US3 — Account boundary and consent disclosure

As a returning subscriber, I want to choose the Atoms Plus account before consent and see the requested access, so that I do not authorize the wrong account.

- **Acceptance:** A remembered session renders the chooser before Allow; consent includes selected account, trusted client, `atoms:read`, `atoms:write`, mirror, filing, and provider-egress disclosures.
- **Authority:** Plan R6-R7 and AE3.
- **Evidence:** `plus-service/test/http-ask-oauth.test.mjs`; full Plus-service suite.
- **Status:** Passed in automated route coverage; Not Tested live with a real signed-in account.

### US4 — Spoof-resistant identity

As a subscriber, I want untrusted OAuth requests to stay generically labeled, so that a malicious client cannot present itself as ChatGPT.

- **Acceptance:** A ChatGPT-looking `client_id` with loopback or untrusted redirect renders `your AI app`, never ChatGPT.
- **Authority:** OAuth redirect allowlist and security review finding resolved in commit `1dd9342`.
- **Evidence:** Safari screenshot 03; `plus-service/test/oauth-redirect.test.mjs`.
- **Status:** Passed.

### US5 — Claude remains available

As an existing Claude user, I want the connector recipe and OAuth identity to keep working, so that ChatGPT improvements do not regress Claude.

- **Acceptance:** The Claude setup recipe remains present, and the exact Claude callback renders Claude.
- **Authority:** Plan R4 and AE4.
- **Evidence:** Safari screenshot 04; `test/wwwSetupLabels.test.ts`.
- **Status:** Passed.

## Risk Matrix

| Risk class | Scenario | Story | Result |
|---|---|---|---|
| Happy | Create/install production app through ChatGPT hosted callback | US1 | Passed |
| Negative | Invalid pairing code preserves client-aware form and explains recovery | US2 | Passed |
| Edge/security | Spoofed client ID with loopback redirect must remain generic | US4 | Passed |
| Boundary | Opaque, malformed, or untrusted clients do not become provider identities | US4 | Passed by tests; adversarial ledger below |
| Regression | Remembered browser session cannot skip chooser | US3 | Passed by tests |
| Regression | Exact Claude callback and setup recipe remain Claude-specific | US5 | Passed |
| Perception | Server URL, hosted callback, and localhost recovery cannot be confused | US1, US2 | Passed locally and in guide tests |
| Accessibility | Changed headings, labels, and button text remain semantic HTML; forms unchanged | US2-US5 | Passed by source/route inspection; no dedicated screen-reader pass |
| Deploy | New branch copy must appear on production service/site | US1-US5 | Not Tested; post-deploy gate |

## Evidence

### Live browser

- Production ChatGPT: OAuth discovery/scopes succeeded, authorization returned through a hosted `chatgpt.com` callback, and Atoms Plus appeared as installed. No atom search, fetch, list, create, continue, cancel, or other atom-content action was invoked.
- Local Safari: all pages rendered normally; static setup-guide assets loaded. Safari's controlled surface did not expose console/network panels.
- Screenshots (synthetic/local, no PII or secrets):
  - `/tmp/atoms-plus-qa-621/01-chatgpt-signin.png`
  - `/tmp/atoms-plus-qa-621/02-invalid-code.png`
  - `/tmp/atoms-plus-qa-621/03-spoof-generic.png`
  - `/tmp/atoms-plus-qa-621/04-claude-signin.png`
  - `/tmp/atoms-plus-qa-621/05-setup-guide-ask.png`
- The initial in-app-browser attempt was blocked by its loopback policy (`ERR_BLOCKED_BY_CLIENT`); Safari was used for the completed local drive. Both local servers were stopped and ports 18787/18788 were confirmed closed.

### Automated and review gates

| Check | Result |
|---|---|
| Focused OAuth redirect + HTTP suites | 21 passed |
| Full Plus-service suite | 613 passed across 133 suites |
| Focused setup-guide suite | 9 passed |
| `npm test` | 116 files, 2,358 tests passed |
| `npm run build` | Passed |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `git diff --check` | Passed |
| Compound code review | Complete; run `20260908-221520-8b9da9f3`; initial findings fixed in `1dd9342`; focused post-QA security re-review found no remaining actionable issue |

### Craft

N/A — no layout, styling, component, or animation changed. The browser evidence validates visible copy and routing context, not a new visual design.

## Findings

No open defect remains. Four findings were fixed during the review/QA tail:

1. Client-controlled IDs could spoof the ChatGPT label when paired with loopback; fixed by deriving provider identity only from a trusted hosted redirect.
2. The guide omitted the current Settings → Security Developer-mode path; both current ChatGPT UI variants are now documented.
3. Noncanonical ChatGPT callback variants (custom port, duplicate/trailing slashes, query/fragment suffixes, or normalized dot segments) passed the allowlist; fixed with exact literal callback validation. Post-fix live HTTP returned 400 for the original four repro shapes and 200 for the canonical callback; the wider regression matrix is unit-locked.
4. Direct consent re-entry with a remembered browser session could bypass the account chooser through either GET or POST; fixed so consent requires an email explicitly bound to the pending authorization and a matching browser session. Both bypass regressions failed before the fix and passed after it.

## Adversarial QA

The required break-it pass ran against the same branch, then replayed the proven canonical-redirect exploit shapes after the fix.

| Scenario | Result | Evidence |
|---|---|---|
| Repeated invalid code and re-entry | Solid | Three submissions retained pending state and trusted client context; special input was not reflected |
| Missing/stale pending ID | Solid | Authorize/consent paths returned generic Expired errors without reflecting input |
| Opaque DCR ID; ChatGPT-looking ID with loopback | Solid | Generic `your AI app` label in live drive and tests |
| Lookalike, userinfo, subdomain, encoded, malformed callbacks | Solid after fix | Custom-port, duplicate/trailing-slash, query, fragment, and dot-segment shapes rejected; original four live repros now return 400 |
| Canonical ChatGPT callback | Solid after fix | HTTP 200 and `Connect Atoms Plus to ChatGPT`; screenshot 07 |
| Exact Claude callback | Solid | Claude retained on initial and error redisplay |
| Back/refresh after validation error | Solid | Same pending request remained usable; fresh authorize entry also worked |
| Direct consent with remembered session | Holed, fixed | RED route tests exposed GET and POST bypasses; GREEN now renders chooser and requires pending-bound email + matching session before Allow or Deny |
| Long/HTML-special client, code, and pending input | Solid | Dynamic values stayed escaped and were not reflected as markup |
| Chooser before consent | Solid | Initial authorize and direct-consent re-entry are both regression-locked |
| Setup server URL vs callback wording | Solid | Guide and browser evidence distinguish the production MCP URL from localhost recovery |
| Back after completed consent | Blocked | Requires a completed credential-bearing flow outside the safe synthetic constraint |
| Offline/flaky network | Not applicable / partial | Changed surface is server-rendered copy/static docs; existing mail failure returns 503, but production fault injection was not run |

**Post-fix evidence:** `plus-service/test/oauth-redirect.test.mjs` 9/9; `plus-service/test/http-ask-oauth.test.mjs` 12/12; full Plus-service suite 613/613. Live post-fix screenshots: `/tmp/atoms-plus-qa-621/06-rejected-custom-port.png` and `/tmp/atoms-plus-qa-621/07-canonical-chatgpt.png`.

**Suspected-unproven:** none remain. The direct-consent lead was converted into a failing regression test, fixed, and re-verified.

## Not Tested

- The branch's new copy on the production `plus.tryatoms.app` service and public setup site; it is not deployed.
- A fresh post-deploy ChatGPT install that sees the new OAuth copy end-to-end.
- Real email delivery and one-time-link opening; no email was sent and no token was extracted.
- Live signed-in chooser and consent with a real account; covered at HTTP route level instead.
- Browser Back after a completed real consent grant; the credential-bearing flow was outside the synthetic QA boundary.
- Atom search/read/write behavior; intentionally outside this copy/onboarding change and not invoked.
- Dedicated screen-reader and browser-console/network-panel passes; semantic structure is unchanged, and Safari control did not expose developer panels.

## Learnings

- **Consulted:** local Plus-service sessions can exercise OAuth gates without cloud credentials; magic-link tokens must never be taken from storage/logs; product proof and fixture proof must remain separate.
- **Appended:** no new trap row. The local-vs-deployed ChatGPT evidence boundary is recorded in `docs/qa/app-navigation-map.md`.

## Merge Decision

Implementation and local/automated QA are ready for review, but the PR should remain draft under the deploy-reality gate. After an authorized deployment, confirm the production pages carry the new wording and repeat the fresh ChatGPT hosted-callback/install path before declaring merge/release verification complete.
