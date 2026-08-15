---
handoff_date: 2026-08-14
branch: claude/settings-ux-redesign-69acd6
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-ux-redesign
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/493
status: in-progress
---

# Handoff — Settings three-leg overhaul, ready to implement

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then **start executing Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Restructure the Atoms settings tab so a new user can tell what the plugin does, whether it is working, and what to do next. The planning is finished and reviewed. **No source code has been written yet** — your job is to implement it.

## Current status

- **Design handoff committed** at `811d5ea` — `docs/design-handoff/settings/` holds the mocks and the investigation. This is your design spec. It is committed precisely so you can cite it; do not treat it as scratch.
- **Plan written and reviewed** at `c4c4b66` — `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md`, `artifact_readiness: implementation-ready`, 10 units (U1-U9 plus U11; the U10 gap is deliberate).
- **`ce-doc-review` ran with 7 personas.** ~50 findings, 3 at P0, all applied to the plan before it landed. Do not re-review the plan; it has been through this.
- **Hard claim complete.** Issue [#493](https://github.com/taihartman/obsidian-atoms/issues/493) filed and assigned. Draft [PR #494](https://github.com/taihartman/obsidian-atoms/pull/494) open. `STATUS.md` row added.
- **Everything is pushed.** The branch is on `origin`. Working tree is clean.
- **No implementation exists.** `src/` is untouched on this branch.

## Next steps

1. **Run `ce-work` on the plan**: `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md`. Start at U1 (the `group()` primitive) — it gates U2-U9.
2. **Land U1 and prove it on device before anything depends on it.** `group()` is the first wrapper element the settings tab has ever had; its phone and tablet behaviour is unproven. Screenshot at 390x844 **and** 768x1024.
3. **Then U2-U9 in order.** They are NOT independently landable — see constraints below.
4. **U11 last**: copy lockstep, the coverage-audit reconciliation, re-measurement, version bump.
5. **Then the shipping tail** per `CLAUDE.md`: `ce-simplify-code`, `ce-code-review`, `ce-compound`, `world-class-qa` including the adversarial half. Mark PR #494 ready only after that.

## Key files

- `docs/plans/2026-08-14-001-feat-settings-three-leg-overhaul-plan.md` — your implementation authority. Scan headings; read the Goal Capsule, then each unit plus its cited R/KD/KTD.
- `docs/design-handoff/settings/overhaul.html` — main screen, Advanced, privacy, capture sheet, desktop.
- `docs/design-handoff/settings/account.html` — Atoms Plus across nine renders. **Target for the buy-now plan, not for U8** (see KTD14).
- `docs/design-handoff/settings/README.md` — the 34-row coverage audit. R5 depends on it.
- `docs/design-handoff/tokens/README.md` — v2 token system. Flat surfaces, one tint, no accent-tinted fills.
- `src/settings/rows.ts` — the row grammar. `group()` goes here, not in `settings.ts`.
- `src/settings/settings.ts:768` — route exhaustiveness switch. Two new routes join it.
- `test/settingsRows.test.ts:1091` — `DIRECT_SETTING_BUDGET`. Read this before writing any chrome.
- `test/settings.test.ts:1943` — `expectedRows()`, the fixture that serialises U2-U9.
- `test/helpers/settingsTab.ts:198` — `rowNames()`; `:211` — `prose()`.

## Decisions & constraints

**Do not relitigate these. They are settled and recorded as KD1-5 and KTD1-15 in the plan.**

- **Group by the product's own three legs** (Capture, File + link, Resurface) from the north star. User-directed.
- **Mobile-first is the canvas.** User-directed.
- **The v2 tokens govern.** No gradients, no accent-tinted card fills on non-transient surfaces, no decorative icon chips. User-directed.
- **Ask needs a service session, not a paid subscription.** Self-host is a supported route and lives under Advanced. User-directed.
- **U8 restyles the account screen only.** Row list per state stays byte-identical; no re-shaping actions. User-directed (KTD14) — the buy-now plan rewrites those rows.
- **The #364 C1 header scrim is NOT in this plan.** It ships as its own one-file PR which closes #364. User-directed (KTD15).

**Hard constraints that will bite you if you forget them:**

- `DIRECT_SETTING_BUDGET` is **5 of 5 — zero headroom**. It counts `new Setting(` occurrences in `src/settings/settings.ts`. Build grouping chrome in `rows.ts` or the guard fails immediately. Retiring `settingHeading()` call sites does **not** lower the count (one construction, ten callers, and the vocabulary destination keeps calling it).
- **U2-U9 land sequentially.** They all mutate `expectedRows()` and its three `toHaveLength` assertions. Each unit updates the fixture for the rows it moves.
- **Versioned disclosure strings AND ack-standing strings are frozen.** `ACK_STANDING_SUFFIX` (`settings.ts:424`) and the three egress-record standing strings (`:2072-2081`) live in the file you are rewriting and are guarded by nothing. A reword retires every device's ack fleet-wide.
- **The Privacy entry row must render under the union of every revocable grant PLUS a live Plus session or a known cloud copy.** Otherwise withdrawing consent strands `Wipe cloud copy`, since withdrawing an ack does not wipe the mirror.
- **The device-local key fallback toggle stays beside the API key field**, on the engine screen — never in Advanced. `settings.ts:985-988` documents why.
- **`rowNames()` is scoped to `tab.containerEl`.** Sheets are `Modal`s rendered outside it — use the harness's `sheet()` / `pressSheet()` helpers for U9.
- **`www/dist` is tracked and `pretest` regenerates it.** Commit the rebuilt page alongside any `www/src/setup.html.tmpl` edit or `git diff --exit-code` fails.
- **Obsidian's row stacking is `.is-phone`-gated** (`styles.css:2008`). That is the #347/#348 iPad regression. Cover `is-tablet` too.
- **`AccountState` keeps its six kinds.** The nine renders are variants of `active` and `periodEnded`. `accountRowDescriptor` stays the single rendering authority.
- **Agent vault lane is `test_vault/test vault` only.** Never the personal Remote Vault.

## Open questions / blockers

None blocking. Deferred, recorded in the plan's Open Questions:

- Is the status group a fourth main-screen group or page-level chrome above the groups?
- KD5 places Ask under Resurface, inherited from the mock rather than settled in conversation.
- Whether `settings.ts` is later split, and whether the budget guard follows it.
- Whether `Sync everything now` keeps a root-screen presence for stalled filing.

Separate follow-up work, not yours unless asked: the buy-now / trial-eligibility plan (`subscribe_yearly` unreachable from the plugin; a returning lapsed user gets a 409 from `Start free trial`), and the #364 C1 scrim PR.

## Git state

- Branch `claude/settings-ux-redesign-69acd6` (base `master`), pushed to `origin`.
- Last real commit: `c4c4b66` — `docs(plan): settings three-leg overhaul — claim #493`
- Handoff commit: `0b36399` — `docs(handoff): settings three-leg overhaul ready to implement`
- WIP snapshot commit: none — the tree was already clean at handoff time.
- Diff since base: 6 files, +2530/-1 (docs only; `src/` untouched).

## How to resume

This session ran in a harness worktree under `.claude/worktrees/`, which is not durable. Work from a sibling worktree instead:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
git fetch origin
git worktree add ../obsidian_plugin-settings-ux-redesign claude/settings-ux-redesign-69acd6
cd ../obsidian_plugin-settings-ux-redesign
npm install
```

If that `worktree add` reports the branch is already checked out, the old worktree still exists — run `git worktree list | grep settings-ux-redesign` and `cd` to whichever path it names.

Verify before starting: `npm test && npm run lint && npm run build`.

Then continue from **Next steps** above.
