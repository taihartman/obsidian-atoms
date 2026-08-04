---
handoff_date: 2026-08-01
branch: fix/mirror-delete-gate-and-outbox-ack
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-qa-mirror-gate
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/226
status: in-progress
---

# Handoff — Fix two P0 holes in the Ask-mirror deletion gate (#225 / PR #226)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

PR #226 adds a guard that refuses to delete cloud-mirror rows when the local vault scan looks
incomplete — it exists because a phone holding 3 of 400 atoms was issuing 397 hard deletes on every
relaunch. QA is finished and the three original fixes work. But the adversarial pass found **two
more doors into the same guard**, both proven with live repros that destroyed 400 cloud rows.

Your job is to close H2 and H1, land the parked regression tests, and get PR #226 out of draft.

## Current status

- **QA is complete — do not re-run it.** `world-class-qa` + `adversarial-qa` both ran. Full report:
  `docs/qa/2026-08-01-fix-mirror-delete-gate-and-outbox-ack-world-class-qa.md`.
- **4 of 6 PR test-plan boxes are checked with real evidence.** The headline claim holds: a delta
  sync with 3 of 491 atoms present issued **zero** deletes, verified by grep over a request log
  (window `19:50:41→19:53:39`: 3 status, 1 upsert correctly pre-gate, 0 delete, 0 reconcile).
- Refusal string renders character-exact on Atoms home *and* the settings status line. Sync now
  names the correct one of four reasons. Ask disabled → 0 mirror requests. `verify.sh` exit 0.
- **The remaining 2 boxes are human-only** (iOS + Android via BRAT — physical device + a GitHub
  Release). You do not cut releases and do not install into personal vaults. Leave them unchecked.
- Working tree is clean; everything is committed and pushed. Suite is green (779 tests) because the
  red repro file is parked outside the vitest glob on purpose.
- **PR #226 is draft and must stay draft until H2 and H1 are fixed.**

## Next steps

1. **Fix H2 first** — `src/plugin/main.ts:1204-1213`. It is the regression *this PR introduces* and
   the more dangerous of the two: it needs no second device and arms on any vault edit.
   `askMirrorForceFollowUp` is consumed at the top of the `do` loop, but a concurrent
   `syncAskMirror({force:true})` re-sets it during the `await` (`:1189-1191`); the `failed` and
   `refused` early returns then exit the loop **without consuming it**, and `finally` clears only
   `askMirrorInFlight`. A later plain `{force:false}` computes `runForce = false || true` → a full
   keepPaths reconcile with no user gesture. Clear the flag in `finally` (or consume it on every
   exit path). The watcher calls `{force:false}` at `main.ts:238, 400, 598, 1511`.
2. **Fix H1** — `src/platform/askMirror.ts:842-845`. `if (decision.allowed || !force) return` means
   `host.status()` is reached *only when the stale stored count already refused*. Refresh on the
   **allow** path too, or stop treating a stored count as sufficient authority to permit deletion.
   The comment directly above that call already admits the stored count "is old by definition on
   exactly the device at risk" — the code just doesn't act on it when it permits.
3. **Land the parked regression tests.** Move
   `docs/qa/repro/2026-08-01-225-mirror-gate-adversarial-repro.test.ts` into `test/` once H1 is
   fixed — 3 of its 39 tests are red on purpose and all three are H1. They must go green.
4. **Write an H2 regression test.** This needs an injectable host around `main.ts` first — nothing
   in the repo imports `main.ts` (`test/mocks/obsidian.ts` stubs `Plugin` as an empty class), which
   is why U1 and U9 both began with an extraction. Follow that same pattern.
5. **Decide F2** (small): `askMirror.ts:849-859` returns before `host.confirm`, so the
   `no-server-count` modal reason can never render. The PR claims the modal "names which threshold
   refused" — true for 3 of 4 as written. Either make it reachable or soften the claim.
6. **Re-run only adversarial classes C (sequences) and D (network)** against the fixes — the rest of
   the ledger is unaffected. Then mark PR #226 ready.

## Key files

- `src/plugin/main.ts:1204-1213` — H2. The `do` loop and the two early returns that skip flag consumption.
- `src/plugin/main.ts:1189-1191` — where a joining forced call sets `askMirrorForceFollowUp`.
- `src/platform/askMirror.ts:842-845` — H1. The `allowed || !force` early return that skips the refresh.
- `src/platform/askMirror.ts:695` — `decideMirrorDeletion`, the pure judge (this part is well tested).
- `src/platform/askMirror.ts:442` — `mirrorCompletenessFloor` = `min(baseline, max(5, ceil(baseline*0.8)))`.
- `src/platform/askMirror.ts:849-859` — F2, the unreachable modal reason.
- `test/askMirror.test.ts:502,673,742` — existing tests that DO pass a present stored count.
- `docs/qa/repro/2026-08-01-225-mirror-gate-adversarial-repro.test.ts` — 39 tests, 3 red on purpose.
- `docs/qa/2026-08-01-fix-mirror-delete-gate-and-outbox-ack-world-class-qa.md` — full QA report.

## Decisions & constraints

- **Do NOT relitigate the QA verdict.** The evidence is gathered and committed. Fix the two holes;
  don't re-drive the four passing stories.
- **Do NOT use `.claude/worktrees/one-132c40`.** It moved to
  `claude/atoms-0-6-61-person-invites-ecc21f` mid-session and another session owns it. Its `main.js`
  and `test_vault/.obsidian/plugins/atoms/` were overwritten from the wrong branch during the QA
  pass — that session should rebuild. Work only in the worktree named in the frontmatter.
- **Port 8787 is another session's `plus-service`.** Do not touch it. Use 8790+.
- The red repro file stays **outside** `test/**/*.test.ts` until H1 is fixed, so the suite stays
  honest. `vitest.config` includes `test/**/*.test.ts`.
- Vault lanes are non-negotiable: throwaway/demo vaults only. Never `~/Documents/Remote Vault`.
  Never cut a GitHub Release unless the user explicitly asks.
- No AI-attribution trailers in commits or PR bodies.

### Setup recipe for Ask-mirror QA (this is the unlock — reuse it)

`plus-service/` is in-repo and `plusBaseUrl` has **zero host validation** (`main.ts:1249`,
`settings/settings.ts:1310`), so you need no cloud account:

```bash
cd plus-service && npm install
DOGFOOD_AUTO_GRANT=1 ATOMS_PLUS_STORE=sqlite ATOMS_PLUS_DATABASE_PATH=./data/qa-plus.sqlite PORT=8790 npm start
curl -sX POST localhost:8790/v1/auth/magic-link -H 'content-type: application/json' -d '{"email":"qa@example.com"}'
# grab the mt_... token from the server console, then:
curl -sX POST localhost:8790/v1/auth/exchange -H 'content-type: application/json' -d '{"token":"mt_..."}'
# write the sess_... value to localStorage key `atoms-plus-session`
```

Put a logging reverse proxy in front of it and point the plugin at the proxy — that is what makes
"zero deletes" a request log rather than a return value you trusted.

### Two environment traps that will burn you

- **`install-to-vault.sh` installs into `<worktree>/test_vault/`, but the Obsidian CLI drives
  whatever vault Obsidian actually has open** — which is `obsidian_plugin/test_vault/test vault`.
  The QA pass spent its first stretch testing a **v0.6.52** plugin while believing 0.6.60 was live.
  **Always confirm `manifestVersion` via `obsidian eval` before trusting any live evidence.**
- **`verify.sh` splits the same way** (filed as F3): its filesystem ground-truth half parses the
  worktree vault while its CLI half drives the open vault — and it still prints OK.
- Obsidian caches manifest versions until app restart, so Settings can show a stale version after
  `plugin:reload`.

## Open questions / blockers

- **F2 is a judgment call** (step 5): make the fourth modal reason reachable, or soften the PR's
  claim. Either is defensible; pick one and say which.
- **iOS/Android boxes cannot be closed by you** — physical device + BRAT + a Release. They stay
  unchecked; the PR can still merge with them open if the user accepts that residual risk, but that
  is the user's call, not yours.
- **Unproven suspicion worth a look while you're in this code:** an outbox entry may ack after a
  pass that made zero network calls (`askMirror.ts:1147-1150`) if `getMarkdownFiles()` hasn't
  indexed the file `applyOutboxItemToVault` just created. Probably unreachable, but it is the R15
  failure this branch exists to close, reached through another door, and nothing guards it.
- There is **no `askMirrorStatus` test at all** (`grep -c askMirrorStatus test/plusClient.test.ts`
  = 0). The bodyless-2xx fix at `plusClient.ts:550` is correct but regression-unprotected.

## Git state

- Branch `fix/mirror-delete-gate-and-outbox-ack` (base `master`), pushed to `origin`.
- Last real commit: `9c41eb1 qa(#225): world-class + adversarial QA evidence for the mirror deletion gate`
- WIP snapshot commit: **none needed** — the working tree was already clean at handoff time; this
  doc is committed on its own.
- Diff since base: 25 files changed, +3841/-333 (`git diff --shortstat origin/master...HEAD`)
- PR #226 conflicts with `master` on `manifest.json`, `package.json`, `versions.json` only —
  version bumps, no code conflict. Resolve when you rebase.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-qa-mirror-gate
git fetch origin && git switch fix/mirror-delete-gate-and-outbox-ack && git pull --ff-only
npm install
npm test          # expect green: 779 passed
npm run build     # tsc -noEmit + esbuild, expect clean
```

Then continue from **Next steps** above, starting with H2.
