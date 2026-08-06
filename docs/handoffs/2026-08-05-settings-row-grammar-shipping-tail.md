---
handoff_date: 2026-08-05
branch: feat/settings-row-grammar
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/305
status: in-progress
---

# Handoff — settings row grammar (#304): all 11 units landed, `ce-compound` + `world-class-qa` remain

Read this top to bottom, run **How to resume**, then start at **Next steps** step 1. Do not re-plan
what is already decided and do not re-run the gates marked closed below.

## Where this stands

**All 11 implementation units (U0–U10) are implemented, reviewed, and pushed.** `npm test` is green
at **1091 tests / 67 files**; `npm run build` is clean. Version **0.6.78**.

Gates closed — **do not re-run these**:

| Gate | Outcome |
|---|---|
| `ce-doc-review` | Closed in the previous session; its box on PR #305 is checked |
| `ce-work` (U0–U10) | All 11 units landed, each committed separately |
| `ce-simplify-code` | Ran; 3 reviewers; found and fixed 2 real defects |
| `ce-code-review` | Ran at `depth:full`; 3 local reviewers + grok cross-model peer; all P1/P2 fixed |

Gates still open — **these are your work**:

| Gate | Why it is not done |
|---|---|
| `ce-compound` | Not started. Material listed under *What to compound* below — it is substantial |
| `world-class-qa` | Not started. Needs Obsidian open on the throwaway vault; includes the mandatory `adversarial-qa` half |
| PR body | #305 is still a draft carrying the old body. Needs evidence table, user stories, `Closes #304` |

## Next steps

1. **`ce-compound`.** Write the durable learnings to `docs/solutions/`. This is the step that makes
   the next session smarter and there is unusually good material this time — see below.
2. **`world-class-qa`** against `test_vault/`, ending with its `adversarial-qa` half. The plan's
   verification contract names specific things this must cover; they are listed below verbatim
   enough to act on.
3. **Update PR #305's body** — evidence table, core user stories, edge cases, `Closes #304`, and
   links to the three follow-up issues filed today (#314, #315, #316).
4. **Mark PR #305 ready for review** once 1–3 are done.

## What to compound (`docs/solutions/`)

Four things worth writing down, in rough order of value:

1. **The grok cross-model peer route needs two undocumented preconditions on a large diff.** The
   global rules record that this route has repeatedly cost money and returned nothing. It worked
   today, and here is exactly why it kept refusing first:
   - It **skips** a large diff unless the orchestrator has already written
     `<run-dir>/adversarial-review-brief.md` — a compact semantic review map, not a copied diff.
   - It then **still** skips unless `CROSS_MODEL_FIXED_ROUTE` is set (here `grok-cli`). A candidate
     list alone is not a resolved route.
   Both are fail-closed guards against paying for nothing, and neither is discoverable from the
   skill's prose. With both satisfied plus `PEER_MAX_TURNS=40`, the run took ~430s and returned 4
   real findings including a P1 the local reviewers missed. Category: `documentation-gaps`.
2. **A guard that has never failed is not a guard — and the corollary about *which side* it fails
   on.** Every guard in this change was mutation-proven: the sealed account state by adding a fifth
   state, the setup-guide lockstep by renaming three labels, the row ratchet by reintroducing a
   direct `new Setting(`. The setup-guide guard specifically asserts against **rendered rows** and
   the **built** `www/dist/setup.html`, because #302's guard passed against a mutation string that
   existed in neither. Category: `ui-patterns` or `documentation-gaps`.
3. **A property test is only as wide as its snapshot.** The R5 test exercises every rendered control
   in Advanced and asserts no gate moved — genuinely a property, not a list. It still missed a
   credential path sitting in Advanced, because its `gateState` snapshot tracked the consent acks and
   auto-run flags but not `useDeviceLocalKeyFallback`. The lesson is not "write property tests"; it
   is that a property test's blind spot is its state snapshot, and that is the thing to review.
   Category: `logic-errors`.
4. **Fixing the synchronous door leaves the async one open.** `hide()` got a `hiding` flag to stop a
   teardown re-render. It was cleared before `hide()` returned, so it only ever covered the
   synchronous decline path — every `redisplay()` reached from an awaited continuation sailed
   straight through. The fix is a latch **owned by the reader** (`display()` clears it), not by the
   writer. Category: `logic-errors`.

Also worth a `CONCEPTS.md` look: the row-grammar vocabulary (setting / destination / action /
destructive / status) is now load-bearing across `src/settings/rows.ts` and the ratchet guard.

## What `world-class-qa` must cover

From the plan's verification contract, plus what review surfaced:

- Open settings, **count the main-screen rows and record which account state was signed in**. Expect
  **15 signed in / 12 signed out** by default, **16 / 13** with the device-local key fallback on.
  (The plan's original 14/11 is superseded — see the amendment block at the top of the plan.)
- Enter and leave each of the **four destinations**: Account, Tag vocabulary, Connect Claude or
  ChatGPT, Advanced. Advanced now holds **two** rows.
- Drive one consent sheet through **accept / decline / dismiss-without-choosing / withdraw**.
  Dismissal specifically means Escape and click-outside — **the unit suite cannot represent either**
  (the `Modal` mock has no background element and no key listeners), so live QA is the only place
  these are actually proven. The security reviewer flagged this as a coverage gap by name.
- **The outcome check.** Re-pose the four failure modes from the plan's Problem frame — *too many ·
  can't tell which matter · jargon · scared to change them* — against the shipped screen and record
  the answers in the QA report. Everything else measures structure; this is the only item that
  measures whether the reported problem is gone, and its answer tells the deferred description pass
  (#314) whether it is still needed.
- **Screenshots** under `docs/qa/screenshots/feat-settings-row-grammar/`, linked in the PR body with
  absolute `raw.githubusercontent.com` URLs. **Capture Account and Advanced signed-out with no key
  present, or redact** — they render an Email row, an *Advanced: paste session* field, and the
  device-local key field, and committed images are public and permanent.
- Capture screenshots **twice and use the second** — the first returns a stale frame
  (`docs/solutions/documentation-gaps/screenshot-capture-races-and-viewer-lies.md`).

## Decisions made this session — do not relitigate

- **Device-local key rows moved from Advanced to the main screen** (user decision). They are a
  complete credential path enabling Anthropic spend, and R5 keeps money/egress gates off Advanced.
  The plan's own R5 carve-out had examined only *Model* and *Plus service URL override*.
- **The on-render key check is now non-billable and skips the GitHub baseline** (user decision). It
  previously sent a real Anthropic message and a `api.github.com/zen` ping on **every** visit to
  Settings. The explicit *Test connection* command's behavior is unchanged.
- **`clampShortlistSize` / `MIN_SHORTLIST_K` stay**, despite two reviewers independently finding no
  production caller. The plan directs keeping them; overriding that is the user's call, not a
  simplify pass's. Still unresolved — worth raising.
- **The 14-row figure was always the no-consent baseline.** KTD4's `Acknowledged · Review` rows are
  required by the plan and appear once consent is granted, so a consented screen shows more. The
  plan's table never covered that state.

## Known-open, deliberately not fixed here

- **#314** — deferred row *descriptions*, incl. the `egress` wording in the consent sheet title.
- **#315** — Atoms home grants the same egress ack behind a weaker disclosure than the settings sheet.
- **#316** — `personInvite`'s recency cutoff mixes local-time arithmetic with a UTC date read.
- **`docs/qa/app-navigation-map.md` is stale.** It still describes the flat pre-U0 settings screen and
  documents a `setDestructive` crash that `markDestructive` already fixed. It is a read-and-write
  artifact under the QA doctrine — **update it as part of `world-class-qa`**.
- The `DIRECT_SETTING_BUDGET` ratchet counts `new Setting(` textually, so it counts comment prose
  too. At 7 that is 6 real constructor sites plus 1 comment; the budget's own doc comment says so.

## Housekeeping wart

A stash mishap this session left two untracked paths in the worktree: `.gitattributes` and
`.opencode/`. They are **not** mine and are not part of this branch — I left them untracked rather
than guess. Do not `git add -A` in this worktree without looking. There is also an unrelated
pre-existing user stash at `stash@{0}` (*"On master: wip graphify+process docs"*) that must not be
dropped.

## Git state

- Branch `feat/settings-row-grammar`, base `master`, pushed, tracked by **draft PR #305**.
- Tip: `deca2ab docs(plan): amend after code review — key rows to the main screen`
- 16 commits since master; 30+ files; the settings screen went 48 rows to 15.
- This is a **linked worktree** on the shared `obsidian_plugin` git dir — it exists, reuse it.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-settings-row-grammar
git fetch origin && git switch feat/settings-row-grammar && git pull --ff-only
npm install
npm test
```

Then start at **Next steps** step 1.
