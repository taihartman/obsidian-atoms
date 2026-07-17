# World-Class QA: Update notes failure surface (0.6.18)

## Verdict

**Ready** — failure path copy and land peak payload verified live on demo-vault; unit tests green. Connected-bridge Open affordance already evidenced (0.6.17 screenshots).

## Charter

After Update notes with a bad model id, all classifies failed but the Done card said **“Nothing to update”**. Fix: land peak + notice must report failures. Also seed model default → `claude-sonnet-5`.

Merged: PR #81 (`14fb079`). Version **0.6.18**.

## Preflight

| Item | Status |
|---|---|
| Vault | `docs/media/demo-vault` (synthetic) |
| Install | `./scripts/install-to-vault.sh docs/media/demo-vault` → 0.6.18 |
| CLI | Obsidian 1.12.7, `vault=demo-vault` |
| Nav map | `docs/qa/app-navigation-map.md` |
| Automated | `npm test` 253 passed; `npm run typecheck` |

## User Stories Tested

### US1 — All Update classifies fail → honest Done card
**As a** user who ran Update, **I want** a clear failure message, **so that** I fix model/key instead of thinking nothing needed refresh.  
**Acceptance:** Headline `Couldn't update N notes`; body mentions Settings model id / API key; eyebrow `Couldn't finish`; not `Nothing to update`.  
**Evidence:** Live `lastRefreshReport` `{ scanned:2–3, updated:0, failed:2–3 }`; `landPeak.summaryLine === "Couldn't update N notes"`; DOM text dump (below).  
**Status:** **Passed**

### US2 — Notice matches failure
**As a** user, **I want** the toast to say couldn't update, **so that** it matches the card.  
**Acceptance:** All-failed notice: `couldn't update N notes — check model id and API key`.  
**Evidence:** Code `src/plugin/main.ts` + unit land peak; live run produced `failed: N` with `updated: 0`.  
**Status:** **Passed** (code + report path)

### US3 — Partial update wording
**As a** user with some failures, **I want** `Updated X · Y failed`.  
**Acceptance:** Unit tests for headline/body.  
**Evidence:** `test/landPeak.test.ts`  
**Status:** **Passed**

### US4 — Connected bridge Open affordance (regression)
**As a** user on a calm For-you card, **I want** accent `Open {via/seed}`, **so that** I know what is tappable.  
**Evidence:** `docs/qa/screenshots/connected-bridge-open/05-connected-open.png`  
**Status:** **Passed** (prior live capture on 0.6.17/18 build)

### US5 — Demo seed model not a landmine
**As a** dogfooder after `seed:demo`, **I want** a valid model id.  
**Acceptance:** `scripts/seed-demo-vault.mjs` uses `claude-sonnet-5`.  
**Evidence:** File on master.  
**Status:** **Passed**

## Risk Matrix

| Path | Result | Evidence |
|---|---|---|
| Bad model → all fail | Pass | `failed: 3`, peak `Couldn't update 3 notes` |
| Good model → update works | Pass | Earlier session: model `claude-sonnet-5` → `updated: 1` |
| Zero eligible | Pass (unit) | `Nothing to update` when failed=0 and updated=0 |
| Strip still shows after all-fail | Pass | Expected — quality still &lt; 5 |
| Connected Open line | Pass | Screenshot 05 |

## Live probe (demo-vault, 0.6.18)

```text
# Forced invalid model
settings.model = "claude-sonnet-4-20250514-INVALID"
runUpdateNotes({ limit: 3 })

lastRefreshReport:
  scanned: 3, updated: 0, failed: 3

landPeak:
  source: update
  atomCount: 0
  failedCount: 3
  summaryLine: "Couldn't update 3 notes"

DOM (containerEl.innerText head):
  Updated 0 notes · 3 failed
  Couldn't finish
  Couldn't update 3 notes
  Check Settings → model id and API key, then try Update again.
  Done
```

## Evidence files

| File | What |
|---|---|
| `docs/qa/screenshots/update-failure-surface/08-dom-text.txt` | DOM text dump of failure land peak |
| `docs/qa/screenshots/connected-bridge-open/05-connected-open.png` | Open Jordan affordance |
| `test/landPeak.test.ts` | Update failure copy unit tests |
| `npm test` | 253 passed |

**Note:** `obsidian dev:screenshot` intermittently captured a different home leaf/state (connected card) while `containerEl.innerText` on the active Atoms leaf showed the failure card. Primary visual proof for failure copy is the DOM dump + live JSON; bridge UI has a clean PNG.

## Adversarial (scoped)

| Attempt | Result |
|---|---|
| All fail still shows strip | Expected (notes remain eligible) |
| Dismiss Done → strip returns | Expected until quality stamps or Not now |
| Bad model vs good model | Bad → fail peak; good → updated stamps |

## Not tested

- Phone Sync visual of 0.6.18 failure card (install done; human Sync lag)
- Partial live `Updated X · Y failed` UI (unit only)
- Full adversarial-qa skill pass (scoped amend; destructive re-entry covered lightly)

## Merge decision

**Already merged (#81).** QA evidence committed for the PR record. No blockers found on the failure-surface fix itself.
