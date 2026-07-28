# World-Class QA: feat/hub-projection

**Date:** 2026-07-28  
**Branch:** `feat/hub-projection` · **PR:** #157 · **Issue:** #154  
**Plugin:** 0.6.42 installed to `test_vault/test vault/`

## Verdict

**Ready with residual** — live user-loop Process on throwaway vault proves managed block write + human bytes sacred + Unsorted placement; pure AE1–AE5 vault-smoke green; unit 424. Residual: Settings UI screenshot not captured (copy verified in source); phone/Sync not driven; model `hub_section` placement depends on classify quality (this Process run left new atom under Unsorted — correct fail-closed).

## Charter

Hub projection (opt-in) writes a plugin-owned `<!-- atoms:generated -->` block on person hubs after Process/Update/backfill/invite. Must never touch human prose outside delimiters; never invent H2s; default off with disclosure. Adjacent risk: Process write path, person hubs, Ask mirror of hub bodies.

**Product vs fixture:** Primary proof = **user-loop** (append capture bullet → `atoms:process-unprocessed` → observe hub). Secondary = pure vault-smoke + unit (delimiter AE1–AE5). Pre-existing hub H2 taxonomy is **user structure** (not planted graph for Also-about theater).

## Preflight

| Item | Status |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Authority | ✅ `docs/plans/2026-07-28-001-feat-hub-projection-plan.md` AE1–AE6; CONCEPTS Managed hub block |
| Navigation map | ✅ `docs/qa/app-navigation-map.md` — Process via CLI |
| Dev/run | ✅ `npm test` · `npm run build` · `./scripts/install-to-vault.sh` · Obsidian CLI 1.12.7 |
| Viewport/device | ✅ Agent desktop Obsidian + throwaway vault |
| Auth | ✅ Device-local classify path worked for Process (1 atom) |
| Fixtures | ✅ Catalog read; dogfood vault only; no personal vault |
| Device lock | N/A (desktop CLI) |
| Deploy | N/A (local plugin) |

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story |
|---|---|---|---|
| Settings **Hub projection** | Disclosure: writes managed section; human outside never changed; Ask side-effect; off by default | `DEFAULT_SETTINGS.enableHubProjection === false`; setDesc matches plan | US-settings |
| Process (setting on) | Regenerates block on touched person hubs | Hub gains/updates block; hard-linked atoms listed | US-process |
| Human hub prose | Sacred outside delimiters | Diff prefix/suffix unchanged | US-sacred |
| Placement | `hub-section` ∈ H2s or Unsorted | No invented H2s | US-route |
| Damaged markers | Abort write | unclosed → no modify | US-abort |

## Product loop vs fixture

| Story | Proof kind |
|---|---|
| Capture → Process → hub block | **user-loop** |
| AE1–AE5 delimiter matrix | fixture-plumbing (vault-smoke + unit) |
| Settings default off | code + data.json DEFAULT |

## User Stories Tested

1. **As a** vault owner with hub projection on, **I want** Process to list hard-linked atoms on the person hub, **so that** the hub stays current.  
   **Acceptance:** After Process, `People/Nichita.md` contains generated block with new atom.  
   **Authority:** Plan F1 / AE2–AE3.  
   **Evidence:** Live Process 2026-07-28; hub snapshot `docs/qa/screenshots/hub-projection/02-nichita-hub-after-process.md`; `lastWriteReport` atoms=1 failed=0.  
   **Status:** **Passed** (new atom under Unsorted — valid fail-closed without model section).

2. **As a** user who wrote intro + Personality on the hub, **I want** my prose untouched.  
   **Acceptance:** Bytes outside delimiters still contain Hand-written intro / Personality / human Gift Ideas notes.  
   **Authority:** AE1 / R2.  
   **Evidence:** Python assert after live Process; vault-smoke AE1.  
   **Status:** **Passed**.

3. **As a** user, **I want** unroutable atoms in Unsorted, not guessed into Gift Ideas.  
   **Acceptance:** New Process atom without valid `hub-section` under `## Unsorted`.  
   **Authority:** AE3 / R8.  
   **Evidence:** Live hub block.  
   **Status:** **Passed**.

4. **As a** user, **I want** re-run with no changes to be a no-op.  
   **Acceptance:** Idempotent hash.  
   **Authority:** AE4.  
   **Evidence:** `test/hubProjection.vault-smoke.test.ts` + unit.  
   **Status:** **Passed**.

5. **As a** user with a damaged open delimiter, **I want** no clobber.  
   **Acceptance:** plan errors `unclosed-generated-block`, zero writes.  
   **Authority:** AE5.  
   **Evidence:** vault-smoke + unit.  
   **Status:** **Passed**.

6. **As a** new install, **I want** projection off until I opt in.  
   **Acceptance:** default false + disclosure copy.  
   **Authority:** AE6 / R12.  
   **Evidence:** `src/shared/types.ts` DEFAULT; settings setDesc.  
   **Status:** **Passed** (Settings UI frame not shot — residual).

## Risk Matrix

| Risk | Kind | Story | Status |
|---|---|---|---|
| Human prose clobbered | Happy/neg | US-sacred | Passed |
| Invented H2s | Neg | US-route | Passed (Unsorted) |
| Unclosed delimiter write | Neg | US-abort | Passed |
| Setting default on | Neg | US-settings | Passed |
| Process path wires projection | Happy | US-process | Passed live |
| Craft / home chrome | Craft | N/A primary (logic+settings) | Home shot only residual craft |
| Phone Sync | Regression | — | Not tested |
| Ask mirror hub body egress | Perception | documented in settings | Not live-tested |

## Evidence

**Commands**

```text
npm test                    # 424 pass
npm run build
./scripts/install-to-vault.sh
obsidian vault="test vault" plugin:reload id=atoms
# append capture to Daily/2026-07-22.md
obsidian vault="test vault" command id=atoms:process-unprocessed
# lastWriteReport: atoms=1 failed=0
```

**Screenshots / artifacts**

- `docs/qa/screenshots/hub-projection/01-home-after-process.png` — home after Process  
- `docs/qa/screenshots/hub-projection/02-nichita-hub-after-process.md` — hub file after live Process  

**Live hub (excerpt)**

```markdown
Hand-written intro: always call before visiting.
## Gift Ideas
Notes I keep myself above the plugin block.
## Personality
Warm and curious — human synthesis forever.
<!-- atoms:generated v=1 -->
## Gift Ideas
- [[Nichita likes teal and soft light]]
## Unsorted
- [[Nichita wants a big PC case for his next build]]
<!-- /atoms:generated -->
```

## Findings

| Sev | Finding | Disposition |
|---|---|---|
| P3 | Settings toggle not screenshot this pass | Residual — copy verified in source |
| P3 | Live Process atom landed Unsorted (model omitted hub_section) | Expected fail-closed; not a bug |
| Info | Branch briefly polluted by unrelated tryatoms handoff commit — removed from tip before QA close | Cleaned |

## Adversarial QA

| Scenario | Result |
|---|---|
| Unclosed open delimiter | Abort, no write (unit + vault-smoke) |
| Orphan close | Abort (unit) |
| Double regenerate | Idempotent (unit + vault-smoke) |
| Multi-hub membership | unit `runHubProjection` multi-hub plan |
| Setting off | plan returns no writes (unit) |
| Double-tap Process / offline / editor conflict | **Not exhausted** this pass |

Destructive edit/delete of hub human region is out of product (user owns hub); projection never rewrites outside markers by design.

## Not Tested

- Phone / Remote Vault / BRAT install  
- Live Settings leaf visual craft  
- Ask mirror push of hub body after projection  
- Update notes / backfill / invite-accept live hooks (code-wired; Process live only)  
- Model consistently filling `hub_section` for Gift Ideas  

## Merge Decision

**Approve draft → mark ready after:** commit vault-smoke test + QA report + screenshots to PR; optional Settings screenshot. No P0/P1 product holes found on throwaway vault user-loop.

**Craft:** N/A primary surface is vault markdown + settings toggle; home screenshot is ambient only (adjacency not load-bearing for this feature).
