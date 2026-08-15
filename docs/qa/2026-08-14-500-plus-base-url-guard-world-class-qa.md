# World-class QA — #500 Plus service URL scheme guard

**Branch:** `fix/plus-base-url-scheme-guard` · **PR:** [#502](https://github.com/taihartman/obsidian-atoms/pull/502) · **Version:** 0.7.12
**Date:** 2026-08-14 · **Vault:** `test_vault/test vault` · Obsidian 1.13.6 (installer 1.12.7), phone width 390×844

## Verdict

**Ready with disclosed gap.** Every changed behavior was driven on the real surface and passed — 9/9 constructive stories, 22/24 adversarial scenarios solid. The adversarial pass proved one **pre-existing** hole this change does not close ([#508](https://github.com/taihartman/obsidian-atoms/issues/508)): clearing the field sends a self-host token and capture bodies to production. This PR strictly improves the situation and no longer claims otherwise; #508 owns the fix.

Four findings filed, none blocking: [#504](https://github.com/taihartman/obsidian-atoms/issues/504), [#505](https://github.com/taihartman/obsidian-atoms/issues/505), [#506](https://github.com/taihartman/obsidian-atoms/issues/506), [#507](https://github.com/taihartman/obsidian-atoms/issues/507), plus [#508](https://github.com/taihartman/obsidian-atoms/issues/508).

## Charter

`plusBaseUrl` accepted any scheme and any host. Every Plus call attaches the device session bearer token to it; `/v1/classify` also carries verbatim capture text. The change adds `isAllowedPlusBaseUrl` and guards four egress paths, refuses to publish a bad origin on the Connect screen, and shows an inline error in Advanced.

**Regression risk:** the documented `http://127.0.0.1:8787` dogfood address; every Plus surface (Account, Connect, Ask mirror, filing); sign-out as a recovery path.

**Proof kind:** **user-loop.** The values were typed character-by-character into the real field and the results observed on the real screens. No hub-planting or graph-faking — for a guard, "type a bad URL and watch Plus refuse" *is* the user loop. The Plus session came from the catalogued fixture (`docs/qa/testing-fixtures.md` → Plus session), used only to make the Connect destination reachable; every behavior under test was driven through the UI.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Authority paths | ✅ `docs/ask-self-host.md`, issue #500, `CLAUDE.md` non-negotiables |
| Learnings | ✅ read before driving · ➕ 3 rows appended (one supersedes a stale row) |
| Navigation map | ✅ followed · 🔧 2 rows healed (both were made stale by this change) |
| Build/install | ✅ `install-to-vault.sh` confirmed v0.7.12 answered for `test vault` |
| Viewport | ✅ phone 390×844 (`is-phone` asserted) — desktop Settings is a popout and cannot be screenshotted |
| Auth path | ✅ catalogued Plus session fixture, reused not recreated |
| Fixtures | ✅ reused by name; none created |
| Deploy reality | N/A — plugin-only, no service change |

## Authority & promises

| Surface | Promise | Acceptance | Story |
|---|---|---|---|
| Plus service URL override | `docs/ask-self-host.md`: public host must be HTTPS; `http://127.0.0.1:8787` is the documented local address | https any host, http loopback only, else refused with a visible reason | US1, US4, US6 |
| Connect → MCP connector URL | On-screen: "Paste this URL and complete OAuth" | A refused base publishes no URL at all | US2 |
| Plus calls | #500: the token must not reach an unvetted host | Refused base → error, zero network egress | US7 |

No spec/copy conflict. One **promise gap** found and fixed in this PR: the row description listed the allowed values but never said others are refused, so `http://nas.local:8787` was silently rejected. Description now states the rule.

## User stories

| id | Story | Status | Evidence |
|---|---|---|---|
| US1 | Typing a non-https, non-loopback URL explains itself under the row | Passed | `us1-advanced-error.png` |
| US2 | A refused base publishes no MCP URL to paste into Claude/ChatGPT | Passed | `us2-connect-refused.png` — `hasMcpRow:false`, `evil.example` absent from innerText *and* innerHTML |
| US3 | Fixing the value recovers everything with no reload | Passed | `us3-error-cleared-advanced.png`, `us3-connect-publishes-mcp.png` |
| US4 | The documented `http://127.0.0.1:8787` dogfood address still works | Passed | published `http://127.0.0.1:8787/mcp` |
| US5 | Empty means the hosted service, with no error | Passed | published `https://plus.tryatoms.app/mcp` |
| US6 | A bare host with no scheme — the likeliest typo — is refused | Passed | `us6-no-scheme-refused.png` |
| US7 | The guard blocks egress, not just the UI | Passed | Refresh status, Manage subscription, and `atoms:dry-run-preview` all toasted the refusal; `egress:[]` |
| US8 | Advanced still renders its three rows and nothing else broke | Passed | `us3-error-cleared-advanced.png` |
| US9 | Craft: the error is legible and correctly spaced | Passed | see Craft below |

## Adversarial ledger (`adversarial-qa`)

Driven with a `window.fetch` recorder that logged every URL + `authorization` header and blocked real egress, so "no call happened" and "call went to the wrong host" are distinguishable rather than inferred.

| id | Scenario | Verdict |
|---|---|---|
| A1 | Edit to a refused base mid-session | solid — every Plus surface refused, `egress:[]` |
| A2 | Edit back to valid, no reload | solid — nothing stuck refusing |
| A3 | Edit the field *during* an in-flight run | solid — base pinned at resolve time, 16/16 requests to the validated host |
| **B1** | **Clear the field while signed in to a self-host** | **HOLED → [#508](https://github.com/taihartman/obsidian-atoms/issues/508)** |
| B2 | Sign out with a refused base | solid — session gone, `egress:[]`; Sign-out-all says "Signed out locally. Server said: …" and never claims the remote half worked |
| B3 | Wipe cloud copy with a refused base | solid (fail-closed) — screen is gone until the field is fixed, which the message instructs |
| C1 | Copy MCP URL, then switch to refused | solid — no stale URL anywhere in the DOM |
| C2 | Pair, then switch to refused | solid |
| D1 | Advanced → Connect → back | solid — error survives the route round-trip |
| D2 | Close and reopen Settings | solid — error present on first render, no keystroke needed |
| D3 | Triple-tap a Plus button | solid — exactly one notice, no stuck spinner, `egress:[]` |
| D4 | Type and close Settings immediately | solid — value saved |
| D5 | Type a valid URL character by character | solid, cosmetic nit — the error flickers on `h`/`ht`/`htt` |
| **G1** | **Obsidian Sync lands a bad value mid-run** | solid — bad value landed at +1.5s of a 13.4s run; all 8 requests went to the validated host, **zero** to the injected one |
| G2 | Same, with Settings open | solid — input *and* error both update; the screen does not lie |
| F1–F5 | 2000-char URL · whitespace-only · IDN/unicode · base with a path · invalid port | all solid |
| I1 | Description never said other values are refused | HOLED (docs) → **fixed in this PR** |

Bonus refusals proven live: userinfo confusion (`http://127.0.0.1@evil.example`), suffix (`http://localhost.evil.example`), `javascript:`, `file:`, `//my.example`. Bonus correct-allows: `http://2130706433`, `http://[::1]:8787`, case-variant schemes.

Beyond the ledger, all solid with zero egress on a refused base: Ask mirror background sync, `atoms:process-unprocessed` (atom count unchanged 436→436), `savePastedSession`.

### The one hole — B1

Signed in against `http://127.0.0.1:8787`, clearing the field resolves to production at every call site:

```
{"url":"https://plus.tryatoms.app/v1/me","auth":"Bearer qa-token"}
{"url":"https://plus.tryatoms.app/v1/classify","auth":"Bearer qa-token",
 "body":"{\"capture\":\"unmarked observation 110 that should still process\",…"}
```

Five classify calls carried capture bodies and the vault title list; the UI said only "Couldn't reach Atoms Plus". Pre-existing (`|| DEFAULT_PLUS_BASE_URL` always meant this), but it contradicts the rationale this PR states, so the PR's comment and `docs/ask-self-host.md` were corrected rather than left claiming a property that does not hold. The fix needs `PlusSession` to record its issuing base — a schema change with a real decision about legacy sessions — so it is [#508](https://github.com/taihartman/obsidian-atoms/issues/508), not a bolt-on here.

**Suspected, unproven:** `savePastedSession` has the identical shape and very likely does the same. Not executed — that path uses `requestUrl`, outside the fetch recorder, so proving it meant sending a token to real production.

## Craft (§5b)

Decisive frame read in the main thread: `us1-advanced-error.png`. **Pass.** `--text-error`, `--font-ui-smaller`, wraps to three lines at 390px with no clipping or overlap; sits outside the row card, tight under the input (`margin-top: -6px`) and separated from the next card by `padding-bottom: 12px`, so the asymmetry binds it to the row above. `:empty { display: none }` leaves no ghost gap when cleared.

Second frame read to adjudicate a reported defect: `us7-account-refusal-clipped-row.png` — **craft defect confirmed on an adjacent surface.** The Account status row's name column collapses to `Last ch… did… go thr…` over four lines beside a six-line value. Pre-existing row layout; this change supplies the longest value it has held. Filed as [#507](https://github.com/taihartman/obsidian-atoms/issues/507). Not blocking: the message is fully readable in the value column, and the fix belongs to the shared status-row layout ([#487](https://github.com/taihartman/obsidian-atoms/pull/487) did the same for the Email cluster).

## Automated

| Check | Result |
|---|---|
| `npm test` | 1786 passed (97 files) — 24 new |
| `npm run build` | clean (`tsc -noEmit` + esbuild) |
| `npm run lint` | clean (`eslint --max-warnings 0`) |

Mutation-checked rather than assumed: the guard tests were watched failing before implementation, and the Connect-screen refusal, the classify egress guard, and two settings-error tests were each re-run with their guard neutered and confirmed to fail.

## Not tested

- **Real Stripe/checkout and billing-portal URLs** — no live account; the `window.open` scheme gap is [#504](https://github.com/taihartman/obsidian-atoms/issues/504).
- **A genuine emailed magic-link tap** — reading `plus.sqlite` would be credential extraction (standing learnings rule). The session came from the catalogued fixture.
- **Real remote self-host over a public HTTPS tunnel** — loopback and refused hosts were driven; a real tunnel was not stood up.
- **iOS / Android** — desktop only. The changed surfaces are settings rows and a request guard with no platform-specific code, so residual risk is low but not zero.
- **`savePastedSession` with an empty base** — see suspected-unproven above.

## Learnings appended

Three rows added to `docs/qa/learnings.md`:

1. `dev:screenshot` needs **three** captures, not two — frame 1 is *reliably* the previous state, so a two-shot pair agrees-but-is-stale about half the time. Supersedes the 2026-08-08 row.
2. `@electron/remote` **works** on 1.13.6 for phone width — promoted from "try" to a recipe, with the order that matters (resize, then emulate).
3. Notices need a `MutationObserver` installed **before** firing the command; sleep-then-poll returns `[]` after the ~5s fade and reads as "nothing happened" — a false negative on the exact refusal being proven.

Two `docs/qa/app-navigation-map.md` rows healed in this PR: the Plus service URL override row still said "no host validation", and the Connect destination row had no refused-base branch.
