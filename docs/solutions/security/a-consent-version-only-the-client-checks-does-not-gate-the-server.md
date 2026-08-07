---
title: "A consent version that only the client checks does not gate anything the server does"
date: 2026-08-07
category: security
module: consent/ask-mirror
problem_type: security_issue
component: consent-gate
symptoms:
  - "A device on an older plugin build compares its stored ack against its own older version constant, reads as current, and keeps mirroring"
  - "The server enqueues expansion for every row it receives, with no consent or ack-version condition anywhere in the request path"
  - "Rows already sitting in the store, with no plaintext ever sent for expansion, get expanded on the next sync from a stale client"
  - "Bumping the ack version re-prompts every build that already has the new constant, and none of the builds that don't"
root_cause: missing_server_side_check
resolution_type: accepted_risk
severity: medium
tags:
  - consent
  - ask-mirror
  - search-expansion
  - client-side-gate
  - staggered-rollout
  - accepted-risk
---

# A consent version that only the client checks does not gate anything the server does

This is the sequel to
[`a-versioned-consent-needs-both-halves-in-the-gate`](a-versioned-consent-needs-both-halves-in-the-gate.md).
That doc is about what the gate has to check once it exists. This one is about where the gate has
to run, once the privileged action it guards no longer happens on the same machine as the check.

## The setup

Issue #360 shipped `ASK_PRIVACY_ACK_VERSION` (`src/shared/askAck.ts`) so that rewording the ask
disclosure re-prompts users instead of letting them coast on a stale yes. PR #340 bumped it to
`"2026-08-07"` for a rewrite whose new clause (4) discloses, for the first time, that note body
plaintext is sent to Anthropic to build search-expansion phrases:

```
(4) Atoms Plus may send title, tags, and body slices to Anthropic to build encrypted
search-expansion phrases for Ask (not zero-knowledge; Wipe removes them with the mirror);
```
— `src/settings/consent.ts:31`

The same PR turned that expansion on by default (`plus-service/src/config.mjs`, commit `cd1a742`),
reasoning that the version bump satisfies the hold that had kept it off.

## The gap

`askPrivacyAckIsCurrent` (`src/shared/askAck.ts:114`) compares the stored ack against
`ASK_PRIVACY_ACK_VERSION` — a constant **compiled into that same build**. Every call site is
client-side: `src/plugin/askCoordinator.ts:122` gates the mirror sync itself, and
`src/settings/settings.ts` uses it to decide whether to show the disclosure sheet. There is no
call site anywhere on the server.

A device still running an older plugin build holds an older compiled `ASK_PRIVACY_ACK_VERSION`. It
compares its stored ack — accepted against the old six-clause wording — to its own older constant,
finds a match, reads as current, and keeps mirroring. Nothing about the check told that device a
newer, more disclosing version exists; it can't know, because the version it's comparing against
never left its own build.

The server never sees an ack version at all. `plus-service/src/mirror/http.mjs:407-415` reads
`result.needExpand` off the upsert result and enqueues every entry, unconditionally:

```js
const needExpand = Array.isArray(result?.needExpand) ? result.needExpand : [];
...
if (typeof store.mirrorSetExpand === "function" && needExpand.length) {
  for (let n = 0; n < needExpand.length && n < cap; n += 1) {
    enqueueMirrorExpand(store, needExpand[n]);
  }
}
```

No consent flag, no ack-version field, no client-version field is part of that request or that
condition. The server cannot refuse an expansion job on consent grounds because consent was never
part of what it was asked.

## It's retroactive, not just forward-looking

All three store backends — `plus-service/src/store/memory.mjs:465-477`,
`askPostgresMethods.mjs`, and `askSqliteMethods.mjs` — push a body-bearing `needExpand` entry on
the **hash-unchanged** branch whenever the row's `expandEnc` column is still null:

```js
if (prev && prev.contentHash === row.contentHash) {
  skipped += 1;
  if (!prev.expandEnc) {
    needExpand.push({ email: row.email, path: row.path, title: row.title, tags, body, contentHash: row.contentHash });
  }
  continue;
}
```
— `plus-service/src/store/memory.mjs:465-477`

So a row that has been sitting in the store since before expansion existed — never expanded,
uploaded under the old wording, no plaintext ever sent for this purpose — gets queued for
expansion the next time *any* client syncs it, even a client whose own copy of the consent gate
is current. The gate lives entirely upstream of a code path the server runs regardless.

## The general shape

**A version constant re-prompts only the builds that already have the new constant.** Bumping it
is necessary but never sufficient — the population it is meant to protect is precisely the
population still on the old build, and by definition that population never evaluates the new
value. If the privileged action happens on a different machine than the check — here, the
egress runs on the server, the check runs on the client — the version has to travel with the
request, not just live in the requester's memory.

The fix shape, not implemented here: stamp the accepted ack version on the mirror request, pin a
minimum accepted version server-side, and skip the privileged action (enqueueing expansion) when
the stamp is absent or older than the pin.

## Recorded decision

The repo owner reviewed this finding for #340 and **accepted it as a known risk**, on the
reasoning that users are expected to update — this is not being tracked as an open bug against
that PR, and the client-only gate shipped as-is. The value of this doc is the transferable
pattern (a version check that only runs on the machine being protected against does not protect
the population it names), not a claim that #340 is defective for having made this trade.

## Related

- [`a-versioned-consent-needs-both-halves-in-the-gate`](a-versioned-consent-needs-both-halves-in-the-gate.md)
  — what the gate has to check, once it exists. This doc is about where it has to run.
- [`consent-gate-must-be-checked-at-egress-not-at-entry`](consent-gate-must-be-checked-at-egress-not-at-entry.md)
  — a related but distinct staleness failure: a gate that runs on the right machine but at the
  wrong call site. Here the call site is the wrong *machine* entirely.
- Issue #360, PR #340.
