---
module: plus
tags: [egress, session-token, self-host, verification, fail-closed, brand-types, capture-body]
problem_type: security
---

# A 2xx is not proof that this server issued your session

## Problem

`plusBaseUrl` is the self-host override. Empty resolves to the hosted default at all 23 call sites (`settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL`), so a user signed in to their own Plus server who *clears* the field silently starts sending their session token and their verbatim capture text to `plus.tryatoms.app`.

[#500](https://github.com/taihartman/obsidian-atoms/issues/500) had already guarded this field and deliberately refused to fall back on a bad value. It covered every input class except the one that is not invalid at all: **absent**. That is [`a-guard-needs-two-inventories-send-sites-and-input-classes.md`](a-guard-needs-two-inventories-send-sites-and-input-classes.md), miss 2, and closing it is #508.

The fix has an obvious shape: record the base that issued the session, and refuse to send content anywhere else. The obvious shape has a hole in it.

## The hole: "the server accepted my token" is not "the server minted my token"

The first design said: on a mismatch, call the resolved base; if it answers 2xx, that base is good, stamp it and proceed. Two independent review lenses killed it for the same reason.

A host that accepts *every* bearer token passes a status-only check trivially. It then becomes the permanently stamped issuer, and from that moment every capture body flows to it unchecked — with the plugin's own record now asserting that this is where the session came from. The check would not merely fail to stop the attack; it would launder it.

**The predicate has to be something only the issuer can produce.** Here that is the account: `/v1/me` returns the entitlement `email`, and the service treats it as the `accounts` primary key. So the rule is: 2xx **and** the returned email matches the session's email, compared case-insensitively. A 2xx that names nobody, or names somebody else, is refused exactly like an auth failure.

Generalized: **when a check asks a party to vouch for itself, the answer must be something only the genuine party could know.** A status code is a claim about willingness, not about identity.

### And then be honest about how far that gets you

The first draft of this document asserted "a host that did not issue the token cannot name its account." **That is false, and an independent adversarial review said so.** An email address is not a secret. The predicate defeats an accept-anything host that does not know the victim; it does not defeat a *targeted* host that does, because that host can just echo the address back and be stamped as the permanent issuer.

What the check actually buys is a bar raise from "answers 2xx" to "answers 2xx and knows the account" — real, and worth having, and not authentication. Getting to authentication needs something the client does not already know: a session-bound challenge the issuer alone can answer, or a human gesture before a *known* issuer is replaced (auto-probe stays fine for a first stamp, where there is no prior trust to lose).

The lesson is not "the check was wrong." It is that **a security claim written in a doc will be believed by the next person, so it has to state its limit, not just its mechanism.** The failure mode here was not the code; it was a sentence that would have let a future maintainer treat a bar raise as a proof.

### The check's own dependencies are part of its attack surface

The same review found the sharper version of this. The predicate compares the returned address against `session.email` — so anything that can *write* `session.email` can choose what the check compares against.

`refreshPlusEntitlementRecord` could. It is content-free, therefore deliberately ungated, therefore reaches whatever base is configured, and it adopted the address that base returned (`email: e.email || session.email`). A rogue base answered `/v1/me`, renamed the local account to a string of its choosing, then passed the gate against that string. **No guard had to break.** Every neuter check still went red; every test still passed.

Scoping a call as "content-free, out of scope" answers the question *what does this send*. It does not answer *what does this write*. For any check of the form "compare a remote answer against local state X", enumerate every writer of X and confirm none of them is reachable by the party being checked. That enumeration is a distinct inventory from the send-site one in
[`a-guard-needs-two-inventories-send-sites-and-input-classes.md`](a-guard-needs-two-inventories-send-sites-and-input-classes.md) — call it the third inventory.

## What else this shape forces

- **The check cannot gate itself.** The `/v1/me` probe sends the token to the base it is asking about. That is unavoidable, and it means #508 closes the *capture-text* half of the leak and not the token half. Say so in the docs and the PR, or the issue reads as more closed than it is. The 17 content-free calls still send the token to whatever base resolves.

- **An absent stamp means unknown, never production** — with a carve-out that is load-bearing. Sessions already on disk carry no stamp. Reading absent as "the hosted default" grandfathers in exactly the state the change exists to catch. But reading it as "probe the resolved base" is *also* wrong for one cohort: an unstamped session plus an empty field resolves to the hosted default, so probing would send a self-hoster's token to production on first run. That single case must refuse without probing. Both readings are defensible in isolation; only their intersection is safe.

- **The carve-out must be bounded to the upgrade cohort.** `plusBaseUrl` ships as `""`, so empty is the *normal* state for nearly every user. Redefining empty as "not connected" would strand the whole install base. It does not need redefining: once sessions are stamped at acquisition, a hosted session's empty field matches its stamp forever, and the field never has to mean anything. The only ambiguous population is unstamped-*and*-empty, which is one-time and self-clearing.

- **Two fields, not one.** A single mutable stamp erases its own evidence: after one tunnel rotation nothing on disk records that the session began at a private host. `issuedBase` is immutable, `verifiedBase` moves.

- **Fail closed includes offline.** "I could not check" is not "go ahead". But be honest about who pays: at upgrade *every* session is unstamped, so the first content call for every user depends on a live probe, including hosted users who changed nothing. Unreachable therefore needs its own copy naming the connection, distinct from the refusal that names the settings field. Telling a briefly offline hosted user to edit a field they never touched is worse guidance than the plain failure they would otherwise have had.

- **The silent case needs the Notice more than the loud one.** The refusal is legible; a *successful* re-stamp moves where note text goes and would say nothing. `plusBaseUrl` syncs through `data.json`, so a base can arrive from another device with nobody typing. One Notice on a re-stamp that changes a known previous issuer, suppressed on a first stamp.

## A required type enforces presence; only a branded one enforces provenance

Making the stamp a required constructor argument turns a *forgotten* stamp into a build error. It does nothing about the realistic failure, which is a *wrong* stamp: a caller satisfies the compiler with `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL` — the idiom already sitting at 23 sites — the stamp equals the resolved base by construction, the comparison is a tautology, and the gate returns true on every device. Same fail-open, relocated to whoever writes the next call site.

So the stamp is a branded type minted only by the helper that performed the acquisition round trip. A base read from settings is then not assignable, and presence and provenance both fail at build time.

The same trap has a second form one layer down. When the egress backstop compares `plus.verifiedBase` against `plus.baseUrl`, setting `verifiedBase` from the *resolved* base rather than from the verdict makes it compare a value with itself. Neutering confirmed it: the backstop's test went red only when the value came from the verdict.

**And a required argument has to reach the acquisition site, not the nearest wrapper.** Adding it only to the platform function forces the *wrapper* to supply one, which it satisfies by re-reading settings — and it compiles. Widen every indirection between the round trip and the write, or the requirement buys nothing on the path most likely to be wrong.

## Where the gate goes

Six content-bearing sites, gated where the base is resolved or the config is built, plus an egress backstop one layer down in the code that actually posts. That duplication is deliberate and is [`consent-gate-must-be-checked-at-egress-not-at-entry.md`](consent-gate-must-be-checked-at-egress-not-at-entry.md) applied again: safety is a property of *whoever currently constructs the request object*, and the coordinator is not the only place a config is built.

Two sites were nearly missed by sorting on the wrong axis:

- **The outbox ack** looked like id-and-status. It also sends `error`, which upstream is `plan.reason` — free text from the vault.
- **The Connect screen** sends no note text. It *publishes an origin* for Claude or ChatGPT to OAuth against, and then pairs the session token to it. Publishing an address for a third party to authenticate against under the user's identity is egress with extra steps. That screen also cannot probe: a render must not egress, and a screen that opened a network call to name its own address would be sending the token to the host it is trying to decide about. It compares against the stamp only, and a stale stamp reads as "not yet confirmed" until a real content call re-verifies.

## Prevention

- **For any "ask the server to confirm itself" check, write down what the answer proves.** If the answer is a status code, the check is a liveness probe wearing an authentication costume. Name the field only the genuine party can produce.
- **Enumerate input classes including absent, then enumerate the *cohorts* absent splits into.** #500 missed absent entirely; #508's first draft handled absent but not the sub-case where absent plus an empty field re-creates the original leak.
- **When you add a required field to close a fail-open, ask what the laziest compiling value is.** If that value makes the new check trivially true, the type is not strong enough — brand it, or source it from the verdict rather than from the input.
- **Say what did not ship.** A fix that closes one half of a leak and leaves the other should state the remaining half in the code comment, the user-facing doc, and the PR body. The comment that previously described the gap has to be rewritten when the fix lands, or the docs lie in the other direction.
