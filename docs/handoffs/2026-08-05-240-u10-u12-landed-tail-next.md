---
handoff_date: 2026-08-05
branch: feat/240-magic-link-handoff
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/298
status: in-progress
supersedes: docs/handoffs/2026-08-05-240-u9-landed-u10-next.md
---

# Handoff — #240: all 13 units done, two tail steps left

Read this top to bottom, run **How to resume**, then start at **Next steps 1**. Do not re-plan what
is decided here and do not summarise this back to the user — just work.

## Current status

- **13 of 13 units complete.** U10 (confirmation modal) and U12 (QA evidence) landed this session.
- **1062 plugin tests + 473 service tests green.** `npm run build` clean.
- PR [#298](https://github.com/taihartman/obsidian-atoms/pull/298) is **open, draft**, retitled, and
  its body is now real: `Closes #240`, six core user stories, an edge-case table, an evidence table
  with absolute raw-URL screenshots, and a test plan whose boxes match what actually ran.
- Working tree clean; everything pushed to `origin`.
- **Only two things stand between this and non-draft:** `ce-simplify-code`, then `ce-code-review`.

### What landed this session (do not rebuild)

- `src/settings/plusSignInConfirmModal.ts` (new) — confirmation + dismiss-only outcome modal +
  `createSignInStatusSurface`. Mirrors `AskMirrorDeleteConfirmModal`; copy and verdict extracted so
  both are testable without a DOM.
- `src/settings/destructiveButton.ts` (new) — `markDestructive` lifted out of `settings.ts` (KTD9)
  and now used by the mirror-delete confirm too.
- `src/shared/confirm.ts` — added `SignInConfirmRequest` / `SignInConfirmHost`, reusing the existing
  `ConfirmVerdict`.
- `src/platform/plusSignIn.ts` — `completeSignInHandoff` (confirm → exchange → write session → clear
  pending); `SignInStatusSurface` gained `fail` (terminal, must be acknowledged); `openStatus` is now
  **required** so `platform/` builds no UI; `onPeekUsable` is gone, replaced by the host's
  `confirmSignIn`.
- `test/mocks/obsidian.ts` — `Modal.open()`, recursive `createEl` that records rendered text, and a
  `Notice` with `setMessage`/`hide`. This is what makes render-order assertions real.
- Docs: QA report, 8 screenshots, `testing-fixtures.md` device results, 2 `docs/solutions/` entries.

## Next steps

1. **`ce-simplify-code`** over the branch diff, scoped to what this branch wrote. Deliberately left
   for a fresh session — the previous one ended near its context ceiling. Likely candidates I noticed
   but did not act on: `failureMessage`/`PeekFailure` in `plusSignIn.ts` now serve both the peek and
   the exchange and could be named for that; the `harness()` helper in `test/plusSignIn.test.ts` has
   grown three knobs.
2. **`ce-code-review`** on the branch. **Cross-model peer routes to grok**, not codex (broken install
   on this machine). Create `.compound-engineering/config.local.yaml` with `cross_model_peer: grok`
   if it is missing, and give the peer a *narrow* brief — name `src/platform/plusSignIn.ts`,
   `src/settings/plusSignInConfirmModal.ts`, and `plus-service/src/store/shared.mjs` rather than
   letting it explore the whole 40-file diff, or it burns its turn budget reading and returns
   nothing. Fix P0/P1, then tick the two remaining tail boxes in the PR body.
3. **Take PR #298 out of draft** (`gh pr ready 298`) once 1 and 2 are done. The body is otherwise
   complete; only those two checkboxes are open on the agent side.
4. **Do not deploy and do not release.** `fly deploy` of `plus-service` must precede any plugin
   release (KTD11) and the user asks for releases explicitly. The iOS + Android release gate is
   human-only and hard-blocks the release, not the merge.
5. **After merge to `master`:** clear the `STATUS.md` #240 row.

## Verified live, and how (so you do not redo it)

Desktop smoke on **Obsidian 1.13.4** against the throwaway `test vault` and a **local
`plus-service`** — the vault's Plus URL override and session were reset to empty afterwards, and the
local server was stopped. Remote Vault untouched throughout.

To re-run any of it:

```bash
cd plus-service && PORT=8899 PUBLIC_BASE_URL=http://127.0.0.1:8899 node src/server.mjs &
# magic links print to that server's stdout — no Resend key needed in dev
./scripts/install-to-vault.sh "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
```

Then drive the real UI from the CLI (`obsidian vault="test vault" eval 'code=…'`): set
`settings.plusBaseUrl` to the local server, click **Send sign-in link** with an email in the row's
input, take the token from the server log, and `open "obsidian://atoms-signin?token=…&vault=test%20vault"`.

Passed: approve, cancel-then-retry-same-link, refusal with no pending record, **cold open** (Obsidian
fully quit, link launches it), landing page bound vs unbound, and `peek → peek → exchange → replay`
over HTTP with a real PKCE pair.

## Environment traps that cost an hour — read before debugging a dead deep link

1. **Obsidian 1.13+ gates external links.** "Run action from external link?" appears before the
   plugin's handler runs, once per action per app session, not persisted. **Unanswered, it queues
   later URIs**, so attempts 2-4 silently pile up and look like a dead handler. A cold-launch URI was
   not gated.
2. **An unknown `vault=` name wedges the app** until force-restart. Reproduces with a plain
   `obsidian://open?vault=NoSuchVaultXYZ` — upstream, not ours.
3. **Launch Services goes stale after an Obsidian auto-update**: every URI is dropped silently until
   `lsregister -f /Applications/Obsidian.app` plus a restart.
4. `obsidian version` hanging means the app is blocked by a modal, not busy. `osascript` cannot help
   — no assistive access on this machine.

Diagnostic order and the rest are in
[`docs/solutions/documentation-gaps/an-obsidian-uri-that-does-nothing-is-usually-not-your-plugin.md`](../solutions/documentation-gaps/an-obsidian-uri-that-does-nothing-is-usually-not-your-plugin.md).

## Decisions & constraints — do not relitigate

- **Peek, then ask, then spend.** Reversed on review because `exchangeMagic` revokes the account's
  other sessions before minting, which made *cancel* the destructive branch. Cancel is now a
  `return` — zero requests. Rationale committed as
  [`docs/solutions/architecture-patterns/ask-before-you-spend-when-the-server-revokes-first.md`](../solutions/architecture-patterns/ask-before-you-spend-when-the-server-revokes-first.md).
- **The exchange carries the verifier that satisfied *this* flow's peek**, never a fresh read of the
  pending record.
- **A refusal is a modal, not a `Notice`** (R5). Progress lines live in one non-expiring Notice;
  `status.fail` retires it and opens the acknowledgement modal.
- **`verifier_hash` is base64url**, pinned to the RFC 7636 Appendix B vector at both ends. Borrow
  `pkceChallengeS256` only — never `verifyPkce`, whose non-S256 branch is a plaintext compare.
- **Pending verifiers are tried newest-first, advancing only on `refused`** (≤5, peek ceiling 30/min
  per IP).
- **The deep link's `vault=` is attacker-controlled prose** and is never presented as the attested
  requesting vault. Obsidian resolves it for routing before the plugin sees it.
- **Never log the magic token, the verifier, or a session token** (R11).
- **Vault lanes:** agent QA goes to `test_vault/` or `docs/media/demo-vault/` only.

## Still unproven, carried forward honestly

- **Postgres has never run locally** — no docker, no `pg`, `TEST_DATABASE_URL` unset. CI runs that
  arm and fails if the rows skip; it closes at PR time.
- **U13's deliberate mutation never ran** (permission classifier blocks removing a security control).
  U10's did run and passed: dropping the consent gate turns exactly the three consent tests red.
- **`crypto.subtle` on the mobile webview is assumed.**
- **Release gate open:** physical iOS **and** Android, link opened from a mail client's in-app
  browser. Human-only; an agent cannot satisfy it.
- **Copy does not mention Obsidian 1.13's trust prompt** — the landing page says "Open Obsidian" and
  Settings says "Obsidian signs itself in", and on 1.13+ there is one extra tap first. Listed as a
  follow-up in the QA report, not fixed.

## Git state

- Branch `feat/240-magic-link-handoff`, base `master`, pushed.
- Last commits: `docs(solutions): confirm-before-spend ordering + obsidian:// delivery gates`,
  `polish(plus): retire the previous tap's surface + QA evidence (U10, U12)`,
  `feat(plus): confirm before the sign-in exchange, cancel costs nothing (U10)`.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link
git fetch origin && git switch feat/240-magic-link-handoff && git pull --ff-only
npm test                                              # expect 1062 passing
cd plus-service && npm install && npm test && cd ..   # expect 473 passing
```

`npm install` inside `plus-service/` matters in a fresh checkout — without it you get ~20
`ERR_MODULE_NOT_FOUND` failures that look like real breakage and are not.
