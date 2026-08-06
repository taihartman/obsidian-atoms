---
handoff_date: 2026-08-05
branch: feat/settings-row-grammar
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/305
status: in-progress
---

# Handoff — settings row grammar (#304): plan is through the gate, `ce-work` is next

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Restructure the Atoms settings screen from 48 undifferentiated rows onto a five-kind row grammar
(setting / destination / action / destructive / status), so a button that fires a network wipe stops
looking identical to a toggle that stores a preference. The main screen lands at **14 rows plus one
prose section intro** in the signed-in Plus state. Row-count reduction is a consequence; the defect
being fixed is that the screen has no way to say what a row *is*.

## Current status

- **The plan is written, reviewed, and implementation-ready.**
  `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md` — **11 units in five phases**.
- **`ce-doc-review` has run and its box on [PR #305](https://github.com/taihartman/obsidian-atoms/pull/305)
  is checked.** Seven personas (coherence, feasibility, product, design, security, scope,
  adversarial). 25 actionable findings: **23 applied** in `00abaef`, **2 were scope questions the
  user has now ruled on** in `1b88e9f`. This gate is closed — **do not re-run it.**
- **Nothing in `src/` has changed on this branch.** Not one line. The whole diff is the plan doc,
  this handoff, the previous handoff, a STATUS row, and a lockfile version sync.
- `npm test` green: **64 files, 981 tests**, verified this session.
- **[PR #296](https://github.com/taihartman/obsidian-atoms/pull/296) is closed** as redundant — that
  loose end is done, do not revisit it.

## Next steps

1. **Run `ce-work` on `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md`.** This is your
   current task. Follow the plan's own Phasing table — **U0 (Harness) first**; U1-U6 are literally
   untestable until it lands. Dispatch implementation units via `subagent_type: "impl-worker"` and
   omit the Agent tool's model param so the Opus-5-at-medium pin wins.
2. **Run the full shipping tail** — it is not optional: `ce-simplify-code` → `ce-code-review` →
   `ce-compound` → `world-class-qa` including its adversarial half. Then update #305's body with the
   evidence table.
3. **In `ce-compound`, capture the cross-model peer failure** described under *Constraints* below.
   It cost real money and will silently recur on the next `ce-doc-review` in any repo.
4. **Loose end you can clear any time:** #297 merged with a **stale R12** in
   `docs/plans/2026-08-05-002-feat-library-skipped-filter-plan.md` on `master`. It still reads
   *"promote = Reconsider command when flagged"*, which is the pre-amendment split; the shipped code
   makes Try filing ungated, so it reads as a live requirement contradicting master. Noted at
   [#297 comment](https://github.com/taihartman/obsidian-atoms/pull/297#issuecomment-5195629364).
   Needs its own small branch off `master` — it does **not** belong in this PR.

## Key files

- `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md` — **the implementation authority.**
  Read it in full before writing code; the review rewrote three units materially.
- `src/settings/settings.ts` — the target, 1536 lines. **Every line number the plan cites was
  re-verified against this worktree on 2026-08-05 and is correct as written** (the plan's Sources
  section lists them). The `+25` re-anchor caveat applies only to the *inventory* doc, not the plan.
- `test/mocks/obsidian.ts:7`, `:11`, `:27` and `vitest.config.ts:7` — what **U0** must fix. Today:
  `environment: "node"`, `PluginSettingTab` is `class PluginSettingTab {}`, and the `Setting` stub's
  `addToggle()` discards its callback. No `setWarning`, `controlEl`, or `settingEl`.
- `tsconfig.test.json` — includes only three test files, and `tsconfig.json` excludes `test/`
  entirely. Any type-level assertion written outside that include list is typechecked by **neither**
  `npm run build` nor `npm test`. U0 extends it; U2 and U3 depend on that.
- `src/plugin/main.ts:50`, `:521`, `:1044`, `:1146`, `:1175`, `:1533`, `:1654`, `:1720`, `:2059` —
  the `shortlistOptionsFromSettings` import and eight call sites U7 must update.
- `src/settings/settings.ts:846-854` (egress ack) and `:1165-1174` (Ask privacy ack) — the two
  permanent rows KTD4 deletes. They are the **only** controls that clear an ack today.
- `src/settings/captureShortcut.ts:130-132` — where `Install Capture Atom` actually lives. It is
  **not** in `settings.ts`; U10's binding test must target the right file.
- `docs/handoffs/2026-08-05-settings-inventory.md` — the 48-row inventory. Written against a
  1511-line `settings.ts`; re-anchor its rows **by symbol, not by line**.

## Decisions & constraints

Do **not** relitigate any of these.

**Settled by the user before this session** (every KTD in the plan is `session-settled`): KTD1 five
row kinds / five right edges · KTD2 destinations are `containerEl` re-renders, not new views · KTD3
the account section is one sealed state · KTD4 consent is a sheet at enable time · KTD5 delete
`enableReconsiderCapture` (challenged by #297 and **survived** — #297's whole diff touched the flag
in one docstring) · KTD6 deletion conservatism binds settings, not actions · KTD7 the consent gates
are never unified · KTD8 deleted settings leave stale `data.json` keys on purpose.

**Settled by the user this session:**

- **R11 is in scope.** A plain-language pass over the 14 surviving main-screen row *labels* lands in
  U10, which already owns both sides of the setup-guide lockstep. Setting **descriptions** stay
  deferred and get their own filed issue the PR references.
- **No consequence affordance.** A grammar mark distinguishing money/egress/vault-write rows was
  considered and deliberately not taken — it widens settled KTD1, and the R11 label pass attacks the
  same target more directly. The verification contract's **outcome check** decides it later with
  evidence. Do not add it now.

**Corrections the review made that you must not undo** — each was verified against live code:

- **U7 must edit `src/plugin/main.ts`.** Dropping the `shortlistOptionsFromSettings` parameter
  without updating its eight call sites fails typecheck and reddens `npm run build`.
- **U0 exists because no settings-render test harness does.** U1's test-first mandate is
  unexecutable without it.
- **The Review sheet carries Withdraw.** KTD4 deletes both permanent ack rows; without Withdraw on
  the Review sheet, consent to store bodies on Plus servers becomes grantable but never revocable.
  The status line renders **whenever an ack exists**, not only under an enabled toggle.
- **U5 has three sheets, not two** — egress, `askPrivacyAckAt`, and `askWriteAckAt`. KTD7's
  independence rule binds all three.
- **Today's `askWriteAckAt` cascade is the opposite of what the plan originally said.**
  `settings.ts:1167` clears the privacy ack and never touches `askWriteAckAt`; `:1192` (the mirror
  toggle's off path) is what clears it. U5 now states this and deliberately hardens it.
- **"No `default` branch" does not make a fifth state a compile error** in a void-returning
  renderer — `noImplicitReturns` does not fire. U2 and U3 use `const _exhaustive: never = x;`.
- **U1's signature invariant needs a repo guard.** `settings.ts` holds 51 direct `new Setting(`
  sites; builders also return `void` so callers cannot chain a second affordance.
- **U9 must register a daily-note command before deleting the row.** `commands.ts` registers none
  today; the plan's original "the command palette already opens the daily note" was false.
- **Any non-accept sheet exit is a decline** — Escape, click-outside, closing the settings tab.

**Hard constraints:**

- **Vault lanes.** Dogfood in `test_vault/` or `docs/media/demo-vault/` only. The personal **Remote
  Vault** at `~/Documents/Remote Vault` is open in the same Obsidian instance — never mutate it.
- **`enableHubProjection`'s default is out of scope** — enshrined at `docs/architecture.md:187`,
  changeable only by constitution PR. This plan changes its placement and sub-label, never its
  default.
- **Screenshots:** capture the Account and Advanced destinations **signed-out with no key present,
  or redact**. They render an Email row, an *Advanced: paste session* field, and the device-local
  API key field, and committed images are served publicly and permanently from a public repo.
- **All phases ship as one PR** carrying `Closes #304`. U3-U9 all edit `settings.ts`; "land in
  parallel" in the Phasing table means within one branch, not one PR per phase.
- **Never add AI attribution** to commits, PR bodies, or review replies.

**The cross-model peer pass is broken for `ce-doc-review` on this machine — do not retry it there.**
`.compound-engineering/config.local.yaml` (gitignored; recreate as `cross_model_peer: grok` if
missing) routes correctly, but two separate faults make the pass worthless here:
1. `ce-doc-review`'s `scripts/cross-model-doc-review.sh` **hardcodes `--max-turns 15`** at lines 219
   and 227 and never reads `PEER_MAX_TURNS`. The `PEER_MAX_TURNS=40` fix in `~/.claude/settings.json`
   only reaches `ce-code-review`, whose script *does* read it (`cross-model-adversarial-review.sh:64`).
   The whole-doc sweep died at exactly 15 tool calls for $0.29 and an empty result.
2. All three trio peers returned artifacts stating they received **only the document's tail**. The
   host script does not truncate (200KB cap; the doc is 25KB) and feeds the full text via
   `--prompt-file` plus stdin, so this is provider-side handling on the `grok-cli --json-schema`
   route.
Findings derived from that fragment were **not** folded in — one of them ("orphaned `data.json` keys
are unhandled") is directly answered by KTD8, which the peer never saw. `ce-code-review` later in the
tail is a **different script** and may well work; judge it on its own output.

## Open questions / blockers

None blocking. Both forks the review surfaced were decided by the user this session and are recorded
above.

## Git state

- Branch `feat/settings-row-grammar` (base `master`), pushed to `origin`, tracked by draft PR #305.
- Last content commit: `1b88e9f docs(plan): settings row grammar — R11 label pass in scope; consequence mark deferred`
- Before that: `00abaef docs(plan): settings row grammar — apply ce-doc-review findings`
- WIP snapshot commit: `0fa7352` — `wip: handoff snapshot — settings-row-grammar-ce-work`
- Diff since `master`: 4 files, ~+950/-1 — the plan doc, two handoff docs, `STATUS.md`, plus a
  `package-lock.json` version sync (it was stale at 0.6.76 against `package.json` 0.6.77).
- This is a **linked worktree** on the shared `obsidian_plugin` git dir; it already exists, reuse it.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch feat/settings-row-grammar && git pull --ff-only
npm install
npm test
```

Then continue from **Next steps** above — step 1 is `ce-work`.
