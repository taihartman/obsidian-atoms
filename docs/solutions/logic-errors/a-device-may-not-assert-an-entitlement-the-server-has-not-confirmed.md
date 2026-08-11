---
title: A device may not assert an entitlement the server has not confirmed
date: 2026-08-11
category: logic-errors
module: plus-entitlement
problem_type: logic_error
component: authentication
symptoms:
  - "An expired trial reads \"Monthly limit reached. Your allotment starts over on your next billing date\" — a billing date the account does not have"
  - "Every Ask/MCP route 403s while the settings status line still reports a healthy cached mirror"
  - "The account row, the Plan row, the offered action, and the billing-portal row are all wrong at once"
  - "A stale device with a converted trial tells a paying subscriber their trial ended, and blocks filing"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - payments
tags: [entitlement, plus, stale-cache, client-server-authority, status-honesty, trial-expiry]
---

# A device may not assert an entitlement the server has not confirmed

## Problem

The Plus service returns one status, `exhausted`, for two unrelated situations: the billing or trial **period ended**, and this period's filing **allotment is spent**. Every client surface only knew the second reading, so an expired trial was told its allotment would return on a next billing date it did not have. The first fix taught the device to tell the two apart locally — and that inversion blocked a paying customer.

## Symptoms

- Account row: "Monthly limit reached"; Plan row: "Renews <a date already in the past>"; the offered action is "Get more filings … instead of waiting for your next billing date"; and "Manage subscription" opens a billing portal for an account with no Stripe customer. Four rows, all wrong, all from one collapsed distinction.
- The first real signal reached the user on an unrelated button: `Pairing: Plus entitlement required for Ask pairing`.
- The Ask mirror status line read `84 · as <email> · last pushed 23h ago` with no error styling — built entirely from `loadLocalStorage`, and wrong for a day. The 23 hours *were* the lapse.

## What Didn't Work

**Inferring the lapse client-side.** The first fix lapsed when `periodEnd` was past AND (`status === "exhausted"` OR `plan === "trial"`). That second clause was the clever part — a device could notice its own trial expiry with no round-trip. It inverts a paying customer:

A trial that **converts** leaves a stale device holding `trialing` and a past `periodEnd` while the account is paid and active. The draft told that subscriber their trial had ended and returned `ok: false` from `resolveClassifyAuth`, blocking filing. The code it replaced would have attempted the call and let the server correct it. The change swapped server truth for a client guess and removed the self-heal.

A guard against the *monthly* false positive was already there — `periodEnd` on a monthly plan is a renewal date, so a past date alone cannot mean lapsed. It did not generalize to trials, because the trial clause was written to bypass exactly that kind of confirmation.

## Solution

Two rules, in the order they matter.

**1. Assert only what the server confirmed.** `plusLapse` (`src/platform/filingAuth.ts:171`) requires `status === "exhausted"` — the service's own verdict — before it will call a period ended:

```ts
export function plusLapse(auth, now = Date.now()) {
  if (auth.mode !== "plus") return null;
  if (!plusIsExhausted(auth)) return null;   // server-confirmed, not inferred
  if (!plusPeriodEnded(auth, now)) return null;
  return { kind: plusLapseKind(auth.plan), endedOn: auth.periodEnd };
}
```

**2. Name the stale state and go ask.** Dropping the inference leaves a real gap — so make the gap explicit rather than guessing across it. `plusNeedsPeriodRefresh` (`filingAuth.ts:198`) is true when the stored `periodEnd` has passed *after* the last confirmed refresh, meaning the snapshot predates the boundary and cannot say what happened at it. One quiet `/v1/me` runs at plugin load when it does.

Two smaller consequences of the same rule:

- A plan the device cannot name is `unknown`, not `subscription` (`plusLapseKind`, `filingAuth.ts:182`). A session stored before `plan` was persisted, or a `promo` period, was otherwise told a subscription ended that it never had — and offered a billing portal with no customer behind it. The portal row now requires *positive* proof (`monthly` or `yearly`), not the absence of `"trial"`.
- The Subscribe action re-confirms the lapse against the service before charging. `subscribe_monthly` has no server-side already-subscribed guard — only `start_trial` is checked — so a snapshot gone stale against a renewal could open a second subscription on a live account.

## Why This Works

The device holds a *snapshot*, and the question "did this period end?" is about an event at a boundary the snapshot may predate. Three things the client cannot see decide the answer: a Stripe renewal, a trial conversion, and the service's own `applyStatusRules` (`plus-service/src/store/shared.mjs:285`). `status === "exhausted"` is the only value in the snapshot that some server actually *decided*; everything else is raw material the client was interpreting.

The deeper cause is that nothing announces an expiry. The only automatic refresh returns early unless a Stripe checkout is in flight (`src/platform/plusResume.ts:39`), so a device can hold a pre-expiry snapshot indefinitely — 23 hours, in the reported case, and unbounded in principle. That silence is what made a local inference look attractive. The fix treats the silence as the actual defect.

## Prevention

- **When a client and a server disagree about state the server owns, the client loses.** Before adding a rule that derives an authoritative verdict from cached fields, ask which single field the server actually decided, and gate on that one. Deriving a *second* opinion from the same snapshot is the tell.
- **Ask "what does the opposite transition look like?"** Every stale-cache inference has a mirror case. Here it was the conversion — the *good* outcome for the business, and the one the inference punished. That question is what a clause like `plan === "trial"` needs to survive, and it is cheap to ask at design time.
- **Test the false positive, not only the true positive.** `test/filingAuth.test.ts` pins that a converted trial is *not* reported lapsed. The removed clause had a test too — it asserted the defect, because it was written from the same assumption as the code. A regression test written after the fix inherits the fix's blind spot; the useful one names the user the rule must not harm.
- **A status line assembled from cache must be able to say it is stale.** `84 · last pushed 23h ago` was structurally incapable of reporting the failure, because no push had been *attempted* since the lapse — so there was no error to display, and absence of error rendered as health. Related: [ask-mirror-parity](../architecture-patterns/ask-mirror-parity.md) § status honesty.
- **One status field for two situations will be read as one situation.** The collapse started server-side, where `applyStatusRules` and the meter's `UPDATE` (`plus-service/src/store/postgres.mjs:620`) both write `exhausted`. Every client then inherited the ambiguity. Where a single enum value carries two meanings, expect each consumer to pick one and forget the other.

## Related Issues

- [#442](https://github.com/taihartman/obsidian-atoms/issues/442) — expired trial says "monthly limit reached"; no way to subscribe from the app.
- [#441](https://github.com/taihartman/obsidian-atoms/issues/441) — the server half, unclaimed: `entitled()` (`plus-service/src/mirror/http.mjs:23`) rejects `exhausted`, so a paying subscriber who spends the monthly meter also loses Ask/MCP. The same collapsed distinction, one layer down.
- [extracting-a-one-home-predicate-does-not-find-the-copy-already-there](../workflow-issues/extracting-a-one-home-predicate-does-not-find-the-copy-already-there.md) — the consolidation this fix performed is verified by the search proving the logic now occurs once, not by its own diff.
- [ask-mirror-parity](../architecture-patterns/ask-mirror-parity.md) — status honesty: what a surface claims must be what the gate does.
