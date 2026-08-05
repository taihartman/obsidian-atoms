---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T02:28:12Z"
title: "Atoms settings rework: recommended-defaults section + plain-language titles"
summary: "Next session reworks the 49 plugin settings in src/settings/settings.ts into plain language and adds a recommended-but-off-by-default section; /setup shipped but needs an Open Atoms section and better screenshots."
keywords: ["settings", "obsidian-atoms", "plain-language", "onboarding", "setup-guide", "screenshots", "brat", "atoms-home", "ribbon"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-setup-guide"
resume_focus: "Rework Atoms plugin settings UI: add a section for off-by-default-but-recommended settings, and simplify all 49 setting titles and descriptions into language anyone can understand."
repository: "obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "docs/setup-guide"
head: "966b046c629edf5b6a251728c46ddd37cc80fa64"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-setup-guide"
---

# Handoff — Atoms settings rework

## What the next session is for

The user's words: the settings are *"all very confusing and hard to understand right now."* Two asks:

1. **Add a section for settings that are off by default but strongly recommended** — explicitly framed to the user as "these are off by default but we highly recommend you turn them on."
2. **Simplify every setting title and description** into language a non-technical person understands.

The user's message was cut off mid-sentence at *"Then"* — **there is a third item they did not finish saying. Ask before assuming the scope is complete.**

## Why this came up

It came out of building the `/setup` onboarding guide (#277 / PR #278). Walking the install from a genuinely empty vault made it obvious that the plugin's own settings are the next wall after installation. The guide can get someone *to* Settings → Atoms; the settings themselves then confront them with names like "Hub projection", "Data egress acknowledgment", "Device-local key fallback", and "Notes considered per capture".

## Terrain already surveyed (verified, not remembered)

- `src/settings/settings.ts` is **1505 lines with 49 `.setName(` calls**.
- There is effectively **one `setHeading()` call**, at line 107, used generically — so the file has almost no section structure to hang a "recommended" group off. That is a real design question for this work, not a formatting detail.
- Settings defaults live in **`src/shared/types.ts`** (referenced from `src/plugin/main.ts`) — `DEFAULT_SETTINGS`. **This was not yet read.** Step one is reading it to determine which settings are actually off by default, since the whole "off by default but recommended" section depends on that fact, not on assumption.
- Names worth looking at first, in file order: `Skip the API Key` (471), `Device-local key fallback` (759), `Data egress acknowledgment` (815), `Auto-run on open` (830), `Sync automatically on resume` (852), `Notes considered per capture` (921), `Also consider linked notes` (943), `Reconsider capture` (957), `Hub projection` (971), `Privacy acknowledgment` (1134), `Enable Ask mirror` (1150), `Allow filing from Claude or ChatGPT` (1176), `Plus service URL override` (1418).

## Process this repo enforces — do not skip

This is a **multiplayer repo with a hard claim gate**. Read `docs/collab.md` and `STATUS.md` first. Required before any implementation:

1. An assigned GitHub Issue
2. A row in `STATUS.md` under **In flight**
3. A **draft** PR

Then: plan in `docs/plans/`, a `ce-doc-review` pass on that plan, and the shipping tail (`ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa`).

**Lane: this is a full feature, not an amend.** It changes user-facing product copy across a whole surface, and the recommended-settings section is a new primary user story. Pick the lane explicitly in the first reply per `docs/workflow-lanes.md`.

Two constitution constraints that bear directly on this work (`CLAUDE.md`):

- **Versioning** — any user-visible change bumps `manifest.json` + `package.json` + `versions.json`. Renaming every setting is emphatically user-visible.
- **Settings must never store the API key** — key lives in SecretStorage. Do not let a copy rewrite drift into changing where anything is stored.

## Design tension worth resolving before writing copy

The site now documents some of these settings by their exact current labels. `test/wwwPricing.test.ts` has a **drift guard** asserting the published MCP connector URL matches `DEFAULT_PLUS_BASE_URL` in `src/platform/plusClient.ts`. Renaming settings does **not** currently break a test, but it *will* silently make `www/src/setup.html.tmpl` lie — that page quotes **Enable Ask mirror**, **MCP connector URL**, **Get pairing code**, **Allow filing from Claude or ChatGPT**, and **Install Capture Atom** verbatim.

**Whatever renames land must update `www/src/setup.html.tmpl` in the same change,** and it is worth adding a test that ties the guide's quoted labels to the strings in `settings.ts` the way the MCP URL guard does. Otherwise this rework silently breaks the guide that was just built.

## State of the work that just finished

`/setup` guide — Issue **#277**, PR **#278**, branch `docs/setup-guide`.

- At time of writing the PR was **mergeable, marked ready, waiting on the now-required `test` (plus-service) check**. The user chose to merge as-is. **Verify whether it actually merged** before assuming; if it did, `master` push to `www/**` auto-deploys production via `.github/workflows/tryatoms-pages.yml`.
- `STATUS.md` was already resolved to the post-merge state in the merge commit (in-flight row removed, "Recently merged" row added), so **no follow-up status-clear chore is needed** for #277.
- Full suite was green: **944 tests / 59 files**.

### Known-poor outcome to fix

**The five shipped screenshots are bad and the user said so directly.** They are mobile-emulated Obsidian panes — plain white cards that look cheap beside the site's design. The user chose to ship them and fix later.

The recommended fix, already discussed: **recapture on desktop Obsidian in a dark theme** so they match the site palette. That also removes an honesty wrinkle — phone-shaped shots depict a step most people perform on a desktop.

Assets to replace: `www/src/setup-*.webp` (5 files, registered in `SETUP_SHOTS` in `www/build.mjs`) and their PNG originals in `docs/qa/screenshots/setup-guide/`. A test asserts every `<img>` on the page resolves in `dist`, so replacements must keep filenames or update both places.

### Hard-won capture technique (do not relearn this)

Verifying a screenshot by reading the **DOM text** does not verify the **image**. First pass: every DOM read correct, three of five frames wrong — a CTA sliced off the bottom, a settings drawer overlaying the content pane mid-transition, and one frame that caught Obsidian's empty "New tab" view because the modal was still animating. Assert geometry and settle state before capturing, then open the file.

Working recipe, from `docs/qa/2026-08-04-setup-walkthrough-findings.md`:

- `obsidian vault="new vault" dev:mobile on` changes layout only; the window also needs
  `require("@electron/remote").getCurrentWindow().setContentSize(w,h)` — `window.resizeTo` is blocked.
- `dev:screenshot path=` resolves **relative to the vault root**; pass an absolute path.
- After any reload (`dev:mobile`, `plugins:restrict`), `eval` and `dev:screenshot` are briefly unavailable — re-issue.
- Under mobile emulation the active pane is `.vertical-tab-content` **without** `.is-active`.

## Authoritative references

Repository-relative, anchored to the branch and HEAD above:

| Path | What it holds |
|---|---|
| `docs/qa/2026-08-04-setup-walkthrough-findings.md` | Observed install walkthrough; every UI label quoted from the live DOM |
| `docs/solutions/documentation-gaps/setup-docs-written-from-a-configured-machine.md` | The durable lesson: docs authored from a configured machine cannot see first-run defaults |
| `docs/plans/2026-08-04-005-docs-setup-guide-plan.md` | Plan for the shipped guide |
| `www/src/setup.html.tmpl` | The guide; quotes settings labels verbatim |
| `test/wwwPricing.test.ts` | Site guarantees; page list now derives from `www/build.mjs` `PAGES` |
| `docs/workflow-lanes.md`, `docs/collab.md`, `STATUS.md` | Lane selection and the claim gate |

BRAT defaults established this session, useful because the same "assert a default rather than read it" mistake is the exact risk in a settings rework: `enableAfterInstall: true`, `updateAtStartup: true`, `selectLatestPluginVersionByDefault: false`.

## Second `/setup` follow-up: the guide never shows how to open the app

Raised by the user after the merge, with a screenshot: *"we need to show people how to bring up the
[Atoms] interface on the side like my screenshot. Just not with all these broken/old ones. This is
the main UI for the app."*

**This is the bigger hole of the two.** The shipped guide ends at "Settings → Atoms shows a version
number" and never tells anyone how to open Atoms home — the side panel that *is* the product. A
reader can finish the entire guide and never see the app.

Verified while triaging this, so the next session does not re-derive it:

| Fact | Source |
|---|---|
| A ribbon icon exists: `addRibbonIcon("library", "Open Atoms", …)` | `src/plugin/main.ts:227` |
| Exactly one view type is registered, `atoms-home` | `src/plugin/main.ts:226`, `src/home/atomsHomeView.ts:165` |
| Opening reuses a leaf via `ensureSideLeaf(ATOMS_HOME_VIEW_TYPE, "left", …)` — idempotent, does not spawn duplicates | `src/plugin/main.ts:376-388` |
| Reveal is deliberately suppressed on launch so it does not steal focus; only ribbon/command force-select | comment at `src/plugin/main.ts:374-386` |

So the instruction differs by platform, and the guide must say both: **desktop** gets the ribbon
icon in the left toolbar; **mobile** has no ribbon, so it is the sidebar tab list, exactly as in the
user's screenshot.

**About the "broken/old ones":** the duplicate `Atoms` rows, the `Navigator` row, and the literal
`atoms-home` row in that screenshot are **stale leaves in that vault's `workspace.json`**, not a
plugin defect — one is another plugin, and `atoms-home` is a leaf whose view type did not resolve to
a display name. Nothing to fix in code. It does mean any replacement screenshot must come from the
**throwaway vault**, never the personal Remote Vault the screenshot was taken in (which also shows
real personal atoms — `CLAUDE.md` non-negotiable #8).

Worth considering while writing this section: whether the ribbon icon and its tooltip are
discoverable enough, and whether mobile deserves a better entry point than digging through the tab
list. That is a product question adjacent to the settings rework, not part of it.

## Machine-local state (not in git)

- **Throwaway vault** `/Users/a515138832/StudioProjects/obsidian_plugin/new vault/` — gitignored on this branch, has Atoms **0.6.71** + BRAT 2.2.0 installed. Its Obsidian window is **still in mobile emulation at 390×844**; reset with `obsidian vault="new vault" dev:mobile off`.
- **Worktree** `/Users/a515138832/StudioProjects/obsidian_plugin-setup-guide` (branch `docs/setup-guide`). Has its own `node_modules`. Safe to remove once #278 is merged.
- The user's **personal Remote Vault** is open in the same Obsidian instance. `CLAUDE.md` non-negotiable #8: never mutate it. Use the throwaway vault.

## Plausible next steps

1. Confirm #278 merged and tryatoms.app deployed; verify `/setup` renders in production. (It merged
   as `7f63f74`; the Pages deploy was still running at handoff time.)
2. **Ask the user what followed "Then"** before scoping.
3. The two `/setup` follow-ups are one natural change and probably outrank the settings rework in
   user-visible value: add an **"Open Atoms"** section covering the desktop ribbon and the mobile
   sidebar tab, and recapture the screenshots on desktop dark from the throwaway vault. Confirm
   sequencing with the user — they asked for the settings work "in a new session", then raised the
   Open-Atoms gap after.
3. Read `DEFAULT_SETTINGS` in `src/shared/types.ts` and build a real table of every setting: current name, current description, default value, and whether it is recommended-on. That table is the plan's backbone.
4. Claim (Issue + STATUS row + draft PR), then plan in `docs/plans/`, then `ce-doc-review` with a voice lens before writing copy.
5. Keep `www/src/setup.html.tmpl` in lockstep with any renames, and consider a test binding the guide's quoted labels to `settings.ts`.

## Relevant installed skills

`compound-engineering:ce-brainstorm` (scope with the user, given the truncated message) → `ce-plan` → `ce-doc-review` → `ce-work` → `ce-simplify-code` → `ce-code-review` → `ce-compound`. For the copy itself, `voice-designer` is the right lens — this is user-facing prose, and the repo's own `writing-clearly-and-concisely` skill applies. `world-class-qa` then `adversarial-qa` before merge.
