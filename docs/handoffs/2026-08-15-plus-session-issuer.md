---
handoff_date: 2026-08-16
branch: claude/plus-session-issuer
worktree: /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/508
pr: https://github.com/taihartman/obsidian-atoms/pull/526
status: in-progress
units_done: U1-U7, plus simplify, code-review, compound
units_left: two known regressions at head, one product decision, QA, PR body
---

# Handoff — #508: a Plus session records the base that issued it

Read this top to bottom, run **How to resume**, then start at **Next steps**. The design is settled
and implemented. What remains is **two defects introduced and not fixed**, one product decision, and
the QA half of the shipping tail.

**The plan is the authority:
[`docs/plans/2026-08-15-001-fix-plus-session-issuer-plan.md`](../plans/2026-08-15-001-fix-plus-session-issuer-plan.md).**
Its Corrections, Traps and KTD sections are all still live.

## Read this first: head contains two known regressions

Both in `src/platform/plusRefresh.ts`, both introduced on 2026-08-15 while fixing a P0, both found
afterwards by the cross-model adversarial pass. **The code is committed and pushed in this state.**
Fix them before anything else.

### R1 (P1) — the refusal offers a sign-in link to the host it just refused

`plusRefresh.ts:148`. The P0 fix made a differing-email 2xx a `kind: "rejected"` record.
`plusRefreshPresentation` renders `rejected` as **"Sign-in needed"** with a **Send me a sign-in link**
CTA. That magic link is requested against the current `plusBaseUrl` — the same possibly-rogue base
that just failed the check. Completing it runs `installPlusSession`, which stamps that host as the
issuer, after which classify and the mirror send note text there. **The issuer gate never runs on
that path**, and [#529](https://github.com/taihartman/obsidian-atoms/issues/529)'s challenge and
trust-gesture options would not cover it.

**Fix:** record the differing-email case as `kind: "failed"` with `PLUS_BASE_REFUSED_MESSAGE`, the
same shape as an unreachable check, so no magic-link CTA is offered. The reasoning: a live session
that named a *different* account is a base problem, not an expired session, so sign-in is the wrong
remedy.

**Test at the presentation layer, not only the record layer** — the bug is that a defensible record
kind renders a dangerous CTA, so assert `plusRefreshPresentation(record).recovery` is `null`.

### R2 (P2) — a concurrent refresh erases a just-landed stamp

`plusRefresh.ts:159`. `refreshPlusEntitlementRecord` spreads the `session` **argument**, captured
before its own `await`. `persistVerifiedBase` re-reads from disk and compares tokens precisely to
avoid this; the refresh does not. So a first-time probe can land `verifiedBase`, then a concurrent
refresh (period-end load, checkout poll, backfill meter, Settings → Refresh status) writes the
pre-stamp snapshot back over it.

That is exactly the upgrade recovery path: type a URL, Process stamps, refresh clobbers. If the user
then clears the field — Advanced tells them empty means production — the next content call hits the
KTD1 carve-out and Plus stays refused.

**Fix:** after `getEntitlement` returns ok, re-read the stored session. If it is missing or its
`sessionToken` differs, write nothing. Otherwise spread the **disk** session and overlay only
`status`, `remaining`, `periodEnd`, `plan`, `refreshedAt`, keeping `email` from disk per the P0 fix.
Same re-read-and-compare `persistVerifiedBase` already uses.

## Then a product decision that is not the agent's to make

### D1 (P1) — the upgrade cohort is refused with no recovery on the screen we point them at

Every session already on disk is unstamped, and hosted users keep `plusBaseUrl` empty. So the first
Process, Preview, Update, auto-run, mirror push and outbox ack after this ships **all refuse, for
every existing user**. KTD1 accepted that cost. What was not considered: the Notice sends them to
Account, and Account shows neither the state nor a confirm action. Recovery means finding
**Advanced** — the screen labelled for settings almost nobody needs — and typing the URL that is
already the implicit default.

The needs-address state currently renders only in the Advanced row's inline error region
(`settings.ts`, the `syncPlusBaseUrlError` closure).

Reviewer's proposal: render `plusAddressStateMessage` on the **Account** screen with a primary action
that writes `DEFAULT_PLUS_BASE_URL` into `plusBaseUrl`. The next content call then has a non-empty
field, probes, and stamps. Explicitly **do not** mint a stamp from an ungated refresh — that path
already talks to whatever empty resolves to, which is the leak.

This is new UI, so it needs a scope decision: fold into #508, or ship and file. **Ask the user.** If
it ships separately, #508's release note must say the first Process after upgrade will refuse until
the address is confirmed.

## What is done

| Unit | Commit | What landed |
|---|---|---|
| U1 | `4513adb` | `issuedBase` (immutable, branded) + `verifiedBase` on `PlusSession`; all three allowlists; `normalizePlusBase` / `plusBaseMatches` / `issuedBaseFromResponse` |
| U2 | `7105839` | `installPlusSession(host, session, issuedBase)` required third arg; all four acquisition paths stamp |
| U3 | `57cae42` | `src/platform/plusBaseVerify.ts` — verified / refused / unreachable, the email predicate, the KTD1 carve-out, re-stamp via `writePlusSession` |
| U4 | `4e0c989` | `resolveClassifyAuth` async + gated with a required injected verifier; `unverified_base`; `ClassifyDeps.plus.verifiedBase` and the `classify.ts` egress backstop |
| U5 | `313125d` | Mirror config + outbox ack gated; `PlusMirrorConfig` + per-call backstops; Connect destination gated |
| U6+U7 | `d3401a9` | Docs rewritten; version `0.8.0-beta.7`; `test/plusSenderInventory.test.ts` |
| KTD1 state | `767e867` | Settings needs-address state in the Advanced row |
| simplify | `5baf02d` | One `plusSessionStamp` rule; per-pass verdict memo |
| review fix | `2d9961e` | `askOutboxAck` gets the egress backstop its siblings have |
| review round | `9e5a390` | Nine findings incl. the P0, the census, the Notice placement |
| compound | `62b6f29` | Two solution docs + CONCEPTS.md vocabulary |

`npm run build && npm test && npm run lint` green at every commit. **2030 tests** at head.

**Every guard is neuter-verified** — broken, watched go red, restored. Do the same for R1 and R2.

## Next steps

1. **Fix R1 and R2**, each with a regression test, each neuter-verified.
2. **Resolve D1** with the user; do not let it ship silently.
3. **`world-class-qa`**, ending in **`adversarial-qa`** per its hard gate. None of it has run. Reuse
   the #500 fetch recorder that blocks real egress. Read `docs/qa/learnings.md` first, especially the
   CDP focus-emulation note: an unfocused Obsidian window fires no `focus`/`blur` events at all.
4. **PR body** on [#526](https://github.com/taihartman/obsidian-atoms/pull/526) per `CLAUDE.md`:
   `Closes #508`, Core user stories, Edge cases & testing, real Test plan checkboxes, and vault
   screenshots committed under `docs/qa/screenshots/` linked with **absolute**
   `raw.githubusercontent.com` URLs.

## What deliberately did not ship — say this in the PR

- **The token half of the leak.** The content-free base resolutions still send the session token to
  whatever base resolves, and so does the `/v1/me` probe, because a check cannot verify the host it is
  asking.
- **The email predicate is a bar raise, not host authentication.** An address is not a secret, so a
  targeted host that knows it can echo it back and be stamped. Tracked as
  [#529](https://github.com/taihartman/obsidian-atoms/issues/529). The code comment and solution doc
  both state this limit; do not let the PR imply more.
- **`sendPlusMagicLink`** carries the vault name and is not gated: there is no session at magic-link
  time, so nothing to compare a base against.
- **The resolver still falls back.** Six consumers are gated instead. Worth its own issue.

## Decisions taken during implementation, beyond the plan

- **No verdict memo outside a catch-up pass.** Every other entry point asks once per run already, and
  a longer-lived memo would leave a briefly unreachable host refused until reload. Inside
  `runCatchUpPass` the memo is created and cleared with the pass, because its three stages each ask.
- **The memo is keyed on a token fingerprint**, not just email + base: a verdict certifies a session,
  and a sign-out/sign-in mid-pass produces two tokens under one email.
- **A failed stamp write is a refusal**, not a verified verdict — the TOCTOU guard must protect the
  send decision, not only the file.
- **The Connect destination compares, it does not probe.** A render must not egress.
- **The Settings state shows only the needs-address case**, not a mismatch: a mismatch is unsettled
  and the next push may re-stamp.
- **`PLUS_BASE_REFUSED_MESSAGE` lives in `plusClient`**, re-exported from `plusBaseVerify`, because
  the request layer returns it and the other direction is a cycle.

## Traps that already bit, or will

- **Three allowlists between disk and the gate**, plus a fourth shape in `ClassifyAuthOk`. A field on
  the type but missing from one reads as `undefined` at the gate, which is fail-open.
- **`tsconfig.test.json` typechecks only a named list.** A type-level assertion in an unlisted file is
  inert. Add any file carrying one in the same unit.
- **An assignability assertion cannot pin an optional field.** Assert on `keyof`. See
  `docs/solutions/best-practices/three-ways-a-test-you-just-wrote-asserts-nothing.md`.
- **`Object.create(Prototype)` skips class fields**, so a dependency held as a class field is
  `undefined` in tests built that way. `backfillEntry.test.ts` does exactly this.
- **A fixture updated to satisfy a new required field can make the new check trivially true.** Add the
  failing case in the same change.
- **No em dashes in any string, template or regex literal under `src/**`.** Comments are exempt.
- **Test at the level that proves nothing left the device**: `expect(request).not.toHaveBeenCalled()`.
- **The throwaway QA vault is shared** and lives in the **main checkout**, not this worktree;
  `scripts/install-to-vault.sh` resolves it and takes a worktree lock (exit 3 if held). Still grep the
  installed `main.js` for a branch-introduced string before and after every capture batch.
- **Reading `plus.sqlite` or service logs to complete a magic link is credential extraction.** Do not.

## Cross-model peer config changed on 2026-08-15 (machine-wide, affects every repo)

User-directed: the peer runs **grok-4.6 at medium effort**.

- **Model** — `CROSS_MODEL_MODEL_OVERRIDE_TARGET=grok` + `CROSS_MODEL_MODEL_OVERRIDE=grok-4.6` in
  `~/.claude/settings.json` → `env`. Survives plugin updates.
- **Effort** — no env knob exists; it is hardcoded in each worker, so it was patched into the plugin
  cache. **A plugin update reverts this half silently.** Re-apply with
  `python3 ~/.claude/bin/ce-cross-model-tier.py`, verify with `--check` (exit 1 on drift). Documented
  in `~/.claude/CLAUDE.md`.

**One medium run has been attempted and it returned nothing** — it hit grok's 600s hard bound, and
`--json-schema` buffers, so a killed run yields literally zero. The 4.6-**high** run on the same brief
finished in ~470s with the three findings above. One data point, not a verdict; if peer output looks
thin, medium is the first thing to suspect.

**Do not edit a plugin script while a peer job is running.** Bash reads scripts incrementally, so a
running job died with a syntax error mid-file. Its findings had already been written, which is the
only reason they survived.

## Git state

- Branch `claude/plus-session-issuer`, base `master` at `f544110`, tracking
  `origin/claude/plus-session-issuer`. Working tree clean, everything pushed.
- Draft PR [#526](https://github.com/taihartman/obsidian-atoms/pull/526), `Closes #508`. Body not
  written.
- `STATUS.md` row is claimed and current.
- **Last commit before this doc: `62b6f29`.** (This section cannot pin the head SHA: the commit
  carrying this doc cannot state its own hash.)
- Version `0.8.0-beta.7`. Already bumped; R1 adds user-visible surface, so bump again only if you
  ship R1 as its own release.
- You are in a **linked worktree**. Reuse it; do not create another.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/mystifying-hellman-4e183c
git fetch origin && git switch claude/plus-session-issuer && git pull --ff-only
npm run build && npm test && npm run lint
```

Then fix R1 and R2, raise D1 with the user, and run the QA half.
