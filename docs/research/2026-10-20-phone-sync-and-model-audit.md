# Phone sync and model audit

Date: 2026-10-20, approximately 15:20–15:26 EDT.

## Questions

1. Why does Atoms appear not to sync on the owner's mirrored iPhone?
2. Which model versions are configured, and are current provider replacements warranted?

Follow-up model/effort tests, including owner-authorized read-only production captures, are tracked in the [Sonnet/Haiku comparison](2026-10-20-sonnet-haiku-effort-comparison.md). At 20:21:03 UTC the Luna operator acquired the shared device lease and found iPhone Mirroring disconnected with **iPhone in Use**. No reconnect, phone-lock action or filing was triggered; the lease was released. The server restoration therefore still lacks a fresh phone Home/count observation.

## Investigation preflight

- Scope: read-only observation of the existing iPhone through iPhone Mirroring, code, public health checks, connector status and provider documentation. No personal-vault edits, experiments, plugin installation, account changes, model changes or deployment.
- Read: AGENTS.md and overriding AGENTS.override.md; docs/qa/README.md; docs/qa/testing-fixtures.md; docs/qa/app-navigation-map.md; docs/qa/learnings.md.
- Applicable lesson: `a-sync-test-must-outwait-sync-before-it-can-blame-the-code` (2026-08-06). Distinguish Obsidian Sync transport, plugin settings replication, Plus Ask mirror, and capture filing. Do not attribute a brief stale UI to a broken hook.
- Device-local authentication and automatic filing settings do not replicate with vault notes. Inspect status and version before drawing conclusions.
- Phone operator: gpt-6-luna, low reasoning. Existing user-requested mirroring session; no build or installation.

## Phone observations

Status: reported filing stall reproduced; exact underlying server fault unresolved.

The operator observed Atoms Home, opened Atoms settings and Obsidian Sync settings, then returned Home. No action that triggers filing, sync, refresh, account or consent changes was pressed.

- Home at approximately 15:21–15:22, and again at 15:24: **5 past thoughts will file automatically** and **Filing past thoughts… Automatic filing is running. You can keep browsing. Nothing needs a tap.**
- Atoms version: **0.8.20-beta.1**. Automatic filing on; Next run **Tomorrow, when Obsidian opens**. Daily notes on; Capture Atom 2.2.0.
- Filing: **Plus · 150 filings left**, unchanged at the second observation. This is displayed/cached entitlement, not a fresh backend verification.
- Obsidian Sync: remote vault connected; **Obsidian Sync is currently running**. This establishes the displayed connection state, not successful replication of a particular file.
- Filing destination contained informational copy, no error. Ask mirror details/logs and phone network/console traces were not obtained.
- Evidence limitation: screenshots were inspected by the operator in CUA results, but no valid Home image was persisted for independent review. A native capture showed a daily note instead and was removed as task-owned private data. A later CUA call returned `noWindowsAvailableWindow`, ending navigation. The operator did not acquire a shared physical-device lease; this procedural gap is recorded, not presented as completed setup.

## Service observations

Public read-only checks from this Mac:

| Check | Result |
| --- | --- |
| `https://api.github.com/zen` | HTTP 200 in 0.176 seconds |
| `https://plus.tryatoms.app/health` | No HTTP response or body within 15 seconds |
| Same health endpoint, detailed timings | DNS 0.002720s, TCP 0.024177s, TLS 0.139413s; **zero response bytes**, timeout at 25.007059s |
| Same endpoint, forced IPv4 | DNS 0.001680s, TCP 0.023924s, TLS 0.072422s; zero response bytes, timeout at 15.002694s |
| `https://atoms-plus.fly.dev/health` | Zero response bytes, timeout at 15.006121s |
| Connected Atoms Plus `mirror_status` | MCP internal error; no account status returned |
| Fly machine inventory | Blocked: flyctl reports **no access token available** |

The timeout is after successful TLS, not a DNS lookup failure or a general inability to reach HTTPS. Both production hostname and Fly origin were affected from this machine. This supports an unavailable/unresponsive Plus request path; it does not establish whether the fault is the process, a dependency, Fly routing, or another server-side condition. No authenticated production configuration or server logs were available.

## Code evidence and interpretation

Compared the relevant checkout files with tag `0.8.20-beta.1`; no differences in `src/platform/plusClient.ts`, `src/platform/autorun.ts`, `src/home/atomsHomeData.ts`, or `src/plugin/main.ts`.

- `src/platform/plusClient.ts:27`: `plusFetchRequest` awaits `window.fetch` and `res.text()` without an application timeout or AbortController.
- `src/pipeline/classify.ts:849`: Plus classification awaits that request adapter. A request that never settles cannot enter ordinary retry/error handling.
- `src/plugin/main.ts:1290`: automatic filing claims `autoRunInFlight` before awaited work; its `endWork` clears the flag after the cycle exits.
- `src/home/atomsHomeData.ts:790`: the in-flight flag drives the **Filing past thoughts…** card. It is not a server progress receipt.
- `src/plugin/main.ts:1141`: Home receives the in-flight flag from the snapshot; the Next run label can coexist with in-flight work and does not prove completion.

**Inference:** an unsettled Plus request is a strong explanation for the observed filing card and unchanged waiting count. The direct phone request was not captured, so this is a likely causal chain, not a proven stack trace. The smallest verified external failure is the Plus health route returning no response after TLS. Confidence: high in the observed stall and public endpoint failure; medium in the specific phone request being the immediate cause; unknown in the underlying hosting/process fault.

Temporary instrumentation: none. Runtime code changes: none.

## Model inventory: repository configuration, not verified production overrides

| Role | Current code default | New candidate / status |
| --- | --- | --- |
| BYOK daily classification | `claude-sonnet-5` (`src/shared/types.ts:205`) | Evaluate `claude-sonnet-5-5` |
| Plus classification | `claude-sonnet-5`, overridable through `ATOMS_PLUS_MODEL` (`plus-service/src/config.mjs:65`) | Evaluate `claude-sonnet-5-5` |
| Ask expansion and G2 metadata/query | Inherit Plus model unless `ASK_EXPAND_MODEL` / `G2_METADATA_MODEL` overrides exist | Audit overrides with authenticated deployment access |
| BYOK backfill | `claude-haiku-4-5-20251001` (`src/pipeline/backfill.ts:40`) | Evaluate `claude-haiku-5-5` |
| Optional hosted transcription | `gpt-4o-transcribe` (`plus-service/src/config.mjs:142`) | Deprecated; `gpt-transcribe` is current file-transcription candidate |
| Private G2 local transcription | Bundled Moonshine `tiny-streaming-en`, package 0.1.5 | Separate on-device path; hosted transcription default does not describe this path |

### Sourced provider facts (checked 2026-10-20)

- [Claude model overview](https://platform.claude.com/docs/en/models/overview) lists Sonnet 5.5, Haiku 5.5, Opus 5.5 and Fable 5.1. These are available candidates, not Atoms quality results.
- [Claude model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations) still lists Sonnet 5 and Haiku 4.5 as active. Sonnet 4.5 is deprecated with retirement November 30, 2026; any existing user's explicit old setting requires a separate audit. This investigation did not read user BYOK model settings.
- [Sonnet 5.5 overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) gives release date September 28, 2026 and token pricing $2 input / $10 output per million tokens. The repository's historical Sonnet rates ($3/$15) are not sufficient for current estimates.
- [Sonnet migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide) requires attention to thinking defaults, text-block parsing, token budgets, and rejected parameters/forced tool choices. A model string replacement alone is not qualification.
- [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/transcription) recommends `gpt-transcribe` for completed audio and `gpt-live-transcribe` for live audio. It uses `languages` rather than the legacy singular field.
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) schedules removal of `gpt-4o-transcribe` and related legacy transcription models for February 26, 2027.

### Recommendation, separate from the sync diagnosis

Evaluate Sonnet 5.5 for current Sonnet roles and Haiku 5.5 for backfill against the existing synthetic filing/link-quality corpus. The July study measured old candidates and cannot establish the new models' relative quality. Keep verbatim bodies and assess link precision/recall, schema/response parsing, latency, token budget and actual pricing. Do not promote a model solely for a newer version number. Plan the optional hosted transcription migration separately from bundled G2 speech.

No billable model evaluation, model setting edit, shipping, deployment or production change was performed. New model availability does not explain the observed failure of the content-free Plus health endpoint.


## Authorized fix follow-up (15:26 EDT onward)

User requested debugging/fixing and Sonnet 5.5 upgrade. Implementation starts from HEAD `32b3545b1a65aec8348c7280641c55061c7dd635`, branch `feat/openclaw-ask-login`. Pre-existing dirty files were this investigation's docs and unrelated untracked images/workflow files; runtime and test files changed for this fix were clean. Unrelated work is preserved. No commit, push, release or production deployment was requested.

### Confirmed production cause after Fly login

Authenticated Fly logs at 19:31:59 and 19:32:09 UTC show Postgres error **53000**, **Your account or project has exceeded the quota. Upgrade your plan to increase limits.** Stack: `createPostgresStore` (`plus-service/src/store/postgres.mjs:112`) awaited by service startup (`plus-service/src/server.mjs:64`). Both machines (`48ee35ea270368`, `857622da517258`) exit with code 1, not OOM, and restart repeatedly. Database initialization fails before `server.listen`, explaining the proxy connection failures and absent HTTP health responses. Exact Neon quota still requires authenticated provider usage data. No plan/billing changes made.

### Regression evidence

Before the fix, five new assertions failed: headers/body stalls never settle, requests carry no abort signal, timed-out multi-capture filing never returns, and Home receives no final refresh after failed filing. Existing neighboring checks passed (94). After the client implementation, all 99 tests in those three files passed. Ordinary immediate network-failure behavior remains covered and unchanged; the batch stops specifically for the newly bounded timeout case.

### Model compatibility check

One real provider call with synthetic sleep-related text and synthetic title context used the production payload builder with `claude-sonnet-5-5`. HTTP 200, model confirmed `claude-sonnet-5-5`, `end_turn`, text output, 139 output tokens, 4.027 seconds. No personal vault content or secret values printed. This is an API/payload smoke check, not a comparative link-quality evaluation.

### Preview setup

The only settings change is the existing Advanced model row's default/help/placeholder. The existing Home component needs to redraw after its in-flight flag clears. Code-rendered settings tests pass. No remote Obsidian preview runner was found in project scripts/runbooks or the local SSH host configuration. Initial local Obsidian CLI check reported app not running; the shared throwaway vault lease was free. A lightweight local preview using the existing app and test vault is in scope; no phone installation, personal-vault writes, or heavy QA build.


### Authenticated Neon findings (approximately 19:35 UTC)

Neon organization `org-old-pine-50930302` is on Free (`free_v3`). Its single project is **Obsidian Atoms**, `holy-smoke-14869613`. Read-only project details report:

- Consumption period: October 1–November 1, 2026 UTC; next quota reset November 1.
- `compute_time_seconds = 397753`, approximately **110.49 CU-hours**; `active_time_seconds = 1442520`, approximately **400.7 hours**.
- Data transfer 101,347,108 bytes (well below Free's 5 GB allowance).
- Primary compute last active October 17 at 17:03:55 UTC, suspended at 17:08:01 UTC; endpoint currently idle. Autoscaling 0.25–2 CU.
- Endpoint API returns `suspend_timeout_seconds = 0`; do not interpret this alone as an effective Free-plan scale-to-zero override: current provider docs say Free enforces suspension after five idle minutes.

[Neon project API](https://api-docs.neon.tech/reference/getproject) exposes current-period usage. [Neon platform quota documentation](https://neon.com/platforms) defines compute seconds as CPU seconds weighted by compute size. [Neon plans](https://neon.com/docs/introduction/plans) gives Free **100 CU-hours/project/month** and says exhausted compute suspends until the next billing period or an upgrade; data is not deleted. These observations establish exhausted compute as the operational blocker.

The same plan page lists Launch at **$0.106/CU-hour**, storage **$0.35/GB-month**, with no minimum monthly fee. At a continuously active 0.25 CU, a 31-day month's compute is about **$19.72**, before storage/history/other metered usage. Actual autoscaling can increase this. No subscription, spending limit, compute setting, database data, Fly machine or live model setting was changed.

### Completed local implementation and checks

- Plus transport now bounds both headers and response-body waits at 60 seconds, requests abort on timeout, and always clears deadline timers. A timeout is distinct from an ordinary immediate network failure.
- Filing stops after the first timeout, leaving remaining captures unprocessed and preserving bodies/markers for retry. No new automatic retry or false success receipt.
- Automatic filing refreshes Home after its in-flight flag clears, including all-failed runs. The old callback could refresh before release or skip refresh entirely when zero captures filed.
- Default Sonnet model is now `claude-sonnet-5-5` for plugin and Plus; Ask and G2 inherit unless explicitly overridden. Advanced default/reset/placeholder and the API probe share the plugin constant. Existing saved user overrides remain unchanged; Haiku backfill and transcription remain unchanged. Sonnet 5.5 cost estimates include $2/$10 input/output per million tokens.
- Verification: **558 tests passed in 10 plugin files**, **56 tests passed in 4 service files**, production TypeScript, test TypeScript, lint, and production bundle build passed. Synthetic real-provider smoke described above passed.
- Actual Obsidian preview: existing throwaway vault, matching candidate bundle hash, Advanced model row rendered with sample `claude-sonnet-5-5`. Three captures taken; final frame visually inspected at `/tmp/atoms-sonnet55-preview/advanced-3.png` and shown in chat. The test-vault model was restored afterward, settings closed, and shared vault lock released. No phone installation or personal vault modification.
- Self-review limited to changed implementation/tests; broader simplify/reviewer/QA lifecycle skipped under the owner's proportional-work policy. No new dependency, version bump, commit, push or release.

### Remaining authority and verification

Restoration today requires lifting the Neon Free compute limit through an approved paid plan, or provider support; otherwise the recorded reset is November 1. Paid billing and production actions require owner approval under the session's authority policy. Local fixes do not update the installed phone plugin. Production Sonnet 5.5 can be applied as a targeted model override on the existing service; a plugin release is separate. After an approved operational change, verify live health, machine stability, and the owner's phone filing/mirror state before claiming restoration.


## Production restoration authorized at 15:40 EDT

Owner approved Neon Launch restoration and activation of the requested Sonnet 5.5 model, then completed the Neon upgrade personally. Verified via authenticated organization API: plan `launch`, updated `2026-10-20T19:40:54Z`. First recovering health check returned HTTP 200 with `{ok:true, service:atoms-plus}` in 10.985 seconds; one Fly check passing and the other still starting. Applying only `ATOMS_PLUS_MODEL=claude-sonnet-5-5` to the existing Fly service/image; local uncommitted code is not being deployed.

Phone re-check preflight: reuse existing Luna low operator, preserve mirrored session and personal notes. Required current guides and relevant Sync/availability lessons were read earlier in this session and remain applicable. Obtain a shared physical-device lease before driving; no force acquisition. Inspect Home counts/status and filing entitlement after recovery. Do not install the local plugin or run broad Process/Update/Sync-everything. Report any stuck old in-flight state before selecting recovery actions. No fixtures or test writes in personal vaults.


### Production verification after owner-completed upgrade

- Applied `fly secrets set ATOMS_PLUS_MODEL=claude-sonnet-5-5 -a atoms-plus` with the owner's approval. Rolling update succeeded on both existing machines. No local source deployment; image digest remained `sha256:4f8b054256991ee4ca33ae70a62c3c64801fc544f2acb51eca590561351c4de4`.
- Read the single non-secret model environment variable through each machine's console: both report **claude-sonnet-5-5**. Fly lists the setting as Deployed.
- Both Fly HTTP health checks pass. Public `/health` returns HTTP 200 with `{ok:true,service:atoms-plus}` in **0.164196 seconds**, compared with no response within 25 seconds before recovery.
- The connected ChatGPT Atoms Plus `mirror_status` now succeeds: server count **204**, pending writes **0**, last synced **2026-10-16T13:18:49.572Z**. The last-sync timestamp predates recovery; this is connector/server availability proof, not proof that the phone has pushed fresh notes.
- Local timeout/Home fixes remain uncommitted and unreleased; the phone's existing 0.8.20-beta.1 has not been replaced. Physical-phone verification assigned to the same Luna low operator, with the lease requirement made explicit.


## Sonnet 5.5 versus Haiku 5.5: follow-up recommendation (15:43 EDT)

Question: Is Sonnet necessary, or could new Haiku at higher thinking effort deliver better value? Should Atoms run a fresh model-quality comparison?

### Verified facts

- [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview) lists adaptive thinking, medium default effort, and for prompts up to 100,000 tokens **$0.10 input / $0.50 output per million tokens**. Above that threshold the listed prices are $0.50 / $2.50. This must be reflected in measured cost accounting.
- Sonnet 5.5 is $2/$10 per million input/output tokens. For prompts within Haiku's lower price band, Haiku's unit input/output rates are 20 times lower; total per-capture cost still depends on actual token counts, thinking, caching, failures and retries.
- [Effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) explicitly supports high, xhigh and max on Haiku 5.5 and recommends measuring higher effort against Sonnet on quality/cost/speed. Thinking counts toward the output-token cap even when omitted from visible text. Higher effort is not evidence of equal quality.
- July's 300-capture results compared Sonnet 5 with old OpenAI models, not Haiku 5.5. That study cannot select between the current candidates. Linking recall was the differentiating metric; verdict accuracy alone hid missed connections.
- `scripts/model-bakeoff.mjs` reuses the production classifier prompt but its model/rate table predates both new models. `--reasoning` currently changes only OpenAI requests; the Anthropic adapter does not set `output_config.effort`. Its token estimator assumes only 250 output tokens and its regular request inherits the plugin's 1024-token cap. It also uses a growing context rather than reproducing a saturated production shortlist. An unchanged run would not answer the owner's high-thinking question fairly.

### Recommended evaluation, not yet executed or funded

1. Compare **Sonnet 5.5 medium/high** and **Haiku 5.5 medium/high** first, with explicit effort, sufficient thinking/output headroom, the same production prompt/schema/enrichment, and identical synthetic inputs/context. Add Haiku xhigh only if the initial curve shows useful gains at high.
2. Use 50 synthetic captures as a compatibility/latency/cost pilot. Run finalists on at least the existing 300-capture chronological gold set, with a saturated synthetic vault/production shortlist and difficult links represented. Separate candidate quality from retrieval misses, and use paired inputs for direct comparison.
3. Score atom/noise verdicts, link precision and recall, factual/title consistency, malformed/truncated responses, total billed tokens including reasoning, cache behavior, failures/retries and median/p95 latency. Keep body preservation and existing-title link constraints as hard gates. Review disagreements blind to model, not by using the incumbent's output as ground truth.
4. Prefer Haiku if it retains acceptable linking quality and reliability at materially lower measured cost/latency. Otherwise retain Sonnet for linking and evaluate cheaper roles separately. Keep the now-recovered live service on Sonnet while testing isolated synthetic data.

No evaluation-harness implementation or billable comparative run was authorized by the owner's question alone, and none was performed. The 614 automated implementation checks and single provider smoke check do not establish comparative model quality. A pilot should produce a measured full-run budget before expanding spend.

### Phone verification boundary at 15:42 EDT

Luna acquired and released the shared lease for the owner's iPhone. Mirroring showed a daily note; its body was not captured/quoted. Navigation failed with `noWindowsAvailableWindow`, so no current Home count or completion claim is available. A repeated connector status check at 19:42:53 UTC still showed 204 mirrored notes with the October 16 last-sync timestamp. Server/model recovery is verified; fresh phone filing/mirror convergence remains unverified.

## Shipping follow-up, 17:08 EDT

The owner authorized commit, push and plugin release. [PR #631](https://github.com/taihartman/obsidian-atoms/pull/631) isolates the client fixes, model defaults and evaluation artifacts from the separate OpenClaw branch. The first clean-checkout CI passed the root test/lint/build job, all 816 service tests with PostgreSQL, and the companion check. The final candidate must retain passing checks before merge.

The completed evaluations and final Sonnet 5.5 low selection are recorded in [the comparison note](2026-10-20-sonnet-haiku-effort-comparison.md); the earlier unfunded recommendation above is historical. Production already has the selected model and effort. The plugin release targets **0.8.20-beta.2** on the owner's existing beta channel, from a separate beta version commit. Master remains on published stable **0.8.19**. A released asset is not proof that the phone has installed it or that fresh phone filing/mirror convergence has occurred.

The focused review found a pre-filing issuer-check timeout that released the lock without refreshing Home. A regression using the real Plus gate and request adapter failed with only the pending Home snapshot, then passed after refreshing every claimed cycle except an `in_flight` refusal. All **160** neighboring tests and the test TypeScript check passed after this correction. Claude OAuth refresh and replacement Grok rate limiting prevented cross-model review; a separate Codex adversarial reviewer supplied the usable review. The operational action is retained in the QA trap list. Final CI runs again on the correction before release.
