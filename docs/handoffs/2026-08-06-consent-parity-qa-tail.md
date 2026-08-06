---
handoff_date: 2026-08-06
branch: fix/consent-wording-parity
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/329
status: in-progress
---

# Handoff — #315 + #314: code is done and reviewed; QA and the PR are yours

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

> **Do not `git add -A` in this worktree.** It carries two untracked paths — `.gitattributes` and
> `.opencode/` — that are **not part of this work**, left from an unrelated stash pop. Stage explicit
> paths, always. The user's stash (`stash@{0}`, *"On master: wip graphify+process docs"*) must stay
> intact.

## Goal

Atoms home's "Enable automatic filing" and the Settings egress sheet wrote the **same** device-local
consent behind **different text**, and Settings rendered it as *"Acknowledged on this device"*
whichever surface wrote it — so a user could grant from home, never open Settings, and hold a consent
record for wording they never saw. That is **#315**. **#314** is the two jargon row labels #304
deferred. All six units are built, simplified, reviewed, and pushed. What is left is **QA, the
version bump, and marking the PR ready**.

## Current status

**U1–U6 implemented, rebased on `master`, pushed. Build clean, 1249 tests pass.** PR #329 is open and
still **draft**.

| Unit | Commit | What landed |
|---|---|---|
| U1 | `5f3fa62` | Consent primitive → `src/settings/consent.ts`; `DIRECT_SETTING_BUDGET` 6→5 |
| U2 | `ecfb978` | `EGRESS_DISCLOSURE` unioned — four numbered clauses, risks first |
| U3 | `9820236` | Home grants through the shared sheet; only `accepted` enables |
| U4 | `7dc2843` | The two labels; hardcoded sites in `test/settings.test.ts` updated |
| U5 | `ce157f2` | The rendered-vs-rendered drift guard, proven by sabotage |
| U6 | `39c6408` | Ack version-stamp (`EGRESS_ACK_VERSION`) — **the user chose to build it** |
| simplify | `8f7e460` | Dropped an unused re-export; shared the home test stub |
| review fix | `a3ce40d` | The P1 below |

**Shipping tail progress:** `ce-simplify-code` **done**. `ce-code-review` **done** (verdict: *Ready
with fixes*; the one P1 is fixed and pushed). **Not yet run: `ce-compound`, `world-class-qa` + its
`adversarial-qa` gate, the version bump, PR ready.**

### The P1 code review caught — read this before touching the consent gate

The first cut of U6 gated the Settings **Review/withdraw row** on `state.egressAcked` alone. But
`readEgressPermitted` (`src/platform/autorun.ts`) honors **two** grants — the stamped ack *and* the
catch-up notice (`LS_EGRESS_NOTICE`) — and `main.ts:1018` passes `catchUp != null` on the
**unattended** foreground-resume path. So a device holding a legacy ack plus a granted notice lost
the only surface that withdraws either grant, while the notice kept the paid path open. The grant
survived the upgrade, kept spending, and had nothing left on screen to take it back.

Fixed in `a3ce40d`: the row keys on **either** grant and names which one is on record — a notice-only
device reads *"for Sync everything now, against earlier wording"*. Three independent reviewers found
it separately (correctness, security, and the cross-model Grok pass at confidence 100). Proven by
sabotage: restoring the stamp-only guard fails the new regression test.

## Next steps

1. **Run `ce-compound`.** Three durable learnings are already identified — write them up rather than
   re-deriving:
   - **A version-stamped consent must invalidate *every* grant the gate composes, not just the one
     you stamped.** `readEgressPermitted` ORs two booleans; stamping one and hiding the withdrawal
     surface on it left a live grant with no way out. The general shape: *when you narrow a
     permission read, check what else still widens it, and never let the narrowing remove the
     revocation surface.* Rhymes with the existing
     `docs/solutions/logic-errors/security-fix-repair-wired-into-only-one-branch.md`.
   - **A golden/freeze test defended by a comment is defeatable in one PR.** `FROZEN_CONSENT` in
     `test/egressConsentParity.test.ts` can be made green by editing the existing entry instead of
     adding one — the testing reviewer proved it live. Accepted as residual risk here; worth writing
     down as a known limit of same-file golden values.
   - **The grok cross-model peer worked this time, and why.** The prior failure (empty artifact) was
     an over-broad brief; this run wrote a compact `adversarial-review-brief.md` naming four risk
     divisions and it returned two real findings with `independence_verified: true` in ~4 min. That
     is the reusable technique: *give the peer less to read.*
2. **Run `world-class-qa`** (project adapter: `docs/qa/`), ending in its mandatory `adversarial-qa`
   half. Vault lane is **`test_vault/test vault` only — never Remote Vault.** The stories that matter:
   - enable filing **from home** → Settings then shows the ack row with the shared wording;
   - enable **from Settings** → same disclosure, same record;
   - **Withdraw** from the Review row → auto-run off, both grants cleared;
   - **the upgrade case**: seed a legacy `true` ack (+ `LS_AUTO_RUN_ENABLED`, + `LS_EGRESS_NOTICE`)
     via `obsidian eval`, reload, and confirm the row still appears and reads *"against earlier
     wording"*, and that withdrawing shuts both paths.
3. **Capture screenshots** — this is a UI change, so the PR needs them. `./scripts/install-to-vault.sh`
   then `obsidian vault="test vault" dev:screenshot path=…`. Commit under
   `docs/qa/screenshots/consent-wording-parity/` and link them in the PR body with **absolute**
   `https://raw.githubusercontent.com/taihartman/obsidian-atoms/fix/consent-wording-parity/…` URLs —
   repo-relative paths render broken in PR descriptions.
4. **Bump the version files last**, re-derived from `master` at merge time (`manifest.json`,
   `package.json`, `versions.json`). Master is **0.6.79**; whoever lands first takes 0.6.80 and the
   other re-derives. **Never resolve a version conflict by picking a side.**
5. **Rewrite the PR #329 body and mark it ready.** The current body is **stale** — it still says
   "Draft — plan only, no implementation yet." It needs `Closes #315` and `Closes #314` (an
   "Issue #N" mention does not auto-close), distilled **Core user stories**, **Edge cases & testing**,
   the evidence table with the screenshots, and Test plan boxes checked only for what actually ran.
6. **After merge:** clear the `STATUS.md` row on a small branch + PR. Do not cut a release unless the
   user asks.

## Key files

- `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md` — the plan, and the authority here.
  Its U6 section now records the P1 and its fix; read that before touching the gate.
- `src/platform/autorun.ts` — `EGRESS_ACK_VERSION`, `readEgressAckVersion`, `egressAckIsCurrent`,
  `writeEgressAck`, `readEgressPermitted`. The storage-format change lives here.
- `src/settings/settings.ts:1666` — the Review/withdraw row, now gated on **either** grant.
- `src/settings/consent.ts` — the six consent constants under their KTD7 comment, `ConsentSheetModal`,
  `egressConsentSpec()`.
- `test/egressConsentParity.test.ts` — the drift guard **and** the `FROZEN_CONSENT` version freeze.
- `test/settings.test.ts` — the legacy-ack and notice-only regression tests.
- `/tmp/compound-engineering-502/ce-code-review/20260806-125134-f187588f/` — full review artifacts
  incl. `adversarial-grok.json`. **Ephemeral** — if you need anything from it, read it before it is
  wiped; do not cite it as canonical.

## Decisions & constraints

Do **not** relitigate these:

- **Union, not swap.** #315's own wording says home is strictly weaker and to point it at
  `EGRESS_DISCLOSURE`. That is half wrong — each string carried two clauses the other lacked.
- **The labels are decided:** `EGRESS_ACK_TITLE` → **"What Atoms sends to Anthropic"**,
  `ASK_PRIVACY_ACK_TITLE` → **"What Ask stores and shares"**. Not first person — each also renders as
  a Settings row, where #304's grammar is second-person.
- **Home adopted the shared chrome deliberately** (title changed, CTA "Enable" → "I understand").
  `ConsentSheetSpec` was **not** widened.
- **U5 must not be "fixed" to assert both paths write the same key.** Both surfaces already did
  before this work, so that assertion was green throughout the entire bug.
- **The catch-up notice is deliberately *not* version-stamped.** It carries its own disclosure in
  `resume.ts`, which that user did see. Stamping it is follow-up work, not this PR's.
- **Deferred on purpose (do not widen this PR):** `readEgressAckVersion`/`egressAckIsCurrent`
  duplicate `readAckVersion`/`ackIsStale` in `src/settings/captureShortcut.ts:100`. Two reviewers
  proposed extracting a shared `src/shared/ackVersion.ts`. It touches a file this branch does not
  otherwise touch, on a consent PR. **File it as a follow-up issue instead.**
- **Vault lanes:** dogfood in `test_vault/test vault` only. **Never** `~/Documents/Remote Vault`.
- **No AI attribution** in commits, PR bodies, or review replies.
- **Releases only when the user explicitly asks.**
- **Cross-model peer routes to grok, never codex** (`.compound-engineering/config.local.yaml` already
  sets `cross_model_peer: grok` in this repo).

## Open questions / blockers

- **Nothing is blocked.** Every fork this session opened is closed: the user chose to build U6, and
  the P1 is fixed.
- **Merge note, unchanged and still not yours to fix.** #330 introduces
  `refreshFromExternalSettings()`, which rebuilds the settings DOM via `redisplay()` **without
  settling an open consent sheet**. It exists on neither `master` nor this branch. This branch has
  exactly three paths that settle `openSheet`: `openRoute()`, `hide()`, `presentConsent()`. An
  external refresh would be a fourth that settles nothing. **Whoever merges second should fix it.**
- **Two deferred questions the plan records, neither blocking:** does the Settings *review/withdraw*
  sheet want the full unioned disclosure (both share `EGRESS_DISCLOSURE`, so U2 changed the withdrawal
  copy too)? And do the new labels need a matching update to the row inventory in
  `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md`?
- **No lint is configured in this repo** — `npx eslint` fails on missing config and there is no `lint`
  script. Verification is typecheck + build + vitest. Do not report lint as passing.

## Git state

- Branch `fix/consent-wording-parity` (base `master`), pushed to `origin`, tracked by **PR #329**
  (open, **draft**). Rebased onto `master` this session (`9fb4fa4`); three STATUS.md conflicts
  resolved by keeping both in-flight rows.
- Last real commit: `a3ce40d fix(consent): keep Review reachable while the catch-up notice still grants`
- WIP snapshot commit: the branch tip, `wip: handoff snapshot — consent-parity-qa-tail` (this doc
  only; no code). Its SHA is not pinned here because amending to pin it would change it again.
- Diff since base: 15 files, +1544/−177 (`git diff --stat master...HEAD`)
- Worktree note: the directory is named `obsidian_plugin-settings-row-grammar` but the branch is
  `fix/consent-wording-parity` — leftover from the previous feature. Harmless; do not move it.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch fix/consent-wording-parity && git pull --ff-only
npm install
npm run build && npm test
```

Then continue from **Next steps** above — start with step 1, `ce-compound`.
