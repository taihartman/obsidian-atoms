---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T17:55:00Z"
title: "#240 magic-link — plan is review-clean, ready for ce-work"
summary: "Two doc-review rounds are folded into the magic-link plan and pushed; 13 units, no implementation code, one release-policy question still open."
keywords: ["plus", "magic-link", "240", "obsidian-uri", "pkce", "doc-review", "implementation-ready", "ce-work"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
resume_focus: "Run ce-work against the plan; answer the Definition of Done release-gate question first"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "feat/240-magic-link-handoff"
head: "8164ada"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
---

# #240 magic-link — plan is review-clean, ready for ce-work

The plan has been through two doc-review rounds and is implementation-ready at **13 units**. Everything is committed and pushed. **No implementation code exists.** The next action is `ce-work`, and it should be a fresh session.

## Where everything is

| Item | Path / ref |
|---|---|
| Worktree | `/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link` (machine-local) |
| Branch | `feat/240-magic-link-handoff`, pushed, HEAD `8164ada` |
| The plan | `docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md` (959 lines) |
| Round-1 findings | `docs/plans/2026-08-05-240-doc-review-findings.md` — F1–F29, all folded |
| Issue | [#240](https://github.com/taihartman/obsidian-atoms/issues/240) — assigned, STATUS row current |
| Draft PR | [#298](https://github.com/taihartman/obsidian-atoms/pull/298) |
| Prior handoff | `docs/handoffs/2026-08-05-240-plan-implementation-ready-handoff.md` — its next step is done |

Round 2's findings are not in a separate file; they were applied directly and the commit message for `8164ada` records what moved and why.

## The two decisions that shaped this pass

**KD4 is peek → confirm → exchange.** `exchangeMagic` calls `revokeAllSessionsForEmail` before minting (`plus-service/src/store/memory.mjs:233`, `sqlite.mjs:312`, `postgres.mjs:371`), so exchanging before asking made *cancel* destroy the user's other sessions and burn the link — cancel more destructive than approve, which defeats R4 outright. The plugin now asks a non-consuming, verifier-bound peek (**new U13**) for the account email and requesting vault, shows the confirmation from that, and exchanges only on approve. Verified in code: the only plugin-reachable route into `store.exchangeMagic` is `POST /v1/auth/exchange`, so a cancel that calls nothing genuinely mutates nothing.

**`GET /v1/auth/dev-exchange` is deleted, not branched.** Zero callers, zero tests, 404 in production — verified repo-wide, not assumed.

Neither should be relitigated. Both are user-directed.

## Traps that will bite if forgotten

- **`allowDevExchange` must survive the route deletion.** `plus-service/src/prodGate.mjs:27` is still asserted by `plus-service/test/prod-gate.test.mjs:67-69` and `security-meter.test.mjs:34`. Remove the route and its import from `server.mjs`; leave the export.
- **The three OAuth tests must stay green *unchanged*** — `plus-service/test/http-ask-oauth.test.mjs:124-135`, `:362-387`, `plus-service/test/mcp-modern-era.test.mjs:71-94`. They recover the magic token by regexing the server log for `token=(mt_[a-f0-9]+)`; KTD14's hashing changes the stored key only, not the emitted shape. If they go red, the KTD12 branch is wrong.
- **The fallback POST skips the verifier check by design**, for bound and unbound tokens alike, on its own route. U4's abort-on-mismatch-or-absence governs the plugin's exchange only. Round 2 found these two contradicting each other; do not "fix" the fallback back into U4's path — that kills KD3's cross-device recovery.
- **`markDestructive` already exists** at `src/settings/settings.ts:98-107` and handles the 1.11.4 / `setDestructive` problem. Export and reuse it; do not hand-roll `.setWarning()` again.
- **Registering the protocol handler above `onload`'s first `await` is not sufficient** — `settings!` is only assigned at `main.ts:1386` inside `loadSettings()`, so the handler exists while `plusBaseUrl` does not. KTD8 now requires a one-slot queue drained after settings load.
- **`plusFetchRequest` uses `fetch`, not `requestUrl`**, deliberately (`src/platform/plusClient.ts`). Documented exception to the repo-wide default.
- **`crypto.subtle` on Obsidian mobile is still asserted, never probed.** U7 carries a capability check; if it is missing from the webview, the whole verifier binding fails and it surfaces at the human-only gate.

## Verification performed, and not

Round 2 ran three reviewers in independent contexts — coherence, feasibility, security-lens. Feasibility read the real source and confirmed every code anchor the plan cites resolves; security-lens verified the peek path is genuinely non-mutating and that the second round-trip widens no logging.

**Not verified:** no code was run, no tests executed, nothing installed to a vault. **The cross-model peer pass did not run in either round** — this repo routes it to grok, which is buffered all-or-nothing with no idle guard, and a 959-line plan is well past the size that has previously returned an empty result. Nothing in either review has different-model corroboration. **product-lens, design-lens, scope-guardian, and adversarial did not run in round 2** (round 1 covered all four).

The release gate stays human-only: a physical iOS device and a physical Android device, link opened from a mail client's in-app browser. No agent can satisfy it.

## The open question that should be answered before ce-work

**Does the Definition of Done gate the BRAT release explicitly on the human iOS/Android device result?** As written, "recorded as outstanding" can be read as "shippable." Since the whole feature exists to fix a mobile handoff, shipping it unverified on mobile is the specific failure worth designing against. This is a release-policy call, not a plan mechanic.

Four more open questions were added by round 2 under Outstanding Questions § "Raised by round-2 doc review" — the per-token verifier-attempt budget, the OAuth `pending` rate-limit key, the bound on the deferred-drain wait, and whether `renderExchangeHtml` should move into U6. None of them block starting.

Two verified constraints narrow the still-open rate-limit ceiling more than the plan previously admitted: `clientIp` returns the first element of a client-supplied `x-forwarded-for` (`plus-service/src/ratelimit.mjs:32-35`), so an IP key is forgeable *and* aimable at a victim's bucket; and `checkRateLimit`'s window is a module-level in-process Map (`:7`), so any ceiling is per-instance, not per-deployment.

## Next step

Run `ce-work` against the plan in this worktree. Start a fresh session — this one carries two full review rounds.
