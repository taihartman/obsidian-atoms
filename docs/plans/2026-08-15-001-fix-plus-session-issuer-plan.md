# A Plus session remembers the server that issued it — plan (#508)

**Claim:** [#508](https://github.com/taihartman/obsidian-atoms/issues/508)
**Branch:** `claude/plus-session-issuer`, base `master` (`36aea09`)
**Origin:** finding **B1** in the #500 adversarial pass. Handoff:
`docs/handoffs/2026-08-15-plus-session-issuer.md`

**Lane:** full
**Why:** this is an auth and egress-control surface. The diff is small and the lane rule in
`CLAUDE.md` is explicit that small diffs on security surfaces do not qualify for the amend lane.
**Doc-review:** headless, four lenses — coherence, feasibility, security, adversarial. No product or
design surface moves; the user-visible change is two Notices and one extra round trip. Cross-model
peer pass skipped for a light gate; recorded rather than implied.
**Done when:** a session records the base that issued it; a content-bearing call at a base that did
not issue the session is refused until a content-free `/v1/me` at that base returns an entitlement
whose email matches the session; each new guard has been **seen to fail** when neutered;
`npm run build && npm test && npm run lint` green; a live vault smoke shows the refusal with no
capture text on the wire.

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

**This plan closes the capture-text half of that sentence, not the token half.** The 17 content-free
resolutions still send the session token to whatever base is resolved, including
`refreshEntitlementIfPeriodEnded` (`main.ts:2434-2455`), which fires at plugin load with no user
behind it. The `/v1/me` probe this fix introduces *deliberately* sends the token to the resolved base
before it can refuse — that is inherent, since the check cannot gate itself. Note text is what the
self-hosting promise is about and note text is what stops moving. Anyone reading #508 as "the token
no longer leaks" is reading it wrong, and the plan says so here rather than letting
"content-free, out of scope" imply the credential is protected.

**Cause.** 23 call sites resolve the base as `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL`.
Empty has always meant production. #500 added a guard that refuses *invalid* values and deliberately
does not fall back to the hosted default. That covers every input class except the one that is not
invalid at all: **absent**. Clearing a field is also far likelier than typing something malformed.

## The shape of the fix

Two halves, settled in the handoff. Do not relitigate.

**(a) The session records the base that issued it.** `PlusSession` gains **two** fields, not one:
`issuedBase`, written once at acquisition and never rewritten, and `verifiedBase`, updated on each
successful re-verification. Both are set from a base that actually accepted the token and named the
right account, never from whatever is configured.

Two fields rather than one because a single mutable stamp destroys its own evidence. After the first
tunnel rotation, a one-field design can no longer tell a self-host session from a production one —
which is precisely the information the plan says the rejected confirm-dialog lacked and that half
(a) exists to supply. Keeping the acquisition base immutable means one accidental verification is
still recoverable, and any later self-host-aware surface has something to read. The gate compares
`verifiedBase`; `issuedBase` is for warnings and audit.

**(b) Content-bearing egress is gated on a match.** When the resolved base differs from the
session's issuer, the session is *unverified at this base*: classify and mirror push are refused
until a **content-free** `GET /v1/me` at the resolved base accepts the token. `/v1/me` sends the
bare token and nothing else, so the worst case is a token reaching a host the user configured, and
never note text.

On success the session is re-stamped with the new base and normal service resumes. That is what
makes this survive `cloudflared tunnel --url`, which mints a fresh random subdomain on every start:
same server, new URL, one extra round trip, no sign-out.

**Success is not a bare 2xx.** A 2xx proves a server is *willing to accept* a token, not that it
issued one, and a host that accepts every token passes that test trivially — after which it becomes
the permanent stamped issuer and capture text flows there unchecked. Re-stamp only when the
entitlement body's `email` matches the stored `session.email`, case-insensitively. A host that never
issued the token cannot know which account it belongs to. The repo already holds this predicate:
`getEntitlement` (`plusClient.ts:696-720`) returns the account email and rejects a partial 2xx, and
`savePastedSession` (`settings.ts:2696-2700`) already refuses a `/v1/me` reply carrying no email.

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

**DECIDED 2026-08-15, user-directed: row 1, with the carve-out below.** An absent issuer means
*unknown*, never *production*. The plugin does not guess where a session came from.

Sessions already on disk carry no issuer. Three readings:

| Option | Upgrade cost | Residual hole |
|---|---|---|
| **Unknown = unverified** (recommended, with the carve-out below) | one content-free `/v1/me` before the first content call, for every existing session | none, once carved out |
| Unknown = production | none | self-hosters with a cleared field keep leaking until they re-sign-in; fix protects new sessions only |
| Unknown = mismatch | same as row 1 in practice | none |

Rows 1 and 3 collapse together: the settled design treats a mismatch as *pause and re-verify*, not
as sign-out, so "mismatch" does not cost a sign-out here. Row 2 is the only one that materially
differs, and it grandfathers in exactly the state #508 exists to catch.

### The carve-out row 1 needs, or it reproduces the bug on the first run

The safety argument for the probe is that the token only ever reaches "a host the user configured."
**That condition does not hold in the absent case.** For the exact user #508 exists to protect — a
self-hoster who already cleared the field — an unknown issuer plus an empty `plusBaseUrl` resolves
to `DEFAULT_PLUS_BASE_URL`, so row 1's *first act on upgrade* would be to send their self-host token
to `plus.tryatoms.app`. Less than the status quo, which also sends their note text, but it is not
nothing, and it is the one case the whole change is for.

So row 1 is conditional on the field:

- **unknown issuer + a configured base** → probe it. The user chose that host.
- **unknown issuer + an empty field** → treat it as *no base at all*, not as the hosted default.
  Refuse content-bearing calls until the address is confirmed. Do not auto-probe.

That single carve-out is what makes row 1's residual hole actually "none" rather than "one token".

**The carve-out is bounded to the upgrade cohort. It is not a new meaning for an empty field.**
`plusBaseUrl` ships as `""` (`shared/types.ts:225`), so empty is the *normal* state for every hosted
user, and redefining it as "not connected" would strand nearly the whole install base. It does not
need redefining: from U2 onward a hosted user's session is stamped `plus.tryatoms.app` at sign-in,
their field stays empty, the resolved base matches the stamp, and nothing ever prompts. The session
knows, so the field does not have to mean anything. The only population that cannot be told apart is
the one that upgrades with no stamp *and* an empty field, and that state is one-time and
self-clearing.

**Surface it as a state, not a dialog** (user-directed, on the Apple read). No modal asking the user
to re-supply something the plugin lost track of. Settings shows Atoms Plus as needing its address
confirmed, with the field and its existing inline error region (`settings.ts:1490-1500`) doing the
work; a content-bearing call in that state refuses with the Notice pointing at Settings; nothing is
sent anywhere until it resolves. The feature is visibly off rather than quietly re-pointed.

If row 2 had been chosen, U3 would instead read `session.issuedBase ?? DEFAULT_PLUS_BASE_URL`, the
carve-out would disappear, and the migration tests would invert. It was not chosen: it grandfathers
in exactly the state #508 exists to catch.

## KTD2 — comparison is normalized, and normalization is narrow

`https://my.host/` and `https://my.host` are the same server. `https://my.host` and
`https://my.host:8443` are not, and neither are two different quick-tunnel subdomains of the same
machine — the plugin cannot know that, and guessing is how a guard fails open.

Normalize: strip trailing slashes, lowercase scheme and host. Nothing else. Port, path and
case-sensitive path segments all remain significant. One shared helper so the stamp side and the
compare side can never drift.

**Specify the default-port case explicitly, because the two obvious implementations disagree.**
`new URL()`, which `isAllowedPlusBaseUrl` already uses, drops a default port, so `https://h` and
`https://h:443` normalize *equal* under a URL-based helper and *unequal* under a string-based one.
Both directions fail safe — a spurious mismatch costs one probe — but the helper must state which,
or the stamp and compare sides can drift apart later. Take the `new URL()` behaviour: it is the
same parser the existing guard uses, and treating `:443` as distinct from the default would be
wrong on the merits.

## KTD3 — the gate fails closed, including offline

If `/v1/me` cannot complete (network error, status 0, timeout) the session stays unverified and the
content-bearing call is refused. A security gate that treats "I could not check" as "go ahead" is
not a gate.

**Be honest about who pays.** Under KTD1 row 1 every session on disk is unverified at upgrade, so
the first content call for *every* user depends on a live `/v1/me` — including hosted users who
changed nothing. "Their classify call would fail anyway" is true for a self-hoster whose server is
down; it is not a description of the whole cohort this gate stops. A briefly offline hosted user
must therefore not be told to check a settings field they never touched and must not change:
`unreachable` gets its own copy, naming the connection, distinct from the `refused` copy that names
the field.

For a self-hoster whose server is down the cost is real but pre-existing: their classify call would
have failed regardless. What changes is that it fails *before* the capture text
leaves the device instead of after.

## KTD4 — the stamp is a required parameter, not an optional field

`installPlusSession` gains a required `issuedBase` argument rather than relying on callers to
remember a new optional property. All four acquisition paths then fail to compile until they supply
it. This is the "make illegal states unrepresentable" rule: a forgotten stamp must be a build error,
not a silent fail-open at runtime.

**A required `string` enforces presence, not provenance — so it must not be a bare `string`.** The
realistic failure here is not a forgotten stamp but a *wrong* one. A caller can satisfy the compiler
with `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL`, the idiom already sitting at all 23
sites, which makes `issuedBase` equal the resolved base by construction, so `plusBaseMatches` always
returns true and the gate never fires on any device. That is the same fail-open the compile error
was supposed to prevent, moved to whoever writes the next call site. So `issuedBase` is a **branded
type minted only by the helper that performs the acquisition round trip** and returned alongside the
response. A base read from settings is then not assignable, and presence and provenance both fail at
build time.

**The required argument also has to reach the acquisition site, not just the nearest wrapper.** Two
indirections sit between the magic-link exchange and `installPlusSession`: the port
`PlusSignInHost.installSession` (`plusSignIn.ts:124`, called at `:306`) and the wrapper
`AtomsPlugin.installPlusSession` (`main.ts:2066`). Adding the parameter only to the platform
function forces the *wrapper* to supply one, which it can satisfy by re-reading
`this.settings.plusBaseUrl` — precisely the "whatever is configured" source U2 forbids, and it
compiles. So the port signature widens too, and the wrapper takes and forwards `issuedBase` instead
of resolving one. Otherwise KTD4 buys nothing on the path most likely to be wrong.

## What the survey found that changes the work

- **There are three allowlists on the path from disk to the gate, not two.** `parsePlusSession`
  (`src/platform/filingAuth.ts:215`) and `serializePlusSession` (`:264`) are explicit field
  allowlists, and so is the `FilingAuth` plus variant (`:65-73`), which `resolveFilingAuth`
  (`:89-130`) fills field by field at `:98-106` and `:113-121`. `resolveClassifyAuth` never sees a
  `PlusSession` at all, only that projection. **A field added to the type but not to all three
  silently vanishes before it reaches the gate**, and the guard then fails open on every device.
  This is the single highest-risk detail in the change.
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

### Sites to gate (6)

| Site | Carries |
|---|---|
| `src/platform/classifyAuth.ts:77` | the snapshot handed to classify |
| `src/plugin/main.ts:1199` | auto-run classify |
| `src/plugin/main.ts:2500` | Process / Preview / Update classify |
| `src/plugin/askCoordinator.ts:323` | Ask mirror upsert, atom title and body |
| `src/plugin/askCoordinator.ts:200` | outbox ack. Not just id and status: `askOutboxAck` (`plusClient.ts:1185-1199`) also sends `error`, which at `catchUp.ts:314` is `plan.reason`, free text rather than a fixed literal. Gated |
| `src/settings/settings.ts:1207` | Connect destination. Carries no note text, gated anyway: `askMcpUrl(base)` prints an origin and tells the user to paste it into Claude or ChatGPT and complete OAuth, and `askMcpPair` then sends the session token there. Publishing an origin for a third party to authenticate against under the user's Plus identity is egress with extra steps, and sorting it as "content-free" is the exact axis the #500 learning warns is insufficient. The invalid-base refusal branch at `:1213` already exists; this adds the unverified-at-this-base case beside it |

**One more sender carries content and is still not gated, deliberately.** `sendPlusMagicLink`
(`settings.ts:1964`) posts `{ email, verifierHash, vault }` to `/v1/auth/magic-link`, where `vault`
is `app.vault.getName()` (`settings.ts:1942-1945`) — often a self-descriptive string, and the
codebase already treats it as sensitive at `plusSignIn.ts:221`. The issuer gate cannot cover it:
there is no session at magic-link time, so there is nothing to compare a base against. Recorded here
as accepted out of scope rather than filed under "content-free", because the difference matters and
the "token, email, or billing only" claim would otherwise be false.

The remaining 16 resolutions are content-free and are out of scope. That count is an enumeration,
not an assertion — U7 makes it a test, because the #500 learning is that a claimed-complete sender
list is exactly what failed last time.

## Units

**U1 — the session carries its issuer.**
`issuedBase?: IssuedBase` (immutable, branded per KTD4) and `verifiedBase?: string` (mutable) on
`PlusSession`; add **both** to **all three** allowlists — `parsePlusSession`,
`serializePlusSession`, and the `FilingAuth` plus variant (`filingAuth.ts:65-73`) together with both
`mode: "plus"` return literals in `resolveFilingAuth` (`:98-106`, `:113-121`). Add
`normalizePlusBase(raw): string` and `plusBaseMatches(a, b): boolean` next to
`isAllowedPlusBaseUrl`. Tests: the field survives the **full** disk → `parsePlusSession` →
`resolveFilingAuth` → `resolveClassifyAuth` path, not just a serialize/parse round trip; a stored
session without the field parses to `undefined` rather than throwing; the normalization table,
including the port and path cases from KTD2.

**U2 — stamp at acquisition.**
`installPlusSession(host, session, issuedBase)` with `issuedBase` required. Thread it through all
four callers: `settings.ts:2567` (trial), `:2602` (subscribe), `:2708` (paste, fresh literal),
`plusSignIn.ts` via `main.ts:2058` (magic link, which also needs the port and wrapper widened per
KTD4). Each supplies the base it actually talked to, not the one currently configured. Tests: each
path stamps; the two direct `writePlusSession` callers preserve an existing stamp.

**U3 — verification.** Implements KTD1 row 1 plus the carve-out: an absent stamp is *unknown*, and
unknown with an empty field does not probe at all.
New `src/platform/plusBaseVerify.ts`: given a session and a resolved base, return `verified`,
`refused`, or `unreachable`. Match on normalized bases; on mismatch or `undefined`, verify by
calling the **existing** `getEntitlement` (`plusClient.ts:696`) with
`{ baseUrl: resolvedBase, request: plusFetchRequest }` rather than hand-rolling a probe. That
inherits the #500 base guard inside `plusRequest` and the typed `PlusApiError`. Map its result the
way `plusRefresh.ts:100-104` already does: `ok` **and the returned email matches `session.email`**
(case-insensitively) → verified, re-stamp and persist; `ok` with a missing or different email →
refused, exactly like an auth failure; `code === "auth"` → refused; everything else, including
`network` and 5xx → `unreachable`. Branching on raw status codes instead would read a proxy 401 as a
session refusal and contradict an established convention.

Persist the re-stamp through `writePlusSession`, **not** `installPlusSession`. The install boundary
runs the Ask-mirror identity and disarm check (#393), which must not fire for a same-account base
change: the account did not change, only the host did. Spread the existing session so no other field
is disturbed, matching `plusRefresh.ts:120`.

On `unreachable`, do not re-probe on every attempt. That hands the token to a 5xx host once per
classify attempt instead of once per run. Cache the verdict for the run.

Tests assert **`expect(request).not.toHaveBeenCalled()`** for every content-bearing path in the
refused and unreachable cases. A returned error object only proves a branch was chosen.

**U4 — gate classify.**
Refuse in `resolveClassifyAuth` with a new `ClassifyAuthFail`, and mirror it at `classify.ts:761` as
the egress-layer backstop, per
`docs/solutions/security/consent-gate-must-be-checked-at-egress-not-at-entry.md`.

Three signature facts the implementer needs up front, or U4 stalls:

- `resolveClassifyAuth` is **synchronous today and has no request function, no `PlusClientConfig`
  and no `LocalStorageLike`**. It becomes `async` and takes the U3 entry point as an injected
  dependency, already bound to `plusFetchRequest` and to the storage that persists the re-stamp.
- That ripples to `requireClassifyAuth` (`main.ts:2495`), also synchronous, and its five call sites
  (`:613`, `:1645`, `:2562`, `:2749`, `:3089`). The auto-run side is already safe:
  `AutoFilingCycle.gate` accepts `Promise<AutoFilingGate>` (`autorun.ts:286`), so `main.ts:1198`
  needs no contract change.
- The `classify.ts:761` backstop has nothing to test against today: `ClassifyDeps.plus` is
  `{ baseUrl, sessionToken, onRemaining? }` (`classify.ts:724-729`). It gains a required
  `verifiedBase: string`, set by `resolveClassifyAuth` from the post-verification issuer, and the
  backstop refuses on `!plusBaseMatches(plus.verifiedBase, plus.baseUrl)` — a synchronous
  comparison. The network verification stays in U3. Without this the backstop degenerates into
  re-running `isAllowedPlusBaseUrl`, which is the #500 check, not the #508 one.

**U5 — gate mirror push.** Same gate at `askCoordinator.ts:323` and the outbox ack at `:200` — and
the same **egress backstop** U4 insists on, placed inside `askMirrorUpsert`, `askMirrorDelete` and
`askMirrorReconcile` in `plusClient.ts`. U4 accepts the argument that safety is a property of
whoever currently builds the request; declining to apply it to the path carrying atom bodies would
be inconsistent. `askCoordinator.ts:313-323` is not the only place a mirror config is built —
`settings.ts:1207` builds its own — so a future content-bearing caller assembled elsewhere would
bypass a coordinator-only gate with no test noticing.

`askCoordinator.ts:323` covers three endpoints, not one: upsert (atom bodies), `mirror/delete`
(vault paths) and `mirror/reconcile` (the complete vault path list). Gating at config construction
covers all three; the tests must assert `not.toHaveBeenCalled()` for all three, not only upsert.

**U6 — the docs stop hedging.** The #508 comment at `plusClient.ts:259-268` and the warning in
`docs/ask-self-host.md` both describe this as an open gap. Both must be rewritten when this lands or
the docs lie in the other direction. Bump `manifest.json` + `package.json` + `versions.json` to
`0.8.0-beta.7`.

**U7 — two checks, because the #500 learning names two axes.**

*Neuter each guard and watch the tests fail.* Two #500 tests passed against a broken guard until
this was done. Required, not a nicety.

*Re-derive the sender inventory from source.* Neutering proves the tests you have are load-bearing;
it cannot catch a sender nobody listed, which is how both #500 misses happened and how this plan's
own first table came up short by two. Add a test that greps `src/` for the secret rather than the
pattern — `Bearer`, `sessionToken`, `plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL` — and asserts the
sender set against a checked-in allowlist. A twenty-fourth Plus sender then fails a test instead of
depending on a reviewer noticing it.

## Copy

Four new messages. No em dashes: `test/copyVoice.test.ts` enforces that plugin-wide over string,
template and regex literals. Drafts, subject to `atoms-voice`:

**Refusal.**

> `Atoms Plus can't confirm your sign-in at this address. Check the Plus service URL in settings.`

It must not say "your token was not sent", which invites the question of when it is. It should point
at the field, because the field is what the user changed.

**Needs confirming.** The KTD1 carve-out state: no stamp and an empty field, so the plugin has no
address it can trust. One-time, self-clearing, and it must not read as an error the user caused:

> `Atoms Plus needs its address before your notes are sent. Open Settings to confirm it.`

**Couldn't check.** Distinct from the refusal, because under KTD1 row 1 the first content call after
upgrade depends on a live probe for *every* existing session, including hosted users who changed
nothing. Telling a briefly offline hosted user to check a settings field they never touched, and
must not change, is worse guidance than the plain failure they would have had. Name the connection,
not the field:

> `Atoms Plus couldn't be reached, so your notes stayed on this device. Try again when you're back online.`

**Issuer moved.** The refusal is legible and the case that actually moves data is silent, which is
backwards. `plusBaseUrl` syncs through `data.json`, so a base can arrive from another device with
nobody typing anything; a successful probe would then re-stamp and start sending note text to a
different server with nothing on screen. One Notice on a re-stamp that changes a *known* previous
issuer, naming the new host, suppressed when there was no previous stamp:

> `Atoms Plus is now using <host>. Your notes will be sent there.`

This is not the rejected confirm-on-clear alternative. That fired at settings time on a value the
plugin could not classify. This fires after verification, at the moment the issuer demonstrably
changes, and it can name the host.

## Out of scope

- **The token half of the leak.** The 17 content-free base resolutions keep sending the session
  token to the resolved base, and so does this fix's own `/v1/me` probe. See the bug statement.
- The 17 content-free base resolutions themselves.
- `docs/ask-self-host.md`'s tunnel guidance itself.
- [#394](https://github.com/taihartman/obsidian-atoms/issues/394), the `onExternalSettingsChange`
  generation-mismatch early return. Noted because `plusBaseUrl` is synced through `data.json` while
  session state is device-local, so a base can change remotely. This design tolerates that: the gate
  is at egress and reads the base at call time, so it never needs to hook the change event. Do not
  hang security behaviour off that hook.

## Open questions

- ~~KTD1~~ — decided 2026-08-15, user-directed. See above.
- **Should the resolver itself stop falling back, rather than six consumers being gated?** The plan
  names `plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL` at 23 sites as the cause, then fixes six
  consumers and leaves the expression everywhere, so the next content-bearing sender inherits the
  bug and has to be enumerated again. A shared `resolvePlusBase(settings, session)` that returns the
  session's issuer when the field is empty would make the fix structural instead of a maintained
  list — the same argument KTD4 accepts for the stamp. **Deferred, not rejected:** it changes
  behaviour at all 23 sites including billing and sign-out, which is a materially larger blast
  radius than #508 needs, and U7's enumeration test buys most of the protection at a fraction of the
  risk. Worth its own issue.
- **Should a hosted session be allowed to verify silently onto a self-host base?** `plusBaseMatches`
  currently treats the hosted default like any other host. Moving a *hosted* session onto a private
  one is the direction that leaks nothing new, so silent is probably right, but it is unexamined.
- **What identity field does `/v1/me` actually return, and is it stable?** The email-match re-stamp
  predicate depends on it. Confirm against the service before implementing U3.
- **Does the outbox-ack refusal surface anything?** `askCoordinator.ts:200` sits in
  `createOutboxHost`, whose `null` return `runAskOutbox` consumes as `return idle` (`:183-184`).
  Refusing there is safe for egress but silent, so the refusal copy may never reach the user on that
  path. Leaving it silent is defensible (the classify path will surface the same condition loudly),
  but it should be a decision, not an accident.

## Risks

| Risk | Mitigation |
|---|---|
| New field dropped by the parse/serialize allowlists, guard fails open everywhere | U1 round-trip test; U7 neuter check |
| A future refactor rebuilds a session as a fresh literal and blanks the issuer | regression test on both direct `writePlusSession` callers |
| Extra `/v1/me` on every classify if the re-stamp does not persist | assert the stamp is written, and that a second call issues no second `/v1/me` |
| Quick-tunnel rotation reads as an attack | by design it is one round trip and a re-stamp, never a sign-out; covered by a test named for the rotation case |
