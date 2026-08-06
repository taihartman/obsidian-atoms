---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T19:58:00Z"
title: "#240 magic-link — server lane complete, U9/U10/U12 remain"
summary: "Ten of thirteen units are implemented, committed and pushed; the whole plus-service side is done and green, and the three unfinished units are all plugin-side."
keywords: ["plus", "magic-link", "240", "obsidian-uri", "pkce", "ce-work", "u9", "u10", "u12", "implementation"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
resume_focus: "Implement U9, then U10, then U12; dedup hashVerifier into pkceChallengeS256 first"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "feat/240-magic-link-handoff"
head: "3765f12"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
---

# #240 magic-link — server lane complete, U9/U10/U12 remain

Ten of thirteen units are implemented, committed, and **pushed**. The entire `plus-service`
side is done. All three remaining units are plugin-side. Nothing is in flight; the working
tree is clean and both suites are green.

Everything below is on `feat/240-magic-link-handoff` at `3765f12`, which includes a merge of
`master` (17 commits) and a round-3 plan correction pushed by another session.

## State

| Lane | Units | State |
|---|---|---|
| `plus-service` | U1, U2, U3, U4, U5, U6, U13 | **complete** — 473 tests green |
| plugin | U7, U8, U11 | **complete** — 1018 tests green |
| plugin | **U9, U10** | **not started** |
| QA | **U12** | **not started** (depends on U9/U10) |

Commits, oldest first: `ee22148` U1 · `373a51b` U2 · `2906e21` U3 · `26a2910` U7 · `a33e220` U8 ·
`421b197` U4 · `dcb3cff` U5 · `acd6d60` U6 · `a637a17` U11 · `cb8e3ac` U13 · `3765f12` merge.
`90a950a` carries the Definition-of-Done change described below.

Test commands: `cd plus-service && npm test` (473) and `npm test` at the repo root (1018).
**Run `npm install` inside `plus-service/` first in a fresh checkout** — the worktree shipped
without `plus-service/node_modules`, and the symptom is ~20 `ERR_MODULE_NOT_FOUND` failures
that look like real breakage but are not.

## Decisions made this session

**The release gate is now a hard block (user-directed, `90a950a`).** The Definition of Done
previously recorded the physical-device test as "outstanding", which reads as shippable. It now
states that merge may proceed with the gate open but **no BRAT release is cut until a magic link
has been opened from a mail client's in-app browser on a physical iOS device *and* a physical
Android device, both reaching the signed-in state.** Both platforms, not one. The matching
Outstanding Question is struck through and marked answered. Do not relitigate.

**U7 stores pending sign-ins as a bounded newest-first list, not a single object.** The plan's
prose implies one record, but it separately requires an earlier verifier stay reachable so a
double tap of *Send sign-in link* does not strand the first link. A single object cannot satisfy
both. **U9 must read the list newest-first** — see `readPendingSignIns` /
`latestPendingSignIn` in `src/platform/filingAuth.ts`.

**U2's `peekMagic` returns the stored `verifierHash`.** A worker initially withheld it and
asserted at store level that it never appears — which would have blocked U13's design outright.
The plan resolves this in U13 ("one comparison, two callers"), so the store now returns the hash
and the never-on-the-wire assertion lives at U13's HTTP boundary instead.

## Two bugs found that the plan did not list as defects

**A live security hole in the landing page, closed by U5.** A stale `pending` id used to consume
the magic token and then fall through to printing the freshly minted session as HTML. A dead
OAuth link burned the token *and* handed the session to whoever loaded the URL. The fix resolves
the pending record before touching the token. Pinned by the test
"a stale or unknown pending id consumes nothing and renders no session" in
`plus-service/test/http-magic-link-landing.test.mjs`, which peeks afterwards and finds the token
still usable.

**Magic tokens were not being redacted, fixed in U8.** `redact` in `src/platform/plusClient.ts`
carried a generic "strip any opaque run of 43+ characters" rule that looks comprehensive. A real
magic token is `mt_` plus 32 hex — **35 characters** — so it passes straight under that rule.
Verified by executing the server's own `id("mt")`. The dedicated `mt_` rule at
`src/platform/plusClient.ts:148` is therefore load-bearing, not belt-and-braces; without it every
magic token reaches logs in plaintext, violating CLAUDE.md non-negotiable #11. A 32-byte verifier
is exactly 43 characters, so it sits on the generic rule's boundary — the test constant was tuned
to sit there deliberately.

## Do this first — a dedup, not a bug

Another session pushed a **round-3 plan correction** (`a692e2f`, merged here): U1's "Patterns to
follow" told the implementer to reuse the sha256 **hex** helper for `verifier_hash`, which is
wrong — KTD6 has the plugin send base64url, so a hex `verifier_hash` would match nothing and
every bound peek and exchange would be refused, failing closed with no error to read.

**We did not ship that bug.** U4's worker chose base64url deliberately to match
`src/platform/pkce.ts:s256Challenge`. Verified against the RFC 7636 Appendix B vector:
`hashVerifier` and `pkceChallengeS256` both return `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`.

What remains is duplication. `hashVerifier` at `plus-service/src/store/shared.mjs:98` re-derives
a digest that `pkceChallengeS256` (`plus-service/src/store/askHelpers.mjs:44`) already owns, and
the merged plan now says `pkceChallengeS256` is the single home and must be imported, not
re-derived. `STATUS.md`'s #309 row says the same. `plus-service/test/pkce-digest.test.mjs`
(arrived via the master merge) pins its encoding.

**Care required:** `verifyPkce` in that same file carries a non-S256 **plaintext-compare** branch
for OAuth rows. Borrow the digest, never that branch — the #240 comparison is the only thing
standing between a magic link and a session in the wrong vault, and it must never accept an
absent or empty verifier as a match.

## The three remaining units

Read each unit's own section in
`docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md`; do not read the plan whole
(it is ~975 lines). U9 is at line 712, U10 at 755, U12 at 823. Also read **KD9** (line 58) and
**KTD8** before U9.

### U9 — protocol handler and peek-first orchestration (highest risk left)

Files: `src/platform/plusSignIn.ts`, `src/plugin/main.ts`.

- **KTD8's race is real and specific.** Registering the protocol handler above `onload`'s first
  `await` is *not* sufficient: `settings!` is only assigned at `src/plugin/main.ts:1386` inside
  `loadSettings()`, so the handler can exist while `plusBaseUrl` does not. The plan requires a
  **one-slot queue drained after settings load**.
- **The refusal must never present the `vault=` deep-link param as the attested vault.** That
  param is attacker-controlled prose. Use the server-recorded vault, which U13 returns on
  `refused` as well as `usable`, precisely so this is possible. Where no peek could run at all
  (this vault holds no verifier), the refusal names **no** vault.
- **R19 lists *rate-limited* as an outcome needing an actionable message.** U13 answers 429 with
  no verdict field (deliberately, so U8's stated-verdict-beats-status rule cannot misread it as a
  decision about the link), and the client currently surfaces only the service's "Too many
  requests" through its generic path. That is not silent but it is thin. **U9 owns routing every
  outcome — this is the known gap to close.**
- Client API to consume is listed in the U8 commit body and at
  `src/platform/plusClient.ts`: `peekMagicToken`, `exchangeMagicToken`, verdicts
  `usable | expired | invalid | refused`, with the same codes from both peek and exchange.

### U10 — confirmation modal

Files: `src/settings/plusSignInConfirmModal.ts`, `src/platform/plusSignIn.ts`. Cancel is the
default and must make **zero** server calls; the sign-out disclosure appears before the choice;
exchange fires only on approve. **Reuse `markDestructive`** at `src/settings/settings.ts:98-107`
— do not hand-roll `.setWarning()` / `setDestructive()`, which was a real past bug on Obsidian
1.11.4. (U11 did not need it, so it is currently unexported.)

### U12 — QA fixtures and evidence

Must name its own gaps, including the no-signal dead ends and the unproven mobile
`crypto.subtle`. Note for QA: U13's rate-limit tests forge a distinct `x-forwarded-for` per case,
so **any route test hammering those paths from the default loopback IP will hit the ceilings**.

## Verification performed, and not

Both suites pass at every commit, and each unit was implemented proof-first — the red failure was
observed before implementation and quoted in each worker's report.

**Never executed, and no local run can fix it:**

- **Postgres has never run.** No docker, no `pg`, `TEST_DATABASE_URL` unset. Every "all three
  backends" claim is verified on memory and sqlite only; the postgres arm falls back silently.
  CI (`.github/workflows/plus-service-tests.yml`) runs it against a real service and errors if
  the rows skip, so this closes at PR time.
- **The plan's deliberate-mutation checks never ran.** U1, U2, U4, and U13 each specify "break it
  on purpose, confirm red." The permission classifier blocked every attempt — correctly, since
  they involve removing security controls. Each worker documented the exact mutation instead.
  **U13's is the one that matters**: in `plus-service/src/store/shared.mjs`, inside
  `verifierMatches`, replace the timing-safe compare with `return false`. Both
  `test/http-auth-peek.test.mjs` and `test/http-auth-exchange-bound.test.mjs` should turn red —
  that is the only proof "one comparison, two callers" actually holds. It is unproven today.
- **`crypto.subtle` on the mobile webview is still assumed.** U7's absence tests stub the global
  in node, which proves the error path and nothing about iOS or Android.
- **No live-vault smoke, no screenshots.** U11's plan step asks for `./scripts/verify.sh` with
  Obsidian open on the throwaway vault plus a signed-out-panel screenshot; not attempted. The
  unbound-device copy is a second screenshot worth capturing if a webview without `crypto.subtle`
  can be found.

## Loose ends worth a look

- `plus-service/src/server.mjs:352` still tells the user to tap **Refresh status** on the Stripe
  checkout return page. Different surface, not bound by R15, deliberately left alone — but if
  Refresh status is a no-op there too, that page is pointing at nothing.
- The shipping tail has not started: `ce-simplify-code` → `ce-code-review` → `ce-compound` →
  `world-class-qa`, then a PR body carrying `Closes #240`. The repo routes the cross-model review
  peer to grok via `.compound-engineering/config.local.yaml`.
- Draft PR is [#298](https://github.com/taihartman/obsidian-atoms/pull/298). `STATUS.md`'s #240
  row was updated in `3765f12` and reflects this state.

## Next step

Dedup `hashVerifier` into `pkceChallengeS256`, then `ce-work` U9 → U10 → U12, then the shipping
tail. Start a fresh session — this one carried ten full subagent reports.
