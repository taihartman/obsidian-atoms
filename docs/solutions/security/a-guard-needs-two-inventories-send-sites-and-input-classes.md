---
module: plus
tags: [egress, validation, session-token, self-host, choke-point, enumeration]
problem_type: security
---

# A guard needs two inventories: every send site, and every input class

## Problem

`plusBaseUrl` — the "Plus service URL override" for self-hosting — accepted any scheme and any host. Every Plus call attaches the device session bearer token to that base, and `/v1/classify` attaches the user's verbatim capture text as well. One typo, or one hostile suggestion, and both left the device, potentially in cleartext (#500).

The fix looked like a one-liner: validate the scheme where the request is built. It was not, and it failed twice in the same shape.

## The two misses

**Miss 1 — I claimed one choke point and there were three.** `plusRequest` in `src/platform/plusClient.ts` really is the funnel for ~22 Plus calls, and the first cut guarded it and stopped. A `rg` for `Bearer` found two more senders that build their own request and never touch it:

- `src/pipeline/classify.ts` — the worst one, because it carries the capture body as well as the token
- `savePastedSession` in `src/settings/settings.ts` — the very line the original bug report had quoted, which I had skimmed past because my own grep for `${base}` interpolation did not match how it was written

Grepping for the *shape you expect* (`${base}`) finds the sites written the way you would have written them. Grepping for the *thing that must not escape* (`Bearer`, the token, the secret) finds the ones somebody else wrote differently. The second search is the one that closes the set.

**Miss 2 — the rule covered every value except the default.** The guard's own comment said, correctly, that falling back to the hosted default would be worse than failing, since a self-host token does not belong at `plus.tryatoms.app`. Then the empty value did exactly that: every call site resolves `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL`, so a self-hoster who *clears* the field ships their token — and their capture bodies — to production, with only "Couldn't reach Atoms Plus" on screen.

Clearing a field is a far likelier user action than typing something malformed. A rule about invalid input said nothing about the input class that is not invalid at all: absent. Tracked as #508, which needs `PlusSession` to record its issuing base.

## Solution

- One predicate, `isAllowedPlusBaseUrl` — https on any host, http only on loopback (`localhost`, `127.0.0.0/8`, `::1`), everything else refused.
- Called on **all four** paths that egress: `plusRequest`, `resolveClassifyAuth`, the `classify.ts` request itself, and `savePastedSession`.
- Refused values **fail the call**. They are not swapped for the hosted default, because that is the leak in a different direction.
- Refused values are also not *published*: the Connect screen prints the MCP URL and tells the user to paste it into Claude or ChatGPT, so a refused base publishes nothing. That surface sends no token and was nearly missed for exactly that reason — it hands the origin to a third party instead of calling it, which is a different verb and the same exposure.

## Why the guard sits at the send, not only at the resolve

`resolveClassifyAuth` validates once per run and snapshots the base; `classify.ts` sends per capture from that snapshot. That is safe today — the validated value *is* the value used, and re-reading settings live at egress would be worse, since Obsidian Sync can land a new `data.json` mid-run and swing an in-flight pass onto a new host. It was still worth a second check at the send, because the safety is a property of *who currently constructs the object*, not of the line that transmits. See [`consent-gate-must-be-checked-at-egress-not-at-entry.md`](consent-gate-must-be-checked-at-egress-not-at-entry.md) — same repo, same failure family, where a correct gate sat one function too early and a single-flight loop uploaded note bodies after withdrawal.

The adversarial pass confirmed the snapshot holds: a bad value landed 1.5s into a 13.4s run and all 8 requests still went to the validated host, zero to the injected one.

## Prevention

- **Grep for the secret, not for the pattern.** `rg "Bearer|authorization|api[-_]?key"` over `src/` enumerates senders regardless of how each was written. Do this *before* claiming a choke point exists, and put the count in the commit message so the claim is falsifiable.
- **Enumerate input classes, not just invalid input.** For any validated field, write the row for absent/empty/default explicitly and ask what it resolves to and whether that destination is safe *for the state the user is currently in*. `X || DEFAULT` is a silent fallback that no rule about bad values will ever reach.
- **Ask what a surface does with the value, not only whether it sends it.** Publishing an origin for someone else to authenticate against is egress with extra steps.
- **Test at the level that proves nothing left the device.** `expect(request).not.toHaveBeenCalled()` is the assertion; a returned error object only proves the function chose a branch. Then neuter each guard and confirm the test fails — two of these tests passed against a broken guard until that was checked.
- Neither miss was found by writing more tests for what I had built. Miss 1 came from a reviewer enumerating senders independently; miss 2 came from an adversarial pass driving a real user action nobody had listed as a scenario. Budget for both, and treat "I already funnelled this through one place" as the claim most worth attacking.
