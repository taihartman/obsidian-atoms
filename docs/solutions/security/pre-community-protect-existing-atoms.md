---
title: "Protect existing atoms and clamp write roots before Community publish"
date: 2026-07-15
category: security
module: write-path
problem_type: security_hardening
component: plugin
symptoms:
  - "Same-title reprocess overwrote hand-edited atom bodies"
  - "atomFolder or model titles could poison paths/markers"
  - "Shortcut install opened arbitrary URLs"
root_cause: trust_boundary
resolution_type: code_fix
severity: high
tags:
  - community-publish
  - collision
  - sanitization
  - secret-adjacent
---

# Protect existing atoms and clamp write roots before Community publish

## Problem

Before listing a private Obsidian plugin publicly, integrity failures matter as much as key handling: silent overwrite of existing notes, free-form write folders, adversarial model titles in markers/paths, and `window.open` of user-controlled URLs.

## Solution

1. **Collision:** `planWrite` uses `skip_existing_atom` — never `vault.modify` an existing atom; still append the daily marker.
2. **Titles:** shared `sanitizeFilename` / `displayTitleForAtom` strips controls (incl. U+2028/2029), neutralizes `[[`/`]]`, bounds length.
3. **Folder:** `clampAtomFolder` — single relative segment only; apply on load and settings change.
4. **Shortcuts:** parse URL; allow only `https://www.icloud.com/shortcuts/…`.
5. **Prod surface:** esbuild `ATOMS_DEV_COMMANDS`; register spikes only when explicitly true (fail-closed).
6. **Publish prep:** MIT LICENSE + README privacy / optional-payments language.

## Avoid

- Global regex + `.test()` for illegal-char checks (`lastIndex` footgun).
- Fail-open on missing `ATOMS_DEV_COMMANDS` (`undefined || true`).
- “Smart update” of atom bodies without an explicit user action.

## See also

- `docs/security/pre-community-publish-review.md`
- `docs/plans/2026-07-15-011-feat-pre-community-security-harden-plan.md`
