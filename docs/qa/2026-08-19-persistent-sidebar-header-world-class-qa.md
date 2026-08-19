# Persistent sidebar header QA

Date: 2026-08-19  
Branch: `cursor/plan-sidebar-header-4de5`  
Issue: #579  
Plugin: 0.8.11  
Vault lane: `test_vault/test vault`

## Verdict

**BLOCKED — not merge-ready.**

The implementation and automated regression are green. The required live Obsidian UI pass, screenshots, `world-class-qa`, and its adversarial half did not run in this environment.

## Preflight

| Requirement | Result |
|---|---|
| Focused DOM regression | Pass — 8 tests |
| Full Vitest suite | Pass — 109 files, 2184 tests |
| Community lint | Pass |
| Typecheck + production build | Pass |
| Throwaway-vault seed and install | Pass — installed Atoms 0.8.11 |
| Obsidian CLI | **Blocked** — `obsidian` is not on `PATH` |
| `world-class-qa` skill | **Blocked** — not installed in this agent environment |
| `adversarial-qa` skill | **Blocked** — not installed in this agent environment |

`./scripts/verify.sh` completed its unit-test, seed, build, and throwaway-vault install stages, then stopped with `FAIL: obsidian CLI not on PATH`. No personal or Remote Vault data was touched.

## Acceptance status

| Story | Evidence | Status |
|---|---|---|
| Main home renders one shared header and one scroll region | `test/atomsHomeView.test.ts` | Pass |
| Atom detail keeps title, subtitle, More, Open today's note, and Settings | Parameterized DOM regression | Pass |
| Entity-siblings detail keeps the shared shell | Parameterized DOM regression | Pass |
| Mind-change-pair detail keeps the shared shell | Parameterized DOM regression | Pass |
| Repeated refresh preserves active detail without duplicate chrome | Real `AtomsHomeView.refresh()` with only data loading stubbed | Pass |
| Header remains outside the only scrolling region | Direct-child and ordering assertions | Pass |
| Nested sibling Back returns to the originating atom | Production `openAtomInHome` path in the DOM harness | Pass |
| Collapse and reopen the actual Obsidian sidebar | Requires Obsidian CLI/live renderer | **Blocked** |
| Header controls remain usable at phone width | Requires live renderer or mobile WebView | **Blocked** |
| Committed review screenshots | Requires live renderer | **Blocked** |

## Automated evidence

- The characterization test failed before the production fix with four detail failures: zero headers, no title, and zero shared controls.
- `npx vitest run test/atomsHomeView.test.ts`: 1 file, 8 tests passed.
- `npm test`: 109 files, 2184 tests passed.
- `npm run lint`: passed with no warnings.
- `npm run build`: typecheck and production bundle passed.
- The new test and home-view harness are included in `tsconfig.test.json`.

## Code review and simplification

- Simplification found one harness-default duplication; the harness now constructs the real view so class field defaults remain the source of truth.
- Code review found one P1: the test counted header and scroll elements without proving sibling ownership. The assertion now verifies the header and scroller are ordered direct children and that the scroller cannot contain the header.
- Additional hardening added subtitle coverage, real refresh coverage, production nested-Back loading, and test typechecking.
- No unresolved P0/P1 code-review findings remain.

## Adversarial QA

Not run. The shared adversarial QA skill is unavailable, and code review or unit tests are not substitutes for that gate.

## Handoff checklist

Run these steps in an environment with Obsidian 1.12+ and the CLI enabled:

1. Acquire the shared QA-vault lock and install the branch into `test_vault/test vault`.
2. Confirm Settings → Atoms reports version 0.8.11.
3. Open Atoms home, then open a real atom detail.
4. Confirm Atoms, the subtitle, More, Open today's note, Settings, and Back are visible.
5. Collapse and reopen the left sidebar. Confirm the same detail remains active and the full header remains visible.
6. Exercise More, Open today's note, Settings, and Back from the detail.
7. Repeat with an entity-siblings detail and a mind-change-pair detail.
8. Repeat at phone width and confirm no clipping, overlap, horizontal scrolling, or loss of detail scrolling.
9. Capture settled screenshots under `docs/qa/screenshots/persistent-sidebar-header/` using the repository's repeated-frame guard.
10. Run `world-class-qa`, including its required `adversarial-qa` pass, and replace this blocked verdict only after those gates complete.

## Evidence gap

No screenshots are attached. Attaching fixture or DOM-generated images would not prove the actual Obsidian sidebar behavior and would violate the UI evidence gate.
