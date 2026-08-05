---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T17:08:33Z"
title: "#240 magic-link — plan is implementation-ready, two P0s unresolved"
summary: "The magic-link plan was enriched to implementation-ready and reviewed by six personas; the claim is live and pushed, but two P0 findings still need to land before anyone implements."
keywords: ["plus", "magic-link", "240", "obsidian-uri", "pkce", "doc-review", "p0-open", "implementation-ready"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
resume_focus: "Fold the two P0 doc-review findings into the plan, then start ce-work"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "feat/240-magic-link-handoff"
head: "ba3a408577a79cb06268c7695312a1f35d325074"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
---

# #240 magic-link — plan is implementation-ready, two P0s unresolved

The hard claim is made and the plan is written, reviewed, and pushed. **No implementation code exists.** Two P0 findings from the review are not yet folded in, and both change what U4, U5, and U6 build — so implementing before they land means building the wrong thing twice.

## Where everything is

| Item | Path / ref |
|---|---|
| Worktree | `/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link` (machine-local) |
| Branch | `feat/240-magic-link-handoff`, pushed, HEAD `ba3a408` |
| The plan | `docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md` |
| Review findings | `docs/plans/2026-08-05-240-doc-review-findings.md` — read this before touching the plan |
| Issue | [#240](https://github.com/taihartman/obsidian-atoms/issues/240) — assigned, STATUS row live |
| Draft PR | [#298](https://github.com/taihartman/obsidian-atoms/pull/298) |
| Prior handoff | `docs/handoffs/2026-08-05-240-planning-unblocked-handoff.md` — its next step is done |

Three commits this session: `6fc7de6` the STATUS claim, `ba3a408` the plan plus findings. The branch merged `origin/master` cleanly at the start; the stale `#280` STATUS row the previous handoff warned about resolved itself in the merge.

## State of the work

**Complete.** The hard claim (issue assigned, STATUS row, draft PR). The plan's enrichment to `implementation-ready`: Planning Contract with 12 KTDs, System-Wide Impact, 12 implementation units with traced requirements and test scenarios, Verification Contract, Definition of Done. A six-persona doc review, with 8 mechanical fixes applied.

**Not started.** Every implementation unit. No code has been written.

**Open and blocking.** The two P0s below, plus 13 P1s.

## The two P0s, in the order they matter

### 1. The verifier and the fallback contradict each other

Four reviewers reached this independently, from four directions, which is why it is first.

Once the plugin always sends a verifier hash at mint, every plugin-requested link is bound. Three things follow that the plan does not resolve: the fallback form POST presents no verifier so U4 refuses it (killing the cross-device recovery KD3 exists for); tokens from *older plugin builds* carry no hash but still get rendered an `obsidian://` anchor their build cannot receive, while the same deploy deletes the session block that was their only path; and an unbound token reaching a vault that never requested it would exchange and show an approvable confirmation, which R5 and AE7 declare impossible.

One fix closes all three: **gate the `obsidian://` anchor on the token carrying a verifier hash**, and promote the fallback block for unbound tokens. Then say explicitly in KD9 and U6 that the fallback POST skips the verifier check by design.

The consequence to write down honestly: the verifier binds *where a session lands*, not *who may obtain one*. It is wrong-vault routing safety this release, not anti-theft, and the magic link stays a bearer credential until #286.

### 2. The landing page is specified as three states with no JavaScript

R14 describes a state existing "after handing off" and U5 calls the fallback "dismissible", but KTD4 forbids script. A static page can neither transition nor dismiss, so as written it asserts the handoff succeeded and failed at the same time, before the user taps. Fix: one static pre-tap render, native `<details>` for troubleshooting, amend R14 to drop the post-tap framing.

## The finding I would not let slip

**Cancelling the confirmation signs the account out on every device.** Three reviewers, and I verified it in code: `exchangeMagic` calls `revokeAllSessionsForEmail` before minting (`plus-service/src/store/memory.mjs:233`, `sqlite.mjs:312`, `postgres.mjs:371`), and KD4 exchanges before asking the user. So tap-then-cancel destroys the desktop session and burns the link. R4 and AE2 currently describe cancel as inert. This is a design bug, not a wording bug, and it needs a decision about whether to disclose it in the modal copy or restructure the ordering.

## Decisions made this session that should not be relitigated

- **"Advanced: paste session" stays** (user-directed, reversing the earlier KD3). Strict device binding would otherwise leave a user whose mail only reaches another device with no recovery at all until #286. #286 now owns deleting the field, the landing page's fallback block, and the session-in-browser-HTML security item together.
- **The unrequested-device case is a visible refusal, not an approvable confirmation** (user-confirmed). The verifier makes the exchange impossible there, so a consent prompt would be a lie.
- The four original session-settled decisions from the brainstorm (same-device only; typable code deferred to #286; always confirm the server-verified email) are unchanged.

## Traps worth not rediscovering

- **`GET /v1/auth/exchange` serves two callers.** The Ask OAuth authorize flow emails the same URL with `&pending=…` (`plus-service/src/oauth/routes.mjs:360`) and needs that GET to consume and 302 to consent. Making it uniformly non-consuming strands every MCP authorization in an email-form loop. KTD12 preserves the branch; three tests pin it (`plus-service/test/http-ask-oauth.test.mjs:124-135`, `:362-387`, `plus-service/test/mcp-modern-era.test.mjs:71-94`) and must stay green **unchanged** — if they go red, the branch is wrong.
- **The Plus surface uses `fetch`, not `requestUrl`.** `CLAUDE.md` states the repo-wide default is `requestUrl`; `plusFetchRequest` (`src/platform/plusClient.ts:21-60`) is a documented exception because desktop `requestUrl` fails against localhost. Do not "fix" this.
- **`main.ts:229` is not synchronous in `onload`** — `onload()` awaits `loadSettings()` at `:217` first. KTD8's cold-open race needs registration above that await.
- **`.setDestructive()` requires Obsidian 1.13** and `manifest.json` declares `minAppVersion: 1.11.4`. That combination already crashed Settings for every Plus user once. Use `.setWarning()`.
- **`crypto.subtle` on Obsidian mobile is asserted, never probed.** If it is missing from the iOS/Android webview, the whole verifier binding fails — and it would surface at the human-only release gate, after both surfaces have shipped.
- **Expired magic tokens lose their only reaper** when GET stops consuming. Nothing else deletes them.
- The desktop probe's `vault=` result rests on **undocumented** behavior: Obsidian documents `vault=` only for its six built-in actions.

## Verification performed

Six reviewers ran in independent contexts, so their agreement is real corroboration. Feasibility independently verified every code anchor the plan cites — all resolve correctly. I separately verified the `revokeAllSessionsForEmail` claim myself.

**Not verified:** no code was run, no tests executed, nothing installed to a vault. The **cross-model peer pass did not run** — this repo routes it to grok via `.compound-engineering/config.local.yaml` (gitignored, machine-local). Nothing in this review has different-model corroboration. **product-lens** was also not activated.

The release gate remains human-only: a physical iOS device and a physical Android device, link opened from a mail client's in-app browser. No agent can satisfy it.

## Plausible next steps

Fold the P0s and the P1s into the plan, then run `ce-work`. The findings doc states a fix for nearly every item, so this is mostly mechanical judgment rather than fresh design — the exceptions are the cancel-revokes-everything decision above and the `dev-exchange` disagreement below.

The one genuine fork inside that path: **`dev-exchange`, delete or branch?** Coherence and scope-guardian say delete it (zero callers, zero tests, 404 in production). Feasibility says apply the same non-consuming branch, to keep the two GET bodies in parity with no doc churn. Either is defensible; leaving it as the current either/or is the #230 one-branch-only shape the plan itself cites as a cautionary tale.

Optionally, run the grok cross-model pass first — but give it a brief naming two or three files, not the whole diff, or it burns its window reading and returns nothing.
