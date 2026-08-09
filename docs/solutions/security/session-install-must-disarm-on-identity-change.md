---
module: plus-ask
tags: [ask-mirror, consent, session, identity]
problem_type: security
---

# Session install must disarm on identity change

## Problem

#372 fixed Sign out. Magic-link handoff, paste session, and start trial still called `writePlusSession` with no teardown. A different Plus account inherited `askEnabled` and the hash baseline — worse when the old session had lapsed and the Sign out row was not rendered.

## Solution

One install boundary (`installPlusSession`) compares the incoming email to the prior session email **and** residual `LS_ASK_MIRROR_EMAIL`. On mismatch it runs the shared `disarmAskMirror` sequence, then writes. Same-account re-auth keeps the baseline.

## Why not unconditional disarm

#372 already accepted a full re-upload after Sign out. Same-account refresh (new token, same email) should not pay that cost again; durable keying is #396.

## Prevention

Any new session-write path must call `installPlusSession`, not bare `writePlusSession`, unless it is same-identity metadata (remaining count, refresh).
