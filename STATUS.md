# STATUS — in flight

Agent radar for multiplayer work. **Update this when you claim, block, or finish.**  
Process: [`docs/collab.md`](docs/collab.md) · Issues/PRs on GitHub.

## In flight

| State | Issue | Owner | Branch | Plan | Hot files | Notes |
|---|---|---|---|---|---|---|
| In progress | [#339](https://github.com/taihartman/obsidian-atoms/issues/339) | taihartman | `feat/339-ask-search-recall-honesty` | [plan](docs/plans/2026-08-06-004-feat-ask-search-recall-and-agent-honesty-plan.md) | `plus-service/src/store/askHelpers.mjs`, `plus-service/src/mcp/*`, store backends | Search honesty + expand; PR #340 **MERGEABLE** · **0.6.87** · ack version bumped to `2026-08-07`, `ASK_EXPAND_ENABLED` defaults on, branch code review done (P1s fixed, client-side-consent gap accepted as known risk). **Remaining gate: `world-class-qa`** — see `docs/handoffs/2026-08-07-340-qa-and-ship.md`. Note: merging now auto-publishes a Release |
| In progress | [#166](https://github.com/taihartman/obsidian-atoms/issues/166) | taihartman | `feat/166-android-companion-capture` | [plan](docs/plans/2026-08-07-001-feat-android-companion-capture-poc-plan.md) | `companion/android/**` | Android Capture POC — PR #362 · worktree `../obsidian_plugin-166-android-companion-capture` |
| In progress | [#336](https://github.com/taihartman/obsidian-atoms/issues/336) | taihartman | `fix/336-no-missing-time-alarm` | debug lane | `src/home/atomsHomeData.ts`, `src/home/atomsHomeView.ts`, `src/settings/captureShortcut.ts` | Missing times are normal; drop Home repair card · plugin bump |
| In progress | [#307](https://github.com/taihartman/obsidian-atoms/issues/307) | taihartman | `feat/tryatoms-mailing-list` | [plan](docs/plans/2026-08-05-001-feat-tryatoms-mailing-list-plan.md) | `www/**`, `.github/workflows/tryatoms-pages.yml` | Atoms Notes list + Pages Function subscribe; no plugin bump |

## How to claim (copy)

1. Create/assign GitHub Issue  
2. `git checkout master && git pull && git checkout -b feat/<name>`  
3. Add a row above (State = `In progress`)  
4. Push branch and open **draft** PR  
5. Only then implement  

States: `Queued` · `In progress` · `Blocked` · `In review` · `Done` (then remove row)

## Recently merged (optional, last ~5)

| Merged | Issue / PR | Summary |
|---|---|---|
| 2026-08-07 | #360 / #361 | Both Ask acks now carry the wording they were granted against, so a reworded disclosure re-prompts instead of riding on an old yes · **0.6.86**. Every gate reads **both halves** — a real, parseable timestamp *and* a matching version — and `revokePaired` forces a version to die with its timestamp even when the incoming payload omits the key. Withdrawal rows stay keyed to the timestamp, so a stale grant keeps the only surface that can revoke it. **Real multi-device Sync was never exercised on hardware** — the mixed-version payloads are reproduced by seeding, and the round-trip they rely on was verified against master's source (`Object.assign({}, DEFAULT_SETTINGS, raw)` in, `saveData(this.settings)` out). Merged on the owner's explicit call, same as #323, with the gap left unchecked in the PR test plan. **Turns [#340](https://github.com/taihartman/obsidian-atoms/pull/340) red on purpose** until it lands the seven-clause disclosure, bumps `ASK_PRIVACY_ACK_VERSION`, adds a **new** keyed `FROZEN_ASK_PRIVACY` entry, and only then flips `ASK_EXPAND_ENABLED`. Follow-ups: #363, #364, #365, #341 |
| 2026-08-06 | #357 / #358 | **Production served a fixture-built site.** `tryatoms-pages.yml` built `www/dist`, then ran the archive test — which rebuilt dist from its fixtures — then deployed that, so the real build never shipped. `ATOMS_DIST_DIR` isolates the test; assertions now run **before** the build so the shipped build is structurally last; committed `www/dist` regenerated (`notes/sample-loop/index.html` was a page for a note that does not exist). **Verified live**: /notes/ shows the empty state, /notes/sample-loop/ 404s. Deleting the source fixture in #355 had changed nothing — the test put it back every deploy |
| 2026-08-06 | #354 / #355 | `npm test` deleted a tracked file every run — the archive test staged its fixture *inside* `docs/field-notes/published/`, which is not empty in git. Build dir is overridable now (`ATOMS_PUBLISHED_DIR`); guarded by an in-suite listing assertion (mutation-tested) **and** a CI clean-tree check that catches the next leak, not just this one. **The stray fixture was live**: tryatoms.app/notes/ listed it as a real Field note with `subject: "Sample Field note"` — removed, so the archive shows its honest empty state. Origin of the whole thing: #335 ran the suite and committed the copy with `git add -A` |
| 2026-08-06 | #323 / #330 | A consent withdrawn on another device closes this device's gate — the egress predicate gets one home, the follow-up mirror pass asks it too, and only a *withdrawal* crosses a lost read/save race, never a grant · **0.6.84**. **The cross-device leg was not reproduced on hardware:** the two-device smoke saw the grant propagate and a restart apply the withdrawal, but never observed a running desktop react. Merged on the owner's explicit call with that recorded in the PR Evidence table — debug ruled out every code-side cause (hook shipped, folder name matches manifest `id`, Sync toggle on, UI layer cannot swallow it) and landed on Sync's config-file cadence as the surviving hypothesis. See [the learning](docs/solutions/workflow-issues/a-sync-test-must-outwait-sync-before-it-can-blame-the-code.md) |
| 2026-08-06 | #347 #348 / #349 | A field and the button that commits it are one row — `formRow`, a **sixth** row kind, composed not configured; four pairs, 8 rows → 4; `accountInput` and the three `dataset.plus*` markers deleted. Back chevron moved to the row's leading edge in the **base** rule — desktop had the same 236px gutter, so it was never an `is-phone` fix · **0.6.83**. **Adversarial QA caught a regression worth remembering:** Obsidian stacks settings rows only under `is-phone`, so an `is-phone`-gated rule leaves `is-tablet` with neither — the merged inputs squeezed to 76–98px on iPad. Fixed with a 164px floor, not a second stacking gate. Follow-ups open: #350, #351 |
| 2026-08-06 | #342 #346 / #345 | Proposed tags stop renting a row each for Dismiss; one section-level **N proposals waiting / Dismiss all** row, scoped to the proposals it rendered · **0.6.82** |
| 2026-08-06 | #315 #314 / #329 | One egress disclosure for Home and Settings — a **union** of both strings, not a swap · **0.6.81** |
| 2026-08-06 | #334 / #335 | Field notes public archive on tryatoms (`/notes/`); www-only |
| 2026-08-06 | #331 / #332 | Ask `search_atoms` confidence + true empties (Fly deployed; no plugin bump) |
| 2026-08-06 | #325 / #326 | Root `npm test` + `npm run build` now run on `pull_request` (infra only, no plugin bump). **Not yet a required check** — branch protection on `master` still requires only `test` (plus-service), so `test + build` reports without blocking until an admin adds it |
| 2026-08-05 | #309 / #310 | One PKCE S256 digest, pinned to base64url (server-only, no plugin bump). **#240 must import `pkceChallengeS256` — never `hashToken`, which is hex.** Its plan said hex for `verifier_hash`; corrected on `feat/240-magic-link-handoff` (`a692e2f`, rides on #298) |
| 2026-08-05 | #287 / #297 | Library **Skipped** filter + long-press **Try filing…** (Reconsider; Plus/BYOK) · **0.6.77**. The Home path is deliberately **not** behind `enableReconsiderCapture` — #304's U8 removes the leftover flag |
| 2026-08-05 | #301 / #302 | Hero shows the loop closing — capture beat per storyline + promoted sub-line; verbatim match guarded by test (www-only) |
| 2026-08-05 | #299 / #300 | `/setup` installs from the community directory, not BRAT; adds the Open Atoms step; guide tightened 1582→1332 words (www-only, no plugin bump) |
| 2026-08-05 | #294 / #295 | Custom capture-shortcut link is optional, not a setup step · **0.6.76**. **Prepend, never append**, to `BUILTIN_INSTALL_URLS` when the link moves — the constant is its head |
| 2026-08-05 | #292 / #293 | Built-in capture shortcut points at the current iCloud link; shortcut CTA re-armed (2.1.0) · **0.6.75** |
| 2026-08-05 | #288 / #289 | Library tap=vault; long-press Continue · **0.6.73** |
| 2026-08-05 | #280 #282 / #281 | One "Atoms Plus is ready" notice per checkout, not one per in-flight poll; resume listeners tied to the plugin lifecycle · **0.6.72**. **#241 must land on top of this** — widening the poll window without the atomic announce is #280 again |
| 2026-08-05 | #277 / #278 | `/setup` from-zero guide (install · iOS capture · Ask); landing `#install` shrinks to a pointer. **Follow-up: screenshots need recapturing on desktop dark — the shipped ones are poor** |
| 2026-08-05 | #16 / #275 | Home Continue + pending parent handoff · **0.6.71** (community lint blockers) |
| 2026-08-05 | #238 / #268 | Stripe reconcile + ops alerts (server-only) |
| 2026-08-05 | #239 / #273 | First CI job that runs plus-service tests; real postgres coverage for the production store (test infra only, no plugin bump). Now a **required** check on `master` (see #238 tail) |
| 2026-08-05 | #257 #258 / #272 | Ask MCP `created` + list sort/filter + `list_pending` · **0.6.70** (Fly deploy still needed) |
| 2026-08-04 | #222 / #266 | Catch-up on resume + Sync everything now · **0.6.67** |
| 2026-08-04 | #256 / #262–#265 | Ask MCP `list_tags` + residuals · Fly live (no plugin bump until 0.6.67) |
| 2026-08-04 | #255 #259 / #260 | Ask MCP `mirror_status` + absence wording · Fly live (no plugin bump) |
| 2026-08-04 | #251 / #252 | Ask MCP pairing code + OAuth identity chooser · **0.6.66** (released; Fly already live) |
| 2026-08-04 | #246 / #247 | Ask coordinator peel + wire the inert confirm-withdrawal hook · **0.6.65** (released) |
| 2026-08-04 | #248 / #249 | Mirror completeness floor counts surviving evidence, not raw scan · **0.6.64** |
| 2026-08-04 | #225 / #226 | Gate mirror deletion, fix outbox ack, verify marker placement · **0.6.63** |
| 2026-08-04 | #243 / #244 | Classify dual-surface parity freeze + people hard-rules line · **0.6.63** |
| 2026-08-02 | #230 / #231 | Production trial checkout no longer revokes the plugin session; a rejected session is never a dead end · **0.6.62** |
| 2026-08-01 | #224 #227 / #228 | Person invites name model-identified people, not the leading verb · **0.6.61** |
| 2026-07-30 | #196 / #218 | Classify prompt same-thread link soften + quality 7 · **0.6.57** |
| 2026-07-30 | #186 / #187 | BM25 body-scored shortlists for classify context · **0.6.53** |
| 2026-07-30 | #206 / #207 | tryatoms Obsidian on-ramp for newcomers (install step 1 + hero link) |
| 2026-07-29 | #194 / #195 | Ask MCP Bar B — `atoms:write` scope + Claude directory pack (Fly already live) |
| 2026-07-29 | #188 / #189 | Ask MCP dual-era 2026-07-28 + OAuth `iss` + Claude JSON Accept fix (Fly already live) |
| 2026-07-29 | #184 | Capture Shortcut link refreshed + renamed **Capture Atom** everywhere · **0.6.51** |
| 2026-07-29 | #182 / #183 | Cloudflare Web Analytics through the tryatoms.app CSP + corrected privacy claims |
| 2026-07-28 | #181 | Verified iOS Shortcut link + the recipe that actually works · 0.6.50 (shipped in 0.6.51) |
| 2026-07-28 | #56 / #167 | iOS capture inbox + drain into dailies · **0.6.49** |
| 2026-07-28 | #174 / #175 | Community review lint (styles, confirm, types) · **0.6.47** |
| 2026-07-28 | #115 | Plus public launch ops — tryatoms domain, Resend, Stripe **live** on Fly |
| 2026-07-28 | #150 / #152 | Ask MCP unmisreadable shapes (revision status, snippet authority, scope) |
| 2026-07-27 | #120 / #146 | DIY Ask self-host guide (`docs/ask-self-host.md`) |
| 2026-07-27 | #119 / #141 | Ask ChatGPT MCP connector · **0.6.41** — Fly deploy + AE5 dogfood before BRAT |
| 2026-07-27 | #137 / #138 | Ask mirror parity (events + delete + reconcile) · **0.6.39** — Fly deploy + dogfood before BRAT release |
| 2026-07-27 | #131 #129 / #132 | Ask dogfood follow-ups · **0.6.36** |
| 2026-07-27 | #127 / #128 | Ask write path create/continue · **0.6.35** |
| 2026-07-27 | #123 / #124 | Plus stripe-first onboarding (0.6.33) |
| 2026-07-27 | #112 / #116 | Ask your brain remote MCP · release **0.6.32** |
| 2026-07-27 | #91 #107 / #92 | Atoms Plus managed filing + production backend (0.6.30) |
| 2026-07-22 | #100 / #102 | Reconsider capture (flagged) · release 0.6.27 |
| 2026-07-18 | #97 / #98 | Library row opens vault note (not in-home reader) |
| 2026-07-18 | #93 #95 / #94 | Entity orbits T0–T3 + Together Open list (0.6.26) |
| 2026-07-17 | #83 / #84 | Open atom graph command (0.6.19) |
| 2026-07-17 | #74 / #75 | ghost textButton kit + bridge chrome fix |
| 2026-07-17 | #71 / #72 | Land, then remember + drop For you label (0.6.14) |
| 2026-07-17 | #66 / #67 | collision body-gate + Process failure surface (0.6.13) |
| 2026-07-16 | #63 / #64 | library within-day created order (0.6.12) |
| 2026-07-16 | — | remove PR Closes CI; agent-checked only |
| 2026-07-16 | #53 / #54 | drop junk link reasons (0.6.10) |
| 2026-07-16 | #48 / #49 | aliases/prior as self (0.6.9) |
