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

Everything else on this screen is prose and carries no control — six paragraphs signed out: the version line, the Capture intro, the Ask intro, `Sign in to Atoms Plus above to use the hosted connector. To run the server yourself, open Advanced and follow the DIY Ask guide.`, the auto-run intro, and the API-key intro. A section intro is exempt from the row grammar by design; a status *fact* is not, and is a status row.

**Destinations**

| Destination | Reached from | Contains |
|---|---|---|
| **Account** | The first row — `Set up automatic filing` signed out, `Plus · N filings left` signed in. Name varies by `accountRowDescriptor` state. | Signed out: `Skip the API key`, `Email` (Send sign-in link, Start free trial, Use promo code on one field), `Advanced: paste session` (Save session). Use promo code opens monthly Subscribe checkout. Signed in: `Manage subscription`, `Sign out`. |
| **Tag vocabulary** | `Tag vocabulary — N active` | Active group (one toggle row per tag), `Add a custom tag` (Add to Active — the field row carries the button, no separate button row), Proposed group (one `#tag` Approve row per proposal, then a single `N proposals waiting` / `Dismiss all` row) when proposals exist, then **Found in your vault** — one `Activate` row per vault tag not yet active. All-active vaults show `Every tag your vault uses is already active.`; a never-tagged vault shows `No tags found in vault yet.` |
| **Connect Claude or ChatGPT** | The `Connect Claude or ChatGPT` row (Plus session only; signed out the destination prints `Sign in to Atoms Plus first.` and nothing else) | Ask mirror status line (prose) → `MCP connector URL` (Copy) → `Link Claude / ChatGPT` (Get pairing code) → `Sync now` → `Cloud mirror status` (Refresh) → `Wipe cloud copy` (Wipe, confirms first). |
| **Advanced** | The last row, `Advanced` | `Model`, `Plus service URL override`, `DIY Ask guide` (opens the GitHub self-host runbook). |

- **Ask mirror status line:** `mirrorStatusLine` in `settings.ts`, printed as prose at the top of the Connect destination and echoed on the main screen's entry row. Refusal text from `formatAskMirrorRefusalLine` (`src/platform/askMirror.ts`): `Ask mirror: {N} · sync refused — vault scan incomplete · Sync now to retry` (class `atoms-ask-mirror-error`). Same string renders on Atoms home as `.atoms-home-ask-mirror-refusal`.
- **Sync now:** Connect destination → `plugin.syncAskMirror({ force: true })`; toasts one of four outcomes via `syncNowNotice` (`src/plugin/catchUp.ts`). The forced path is the only one that can open `AskMirrorDeleteConfirmModal`; a non-forced delta refusal never shows a modal.
- **Plus service URL override:** Advanced destination. Free text, no host validation — point it at a local `plus-service` (`http://127.0.0.1:8787`) to drive Ask mirror QA without a cloud account. Reachable in the UI now; `obsidian eval` is no longer required.
- **Self-host Ask:** that name stays off the main screen. The guide is `docs/ask-self-host.md`. Advanced carries **DIY Ask guide** (Open) next to the URL override.
- **Acknowledgments are not permanent rows.** The auto-run egress ack and the two Ask acks are consent sheets shown at enable time. A `… acknowledgment` row with a `Review` button exists only once that ack has been granted, and Review is where it is withdrawn.
- **Driving settings from `obsidian eval` (1.13.4 / 1.13.6):** on **desktop**, Settings opens in a **separate popout window**, so `document.querySelector(".modal")` in the main window finds nothing — often the Release Notes leaf. Go through `app.setting.modalEl.ownerDocument` **only in the same eval that just opened Settings**. After a network wait, that `ownerDocument` can be the main window again (verified 2026-08-12, #473). The durable handle is `app.plugins.plugins.atoms.settingTab.containerEl`. If `settingTab` is `null`, Settings closed — reopen; do not keep querying `document`. On **phone** there is no popout: the settings tab *is* a `.modal-container .modal` in the main document, so a confirm sheet opened from it is the **second** modal — select it with `[...doc.querySelectorAll(".modal-container .modal")].find((m) => m !== app.setting.modalEl)`, never `querySelector`. `dev:screenshot` captures the **main window only**, so desktop settings cannot be screenshotted this way; take settings frames at phone width. Its `path=` is **vault-relative** — write into the vault and copy out, and it does **not** create intermediate directories: an unmade folder fails with a bare `ENOENT` on the target file, so `mkdir` the vault-relative folder first (verified 2026-08-07).
- **Plus session on an open Account screen (#473):** a write to device-local session storage is not a redraw. After magic-link / `installPlusSession` / paste / trial, read the **open** tab's row names. Success is **Sign out** / **Signed in as** on that destination without a Back tap. A Notice or `loadLocalStorage("atoms-plus-session")` is not the screen. Learning: `docs/solutions/logic-errors/a-session-write-is-not-a-settings-redraw.md`.
- **Do not finish a magic-link by reading plus-service storage.** `plus.sqlite` / the service console hold the one-time token. That is a credential. Agent QA may send the link from the form, then call `plugin.installPlusSession` on the still-open tab (the confirm sheet's next step) and **label** that proof. The emailed `obsidian://atoms-signin` tap stays **Not Tested** unless a human opens the mail.
- **`dev:screenshot` can hand you the frame from *before* your last re-render (verified 2026-08-08).** A QA pass over #371/#374 captured ten settings frames and got a set shifted by one: every file showed the *previous* state, the frame meant to hold the wipe confirm dialog had no dialog in it, and the lead frame was a blank `New tab` workspace. Nothing errored, and each file was individually plausible, so this ships as convincing and entirely wrong evidence unless you check for it. **Capture twice and keep the frame only when the two are byte-identical *and* different from the previous state's frame** — stability alone is not enough, because a stale pair is perfectly stable. Then look at the images before committing them. **And assert the route's row list before each capture** (verified 2026-08-14): the guard catches a stale frame, not a wrong one. A scripted sweep of the phone routes whose back tap failed to register went on to capture the engine screen four times under four different filenames, each frame perfectly stable and perfectly wrong.
- **Re-rendering settings needs two evals, not one.** `app.setting.close(); app.setting.open(); app.setting.openTabById("atoms")` in a single `eval` leaves Settings **closed** — zero modals, `activeTab` undefined — because the close settles after the open. Close in one `eval`, then open + `openTabById` in a **separate** call about a second later. This is the normal shape for QA that mutates settings and needs the tab to re-render (verified 2026-08-07, 1.13.4).
- **The settings tab navigates behind an open sheet, but only for a script (verified 2026-08-14).** A JS `.click()` on a row changes the route while the sheet stays open, because it bypasses hit-testing. A user cannot do this: `document.elementFromPoint` over that row returns `modal-bg`, the scrim. So this is a capture-harness hazard, not a product bug — and a nasty one, since the run keeps succeeding while every frame shows a modal over a dimmed page. Assert `[...document.querySelectorAll(".modal-container .modal")].filter(m => m !== app.setting.modalEl).length` is 0 before each frame (1 for a frame that is meant to show a sheet), and dismiss with the close button **and** Escape, then re-read the count — the close button is absent on some sheets and a silent no-op poisons everything after it.
- **A back tap is not reliably one tap (verified 2026-08-14, 1.13.6).** Coming off the Account screen, the first `click()` on the back row is routinely swallowed, so a scripted `back; back` lands one screen short and everything after it drives the wrong surface. Do not count taps — loop until the screen you want is the one rendering: read `containerEl.querySelector(".setting-item .setting-item-name")` and click back again while it is not what you expect.
- **`is-tablet` is a narrower pane than its window (verified 2026-08-14, 1.13.6).** At a 768×1024 emulated tablet the settings modal keeps its nav sidebar: modal 691px, content pane 489px, and a `.atoms-setting-group` inside it **410px** — so a row's content line is about 366px. Anything gated on window width (`@media (min-width: 700px)`) fires while the row it is meant to protect is half that wide. Measure `getBoundingClientRect().width` on the group before reasoning about a row's layout.
- **Reaching `is-phone`:** `app.emulateMobile(true)` at a desktop-width window resolves to **`is-tablet`**, where the #346 row-stacking bug does not reproduce. Shrink the window and assert `document.body.classList.contains("is-phone")` before measuring. `require("electron").getCurrentWindow` is **undefined** in 1.13.6 `eval` (verified 2026-08-12); try `require("@electron/remote").getCurrentWindow().setContentSize(390, 844)` if a phone frame is required. Calling `emulateMobile` a second time toggles it back off and reloads the app; `eval` briefly answers "command not found" while it does. Measure geometry a beat *after* `app.setting.open()`; rects read in the same call are pre-layout.
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
