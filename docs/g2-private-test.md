# Even G2 private test checklist

This checklist separates automated evidence from checks that need the owner's glasses or Even developer portal. Do not describe the companion as public while any public-release box is unchecked.

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

- [ ] Install the generated `.ehpk` as Private through the Even developer portal
- [x] Record the installed iPhone WebView Origins: `http://127.0.0.1:59134`, then `http://127.0.0.1:59263` after a process restart; the changed port proves dynamic loopback hosting
- [ ] After the supporting server image is deployed dark, configure `G2_APP_ORIGIN=http://127.0.0.1:*`; verify the service echoes only each exact canonical `http://127.0.0.1:<valid-port>` request Origin and rejects every other wildcard, host, scheme, or malformed form
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
Keep `G2_ENABLED=0` until the installed Private/Beta package has supplied the request-Origin evidence above.
Deploy supporting code with `G2_ENABLED=0` before setting the sentinel. Configure dedicated provider, data-encryption, DPoP nonce, retention, and origin secrets next; enable private G2 only after readiness passes. Public submission remains blocked.
