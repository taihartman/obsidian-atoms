---
handoff_date: 2026-08-07
branch: claude/ask-ack-version
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-ask-ack-version
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/360 · PR https://github.com/taihartman/obsidian-atoms/pull/361
status: ready-to-merge — awaiting the owner's merge call only
---

# Handoff — #360 is finished and green; all that is left is the merge call

The work is **done**. Implementation, review, QA and the adversarial gate all ran and closed.
[PR #361](https://github.com/taihartman/obsidian-atoms/pull/361) is out of draft, CI is green, and
it merges cleanly. Nothing is half-applied and nothing is uncommitted.

**Do not re-run the loop on this branch.** It has already had `ce-simplify-code`,
`ce-code-review` (six local reviewers + an independent grok pass), `ce-compound`,
`world-class-qa`, and `adversarial-qa`. Re-reviewing it is pure cost.

## Do this first

1. **Get the owner's merge decision.** They asked to wrap up before deciding, so the decision is
   genuinely open — see *The one judgment call* below. Do not merge without it.
2. **On yes:** squash-merge #361, then **clear the `#360` row from `STATUS.md` on master** (its own
   tiny PR, as the repo does it — see the `chore/status-clear-*` branches for the pattern).
3. **Do not cut a Release.** BRAT users get nothing until the owner explicitly asks. Plugin is at
   **0.6.86**.
4. **Do not flip `ASK_EXPAND_ENABLED`.** It stays `"0"`. See *What this unblocks*.

## State — verified 2026-08-07 ~11:45 EDT

| Thing | Value |
|---|---|
| CI | `test` ✅ · `test + build` ✅ |
| Merge state | `MERGEABLE` / `CLEAN`, 0 commits behind master |
| Suite | 1397 passed / 81 files; `tsc --noEmit` and `npm run build` clean |
| Version | 0.6.86 in `manifest.json` / `package.json` / `versions.json` (0.6.85 is taken by #340) |
| Working tree | clean, everything pushed |

## The one judgment call

**Real multi-device Sync was never exercised on hardware.** The entire change is about mixed-version
fleets, and that is the one thing proven by seeding rather than by two physical devices.

What *is* proven: the tests reproduce the exact `data.json` payloads an older build writes (both the
plain-reload path and the F2 race path), and the round-trip mechanism they depend on was verified
against master's own source — `applyLoadedSettings` is `Object.assign({}, DEFAULT_SETTINGS, raw)`
and `saveSettings` is `saveData(this.settings)`, so a pre-#360 build provably carries the unknown
version key back to disk.

What is not: two real devices on different builds syncing a real vault.

**Precedent:** #323 hit this identical wall and the owner merged on an explicit call, with the gap
recorded in the PR Evidence table. See
[`docs/solutions/workflow-issues/a-sync-test-must-outwait-sync-before-it-can-blame-the-code.md`](../solutions/workflow-issues/a-sync-test-must-outwait-sync-before-it-can-blame-the-code.md).
The gap is stated plainly in the QA report's *Not tested* section and left unchecked in the PR test
plan — do not quietly tick it.

## What this unblocks, and the trap in it

[PR #340](https://github.com/taihartman/obsidian-atoms/pull/340) amends `ASK_PRIVACY_DISCLOSURE`
from six clauses to seven to name `expandSearch.mjs`'s body-plaintext egress. **That amendment is on
`feat/339-ask-search-recall-honesty`, not on master** — an earlier draft of the first handoff
claimed otherwise and was wrong; the correction is now in
[`2026-08-07-ask-ack-version.md`](2026-08-07-ask-ack-version.md).

**Merging #361 will turn #340 red, deliberately.** Its build fails on the frozen-wording test until
it does all four of these, in order:

1. land the amended seven-clause `ASK_PRIVACY_DISCLOSURE`;
2. bump `ASK_PRIVACY_ACK_VERSION` in `src/shared/askAck.ts` to that day's date;
3. add the new wording to `FROZEN_ASK_PRIVACY` in `test/askConsentVersion.test.ts` as a **new keyed
   entry** — never edit the existing one, which is the record of what shipped devices agreed to;
4. only then flip `ASK_EXPAND_ENABLED` to `"1"` in `plus-service/src/config.mjs`.

That red build is the guard working, not a breakage. Expect a small conflict in `consent.ts` too —
#361 added a bump-reminder comment directly above the string #340 edits.

Tell whoever picks up #340. The four steps are also written into the first handoff's *Next steps 6*.

## What shipped

- `src/shared/askAck.ts` (new) — the two dated version constants, `askAckIsCurrent`,
  `ackStampIsReal`, `askPrivacyAckIsCurrent` / `askWriteAckIsCurrent`, `askAckStanding`,
  `settleAckRecords`.
- Every gate reads **both halves** — a non-empty, parseable timestamp *and* a matching version.
- `revokePaired` in `main.ts` forces a version to die with its timestamp even when the incoming
  payload omits the key entirely.
- `writePermitted()` on `AskOutboxHost`, asked live before every outbox item.
- The withdrawal rows stay keyed to the **timestamp**, so a stale grant keeps the only surface that
  can revoke it.

Three commits carry it: `e57296a` (feature), `f45f08c` (simplify), `0887f34` (the review P0),
`4f8b09e` (the six adversarial holes).

## Durable artefacts, all committed

- QA report: [`docs/qa/2026-08-07-claude-ask-ack-version-world-class-qa.md`](../qa/2026-08-07-claude-ask-ack-version-world-class-qa.md)
- Screenshots: `docs/qa/screenshots/claude-ask-ack-version/` (12 frames)
- Learning: [`docs/solutions/security/a-versioned-consent-needs-both-halves-in-the-gate.md`](../solutions/security/a-versioned-consent-needs-both-halves-in-the-gate.md)
- Adversarial suite: `test/askAckAdversarial.test.ts` (38 tests)
- Fixture added: `Plus session` in [`docs/qa/testing-fixtures.md`](../qa/testing-fixtures.md)
- Nav map healed (2 rows): [`docs/qa/app-navigation-map.md`](../qa/app-navigation-map.md)

## Follow-ups filed — not this PR's work

| Issue | What |
|---|---|
| [#363](https://github.com/taihartman/obsidian-atoms/issues/363) | A stale ack turns Ask off without saying why — **owner-deferred on purpose**, the craft gap this change introduced |
| [#364](https://github.com/taihartman/obsidian-atoms/issues/364) | Settings header bleed-through + `Review` louder than the controls that grant consent (both pre-existing) |
| [#365](https://github.com/taihartman/obsidian-atoms/issues/365) | Connect destination shows a previous session's cached status after a session swap |
| [#341](https://github.com/taihartman/obsidian-atoms/issues/341) | Shared ack-version helper — now **three** duplicate predicates, not two; commented with the extra asymmetry to carry |

## Constraints that still bind

- **No AI attribution** in commits, PR bodies, or review replies.
- **Vault lane: `test vault` only.** Never `~/Documents/Remote Vault`.
- **Never `npm test` or `npm run build`** without restoring
  `docs/field-notes/published/2026-08-01-sample-loop.json` afterwards ([#343](https://github.com/taihartman/obsidian-atoms/issues/343)).
  Use `npx vitest run`.
- Cross-model peer is **grok**, configured in the gitignored
  `.compound-engineering/config.local.yaml` — recreate it in a fresh clone.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-ask-ack-version
git fetch origin && git switch claude/ask-ack-version && git pull --ff-only
gh pr view 361
```

Then ask the owner the merge question and act on the answer. That is the whole remaining job.
