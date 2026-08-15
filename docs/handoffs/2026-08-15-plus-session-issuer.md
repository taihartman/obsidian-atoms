---
handoff_date: 2026-08-15
branch: claude/plus-session-issuer
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/508
status: in-progress
---

# Handoff — #508: a cleared Plus service URL sends a self-host session token and capture text to production

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then **start executing Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Close [#508](https://github.com/taihartman/obsidian-atoms/issues/508). Today, a user signed in to their **own** Plus server who clears the `Plus service URL` field silently starts sending their session token **and their verbatim capture text** to `plus.tryatoms.app`. Self-hosting exists precisely so note text never reaches the hosted service, so this reverses the one promise that feature makes, with no warning and no visible failure.

## Current status

Nothing is implemented yet. This branch is a clean cut of `master` carrying only this doc. What exists is a proven bug, a converged design, and one decision you need from the user.

**The bug is proven, not theorised.** From the #500 adversarial pass, using a `window.fetch` recorder that blocked real egress so "no call" and "call to the wrong host" were distinguishable:

```
{"url":"https://plus.tryatoms.app/v1/me","auth":"Bearer qa-token"}
{"url":"https://plus.tryatoms.app/v1/classify","auth":"Bearer qa-token",
 "body":"{\"capture\":\"unmarked observation 110 that should still process\",…"}
```

Five classify calls carried capture bodies plus the vault title list. On screen the user saw only `Couldn't reach Atoms Plus — check your connection and try again.` Screenshots: `docs/qa/screenshots/500-plus-base-url-guard/adversarial-B1-selfhost-token-to-production.png` and `adversarial-B1-cleared-field-no-warning.png`.

**Cause.** ~20 call sites across 5 files resolve the base as `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL`. Empty has always meant production. #500 added a guard that refuses *invalid* values and deliberately does **not** fall back to the hosted default — its own comment says a self-host token does not belong at `plus.tryatoms.app`. That reasoning covers every input class except the one that is not invalid at all: **absent**. Clearing a field is also a far likelier user action than typing something malformed.

**What already shipped** (all merged, do not redo):
- #500 / PR #502 — the scheme guard itself (`isAllowedPlusBaseUrl`), on four egress paths.
- #505 / PR #513 — the field commits on blur, not per keystroke (`0.8.0-beta.5`).
- #504 / PR #520 — service-returned billing URLs are scheme-checked before `window.open` (`0.8.0-beta.6`).
- `src/platform/plusClient.ts` already carries a comment stating this gap honestly and pointing at #508. `docs/ask-self-host.md` carries a user-facing warning. **Both must be removed or rewritten when you land the fix** — leaving them would make the docs lie in the other direction.

## Next steps

1. **Get the blocking decision from the user first — this is step 1 and everything else depends on it.** See **Open questions** below. Ask it plainly, with the two options and their costs. Do not pick one yourself; it changes what every existing installed device does on upgrade.
2. **Hard claim before any code**, per `docs/collab.md`: the Issue (#508) already exists and is assigned — add a `STATUS.md` row and open a **draft** PR, then implement. `STATUS.md` on master currently reads `_Nothing in flight._`.
3. **Write a plan under `docs/plans/`** and run at least a light `ce-doc-review` on it before implementing. This is a security/auth surface, so per `CLAUDE.md`'s lane rules it is the **full lane**, not an amend — do not shortcut it because the diff looks small.
4. Implement the two halves described in **Decisions & constraints**: record the issuing base on the session, then gate content-bearing egress behind a content-free re-verification when the base changes.
5. Ship the tail: `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa` (which ends in `adversarial-qa`). The QA notes below will save you real time.

## Key files

- `src/platform/filingAuth.ts:18` — `PlusSession` type. This is where the issuing-base field goes. Note it has no such field today, which is the whole problem.
- `src/platform/plusSessionInstall.ts:24` — `installPlusSession`, the **single install boundary** (built for #320/#372). Sessions from magic link, paste, and trial all funnel here. This is the natural stamp point.
- `src/platform/plusRefresh.ts:120` — a second `writePlusSession` caller. Do not miss it; a refresh must not blank the issuer.
- `src/platform/plusClient.ts` — `isAllowedPlusBaseUrl`, `PLUS_BASE_URL_INVALID_MESSAGE`, `plusRequest` (the guard choke point), and the honest-gap comment that must be updated when this lands.
- `src/platform/classifyAuth.ts` — `resolveClassifyAuth`, which resolves and snapshots the base once per run.
- `src/pipeline/classify.ts` — the one Plus path that builds its own request and carries the **capture body**. The highest-value thing to gate.
- `src/settings/settings.ts` — 14 of the ~20 base resolutions live here, plus `savePastedSession`, which builds its own `requestUrl` call.
- `docs/solutions/security/a-guard-needs-two-inventories-send-sites-and-input-classes.md` — the learning from #500. Read it; it is about this exact failure mode and will stop you repeating it.
- `docs/solutions/security/consent-gate-must-be-checked-at-egress-not-at-entry.md` — prior art on gate placement in this repo.

## Decisions & constraints

**Do not relitigate these. They were settled this session with reasons.**

- **The design is two halves.** (a) `PlusSession` records the base that issued it, stamped at `installPlusSession`. (b) When the resolved base differs from the session's issuer, mark the session *unverified at this base* and block **content-bearing** calls (classify, mirror push) until a **content-free** `/v1/me` confirms it. `/v1/me` sends the bare token and nothing else, so the worst case is a token to a host the user configured, never note text.
- **Stamp on first successful call, not at migration.** A 2xx from a base with that token is proof that base accepts it. Stamping at migration time from whatever base happens to be configured is a *guess*, and it is wrong precisely for the user who already cleared the field — you would stamp "production" onto a self-host token and bless the exact state you are trying to catch.
- **REJECTED: dropping the session whenever the base changes.** `docs/ask-self-host.md` tells self-hosters to run `cloudflared tunnel --url`, and quick tunnels mint a **fresh random subdomain on every start**. Same server, different URL, routinely. That design would sign out exactly the people the guard protects, on every rotation. Do not resurrect it.
- **REJECTED: a confirm dialog on clear.** It cannot tell a self-host session from a production one, so it would interrupt users for whom clearing is harmless — and it cannot reach a base arriving from Obsidian Sync rather than from someone typing. The dialog would be standing in for information the plugin should just have, which is what (a) fixes.
- **`https` on any host stays allowed.** That is deliberate — self-hosters need arbitrary HTTPS. This work does not narrow it.
- **Watch the Sync coupling.** `plusBaseUrl` is synced (it is in `data.json`); session state is device-local. So any rule keyed on "the base changed" also fires on **remote** changes via `onExternalSettingsChange` (`src/plugin/main.ts`, ~line 2267). Note its generation-mismatch branch returns early after `adoptExternalWithdrawal` and never reaches the normal apply path — do not hang security behaviour off that hook without accounting for it. Related open issue: [#394](https://github.com/taihartman/obsidian-atoms/issues/394).
- **Repo conventions that will bite you:** no em dashes in product-authored copy (`test/copyVoice.test.ts` enforces it plugin-wide over string/template/regex literals; comments are exempt) — this failed CI on me once. Bump `manifest.json` + `package.json` + `versions.json` together; master is on the `0.8.0-beta.N` line, so use the next beta. Never log tokens, headers or bodies.
- **Test at the level that proves nothing left the device.** `expect(request).not.toHaveBeenCalled()` is the assertion; a returned error object only proves a branch was chosen. Then neuter each guard and confirm the test fails — two #500 tests passed against a broken guard until that was checked.

## Open questions / blockers

**BLOCKING — ask the user before writing code.** Existing sessions on real devices carry no issuing base. What does `undefined` mean?

- **Treat unknown as production.** Nobody is signed out; compatible. But it leaves the hole open for exactly the self-hosters this protects, until they happen to re-sign-in.
- **Treat unknown as a mismatch.** Closes it completely, but signs every existing user out once, on upgrade.

There may be a third path worth putting to them: treat unknown as *unverified* rather than as either — no sign-out, but content-bearing calls wait for one `/v1/me` before the first classify. That gets compatibility and safety at the cost of one extra round trip on first use after upgrade. It is untested reasoning, not a settled decision.

**Also unresolved, lower stakes:** `savePastedSession` (`src/settings/settings.ts`) has the identical `|| DEFAULT_PLUS_BASE_URL` shape and very likely sends a pasted self-host token to production too. It was **never executed** during the #500 pass — that path uses `requestUrl`, outside the fetch recorder, so proving it meant sending a token to real production. Treat as very likely, not proven.

## Git state

- Branch `claude/plus-session-issuer` (base `master`), pushed to `origin`.
- Cut clean from `master` at `36aea09` — no code changes, this doc only.
- Last real commit on base: `36aea09 Merge pull request #521 from taihartman/chore/status-clear-504-505`
- Snapshot commit: `0a0eaa5` — `wip: handoff snapshot — plus-session-issuer`
- Diff since base: 1 file, this document.

## QA notes that will save you an hour

From the #500 and #505 live drives. All of this is in `docs/qa/learnings.md` — read that file before driving anything, but these are the ones that bite hardest here:

- **An unfocused Obsidian window fires no `focus`/`blur` events at all.** Chromium suppresses them when `document.hasFocus()` is false, which it is whenever the CLI drives while another app is frontmost. A blur-triggered feature silently never runs while `document.activeElement` moves normally, so it reads as a product bug. Fix: attach CDP and `Emulation.setFocusEmulationEnabled`. That also unlocks real keystrokes and clicks.
- **The throwaway vault is shared and unlocked.** A peer session's `install-to-vault.sh` can replace your build mid-pass. Assert build identity by grepping the installed `main.js` for a string your branch introduced, before **and after** every capture batch.
- The Plus session fixture is catalogued in `docs/qa/testing-fixtures.md` — reuse it, do not mint another.
- Reading `plus.sqlite` or service logs to complete a magic link is credential extraction. Do not.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
git fetch origin && git switch claude/plus-session-issuer && git pull --ff-only
npm install
npm run build && npm test && npm run lint
```

Then continue from **Next steps** above — starting with the blocking question in **Open questions**.
