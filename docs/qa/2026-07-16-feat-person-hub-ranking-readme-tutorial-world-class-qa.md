# World-Class QA: feat/person-hub-ranking-readme-tutorial

**PR:** https://github.com/taihartman/obsidian-atoms/pull/17  
**Build:** 0.6.3 · commit `f035abd`  
**Date:** 2026-07-16

## Verdict

**Ready after polish** — ranking + repair correctness is proven (unit + live demo-vault context). Merge is reasonable for the logic ship. **Not** full Apple-product polish: README tutorial is desktop chrome on a phone-first product, and hub intelligence is still silent when it fails.

Not **Blocked**: live surface was driven (demo vault install, `buildContext` hubs, CLI reload).

---

## Charter

**What changed**

1. Person hub discovery: score → threshold → top-N (Social/People boost; no `Personal notes/` free pass).
2. README How-to-use walkthrough + synthetic dogfood screenshots + seed script.

**Workflows that must work**

- Preference-shaped captures still repair-link to real person hubs (`People/`, `Social/`).
- Topic pages under `Personal notes/` are not hubs.
- README path renders tutorial images; demo seed is fictional only.

**Regressions**

- Repair still atom-only / person-shaped only; no auto-create hubs; denylist folders still excluded.

**Surfaces**

- Logic: pure `people.ts` (unit-primary).
- Live: Obsidian desktop demo vault (agent automation target).
- Docs: GitHub README images (desktop screenshots).

---

## Preflight

| Prereq | Status |
|---|---|
| Navigation map | ✅ `docs/qa/app-navigation-map.md` |
| Dev/run | ✅ `npm test` / `npm run build` / `obsidian vault=…` |
| Viewport | ✅ Desktop agent vault; primary product phone noted |
| Auth | ✅ N/A for discovery pure logic; classify key not required for hub list |
| Fixtures | ✅ `scripts/seed-demo-vault.mjs` (synthetic); unit tables in `test/people.test.ts` |
| Browser automation | ❌ N/A (Obsidian Electron, not web app) |
| Obsidian live | ✅ demo-vault open; plugin 0.6.3 installed |

**Mode:** Hybrid — full unit + live hub probe on demo vault; README visual as committed assets; phone Sync path not re-run this pass.

---

## User intent model

| Question | Expectation |
|---|---|
| Goal | Captures about people land linked to the right existing note without CRM setup |
| Confidence | Atom shows person chip / hub backlink after Process |
| Distrust | Wrong hub (topic page) or silent miss with no explanation |
| Decision | User never chooses hub discovery rules — product must be tasteful |

---

## User Stories Tested

### Primary

1. **As a user with `People/Jordan.md`, I want preference captures to treat Jordan as a hub**  
   Acceptance: `discoverPersonHubs` includes Jordan; repair injects link.  
   Evidence: live `buildContext` → `personHubs: ["Jordan","Riley"]`; unit People/ test; repair inject PASS.  
   Status: **Passed**.

2. **As a user with topic pages under Personal notes, I do not want “Book list” as a person hub**  
   Acceptance: not in hub set.  
   Evidence: adversarial PASS; unit test.  
   Status: **Passed**.

3. **As a GitHub reader, I can follow empty → capture → library in the README**  
   Acceptance: seven images load from `docs/media/readme/`.  
   Evidence: files present; README relative links; seed dogfood only.  
   Status: **Passed** (asset completeness). Perception gap: desktop window, not phone — see Findings.

### Negative / edge

4. **Cooking.md / Arrival.md / Welcome.md are not hubs**  
   Evidence: adversarial PASS. Status: **Passed**.

5. **Tin under Personal notes still qualifies (single-word + mild boost ≥ min score)**  
   Evidence: adversarial PASS. Status: **Passed**.

6. **Root Alex without #person is not a hub; with #person is**  
   Evidence: unit tests. Status: **Passed**.

7. **#person on Book list promotes it** (escape hatch / footgun)  
   Evidence: adversarial PASS (behavior intentional). Status: **Passed as designed** — residual product risk.

8. **Repair idempotent; empty hubs no inject; task/noise no repair**  
   Evidence: unit + adversarial. Status: **Passed**.

### Regression

9. **Demo vault full seed: only Jordan + Riley hubs (not Arrival, not atoms)**  
   Evidence: live eval + node walk. Status: **Passed**.

10. **Full suite green**  
    Evidence: 175 tests; build production. Status: **Passed**.

### Perception / Apple

11. **User understands why a person was or was not linked**  
    Acceptance: some surface explains miss/hit.  
    Status: **Failed (product gap)** — no “no person hub matched” Notice/dry-run line in this ship (deferred in plan).

12. **Tutorial feels like the phone product**  
    Acceptance: mobile-first frames.  
    Status: **Failed (docs polish)** — 2048×1600 desktop Obsidian chrome.

---

## Risk Matrix

| Risk | Story | Evidence | Result |
|---|---|---|---|
| False hubs under Personal notes | 2 | unit + adversarial | Mitigated |
| Miss real Social people | 1, 5 | Tin/Social cases | Mitigated |
| Root false friends (Cooking) | 4 | adversarial | Mitigated |
| Media notes as people (Arrival) | 4 | adversarial | Mitigated |
| Repair over-links chores | 8 | unit (task/noise) | Mitigated |
| Silent under-link | 11 | code/read | **Open gap** |
| README wrong vault / personal data | 3 | seed content Jordan/Riley | Mitigated |
| Desktop tutorial ≠ phone | 12 | image dimensions | **Open gap** |
| #person tag abuse | 7 | adversarial | Accepted residual |

---

## Evidence

### Commands

```text
npm test          → 175 passed
npm run build     → ok (0.6.3)
./scripts/install-to-vault.sh docs/media/demo-vault
node scripts/seed-demo-vault.mjs
obsidian vault=demo-vault plugin:reload id=atoms
obsidian vault=demo-vault eval → {"personHubs":["Jordan","Riley"],"titlesN":14}
```

### Live hub set (demo vault)

| Expected hub | Present |
|---|---|
| Jordan (`People/`) | ✅ |
| Riley (`People/`) | ✅ |
| Arrival (root media) | ❌ correct |
| Atom titles | ❌ correct (denylist Atoms/) |

### Adversarial ledger

| Scenario | Result |
|---|---|
| Personal notes Book list hub | solid (excluded) |
| Cooking/Cooking hub | solid (excluded) |
| Tin under Personal notes | solid (included) |
| Arrival / Welcome hubs | solid (excluded) |
| #person on Book list | solid (included — footgun) |
| Social/Nichita | solid (included) |
| Collision People vs Personal notes same name | solid (People wins) |
| Repair inject / empty / idempotent | solid |
| Live reprocess full classify on personal vault | **blocked** (no key spend this pass; not required for discovery) |
| Phone Sync install 0.6.3 | **blocked** (device not driven) |
| Delete hub mid-queue then process | **blocked** (not driven live; code: discovery rebuilds each classify from vault files) |

### Screenshots (README assets, not new QA frames)

`docs/media/readme/01`–`07` — present; all **2048×1600** desktop.

---

## Findings

### P1 — Product (Apple gap): silent intelligence

When a person-shaped atom has no hub match, the product still files the atom without telling the user a person link was skipped. Ranking improved *correctness of the candidate set*; it did not improve *explainability*. Plan deferred “no person hub matched” copy.

**Recommendation:** dry-run + Process Notice one-liner before next community cut.

### P2 — Docs: tutorial is not mobile-first

Product is phone-first; README tutorial shows full desktop Obsidian (sidebar, traffic lights, wide canvas). Functional for GitHub desktop readers; fails Apple “show the product you ship” bar.

**Recommendation:** re-capture on phone or narrow leaf / design-handoff phone frames for v2 README.

### P3 — Residual: `#person` on a topic note creates a hub

By design for boost-not-gate. A mis-tagged “Book list” becomes a hub and can steal repair. Low probability; document in Settings later if needed.

### P0

None proven.

---

## Adversarial QA

Destructive weight on **wrong graph edges** and **silent miss**, not UI delete (discovery is read-only).

- **Mutate after create:** re-classify after adding `#person` / moving note into People/ — expected hub set changes next run (inferred from rebuild-each-call design; live reclassify not run).
- **Delete hub:** next classify drops hub; old atom links remain (dangling wikilinks — pre-existing, not introduced).
- **Double process:** repair idempotent ✅.
- **Boundary:** empty vault → `[]` ✅; cap TOP_N unit-tested ✅.

No P0 holes requiring code fix before merge. P1 explainability deferred with user (already in plan deferred list).

---

## Apple perspective (world-class product judgment)

| Criterion | Score | Note |
|---|---|---|
| Correctness of the magic | **Strong** | Real people in, topic pages out; live-proven on dogfood vault |
| Zero-config | **Better** | No longer requires Personal notes free pass; still rewards Social/People structure |
| Fail soft + explain | **Weak** | Still silent on misses |
| Restraint (no CRM, no rewrite) | **Excellent** | Non-negotiables held |
| Show the product truthfully | **Weak for tutorial** | Desktop chrome for a phone product |
| Taste | **Good engineering taste** | Min score + cap avoids Cooking false factory |

**Overall Apple read:** This is a **correct systems fix** that moves intelligence closer to “it just works” for well-structured vaults, and stops a real false-hub class. It is **not** yet “magical and self-explanatory.” Ship the ranking; schedule explainability + mobile tutorial frames if you want the Apple bar, not just the engineer bar.

---

## Not Tested

- Phone / Remote Vault install of 0.6.3 + real classify spend
- Dry-run preview UI callout of hub list
- Cache prefix stability under hub list change (expected miss — acceptable)
- Community plugin listing UX

---

## Merge Decision

**Ship PR #17** for hub ranking + README assets.

**Do not call the product “Apple-complete.”** Follow-ups:

1. Process/dry-run: “no person hub matched” when person-shaped + no hub  
2. Mobile or phone-frame tutorial screenshots  
3. Optional fixture catalog entry for `seed:demo` in `docs/qa/testing-fixtures.md` (maintenance)

**Evidence this is not code-review-as-QA:** live Obsidian `personHubs` probe + adversarial matrix + full unit suite + installed 0.6.3 on demo vault.
