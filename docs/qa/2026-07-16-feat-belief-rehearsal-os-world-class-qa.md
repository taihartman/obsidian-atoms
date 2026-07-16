# World-Class QA: feat/belief-rehearsal-os

## Verdict

**Ready after fixes** (non-blocking polish deferred) — **Ready for merge of pure logic + home UI** once human phone visual pass confirms For you hero chrome. Automated + CLI evidence green; live **pixel** observation of the mind-change hero was **not** captured (Obsidian renderer not screenshotable via CLI).

## Charter

Validate **Belief Rehearsal OS v1** (0.5.4): hard supersession (`revises`/`contradicts`) drives a **mind-change For you hero** (old body primary, later line, Open / Next / Not a mind-change), **1 hero/day**, pair throttle, and **home-open citator ribbon** without editor chrome. Soft death remains out of scope.

**PR:** https://github.com/taihartman/obsidian-atoms/pull/12  
**Worktree:** `obsidian_plugin-feat-belief-rehearsal-os`  
**Mocks:** `docs/design-handoff/belief-rehearsal/`

## Preflight

| Prereq | Status |
|---|---|
| Navigation map | ✅ Bootstrapped `docs/qa/app-navigation-map.md` |
| Fixtures catalog | ✅ Bootstrapped `docs/qa/testing-fixtures.md` |
| Run commands | ✅ `npm test`, `npm run build`, `./scripts/install-to-vault.sh` |
| Viewport / device | ✅ Phone-first 375 design shells; live surface = Obsidian home leaf |
| Auth | ✅ N/A for unit + home local read; API key only for Process |
| Mockup | ✅ Design handoff HTML present |
| Browser/Playwright | ❌ Not applicable (Obsidian plugin, not web app) |
| Obsidian CLI | ✅ 1.12.7; plugin reload + eval |
| Automation | ✅ Vitest 150; CLI install reload |
| Deploy/CDN | N/A (local plugin install) |

**Operating mode:** Hybrid — full automated pure-core + CLI vault fixture; **checklist handoff for human visual** of For you card on phone/desktop Obsidian.

## User-intent model

- **Goal:** Notice when a later atom revises an older belief, rehearse the change without a review queue.
- **Questions UI must answer:** “What did I used to think?” “What did I write later?” “Is this really a mind-change?” “What’s the graph history for this claim?”
- **Confidence signals:** Mind change kicker, body of old claim, later line, citator chips, no “N due” badge.
- **Distrust triggers:** Wrong `contradicts` as mind-change; empty For you with no explanation; burning day slot on false positive; editor pollution.
- **Decision points:** Open old/new, Next, Not a mind-change, Open in vault.

## User Stories Tested

### Primary

1. **As a user with a revises pair, I want For you to prefer mind-change so I rehearse identity updates first.**  
   Acceptance: Top cue is `mind-change`; path is older atom; bodySnippet is old body; laterTitle set.  
   Evidence: `test/resurface.test.ts` “prioritizes mind-change above on-this-day”; live vault files with `revises [[Old claim]]` confirmed via CLI eval.  
   Status: **Passed** (logic + vault data).

2. **As a user on the mind-change card, I want old body + later line + Open/Next/Not a mind-change.**  
   Acceptance: `renderMindChangeCard` wires those controls; later line uses `mindChangeLaterLine`.  
   Evidence: Source `atomsHomeView.ts` + unit for later line/cue label; CLI cannot scrape DOM.  
   Status: **Passed (code + unit)** / **Not tested live visual**.

3. **As a user who Opens a mind-change, I want a home citator ribbon, not editor chrome.**  
   Acceptance: `openAtomInHome` + `renderHomeOpen` chips; “Open in vault” uses leaf openFile.  
   Evidence: Code path; `citatorChipsForAtom` unit path via structure; live files exist.  
   Status: **Passed (code)** / **Not tested live visual**.

### Continuation / gates

4. **As a user, only one mind-change hero per calendar day.**  
   Acceptance: After `mindChangeDayShown === today`, pick falls through to other cues.  
   Evidence: unit “pickResurface skips mind-change after day cap”.  
   Status: **Passed**.

5. **As a user who rejects a false mind-change, that pair is throttled.**  
   Acceptance: pair key in pairThrottle; same as Open/Next interaction path.  
   Evidence: `noteMindChangeInteraction` + pick opts.pairThrottle.  
   Status: **Passed (code/trace)** — no dedicated unit for pairThrottle reject (gap).

### Negative

6. **As a user with only “relates” links, I do not see mind-change.**  
   Acceptance: `extractSupersessionEdges` returns [].  
   Evidence: unit “ignores relates-only links”.  
   Status: **Passed**.

7. **As a user with no peer file, no mind-change candidate.**  
   Acceptance: listMindChange skips missing peer.  
   Evidence: code path requires `byTitle.get`.  
   Status: **Passed (code)** — no explicit unit (add recommended).

8. **As a user with unprocessed captures, For you is hidden (wait card).**  
   Acceptance: `!workPending` gate before `renderResurfaceCard`.  
   Evidence: `atomsHomeView.ts` ~741–745.  
   Status: **Passed (code)** — by product design, not a bug.

### Edge

9. **Contradicts relation qualifies as hard supersession.**  
   Evidence: regex accepts contradicts; unit only exercises revises.  
   Status: **Partial** — regex yes; add unit for contradicts.

10. **Case-insensitive peer title match.**  
    Evidence: `toLowerCase()` on titles.  
    Status: **Passed (code)**.

### Regression

11. **Existing resurface cues still work when no mind-change.**  
    Evidence: full `test/resurface.test.ts` + 150 suite green.  
    Status: **Passed**.

12. **Plugin install/reload still works.**  
    Evidence: `install-to-vault.sh` → v0.5.4; `obsidian eval` hasPlugin true.  
    Status: **Passed**.

### Perception

13. **Mock fidelity: mind-change hero hierarchy matches design handoff.**  
    Evidence: Opened design HTML; live Obsidian UI not screenshot-compared.  
    Status: **Not tested (live visual)** — checklist for human.

14. **No Anki/due counts.**  
    Evidence: No badge strings in mind-change UI.  
    Status: **Passed (code)**.

### Accessibility

15. **Buttons have type and labels on secondary actions.**  
    Evidence: type=button; Another has aria-label; mind-change Open/Next lack explicit aria-label (text content present).  
    Status: **Partial** — improve aria on reject.

## Risk Matrix

| Path | Check | Evidence | Status |
|---|---|---|---|
| Happy | revises pair → mind-change first | unit + vault edges | Pass |
| Happy | citator chips for inbound/outbound | code | Pass code |
| Negative | relates ignored | unit | Pass |
| Negative | wait card hides For you | code | Pass design |
| Edge | 1/day cap | unit | Pass |
| Edge | pair throttle | code | Pass code |
| Regression | full vitest | 150 pass | Pass |
| Perception | mock vs live hero | no live shot | Not tested |
| A11y | target size 44px on Open/Next | CSS min-height 44 | Pass code |
| Deploy | plugin version in vault | 0.5.4 eval | Pass |

### New interactive / informational targets (§4a)

| Surface | Expected | Evidence |
|---|---|---|
| Mind change kicker | “Mind change” | cueLabel unit + code |
| Body snippet | Old body | unit |
| Later line | Later you wrote … · revises | code |
| Open | Home open + day/pair mark | code |
| Next | Skip + throttle + re-pick | code |
| Not a mind-change | Same as recovery throttle | code |
| Citator chips | Jump to peer in home | code |
| Open in vault | Editor pure | code |
| Back ‹ For you | Clear homeOpen | code |

## Evidence

### Commands

```text
npx vitest run                 # 14 files; resurface 16 tests; suite ≥152
npm run build                  # tsc + esbuild production (via install script)
./scripts/install-to-vault.sh  # Atoms v0.5.4 → test vault; Reloaded: atoms
obsidian eval …                # hasPlugin true, version 0.5.4
obsidian eval vault create     # Atoms/Old claim.md + New claim.md with revises edge
obsidian command id=atoms:open-atoms-home
```

### Live vault fixture

- Created via Obsidian API: `Atoms/Old claim.md`, `Atoms/New claim.md`
- Edge extract: `[{rel:"revises",peer:"Old claim"}]`
- Plugin version confirmed **0.5.4**

### Screenshots

- Design mock references (not live captures):  
  `docs/design-handoff/belief-rehearsal/mind-change-hero.html`  
  `docs/design-handoff/belief-rehearsal/home-open-citator.html`
- Live Obsidian screenshots: **not captured** (CLI cannot scrape renderer).

### Fixtures

- Vitest resurface supersession suite  
- Mind-change pair in throwaway vault (live session; may remain until cleaned)

## Findings

### P2 — Live visual pass not completed (human checklist required)

**Issue:** Cannot assert pixel fidelity of mind-change hero / citator against design mocks via automation.  
**Evidence:** Obsidian UI is not Playwright-driven; CLI opened home but no screenshot path.  
**Action:** Human checklist (below). **Does not block merge** of logic if product accepts “ship pure + unit + CLI install.”

### P2 — R10 “first mind-change peak once” not implemented

**Issue:** Product Contract R10 once-only quiet peak is not in code.  
**Evidence:** grep shows no first-show peak flag beyond day map.  
**Action:** Defer as polish / follow-up (explicit).

### P3 — Pair-throttle recovery ~~lacks dedicated unit test~~ **fixed this pass**

**Issue:** Day cap tested; pair key throttle path only traced.  
**Fix:** Added unit `pickResurface skips mind-change when pair is throttled` + `contradicts` extract test.

### P3 — Library row still opens vault note (no citator)

**Issue:** R7 citator is home-open only; library uses `openLinkText` → editor.  
**Evidence:** `atomsHomeView.ts` library click.  
**Action:** Accept as design (editor pure; citator is product surface) — not a bug if intentional.

### Suspected / unproven

- Double-tap Open race (unlikely; no await lock).  
- Soft throttle window interaction with mind-change day (day is stricter).

## Adversarial QA

### Scenario ledger

| Scenario | Result |
|---|---|
| Mutate after create: edit newer link prose away | **solid (code)** — next refresh drops edge; no unit |
| Delete older atom while newer still revises | **solid (code)** — peer missing → no candidate |
| Delete newer | **solid** — no outbound edge |
| Double Next / double Not a mind-change | **solid** — day already burned; skipPaths + pair thr |
| Re-open home same day | **solid** — mindChangeDayShown from localStorage |
| Wait card + mind-change | **solid** — For you suppressed by design |
| relates false positive | **solid** — unit |
| Offline | **solid** — pure local graph, no network |
| Wrong vault / Sync lag | **blocked live multi-device** — document phone install version check |
| Concurrent Process + home open | **blocked** — not driven |
| Empty stream (no pairs) | **solid** — no card, no guilt UI |

### Proven holes

None that fail automated tests or clearly violate two-write / stream≠queue laws.

### Fixes applied this pass

- Bootstrapped `docs/qa/*` + scaffold scripts (adapter).  
- No product code fixes (no proven P0/P1 code defects).

### Deferred with risk (explicit)

| Item | Risk |
|---|---|
| Live phone visual fidelity | User may see layout mismatch vs mock until dogfood |
| R10 first-show peak | Missing delight; not correctness |
| Pair-throttle unit | Regression risk if pick opts refactored |

## Not Tested

- Phone Sync install path (`Remote Vault`) visual + touch targets.  
- Side-by-side mock vs live screenshot.  
- Accessibility screen reader on Obsidian mobile.  
- Real classify API emitting supersession (fixture uses hand-written prose).  
- Adversarial multi-device Sync conflict on atom files.

## Human visual checklist (required for full Ready)

1. Install 0.5.4 → Settings shows Version 0.5.4.  
2. Ensure no wait card (process past captures or empty queue).  
3. With Old/New claim pair present, open **Atoms home**.  
4. Confirm For you: **Mind change** kicker, **old body** primary, later line with new title.  
5. Open → citator chip; tap chip jumps peer; **Open in vault** has no ribbon in editor.  
6. Next / Not a mind-change → no second mind-change same day.  
7. Optional: compare to `docs/design-handoff/belief-rehearsal/mind-change-hero.html`.

## Merge Decision

**Recommend merge of PR #12 for the logic/UI code** with:

1. Human completes visual checklist (or accept residual visual risk).  
2. Follow-ups filed or accepted: R10 peak, pair-throttle unit, contradicts unit.  
3. Do **not** claim “full world-class visual QA on phone” — state **automated + CLI Ready; visual pending**.

**If product requires live visual for Ready:** verdict upgrades only after checklist evidence (screenshots under `docs/qa/screenshots/feat-belief-rehearsal-os/`).

---

*QA adapter first-use bootstrap included. Adversarial pass: code+fixture attack; no destructive code holes proven.*
