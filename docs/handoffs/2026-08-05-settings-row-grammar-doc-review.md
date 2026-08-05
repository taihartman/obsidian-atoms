---
handoff_date: 2026-08-05
branch: feat/settings-row-grammar
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/305
status: in-progress
---

# Handoff — settings row grammar (#304): plan is filed, `ce-doc-review` is the gate

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Restructure the Atoms settings screen from 48 undifferentiated rows into 15, on a four-kind row
grammar (setting / action / status / prose). The finding: of 48 rows only 18 are settings — 19 are
action buttons, 8 are status displays, 3 are prose, and all of them render as identical `Setting`
rows, so a button that fires a network wipe looks exactly like a toggle that stores a preference.

The plan is written and claimed. **No implementation exists yet.** Your job is to get it through the
plan-quality gate and then build it.

## Current status

- **The plan is committed and complete** — `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md`,
  10 units in four phases, all KTDs marked `session-settled`. Draft [PR #305](https://github.com/taihartman/obsidian-atoms/pull/305)
  carries it, based on `master`, `MERGEABLE`, two files.
- **Nothing in `src/` has changed on this branch.** Not one line. The diff is the plan doc plus a
  STATUS row.
- **The one blocker from the previous session is gone.** The plan was originally written without
  reading open PRs and collided with [#297](https://github.com/taihartman/obsidian-atoms/pull/297)
  over `enableReconsiderCapture`. That was investigated and resolved in KTD5's amendment, and #297
  has since merged as `622f095`. **U8 is unblocked.** Do not re-open this.
- **[#303](https://github.com/taihartman/obsidian-atoms/pull/303) merged** as `a7ebd65` — the four
  research docs under `docs/handoffs/` that this plan is grounded in, plus a STATUS clear.
- **`ce-doc-review` has never run.** It is the only unchecked box on #305 and it is a hard gate in
  `CLAUDE.md` § Workflow: do not run `ce-work` before it.

## Next steps

1. **Run `ce-doc-review` on `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md`.** This is
   your current task. The plan changed materially after it was first written (KTD5 amended, U8
   re-anchored), so it needs the review on the current text, not the original. Add design/product
   lenses — this plan moves UI and makes product claims. **Before you run it, confirm
   `.compound-engineering/config.local.yaml` exists with `cross_model_peer: grok`** (see Decisions
   below — without it the cross-model peer resolves to a broken codex install and silently returns
   nothing).
2. **Fix whatever the review raises**, then check the `ce-doc-review` box in #305's body.
3. **Run `ce-work`** on the plan. Phase order is in the plan's own sequencing table; U8 is
   independent and now unblocked.
4. Two small loose ends you can clear any time:
   - [PR #296](https://github.com/taihartman/obsidian-atoms/pull/296) is open, `DIRTY`, and fully
     redundant — its #294 STATUS clear landed via #303 and its one unique merged-log row (#292/#293)
     is already carried on this branch. It should be closed. The user was asked and had not answered
     when this session ended, so **ask before closing it**.
   - **#297 merged with a stale R12** in `docs/plans/2026-08-05-002-feat-library-skipped-filter-plan.md`.
     It still reads *"promote = Reconsider command when flagged"*, which is the pre-amendment split;
     the shipped code makes Try filing ungated. It reads as a live requirement contradicting master.
     Noted on the PR at [#297 comment](https://github.com/taihartman/obsidian-atoms/pull/297#issuecomment-5195629364);
     needs a follow-up commit on `master`.

## Key files

- `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md` — **the implementation authority.**
  Read KTD5's amendment block and U8's Dependencies before touching `enableReconsiderCapture`.
- `src/settings/settings.ts` — the target file, 1536 lines. `containerEl.empty()` at `:156`,
  `this.display()` at `:140`, `new Modal(this.app)` at `:1385`, `AskMirrorDeleteConfirmModal` at
  `:1473` are the already-proven patterns the plan's destinations and consent sheets build on.
- `src/plugin/main.ts:1984`, `:1987` — the `enableReconsiderCapture` docstring and guard U8 deletes.
  These are **post-#297** numbers, re-anchored this session; the plan's older `:1983`/`:1986` were
  off by one.
- `src/shared/types.ts:171`, `:215` — the field and its default.
- `src/pipeline/context.ts:183-187` — where `shortlistSize` / `expandLinkedNotes` are consumed, via
  a `Partial<Pick<LinkerSettings, …>>` param falling back to `clampShortlistSize()` and
  `DEFAULT_GRAPH_EXPANSION`. Both settings are deleted by the plan.
- `test/settings.test.ts:90` — pins `shortlistSize` to `DEFAULT_SHORTLIST_K`; dies with the setting.
  Five more cases vary these values at `:129`, `:141`, `:160`, `:172`, `:186`.
- `www/src/setup.html.tmpl:222`, `:330`, `:335`, `:357`, `:386` — quotes five settings labels
  verbatim. Three survive; `Enable Ask mirror` and `Get pairing code` change. U10 edits these in
  lockstep with the renames.
- `docs/handoffs/2026-08-05-settings-inventory.md` — the committed row-by-row inventory the plan is
  grounded in. **Line-number caveat:** it was written against a 1511-line `settings.ts`; the file is
  1536 now, so sections after Capture shifted about +25. Re-anchor before editing past Capture.

## Decisions & constraints

Do **not** relitigate these. Every KTD in the plan is marked `session-settled`; the load-bearing ones:

- **KTD1** — four row kinds, four right edges. Everything else is downstream of this.
- **KTD4** — consent becomes a sheet at enable time, merging each acknowledgment row into the toggle
  it gates. Ack fields themselves are unchanged.
- **KTD5** — delete `enableReconsiderCapture`. This was challenged by #297 and **survived**: #297's
  entire diff touched the flag in one place (a docstring) and its body states the Home path does not
  require it, so nothing depended on the setting existing. Keeping it would leave a toggle reading
  *"Experimental… Off by default"* gating the palette entry to a function the Library now runs
  ungated. Full reasoning is in the plan's KTD5 amendment.
- **KTD6** — deletion conservatism binds settings, not actions. This is what licenses removing three
  action rows while removing only two settings.
- **KTD7** — the two consent gates are **never** unified. Egress ack covers your own key →
  Anthropic; Ask ack covers bodies on Plus servers, decryptable at rest. Agreeing to one must never
  authorize the other.
- **KTD8** — deleted settings leave stale `data.json` keys behind on purpose. Stripping them would
  mean writing to every user's `data.json` for nothing.

Rejected and closed: a copy-only pass (fixes one of four failure modes); flipping
`enableReconsiderCapture`'s default for new installs only (needed an install marker — dissolved by
deleting the setting); unifying the two consent gates.

Hard constraints:

- **`ce-doc-review` before `ce-work`.** `CLAUDE.md` § Workflow plan-quality gate.
- **`enableHubProjection`'s default is out of scope** — enshrined at `docs/architecture.md:187`,
  changeable only by constitution PR.
- **Vault lanes.** Dogfood in `test_vault/` or `docs/media/demo-vault/` only. The personal **Remote
  Vault** at `~/Documents/Remote Vault` is open in the same Obsidian instance — never mutate it.
- **Shipping tail is not optional** — `ce-simplify-code` → `ce-code-review` → `ce-compound` →
  `world-class-qa`, and UI PRs need real vault screenshots in the body.

## Machine-local state (not in git — recreate if missing)

- `.compound-engineering/config.local.yaml` containing `cross_model_peer: grok`. Gitignored at
  `.gitignore:48`, so a fresh clone will not have it. **`ce-doc-review` and `ce-code-review` read
  exactly this file**; without it the peer resolves to a codex install that is broken on this
  machine and returns an empty result at full cost.
- Throwaway vault at `/Users/a515138832/StudioProjects/obsidian_plugin/new vault/` — still running
  the 0.6.76 community-store build and still in mobile emulation at 390×844. Reset with
  `obsidian vault="new vault" dev:mobile off`.
- `backup/pre-rebase-settings-row-grammar` — a local-only safety branch holding this branch's head
  before it was rebuilt on `master`. Everything in it is either merged or reproduced on the current
  branch; delete it whenever.

## Open questions / blockers

None blocking. The one real fork (whether to delete `enableReconsiderCapture` given #297) was
decided this session and is recorded in KTD5. The only outstanding user decision is whether to close
the redundant PR #296 — ask, don't assume.

## Git state

- Branch `feat/settings-row-grammar` (base `master`), pushed to `origin`.
- Last content commit: `59d4324 docs(plan): amend KTD5 after reading #297; renumber to -003-`
- Before that: `febac85 docs(plan): settings row grammar — 48 rows to 15 (#304)`
- The branch head is the commit that added this handoff doc; it changes nothing else.
- Diff since base: 3 files, +562/-1 plus this doc (`STATUS.md`, the plan doc, this file).
- Branch was rebased twice this session — once onto merged #303, once onto merged #297 — and
  force-pushed. Working tree was clean at handoff.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch feat/settings-row-grammar && git pull --ff-only
npm install
npm test
```

Then continue from **Next steps** above.
