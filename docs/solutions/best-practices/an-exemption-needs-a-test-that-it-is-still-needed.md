---
title: "A style guard's exemption needs its own test that the exemption is still needed"
date: 2026-08-14
category: best-practices
module: settings
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - "Adding a repo-wide copy, lint, or style guard to a codebase that has frozen strings"
  - "Exempting a file from a guard for a reason that could expire"
  - "A typography or wording sweep is about to touch consent, legal, or versioned text"
tags:
  - consent
  - guards
  - voice
  - exemptions
  - data-integrity
---

# An exemption needs a test that it is still needed

## Context

A voice rule bans em dashes in product copy, enforced by a guard that reads each settings source and
fails on any it finds. One file could not comply: `src/settings/consent.ts` holds three standing
disclosure strings that carry em dashes and **cannot be reworded**.

The reason is not stylistic. Those strings name the exact wording a stored acknowledgment was
recorded against. Editing the text without bumping `EGRESS_ACK_VERSION` leaves every existing device
holding a consent record for text its user never saw — a data-integrity bug wearing a typography fix.

So the guard needs an exemption. And an exemption is a small time bomb: the reason it exists lives in
a comment, the comment stops being read, and years later the file sits outside a guard that everyone
assumes covers everything.

## Guidance

**Assert the exemption's own precondition, so the exemption cannot outlive its reason.**

The guard covers a list of sources and names the excluded file separately
(`test/settingsCopyVoice.test.ts`):

```ts
/**
 * `src/settings/consent.ts` is deliberately absent.
 *
 * Its three standing disclosure strings carry em dashes and **cannot be reworded** without bumping
 * `EGRESS_ACK_VERSION` (KTD5). ... Whoever bumps the version can add the file to the list above in
 * the same change.
 */
const FROZEN_BY_ACK_VERSION = "src/settings/consent.ts";
```

and then tests the exemption itself:

```ts
it("names the consent file it cannot cover, so the gap is deliberate", () => {
  const consent = stripComments(readFileSync(FROZEN_BY_ACK_VERSION, "utf8"));
  expect(consent).toContain("—");
  expect(COPY_SOURCES).not.toContain(FROZEN_BY_ACK_VERSION);
});
```

The first assertion is the important one. If those strings ever lose their em dashes — because the
ack version was bumped and the copy was rewritten properly — this test **fails**, and its message
sends the next person to move the file into the covered list rather than leaving it in an exemption
nobody re-reads.

## Why This Matters

An exempted file is invisible to the guard by design, which means the guard can never tell you the
exemption went stale. The exemption is the one thing that has to be checked from the outside.

The general shape: **when you carve something out of a rule, encode the carve-out's justification as
an assertion, not a comment.** A comment explains why the hole exists; a test notices when the hole
stops being necessary. Both are worth having, and only one of them fails the build.

This also protects the more dangerous direction. A repo-wide style sweep is exactly the kind of
change that gets applied mechanically and reviewed lightly, so the frozen strings' one defense
cannot be "the person running the sweep will remember about consent versioning." The exemption is
the defense, and the test is what keeps it real.

## When to Apply

Any exemption whose justification is a *condition* rather than a permanent fact:

- A file excluded from a lint rule "until it is refactored."
- A test skipped "while the upstream bug is open."
- A directory outside a formatter "because it is generated" — assert it is still generated.
- Any frozen string, fixture, or golden value carved out of a sweeping rule.

The test to write is the negation of the excuse. If the excuse is "these strings contain em dashes
we cannot remove," assert that they still contain em dashes.

## Examples

**The colliding-rules pattern generalizes past typography.** Two correct rules can be individually
right and jointly impossible: a voice rule that wants prose changed, and a consent-versioning rule
that forbids changing it. The resolution is never to silently let one win. Name the collision, pick
the side with the data-integrity consequence, and make the other side's guard aware of the carve-out
in a way that expires.

**Related:** [a-golden-value-in-the-same-file-is-defended-only-by-a-comment](a-golden-value-in-the-same-file-is-defended-only-by-a-comment.md)
is the same failure from the other end — a value protected by prose that the next editor does not
read.
