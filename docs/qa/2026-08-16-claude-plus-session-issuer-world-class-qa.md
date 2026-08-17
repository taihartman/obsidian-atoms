# World-Class QA — #508 a Plus session records the base that issued it

Branch `claude/plus-session-issuer` · PR [#526](https://github.com/taihartman/obsidian-atoms/pull/526) · version `0.8.0-beta.7`
Build under test: `0.8.0-beta.7`, fingerprint-verified in the throwaway vault (all four #508 copy strings present in the installed `main.js`).

## Verdict

**Ready after fixes** — one P2 copy defect found on screen, fixed and pinned in this same change. Ten constructive scenarios passed with live evidence. Adversarial half: see below.

## Charter

#508 makes a `PlusSession` record the base URL that issued it (`issuedBase`, immutable; `verifiedBase`, mutable). Content-bearing egress — classify, Ask mirror upsert/delete/reconcile, outbox ack — is refused when the resolved base differs from the stamp, until a content-free `GET /v1/me` at that base accepts the token. An absent stamp means *unknown*, never production; unknown plus an empty `plusBaseUrl` refuses without probing at all.

The gate's whole surface is base-versus-stamp and almost none of it is reachable without deliberately constructing the state, so this pass is state construction first and clicking second. **Proof kind: `user-loop` for the filing path** (capture bullets appended to a past daily, then Process), **`fixture-plumbing` for session state** (synthetic sessions written to device-local storage — a real magic link cannot be completed without reading service logs, which is forbidden).

Adjacent regression risk: `plusRefresh` (R2 re-read after await), Settings → Account row lists (the KTD14 nine), and the #500 base-URL guard it composes with.

## Preflight

| Item | State |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Learnings | ✅ read before driving; ➕ one row appended after |
| Navigation map | ✅ followed; no drift found, no row healed |
| Authority paths | ✅ `docs/plans/2026-08-15-001-fix-plus-session-issuer-plan.md` (KTD1–KTD4, Copy §), superseded by the D1 decision recorded in `docs/handoffs/2026-08-16-plus-session-issuer-qa.md` |
| Run command | `./scripts/install-to-vault.sh`; `npm run build && npm test && npm run lint` |
| Viewport/device | Desktop Obsidian 1.13.x driven via CLI; **settings frames captured in mobile emulation (390×844 @2x)** because desktop Settings is a separate popout window `dev:screenshot` cannot reach |
| Auth path | Synthetic session via local `plus-service` `POST /v1/auth/start` (`qa508@example.com`), plus hand-written session objects in device-local storage |
| Fixtures | Local `plus-service` on `127.0.0.1:8787` (in-memory, no cloud credentials); 401 stub on `:8799`; nothing listening on `:8799` for the unreachable case |
| Automation | `obsidian` CLI + `eval`; `window.fetch` recorder; CDP `Page.captureScreenshot` |
| Vault lock | ✅ held by this worktree for the whole pass |
| Deploy reality | N/A — plugin-side change only; no service deploy required |

**Egress safety.** Every scenario ran behind a `window.fetch` recorder that logged `{url, method, hasAuth, bytes}` and **blocked any non-loopback host**, recording it as blocked. Recon confirmed this covers **100% of #508-gated egress**: all six gated sites bind `plusFetchRequest`, which is `window.fetch` (`plusClient.ts:27-69`). It does not see BYOK classify or the paste-session probe, which use `requestUrl` — neither is a gated path, and both are named in Not Tested.

## Authority & promises

Ladder: active plan → handoff supersession (D1) → on-screen copy. No acceptance below was taken from a handler body.

| # | Surface / trigger | Promise (authority) | Acceptance | Status |
|---|---|---|---|---|
| P1 | Content call, unstamped session + empty base | KTD1 carve-out | Refuse; **zero network calls** | ✅ |
| P2 | Settings → Account, same state | D1 (`62b87f5`) | `Confirm the Plus address` row, only in that state, above the account facts | ✅ |
| P3 | Pressing that button | `settings.ts:2350` | Writes address, mints **no stamp**, Notice claims only what it did | ✅ |
| P4 | Next Process after P3 | Plan U3 | Exactly one content-free `GET /v1/me`, no capture text | ✅ |
| P5 | Stamped session, base points elsewhere | Plan U3/U4/U5 | Classify **and** mirror refused, no body-bearing request | ✅ |
| P6 | Base unreachable | KTD3 | Distinct copy naming the **connection**, not the field | ✅ |
| P7 | Probe moves a *known* issuer | Copy §"Issuer moved" | Notice names the new host; suppressed with no prior stamp | ✅ |
| P8 | Refresh racing a stamp | R2 + review fix 1 | Stamp survives; session-changed result returns but does **not** write | ✅ |
| P9 | Sign-out mid-flight | Handoff | Not resurrected; no record left behind | ✅ |
| P10 | `writePlusSession` fails | Review fix 2 | Own sentence; record write swallows | ✅ |

## User stories tested

Each ran live against the installed branch build. Notices are verbatim as observed on screen.

**US-1 — the upgrade cohort is refused without a probe.**
*As a self-hoster who cleared the Plus service URL, I want my notes to stay put until the plugin knows where they'd go.*
Acceptance (KTD1 carve-out): refuse and say so; do not auto-probe.
Observed: `Atoms: Atoms Plus needs its address before your notes are sent. Open Settings to confirm it.` Recorder: **zero calls**. Session left unstamped.
**Passed.** This is the story #508 exists for; the token went nowhere at all.

**US-2 — the refusal has a door back.**
*As that user, I want the screen the refusal points at to give me a way out.*
Acceptance (D1): row `Confirm the Plus address` with button `Use plus.tryatoms.app`, above the account facts.
Observed: renders at DOM index 1, directly under the `Account` back row, above Status / Signed in as / Plan.
Evidence: `docs/qa/screenshots/508-plus-session-issuer/01-upgrade-cohort-account-row.png`. **Passed.**

**US-3 — the button claims only what it did.**
Acceptance: `Atoms Plus: saved plus.tryatoms.app. Your next Process checks it.`; address written; **no stamp minted**.
Observed: exact string; `plusBaseUrl` → `https://plus.tryatoms.app`; row gone on redisplay; session still carries neither `issuedBase` nor `verifiedBase`; zero calls. **Passed.**
This is the review's third fix holding: writing an address is not a stamp, and the copy no longer implies it is.

**US-4 — the probe is content-free.**
Observed recorder line, verbatim: `{"url":"https://plus.tryatoms.app/v1/me","method":"GET","auth":true,"bytes":0,"blocked":true,"status":null}` — one call, zero body bytes, blocked before leaving the device. **Passed.**

**US-5 — a mismatch refuses classify *and* mirror.**
Acceptance: both refused, no body-bearing request.
Observed: `Atoms: Atoms Plus can’t confirm your sign-in at this address. Check the Plus service URL in settings.` One `GET :8799/v1/me` → 401, 0 body bytes. No `/v1/classify`. `syncAskMirror({force:true})` → `{kind:"failed", …}` with **zero body-bearing requests**. Stamp unchanged. **Passed.**
The mirror half is proven, not inferred — the plan insisted on that because a coordinator-only gate would miss `settings.ts:1207`.

**US-6 — unreachable gets its own sentence.**
Observed: `Atoms: Atoms Plus couldn’t be reached, so your notes stayed on this device. Try again when you’re back online.` Distinct from US-5 and names the connection, not the field. **Passed** — KTD3's "do not tell a briefly offline hosted user to check a field they never touched" holds.

**US-7 — the issuer moving is loud.**
Observed: `Atoms: Atoms Plus is now using 127.0.0.1:8787. Your notes will be sent there.` On disk `verifiedBase` moved `:8799` → `:8787` while `issuedBase` correctly stayed at `:8799`. The gate then opened: 15 `POST /v1/classify` carrying capture bodies (504–3135 bytes) went to **127.0.0.1 only**. **Passed.**
The second half matters as much as the first: the gate opens again, it does not just close.

**US-8 — suppressed when there was no prior stamp.** No issuer-moved Notice; probe 200; `verifiedBase` stamped; `issuedBase` absent. **Passed.**

**US-9 — a refresh racing a stamp does not clobber it (R2).**
Observed: `Your Atoms Plus session on this device changed while we were checking, so nothing was updated. Try again.` On-disk session byte-identical to the swapped object; `atoms-plus-last-refresh` **null** — the session-changed record was returned but not written, which is exactly review fix 1. **Passed.**

**US-10 — sign-out mid-flight leaves nothing behind.** Session `null` (not resurrected), refresh record `null`. **Passed.**

**US-11 — a failed save says so.** `Your plan couldn’t be saved on this device, so nothing changed. Try again.` Session unchanged, no record. **Passed after the fix below.**

## Risk matrix

| Class | Covered by | Result |
|---|---|---|
| Happy | US-7 (probe → re-stamp → filing proceeds) | ✅ |
| Negative | US-1, US-5 (refused), US-6 (unreachable), US-11 (save failure) | ✅ |
| Edge | US-8 (no prior stamp), US-9/US-10 (concurrency, sign-out mid-flight) | ✅ |
| Regression | Settings → Account row lists (KTD14 nine) via `npm test`; #500 base guard composed with #508 | ✅ |
| Perception | Notice copy per state; the Account screen's passive `Status` line | ⚠️ see Findings |
| Promise | Copy ↔ destination for all four new messages + the D1 button | ✅ |
| Craft | D1 row decisive frame | ✅ |

## Evidence

- `npm run build && npm test && npm run lint` → green, **2045 tests** (2044 before this pass; +1 regression test added below).
- Recorder transcripts per scenario, summarized inline above (URLs hit or "zero calls"; body byte counts).
- Screenshots (mobile emulation 390×844 @2x):
  - `docs/qa/screenshots/508-plus-session-issuer/01-upgrade-cohort-account-row.png` — the D1 row above the account facts
  - `docs/qa/screenshots/508-plus-session-issuer/02-mismatch-account-silent.png` — the Account screen saying nothing in the mismatch state
- Test data mutated (throwaway vault, disclosed per gate 8): three capture bullets appended to `test_vault/test vault/Daily/2026-08-10.md`, left unprocessed. `askEnabled` was turned on to reach the mirror path and restored to `false`, but the original `askPrivacyAckAt` / `askPrivacyAckVersion` were overwritten without being captured first and **could not be restored**.

## Craft read (§5b)

Decisive frame: the D1 row, read directly in the main thread.

Row height 182px, 16px vertical padding, four-line description with `scrollWidth == clientWidth` (unclipped). Tap target 311×44 — exactly the 44pt floor, full-bleed in the 343px content column. Hierarchy title → body → CTA reads as intentional. **Stacked-chrome adjacency: clear.** 24px of space between the row's bottom (y=373) and the `ATOMS PLUS` group header (y=397), owned by the header's own `margin-top`; all border widths `0px`, so there is no doubled seam. The card carries no group header of its own, which is correct — it reads as a callout, not a settings group.

**Craft: Passed.**

## Findings

**F1 — P2, fixed in this change. Notice stutter on the save-failure path.**
`PLUS_REFRESH_SAVE_FAILED_MESSAGE` opened by naming the product, but all ten Notice sites render it as `Atoms Plus: ${message}` (`settings.ts:1958` and nine siblings). On screen:

> Atoms Plus: Atoms Plus couldn’t save your plan on this device, so nothing changed. Try again.

Its four siblings all avoid this ("Your plan is up to date.", "Your Atoms Plus session…", "Couldn’t reach Atoms Plus."); the one added in the review-tail commit `a093310` did not. Found on screen, not by reading.
**Fix:** `plusRefresh.ts:51` now reads `Your plan couldn’t be saved on this device, so nothing changed. Try again.`
**Regression:** `test/plusRefresh.test.ts` — *"no refresh message stutters behind the Atoms Plus notice prefix"* pins the **class**, iterating all five exported messages, so the next one added cannot reintroduce it. **Neuter-verified:** restoring the old string turns the test red; the fix turns it green. (The first neuter attempt silently failed to substitute and produced a vacuous pass — caught by asserting the substitution landed before trusting the result.)

**F2 — P2, deliberate, carried as residual. The mismatch state is silent.**
In the mismatch state the Account screen reports `Status: Plus · 50 filings left` while every Process refuses. Deliberate (`plusBaseVerify.ts:113-131`, `settings.ts:2330`) — the D1 row is scoped to the carve-out state only. The user's sole signal is a transient Notice on a screen they are probably not looking at. Visible in both screenshots: `01` shows the healthy Status line sitting directly beneath the confirm row.

**F3 — note, not a defect. CORS preflight failure reads as *unreachable*, not *refused*.**
A base that fails preflight cannot answer the probe, so `unreachable` is defensible. But a misconfigured gateway will tell the user they are offline. Worth knowing when triaging a self-hoster's report.

## Adversarial QA

Ran against this same build. Sixteen scenarios, weighted to the destructive and re-entry classes. Ledger and proofs live in `test/plusBaseGate.adversarial.test.ts` (19 tests) and `docs/qa/screenshots/508-adversarial/`.

### Scenario ledger

| # | Scenario | Verdict |
|---|---|---|
| A1 | Corrupt stamp on disk (number, `""`, `null`, whitespace, non-URL, 10KB string, nested object) | **solid** — `parseBaseStamp` drops every non-string; a surviving garbage string never compares equal to a real base |
| A2 | Normalization boundaries (case, trailing slash, default port, path case, suffix host, punycode, trailing dot, userinfo) | **solid** — every equal pair is genuinely the same server; every different-server pair unequal. No fail-open |
| A3 | Stamp survives disk → `parsePlusSession` → `resolveFilingAuth` → `resolveClassifyAuth` → gate | **solid** — both stamps intact through all four shapes |
| A4 | 401 from a base that never issued the session | **holed → FIXED (P1)** |
| A5 | Silent mismatch dead end | **holed (P2)** — open, see below |
| A6 | Recovery row vanishes after a wrong-but-valid base | **holed (P2)** — open, see below |
| A7 | Stale `rejected` record survives a re-link | **holed → FIXED (P2)** |
| A8 | Double-tap the D1 button | **solid** — idempotent on disk; fires two identical Notices (P3 cosmetic) |
| A9 | Concurrent Process | **solid** — `manualFilingInFlight` / `backfillBusy` gate the second; both probes correct |
| A10 | Refresh + probe racing the same session | **solid** — each re-reads disk after its own await; no lost update (proven by test) |
| A11 | Base set back to the original issuer | **solid, chatty** — re-probes and fires a second "issuer moved" Notice |
| A12 | `plusBaseUrl` arriving via `data.json` sync | **caught, announced, then honoured** — by design; see below |
| A13 | Host that echoes the account address | **accepted, as documented** — see below |
| A14 | Session swapped under a stamp | **solid** — install boundary overwrites any stamp carried on the literal |
| A15 | #500-refused base (non-loopback `http`) | **solid** — refused before any egress (0 fetches); `https` reaches #508 and fails closed |
| A16 | `issuedBase` only / `verifiedBase` only | **solid** — `verifiedBase` wins; neither → unknown |

### Proven holes — fixed in this change

**A4 (P1) — the refusal offered a door at the base that refused it.**
Session stamped at `:8787`, `plusBaseUrl` at `:8799` (401 stub). The refresh is content-free and therefore ungated, so it reached `:8799`, got `code:"auth"`, and recorded `kind:"rejected"` — which renders **Sign-in needed → Send me a sign-in link**. Clicking it sent `POST /v1/auth/magic-link` **to `:8799`**, confirmed in the stub's log. On a base that answers, redeeming that link runs `installPlusSession`, stamping the hostile host as the issuer *with the gate never running*.

This was the residual the code review dropped as "unchanged by this diff, covered by #529". That read does not survive contact with the file: the R1 comment at `plusRefresh.ts:186-196` already states the rule for the neighbouring **email-mismatch** branch — a `rejected` CTA "stamps that host as the issuer without the gate ever running" — and records that case as `failed` for exactly this reason. The 401 branch twenty lines above had the identical consequence and no base check. The inconsistency is *internal to #508*, not #529's bootstrap.
**Fix:** `plusRefresh.ts:152-182`. A 401 is `rejected` only when it came from the base carrying the session's stamp; from a stranger it is `failed` with `PLUS_BASE_REFUSED_MESSAGE` and no CTA. An unstamped session keeps the old behaviour — no issuer to disagree with.
**Proof:** `a 401 from a base the session was NOT issued by must not offer a sign-in link at that base`, with a control asserting a real expiry *keeps* its CTA. Neuter-verified: reverting the guard turns the hole test red and leaves the control green.
Screenshot: `docs/qa/screenshots/508-adversarial/a4-signin-cta-at-refusing-base.png`

**A7 (P2) — a stale `rejected` record survived a successful re-link.**
`installPlusSession` never cleared `atoms-plus-last-refresh`. Sign-out clears it and paste-session clears it, but the three sign-*in* paths that matter — `startTrial`, `startSubscribeFromEmail`, and the magic-link wrapper, which is exactly where the rejected row's CTA sends the user — did not. Worse after an account change: the surviving record carries the **departed** account's address, so the CTA mails a link to the account just left.
**Fix:** `clearPlusRefreshRecord(host)` at the install boundary (`plusSessionInstall.ts:53`), covering all four acquisition paths so a fifth cannot forget.
**Proof:** two tests; neuter-verified (both go red without the call).

### Proven holes — open, pending a product decision

**A5 (P2) — the mismatch state is silent.** Stamped at X, configured Y: the Account screen renders `Plus · 50 filings left`, Status / Plan / Refresh, and nothing about the refusal. Process emits one transient Notice. Deliberate (`settings.ts:1229-1237`); the stated objection is that the state is unsettled before a refusal — but once a refusal *has* occurred it is settled. Screenshot: `a5-account-silent-while-every-process-refuses.png`.

**A6 (P2) — the recovery row vanishes after a typo.** Upgrade-cohort user who types a wrong-but-valid base instead of pressing the D1 button loses the `Confirm the Plus address` row entirely (`plusBaseVerify.ts:124-131`), while Process refuses with "Check the Plus service URL in settings" and the Advanced field shows no error. Recovery requires guessing that *clearing* the field re-summons the row. Screenshot: `a6-d1-row-gone-after-a-typo.png`. Pinned as a **known gap** test that will go red if the predicate is widened, so the change is a decision rather than an accident.

### Stated precisely, not defects

**A13/A12 — the email predicate, proven end to end.** A host that merely echoes the account address is accepted, re-stamped, and then **received real capture bodies** (`POST /v1/classify` against the echo stub) — reached purely through a `data.json`-synced `plusBaseUrl` plus a plugin reload, with one transient "Atoms Plus is now using …" Notice as the only defence, which an unattended catch-up never shows anyone. Inherent to the design and acknowledged in the module docstring. The probe also carries the session token to an as-yet-unverified `https` host. Neither leaks note text *before* verification, which is the guarantee #508 actually makes.

### Suspected, unproven

- Two concurrent gate calls for the same session/base both probe and both write; no lost update was found, but a case where the *second* verdict is wrong was not constructed.
- `plusBaseVerdicts` is not invalidated on `onExternalSettingsChange` (`main.ts:2330`). The cache key includes the base, so no stale hit could be built — not exhausted.
- A11's re-probe ping-pong may confuse a two-device user on different bases. Behavioural claim only.

### A5 + A6 fixed, and re-driven

Both were fixed in one surface at the user's direction: a recovery row that appears **once a refusal has actually been recorded at the currently resolved base**. New device-local record `atoms-plus-base-refusal` (`{base, at}`), written by `verifyPlusBase` on `refused/unverified` only, cleared on `verified` and on `installPlusSession`.

Gating on a *recorded refusal* rather than a bare stamp/base mismatch is the load-bearing choice. An unstamped session with a configured base, or a stamp disagreeing with a freshly synced one, is a normal transient that self-clears on the next successful probe; alarming there would nag every upgrading hosted user before their first filing, which is the same over-correction KTD3 forbids for offline users.

Re-driven live on the rebuilt bundle (fingerprint-verified):

| | Result |
|---|---|
| **R1** the refused row appears | **Passed.** Record on disk `{"base":"http://127.0.0.1:8799","at":…}`. Row `Check the Plus address` above the account facts. Full order: `Account` → **Check the Plus address** → `ATOMS PLUS` → Status → Signed in as → Plan → `MANAGE` → … Screenshot `03-refused-row.png` |
| **R2** it clears when the cause goes away | **Passed.** Base pointed back at `:8787`, probe verified, re-stamp Notice fired, record `null`, row absent. The state cannot outlive its cause |
| **R3** `needs-address` unchanged | **Passed.** Byte-identical string and geometry to before this change. Screenshot `04-needs-address-unchanged.png` |
| **R4** Advanced is no longer silent | **Passed.** The previously-empty `.atoms-setting-error` under `Plus service URL` now renders the refusal for a wrong-but-valid base |
| **R5** the button | **Passed.** Notice fired, base written, row gone on redisplay, **no stamp minted**, zero network requests from the click. The record still names `:8799` and is correctly *not* cleared — it simply no longer resolves |

**Craft (R1 frame):** 182px row, 16px uniform padding, four-line desc unclipped (`scrollWidth 311 == clientWidth 311`), button 311×44 at the 44pt floor, **24px clear** to the `ATOMS PLUS` eyebrow with no shared hairline. Passed.

**F4 — P2, filed not fixed. A non-service-shaped 401 never reaches the new row.**
`verifyPlusBase` maps anything that is not `code:"auth"` to `unreachable` with the offline copy (`plusBaseVerify.ts:253`). But `plusClient` deliberately distinguishes three cases, not two: a service-shaped 401 (`isSessionRejectedMessage` — body says "invalid session"/"expired"), a gateway/proxy 401 (`upstreamRefusedMessage`, whose own comment says "blaming the session would be a lie"), and transport failure. The gate collapses the middle case into the last.

Consequence: a self-hoster behind a reverse proxy, WAF or auth gateway that returns a bare 401 is told *"Atoms Plus couldn't be reached … try again when you're back online"* indefinitely, and because the recovery row is gated on a recorded refusal, never sees the row either. Reproduced live: a stub returning `{"error":"unauthorized","message":"nope"}` yielded `unreachable` and wrote no record. A 401 with no CORS headers behaves the same way.

**It fails closed**, so this is diagnosability, not a hole. Pre-existing to the A5/A6 fix — it comes from U3's original mapping — but the new row makes the dead end sharper. Not widened here: making the gate distinguish a proxy refusal from a transport failure is a semantics change to a security mapping and deserves its own decision, since the plan explicitly chose not to branch on raw status codes.

### Not covered by the adversarial pass

The Advanced-screen navigation failed to change destination in one eval and was not chased; A6 was proven instead via the D1 row's presence/absence plus a unit assertion. **The Advanced field's own error render is therefore untested.**

## Not tested

- **Desktop-width D1 row.** All settings frames are mobile emulation; desktop Settings is a separate popout window `dev:screenshot` cannot capture. Same code path, unverified rendering.
- **A fully verified session end-to-end.** `POST /v1/auth/start` mints a *soft* session that `/v1/me` accepts but `/v1/classify` and the mirror routes reject. So "gate opens → filing succeeds" is proven only as far as *the request left with capture text and reached the local host* (US-7); the classify calls then 401 for an unrelated reason. Completing a real magic link would require reading service logs, which is forbidden as credential extraction.
- **Real production egress.** Every non-loopback request was blocked by design. `plus.tryatoms.app` was never actually contacted; US-4 proves the *attempt* was content-free, not that production accepts it.
- **BYOK classify and the paste-session `/v1/me` probe.** Both use `requestUrl`, outside the fetch recorder. Neither is a #508-gated path.
- **iOS / Android.** Desktop only. The gate is platform-neutral logic, but `plusBaseUrl` syncs via `data.json`, so multi-device behavior is untested on real devices.
- **The 401-CTA residual**, deferred by the code review to [#529](https://github.com/taihartman/obsidian-atoms/issues/529) — targeted by the adversarial pass; see above.

## Merge decision

**Ready after fixes, with two open product calls.**

The gate does what #508 says it does, proven live rather than inferred: the upgrade cohort is refused with **zero network calls**, a mismatch refuses classify *and* mirror with no body-bearing request, unreachable gets its own sentence, the R2 race holds under a real interleave, and the gate **re-opens** after a successful probe rather than stranding the user.

Three defects were found and fixed in this change, each with a neuter-verified regression test:

| | Severity | Found by |
|---|---|---|
| Notice stutter on the save-failure path | P2 | constructive drive, on screen |
| 401 from a non-issuing base offered a sign-in link at that base | **P1** | adversarial |
| Stale `rejected` record survived a re-link | P2 | adversarial |

Test count `2044 → 2064`: +1 copy-class guard, +19 adversarial. Build, tests and lint green.

**A5 and A6 were then fixed in this PR at the user's direction**, in one surface, and re-driven (R1–R5 above, all passed, with the `needs-address` state proven byte-identical). Final counts: **2044 → 2080 tests**, seven further guards neuter-verified against named tests, and the KTD14 nine unmoved — which is the check that mattered, since a changed row list there would have meant the new predicate was wrong.

One residual is filed rather than fixed: **F4**, a non-service-shaped 401 reads as "you're offline" forever and never reaches the new row. It fails closed and predates this fix.

**Residual risk to state in the PR:** the token half of the leak is unchanged (content-free calls including `/v1/me` still reach whatever base resolves); the email predicate is a bar raise, not host authentication, and now has a live repro showing an echoing host receiving capture bodies; `sendPlusMagicLink` remains ungated; the resolver still falls back with six consumers gated instead; and one D1 tap moves every synced device via `data.json`.

**Rebase note:** this branch forked at `f544110`; `origin/master` has since moved to `9f11d0b`. Nothing in this pass covers the merged result.
