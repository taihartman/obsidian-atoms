# World-Class QA: OpenAI plugin submission

## Verdict

**Ready after one portal OAuth handoff and the owner's final confirmations, with two accepted P2 deferrals.** The deployed MCP, OAuth contract, reviewer tenants, domain challenge, public copy, and review packet passed. The OpenAI draft is prepared but not submitted. The portal's embedded browser still requires a physical click on **Continue** to open the final tool-scan OAuth window; verified developer identity, public author, commerce/country declarations, policy attestations, and **Submit for Review** remain owner-controlled.

## Charter

Validate the ChatGPT-first Atoms Plus remote MCP at `https://plus.tryatoms.app/mcp` against the product contract and OpenAI review flow. The pass covers production discovery and OAuth, tenant scoping, exact tool annotations, synthetic reviewer usability, read and queued-write behavior, review-copy honesty, domain ownership, deployment health, and negative non-trigger cases. No custom OpenAI component UI exists in v1, so visual component QA is not applicable.

## Preflight

- **Authority:** issue #624, implementation plan, review runbook, and the user's explicit production-deploy and portal-preparation authorization.
- **Build under test:** commit `3f0dab0`; Fly release 70; image digest `sha256:0b0d2331402616c56e2c75c39213cdaea9ce177ccefb33c473f98ecb4a310cec`.
- **Production surfaces:** `plus.tryatoms.app`, `tryatoms.app`, OpenAI plugin portal, synthetic primary and backup reviewer tenants.
- **Fixture:** exactly three synthetic atoms from `docs/runbooks/openai-plugin-submission.md`; no customer or owner vault data.
- **Auth path:** OAuth authorization code + PKCE S256, reusable bounded reviewer credential, explicit `atoms:read` and `atoms:write` consent.
- **Automation:** Node test suites, GitHub Actions with PostgreSQL, direct secret-safe production OAuth/MCP driver, HTTP probes, and controlled portal browser automation.
- **Navigation map:** App Info → MCP Server → Skills (skipped) → Prompts (none) → Testing → Global → Submit.

## Product Promise Matrix

| Promise                                                   | Evidence                                                                                                                                                                                    | Status                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| ChatGPT connects to the production remote MCP             | Protected-resource and authorization-server discovery resolve from `plus.tryatoms.app`; four independent production PKCE grants succeeded across primary and backup reviewer tenants.       | Pass                             |
| The integration reads only the opted-in Atoms mirror      | Production status returned the synthetic tenant and exactly three fixture notes; copy names the flat Atoms folder plus linked hubs and excludes daily notes/the rest of the vault.          | Pass                             |
| Search claims come from authoritative note content        | `search_atoms` found the blue-notebook fixture and `fetch_atom` returned the exact authoritative habit text.                                                                                | Pass                             |
| Graph navigation is real                                  | `neighbors` returned both links from the field-guide fixture and no invented third link.                                                                                                    | Pass                             |
| Writes are queued, not represented as instant vault edits | Production `create_atom`, `continue_atom`, and `set_loop` returned pending operations; `list_pending` observed them; `cancel_pending` removed only the selected loop change before cleanup. | Pass                             |
| Empty results are scoped honestly                         | The unusual absent phrase returned no results from the three-note mirror without implying whole-vault absence.                                                                              | Pass                             |
| Reviewer access is isolated and reusable                  | Primary and backup credentials each authorized twice; reprovisioning tests cover revocation of prior access/refresh tokens, browser sessions, codes, and prior credential.                  | Pass                             |
| OpenAI receives complete review material                  | Portal import saved app info, five positive cases, and three negative cases; domain shows verified. Tool justifications are staged in the import and apply after the portal scan.           | Pass with portal handoff pending |

## User Stories Tested

### S1 — Account and mirror status

- **Acceptance:** identify only the connected synthetic reviewer tenant, return a nonzero mirror count and sync timestamp, and avoid whole-vault claims.
- **Evidence:** production `mirror_status` returned the expected reviewer identity, `server_count: 3`, and a non-empty last-sync value.
- **Status:** Pass.

### S2 — Browse tags and newest atoms

- **Acceptance:** use `list_tags` and created-date descending `list_atoms`; surface the five expected tags and newest fixture.
- **Evidence:** production returned `writing`, `ritual`, `place`, `project`, and `follow-up`; the field-guide atom sorted first and all three fixtures were present.
- **Status:** Pass.

### S3 — Search, then authoritative fetch

- **Acceptance:** find the blue-notebook note and fetch it before making a body claim.
- **Evidence:** production search selected `Blue notebook ritual`; fetch returned the three-lines-before-breakfast text with the authoritative result shape.
- **Status:** Pass.

### S4 — Inspect graph neighbors

- **Acceptance:** return the two fixture links around `Call Mira about the field guide` and invent none.
- **Evidence:** production graph contained `Blue notebook ritual` and `Library window idea`.
- **Status:** Pass.

### S5 — Queued-write lifecycle

- **Acceptance:** queue create, continue, and loop-state operations; list them; cancel only the loop-state operation; never claim an immediate vault write.
- **Evidence:** production returned three pending IDs, listed all three, canceled the selected loop operation while the two additive operations remained, then canceled the two QA-only operations during cleanup.
- **Status:** Pass.

### Negative routing

The five positive and three negative cases in the portal exactly match the runbook. Weather, supplied-text summarization, and calendar scheduling are outside the Atoms Plus contract and should not trigger this MCP. Production negative-search behavior also passed with the scoped absent phrase.

## Risk Matrix

| Dimension        | Scenario                                                                                                                   | Result                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Positive         | OAuth, discovery, all read workflows, graph, queued writes                                                                 | Pass                                       |
| Negative         | Missing bearer token, bad/expired/superseded credentials, disallowed redirect, ordinary one-time code reuse, absent search | Pass in automated/live coverage            |
| Edge             | Browser-session wrong-tenant chooser, revoked authorization state, legacy database migration                               | Pass in focused and PostgreSQL CI coverage |
| Regression       | Root plugin suite and full Plus service suite                                                                              | Pass                                       |
| Security         | Exact 11-tool inventory, all annotation triples, security schemes, PKCE S256, bounded tenant                               | Pass                                       |
| Privacy          | Synthetic-only review data, no credentials in git/CI/report, honest mirror scope                                           | Pass after credential rotation             |
| Reliability      | Primary and backup reusable credentials each authorize twice                                                               | Pass                                       |
| Release          | Fly service, Cloudflare Pages, policy/support URLs, exact challenge bytes                                                  | Pass                                       |
| Perception       | Listing says what is and is not mirrored; queued writes are described as queued                                            | Pass                                       |
| Accessibility/UI | Remote MCP has no custom OpenAI component UI                                                                               | Not applicable                             |

## Evidence

- Root `npm test`: **117 files, 2,359/2,359 tests passed**.
- Root `npm run build`: passed.
- Plus service local suite: **631 total, 630 passed, 1 skipped** because local PostgreSQL was absent.
- Focused reviewer suite: **17 total, 16 passed, 1 PostgreSQL-only skip** locally.
- [Plus-service CI run 34365207301](https://github.com/taihartman/obsidian-atoms/actions/runs/34365207301): passed, including the real PostgreSQL legacy-schema migration.
- [Root CI run 34365207304](https://github.com/taihartman/obsidian-atoms/actions/runs/34365207304): passed.
- [Cloudflare Pages run 34365459900](https://github.com/taihartman/obsidian-atoms/actions/runs/34365459900): passed, including byte-for-byte live challenge validation.
- Fly release 70 serves the deployed image on the healthy machine; the autostart machine is pinned to the same digest.
- Live HTTP: service health, website, privacy, terms, OAuth protected-resource metadata, authorization-server metadata, and parent challenge all returned the expected successful response.
- Production secret-safe OAuth/MCP driver: two authorizations per reviewer account; 11 tools, 11 annotation triples, and 11 security-scheme declarations verified; three fixtures, five tags, authoritative fetch, two graph links, negative search, and queued-write lifecycle passed.
- OpenAI portal: parent domain shows **Domain verified**; JSON import reports **Updated App Info, 5 test cases, and 3 negative test cases**.

## Findings

### Residual P2 — reviewer provisioning is not atomic

`provisionOpenAiReviewer` grants entitlement, wipes the mirror, seeds fixtures, and mints the credential in separate operations. Failure injection reproduced a partial reviewer mirror with an active entitlement and still-redeemable prior credential; the unrelated tenant remained unchanged. This is an operational/reviewer reliability risk, not a cross-tenant disclosure. Both current reviewers were validated after provisioning, and primary/backup tenants plus validate-before-portal-replacement reduce impact. A follow-up should introduce one PostgreSQL transaction with failure-injection coverage.

### Residual P2 — claimed-row cancellation can race vault application

`cancel_pending` currently promises to cancel both pending and claimed rows. The stores accept a claimed row, mark it rejected, and report cancellation; a plugin that already pulled that row can still proceed directly to its vault write, while its later acknowledgement is accepted as already terminal. A local claim → cancel → late-ack interleaving reproduced the inconsistent state. This is pre-existing and does not block the supplied reviewer case because that tenant has no Obsidian drain and the selected operation remains pending, but it invalidates the broader claimed-row promise for real users. The minimum follow-up is to reject cancellation after claim and narrow the tool description; the robust fix is a versioned cancellation handshake, a plugin recheck, compare-and-swap acknowledgement, and an interleaving regression test.

### Non-blocking — tools omit `outputSchema`

All 11 tools declare input schemas and passed live invocation, but their descriptors do not declare `outputSchema`. This is not an OpenAI submission blocker and the import JSON does not carry output schemas. Add explicit output schemas later so models can consume results more reliably; see the [MCP tools specification](https://modelcontextprotocol.io/specification/draft/server/tools#tool).

### Closed security incident — accessibility capture exposed initial credentials

An accessibility snapshot of the private Testing field echoed its saved value into the automation transcript. Both reviewer tenants were immediately reprovisioned, invalidating the exposed credentials plus their access tokens, refresh tokens, browser sessions, and authorization codes. Fresh credentials were transferred without reading the field back and then passed reusable authorization checks. A permanent QA trap was added to `docs/qa/learnings.md`.

## Adversarial QA

The independent destructive pass reached **Ready with two explicit P2 deferrals** and found no auth, tenant-isolation, annotation-contract, or anonymous-production blocker.

| Scenario                       | Evidence                                                                                                                                                         | Result      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| OAuth/PKCE/redirect/revocation | Sequential code exchange, wrong verifier, redirect/client binding, refresh rotation, expiry/revocation, reviewer remint, issuer/resource metadata, and DCR tests | Pass        |
| Tenant and mirror isolation    | Scoped reads/writes, reserved-reviewer mutation denial, wipe/upsert isolation, negative search, unrelated-tenant preservation                                    | Pass        |
| Exact MCP contract             | All 11 tools, annotation triples, and security schemes                                                                                                           | Pass        |
| Production boundary            | Challenge bytes, metadata, unauthenticated 401 challenge, allowed methods, no-store, support/legal pages                                                         | Pass        |
| Reviewer and write flow        | Corroborated four OAuth grants, exact fixtures, read paths, pending-write lifecycle, and cleanup                                                                 | Pass        |
| Claimed-row cancellation       | Local interleaving proved cancel-success can race later vault application                                                                                        | P2 deferred |
| Reviewer provisioning failure  | Injected mid-seed failure proved a partial reviewer state                                                                                                        | P2 deferred |

The independent pass ran 128 targeted tests successfully with one PostgreSQL-only local skip, while CI supplied the PostgreSQL migration evidence. Remaining lower risks are untested concurrent PostgreSQL token redemption and slightly confusing OAuth copy that still describes an Obsidian-generated code even when the longer reviewer credential is accepted.

## Not Tested

- The OpenAI portal's final post-OAuth `Scan Tools` render with the rotated reviewer credential is pending because the embedded browser requires one physical click to open the OAuth popup. The same production OAuth and `tools/list` path passed directly, and the portal had previously rendered the exact 11 tools before rotation.
- Final verified developer identity, public legal author, commerce declaration, country availability, policy attestations, and **Submit for Review** were intentionally not selected.
- Actual OpenAI reviewer approval and directory publication cannot be tested before submission.
- No custom component light/dark rendering was tested because v1 exposes no OpenAI component UI.
- Concurrent PostgreSQL authorization-code and refresh-token redemption was not exercised; sequential one-time and rotation behavior passed.
- A vault-visible device reproduction of the claimed-row cancellation race was not run; the server/plugin state-machine interleaving is proven locally.

## Merge Decision

Do not merge or submit yet. The implementation and production service are release-ready. Complete the single portal OAuth popup handoff, verify the imported 33 justifications attach to the 11 scanned tools, obtain the owner's action-time confirmation for final identity/policy/country choices, then submit the draft for OpenAI review. Merge remains a separate user-authorized action.
