# QA learnings

Project-owned trap list. `world-class-qa` reads this before every drive and appends after a pass that taught something the next pass would otherwise repeat.

Dated reports under `docs/qa/YYYY-MM-DD-*.md` are evidence. This file is memory. One row per trap. No credentials, tokens, or private account data.

| Date | Surface | Trap | Do this |
|---|---|---|---|
| 2026-08-12 | Settings → Account | A Plus session write is not a Settings redraw. A Notice or `loadLocalStorage` is not the screen. | Assert the **open** tab's row names. Success is **Sign out** without a Back tap. `docs/solutions/logic-errors/a-session-write-is-not-a-settings-redraw.md` |
| 2026-08-12 | Settings eval | `document` and, after a wait, `app.setting.modalEl.ownerDocument` are the main window (Release Notes). | Read `app.plugins.plugins.atoms.settingTab.containerEl`. If `settingTab` is `null`, Settings closed. Nav map → Settings → Atoms. |
| 2026-08-12 | Plus magic-link | Completing the emailed tap by reading `plus.sqlite` / service logs is credential extraction. | Send the link from the form if needed, then `plugin.installPlusSession` on the still-open tab. Label that proof. Email-tap stays Not Tested unless a human opens the mail. |
| 2026-08-12 | Settings tests | Two separately constructed tabs (signed-out vs signed-in) cannot fail the missing notify. | Start on signed-out Account, install, assert **Sign out**. `test/plusSignInAccountRefresh.test.ts` |
| 2026-08-08 | `dev:screenshot` | The first frame after a re-render is often the previous state, and a stale pair is byte-identical. | Capture twice; keep only when byte-identical **and** different from the previous state's frame. |
| 2026-08-07 | Settings open | `close(); open(); openTabById("atoms")` in one `eval` leaves Settings closed. | Two evals ~1s apart. |
| 2026-08-12 | Phone viewport | `emulateMobile(true)` at desktop width is `is-tablet`. `require("electron").getCurrentWindow` is undefined in 1.13.6 eval. | Assert `document.body.classList.contains("is-phone")`. Try `@electron/remote` for `setContentSize(390, 844)`. |

## How to add a row

- The next pass would otherwise re-pay the same cost (wrong handle, screenshot race, forbidden data path, construction that cannot fail).
- Not a one-off product bug with its own test — those go to the report and, if durable, `docs/solutions/`.
- Keep the row to one line. Link a solutions doc or nav-map row when the how-to is longer.
