# World-Class QA: feat/smart-quality-refresh

## Verdict

**Ready** for merge on product behavior (polish + ranked refile + copy honesty), with residual risks named below. Phone Sync install not re-run this pass.

## Charter

Smart quality refresh (PR #87 / plan `2026-07-17-004`): Update notes runs **free local link polish** first, then **ranked Process-parity AI refile** (≤15). Calm large-N strip copy; polish-only without API key; body sacred; no auto-run. Adjacent risk: land peak copy, strip eligibility, Process wait card dominance.

## Preflight

| Item | Status |
|---|---|
| Bootstrap adapters | ✅ README, fixtures, nav map, scaffold, border_screenshot |
| Nav map | ✅ `docs/qa/app-navigation-map.md` (Update strip under home) |
| Run | ✅ `npm test` (287) · `npm run build` · `./scripts/install-to-vault.sh` → v0.6.21 |
| Fixture vault | ✅ `test_vault/test vault/` (agent dogfood) |
| Device | ✅ Desktop Obsidian + CLI |
| Viewport | ✅ Mobile-first home leaf (~phone width in screenshots) |
| Auth | ✅ Fixture path for refile (no Anthropic spend); polish-only `usedApi: false` |
| Phone Remote Vault | ❌ Not installed this pass (post-merge `npm run phone`) |
| Playwright / Chrome MCP | N/A — Obsidian plugin, not web app |
| Deploy | N/A — local plugin install; no Cloud Function |

**Mode:** Full automation (unit + live CLI on throwaway vault).

## User intent and perception

- **User goal:** Older notes catch up when filing gets smarter without paying for 800 refiles.
- **User questions:** “Do I have to update everything?” “Will my captures change?” “Does this cost API?”
- **Confidence signals:** Calm strip (no “800”); confirm names free vs key; land says “Cleaned up” vs “Updated”.
- **Distrust triggers:** Claiming AI after free polish; body rewrite; strip that never clears; empty re-run leaving stale “Updated N”.
- **Decision points:** Update vs Not now; confirm before spend.

## §4a Targets

### Interactive

| Surface | Expected | Evidence |
|---|---|---|
| Home **Update** strip button | Opens confirm modal | code + prior update-notes screenshots pattern; strip gated on work count |
| Confirm **Update** | Runs dual-phase refresh | live `runUpdateNotes` report |
| Confirm **Cancel** | No writes | not re-driven; code path Modal Cancel |
| **Not now** | Dismiss strip (LS quality) | code path + prior QA; not re-driven this pass |
| Land **Done** | Dismiss peak | code; not re-tapped this pass |
| Landed title row | Opens atom | code; not re-tapped this pass |

### Informational

| Surface | States | Evidence |
|---|---|---|
| Strip body small N | “Update N older notes…” | unit `updateNotesStripCopy` |
| Strip body large N (≥50) | “matter most” — no raw 800 | unit |
| Confirm polish-only | Free, no Anthropic | unit |
| Confirm refile / mixed | Uses Anthropic key | unit |
| Land polish-only | “Cleaned up N” | unit + `updatedCount: 0` path |
| Land mixed | “Updated A · polished B” + mixed body | live screenshot 01 + report `polished:3, updated:2` |
| Land empty | “Nothing to update” | live view state `summaryLine` after empty run |
| `links-polished` FM | Set on polish | live atom head |

## User stories under test

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| As a user with weak sticker reasons, I want free polish | Weak prose rewritten; capture unchanged; quality not forced to new CURRENT | Live: Alex atom → aesthetic reason; body kept; `atoms-quality: 5` + `links-polished` | Passed |
| As a user with quality debt, I want ranked AI refile not full vault | ≤15 refile; empty-link ranked | Live: empty-links + weak-low refiled (`updated:2`); empty became “Sleep debt plateaus…” | Passed |
| As a user without refile debt, I want Update without API key | `usedApi: false`; polish works | Live polish-only report + pajamas atom body | Passed |
| As a user seeing a huge library, I don’t want “Update 800” guilt | Large-N copy calm | unit strip copy | Passed |
| As a user, my capture text stays sacred | Body region unchanged | Live heads + unit planLocalPolish | Passed |
| As a user, pure polish must not claim full refile | Land/summary not “Updated … current quality” alone for polish-only | unit landPeak polish-only; live mixed headline correct for first run | Passed |
| As a user, double Update is safe | Second pass no-op when clean | Live empty runs + idempotent double polish | Passed |
| Auto-run never Update | No call from autorun | grep: only `commands` + `runUpdateNotes` | Passed (code) |
| Phone install | Settings version 0.6.21 | not run | Not tested |

## Risk matrix

| Class | Risk | Result |
|---|---|---|
| Happy | Polish + refile dual phase | Passed live |
| Happy | Polish-only path | Passed live |
| Negative | Empty vault work | Passed (`polished:0, updated:0, usedApi:false`) |
| Edge | Idempotent re-polish | Passed (second polish 0; body equal) |
| Edge | Rank empty-link first | Passed (refile order Sleep empty first) |
| Regression | Process wait / auto-run | Auto-run solid (code); Process not re-driven |
| Perception | Large-N / free / land honesty | Unit + live mixed land |
| Regression | Multi-leaf home land paint lag | Residual — state correct, screenshot can lag second leaf |

## Evidence

### Commands

```bash
npm test          # 287 passed
npm run build
./scripts/install-to-vault.sh   # Atoms v0.6.21 → test_vault
obsidian vault="test vault" plugin:reload id=atoms
obsidian vault="test vault" command id=atoms:open-home
# seed weak + low-quality atoms under Atoms/QA …
plugin.runUpdateNotes({ limit:5, fixtureResults:[...] })
# polish-only:
plugin.runUpdateNotes({ limit:0 })
```

### Live report (mixed)

```json
{
  "scanned": 23,
  "polished": 3,
  "updated": 2,
  "renamed": 2,
  "failed": 0,
  "usedApi": true,
  "polishedItems": ["QA refile weak low quality", "QA weak polish media watch", "QA weak polish Alex periwinkle"],
  "updatedItems": ["Sleep debt plateaus after nights", "Alex hospital interview status"]
}
```

### Live atom samples

- Polish: `preference about [[Alex]]` → `concrete aesthetic preference for gifts / clothes ([[Alex]])`; capture kept.
- Media: `media work to watch` → watchlist prose; capture kept.
- Refile empty: body `sleep debt seems to plateau…` kept; quality → 5; alias old title.

### Screenshots

- `docs/qa/screenshots/smart-quality-refresh/01-home-after-polish.png` — land **Updated 2 · polished 3** + mixed body + filed titles
- `docs/qa/screenshots/smart-quality-refresh/02-land-mixed-or-clean.png` — intermediate (multi-leaf)
- `docs/qa/screenshots/smart-quality-refresh/03-nothing-to-update.png` — may lag paint; **view state** after empty run: `landHeadline: "Nothing to update"`

### Unit

`parseLinkProse`, `smartRefresh`, strip/confirm copy, land polish-only headline.

## Adversarial ledger

| Scenario | Tag | Notes |
|---|---|---|
| Double Update when clean | solid | both runs 0 polished / 0 updated / no API |
| Polish twice same atom | solid | first 1 polish; second 0; body stable |
| Refile then re-entry | solid | quality 5; not re-selected for refile |
| limit 0 = polish only | solid | usedApi false |
| Hand-edit overwrite on refile | accepted residual | confirm still warns titles/links may change; lock deferred |
| Auto-run Update | solid | no call site |
| Offline / no key with refile debt | not live-toggled | code requires key when `q < CURRENT` |
| 500+ polish freeze | not load-tested | POLISH_BATCH_LIMIT 500 sequential modify |
| Multi-leaf stale land paint | residual | state updates; second leaf empty `{}` observed |
| Generic rewrite spam | residual product | “durable fact about” still possible; honesty says wording not AI |

## Findings

| Sev | Finding | Disposition |
|---|---|---|
| — | No P0/P1 product holes proven this pass | — |
| P3 residual | Multi-leaf home can leave one leaf without run state; screenshots may show prior land until that leaf refreshes | Defer — close extra home leaves in dogfood; not merge-blocking |
| P3 residual | Home `isPolishableContent` scans full polish plan on every refresh (cost at large libraries) | Defer efficiency; not correctness |
| Product residual | Hand-edit lock not in v1 | Documented; confirm copy |

## Not tested

- Phone Remote Vault install + human Update tap
- Live Anthropic refile (fixtures used for Phase B)
- Confirm modal visual screenshot this pass
- Settings “Refresh all with AI” (out of scope)

## Merge decision

**Merge-ready** for PR #87 on throwaway-vault proof + unit suite. Recommend post-merge: `npm run phone` + one human polish-only Update on a known weak atom.

## Core user stories (PR distill)

1. Free polish cleans sticker reasons without spending API or rewriting captures. ✅ live + unit  
2. Quality debt refiles in a ranked ≤15 slice, not the whole library. ✅ live report  
3. Large libraries get calm copy, not “Update 800.” ✅ unit  
4. Land/confirm distinguish polish vs AI. ✅ unit + live mixed land  
