# Even G2 private test checklist

This checklist separates automated evidence from checks that need the owner's glasses or Even developer portal. Do not describe the companion as public while any public-release box is unchecked.

## Automated package gates

- [x] Exact SDK `0.0.15`, CLI `0.1.14`, simulator `0.9.5`, and Even App `2.2.10` floor
- [x] Network and microphone are the only permissions
- [x] HTTPS and WebSocket destination allowlists are exactly `plus.tryatoms.app`
- [x] Strict CSP, build, private package, and package secret scan
- [x] Feature-off, ticket replay, exact Origin, revocation race, encryption, rotation, migration, and rollback tests
- [x] Pinned simulator automation API contract includes input, console, and 576 by 288 screenshots

## Simulator evidence

- [ ] Root, New atom, Ask atoms, Recent atoms, source opening, and body pagination screenshots
- [ ] Setup required, revoked, offline, empty, queued, saved, and safe exit screenshots
- [ ] Console export has no uncaught error or failed private-content request

## Local G2 evidence

- [ ] Temple and R1 gestures match the interaction map
- [ ] Microphone permission, audio quality, and two-minute ceiling
- [ ] Disconnect during recording preserves recoverable audio
- [ ] Five-minute foreground resume on iOS and Android
- [ ] Root exit confirmation stops microphone, socket, and subscriptions

## Private package and Beta evidence

- [ ] Install the generated `.ehpk` as Private through the Even developer portal
- [ ] Record the actual `Origin` header emitted by the installed Private/Beta WebView and configure that one exact HTTPS value as `G2_APP_ORIGIN`; the destination allowlist is not evidence of the request Origin
- [ ] Run create, mirror receipt, query, source, and recent flows against a throwaway vault
- [ ] Lock the phone during recording, query, and queued states
- [ ] Leave the app idle for two minutes, then reconnect without duplicate provider work
- [ ] Interrupt the phone process and resume without an automatic commit

## Public submission

- [ ] Attach Private and Beta evidence to the release review
- [ ] Record provider data-control review and current retention wording
- [ ] Record physical G2 recovery evidence on both supported phone platforms
- [ ] Submit to public Even Hub review

Public submission is intentionally unchecked. These are human-owned gates.
Keep `G2_ENABLED=0` until the installed Private/Beta package has supplied the request-Origin evidence above.
