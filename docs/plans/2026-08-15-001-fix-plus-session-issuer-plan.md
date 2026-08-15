# A Plus session remembers the server that issued it — plan (#508)

**Claim:** [#508](https://github.com/taihartman/obsidian-atoms/issues/508)
**Branch:** `claude/plus-session-issuer`, base `master` (`36aea09`)
**Origin:** finding **B1** in the #500 adversarial pass. Handoff:
`docs/handoffs/2026-08-15-plus-session-issuer.md`

**Lane:** full
**Why:** this is an auth and egress-control surface. The diff is small and the lane rule in
`CLAUDE.md` is explicit that small diffs on security surfaces do not qualify for the amend lane.
**Doc-review:** light headless coherence + feasibility, plus a security lens. No product or design
surface moves; the only user-visible change is one refusal message and one extra round trip.
**Done when:** a session records the base that issued it; a content-bearing call at a base that did
not issue the session is refused until a content-free `/v1/me` at that base accepts the token; each
new guard has been **seen to fail** when neutered; `npm run build && npm test && npm run lint` green;
a live vault smoke shows the refusal with no capture text on the wire.

---

## The bug, stated once

A user signed in to their own Plus server who clears `Plus service URL` silently starts sending
their session token **and their verbatim capture text** to `plus.tryatoms.app`. Self-hosting exists
so note text never reaches the hosted service. This reverses that, with no warning: on screen the
user sees only `Couldn't reach Atoms Plus — check your connection and try again.`

Proven live in the #500 adversarial pass with a `window.fetch` recorder that blocked real egress, so
"no call" and "call to the wrong host" were distinguishable. Five `/v1/classify` calls carried
capture bodies and the vault title list. Evidence:
`docs/qa/screenshots/500-plus-base-url-guard/adversarial-B1-selfhost-token-to-production.png`.

**Cause.** 23 call sites resolve the base as `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL`.
Empty has always meant production. #500 added a guard that refuses *invalid* values and deliberately
does not fall back to the hosted default. That covers every input class except the one that is not
invalid at all: **absent**. Clearing a field is also far likelier than typing something malformed.

## The shape of the fix

Two halves, settled in the handoff. Do not relitigate.

**(a) The session records the base that issued it.** `PlusSession` gains `issuedBase`. It is set
from the base that actually returned 2xx for that token, not from whatever is configured.

**(b) Content-bearing egress is gated on a match.** When the resolved base differs from the
session's issuer, the session is *unverified at this base*: classify and mirror push are refused
until a **content-free** `GET /v1/me` at the resolved base accepts the token. `/v1/me` sends the
bare token and nothing else, so the worst case is a token reaching a host the user configured, and
never note text.

On a 2xx the session is re-stamped with the new base and normal service resumes. That is what makes
this survive `cloudflared tunnel --url`, which mints a fresh random subdomain on every start: same
server, new URL, one extra round trip, no sign-out.

### Why not the alternatives

- **Dropping the session when the base changes** signs out self-hosters on every quick-tunnel
  rotation. Rejected.
- **A confirm dialog on clear** cannot tell a self-host session from a production one, so it
  interrupts users for whom clearing is harmless, and it never fires for a base arriving through
  Obsidian Sync rather than from someone typing. It substitutes a prompt for information the plugin
  should simply have, which is what (a) supplies. Rejected.
- **Narrowing the allowed scheme set** is not on the table. `https` on any host stays allowed;
  self-hosters need arbitrary HTTPS.

## KTD1 — what an absent `issuedBase` means

**PENDING USER DECISION. Blocks U3 onward; U1 and U2 can proceed without it.**

Sessions already on disk carry no issuer. Three readings:

| Option | Upgrade cost | Residual hole |
|---|---|---|
| **Unknown = unverified** (recommended) | one content-free `/v1/me` before the first content call | none |
| Unknown = production | none | self-hosters with a cleared field keep leaking until they re-sign-in; fix protects new sessions only |
| Unknown = mismatch | same as row 1 in practice | none |

Rows 1 and 3 collapse together: the settled design treats a mismatch as *pause and re-verify*, not
as sign-out, so "mismatch" does not cost a sign-out here. Row 2 is the only one that materially
differs, and it grandfathers in exactly the state #508 exists to catch.

The plan below is written for **row 1**. If the user picks row 2, U3 changes to
`session.issuedBase ?? DEFAULT_PLUS_BASE_URL` and the migration tests invert.

## KTD2 — comparison is normalized, and normalization is narrow

`https://my.host/` and `https://my.host` are the same server. `https://my.host` and
`https://my.host:8443` are not, and neither are two different quick-tunnel subdomains of the same
machine — the plugin cannot know that, and guessing is how a guard fails open.

Normalize: strip trailing slashes, lowercase scheme and host. Nothing else. Port, path and
case-sensitive path segments all remain significant. One shared helper so the stamp side and the
compare side can never drift.

## KTD3 — the gate fails closed, including offline

If `/v1/me` cannot complete (network error, status 0, timeout) the session stays unverified and the
content-bearing call is refused. A security gate that treats "I could not check" as "go ahead" is
not a gate. The cost is that a self-hoster whose server is down cannot classify, which is already
true: their classify call would fail anyway. What changes is that it fails *before* the capture text
leaves the device instead of after.

## KTD4 — the stamp is a required parameter, not an optional field

`installPlusSession` gains a required `issuedBase` argument rather than relying on callers to
remember a new optional property. All four acquisition paths then fail to compile until they supply
it. This is the "make illegal states unrepresentable" rule: a forgotten stamp must be a build error,
not a silent fail-open at runtime.

## What the survey found that changes the work

- `parsePlusSession` (`src/platform/filingAuth.ts:215`) and `serializePlusSession` (`:264`) are
  explicit field allowlists. **A field added only to the type silently vanishes on the first
  round trip**, and the guard would then fail open on every device. This is the single highest-risk
  detail in the change.
- Every *acquisition* path goes through `installPlusSession`. Every *mutation* path does not:
  `plusRefresh.ts:120` and `main.ts:2506` call `writePlusSession` directly. Both **spread** the
  existing session, so the new field survives. Verified, but it needs a regression test each, because
  a future refactor to a fresh literal would blank the issuer and fail open.
- `settings.ts:2708` (`savePastedSession`) is the only `installPlusSession` caller that builds a
  fresh literal. It is also the paste path, the one most likely to be pointed at a base someone else
  supplied.
- `resolveClassifyAuth` (`src/platform/classifyAuth.ts:76-97`) resolves and snapshots the base once
  per run and already owns the #500 refusal. It is the choke point for all four classify entries
  (Process, Preview, Update, auto-run).
- `savePastedSession` is the one Plus call that bypasses `plusRequest`; it hand-rolls `requestUrl`.
  It carries no content, so it is not gated, but it must still stamp.

### Content-bearing sites to gate (4)

| Site | Carries |
|---|---|
| `src/platform/classifyAuth.ts:77` | the snapshot handed to classify |
| `src/plugin/main.ts:1199` | auto-run classify |
| `src/plugin/main.ts:2500` | Process / Preview / Update classify |
| `src/plugin/askCoordinator.ts:323` | Ask mirror upsert, atom title and body |

The other 19 resolutions are content-free (token, email, or billing only) and are out of scope.
`askCoordinator.ts:200` (outbox ack, sends id and status) is a judgement call: gated, because a
status ack still names the user's atoms.

## Units

**U1 — the session carries its issuer.**
`issuedBase?: string` on `PlusSession`; add to **both** allowlists. Add
`normalizePlusBase(raw): string` and `plusBaseMatches(a, b): boolean` next to
`isAllowedPlusBaseUrl`. Tests: round-trip through serialize/parse preserves it; a stored session
without the field parses to `undefined` rather than throwing; the normalization table, including the
port and path cases from KTD2.

**U2 — stamp at acquisition.**
`installPlusSession(host, session, issuedBase)` with `issuedBase` required. Thread it through all
four callers: `settings.ts:2567` (trial), `:2602` (subscribe), `:2708` (paste, fresh literal),
`plusSignIn.ts` via `main.ts:2058` (magic link). Each supplies the base it actually talked to, not
the one currently configured. Tests: each path stamps; the two direct `writePlusSession` callers
preserve an existing stamp.

**U3 — verification. Depends on KTD1.**
New `src/platform/plusBaseVerify.ts`: given a session and a resolved base, return `verified`,
`refused`, or `unreachable`. Match on normalized bases; on mismatch or `undefined`, issue a
content-free `GET /v1/me`; on 2xx re-stamp and persist; on 401 refuse; on anything else
`unreachable`. Tests assert **`expect(request).not.toHaveBeenCalled()`** for every content-bearing
path in the refused and unreachable cases. A returned error object only proves a branch was chosen.

**U4 — gate classify.**
Refuse in `resolveClassifyAuth` with a new `ClassifyAuthFail`, and mirror it at `classify.ts:761` as
the egress-layer backstop, per
`docs/solutions/security/consent-gate-must-be-checked-at-egress-not-at-entry.md`.

**U5 — gate mirror push.** Same gate at `askCoordinator.ts:323` and the outbox ack at `:200`.

**U6 — the docs stop hedging.** The #508 comment at `plusClient.ts:259-268` and the warning in
`docs/ask-self-host.md` both describe this as an open gap. Both must be rewritten when this lands or
the docs lie in the other direction. Bump `manifest.json` + `package.json` + `versions.json` to
`0.8.0-beta.7`.

**U7 — neuter each guard and watch the tests fail.** Two #500 tests passed against a broken guard
until this was done. It is a required step, not a nicety.

## Copy

One new refusal message. No em dashes: `test/copyVoice.test.ts` enforces that plugin-wide over
string, template and regex literals. Draft, subject to `atoms-voice`:

> `Atoms Plus can't confirm your sign-in at this address. Check the Plus service URL in settings.`

It must not say "your token was not sent", which invites the question of when it is. It should point
at the field, because the field is what the user changed.

## Out of scope

- The 19 content-free base resolutions.
- `docs/ask-self-host.md`'s tunnel guidance itself.
- [#394](https://github.com/taihartman/obsidian-atoms/issues/394), the `onExternalSettingsChange`
  generation-mismatch early return. Noted because `plusBaseUrl` is synced through `data.json` while
  session state is device-local, so a base can change remotely. This design tolerates that: the gate
  is at egress and reads the base at call time, so it never needs to hook the change event. Do not
  hang security behaviour off that hook.

## Risks

| Risk | Mitigation |
|---|---|
| New field dropped by the parse/serialize allowlists, guard fails open everywhere | U1 round-trip test; U7 neuter check |
| A future refactor rebuilds a session as a fresh literal and blanks the issuer | regression test on both direct `writePlusSession` callers |
| Extra `/v1/me` on every classify if the re-stamp does not persist | assert the stamp is written, and that a second call issues no second `/v1/me` |
| Quick-tunnel rotation reads as an attack | by design it is one round trip and a re-stamp, never a sign-out; covered by a test named for the rotation case |
