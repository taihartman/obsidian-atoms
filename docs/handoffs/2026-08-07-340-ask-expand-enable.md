---
handoff_date: 2026-08-07
branch: feat/339-ask-search-recall-honesty
worktree: /Users/a515138832/StudioProjects/obsidian_plugin
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/339 · PR https://github.com/taihartman/obsidian-atoms/pull/340
status: in-progress
---

# Handoff — #340: land the amended disclosure, then turn search expansion on

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch, then **start executing Next steps immediately** —
step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back
to them; just begin, and report what you did. Everything you need is below.

## Goal

[PR #340](https://github.com/taihartman/obsidian-atoms/pull/340) adds index-time search expansion to
Ask: `search_atoms` recall goes up because each mirrored note gets Anthropic-generated paraphrase
phrases. That path sends **note body plaintext** off-device, so it ships behind a disclosure clause
and a feature flag that is currently off.

Your job is the four ordered steps that make it safe to turn on, then the shipping tail and a green
PR. **#340 is red right now on purpose** — [#360](https://github.com/taihartman/obsidian-atoms/issues/360)
merged the consent-versioning machinery to master specifically to block this branch until it
re-prompts users on the new wording.

## Current status

- **Master moved under you.** #360 merged as `35cc37b`, plugin **0.6.86**. It added
  `src/shared/askAck.ts` (dated ack-version constants + gates) and
  `test/askConsentVersion.test.ts`'s frozen-wording guard. That whole change is done, reviewed, QA'd
  — do not reopen it.
- **PR #340 is OPEN, not draft, `CONFLICTING` / `DIRTY`.** Its last green check run predates the
  master merge, so treat those checks as stale.
- **The branch already carries the seven-clause disclosure** and all of `expandSearch.mjs`. You are
  not writing the disclosure; you are versioning it and flipping the flag.
- Working tree has **no tracked modifications**. There are unrelated untracked stragglers
  (`.opencode/`, `SHA256SUMS.txt`, and two `docs/**` android-companion files) — they belong to other
  work. **Do not `git add -A`.** Stage explicitly.
- Branch is `0.6.85`, master is `0.6.86`. You will land on **0.6.87**.

## Next steps

1. **Merge `origin/master` into the branch.** Three real conflicts, all version churn, no source
   conflicts:
   - `manifest.json` + `package.json` — take **`0.6.87`** (not either side; #340 is user-visible).
   - `versions.json` — keep **both** added lines in order (`0.6.85`, `0.6.86`) and append
     `"0.6.87": "1.11.4"`.

2. **Read `src/settings/consent.ts` after the merge and understand what you just got.** This is the
   trap. `consent.ts` **auto-merges with no conflict marker** — master added a bump-reminder comment
   *above* `ASK_PRIVACY_DISCLOSURE`, the branch replaced the string literal *below* it, so git
   silently produces the seven-clause wording sitting under `ASK_PRIVACY_ACK_VERSION = "2026-08-06"`,
   which still names the six-clause text. Nothing flags it but
   `test/askConsentVersion.test.ts:216`, which fails on exact string equality. That red test *is*
   the guard working. Steps 3–4 are its fix.

3. **Bump `ASK_PRIVACY_ACK_VERSION` to `"2026-08-07"`** at `src/shared/askAck.ts:33`. While you are
   there, fix the now-stale prose at `src/shared/askAck.ts:26-32` — it says the constant names the
   **six-clause** wording authored 2026-08-06 (#304). Make it name the seven-clause wording and
   #339/#340.
   **Do not touch `ASK_WRITE_ACK_VERSION`** (`src/shared/askAck.ts:36`). I diffed
   `ASK_WRITE_DISCLOSURE` across both refs: byte-identical. The write ack has not changed and must
   not be re-prompted on its own account.

4. **Add a new keyed entry to `FROZEN_ASK_PRIVACY`** at `test/askConsentVersion.test.ts:192`:
   ```ts
   "2026-08-07": {
     title: "What Ask stores and shares",
     disclosure: /* the exact post-merge value of ASK_PRIVACY_DISCLOSURE */,
   },
   ```
   **Never edit the existing `"2026-08-06"` entry** — it is the record of what already-shipped
   devices agreed to, and rewriting it destroys the only evidence of the old contract. Copy the
   string from `src/settings/consent.ts` itself, not from this doc; the constant is the source of
   truth and hand-transcription is how you get a one-character diff you then debug for an hour.

5. **Decide the flag question in *Open questions* below, then act on it** — either flip the
   `plus-service/src/config.mjs:89-91` default to `"1"`, or leave the default off and set
   `ASK_EXPAND_ENABLED=1` as a Fly secret. Either way update the doc comment at
   `plus-service/src/config.mjs:73-88`, which currently reads as a hold ("Before flipping this
   default to `"1"`: ship an *ask ack version*…") and is satisfied the moment step 3 lands. If you
   flip the default, `plus-service/test/ask-expand-guardrails.test.mjs:48-78,114` pins
   off-by-default and must change with it.

6. **Verify.** `npx vitest run` for the root suite and the plus-service suite. Expect
   `test/askConsentVersion.test.ts` to go green as the direct proof steps 3–4 worked.

7. **Shipping tail, in order, no skipping:** `ce-simplify-code` → `ce-code-review` → `ce-compound` →
   `world-class-qa` (ending in `adversarial-qa`). Then update the PR body: it needs `Closes #339`,
   distilled core user stories, edge cases, and — because settings copy changes — **vault
   screenshots** committed under `docs/qa/screenshots/` and linked with absolute
   `raw.githubusercontent.com` URLs.

8. **Do not cut a Release.** BRAT users get nothing until the owner asks.

## Key files

- `src/settings/consent.ts:27-28` (branch) — the seven-clause `ASK_PRIVACY_DISCLOSURE`. Post-merge
  it sits under master's bump-reminder comment.
- `src/shared/askAck.ts:33` — `ASK_PRIVACY_ACK_VERSION`, currently `"2026-08-06"`. Bump this.
- `src/shared/askAck.ts:36` — `ASK_WRITE_ACK_VERSION`. Leave alone.
- `src/shared/askAck.ts:167` — `settleAckRecords` clears the **write** ack whenever the privacy ack
  is not current. So your version bump re-prompts *both* consents on every device. That is
  deliberate (#360's design), not a bug you introduced — do not "fix" it.
- `test/askConsentVersion.test.ts:192` — `FROZEN_ASK_PRIVACY`. Add a key; never edit one.
- `test/askConsentVersion.test.ts:209-232` — the assertions. `:211` catches a bump with no frozen
  entry; `:216` catches new wording with no bump.
- `plus-service/src/config.mjs:89-91` — `askExpandEnabled`, default `"0"`.
- `plus-service/src/ask/expandSearch.mjs:110` — `bodySlice`, first 4000 chars of body plaintext;
  `:114-131` POSTs it to Anthropic. This is the egress the disclosure clause exists for.
- `plus-service/src/ask/expandSearch.mjs:212,269,311` — the three `askExpandEnabled` gates
  (enqueue on upsert, backfill, and whether `search_atoms` advertises `lexical_expanded`).

## Decisions & constraints

- **The disclosure wording is settled — do not redraft it.** The new clause is **(4), inserted mid-
  list**, not appended; master's (4)(5)(6) shift to (5)(6)(7), and the Wipe clause additionally
  gains `search expansions, `. Two substantive changes, already written on the branch.
- **A new version string plus a new frozen entry. Both.** One without the other fails a different
  assertion; that is the guard's whole design.
- **Never `npm test` or `npm run build`** — they delete
  `docs/field-notes/published/2026-08-01-sample-loop.json`
  ([#343](https://github.com/taihartman/obsidian-atoms/issues/343)). Use `npx vitest run`.
- **Vault lane: `test vault` only.** Never `~/Documents/Remote Vault`.
- **No AI attribution** in commits, PR bodies, or review replies.
- Cross-model peer is **grok**, via the gitignored `.compound-engineering/config.local.yaml`.
  Recreate it if missing.
- You are working in the **main checkout**, not a sibling worktree — the branch is already checked
  out there and moving it would be a disruptive, unasked-for change. That is intentional.

## Open questions / blockers

- **Flip the default, or set the env var?** `plus-service/test/ask-expand-guardrails.test.mjs`
  deliberately pins `askExpandEnabled` off-by-default, which reads as "this should never be on
  unless an operator says so." Flipping the config default contradicts that test's intent; setting
  `ASK_EXPAND_ENABLED=1` on Fly honors it and keeps self-hosters off by default. STATUS.md and the
  #360 handoff both say "flip the default", but neither was written with the guardrail test in view.
  **Ask the owner before changing that test** — weakening a guardrail to make your own change pass
  is exactly the move code review should catch.
- **Server deploy is a separate act.** Expansion does nothing in production until `plus-service`
  ships to Fly, regardless of which answer you pick above. Egress is double-gated on
  `config.anthropicApiKey` (`expandSearch.mjs:104`), so a deploy without that key is inert.
- **Every existing user re-prompts for both Ask consents** the moment 0.6.87 reaches them. Worth
  saying out loud in the PR body — it is correct behavior, but it is a visible user event.

## Git state

- Branch `feat/339-ask-search-recall-honesty` (base `master`), pushed to `origin`, upstream set.
- Last real commit: `fb1997a fix(ask): Sync stops waiting on expansion, and expansion stops advertising itself`
- Handoff commit: `8202dc6` — `docs(handoff): #340 four-step path to green`
- No WIP snapshot was needed — the tracked tree was already clean.
- Diff since base: 28 files, +1663/-52 (`git diff --stat origin/master...HEAD`).

## How to resume

Check out the work exactly here — this is your branch and directory:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
git fetch origin && git switch feat/339-ask-search-recall-honesty && git pull --ff-only
npm install
npx vitest run
```

Then continue from **Next steps** above, starting with the merge in step 1.
