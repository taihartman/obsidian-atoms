---
title: Count the sites that compute the predicate, not the ones that reported it
date: 2026-08-11
category: logic-errors
module: plus-entitlement
problem_type: logic_error
component: authentication
symptoms:
  - "A paying subscriber who spends the monthly filing allotment also loses Ask/MCP — Claude and ChatGPT stop reading a brain that is already mirrored and already paid for"
  - "The issue names one gate, the triage doc names two, and the real count is three layers over eleven sites"
  - "A fix verified against the reported file passes every test and leaves the defect live on another store"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - payments
tags: [entitlement, plus, ask-mcp, one-home-predicate, defect-mapping, parity-test, multi-store]
---

# Count the sites that compute the predicate, not the ones that reported it

## Problem

The Plus service writes one `exhausted` status for two unrelated situations — the billing/trial **period ended**, and this period's filing allotment is **spent** — and every gate downstream read it as one. A subscriber who used up their monthly filings lost Ask/MCP along with them.

That much was known. What made it expensive is that nobody could say how many places had to change, and every estimate produced by tracing back from the symptom was low.

## Symptoms

- Reported symptom: Claude's `search_atoms` fails for an account whose subscription is live and paid.
- The issue blamed `entitled()` in `mirror/http.mjs`. That function is not on Claude's read path at all — search goes through MCP, which never calls it. The reported cause was the wrong layer.
- A verified triage doc, written with exact line numbers against master, named two layers. The real count was three.

## What Didn't Work

**Tracing backward from the symptom.** Both the issue and the triage doc were produced by starting at "search fails" and walking up the call stack. That finds the layer you happened to land in and stops. It found `entitled()` (wrong — not on that path), then `accountFromMcpToken` (right, and the actual killer), and never reached the seven OAuth gates in `oauth/routes.mjs`, because no failing search request passes through them. Those gates only fire when a subscriber *reconnects* an AI app — a second, differently-shaped failure of the same defect, invisible from the reported symptom.

Backward tracing also cannot see the copies. `accountFromMcpToken` exists three times, once per store, byte-identical. A fix verified against the store the local suite happens to run is green while production — postgres — still denies the token.

## Solution

Search **forward for the predicate**, not backward from the failure. The bug was never "this route is wrong"; it was "this question is answered wrong". So enumerate every site that asks the question, before designing anything:

```bash
rg -n 'status !== "active"|status === "active"' plus-service/src
```

Eleven sites, three layers — the count *is* the scope. Then give the question one home:

```js
export function subscriptionLive(a, now = Date.now()) {
  if (!a) return false;
  const st = String(a.status || "");
  if (st !== "active" && st !== "trialing" && st !== "exhausted") return false;
  return !periodEnded(a, now);
}
```

Two details that only the full enumeration surfaces:

- **The period check must come first.** The MCP gates reach this after `refreshAccountStatus` has normalized `status`; the OAuth gates call `getAccount()` raw and reach it un-normalized. Checking the period before the status makes one helper correct for both, and closes a pre-existing hole where a stale `active` with a past `periodEnd` could connect an AI app.
- **The helper cannot assume a caller refreshed.** That is why it re-parses `periodEnd` even on the path where `applyStatusRules` just parsed it. The redundant parse is the price of being correct for the unrefreshed caller, and it is a `Date.parse` on a fixed ISO string.

Then make the count enforceable, because the next copy is what recreates the bug:

```js
// no file outside shared.mjs re-derives the entitlement tuple
const ALLOWED = new Set(["store/shared.mjs", "server.mjs"]);
const STATUS_TUPLE = /status\s*[!=]==\s*"(active|trialing)"/;
```

A companion assertion checks each de-tupled gate now *contains* `subscriptionLive` — proving the tuple was replaced, not merely deleted.

## Why This Works

A predicate with N copies is N independent chances to be wrong, and the tests inherit the same blind spot as the code: they are written against the site that was reported. The parity test inverts that. It does not assert that any particular gate is correct — it asserts that **no site answers the question locally**, which is a property of the whole tree and cannot be satisfied by fixing one file.

That difference is measurable here. Mutation-checking the fix by reverting a single store's gate turned the store test red for that store only — memory failed, sqlite and postgres passed, exactly the partial-fix-passes-on-the-wrong-store shape. The parity test failed on the same mutation regardless of which store ran.

## Prevention

- **When a bug is "this predicate is wrong", grep for the predicate before you plan.** The number of hits is the scope of the fix. A defect map built by walking up from a stack trace is a map of one path, not of the bug.
- **A verified map is not a complete map.** The triage doc here was re-verified line by line at the start of the session and every claim in it held — it was still missing a third of the defect. Re-verification confirms what is written; it cannot surface what was never looked for. Run the forward search *as well as* re-reading the map.
- **Three copies of a gate means the suite must run all three.** `askStoreModes()` exists for this. Note which stores actually run locally: postgres — the production store — is skipped without `TEST_DATABASE_URL` and is proven in CI only.
- **Prove the state transition, do not seed it.** The first draft of the regression test seeded `remaining: 0` and asserted the gate. That assumes the meter produces the state under test. Driving the real `tryConsumeFiling` — the `status = CASE WHEN remaining - 1 <= 0 THEN 'exhausted'` UPDATE — proves it.
- **Ask which meter a feature actually charges before gating on it.** Only `/v1/classify` decrements the allotment. An atom Claude creates through the Ask outbox never touches it, which settled the open question about whether writes should survive a spent meter: withholding them would have protected nothing.

## Residual risks

Two the review surfaced, both recorded rather than fixed here:

- **`unknown` can elevate into Ask by spending its meter.** `subscriptionLive` denies `unknown`, but the meter's `UPDATE` tolerates it (`status IN ('active','trialing','unknown')`) and rewrites it to `exhausted` on the last filing — which this change now reads as live. So a row denied Ask gains it by *using* filings, with no payment event. Nothing under `plus-service/src` writes `unknown` (the column is `NOT NULL` with no default; `ensureAccount` inserts `inactive`), so the path needs a row no current code creates. The honest fix is to drop `unknown` from the two meter clauses, which is a different change than this one.
- **Token mint does not re-check the predicate.** `mcpExchangeCode` / `mcpRefreshTokens` mint on PKCE and token validity alone, so a lapsed account can still rotate tokens; the tokens then fail at use time in `accountFromMcpToken`. Pre-existing and currently harmless, but it means the gate lives in one place rather than two.

The general shape is worth keeping: widening a predicate makes every *other* place that writes the widened value part of the attack surface. Enumerating the readers (above) is half the job; the writers are the other half.

## Related Issues

- [#441](https://github.com/taihartman/obsidian-atoms/issues/441) — this fix. Its original text named the wrong gate; corrected in-thread rather than left standing.
- [a-device-may-not-assert-an-entitlement-the-server-has-not-confirmed](a-device-may-not-assert-an-entitlement-the-server-has-not-confirmed.md) — the client half of the same collapsed `exhausted` status (#442/#443). Its closing prevention note predicted this: *one status field for two situations will be read as one situation*.
- [extracting-a-one-home-predicate-does-not-find-the-copy-already-there](../workflow-issues/extracting-a-one-home-predicate-does-not-find-the-copy-already-there.md) — the prior instance of the same trap: a consolidation verified against its own diff misses the copy that was already there. The parity test is the durable answer to both.
- `CONCEPTS.md` § "Ended period vs spent meter" — the vocabulary, now naming the server's home for the split.
