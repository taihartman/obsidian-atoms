# Even G2 private test checklist

This checklist separates automated evidence from checks that need the owner's glasses or Even developer portal. Do not describe the companion as public while any public-release box is unchecked.

## 2026-09-09 U1 local speech gate

**Status: the guided iPhone 16 Pro Max accuracy, timing, cancellation, and cycle-stability checks pass. U1 remains blocked on the iPhone offline-restart, process-memory, and residue evidence plus the guided Nothing Phone run. The user confirmed on 2026-09-09 that the available iOS device is an iPhone 16 Pro Max, not an iPhone 17, and removed the iPhone 12 requirement. Android evidence must come from the owner's available Nothing Phone and applies only to the exact model and software versions recorded below. Do not begin U2-U9.**

The current private package is a U1-only probe. It does not run the superseded cloud capture flow. It bundles `@moonshine-ai/moonshine-wasm` `0.1.5`, the exact Tiny Streaming English model revision `quantized_26_07_30`, and no cloud speech fallback.

### Reproducible candidate

- Artifact: `companion/even-g2/atoms-g2.ehpk`
- Package version: `0.1.5`
- Artifact size: `46,649,275` bytes
- Artifact SHA-256: `6c7aeb1f60399fe2907b6eec84ee95d19ef570efd74a53f9d580a2e5f32c3c0b`
- Model payload: seven manifest-pinned files, `51,441,771` bytes before package compression
- Runtime branch: upstream-tagged single-thread SIMD build from Moonshine `v0.1.5` commit `234f60faa0eb388b01cdf7e60aca232af37aefda`, ONNX Runtime `1.23.2`, and Emscripten `4.0.8`
- Asset branch: bundled assets. Runtime network access is limited to the package's own origin; the model loader verifies every byte count and SHA-256 before initialization.

Local guided candidate built and uploaded privately on 2026-09-09:

- Package version: `0.1.6`
- Artifact size: `46,652,648` bytes
- Artifact SHA-256: `81097c1d9805cb5353dc449d66738581a56405200375e6f7420ca7d0b3445752`
- Automated result: TypeScript passed; 18 Vitest files and 143 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.6` as the newest Private build on 2026-09-09.

Packaged iPhone 16 Pro Max `v0.1.6` run reported on 2026-09-09:

- Report start: `2026-09-10T01:02:53.410Z`; online launch; exact iOS and Even App versions still pending.
- Environment: Worker, WebAssembly SIMD, Cache API, and WebCrypto available; SharedArrayBuffer and cross-origin isolation unavailable; single-thread SIMD selected.
- Cold readiness: `332 ms`, passed.
- Accuracy: 20 of 20 phrases, 9 edits across 111 reference words, WER `8.11%`, and 4 critical-term errors. WER passed; the critical-term threshold did not. `v0.1.6` did not identify the affected phrase IDs.
- Timed finalization: `147 ms`, `7 ms`, `79 ms`, and `86 ms`, all within the two-second threshold.
- PCM duration: `29,400 ms`, `29,350 ms`, `29,750 ms`, and `119,150 ms`. The probe activated its recording state only after awaiting microphone startup, so early PCM was discarded and these duration failures are diagnostic defects rather than valid device-bound measurements.
- Stability: 24 transcription cycles completed. Rendering the full 120-second transcript to the constrained glasses page then failed with `page_rebuild_failed`, closed the probe, and prevented the cancellation check.
- Result: U1 remains blocked. Retest with the corrected package; do not use this run to pass recording-bound, accuracy-critical-term, cancellation, memory, offline-restart, or residue gates.

Local corrected candidate built and uploaded privately on 2026-09-09:

- Package version: `0.1.7`
- Artifact size: `46,652,882` bytes
- Artifact SHA-256: `a24d8cdfad5c997df384286dd82e3ed8be733f7c0250725f04875a1ee869dea4`
- Automated result: TypeScript passed; 19 Vitest files and 147 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.7` as the newest Private build on 2026-09-09.

Packaged iPhone 16 Pro Max `v0.1.7` run reported on 2026-09-09:

- Report start: `2026-09-10T01:54:35.981Z`; online launch; exact iOS and Even App versions still pending.
- Environment: Worker, WebAssembly SIMD, Cache API, and WebCrypto available; SharedArrayBuffer and cross-origin isolation unavailable; single-thread SIMD selected.
- Cold readiness: `326 ms`, passed.
- Accuracy: 20 of 20 phrases, 21 edits across 111 reference words, WER `18.92%`, and 6 critical-term errors. WER passed; the critical-term threshold did not.
- Timed finalization: `125 ms`, `1 ms`, `42 ms`, and `114 ms`, all within the two-second threshold.
- PCM duration: `29,450 ms`, `29,200 ms`, `29,300 ms`, and `119,300 ms`; every timed recording remained outside the 500 ms tolerance.
- Stability: 24 transcription cycles completed. The user reported severe lag and a crash after selecting the next check following the 120-second recording; cancellation remained `null`.
- Desktop reproduction: the same 24-cycle workload advanced to cancellation without a transition error, but its renderer retained approximately `470 MiB` RSS while the JavaScript heap remained approximately `3 MiB`. This exceeds the `384 MiB` project ceiling and points to native or WebAssembly memory pressure on iOS rather than the Next action itself.
- Result: U1 remains blocked on accuracy-critical-term errors, PCM duration, memory, cancellation, offline restart, and residue evidence.

Local checkpoint-enabled candidate built and uploaded privately on 2026-09-09:

- Package version: `0.1.8`
- Artifact size: `46,653,699` bytes
- Artifact SHA-256: `dcfae9e0b9c4157b811d70f8e75eb382ed8ba9339723ed6ad0dd2be83ca0e23a`
- Behavior: saves privacy-safe metrics after every completed cycle, resumes at the first unfinished check after relaunch, and keeps Start over available as a secondary action. No transcript or audio content is stored.
- Automated result: TypeScript passed; 19 Vitest files and 151 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.8` as the newest Private build on 2026-09-09.

Packaged iPhone 16 Pro Max `v0.1.8` run reported on 2026-09-10:

- Report start: `2026-09-10T14:14:18.323Z`; online launch; exact iOS and Even App versions still pending.
- Environment: Worker, WebAssembly SIMD, Cache API, and WebCrypto available; SharedArrayBuffer and cross-origin isolation unavailable; single-thread SIMD selected.
- Cold readiness: `315 ms`, passed.
- Accuracy: 20 of 20 phrases, 20 edits across 111 reference words, WER `18.02%`, and 5 critical-term errors. WER passed; the critical-term threshold did not. The failed phrase IDs were `p01`, `p03`, `p13`, `p17`, and `p20`.
- Timed finalization: `117 ms`, `13 ms`, `11 ms`, and `87 ms`, all within the two-second threshold.
- PCM duration: `29,550 ms` and `29,650 ms` passed. `29,450 ms` and `117,800 ms` failed the 500 ms tolerance.
- Cancellation: `60 ms`, no late transcript, passed.
- Stability: 24 transcription cycles and cancellation completed without the prior post-recording crash.
- Result: U1 remains blocked on accuracy-critical-term errors, the long recording bound, memory, offline restart, and residue evidence. The next run should be targeted rather than repeat the full sequence.

Local targeted candidate built and uploaded privately on 2026-09-10:

- Package version: `0.1.9`
- Artifact size: `46,655,215` bytes
- Artifact SHA-256: `7529a2548d6762ea81c90deae22e7e9570a6fd9987d1810b84c569ab66cd2ffd`
- Behavior: migrates the completed `0.1.8` checkpoint, retests only `p01`, `p03`, `p13`, `p17`, and `p20`, then runs one 120-second timing check. The long check records stop source, microphone acknowledgement, first and last PCM timing, packet count, maximum packet gap, timer drift, and microphone shutdown time.
- Privacy: the checkpoint and report retain metrics only. Audio and transcript content are discarded.
- Automated result: TypeScript passed; 19 Vitest files and 155 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.9` as the newest Private build on 2026-09-10.

Packaged iPhone 16 Pro Max `v0.1.9` targeted run reported on 2026-09-10:

- Report start: `2026-09-10T15:58:59.324Z`; online launch; exact iOS and Even App versions still pending.
- Cold readiness: `348 ms`, passed.
- Accuracy: 8 edits across 111 reference words, WER `7.21%`, and 3 critical-term errors. `p01` and `p13` passed their retests; `p03`, `p17`, and `p20` still failed the critical-term threshold.
- Long timing: `119,150 ms` of PCM and `11 ms` final latency. The recording stopped `157 ms` before the wall-clock target, while the first PCM packet arrived `461 ms` after capture activation. The run received 2,383 packets, observed a `154 ms` maximum inter-packet gap, and received microphone shutdown acknowledgement in `41 ms`.
- Stability: the five targeted phrase checks and long check completed without the prior crash. The preserved cancellation result remained `60 ms` with no late transcript.
- Result: U1 remains blocked on one critical-term error above the threshold, the long recording bound, memory, offline restart, and residue evidence. The next run should retest only `p03`, `p17`, and `p20`, then repeat the long check with its timer anchored to the first PCM packet.

Local PCM-anchored candidate built and uploaded privately on 2026-09-10:

- Package version: `0.1.10`
- Artifact size: `46,655,431` bytes
- Artifact SHA-256: `85304aba4e65f81a475549c2e6f2554df0f2c361539641eb126130f379cdd1f8`
- Behavior: migrates the completed `0.1.9` checkpoint, retests only `p03`, `p17`, and `p20`, then runs one 120-second timing check. Timed shutdown is armed by the first accepted PCM packet, and timer drift is measured from that packet.
- Privacy: the checkpoint and report retain metrics only. Audio and transcript content are discarded.
- Automated result: TypeScript passed; 19 Vitest files and 157 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.10` as the newest Private build on 2026-09-10.

Packaged iPhone 16 Pro Max `v0.1.10` targeted run reported on 2026-09-10:

- Report start: `2026-09-10T16:27:12.014Z`; online launch; exact iOS and Even App versions still pending.
- Cold readiness: `793 ms`, passed.
- Accuracy: 9 edits across 111 reference words, WER `8.11%`, and 2 critical-term errors. The accuracy gate passed. `p17` passed its retest; `p03` and `p20` remained critical errors within the allowed threshold.
- Long timing: `118,500 ms` of PCM and `8 ms` final latency. The first PCM packet arrived at `440 ms`, but the timer requested shutdown at `119,117 ms`, `1,323 ms` before its PCM-anchored target. The run received 2,370 packets, observed a `427 ms` maximum inter-packet gap, and received microphone shutdown acknowledgement in `90 ms`.
- Stability: the three targeted phrase checks and long check completed without the prior crash. The preserved cancellation result remained `60 ms` with no late transcript.
- Result: iPhone accuracy, readiness, latency, cancellation, and cycle stability pass. U1 remains blocked on the long recording bound, memory, offline restart, residue evidence, and the Nothing Phone run. No more iPhone accuracy phrases are needed.

Local PCM-count candidate built and uploaded privately on 2026-09-10:

- Package version: `0.1.11`
- Artifact size: `46,655,577` bytes
- Artifact SHA-256: `08b6654698bf8c9dea4fdd19344d9f4b21b491d947ba52b30da810dcc6be8810`
- Behavior: migrates the completed `0.1.10` checkpoint directly to one 120-second check, with no phrase retests. The check stops after accepting `3,840,000` PCM bytes. A timer five seconds beyond the nominal duration remains as a safety fallback if PCM delivery stalls.
- Privacy: the checkpoint and report retain metrics only. Audio and transcript content are discarded.
- Automated result: TypeScript passed; 19 Vitest files and 158 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.11` as the newest Private build on 2026-09-10.

Packaged iPhone 16 Pro Max `v0.1.11` targeted run reported on 2026-09-10:

- Report start: `2026-09-10T16:46:23.898Z`; online launch; exact iOS and Even App versions still pending.
- Cold readiness: `306 ms`, passed.
- Accuracy: the preserved `v0.1.10` result remained passed at WER `8.11%` with 2 critical-term errors. No phrase recordings were repeated.
- Long timing: exactly `3,840,000` PCM bytes and `120,000 ms` of PCM, passed, with `8 ms` final latency. PCM-count shutdown requested at `120,732 ms`, `2 ms` after the final packet, and microphone shutdown acknowledgement took `45 ms`.
- Stability: the one long check completed without a crash. The preserved cancellation result remained `60 ms` with no late transcript.
- Result: the iPhone 120-second recording bound now passes. One preserved 30-second result remains `50 ms` outside tolerance, so the next run should repeat only 30-second recording 3.

Local short-retest candidate built and uploaded privately on 2026-09-10:

- Package version: `0.1.12`
- Artifact size: `46,655,731` bytes
- Artifact SHA-256: `1bd9d74b60b6e302e981de8326fbd89615be8f6ba03a9a1ae6213ac2b031169b`
- Behavior: migrates the completed `0.1.11` checkpoint directly to 30-second recording 3. It preserves the passing accuracy, 120-second, cancellation, and stability evidence.
- Privacy: the checkpoint and report retain metrics only. Audio and transcript content are discarded.
- Automated result: TypeScript passed; 19 Vitest files and 160 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.12` as the newest Private build on 2026-09-10.

Packaged iPhone 16 Pro Max `v0.1.12` targeted run reported on 2026-09-10:

- Report start: `2026-09-10T17:10:35.929Z`; online launch; exact iOS and Even App versions still pending.
- Cold readiness: `315 ms`, passed.
- Accuracy: the preserved result remained passed at WER `8.11%` with 2 critical-term errors. No phrase recordings were repeated.
- Short timing: 30-second recording 3 produced `961,600` PCM bytes and `30,050 ms` of PCM with `103 ms` final latency, passed.
- Long timing: the preserved result remained exactly `3,840,000` PCM bytes and `120,000 ms` of PCM, passed.
- Cancellation: the preserved result remained `60 ms` with no late transcript, passed.
- Stability: the targeted run completed without a crash and reported no failures.
- Result: all guided iPhone accuracy, recording-bound, latency, cancellation, and cycle-stability checks pass. Offline restart, process memory, residue inspection, exact software versions, and the Nothing Phone run remain pending.

Local offline-evidence candidate built and uploaded privately on 2026-09-10:

- Package version: `0.1.13`
- Artifact size: `46,655,754` bytes
- Artifact SHA-256: `246b1da254ccb9fff198797d0039d22889018d59364849a9b1f402fbefb1f564`
- Behavior: migrates the complete `0.1.12` checkpoint without requesting any recordings, preserves all prior results, and records fresh launch connectivity and readiness metadata for the offline-restart check.
- Privacy: the checkpoint and report retain metrics only. Audio and transcript content are discarded.
- Automated result: TypeScript passed; 19 Vitest files and 161 tests passed; build, package, package verification, and diff whitespace checks passed.
- Upload status: Passed. Even Hub accepted `v0.1.13` as the newest Private build on 2026-09-10.

Automated evidence completed on 2026-09-09:

- Exact PCM16 little-endian conversion, odd-byte rejection, 120-second bound, Worker backpressure, cancellation, and late-result rejection pass in Vitest.
- Missing, changed, truncated, extra, or wrong-hash model assets fail package verification or fail before Moonshine initialization.
- The uploaded threaded `0.1.4` package reported **This iPhone needs the single-thread local speech build** on the owner's iPhone 16 Pro Max. This device was initially misidentified as an iPhone 17 and corrected by the user on 2026-09-09. The iOS and Even App versions were not recorded, so this is capability-branch evidence only.
- The uploaded single-thread `0.1.5` package reached **Recording locally. Tap when you are done.** on the same iPhone 16 Pro Max, then returned a transcript in under one second after the final tap. This is a user-reported smoke-test measurement; the exact phrase, transcript, iOS version, and Even App version were not recorded.
- A desktop browser without cross-origin isolation reported Worker, WebAssembly SIMD, Cache API, and WebCrypto available with SharedArrayBuffer unavailable, selected the single-thread SIMD runtime, and initialized the bundled model in `1,568 ms`. This is diagnostic evidence only, not the required iPhone measurement.
- The vendored fallback glue and packaged WASM match the app-owned runtime manifest byte-for-byte; package verification rejects missing, changed, threaded, or unmanifested runtime material.
- The private `.ehpk` builds and passes the package scan with only the Atoms Plus HTTPS origin, no WebSocket speech route, no cloud speech provider endpoint, no provider secret, and no unmanifested model file.

### Required packaged run

Use the owner's iPhone 16 Pro Max as the iOS floor and the owner's available Nothing Phone as the Android target, each with physical G2 hardware. Record the exact OS version and Even App version before testing. A Nothing Phone pass is evidence for that recorded configuration only, not a general Android support claim.

The installed iPhone 16 Pro Max WebView reported **This iPhone needs the single-thread local speech build** for threaded package `0.1.4`. Package `0.1.5` contains the reproducible fallback. Private package `0.1.6` added the first guided sequence and exposed the two diagnostic defects recorded above. Corrected package `0.1.7` activates PCM collection before microphone acknowledgement, keeps long transcripts off the glasses result page, survives a glasses review-render failure, and reports per-phrase scores without transcript text. Package `0.1.8` checkpoints completed cycles so a relaunch resumes at the first unfinished check. Private package `0.1.9` migrates that checkpoint into five targeted phrase retests followed by one instrumented long check. Private package `0.1.10` migrates the completed `0.1.9` checkpoint into three remaining phrase retests and anchors the long-check timer to the first PCM packet. Private package `0.1.11` skips further accuracy work and stops the single long check from accepted PCM byte count. Private package `0.1.12` repeated and passed the remaining 30-second result. Candidate `0.1.13` requires no recordings and captures fresh launch metadata for the offline-restart check. Upstream does not publish a prebuilt single-thread WebAssembly artifact for `v0.1.5`.

For the offline restart check, install and open `0.1.13` once while online, fully close the Even App host, disable Wi-Fi and cellular data, then relaunch the private package. It should request no recordings. Copy the completed report and confirm `packageVersion` is `0.1.13`, `onlineAtLaunch` is `false`, `readinessPassed` is `true`, and `failures` is empty. Restore network access after copying the result. For memory, attach a platform process-memory profiler to the Even App host and record the tool, process, peak, the first-cycle retained value after an idle collection interval, and the twentieth-cycle retained value after the same interval. The WebView report is not a substitute for process-memory evidence.

| Target | Exact device | OS version | Even App version | Diagnostic report | Memory trace |
|---|---|---|---|---|---|
| iOS floor | iPhone 16 Pro Max | Pending | Pending | Accuracy, timing, cancellation, and cycle stability passed; offline restart pending `v0.1.13` | Pending |
| Android target | Nothing Phone, exact model pending | Pending | Pending | Pending | Pending |

| Measure | Required result | Packaged evidence |
|---|---|---|
| Hardware targets | iPhone 16 Pro Max iOS floor and recorded Nothing Phone target | iPhone guided run passed; Nothing Phone pending |
| Recording bound | 120 seconds, no missing or duplicate PCM | iPhone 16 Pro Max `v0.1.12`: all three 30-second recordings and the 120-second recording passed. Nothing Phone pending |
| Cold readiness | At most 15 seconds | iPhone 16 Pro Max `v0.1.12`: 315 ms, passed. Offline restart and Nothing Phone pending |
| Streaming and final latency | Real time; final transcript within 2 seconds | iPhone 16 Pro Max `v0.1.12`: 103 ms short-check final latency; preserved long-check latency 8 ms, passed. Nothing Phone pending |
| Memory stability | Peak at most 384 MiB; growth at most 16 MiB over 20 cycles | Blocked |
| Cancellation | Microphone and Worker stop within 500 ms; no actionable late text | iPhone 16 Pro Max `v0.1.8`: 60 ms with no late transcript, passed. Nothing Phone pending |
| Accuracy smoke | WER at most 20%; at most two meaning-changing errors | iPhone 16 Pro Max `v0.1.10`: WER 8.11% and 2 critical errors, passed. Nothing Phone pending |
| Asset delivery | Private portal accepts bundled package | Passed on 2026-09-10 through offline-evidence `0.1.13` |
| Package/device stability | 20 cycles without crash or jetsam; no audio or transcript residue | iPhone 16 Pro Max: 24 cycles plus targeted follow-up runs completed without recurrence; memory and residue evidence pending |

### Local capture POC

Private `0.1.15` is the deliberately small real flow: **New capture** records G2 PCM into the bundled phone-local Moonshine Worker, shows the exact transcript on the glasses and phone, and offers **Save** or **Try again**. Save sends only the reviewed transcript, capture timestamp, opaque ID, and matching fingerprint to the encrypted capture relay. Audio stays in the phone-hosted process and is discarded after transcription or cancellation. An older pairing without `g2:capture` returns to Connect instead of leaving a capture stuck. The packaged artifact is `46,658,955` bytes with SHA-256 `e5742879d9e3888e4d9dbe3248a89d862b7b0c785ca57d270e5d060fb3dd3883`.

Private `0.1.16` is the reviewed release candidate. It latches a synchronous local-audio ingestion failure, stops the microphone/session, and returns to a recoverable retry state instead of letting a backpressure or recording-limit exception escape the SDK callback. The packaged artifact is `46,659,089` bytes with SHA-256 `13578fdf164f4dd1a8ef66a077fa5090c59bc92eb1ea023642c58fc27d1f13e2`.

Private `0.1.17` addresses the iPhone pairing failure found on the physical iPhone 16 Pro Max. It reuses the live proof key during pairing and persists the non-extractable public and private `CryptoKey` entries separately instead of asking WebKit to clone a `CryptoKeyPair` wrapper. Non-code failures now report a secure-connection error instead of claiming the pairing code is invalid. The packaged artifact is `46,659,284` bytes with SHA-256 `be81f907bfddd29e15ccd4f38440c4907685750d06dd9757d8b48a6e0fe82e50`.

Private `0.1.18` handles upgraded installs whose legacy proof key can be loaded but cannot sign in WKWebView. It locally signs and verifies a restored key, migrates a usable legacy key to separate entries, or rotates an unusable key before pairing. The packaged artifact is `46,659,405` bytes with SHA-256 `e2c77ee4bd39cff0bd0bf37f38fd6b753eb7bba2dbaff1ee05be62548c60b42b`.

The paired Obsidian plugin claims a bounded batch with its verified Plus session, appends each capture idempotently to `Atoms System/Inbox.md`, re-reads the exact durable block, and only then acknowledges it. Acknowledgment immediately removes transcript ciphertext from the service. Newly imported captures are held in the editable Inbox for the rest of that automatic pass. The user can correct the text before the existing Inbox and filing pipeline processes it on a later manual pass or app launch. The companion says **Queued for Obsidian**, never **Saved to Atoms**.

This path uses no G2 OpenAI or Anthropic credential and consumes no filing credit. G2 pairing no longer depends on Ask mirror or connected-app write consent, and the private companion exposes only **New capture**. Normal Atoms classification still uses whichever engine the user already configured when the reviewed Inbox capture is processed.

Automated evidence: 20 companion Vitest files and 171 tests pass; the companion production build and package verification pass. All 720 Plus service tests pass. All 2,380 Obsidian tests pass. Plugin production build and lint pass. The security contract validates, including atomic current-authorization enqueue, confirmed-only payloads, tenant-scoped claim, durable marker-backed acknowledgment after user edits, ciphertext purge, and seven-day receipt reduction to a tombstone.

Production release 77 runs image `atoms-plus:deployment-01M26BNV4VW4TGSMM35AMNFXW9`. The relay table was created under the dark release first. After health and schema verification, relay-only encryption, DPoP nonce, retention, and dynamic iPhone loopback-origin secrets were configured and G2 was enabled. `/health` passed, a canonical loopback request reached the live G2 auth boundary with 401, a wrong Origin returned 403, and unauthenticated MCP POST remained 401. Private `0.1.18` was uploaded to Even Hub on 2026-09-10 and supersedes `0.1.17` with legacy-key recovery for upgraded iPhone installs.

Record both installed devices, OS versions, Even App versions, WebView capability JSON, readiness and final-latency values, attached-process memory measurements, 20-cycle result, accuracy-corpus result, offline restart, network trace, storage/log inspection, and portal acceptance here. A missing value fails the gate. A no-go stops this plan for a local-engine decision and must not restore cloud transcription.

## Automated package gates

- [x] Exact SDK `0.0.15`, CLI `0.1.14`, simulator `0.9.5`, and Even App `2.2.10` floor
- [x] Network and microphone are the only permissions
- [x] HTTPS and WebSocket destination allowlists are exactly `plus.tryatoms.app`
- [x] Strict CSP, build, private package, and package secret scan
- [x] Feature-off, ticket replay, exact HTTPS or sentinel-validated dynamic loopback Origin, revocation race, encryption, rotation, migration, and rollback tests
- [x] Pinned simulator automation API contract includes input, console, and 576 by 288 screenshots

## Simulator evidence

- [x] Root, New atom, Ask atoms, Recent atoms, source opening, and body pagination screenshots
- [ ] Setup required, revoked, offline, empty, queued, saved, and safe exit screenshots
- [x] Console export has no uncaught error or failed private-content request

### Run the local simulator profile

From `companion/even-g2`, first verify the loopback stack without opening the simulator:

```bash
npm run simulator:services
```

Then launch the deterministic provider, real Plus service in memory mode, Vite, and the pinned Even Hub simulator together:

```bash
npm run simulator
```

The command prints a short-lived pairing code for diagnostics, passes it only to the loopback simulator entry, and uses the rendered phone controls to choose **Connect** and **Accept and continue** automatically. This exercises the real pairing and disclosure handlers; it does not bypass either server gate. On the glasses, a click starts the selected New atom or Ask recording and the next click stops it. Up/down moves the selection, a click opens Recent/source/body rows, and a double-click from the root exits. The local transcription fixture alternates between a Cobalt capture and a Cobalt question, so run New atom before Ask when exercising both. The harness acknowledges G2 create outbox rows as a throwaway paired vault would, allowing Queued to advance to Saved when selected again.

The automation API is `http://127.0.0.1:9898`:

```bash
curl -fsS http://127.0.0.1:9898/api/ping
curl -fsS -X POST -H 'content-type: application/json' \
  -d '{"action":"click"}' http://127.0.0.1:9898/api/input
curl -fsS -o glasses.png http://127.0.0.1:9898/api/screenshot/glasses
curl -fsS -o webview.png http://127.0.0.1:9898/api/screenshot/webview
curl -fsS http://127.0.0.1:9898/api/console
```

Use `--plus-port`, `--provider-port`, `--vite-port`, or `--automation-port` after `node scripts/simulator-harness.mjs` when a default port is occupied. Every listener and URL is restricted to `127.0.0.1`; the harness refuses production mode, clears provider/delivery credentials in its child service, and is excluded from `index.html`, the production build, and the `.ehpk`. Press Ctrl-C once to stop every child process. Restart the command to mint a fresh code after expiry.

## Local G2 evidence

- [ ] Temple and R1 gestures match the interaction map
- [ ] Microphone permission, audio quality, and two-minute ceiling
- [ ] Disconnect during recording preserves recoverable audio while the host remains alive
- [ ] Five-minute foreground resume while the iPhone host remains alive, plus Android cold-start recovery
- [ ] Root exit confirmation stops microphone, socket, and subscriptions

The private iPhone v1 is intentionally session-only. If iOS terminates the Even Hub host, open Atoms and pair again. Audio and proposals interrupted by that process restart cannot be recovered; confirm this fails safely without sending or committing stale content.

## Private package and Beta evidence

- [x] Upload the generated `.ehpk` as Private through the Even developer portal
- [x] Record the installed iPhone WebView Origins: `http://127.0.0.1:59134`, then `http://127.0.0.1:59263` after a process restart; the changed port proves dynamic loopback hosting
- [x] After the supporting server image is deployed dark, configure `G2_APP_ORIGIN=http://127.0.0.1:*`; verify a canonical `http://127.0.0.1:<valid-port>` Origin reaches authentication and a wrong Origin is rejected
- [ ] Run create, mirror receipt, query, source, and recent flows against a throwaway vault
- [ ] Lock the phone during recording, query, and queued states
- [ ] Leave the app idle for two minutes, then reconnect without duplicate provider work
- [ ] Interrupt the iPhone process, confirm Atoms returns to pairing without an automatic commit, and verify the next pairing starts cleanly

## Public submission

- [ ] Attach Private and Beta evidence to the release review
- [ ] Record provider data-control review and current retention wording
- [ ] Record physical G2 session-loss evidence on iPhone and recovery evidence on Android
- [ ] Submit to public Even Hub review

Public submission is intentionally unchecked. These are human-owned gates.
Private G2 is enabled for the capture-relay test after the dark schema deployment, relay-only secret configuration, and production boundary checks above. No dedicated model-provider key is required. Public submission remains blocked.
