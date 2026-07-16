# World-Class QA: feat/invisible-filing-autorun

## Verdict

**Ready after residual** — agent + unit + CLI install path green for **0.5.4**; **phone live dogfood** and full offline→online same-day retry on a real device are **Not Tested** (human / Remote Vault).

## Charter

Ship **invisible filing**: auto-run must not burn the calendar day on failed attempts; same-day continue while past work remains; home surfaces automatic filing + one-tap enable. Prove pure gates, install 0.5.4, CLI status snapshot, and break-it scenarios that would reintroduce stamp-on-attempt or privacy leaks.

## Preflight

| Item | Status |
|---|---|
| Run command | `npm test` · `npm run build` · `./scripts/install-to-vault.sh` |
| Fixture | Seeded test vault; device-local auto-run flags |
| Navigation map | `docs/qa/app-navigation-map.md` |
| Viewport/device | Desktop CLI ✅ · Phone Sync ❌ this pass |
| Auth path | No key on desktop test vault (`hasKey: false`) — expected |
| Automation | Vitest + Obsidian CLI ✅ · iOS device not driven |

## User Stories Tested

### Primary

1. **As a user with past unprocessed captures, I want automatic filing to retry the same day after a failed/offline open, so that one bad open doesn’t waste the day.**  
   Acceptance: stamp only when past remaining is 0; same day + remaining → run.  
   Evidence: `test/autorun.test.ts` (shouldRun / shouldStamp); code `src/autorun.ts`, `maybeAutoRun` no pre-stamp.  
   Status: **Passed** (unit + code).

2. **As a phone user, I want to turn on automatic filing from home without digging Settings, with a clear privacy confirm.**  
   Acceptance: primary CTA enable_auto → modal → device-local ack+enabled.  
   Evidence: `filingHeroCopy` tests; `confirmEnableAutomaticFiling` + `enableAutomaticFiling`; CLI snapshot path exists.  
   Status: **Passed** (unit + code). Live modal **Not Tested** on phone.

3. **As a user with auto on, I want home to say filing is automatic, not “review homework,” while Process remains available.**  
   Acceptance: mode `auto_on` copy mentions automatic filing; Process secondary.  
   Evidence: `filingHeroCopy` auto_on test.  
   Status: **Passed** (unit).

### Negative / edge

4. **No API key → home points to settings, not silent Process-only.**  
   Evidence: need_key mode test. **Passed** (unit).

5. **Empty past queue with auto enabled → day stamps so hourly does not spam.**  
   Evidence: `maybeAutoRun` empty success path; stamp when remaining 0. **Passed** (code + unit stamp rules).

6. **Auto-run never includes today.**  
   Evidence: `runWritePath` call has no `includeToday`. **Passed** (code).

7. **Auto-run flags never in data.json.**  
   Evidence: device-local keys only; status payload `inDataJsonSettings`. **Passed** (code). CLI status ran.

### Regression

8. **Install 0.5.4 on test vault; plugin reloads; snapshot API present.**  
   Evidence: install script → `version 0.5.4`, `getAutoRunSnapshot` returns enabled false / hasKey false. **Passed** (CLI).

9. **154 unit tests green; production build.**  
   Evidence: `npm test` / `npm run build`. **Passed**.

## Risk Matrix

| Risk | Result |
|---|---|
| Happy: gates + stamp policy | Covered by unit |
| Offline burn-day regression | Covered by unit (no stamp on throw path) |
| Cap drain same day | Covered by shouldRun same-day + remaining |
| Double concurrent auto-run | in_flight guard (code) |
| Privacy one-tap too silent | Modal copy required (code) |
| Phone Sync install lag | **Not tested** this pass |
| Home visual vs mock | **Not tested** (no screenshot) |

## Evidence

```text
npm test → 154 passed
npm run build → ok
Installed Atoms v0.5.4 → test_vault/.../atoms
obsidian plugin:reload id=atoms → ok
atoms:auto-run-status → executed
eval → {"version":"0.5.4","snap":{"enabled":false,"lastRunDay":null,"egressAcked":false,"inFlight":false,"hasKey":false},"hasMaybe":true}
```

## Findings

None blocking for merge of pure logic + install path.

**Polish residual:** Desktop test vault has no API key — full auto-run write path not live-exercised here.

## Adversarial QA

Scenario ledger (code + unit proof; live drive limited to CLI status):

| Scenario | Tag | Notes |
|---|---|---|
| Open offline → stamp burned → same day stuck | **solid** | Fixed: no stamp on throw; unit stamp false on threw |
| Cap mid-queue → second open same day continues | **solid** | shouldRun same day + remaining > 0 |
| Enable with no key | **solid** | enable writes flags; maybeAutoRun missing_key no stamp |
| Double-tap enable | **solid** | idempotent LS writes |
| Toggle auto off mid in-flight | **blocked: live** | inFlight ends in finally; not live-raced |
| Auto-run with includeToday smuggled | **solid** | call site no includeToday |
| Concurrent onload + interval | **solid** | autoRunInFlight |
| Stamp using scanned - markers only | **solid** | re-list past after run (simplify) |
| Phone enable + Sync lag old main.js | **blocked: phone** | needs Remote Vault install + Settings version check |
| Empty success every hour re-list cost | **solid** | stamp after empty so same_day skip |

Proven holes this pass: **none new**. Prior hole (stamp-on-attempt) fixed in 0.5.4 + `docs/solutions/logic-errors/autorun-stamp-on-attempt-blocks-same-day-retry.md`.

## Not Tested

- iOS Remote Vault: one-tap enable, privacy modal, Notice after auto file, offline→online same day.
- Full `runWritePath` under auto-run with live Anthropic key.
- Home UI screenshots vs design-handoff.
- Multi-device race (two devices auto-run same capture).

## Merge Decision

**Approve merge** of `feat/invisible-filing-autorun` for desktop/agent quality bar, with **explicit residual**: author dogfoods phone Remote Vault checklist before relying on invisible filing in daily life. Do not claim “phone magic proven” until that checklist is ✅.
