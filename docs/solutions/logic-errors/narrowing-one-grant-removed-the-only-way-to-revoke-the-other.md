---
title: "Narrowing one grant of an OR'd permission read removed the only way to revoke the other"
date: 2026-08-06
category: logic-errors
module: consent/egress-gate
problem_type: logic_error
component: plugin
symptoms:
  - "A device upgrading past the new ack stamp lost the Settings row that reviews and withdraws egress consent"
  - "The catch-up notice kept permitting paid Anthropic sends on the foreground-resume pass"
  - "The automatic-filing toggle read off while the paid path was still open"
  - "No remaining UI surface could take back a consent that was still spending money"
root_cause: scope_issue
resolution_type: code_fix
severity: high
tags:
  - consent
  - egress
  - revocation
  - permission-gate
  - versioned-ack
  - device-local
  - auto-run
  - settings-ui
---

# Narrowing one grant of an OR'd permission read removed the only way to revoke the other

## Problem

`readEgressPermitted` is satisfied by **either** of two device-local grants
(`src/platform/autorun.ts:152-158`). Version-stamping one of them narrowed that grant but not the
gate — and the Settings row gated on the stamp alone was the only surface that could withdraw either
grant.

## Symptoms

On a device holding a legacy (unstamped) egress ack *plus* a granted catch-up notice, after
upgrading to the build that introduced `EGRESS_ACK_VERSION` (`src/platform/autorun.ts:29`):

- Settings → the **What Atoms sends to Anthropic** review/withdraw row is simply gone.
- The **File automatically when Obsidian opens** toggle reads off.
- Yet returning to Obsidian still files and still spends on the paid Anthropic API — the foreground
  resume pass evaluates `readEgressPermitted(load, { catchUp: catchUp != null })`
  (`src/plugin/main.ts:1018`) as `catchUp: true`, and the notice grants it.
- Nothing on screen takes the grant back. The user is paying under a consent they cannot reach.

## What Didn't Work

The first cut of the stamping unit gated the row on `state.egressAcked` alone:

```ts
if (state.egressAcked) {
  this.actionRow(containerEl, { name: EGRESS_ACK_TITLE, desc: "Acknowledged on this device", … });
}
```

This looks right, and in isolation it *is* right: it was aiming at "don't claim the user
acknowledged wording they never saw," and a legacy `true` correctly stops counting as consent
(`readEgressAckVersion` returns null for a bare boolean, `src/platform/autorun.ts:98-104`). The
mistake is not in the narrowing — it's that the row is not a display of `egressAcked`. It is the
revocation surface for the **gate**, and the gate has a second disjunct: `LS_EGRESS_NOTICE`
(`src/platform/resume.ts:33`, read at `:265-267`), written by the Sync-everything-now catch-up flow
against its own separate disclosure. Invalidating a stamp never touched that boolean.

## Solution

Key the row on **either** grant, and name which one is actually on record
(`src/settings/settings.ts:1679-1704`):

```ts
// Before — gated on the stamp alone
if (state.egressAcked) { … desc: "Acknowledged on this device" … }

// After
const noticeAcked = readEgressNoticeAcked(load);
if (state.egressAcked || noticeAcked) {
  const record = state.egressAcked
    ? "Acknowledged on this device"
    : "Acknowledged on this device for Sync everything now, against earlier wording";
  this.actionRow(containerEl, {
    name: EGRESS_ACK_TITLE,
    desc: record,
    label: "Review",
    onClick: () => this.presentConsent(egressConsentSpec((verdict) => {
      if (verdict !== "withdrawn") return;
      writeEgressAck(save, false);
      writeAutoRunEnabled(save, false);
      clearEgressNoticeAcked(save);   // pre-existing: the other disjunct
      this.redisplay();
    }, `${record}.`)),
  });
}
```

**The gate on that `if` is the entire fix.** The withdrawal path was already correct:
`clearEgressNoticeAcked` (`src/platform/resume.ts:282-286`) landed with the row-grammar work in
#304, and this row's `onClick` has always called it. What was missing was never the clearing — it
was the row that reaches it. Branch-local commit `a3ce40d` on `fix/consent-wording-parity`, tracked
by PR #329 — open, draft, **unmerged as of this writing**.

## Why This Works

The root cause is a composed permission read with more than one widener. `readEgressPermitted` ORs
two independent, separately-written booleans; narrowing one of them narrows *that grant*, not the
gate. Two consequences fall out of that and both bit:

1. The gate stayed open when the UI said it was closed.
2. The revocation surface, keyed to the narrowed disjunct, disappeared while the un-narrowed one kept
   granting.

Reading the row from the same disjunct list the gate uses restores the invariant that matters: **if
any grant permits spending, a surface exists to take it back.** Naming which grant is on record is
the honesty half — a notice-only device never saw the unioned disclosure, so the row must not claim
on its behalf that it did.

Enabling and revoking are asymmetric reads of the same permission, and that asymmetry is what makes
this easy to miss. The automatic-filing toggle a few lines up (`src/settings/settings.ts:1651-1652`)
reads the stamp alone and is *correct* to — it gates enabling, which may legitimately demand the
freshest grant. Revoking must accept the loosest grant that still permits anything.

Three independent reviewers found this separately (a correctness lens, a security lens, and a
cross-model Grok pass at confidence 100), which is a signal about the shape: composed permission
predicates are exactly where a locally-correct change goes globally wrong.

## Prevention

**Rule: before changing any one disjunct of a permission predicate, enumerate all of them, and assert
the revocation surface stays reachable under each.** A narrowing is only safe once you can name every
other thing that still widens the same gate.

Concretely:

- Keep every grant in one function (as `readEgressPermitted` now is), and have the gate *and* the
  withdrawal read that same function — not one of its inputs.
- Any `write<Grant>` needs a matching `clear<Grant>`, wired into the single withdrawal path.
- A property test that walks the rows a screen *did* render cannot catch a required row that renders
  zero times. Presence assertions are a separate obligation: given the state that makes a control
  required, assert the control exists.
- Test the grant **open before** you test it closed. The regression tests in `test/settings.test.ts`
  do exactly this, because two `false`s taken only after a withdrawal cannot distinguish a working
  withdrawal from a gate that was never open (a gate stuck shut fails quietly, for everyone):

```ts
// test/settings.test.ts:803 — notice-only device, legacy stamp
const { tab, local } = askTab({}, {
  [LS_AUTO_RUN_EGRESS_ACK]: true,      // legacy: reads as unacknowledged
  [LS_AUTO_RUN_ENABLED]: true,
  [LS_EGRESS_NOTICE]: true,            // still permits the paid catch-up path
});
const load = (key: string) => local.get(key) ?? null;

expect(readEgressPermitted(load, { catchUp: true })).toBe(true);   // open FIRST
expect(rowNames(tab)).toContain("What Atoms sends to Anthropic");  // surface reachable
expect(row(tab, "What Atoms sends to Anthropic").textContent).toContain("earlier wording");

press(tab, "What Atoms sends to Anthropic", "Review");
pressSheet("Withdraw acknowledgment");

expect(readEgressPermitted(load, { catchUp: true })).toBe(false);  // every disjunct
expect(readEgressPermitted(load, { catchUp: false })).toBe(false);
```

Sabotage-proven: restoring the stamp-only guard fails this test. A companion at
`test/settings.test.ts:908` asserts the same for the both-grants-held device.

## See also

- `docs/solutions/logic-errors/security-fix-repair-wired-into-only-one-branch.md` — the closest
  cousin: same grant-set/counterpart-set asymmetry, but across two *branches of a code path* rather
  than two *disjuncts of a predicate*. Read its lesson 1 as "every branch **or disjunct**".
- `docs/solutions/logic-errors/a-property-test-is-only-as-strong-as-its-observers.md` — the R5
  consent-gate property test is structurally blind to this bug; it observes rows that rendered.
- `docs/solutions/architecture-patterns/holding-degrades-to-losing-when-the-repair-surface-is-machinery.md`
  — a live state with no on-screen action; this is the consent-surface instance of it.
- `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md` — U6, the unit that introduced the
  stamp, with the P1 and its fix recorded.
- Issue #315 (the bare-`true` ack that recorded consent without recording to what), PR #329.
