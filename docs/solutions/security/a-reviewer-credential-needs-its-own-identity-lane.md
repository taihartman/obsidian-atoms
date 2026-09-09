---
title: "A reviewer credential needs its own identity lane"
date: 2026-09-09
category: security
module: plus-service
problem_type: security
component: oauth-reviewer-access
severity: high
root_cause: credential-contract-conflation
resolution_type: boundary-hardening
tags:
  - oauth
  - mcp
  - reviewer-access
  - pairing-code
  - credential-rotation
  - tenant-isolation
---

# A reviewer credential needs its own identity lane

## Problem

An end-user MCP pairing code is intentionally short-lived and single-use. A public platform review is asynchronous and may reconnect more than once, so stretching the same credential contract creates two bad choices: weaken every user's pairing code or give the reviewer a credential that expires before review finishes.

Treating the reviewer as an ordinary account is also unsafe. Normal pairing or mirror routes can replace its credential or fixtures, and rotating only the credential leaves existing access tokens, refresh tokens, browser sessions, or unexchanged authorization codes alive.

## Solution

Give review access a separate identity lane:

- reserve synthetic identities under `@review.tryatoms.app`;
- mint 130-bit credentials that are reusable only until a bounded expiry;
- keep normal user codes at eight Crockford characters, ten minutes, and one use;
- reject reviewer identities from ordinary authenticated pairing and mirror-write routes;
- hash reviewer credentials at rest and invalidate the prior credential on remint;
- revoke every OAuth continuation artifact when reprovisioning; and
- seed deterministic, non-sensitive fixtures so reviewers can verify exact results.

The implementation enforces the split in `plus-service/src/store/askHelpers.mjs`, protects the reserved lane in `plus-service/src/mirror/http.mjs`, revokes continuation state in the store implementations, and provisions fixtures through `plus-service/src/reviewer/provision.mjs`.

## Verification

Tests must prove both contracts independently: public codes remain short-lived and one-time, reviewer credentials survive a second redemption within their expiry, reminting invalidates the previous credential and its sessions, ordinary routes cannot mutate reviewer tenants, and the expected fixture graph is exact. A real Postgres migration test must also exercise a legacy schema because an in-memory or SQLite pass cannot prove production persistence semantics.

Deployment guards belong in CI and post-deploy checks, not only local tests. The published domain challenge should be compared byte-for-byte with its source, and MCP discovery should assert the exact tool inventory and annotation triples expected by the platform.

## Residual risk

Provisioning is currently multi-step rather than transactional. A database failure between wipe, seed, and credential mint can temporarily leave one synthetic tenant incomplete. Use primary and backup reviewer tenants, provision and validate a replacement before changing the portal credential, and rerun the idempotent provisioner after a failure. Move the sequence into one database transaction if this lane becomes a standing operational dependency rather than a bounded review workflow.
