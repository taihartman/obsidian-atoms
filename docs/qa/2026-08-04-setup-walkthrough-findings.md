# U1 — from-scratch install walkthrough, observed

**Date:** 2026-08-04
**Vault:** `new vault/` (throwaway, gitignored) — genuinely empty, created via Obsidian's GUI
**Obsidian:** 1.12.7 · **BRAT:** 2.2.0 · **Atoms installed:** 0.6.69, then 0.6.71 on the recapture
**Screenshots:** `docs/qa/screenshots/setup-guide/` — 5 shots, all 780×1688 (390×844 @2x)

Every label below is quoted from the live UI (read out of the DOM), not from memory.

> **The screenshots were captured twice.** The first pass verified each screen by reading its DOM
> text and did not open the resulting PNGs. Every DOM read was right and three of the five images
> were still wrong: the Restricted Mode CTA was sliced off the bottom edge, the settings drawer
> overlaid the content pane mid-transition, and the Add-beta-plugin frame caught Obsidian's empty
> "New tab" view because the modal was still animating in. The second pass asserts the target's
> geometry and settle state before capturing, and checks the file afterwards. The vault was reset
> to Restricted Mode and zero plugins first, so shot 02 shows the "0 plugins installed" state a
> newcomer actually sees rather than a vault with Atoms already in it.

---

## The walkthrough, as it actually goes

| # | Step | What the user sees | Shot |
|---|---|---|---|
| 0 | Create the vault | GUI only — see finding A | — |
| 1 | Settings → Community plugins | A wall of security copy, then **Turn on community plugins** | `01` |
| 2 | Exit Restricted Mode | Pane changes to **Browse** + "You currently have 0 plugins installed." | `02` |
| 3 | Browse → install **BRAT** | Community plugin, id `obsidian42-brat` | — |
| 4 | BRAT settings | **Auto-enable plugins after installation**, **Auto-update plugins at startup** | `03` |
| 5 | **Add beta plugin** → `taihartman/obsidian-atoms` | The modal — see finding D for exact labels | `04` |
| 6 | Done | Settings → Atoms, **Version 0.6.69** | `05` |

Verified end state: `.obsidian/plugins/` contains `atoms` and `obsidian42-brat`; BRAT's
`pluginList` is `["taihartman/obsidian-atoms"]`; both plugins enabled.

---

## Findings that change the copy

**A · Creating a vault is strictly a GUI action.** Verified four ways, all failed to register a
vault: `obsidian://open?path=…`, `open -a Obsidian <empty folder>`, the same after seeding a
`.obsidian/` folder, and injecting the entry directly into `obsidian.json` (entry persists, but
the running app holds its vault list in memory). There is no command-line or URL path.

*Consequence for the guide:* step 0 cannot be automated, screenshotted from this machine, or
hand-waved. It has to be described in words, precisely, because it is the one step where the
user is entirely on their own.

**B · A new vault starts in Restricted Mode, and the site never says so.** `plugins:restrict`
reports `on` for a fresh vault, and `community-plugins.json` does not exist yet. The current
site copy (`index.html.tmpl:769-773`) says "Install BRAT from Obsidian's community plugins" —
but community plugins are *off*, and nothing on the page tells you to turn them on. **This is a
hard dead end for every new user.** The exact button is **Turn on community plugins**.

**C · BRAT auto-enables what it installs, so "Enable Atoms" is usually a phantom step.** BRAT's
`enableAfterInstall` defaults to `true` (its setting is labelled **Auto-enable plugins after
installation**), and the Add-plugin modal carries its own **Enable after installing the plugin**
checkbox. Atoms came out enabled with no extra action. The site's step 4 ("Enable **Atoms**")
and README step 3 both present this as required. Reword to: BRAT enables it for you — if it
didn't, toggle it under Community plugins.

**D · The Add beta plugin modal, verbatim.** This is the screen where people paste the wrong
thing, so the guide should mirror it exactly:

> **GitHub repository for beta plugin:**
> `Repository` — "Enter a GitHub repository address to validate it."
> `Select a version` → **Latest version**
> `GitHub token` — "Select a secret as token for this repository (optional)"
> ☑ **Enable after installing the plugin**
> Buttons: **Never mind** · **Add plugin**

The value to paste is `taihartman/obsidian-atoms` — owner/repo, not a URL. Leave version at
**Latest version**; the GitHub token is optional and irrelevant for a public repo.

**E · Updates already happen; nothing needs switching on.** BRAT ships with
`updateAtStartup: true` — **Auto-update plugins at startup** is on out of the box. The README
tells users to run **Check for updates** by hand after each release, which is the manual
fallback, not the default behaviour. Read from a fresh BRAT 2.2.0 install:

| BRAT setting | Ships as |
|---|---|
| `enableAfterInstall` (Auto-enable plugins after installation) | `true` |
| `updateAtStartup` (Auto-update plugins at startup) | `true` |
| `selectLatestPluginVersionByDefault` | **`false`** |

That last one matters for the copy: the Add-plugin dialog's version control opens on
**Select a version**, not on **Latest version**, so the reader has to choose it.

**E2 · BRAT's repository field models a full URL and accepts one.** Its placeholder is
`Repository (example: https://GitHub.com/githubusername/repository-name)`. Both that and the
short `owner/repository` form work — `addPlugin("taihartman/obsidian-atoms")` installed cleanly.
Any copy warning that a URL is "wrong" is inventing a problem.

**F · The one-tap iOS path is inside the plugin.** Settings → Atoms → Capture has an **Install
Capture Atom** button ("Install or update Capture Atom, the iOS shortcut (v2.0.0). Opens your
iCloud link — Shortcuts.app still needs confirm."), plus an **iCloud shortcut link** field. So
the guide's Capture section should route people to this button first, and keep the 9-action
manual recipe as the fallback — not lead with the recipe.

**G · Settings → Atoms opens with a one-line self-description**: "Version 0.6.69 · Capture with
your shortcut; Process turns past bullets into linked atoms." Good anchor for "you're done" —
the guide can tell users to confirm they see a version number here.

---

## Method notes (for whoever repeats this)

- Phone-sized capture = `dev:mobile on` **plus** a window resize. `dev:mobile` alone changes the
  layout but leaves the window at desktop size (first shot came out 2048×1600). Resize via
  `require("@electron/remote").getCurrentWindow().setContentSize(390,844)` —
  `window.resizeTo()` is blocked in the renderer.
- `dev:screenshot path=` resolves **relative to the vault root**, not the shell's cwd. Pass an
  absolute path.
- After any vault reload (`dev:mobile`, `plugins:restrict`), the CLI's `eval` and
  `dev:screenshot` are briefly unavailable — "Command not found. It may require a plugin to be
  enabled." Re-issue rather than concluding it is broken.
- Under mobile emulation the active settings pane is `.vertical-tab-content` **without**
  `.is-active`. Verify screen contents by reading DOM text through `eval` instead of opening the
  PNGs — same certainty, none of the context cost.

## Not covered here

iOS Shortcuts steps and the Ask/MCP connector flow cannot be exercised from this machine. Their
source material is already verified on disk: `docs/capture-shortcut.md` (device-verified
2026-07-28) and `src/settings/settings.ts:1150,1202,1264` for the Ask toggles, connector URL,
and pairing code.
