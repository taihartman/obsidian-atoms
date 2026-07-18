---
title: "Amend: library row opens vault note (not in-home reader)"
date: 2026-07-18
status: approved-for-execution
lane: amend
doc_review: approved-2026-07-18
parent: docs/plans/2026-07-17-007-feat-entity-orbits-t0-t1-plan.md (KTD7)
amends:
  - docs/plans/2026-07-17-007-feat-entity-orbits-t0-t1-plan.md#KTD7
  - docs/plans/2026-07-17-006-spec-entity-orbits-product-contract.md#R13-R14-library-entry
---

# Amend — Library open = real note

## Lane

```
Lane:  amend
Why:   Tweak already-shipped entity-orbits T1 open path; one product surface, ≤1 logic file
Doc-review: light — approved 2026-07-18 (no criticals)
Done when: library tap opens markdown note like file explorer; no in-home reader on that path; smoke screenshots under docs/qa/screenshots/library-open-vault/
```

## Understanding

Entity orbits T1 (KTD7) changed **library row click** from vault open → `openAtomInHome` so “Also about” could appear on an intermediate reader (title + quote + Open in vault).

Dogfood: that intermediate is a weird manual read of the same note. Users expect **library tap = open the note** (file-explorer behavior). Home list chrome stays; only the open target flips back.

## Approach

1. **Library row** (`render` library list in `atomsHomeView.ts`): `onClick` → `openPathInVault(e.path)` instead of `openAtomInHome(e.path)`.
2. **Keep** `openAtomInHome` / `renderHomeOpen` for paths that still need in-home navigation:
   - Together card → entity-siblings list → row / back
   - Citator peer taps on an in-home atom (if reached)
   - Mind-change pair stays its own path (unchanged)
3. **Do not** delete Also about strip UI or orbit index — still used when in-home is reached via Together / siblings.
4. **No** smart-open branching this claim (in-home only when orbit exists). User asked for always-vault from library.
5. **openPathInVault** stays the existing helper (`getLeaf(false).openFile`) — same as land peak / resurface Open / Open in vault button. Out of scope: leaf-split polish unless smoke shows a new regression.

## Blast radius

| Surface | Change |
|---|---|
| Library All / Linked row | Opens vault note immediately |
| Land peak title tap | Unchanged (already vault) |
| For you Open (non–mind-change) | Unchanged (already vault) |
| Together → sibling list | Unchanged (in-home list) |
| Sibling row from that list | Still `openAtomInHome` (set navigation) |
| Also about on library path | **No longer reachable from library** — accepted trade |
| Also about via Together → open member | Still works if member opens in-home |

**Product trade (explicit):** T1 pull “open any library member → Also about” is demoted. Discovery of sibling sets leans on **Together** (and future work if we want pull-from-note again). Matches human preference over KTD7 assumption.

## Files

- `src/home/atomsHomeView.ts` — library `onClick` only (expected)
- Optional one-liner note in `docs/solutions/features/entity-orbits-hard-keys-and-also-about.md` if we compound
- No test file today asserts library → in-home; add only if a pure helper is extracted (unlikely)

## Out of scope

- Removing in-home reader entirely
- Re-homing Also about onto the markdown view / file explorer
- Changing Together card policy
- Desktop sidebar layout redesign
- Version bump unless shipping as user-visible patch with other work

## Authority override (KTD7 / R13–R14 library entry)

Parent KTD7 made library → `openAtomInHome` the T1 pull entry. **This amend reverses library only** after dogfood. Record on parent/spec when shipping:

- `007` KTD7: library open is vault again; Also about entry = Together → siblings (and other in-home paths), not library.
- `006` R13/R14: primary open target for **library** is vault note; in-home title list remains for Together / set navigation.

## Claim / ship

1. Issue + STATUS row + draft PR (`Closes #N`)
2. Implement library onClick flip + parent/spec one-liners
3. `npm run typecheck`
4. Scoped QA: library row → real note; Together → Open still title list  
   Screenshots: `docs/qa/screenshots/library-open-vault/` linked in PR
5. Compound optional: solutions note that KTD7 library→in-home was reverted after dogfood

## Acceptance

- [ ] Tap library atom → Obsidian markdown note (not Atoms Back/quote/Open in vault screen)
- [ ] Together Open (when card shows) → sibling title list still works
- [ ] Mind-change pair open unchanged
- [ ] No new TypeScript errors
- [ ] Smoke shots under `docs/qa/screenshots/library-open-vault/`
