---
title: "Exhausted Plus ignored a stored key"
date: 2026-08-20
category: logic-errors
module: filing-auth
problem_type: logic_error
component: tooling
severity: medium
symptoms:
  - "A Plus subscriber with their own Anthropic key hit Monthly Limit Reached and stopped filing"
  - "The stored key sat unused while Plus still owned the classify path"
  - "Settings would have looked signed-out if filing flipped to BYOK without re-projecting Plus from the session"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - filing-auth
  - settings
  - classify
tags:
  - plus
  - byok
  - exhausted
  - fallback
  - settings
---

# Exhausted Plus ignored a stored key

## Problem

`resolveFilingAuth` treated `exhausted` like a live Plus session: mode stayed `plus` even when a key was on the device. Classify then blocked with Monthly Limit Reached. The key was meant as a fallback once usage (or the period) ran out, not a second engine beside an active allotment.

## What didn't work

- Keeping exhausted on Plus so wait / top-up copy never became a BYOK pitch. That is right **without** a key. With a key it is a silent refuse of a credential Plus already holds.
- Flipping filing to `byok` and leaving `deriveAccountState` on `auth.mode`. `plusIsExhausted` / `plusLapse` are plus-only, so the account row would read signed out while the user was still Plus.
- Letting File borrow the account condition after that fix. File would say Monthly limit reached while the key was filing.

## Fix (0.8.14)

Plus while it can classify (`active` / `trialing` / `unknown`). Exhausted **and** a trimmed key → `byok`. Exhausted without a key stays plus (wait / top-up, no pitch). Account rows project Plus from the session with no key. File names "Your own key" when that engine is covering a spent or ended period.

One Process is still one engine.

## Residual

Home's wait-card follows filing mode, so exhausted + key takes the BYOK story rather than the limit card. The Plus row in Settings still names the spent meter or lapse.

## Prevention

- Account state is the Plus relationship; File is the engine that is actually filing
- Exhausted without a key must not become a BYOK pitch
- Tests in `test/filingAuth.test.ts` and `test/settings.test.ts`

## See also

- Issue #586 / PR #587
- `docs/solutions/logic-errors/title-collision-cannot-see-the-same-capture.md` — same credentials, different bug (two titles)
- `CONCEPTS.md` — Ended period vs spent meter
