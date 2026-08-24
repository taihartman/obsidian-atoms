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
- **Source:** `src/home/atomsHomeView.ts`, `src/home/atomsHomeData.ts`.
- **Fixture:** Seeded past unprocessed for wait card; atoms in `Atoms/` for library / For you.
- **Notes:** One hero: blocked wait (need-key / limit / enable-auto / auto-running) **or** one question (loop-close > hub invite > Together / resurface) **or** land peak. auto_on leftovers are a subtitle count; Process lives in More. Progress + **land peak** after Process/Update/auto-run (home open). Land peak freezes resurface, wait card, and Update strip until Done.

### Land peak (post-write Done)

- **When:** After Process / Update notes / auto-run with Atoms home open and a land payload.
- **UI:** Done status card · filed titles (max 3 + more) · Done dismiss or open title.
- **Source:** `src/home/landPeak.ts`, `fillLandPeakContent` in `atomsHomeView.ts`, `finishHomeRun` in `main.ts`.
- **QA:** No resurface under Done; wait card suppressed while landPeak set; connected later must be named (not “Related to something recent”).

### Wait card / automatic filing

- **When:** Past unprocessed &gt; 0 **and** filing is blocked or broken (`shouldShowWaitHero`). auto_on never occupies.
- **Modes:** need key → Try Plus / own key; plus limit / lapse → Subscribe / Get More; enable auto → privacy modal; auto running → Filing past thoughts. auto_on leftovers: subtitle count only; Process / Preview / Sync in More (`Process (n)`).
- **Source:** `shouldShowWaitHero` / `filingHeroCopy` in `src/home/atomsHomeData.ts`; More items in `showMoreMenu`.
- **QA:** Enable flow must not write to `data.json` auto-run flags. With leftovers + auto on, assert no `.atoms-home-wait-card` and no quiet Process row. Loop-close beats hub invite; after Keep it open, measured overlap (told pair) beats Show list.

### Update notes (Home news + Settings row)

- **When (Home):** Calm Home, refile debt (`atoms-quality` below CURRENT on linker atoms), not first-day, not under land peak, **not while the Process wait card is showing**. One news moment per quality until Not now or `updated > 0`.
- **UI (Home):** `.atoms-home-update-notes` — title `Update notes`, body = this quality's full reason (q9: `Readings of the same thing can link now. Your original text stays.`), **Update** / **Not now**. No count on the strip.
- **Confirm:** Shared `openUpdateNotesConfirm` — title `Update N notes?` (N = min(debt, 15)). Cancel / Escape / outside is free. Live Plus names filings; leftover BYOK on spent Plus must still read as Plus, not the API key.
- **When (Settings):** File group destination immediately after Filing. Answer `Readings can link` or `Up to date`. Tap recounts; zero debt is a silent no-op.
- **Heard key:** `atoms-update-notes-dismissed-q`. Written on Not now and on `report.updated > 0` only.
- **Command:** `atoms:update-notes` — name `Update notes`; no confirm (force path).
- **Source:** `src/home/updateNotesConfirm.ts`, `shouldShowUpdateNotesNews` in `atomsHomeData.ts`, `renderUpdateNotesStrip` in `atomsHomeView.ts`, `renderUpdateNotesRow` in `settings.ts`.
- **QA:** Planting `atoms-quality: 8` linker atoms is labeled UI-chrome (new Process output stamps CURRENT). Seeded dailies keep the wait card in the hero — **marker** those captures (eval-zero of `unprocessedCount` does not survive `refresh()`). Read heard via `app.loadLocalStorage("atoms-update-notes-dismissed-q")`, never `window.localStorage`. Paid classify is Not Tested unless a key/Plus session exists. Do not run live Update notes just to hide the strip; Not now or `persistUpdateNotesHeard` via eval is labeled chrome for the quiet-Home frame. Settings frames at `is-phone`; scroll the File group then screenshot immediately.
- **Do not:** Expect the strip beside a Process wait card. Expect Settings `dev:screenshot` on desktop (popout) — take Settings frames at `is-phone`.

### Settings → Atoms

- **Entrypoint:** Settings tab id `atoms`.
- **Source:** `src/settings/settings.ts` (not `src/settings.ts` — moved in the hybrid-src layout); row primitives in `src/settings/rows.ts`.
- **Shape:** one **main screen** plus **six destinations**. A destination is not a modal and not a new view — the tab re-renders `containerEl` under a route (`SettingsRoute` in `settings.ts`: `main | engine | account | vocabulary | connect | privacy | advanced`). You walk in by clicking a `destinationRow` (class `.atoms-setting-destination`, whole row is the target) and back out via the back row at the top (`.atoms-setting-back`). Closing and reopening Settings resets to `main`.

**The main screen is grouped, not a flat list (0.8.0, #493).** Every row lives in an `.atoms-setting-group` under an eyebrow header, and each group carries exactly **one footer** — that footer is where the explanation went, so rows are a name, an optional one-line subtitle and a control. Groups in order:

| Group | Header | Rows |
|---|---|---|
| Status | `Get started` (nobody files yet) / `Status` (somebody does) | Unconfigured: **one** destination row named after the next setup step, subtitle `Required` — `Turn on Daily Notes` (→ Obsidian's core-plugins tab) or `Filing` (→ **engine**, same noun as the File row since #538). Filing: `File automatically` + `Next run` status row |
| Leg 1 | `1 · Capture` | `Daily notes` (status, On/Off) · `Capture on your phone` (opens the procedure **sheet**) · `Custom shortcut link` lives on Advanced now |
| Leg 2 | `2 · File` | `Filing` (→ engine; renamed from `Who does the filing` in 0.8.1) · **`Update notes`** (0.8.16 — immediately after Filing; answer `Readings can link` while refile debt remains, `Up to date` when none; tap recounts then opens the spend confirm Home uses) · `File automatically when Obsidian opens` **only while setup is unfinished** · `Atom folder` · `Tag vocabulary · N active` (→ vocabulary) · `List atoms on hub notes` · `Refresh hub lists` (hub lists on) |
| Leg 3 | `3 · Resurface` | `Atoms home` · *(Plus)* the Ask entry rows |
| Leg 3 | `Ask` | Signed out: `Ask in Claude and ChatGPT` / `Off`, read-only, no chevron. Signed in: the mirror rows + `Connect Claude or ChatGPT` |
| Utility | `Your data` | `Privacy and consents` (conditional, → privacy) · `Advanced` (→ advanced) |

Thirteen non-heading rows on a signed-out device with Daily Notes on, hub lists on and consents on record. **The automatic-filing toggle has one home at a time** — the status group borrows it once setup is finished, and it is a bug if both groups render it.

**Two subtitles are state-dependent and easy to read as static:**

- The filing toggle's line comes from `filingStateDesc(on, hasRun)`: `Atoms files a past day only when you ask it to.` (off) / `First atoms arrive tomorrow morning.` (on, nothing filed yet) / `Atoms files each past day when Obsidian opens.` (on, a run on the books). In the File group the unconfigured wording is `Filing starts with tomorrow's note, on this device.`
- The `Your data` footer drops its Privacy clause when the Privacy row does not render (`UTILITY_GROUP.footerAdvancedOnly`), because a fresh install has allowed nothing and the full footer would describe a row that is not on screen.

**Consent record rows moved to the privacy destination (0.8.0).** They are no longer on the main screen; the main screen carries only `Privacy and consents`, whose subtitle counts them (`N on record`, or `Nothing on record` when the row is standing for a cloud copy or a session instead). Each record row still opens the sheet that took it, in withdraw shape (`Close` + `Withdraw acknowledgment`):

| Row | Renders when | Description |
|---|---|---|
| `What Atoms sends to Anthropic` | the device-local egress ack **or** the catch-up notice is on record | `Acknowledged on this device`, or `Acknowledged on this device for Sync everything now, against earlier wording` when only the notice grants (a legacy/stale ack) |
| `What Ask stores and shares` | `settings.askPrivacyAckAt` set — survives sign-out | `Acknowledged YYYY-MM-DD` |
| `Vault write acknowledgment` | `settings.askWriteAckAt` set — survives sign-out | `Acknowledged YYYY-MM-DD` |

The egress row is the one that is easy to get wrong: it is keyed to *either* grant, not to the stamped ack alone, so a device holding only the catch-up notice keeps a way to take that notice back. The parent `Privacy and consents` row is looser still — it renders while **any** of the three records, a Plus session, or a known cloud copy exists, so a wipe is never stranded (KTD6).

The only prose left on the main screen is the version line under the heading and the six group footers. A section intro is exempt from the row grammar by design; a status *fact* is not, and is a status row.

**Destinations**

| Destination | Reached from | Contains |
|---|---|---|
| **Engine** (0.8.0) | `Filing` in the File group (renamed from `Who does the filing` in 0.8.1 — `DESTINATION_TITLES.engine` / `FILING_NAME`) and the Get started step of the same name | `Atoms Plus` (the account entry — named `Atoms Plus` in **every** state since 0.8.1; the state label from `accountRowDescriptor` rides in the row's *description*, not its name, and signed out the description carries the offer instead), `Anthropic API key`, `Device-local key fallback`, then `What gets sent` as three egress facts. The naming rule for the secret id lives in the `Pick one` group **footer**, under both key rows, not in the key row itself. |
| **Account** | The account entry row on the **engine** screen (it left the main screen in 0.8.0) | Signed out: `Skip the API key`, `Email` (Send sign-in link, Start free trial, Use promo code on one field), `Advanced: paste session` (Save session). Use promo code opens monthly Subscribe checkout. Signed in: `Manage subscription`, `Sign out`. |
| **Privacy** (0.8.0) | `Privacy and consents` in the `Your data` group | `On record` group — one record row per live grant (the three in the table above) — then the cloud group, whose footer branches on whether this device still has a session that could wipe the copy. |
| **Tag vocabulary** | `Tag vocabulary — N active` | Active group (one toggle row per tag), `Add a custom tag` (Add to Active — the field row carries the button, no separate button row), Proposed group (one `#tag` Approve row per proposal, then a single `N proposals waiting` / `Dismiss all` row) when proposals exist, then **Found in your vault** — one `Activate` row per vault tag not yet active. All-active vaults show `Every tag your vault uses is already active.`; a never-tagged vault shows `No tags found in vault yet.` |
| **Connect Claude or ChatGPT** | The `Connect Claude or ChatGPT` row (Plus session only; signed out the destination prints `Sign in to Atoms Plus first.` and nothing else. Since #500, a **refused** `plusBaseUrl` prints `PLUS_BASE_URL_INVALID_MESSAGE` and nothing else either — no rows at all, and the bad origin appears nowhere, because this screen's whole job is handing a URL to Claude/ChatGPT) | Ask mirror status line (prose) → `MCP connector URL` (Copy) → `Link Claude / ChatGPT` (Get pairing code) → `Sync now` → `Cloud mirror status` (Refresh) → `Wipe cloud copy` (Wipe, confirms first). |
| **Advanced** | The last row, `Advanced` | `Model`, `Sync when you return to Obsidian`, `Sync everything now`, `Last filing run`, `Last catch-up`, `Plus service URL`, `Self-host guide`, `Custom shortcut link`, `Paste a session`. The diagnostics and the two escape hatches moved here in 0.8.0; `Paste a session` is single-sourced through `PASTE_SESSION_ROUTE`, so it renders here and on Account from one definition. |

- **Ask mirror status line:** `mirrorStatusLine` in `settings.ts`, printed as prose at the top of the Connect destination and echoed on the main screen's entry row. Refusal text from `formatAskMirrorRefusalLine` (`src/platform/askMirror.ts`): `Ask mirror: {N} · sync refused — vault scan incomplete · Sync now to retry` (class `atoms-ask-mirror-error`). Same string renders on Atoms home as `.atoms-home-ask-mirror-refusal`.
- **Sync now:** Connect destination → `plugin.syncAskMirror({ force: true })`; toasts one of four outcomes via `syncNowNotice` (`src/plugin/catchUp.ts`). The forced path is the only one that can open `AskMirrorDeleteConfirmModal`; a non-forced delta refusal never shows a modal.
- **Plus service URL:** Advanced destination, in the `Self-host` group (renamed from `Plus service URL override` in 0.8.0). Point it at a local `plus-service` (`http://127.0.0.1:8787`) to drive Ask mirror QA without a cloud account. **Validated since #500** (`isAllowedPlusBaseUrl`, `src/platform/plusClient.ts`): empty = hosted default, `https://` on any host, `http://` **only** on loopback (`localhost` / `127.x.x.x` / `[::1]`), everything else refused. A refused value still saves, and prints `PLUS_BASE_URL_INVALID_MESSAGE` in a `.atoms-setting-error` div under the row, inside the group (`:empty` hides it, so a cleared error leaves no gap). Refused bases fail every Plus call rather than falling back to production. **Commits on blur since #505**, not per keystroke — also on Enter, on leaving the screen, and on `hide()`. Typing alone changes nothing and renders no error, so a QA pass that types and then reads `plusBaseUrl` will see the *old* value until it ends the edit. Driving that needs CDP focus emulation (see `docs/qa/learnings.md`) — an unfocused Obsidian window fires no blur events at all.
- **Self-host Ask:** that name stays off the main screen. The guide is `docs/ask-self-host.md`. Advanced carries **Self-host guide** (Open) next to `Plus service URL` (renamed from `DIY Ask guide` in 0.8.0).
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

### Hub association invite (Home)

- **When:** Home calm (`runPhase === idle`, no wait card, no land peak). After Process/Update when a high-confidence atom↔hub pairing is not established.
- **UI:** One card. Existing list note: **Add to Show list?** · Create: **Make {label}?** · Person: **Add {Name}?** / **Link to {Name}?** Actions: add/create, **Choose different note…**, **Not now**.
- **Source:** `src/pipeline/hubInvite.ts`, `renderHubInviteCard` in `src/home/atomsHomeView.ts`.
- **QA:** Handwritten list note (no `##`) + generated watch/show atom without a hard link. Wait card (`unprocessedCount > 0`) hides this card even when `hubInvite` is collected.
- **Do not:** Plant pre-linked atoms to force the card.

### Together news (Home)

- **When:** Home calm (`runPhase === idle`, no wait card, no land peak, no hub invite). Listing on. An accepted hub has a hard-linked member not in the device-local told-set.
- **UI:** Together kicker, title = newest atom, supporting line = hub title. **Open** / **Not now**. No count, no peek list. Open opens the hub note in the vault.
- **Source:** `src/pipeline/togetherNews.ts`, `renderTogetherCard` in `src/home/atomsHomeView.ts`.
- **QA:** Process a new hard link onto Show list (or a person hub) after listing is on; do not seed hubs to force the card.
- **Do not:** Expect a directory of existing siblings. First catalog fill is the hub-list preview on first calm Home, not this card.

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

- Entrypoint: Atoms home “For you” when calm (no wait card). Hidden while Together news is waiting.
- Source: `src/resurface.ts`, `renderMindChangeCard` in `atomsHomeView.ts`.
- Fixture: Mind-change pair.
- Notes: Max one mind-change hero per calendar day (`atoms-mind-change-day-v1`).
