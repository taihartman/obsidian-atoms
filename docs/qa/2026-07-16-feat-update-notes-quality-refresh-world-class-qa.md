# World-Class QA: feat/update-notes-quality-refresh

## Verdict

**Ready after fixes** (fixes applied on branch; re-verified strip + fixture refresh).

## Charter

Ship **Update notes** (Issue #29 / plan 015): stamp new atoms with `atoms-quality`, user-initiated AI refresh of older linker atoms (Process parity), home strip + Modal, batch ≤15. Body sacred. No auto-run.

## Preflight

| Item | Status |
|---|---|
| Nav map | ✅ `docs/qa/app-navigation-map.md` |
| Run | ✅ `npm test` / `npm run build` / `./scripts/install-to-vault.sh` |
| Fixture | ✅ throwaway `test_vault/test vault/` + unstamped atoms |
| Device | ✅ Desktop Obsidian 1.12.7 + CLI |
| Phone | ❌ Not run this pass (post-merge `npm run phone`) |
| Live API spend | Fixture path used for refresh proof; key present but not required for strip |

## User Stories Tested

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| New Process atoms get quality stamp | `atoms-quality` + `quality-updated` in markdown | unit `render.test.ts` | Passed |
| Home shows Update notes when older atoms exist | Strip copy + Update / Not now | screenshot `05-update-notes-strip.png`; DOM text | Passed |
| Update refreshes body-sacred | capture text unchanged; reasons/title may change | fixture run → body `refresh me please body` kept | Passed |
| Rename + stamp | file renames; quality 2 | `Refreshed claim title v2.md` | Passed |
| No key blocks | Notice settings | code path `requireApiKey` (key present on this vault — not live-toggled) | Not tested live |
| Auto-run never updates | no call from autorun | code grep + architecture hard stop | Passed (code) |
| Batch ≤15 | limit constant | `UPDATE_NOTES_BATCH_LIMIT = 15` | Passed (code) |
| Dismiss Not now | strip hides until quality bump | LS `atoms-update-notes-dismissed-q` | Passed (code + clear) |

## Risk Matrix

| Risk | Result |
|---|---|
| Dynamic import of refresh module in production | **HOLED** → fixed static import |
| `fileManager.renameFile` hangs forever | **HOLED** → `vault.rename` only |
| Strip hidden after run (`runPhase === "done"`) | **HOLED** → show when not mid-run |
| Marker repair miss after Obsidian link update | Residual — best-effort; aliases keep old title |
| Wait card dominates phone UX | Strip still renders under wait when eligible |

## Adversarial ledger

| Scenario | Tag | Notes |
|---|---|---|
| Double Update / re-entry after done | solid after fix | phase done no longer blocks strip |
| Rename collision | solid | skip rename; keep path + aliases |
| Noise verdict → delete atom | solid | R13 keep-as-atom unit test |
| Dynamic import hang | **holed → fixed** | static import |
| renameFile hang | **holed → fixed** | vault.rename |
| Offline / no key | solid (code) | requireApiKey Notice |
| Hand-edit overwrite | accepted residual | confirm copy warns |
| Phone Sync lag | not tested | post-merge phone dogfood |

## Evidence

Commands:

```bash
npm test          # 219+ pass
npm run build
./scripts/install-to-vault.sh
obsidian command id=atoms:open-home
obsidian command id=atoms:update-notes
# fixture:
plugin.runUpdateNotes({ limit:1, fixtureResults:[...] })
```

Screenshots:

- `docs/qa/screenshots/update-notes/05-update-notes-strip.png` — strip visible
- `docs/qa/screenshots/update-notes/01-home.png` — earlier home (pre-fix)

CLI: version **0.6.7**; command `atoms:update-notes` registered; fixture report  
`{"scanned":1,"updated":1,"renamed":1,"markersRepaired":0,"failed":0}`.

## Findings (fixed on branch)

1. **P0** Production dynamic `import("../pipeline/refreshAtoms")` never completed → static import.
2. **P0** `fileManager.renameFile` hung → use `vault.rename`.
3. **P1** Update notes strip required `runPhase === "idle"` only → hidden after done; allow non-mid-run phases.

## Not Tested

- Phone install / Sync / Settings version on iOS
- Full 15-note live API batch cost
- Modal confirm visual frame (logic wired; not screenshot of modal)
- Marker repair when Obsidian “update links” already rewrote the line

## Merge Decision

**Ready after the three fixes above** (included in follow-up commit on this PR). Phone dogfood after merge via `npm run phone`.
