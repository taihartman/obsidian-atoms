---
title: "Ask before you spend: when the server revokes first, confirming after the call makes cancel the destructive choice"
date: 2026-08-05
category: architecture-patterns
module: src/platform/plusSignIn.ts, plus-service/src/store
problem_type: irreversible_side_effect_ordered_before_consent
component: plugin+service
symptoms:
  - "A confirmation dialog whose Cancel branch has to undo a server mutation"
  - "Cancel needs a compensating sign-out call; approve needs nothing"
  - "The dialog cannot name the account it is asking about without first spending the credential"
root_cause: the_only_call_that_reveals_the_facts_for_the_question_also_performs_the_irreversible_act
resolution_type: split_read_from_write_add_non_consuming_check
---

## Problem

#240's sign-in handoff had to ask one question — *"sign this vault in as `a@b.co`?"* — and the
only call that knew the email was `POST /v1/auth/exchange`. So the first design exchanged, showed
the confirmation, and on cancel called sign-out to undo it.

That ordering is inverted, and the reason is not stylistic. `exchangeMagic` calls
`revokeAllSessionsForEmail` **before** it mints (the #163 session-fixation fix, behaving as
designed) and the magic token is single-use. Exchange-then-ask therefore made **cancel** the
destructive branch: it revoked the account's other sessions, burned the link, and left the user
with less than they started with — for declining. Approve, meanwhile, needed no compensation at
all. A dialog where the safe-looking button does more damage than the dangerous one is not a
consent gate; it is a trap.

## Root cause

One call carried both the *facts the question needs* and the *act the answer authorises*. Any
confirmation built on it can only ever confirm something that already happened.

## Resolution

Split the read from the write, and make the read provably harmless:

1. **A non-consuming check is a separate store method, not a flag.** `peekMagic(token)` returns
   validity, account email, and the requesting vault, and mutates nothing. It is read-only *by
   construction* — expired rows are swept on **mint** instead, because a check that deletes is a
   check that can be weaponised into a delete.
2. **The confirmation renders the peek's answer, and only "confirmed" reaches the exchange.**
   Cancel and dismiss make **zero** requests — asserted on the request mock's call count, not
   merely on "no session was written".
3. **Carry the credential that satisfied *this* flow's check.** Re-reading device state at approve
   time is a second bug waiting: a user who taps *Send sign-in link* again while the confirmation
   is open prepends a newer verifier, and presenting that against the older link's row refuses
   someone whose only mistake was tapping twice.
4. **Bind the check to the same secret as the write.** Because the peek is verifier-bound, a
   wrong-vault handoff is refused *before an exchange exists to undo*. The refusal and the
   still-usable link fall out of the ordering rather than needing compensation.

## Test that would have caught it

The one that matters is not "approve works". It is:

```ts
// Cancel and dismiss must be free — count the calls, not the outcome.
expect(exchange).not.toHaveBeenCalled();
expect(readPlusSession(app)).toBeNull();
expect(readPendingSignIns(app)).toHaveLength(1); // link still redeemable
```

Verified by deliberate mutation: dropping the consent gate (`if (verdict !== "confirmed")`) turns
exactly those tests red. A consent test that stays green when consent is removed is documenting
nothing.

## Generalisation

Before building a confirmation, ask **which call produces the facts on the dialog**. If it is the
same call as the irreversible act, the dialog is decorative and you need a non-consuming read
first. The tell is at review time, in one line: *does the cancel branch have to call anything?* If
yes, the ordering is wrong — cancel should be a `return`.

Related: [`a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md`](a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md) —
same family of failure, one level down: a control asserted by a test that cannot fail.
