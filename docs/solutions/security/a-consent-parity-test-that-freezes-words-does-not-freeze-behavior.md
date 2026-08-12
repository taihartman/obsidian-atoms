---
module: platform/autorun
tags: [consent, egress, filing-window, test-design, adversarial-review]
problem_type: logic-error
date: 2026-08-10
issue: 427
---

# A consent parity test that freezes the words does not freeze the behavior they promise

## The problem

`test/egressConsentParity.test.ts` (U5, guarding against #315 recurring) asserts two things about
the egress disclosure: that home's sheet and Settings' sheet render the same title and the same
four clauses, and that an accept from either surface writes the same device-local keys
(`egressConsentParity.test.ts:150-173`). Clause (3) of `EGRESS_DISCLOSURE`
(`src/settings/consent.ts:23-24`) reads:

> "(3) today's daily note is never auto-touched"

That test suite stayed fully green through commit `de22124`, which made the home enable tap and
the Settings enable branch each fire an attended run with `includeTodayForRun` forcing today's
daily into scope on day one — the exact thing clause (3) says never happens. Nothing in the
parity suite could see it: it pins the *string* the sheet renders and the *keys* an accept writes,
and neither of those changed. The behavior drifted in a third place the test never looked —
`runWritePath`'s `includeToday` argument — and the suite has no assertion that reaches there.

The gap was closed by commit `4fa7cef`, and not by the test suite catching it: an independent
cross-model adversarial review read the enable path against the disclosure text and found the
contradiction directly.

## Why it happened

**A parity test proves two surfaces agree with each other, not that either agrees with what it
promises.** `egressConsentParity.test.ts` was purpose-built to catch surfaces drifting from *each
other* (the #315 shape: home and Settings quietly saying different things). It does that
correctly. But "home and Settings render the same clause (3)" and "the code obeys clause (3)" are
two different claims, and only the first one has a test. A behavioral promise made in prose is
invisible to a suite that only diffs prose against itself.

**Freezing words is cheap; freezing behavior requires naming the invariant separately.** The
regression test `4fa7cef` actually landed for this bug (referenced in its commit message) drives
the real enable chain against a vault double and asserts today's daily is byte-identical before
and after — a behavioral assertion, not a text comparison. It is a different test from the parity
suite because it is answering a different question.

## The fix — and why the fix was the code, not the words

Once the contradiction was found, there were two ways to close it: reword clause (3), or change
the behavior to match it. Rewording was the more expensive direction. `EGRESS_ACK_VERSION`
(`src/platform/autorun.ts`) means every existing device's consent record is stamped against exact
wording — softening or narrowing clause (3) would strand every device that already accepted the
old text, forcing a re-prompt fleet-wide for a change that made the disclosure *less* accurate to
what the code was doing, not more.

So the behavior moved instead: `runWritePath` in the auto-filing cycle is now called with a
literal `includeToday: false` (`src/plugin/main.ts:1179`), and `includeTodayForRun` was deleted
entirely rather than defaulted — see
[`a-guard-with-no-reachable-input-is-worse-than-no-guard`](../best-practices/a-guard-with-no-reachable-input-is-worse-than-no-guard.md).
Day one is now silent by design: the filing window starts today, every unattended and attended
auto-filing pass excludes today, and the first atoms appear the next day.

## How to apply this next time

- **When a disclosure makes a behavioral claim ("X never happens"), write a test that drives the
  real code path and asserts the absence of X — not just a test that the sentence is spelled the
  same in two places.** A parity/frozen-text test and a behavior test answer different questions;
  neither substitutes for the other.
- **Treat a version-stamped consent as a strong prior toward fixing the behavior, not the words.**
  If the disclosure and the code disagree, the disclosure is usually the one the user already
  agreed to and the code is the one that changed since; rewording is the option that costs every
  existing device its consent record.
- **A cross-model or adversarial review pass exists to catch exactly this shape** — a suite that is
  green because it checks the wrong invariant. If a review flags a promise-vs-behavior gap that a
  full test suite missed, that is the suite working as designed, not a suite that failed.

## Evidence

- Found by an independent cross-model adversarial review of the branch, not by
  `egressConsentParity.test.ts` (which stayed green throughout).
- Fixed in `4fa7cef` — `includeToday: false` literal at `src/plugin/main.ts:1179`,
  `includeTodayForRun` removed.
- Regression coverage: the behavioral guard added in `4fa7cef` drives the real enable chain against
  a vault double and asserts today's daily is byte-identical; verified it could fail by confirming
  a past-only count still returns zero on day one (the cycle short-circuits before calling `file`),
  which is why the existing catch-up test in `cff9c8c` covers that half separately.

## Related

- [`a-guard-with-no-reachable-input-is-worse-than-no-guard`](../best-practices/a-guard-with-no-reachable-input-is-worse-than-no-guard.md)
  — the cleanup that followed once `includeTodayForRun` had no legitimate caller left.
- [`a-versioned-consent-needs-both-halves-in-the-gate`](a-versioned-consent-needs-both-halves-in-the-gate.md)
  and
  [`a-consent-version-only-the-client-checks-does-not-gate-the-server`](a-consent-version-only-the-client-checks-does-not-gate-the-server.md)
  — sibling consent-integrity failures on the same versioned-ack mechanism.
- Issue #427, plan `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`.
