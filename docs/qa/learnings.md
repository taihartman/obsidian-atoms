# QA learnings

Project-owned trap list. `world-class-qa` reads this before every drive and appends after a pass that taught something the next pass would otherwise repeat.

Dated reports under `docs/qa/YYYY-MM-DD-*.md` are evidence. This file is memory. One row per trap. No credentials, tokens, or private account data.

| Date | Surface | Trap | Do this |
|---|---|---|---|
| 2026-08-14 | Settings sheets | A sheet left open from an earlier step greys out the whole page, and a JS `.click()` still changes routes *underneath* its scrim, so a capture run keeps "succeeding" while every frame shows a modal over a dimmed screen. It poisoned 14 of 16 frames before a reviewer looking at the images caught it. (Not a product bug: `elementFromPoint` over a row behind the sheet returns `modal-bg`, so a real tap cannot reach it.) | Assert the extra-modal count is 0 before every frame, and 1 for the frames that are meant to show a sheet. Dismiss with the close button **and** Escape, then re-read the count. |
| 2026-08-14 | `dev:screenshot` | The byte-identical guard proves the renderer settled, not that you are on the screen you think, and it fails two ways: a route sweep whose back tap silently failed captured the engine screen four times under four filenames, and a settled *pair* came back as the previous screen because the navigation had not repainted. | Keep a frame only when the two shots agree **and** differ from the last frame written, **and** assert the route's expected first row before capturing. |
| 2026-08-14 | Settings at `is-tablet` | The pane keeps its nav sidebar, so a 768px window gives a 489px pane and a **410px** group — a row's content line is ~366px, not 768. Window-width `@media` queries are the wrong tool for it. | Measure the group, not the window. Layout floors belong on the row's two halves plus `flex-wrap`, so the row stacks where the floors do not fit. |
| 2026-08-14 | Settings CSS | Obsidian's mobile settings give every `.setting-item` its own opaque card (30px radius, 8px bottom margin). A group's fill, corners and between-row hairlines all render *behind* floating pills, so a computed-style assertion passes while nothing is visible. | Neutralise the per-item card inside a group. And never call a visual rule verified from `getComputedStyle` — look at a frame. |
| 2026-08-12 | Settings → Account | A Plus session write is not a Settings redraw. A Notice or `loadLocalStorage` is not the screen. | Assert the **open** tab's row names. Success is **Sign out** without a Back tap. `docs/solutions/logic-errors/a-session-write-is-not-a-settings-redraw.md` |
| 2026-08-12 | Settings eval | `document` and, after a wait, `app.setting.modalEl.ownerDocument` are the main window (Release Notes). | Read `app.plugins.plugins.atoms.settingTab.containerEl`. If `settingTab` is `null`, Settings closed. Nav map → Settings → Atoms. |
| 2026-08-12 | Plus magic-link | Completing the emailed tap by reading `plus.sqlite` / service logs is credential extraction. | Send the link from the form if needed, then `plugin.installPlusSession` on the still-open tab. Label that proof. Email-tap stays Not Tested unless a human opens the mail. |
| 2026-08-12 | Settings tests | Two separately constructed tabs (signed-out vs signed-in) cannot fail the missing notify. | Start on signed-out Account, install, assert **Sign out**. `test/plusSignInAccountRefresh.test.ts` |
| 2026-08-08 | `dev:screenshot` | The first frame after a re-render is often the previous state, and a stale pair is byte-identical. | Capture twice; keep only when byte-identical **and** different from the previous state's frame. |
| 2026-08-07 | Settings open | `close(); open(); openTabById("atoms")` in one `eval` leaves Settings closed. | Two evals ~1s apart. |
| 2026-08-12 | Phone viewport | `emulateMobile(true)` at desktop width is `is-tablet`. `require("electron").getCurrentWindow` is undefined in 1.13.6 eval. | Assert `document.body.classList.contains("is-phone")`. Try `@electron/remote` for `setContentSize(390, 844)`. |
| 2026-08-14 | Phone viewport | `emulateMobile(true)` issued in the *same* eval as `setContentSize(390, 844)` silently does not take — the body still reads `phone:false` at w=390. | Resize in one eval, then call `emulateMobile(false)` and `emulateMobile(true)` as their own calls with a wait between, and assert `is-phone` before reading anything. |
| 2026-08-14 | Settings open/closed | `settingTab.containerEl` stays a non-null handle after Settings closes, so it is not an open/closed signal — a pass can keep "reading the screen" from a dead tree. | Count `.modal-container .modal`. Zero means Settings is closed, whatever `settingTab` says. |
| 2026-08-14 | Filing engine, for QA | Putting a QA device into a configured (`byok`) state does not need a hand-written secret: hand-writing storage also skips the handler that makes the screen agree with it. | Click `Device-local key fallback` on the engine screen, type a throwaway placeholder into the password row it reveals, and dispatch `input` so the row's own `onChange` stores it. Undo by toggling the fallback off, which deletes the key. |
| 2026-08-13 | Daily Notes enable | `daily-notes.enable()` after `disable()` throws `Action "daily" is already registered` and still ends enabled. | Check `plugin.enabled` after the throw; do not treat the error as failed restore. |

## How to add a row

- The next pass would otherwise re-pay the same cost (wrong handle, screenshot race, forbidden data path, construction that cannot fail).
- Not a one-off product bug with its own test — those go to the report and, if durable, `docs/solutions/`.
- Keep the row to one line. Link a solutions doc or nav-map row when the how-to is longer.
