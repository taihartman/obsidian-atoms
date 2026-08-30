# World-Class QA: home-scroll-during-filing

## Verdict

Not ready for a live-vault Ready stamp. Unit-proven. Motion cannot be screenshotted. Same evidence shape as #533.

## Charter

Keep Atoms home (left sidebar library) where the reader left it while notes file. Authority: `docs/plans/2026-08-30-home-scroll-during-filing-plan.md`, issue #611. Product loop vs fixture: **ui-chrome-only** — scroll position on a rebuilt ItemView, not a filing-quality claim.

## Preflight

- Product dogfood honesty: ✅ present in `docs/qa/README.md`
- Authority: plan + #611 + wait-card copy “You can keep browsing”
- Learnings: ✅ read (`docs/qa/learnings.md`)
- Navigation map: Atoms home left sidebar (`atoms:open-home`)
- Run command: `npm test` / `npm run build`
- Viewport/device: N/A for unit scrollTop; live sidebar would be desktop left leaf
- Auth path: N/A — no network in these tests
- Automation: vitest + jsdom `renderedHomeView`. Obsidian CLI is on this machine (`1.13.7`). Live vault smoke **not run** this pass (scroll is motion; `install-to-vault.sh` would contend for the shared vault)
- Vault lock: not acquired

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story id |
|---|---|---|---|
| Home library while filing | Wait card: “You can keep browsing.” | `.atoms-home-scroll.scrollTop` stays put across `render()` / vault debounce | US-keep-place |
| Open a detail | A new screen starts at the top | Detail `scrollTop` is 0 | US-detail-top |
| Back from a detail | Same rule as Settings #533 | Main library restores the saved position | US-back-restore |
| Vault write during Process / auto-run | Filing pass owns the next paint | `refresh()` is not called | US-skip-vault |

## Product loop vs fixture

All primary stories: `ui-chrome-only`. No capture → Process → observe filing quality. `renderedHomeView` stubs `loadData`.

## User Stories Tested

As a reader scrolled down Atoms home, I want the library to stay put while notes file, so I can keep browsing.
Acceptance: repeated `render()` and `beginRun("process")` leave `scrollTop` at 420.
Authority: plan + wait-card copy.
Evidence: `test/atomsHomeView.test.ts` “keeps the main library where it was” / “keeps the library in place when Process begins”.
Status: Passed (unit).

As a reader who opens an in-home detail, I want that screen at the top, and the library back where I left it when I go back.
Acceptance: detail 0; Back restores 420.
Authority: #533 same-screen rule.
Evidence: “starts a detail at the top and restores the library on the way back”.
Status: Passed (unit).

As a reader during Process or auto-run, I do not want each vault write to reload the library.
Acceptance: vault notify while `busy` or `inFlight` does not increment `refreshCalls`; a timer armed before Process is dropped.
Authority: plan fix 2.
Evidence: three skip tests; mutation-check of the timer re-check (delete it → expected 0, got 1).
Status: Passed (unit + neuter).

## Risk Matrix

| Kind | Check | Result |
|---|---|---|
| Happy | Keep scroll across render / beginRun | Pass |
| Happy | Skip vault refresh while filing | Pass |
| Edge | Timer armed before busy | Pass (mutation-checked) |
| Edge | Idle vault still refreshes after 400ms | Pass |
| Regression | Shared header shell tests still pass | Pass (10 existing cases) |
| Perception | Wait-card inFlight paint during auto-run | Not tested live — skip vault refresh means that card does not update until the finishing refresh |
| Craft | No layout change | N/A |

## Evidence

- `npm test` — 2354 passed before the two P1 follow-ups; scoped re-run 24/24 (`atomsHomeView` 19 + `homeScroll` 5) after delayed restore + per-detail keys
- `npm run typecheck` / `npm run lint` / `npm run build` green
- Mutation: timer re-check removed → “drops a vault refresh that was armed before Process” fails
- Screenshots: N/A — motion, same as #533

## Findings

None blocking in unit. Residual: auto-run no longer rebuilds home per capture, so the “Filing past thoughts…” wait-card state may not paint until the run ends. That is the silent-auto-run contract, not a new progress strip.

## Adversarial QA

| Scenario | Result |
|---|---|
| Vault event then immediately Process | Timer re-check drops the refresh (unit) |
| Auto-run inFlight with busy false | Skip still holds (unit) |
| Idle home still follows vault writes | Refresh fires after 400ms (unit) |
| Live Process while scrolled in the throwaway vault | Not tested this pass |

No new live hole proven. The timer race was the hole; it is now a regression test.

## Not Tested

- Live Obsidian sidebar scroll during Process / auto-run
- Phone / Android WebView
- Land-peak visibility if the reader is scrolled down when a run finishes (header subtitle still updates)

## Learnings

Consulted: `docs/qa/learnings.md` (Home `dev:screenshot` stale frames; vault lock). Appended a row: scroll restoration is motion — do not demand a screenshot.

## Merge Decision

Ship on unit + mutation evidence, matching #533. Do not call this world-class live QA. A human with Home open can confirm: scroll the library, Process or let auto-run file, stay put.
