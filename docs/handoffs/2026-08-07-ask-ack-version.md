---
handoff_date: 2026-08-07
branch: claude/ask-ack-version
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-ask-ack-version
base: master
tracking: none yet — you file the issue (see Next steps 1). Blocks https://github.com/taihartman/obsidian-atoms/pull/340
status: in-progress
---

# Handoff — the Ask consent acks need a version, not just a timestamp

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize
this doc back to them; just begin, and report what you did. Everything you need is below.

> **Do not run `npm test`.** Its `pretest` hook deletes
> `docs/field-notes/published/2026-08-01-sample-loop.json`
> ([#343](https://github.com/taihartman/obsidian-atoms/issues/343)). Use `npx vitest run`. **`npm run
> build` deletes it too** — the `build:www` step does, so #343 is wider than it is written. Restore
> with `git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json` before staging.

> **Root `npx vitest run` contains zero `plus-service` files.** A green root run says nothing about
> server changes. `plus-service` has its own suite (`cd plus-service && npm test`, ~508 tests / 112
> suites). This task is plugin-side, so the root suite is the one that matters — but know the gap.

## Goal

`askPrivacyAckAt` and `askWriteAckAt` record **when** the user agreed, never **what** they agreed to.
Both are bare ISO timestamps, and every read is a truthiness check. So when a disclosure is reworded,
every existing device keeps a non-empty timestamp, still reads as granted, and is never re-prompted —
it is now consenting to text it has not seen.

The repo already solved this once for the other ack. `EGRESS_ACK_VERSION`
(`src/platform/autorun.ts:29`) is a dated string; accepting stores **the version, not `true`**, and
`egressAckIsCurrent` compares stored against shipped. Its doc-comment is the whole idea: *"Acked
against the disclosure this build actually shows. Anything else is not consent."* Bump the constant
and every device re-prompts. `src/settings/consent.ts:20` carries the standing reminder to bump it.

Give the two Ask acks the same lever.

## Why now — this is blocking a real merge

[PR #340](https://github.com/taihartman/obsidian-atoms/pull/340) (Ask `search_atoms` recall) adds
`plus-service/src/ask/expandSearch.mjs`, which sends **title, tags and up to 4000 characters of body
plaintext** to Anthropic on mirror upsert. That is the first Ask path sending body plaintext to a
third party — classify is titles-only.

Its author correctly amended `ASK_PRIVACY_DISCLOSURE` to name that egress (six clauses to seven).
**That amendment is on master now** (`consent.ts:27-28` — clause 4 mentions search-expansion
phrases). But an amended string alone changes nothing for anyone who already acked, because there is
no version to invalidate the old grant.

So `ASK_EXPAND_ENABLED` was defaulted to `"0"` on that branch rather than shipping the feature to
devices holding a stale grant. **Your work is what lets that flag flip back to `"1"`.** Say so in
the PR body.

## Current status

**Nothing is implemented.** This branch is cut clean from `origin/master` at `7e1a2be` and holds only
this doc.

What is already true and you must not redo:

- The disclosure text is already correct on master. Do **not** reword it.
- The scope is measured, not guessed — see the counts below.
- The design decision is made — see Decisions.

## The shape to build (decided — do not redesign)

**Add a version field beside the timestamp. Do not repurpose the timestamp.**

```
askPrivacyAckAt: string       // keep, unchanged — when
askPrivacyAckVersion: string  // new — what
```

A legacy grant has `askPrivacyAckVersion === ""`, which reads as stale through the same path a
mismatched version does, and re-prompts. **This is why there is no migration to invent** and why the
existing field never changes meaning. Repurposing the timestamp was considered and rejected: it
forces a migration mapping and silently changes what ~45 existing test fixtures assert.

Mirror `autorun.ts`'s shape rather than inventing one:

- `ASK_PRIVACY_ACK_VERSION` / `ASK_WRITE_ACK_VERSION` constants, dated strings like `"2026-08-07"`.
- An `askAckIsCurrent(acked, shipped)` predicate mirroring `egressAckIsCurrent`
  (`src/platform/autorun.ts:107-113`, six lines) — empty or mismatched is **not** consent.
- Route every read through it.
- Accepting writes the version; withdrawing clears it, exactly as `writeEgressAck` does
  (`autorun.ts:137-143`).

Do **both** acks in one pass. `askWriteAckAt` has the identical blind spot and doing it now costs
almost nothing extra.

## Scope — measured, not estimated

**Production: 12 call sites for `askPrivacyAckAt`** across four files. Most are the same shape,
`Boolean(this.plugin.settings.askPrivacyAckAt)`, and each becomes `askAckIsCurrent(...)`:

| File | Sites |
|---|---|
| `src/settings/settings.ts` | 8 — `:573`, `:2093`, `:2096`, `:2099`, `:2150`, `:2165`, `:2177`, `:2207` |
| `src/shared/types.ts` | 2 — `:167` (field), `:200` (default) |
| `src/plugin/askCoordinator.ts` | 1 — `:118`, the gate: `askEnabled && Boolean(askPrivacyAckAt)` |
| `src/plugin/main.ts` | 2 — `:1488`, `:1497`, the cross-device revoke path |

`askWriteAckAt` is ~30 references across the same files plus tests.

**Tests: ~45 references**, concentrated in `test/settings.test.ts`, `test/askConsentCrossDevice.test.ts`,
`test/askCoordinator.test.ts`, `test/settingsRows.test.ts`. Most flow through shared fixture constants
(`ACKED`, `GRANTED`), so the churn is a handful of constant definitions plus **new** assertions for
the stale-version case — not 45 hand edits.

This is roughly an hour of work. It was mis-sized as "design work" earlier in the conversation that
produced this doc; that was wrong, and the correction is why this branch exists.

## Next steps

1. **Claim it** per [`docs/collab.md`](../collab.md) — hard claim before implementation. File a GitHub
   Issue (assign `taihartman`), add a `STATUS.md` row, open a **draft PR**. Name #340 as the thing it
   unblocks. Master's `STATUS.md` currently has two/three in-flight rows; add yours above them.
2. **Read the three files that define the existing pattern** before writing anything:
   `src/platform/autorun.ts` (the model — `EGRESS_ACK_VERSION`, `egressAckIsCurrent`,
   `writeEgressAck`), `src/settings/consent.ts` (the disclosures and the bump reminder at `:20`), and
   `src/plugin/main.ts:1480-1500` (the revoke path, which must clear versions too).
3. **Implement**, both acks in one pass, per the shape above.
4. **Tests — this is a consent surface, so they must be real.** At minimum: a legacy grant (timestamp
   set, version empty) reads as **not** current; a matching version reads as current; a mismatched
   version reads as **not** current; accepting stores the shipped version; withdrawing clears it; and
   the cross-device revoke in `main.ts` clears the version alongside the timestamp. A test that
   cannot fail is worse than none here.
5. **Shipping tail, in full**, per `CLAUDE.md`: `ce-simplify-code` → `ce-code-review` (cross-model
   peer is **grok**, not codex) → `ce-compound` → `world-class-qa` ending in its `adversarial-qa`
   gate → PR with `Closes #<n>`, core user stories, edge-case table, and phone screenshots under
   `docs/qa/screenshots/<feature>/` linked by **absolute** `raw.githubusercontent.com` URLs.
6. **Then, separately:** flip `ASK_EXPAND_ENABLED` back to `"1"` in
   `plus-service/src/config.mjs` — one line, on #340 or a follow-up. The comment at that flag names
   this work as its precondition. Do not do it in the same PR unless the user asks.

## Key files

- `src/platform/autorun.ts:29` — `EGRESS_ACK_VERSION`, the constant to copy.
- `src/platform/autorun.ts:107-113` — `egressAckIsCurrent`, the predicate to mirror.
- `src/platform/autorun.ts:137-143` — `writeEgressAck`, the accept/withdraw shape to mirror. Its
  comment explains why withdrawing stores `false` rather than deleting.
- `src/settings/consent.ts:20` — the standing "changing this means bumping the version" reminder.
  Add its twin for the Ask acks.
- `src/settings/consent.ts:27-28` — `ASK_PRIVACY_DISCLOSURE`, already correct at seven clauses.
- `src/shared/types.ts:167,172` — the two bare timestamps; `:200-201` their defaults.
- `src/plugin/askCoordinator.ts:118` — the gate that decides whether Ask may egress at all.
- `src/plugin/main.ts:1488-1497` — cross-device revoke; must clear the new version fields too.
- `test/askConsentCrossDevice.test.ts` — the closest existing test to what you are adding; its header
  comment names the three places the grant is checked.

## Decisions & constraints

Do **not** relitigate these:

- **Add a version field; do not repurpose the timestamp.** Rationale above.
- **Do not reword any disclosure.** The text on master is already correct. This task is the
  *mechanism*, not the copy.
- **Both acks in one pass** — privacy and write.
- **Empty version reads as not-consented.** That is the whole point: it is what makes legacy grants
  re-prompt without a migration.
- **`ASK_EXPAND_ENABLED` stays `"0"` until this ships.** Do not flip it as part of this PR.
- **No AI attribution** in commits, PR bodies, or review replies.
- **Vault lane: `test vault` only** —
  `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault`, which lives in the **main
  checkout**, not this worktree. Pin CLI calls with `vault="test vault"` and assert
  `app.vault.getName() === "test vault"` before measuring or writing. Install with
  `./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"`.
- **Version bump** — user-visible consent behaviour changes, so bump `manifest.json`,
  `package.json`, `versions.json`. Master is at **0.6.85**; check before choosing, since other
  branches may have taken the next patch.

## Open questions / blockers

- **What date string for the initial version?** `EGRESS_ACK_VERSION` is `"2026-08-06"`. Use the date
  the Ask disclosure last actually changed rather than today's, if you can establish it from
  `git log src/settings/consent.ts` — the version should name the wording it corresponds to.
- **Does re-prompting on upgrade need a UI beat?** Today a stale ack silently gates the feature off.
  Consider whether the Ask destination should say *why* it went dark, rather than just appearing
  un-acked. This is a product call — raise it with the user rather than inventing copy.
- Not a blocker: `askWriteAckAt`'s disclosure has not changed, so its version starts current for
  everyone. It is being versioned pre-emptively.

## Git state

- Branch `claude/ask-ack-version` (base `master`), pushed to `origin`.
- Base: `7e1a2be Merge pull request #359 from taihartman/chore/status-clear-357`
- WIP snapshot commit: `1afa2b2` — `wip: handoff snapshot — ask-ack-version`
- Diff since base: 1 file (this doc).

## Driving Obsidian — facts already paid for

Only if step 5's QA needs them:

- **Desktop Settings opens in a separate popout window** in 1.13.4. `document.querySelector(".modal")`
  in the main window finds nothing — go through `app.setting.modalEl.ownerDocument`.
- **On phone there is no popout:** the settings tab *is* a `.modal-container .modal`, so a sheet
  opened from it is the **second** modal. Select with
  `[...doc.querySelectorAll(".modal-container .modal")].find((m) => m !== app.setting.modalEl)`.
- **Reaching `is-phone`:** `emulateMobile(true)` at desktop width gives **`is-tablet`**. Do
  `emulateMobile(true)`, wait ~6s for the reload, then `require("@electron/remote").getCurrentWindow()`
  → `unmaximize()` → `setSize(390, 844)`, and assert `document.body.classList.contains("is-phone")`.
- **Measure geometry a beat after `app.setting.open()`** — same-call rects are pre-layout and lie.
- **`dev:screenshot` captures the main window only**; its `path=` is vault-relative.
- The **running** app's `app.css` is at `~/Library/Application Support/obsidian/obsidian-1.13.4.asar`
  — the one under `/Applications` is a stale installer. Read the former to settle any "what does
  Obsidian's own CSS do" question.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-ask-ack-version
git fetch origin && git switch claude/ask-ack-version && git pull --ff-only
npm install
npm run build && npx vitest run
git checkout -- docs/field-notes/published/2026-08-01-sample-loop.json
```

Then start at **Next steps 1**.
