# App Navigation Map

Living map for driving Atoms during QA. Update when commands, home cards, or settings sections change.

## Launch

| Item | Value |
|---|---|
| App | Obsidian desktop or mobile |
| Plugin id | `atoms` |
| Throwaway vault (agent QA) | `test_vault/test vault/` (gitignored) |
| Demo vault (agent dogfood) | `docs/media/demo-vault/` (synthetic seed) |
| Phone / personal vault | Human only — plugin via **BRAT** / Release; note rewrites = human (see CLAUDE.md vault lanes) |
| CLI | Settings → General → Advanced → Command line interface **ON** |
| Install (agent QA) | `./scripts/install-to-vault.sh` then `obsidian plugin:reload id=atoms` (throwaway vault only) |

## Key Surfaces

### Atoms home

- **Entrypoint:** Ribbon library icon, or command `atoms:open-home`, or open leaf type `atoms-home`.
- **How to reach:** Command palette → “Open home” (plugin name shown beside it).
- **Source:** `src/atomsHomeView.ts`, `src/atomsHomeData.ts`.
- **Fixture:** Seeded past unprocessed for wait card; atoms in `Atoms/` for library / For you.
- **Notes:** One hero: Ready / automatic filing / resurface when calm. Progress + **land peak** after Process/Update/auto-run (home open). Land peak freezes resurface, wait card, and Update strip until Done.

### Land peak (post-write Done)

- **When:** After Process / Update notes / auto-run with Atoms home open and a land payload.
- **UI:** Done status card · filed titles (max 3 + more) · Done dismiss or open title.
- **Source:** `src/home/landPeak.ts`, `fillLandPeakContent` in `atomsHomeView.ts`, `finishHomeRun` in `main.ts`.
- **QA:** No resurface under Done; wait card suppressed while landPeak set; connected later must be named (not “Related to something recent”).

### Wait card / automatic filing

- **When:** Past unprocessed &gt; 0.
- **Modes:** need key → open settings; enable auto → privacy modal; auto on → Process secondary.
- **Source:** `filingHeroCopy` in `src/atomsHomeData.ts`.
- **QA:** Enable flow must not write to `data.json` auto-run flags.

### Settings → Atoms

- **Entrypoint:** Settings tab id `atoms`.
- **Source:** `src/settings/settings.ts` (not `src/settings.ts` — moved in the hybrid-src layout); row primitives in `src/settings/rows.ts`.
- **Shape:** one **main screen** plus **four destinations**. A destination is not a modal and not a new view — the tab re-renders `containerEl` under a route (`SettingsRoute` in `settings.ts`: `main | account | vocabulary | connect | advanced`). You walk in by clicking a `destinationRow` (class `.atoms-setting-destination`, whole row is the target) and back out via the back row at the top (`.atoms-setting-back`). Closing and reopening Settings resets to `main`.

**Main screen rows, in order** (`renderMainScreen`): account entry → `iCloud shortcut link` → `Capture Atom shortcut` → `Atom folder` → `List atoms in person notes` → `Tag vocabulary — N active` → *(Plus only)* `Ask mirror`, `Allow filing from Claude or ChatGPT`, `Connect Claude or ChatGPT` → `File automatically when Obsidian opens` → `Sync when you return to Obsidian` → `Sync everything now` → `Anthropic API key` → `Device-local key fallback` → `Advanced`. Fifteen rows signed in to Plus, twelve signed out. Two more appear only once this device has stamps: `Last auto-run day (this device)` and `Last catch-up` (status rows, no control).

**Consent record rows (conditional, `Review` button).** Each granted acknowledgment renders its own row named after the sheet that took it, and `Review` reopens that sheet in withdraw shape (`Close` + `Withdraw acknowledgment`). They appear only while the consent is on record, so a clean device shows none of them:

| Row | Renders when | Description |
|---|---|---|
| `What Atoms sends to Anthropic` | the device-local egress ack **or** the catch-up notice is on record — printed right below `File automatically when Obsidian opens` | `Acknowledged on this device`, or `Acknowledged on this device for Sync everything now, against earlier wording` when only the notice grants (a legacy/stale ack) |
| `What Ask stores and shares` | `settings.askPrivacyAckAt` set — in the Ask section, and it survives sign-out | `Acknowledged YYYY-MM-DD` |
| `Vault write acknowledgment` | `settings.askWriteAckAt` set — in the Ask section, survives sign-out | `Acknowledged YYYY-MM-DD` |

The egress row is the one that is easy to get wrong: it is keyed to *either* grant, not to the stamped ack alone, so a device holding only the catch-up notice keeps a way to take that notice back.

Everything else on this screen is prose and carries no control — six paragraphs signed out: the version line, the Capture intro, the Ask intro, `Sign in to Atoms Plus above first.`, the auto-run intro, and the API-key intro. A section intro is exempt from the row grammar by design; a status *fact* is not, and is a status row.

**Destinations**

| Destination | Reached from | Contains |
|---|---|---|
| **Account** | The first row — `Set up automatic filing` signed out, `Plus · N filings left` signed in. Name varies by `accountRowDescriptor` state. | Signed out: `Skip the API key`, `Email`, `Start free trial`, `Sign in on another device`, `Send sign-in link`, `Advanced: paste session`, `Save session`. Signed in: `Manage subscription`, `Sign out`. |
| **Tag vocabulary** | `Tag vocabulary — N active` | Active group (one toggle row per tag), `Add a custom tag`, Proposed group (`#tag` Approve + `Dismiss #tag`) when proposals exist, then **Found in your vault** — one `Activate` row per vault tag not yet active. All-active vaults show `Every tag your vault uses is already active.`; a never-tagged vault shows `No tags found in vault yet.` |
| **Connect Claude or ChatGPT** | The `Connect Claude or ChatGPT` row (Plus session only; signed out the destination prints `Sign in to Atoms Plus first.` and nothing else) | Ask mirror status line (prose) → `MCP connector URL` (Copy) → `Link Claude / ChatGPT` (Get pairing code) → `Sync now` → `Cloud mirror status` (Refresh) → `Wipe cloud copy` (Wipe, confirms first). |
| **Advanced** | The last row, `Advanced` | `Model`, `Plus service URL override`. |

- **Ask mirror status line:** `mirrorStatusLine` in `settings.ts`, printed as prose at the top of the Connect destination and echoed on the main screen's entry row. Refusal text from `formatAskMirrorRefusalLine` (`src/platform/askMirror.ts`): `Ask mirror: {N} · sync refused — vault scan incomplete · Sync now to retry` (class `atoms-ask-mirror-error`). Same string renders on Atoms home as `.atoms-home-ask-mirror-refusal`.
- **Sync now:** Connect destination → `plugin.syncAskMirror({ force: true })`; toasts one of four outcomes via `syncNowNotice` (`src/plugin/catchUp.ts`). The forced path is the only one that can open `AskMirrorDeleteConfirmModal`; a non-forced delta refusal never shows a modal.
- **Plus service URL override:** Advanced destination. Free text, no host validation — point it at a local `plus-service` (`http://127.0.0.1:8787`) to drive Ask mirror QA without a cloud account. Reachable in the UI now; `obsidian eval` is no longer required.
- **Self-host Ask:** no longer a row. The guide is `docs/ask-self-host.md`, asserted by a test so the row cannot come back without the doc.
- **Acknowledgments are not permanent rows.** The auto-run egress ack and the two Ask acks are consent sheets shown at enable time. A `… acknowledgment` row with a `Review` button exists only once that ack has been granted, and Review is where it is withdrawn.
- **RESOLVED (was KNOWN DEFECT, Obsidian 1.12.7):** the tab used to throw on `ButtonComponent.setDestructive` and stop rendering. `markDestructive` in `src/settings/rows.ts` now calls it only when it is a runtime function and falls back to `setWarning()`. Verified 2026-08-05 on app 1.13.4 / installer 1.12.7: a `destructiveRow` renders `mod-destructive` with no throw, and every destination renders to its last row. Historical context: `docs/qa/2026-08-01-fix-mirror-delete-gate-and-outbox-ack-world-class-qa.md` § F1.

### Process / Preview (manual)

- **Commands:** Process unprocessed; dry-run preview; home buttons; include-today via ⋯ menu.
- **Never auto:** `includeToday` only manual.
- **Source:** `src/write.ts`, `src/preview.ts`, `src/main.ts`.

### Auto-run

- **Triggers:** App open (after index ready); hourly interval; home enable → `maybeAutoRun("manual")`; command `atoms:auto-run-now`.
- **Status:** `atoms:auto-run-status`.
- **Source:** `src/autorun.ts`, `src/main.ts` `maybeAutoRun`.
- **QA:** Same-day retry after offline; stamp only when past drained.

### Resurface (cue card)

- **When:** Home calm (`runPhase === idle`, no past wait card), not first-day setup; not under land peak.
- **Source:** `src/resurface/resurface.ts`.
- **Connected:** Named kicker only (`Because of …` / `Also about …`); soft hubs alone dropped (`People`, `Camping`, `Travel`, … via `softKeys`).
- **Note:** Empty when no eligible cue — not necessarily a bug.

### Also about (entity orbits, 0.6.24+)

- **When:** Open a generated atom **in-home** (library row → in-home) that hard-links an existing vault hub with ≥3 generated members.
- **UI:** Strip `Also about {hub} · N` → title list of siblings; tap peer opens in-home. Soft Camping-only never shows.
- **Source:** `entityOrbitIndex` / `entityOrbitPolicy` / `openAtomInHome` in `atomsHomeView.ts`.
- **QA:** Seed ≥3 linker atoms with link-prose `[[Hub]]` + hub note outside or in vault; soft-only control atoms.

## Handy CLI anchors

```bash
obsidian plugins:enabled
obsidian plugin:reload id=atoms
obsidian commands filter=atoms
obsidian command id=atoms:auto-run-status
obsidian command id=atoms:auto-run-now
obsidian command id=atoms:list-unprocessed-captures
obsidian command id=atoms:dry-run-preview
obsidian command id=atoms:process-unprocessed
```

### For you / mind-change

- Entrypoint: Atoms home “For you” when calm (no wait card).
- Source: `src/resurface.ts`, `renderMindChangeCard` in `atomsHomeView.ts`.
- Fixture: Mind-change pair.
- Notes: Max one mind-change hero per calendar day (`atoms-mind-change-day-v1`).
