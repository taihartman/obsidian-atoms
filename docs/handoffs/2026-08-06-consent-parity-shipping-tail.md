---
handoff_date: 2026-08-06
branch: fix/consent-wording-parity
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/329
status: in-progress
---

# Handoff — #315 + #314: U1–U5 are built and green; the shipping tail is yours

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

> **Do not `git add -A` in this worktree.** It carries two untracked paths — `.gitattributes` and
> `.opencode/` — that are **not part of this work**, left from an unrelated stash pop. Stage explicit
> paths, always. The user's stash (`stash@{0}`, *"On master: wip graphify+process docs"*) must stay
> intact.

## Goal

Home's "Enable automatic filing" and the Settings egress sheet wrote the **same device-local boolean**
behind **different text**, and Settings then rendered it as *"Acknowledged on this device"* regardless
of which surface wrote it — so a user could grant from home, never open Settings, and hold a consent
record for wording they never saw. That is **#315**. **#314** is the two jargon row labels #304
deferred. Both are fixed in code on this branch. What is left is the shipping tail and one held
decision.

## Current status

**All five units are implemented, committed, and green.** `npm run build` clean, **1241 tests pass**,
working tree clean apart from the two untracked paths above.

| Unit | Commit | What landed |
|---|---|---|
| U1 | `87f4fa2` | Consent primitive → `src/settings/consent.ts`; `DIRECT_SETTING_BUDGET` 6→5 |
| U2 | `e16411e` | `EGRESS_DISCLOSURE` unioned — four numbered clauses, risks first |
| U3 | `26b9f38` | Home grants through the shared sheet via `egressConsentSpec`; only `accepted` enables |
| U4 | `e6f94a0` | The two labels; 14 hardcoded sites in `test/settings.test.ts` updated |
| U5 | `5a62e53` | The drift guard, proven by sabotage |

A light `ce-doc-review` ran before implementation (report: `docs/handoffs/2026-08-06-consent-wording-parity-doc-review.md`,
commit `63d1616`). It materially changed the plan — read the report before you second-guess any unit.

**What has NOT run:** `ce-simplify-code`, `ce-code-review`, `ce-compound`, `world-class-qa` (+ its
`adversarial-qa` gate), the rebase, the version bump, and marking PR #329 ready. PR #329 is **open and
draft**.

## Next steps

1. **Get the user's decision on U6 — ask this first, it is the one open fork.** U6 (KTD4 in the plan)
   version-stamps the egress ack so devices holding consent to wording they never saw re-prompt once.
   It is **not implemented**, deliberately. Without it, this ships a known-stale consent record: every
   device that already accepted through the old home modal keeps showing *"Acknowledged on this
   device"* for wording nobody saw, and **U2's rewrite extends that to Settings acks too**. It is the
   half of #315 the wording fix does not reach. It widens scope into the write path, the read path,
   the auto-run gate, and the withdrawal cascade, which is why it is sequenced last and drop-able.
   Precedent to copy if you build it: `writeShortcutAck` / `readAckVersion` in
   `src/settings/captureShortcut.ts:141`.
2. **Run the shipping tail, in full** (`CLAUDE.md` mandates it; do not stop at "tests green"):
   `ce-simplify-code` → `ce-code-review` (cross-model peer routes to **grok**, never codex) →
   `ce-compound` → `world-class-qa` ending in `adversarial-qa`.
3. **Rebase on `master`** — see the constraint below; do **not** wait on #330.
4. **Bump the version files last**, re-derived from master at merge time. Never resolve a version
   conflict by picking a side.
5. **Mark PR #329 ready.** Body needs `Closes #315` and `Closes #314` (an "Issue #N" mention does not
   auto-close), distilled Core user stories, Edge cases & testing, and — this is a UI change —
   **vault screenshots** committed under `docs/qa/screenshots/` and linked with absolute
   `https://raw.githubusercontent.com/...` URLs. Repo-relative image paths render broken in PR bodies.
6. **After merge:** clear the STATUS.md row on a small branch + PR. Do not cut a release unless the
   user asks.

## Key files

- `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md` — the plan, and the authority here.
  Amended twice this session; KTD4 and U6 are new.
- `docs/handoffs/2026-08-06-consent-wording-parity-doc-review.md` — the doc-review report. Read this
  before relitigating any unit.
- `src/settings/consent.ts` — **new**. The six `*_ACK_TITLE`/`*_DISCLOSURE` constants under their
  KTD7 comment, `ConsentVerdict`, `ConsentSheetSpec`, `ConsentSheetModal`, and `egressConsentSpec()`.
- `src/home/atomsHomeView.ts` — `confirmEnableAutomaticFiling()` is now four lines through the factory.
- `src/settings/settings.ts:1661` and `:1683` — the two Settings egress call sites, both via the factory.
- `test/egressConsentParity.test.ts` — **the drift guard**. Rendered-vs-rendered plus clause content.
- `test/homeEgressConsent.test.ts` — U3's home-side tests; first test to drive `atomsHomeView`.

## Decisions & constraints

Do **not** relitigate these:

- **Union, not swap.** #315's own framing says home is strictly weaker and to point it at
  `EGRESS_DISCLOSURE`. That is half wrong — each string carried two clauses the other lacked. If a
  reviewer suggests "just import `EGRESS_DISCLOSURE`", that is the issue's wording, not the plan's.
- **The labels are decided:** `EGRESS_ACK_TITLE` → **"What Atoms sends to Anthropic"**,
  `ASK_PRIVACY_ACK_TITLE` → **"What Ask stores and shares"**. **Not first person**, despite the sheet
  body's "I understand:" voice — each title also renders as a Settings row, where #304's grammar is
  second-person/imperative, so a first-person row would clash with every neighbour.
- **Home adopted the shared chrome deliberately.** Its title changed and its CTA went "Enable" →
  "I understand". `ConsentSheetSpec` was **not** widened. This is a decision, not an accident.
- **U5 does not assert "both paths write the same key"**, and must not be "fixed" to. Both surfaces
  already wrote the same key before this work, so that assertion was green throughout the entire bug.
  Sabotage proved it: pointing home back at an inline literal left all three write-behavior tests
  green while only the parity assertions caught it. U5 also asserts the disclosure's **clause
  content**, because a pure parity test passes if both surfaces go blank together.
- **There is no accept-time asymmetry between home and Settings.** An earlier draft claimed the
  Settings sheet writes only the ack; `settings.ts:1664-1665` writes both keys, because that toggle
  *is* an enable. The real asymmetry is the Review row's *withdrawal*, which also calls
  `clearEgressNoticeAcked`.
- **Each sheet writes exactly its own field.** The KTD7 comment now at the top of `consent.ts`
  explains why merging any two consents is a bug — agreeing to one would silently authorize another.
- **Vault lanes:** dogfood in `test_vault/test vault` only. **Never** `~/Documents/Remote Vault`.
- **No AI attribution** in commits, PR bodies, or review replies.
- **Releases only when the user explicitly asks.**

## Open questions / blockers

- **U6 — the one real fork.** See Next step 1. Nothing else is blocked on it.
- **Rebase target changed mid-session.** KTD2 originally sequenced this behind #330. **#330 went back
  to draft** (verified with `gh pr view 330`) — its review found `runSyncOnce`
  (`askCoordinator.ts:234`) has no consent gate and `catchUp.ts:74-88` re-enters it without passing
  through `sync()`. So **rebase on `master` directly**. Version collision is back between equals:
  master is 0.6.79, whoever lands first takes 0.6.80 and the other re-derives.
- **Merge note, recorded in the plan.** #330 introduces `refreshFromExternalSettings()`, which
  rebuilds the settings DOM via `redisplay()` **without settling an open consent sheet**. It exists on
  neither master nor this branch, so it is not yours to fix — but it lands on the seam U1 extracted.
  This branch has exactly three paths that settle `openSheet` before tearing the screen down:
  `openRoute()` (`settings.ts:428`), `hide()` (`:449`), `presentConsent()` (`:466`). An external
  refresh would be a fourth that settles nothing, leaving a live sheet above a rebuilt screen whose
  accept writes an ack against state the user can no longer see. Whoever merges second should fix it.
- **Two deferred questions the plan records, neither blocking:** does the Settings *review/withdraw*
  sheet want the full unioned disclosure (both share `EGRESS_DISCLOSURE`, so U2 changed the withdrawal
  copy too)? And do the new labels need a matching update to the row inventory in
  `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md`?
- **The cross-model peer is unreliable on this repo's grok route.** Both legs of the doc-review peer
  returned well-formed, `independence_verified: true` artifacts with **zero findings** — because the
  prompt was truncated and offloaded to a file the grok sandbox denies reading. It never saw the
  document. Do not read an empty grok return as agreement. Worth a `ce-compound` entry.
- **Lenses never run on this plan:** `security-lens` and `adversarial`, both of which ce-doc-review's
  own signals would have activated on a consent surface; they were scoped out of the invocation.
  Given U6 is unresolved, an adversarial pass is the one most likely to find more.

## Git state

- Branch `fix/consent-wording-parity` (base `master`), pushed to `origin`, tracked by **PR #329**
  (open, **draft**).
- Last real commit: `5c527fb docs(plan): #330 went back to draft — rebase on master, not behind it`
- WIP snapshot commit: `da13deb` — `wip: handoff snapshot — consent-parity-shipping-tail` (this doc
  plus the STATUS.md row refresh; no code)
- Diff since base: 11 files, +1105/−152 (`git diff --stat master...HEAD`)
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

Then continue from **Next steps** above — start with step 1, the U6 decision.
