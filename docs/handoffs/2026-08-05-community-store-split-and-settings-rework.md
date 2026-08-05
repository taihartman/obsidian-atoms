---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T14:05:06Z"
title: "Split: urgent /setup de-BRAT (Claim A) + settings rework brainstorm in progress (Claim B)"
summary: "Atoms shipped to the community plugin directory, which makes the live /setup guide misdirect every new user through BRAT; the 49-setting rework is a separate claim whose brainstorm is five decisions in and missing only the settings inventory."
keywords: ["setup-guide", "brat", "community-plugin", "settings", "plain-language", "informed-unlock", "progressive-disclosure", "obsidian-atoms"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-setup-guide"
resume_focus: "Claim A first: rewrite www/src/setup.html.tmpl to install from the community plugin directory instead of BRAT, and add an Open Atoms section. Claim B (settings rework) resumes from five settled decisions and needs only the settings inventory to continue."
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "docs/handoff-settings-rework"
head: "d50743253f47f01859344985207b29094fc7e16b"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-setup-guide"
---

# Handoff — community-store split, and the settings rework mid-brainstorm

## What happened

A brainstorm scoped as one claim (settings rework + `/setup` follow-ups) **split into two** when the
user reported mid-session that Atoms is now live in the Obsidian community plugin directory. That
makes a docs correction urgent and unrelated to the settings work, so holding it behind a 49-setting
rework is backwards.

**Neither claim is claimed.** `STATUS.md` **In flight** is empty — no Issue, no STATUS row, no draft
PR. This repo's claim gate (`docs/collab.md`) is mandatory before implementation on either.

**This branch is behind.** `master` moved to `abe223f` (0.6.74) while this branch sat at `d507432`.
Rebase before claiming.

## Claim A — de-BRAT the /setup guide, and show people how to open Atoms

**Urgent because it is live and wrong.** `tryatoms.app/setup` currently walks every new user through
installing a beta-plugin manager they no longer need. Lane: light.

The user confirmed directly: Atoms is searchable under **Community plugins → Browse** today.

What has to change in `www/src/setup.html.tmpl`:

| Line | What is there now |
|---|---|
| 23 | Byline: "Written against Obsidian 1.12.7 and BRAT 2.2.0" |
| 113 | `<h3>Install BRAT</h3>` — whole section dies |
| 126 | `<h3>Point BRAT at Atoms</h3>` — whole section dies |
| 196 | Update instructions built on BRAT's update flow |

Twelve BRAT references total. The replacement is the ordinary community-plugin install, which is
shorter — Restricted Mode off, Browse, search Atoms, Install, Enable.

**Screenshots.** Two of five die, three survive:

| Frame | Fate |
|---|---|
| `setup-brat-settings.webp` | obsolete — delete |
| `setup-brat-add-beta-plugin-modal.webp` | obsolete — delete |
| `setup-restricted-mode.webp` | survives |
| `setup-community-plugins-on.webp` | survives, now more central |
| `setup-atoms-settings.webp` | survives (version check) |

A new frame is needed showing Atoms in **Community plugins → Browse**. All five are registered in
`SETUP_SHOTS` (`www/build.mjs:245-251`) and a test asserts every `<img>` resolves in `dist`, so a
deletion must update both places. Capture on desktop Obsidian in a dark theme from the throwaway
vault — never the personal Remote Vault (`CLAUDE.md` non-negotiable 8).

**Folded into Claim A: the guide never shows how to open Atoms.** A reader can finish the entire
page and never see the product. Verified facts, do not re-derive:

| Fact | Source |
|---|---|
| Ribbon icon exists: `addRibbonIcon("library", "Open Atoms", …)` | `src/plugin/main.ts:227` |
| One view type registered, `atoms-home` | `src/plugin/main.ts:226`, `src/home/atomsHomeView.ts:165` |
| Opening reuses a leaf via `ensureSideLeaf(ATOMS_HOME_VIEW_TYPE, "left", …)` — idempotent | `src/plugin/main.ts:376-388` |
| Reveal suppressed on launch so it does not steal focus; only ribbon/command force-select | comment at `src/plugin/main.ts:374-386` |

So the instruction differs by platform: **desktop** gets the ribbon icon; **mobile** has no ribbon,
so it is the sidebar tab list.

## Claim B — the 49-setting rework (brainstorm incomplete)

The user's words: the settings are *"all very confusing and hard to understand right now."* Asked
what specifically fails, they selected **all four** offered failure modes — too many, can't tell
which matter, jargon, and scared to change them. A copy pass alone fixes one of four.

### Settled — do not re-litigate

1. **All four failure modes are real.** The deliverable is a restructured screen, not a copy pass.
2. **Exactly one default flips: `enableReconsiderCapture`.** Its only stated reason was a July 2026
   "dogfood gate" that expired. **New installs only; existing users keep their settings.** That
   needs a small install marker: `src/plugin/main.ts:1386` does
   `Object.assign({}, DEFAULT_SETTINGS, raw)`, so a user who never changed a setting has no
   persisted key and would silently pick up the new default on upgrade.
3. **The group is an informed unlock, not a recommendation.** Framing is *"what you're not using,
   and what it costs"* — never *"we recommend you turn these on."* Eight of the nine off-by-default
   settings are consent gates for money, cloud egress, or vault writes; recommending them would
   misrepresent consent as endorsement and cut against the honesty bar the repo's own plans cite.
4. **Three buckets, one rule.** A setting earns screen space only if a real person would plausibly
   change it **and** the right value differs between people. Delete pure tuning knobs (pick a value
   in code); collapse genuine-but-rare settings into Advanced; **never bury anything gating money,
   egress, or vault writes.**
5. **Conservative on deletions, aggressive on collapsing.** Collapsing is reversible; a deletion
   silently overrides anyone who had set it. Expect a short delete list — roughly three to six.

### Research already committed — read this instead of re-deriving

`docs/handoffs/2026-08-05-settings-off-by-default-rationale.md` (commit `d507432`) — every
off-by-default setting with the reason **stated in the repo** (plan, comment, commit, or
constitution) and a hard-gate / caution / incidental classification. Headlines:

- Only `enableReconsiderCapture` is a genuine flip candidate.
- `enableHubProjection` **cannot** be flipped without a constitution PR — enshrined default-off at
  `docs/architecture.md:187`, framed as a narrow carve-out at `docs/spec-amendments.md:330`.
- Two premise corrections: **"Sync automatically on resume" and "Also consider linked notes"
  already default ON.** Do not plan around them being off.

### The one missing input

The **49-setting inventory** — line, section, `setName`, `setDesc`, key, and where its default comes
from. A subagent was dispatched to write it to
`/tmp/compound-engineering-502/ce-brainstorm/settings-plain-language/grounding-inventory.md`
(machine-local, ephemeral) and had not reported when the session ended. **Check that path; if it is
absent or looks stale, just re-run the inventory** — it is one dispatch, not a research project.

Two earlier scouts were dispatched as read-only agents and could not write their dossiers. If you
delegate this, use an agent type that has write tools.

Terrain already verified: `src/settings/settings.ts` is ~1505 lines with 49 `.setName(` calls and
**11 real sections** created by the `settingHeading()` helper (`:108`), called at lines 158, 270,
653, 729, 806, 892, 988, 1044, 1076, 1115, 1416 — `Atoms`, `Atoms Plus`, `Capture`,
`Your API key (optional)`, `Auto-run (this device)`, `Filing`, `Tag vocabulary`,
`Proposed (approve to activate)`, `Found in your vault`, `Ask (Claude + ChatGPT)`, `Advanced`.
(An earlier handoff claimed the file had almost no section structure — that was a grep artifact,
it matched the helper's definition. There is real IA to build on.)

`DEFAULT_SETTINGS` in `src/shared/types.ts` holds only ~16 keys against 49 settings, so most
defaults live elsewhere — inline `??` fallbacks, device-local `loadLocalStorage`, or plan-tier
gates. Locating them is part of the inventory.

### Remaining brainstorm phases

1. Assign every setting to delete / Advanced / visible, and **show the user the delete list
   explicitly** — they asked to veto it line by line.
2. Approaches, then scope synthesis, then the requirements-only plan under `docs/plans/`.

### Constraint that binds Claim B to Claim A's file

`www/src/setup.html.tmpl` quotes settings labels **verbatim** — `Enable Ask mirror`,
`MCP connector URL`, `Get pairing code`, `Allow filing from Claude or ChatGPT`,
`Install Capture Atom`. Renames in Claim B must update the guide in lockstep. Worth adding a test
binding those quoted labels to the strings in `settings.ts`, the way `test/wwwPricing.test.ts`
already guards the published MCP connector URL against `DEFAULT_PLUS_BASE_URL`.

## Work completed this session

- Recovered the prior handoff from `/tmp` (where `ce-handoff` had written it) and committed it as
  `docs/handoffs/2026-08-04-settings-plain-language-rework.md` (`c487e25`).
- Corrected that handoff's screenshot section **twice**: the quality complaint was already fixed
  before the handoff was written (the user's message was queued before `19c486f` landed), and two
  frames are now obsolete because of the community-store move.
- Committed the off-by-default research (`d507432`).
- Created `.compound-engineering/config.local.yaml` with `cross_model_peer: grok`, excluded via the
  shared git dir's `info/exclude` (machine-local; `ce-code-review` reads this file and would
  otherwise resolve to a codex install that is broken on this machine).

## Process notes

- Lane for Claim A is **light**; Claim B is **full**. State `Lane` / `Why` / `Doc-review` before
  planning either, per `docs/workflow-lanes.md`.
- The shipping tail is not optional: `ce-simplify-code` → `ce-code-review` → `ce-compound` →
  `world-class-qa` (ending in `adversarial-qa`). PR body needs `Closes #<issue>`.
- Any user-visible change bumps `manifest.json` + `package.json` + `versions.json`.
- For Claim B's copy, `voice-designer` and `writing-clearly-and-concisely` are the right lenses.

## Machine-local state (not in git)

- Throwaway vault `/Users/a515138832/StudioProjects/obsidian_plugin/new vault/` — has Atoms + BRAT
  installed. Its Obsidian window was left in **mobile emulation at 390×844**; reset with
  `obsidian vault="new vault" dev:mobile off`.
- This worktree `/Users/a515138832/StudioProjects/obsidian_plugin-setup-guide` has its own
  `node_modules`.
- The user's personal Remote Vault is open in the same Obsidian instance. Never mutate it.
