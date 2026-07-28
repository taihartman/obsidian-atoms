---
title: "iOS Shortcut capture wire format — verify the format-producing step on device"
date: 2026-07-28
category: documentation-gaps
module: capture-inbox
problem_type: documentation_gap
component: capture-shortcut
severity: high
applies_when:
  - "Writing or changing the iOS capture Shortcut recipe in docs/capture-shortcut.md"
  - "Changing STAMP_RE or the inbox line format the Shortcut must produce"
  - "Shipping any contract where an external tool must emit an exact string"
tags:
  - capture
  - ios-shortcuts
  - wire-contract
  - inbox
  - date-format
related_components:
  - "src/pipeline/inbox.ts"
  - "src/settings/captureShortcut.ts"
  - "docs/capture-shortcut.md"
---

## Context

The capture inbox (#56, shipped 0.6.49) depends on an iOS Shortcut appending a
line the plugin can parse. `STAMP_RE` (`src/pipeline/inbox.ts:44`) accepts only
an ISO 8601 local datetime whose offset carries a colon — `2026-07-28T17:23:34-04:00`
— followed by whitespace and the capture text.

The recipe in `docs/capture-shortcut.md` was written from research plus a partial
device smoke, and the QA report honestly flagged two details as "documented but
unverified on device." Building the Shortcut for real took roughly forty minutes,
almost all of it spent on those two unverified details. The recipe was not wrong
in a way you could see by reading it; it was wrong in a way you could only see by
building it.

## Guidance

**iOS Shortcuts has two different places to set a date format, and only one of
them works.** Tapping the blue `Current Date` chip opens the *magic-variable*
panel — recognisable by its **Clear Variable / Return** buttons and its
Date / Time / Name rows. A custom format entered there governs how that variable
renders when dropped into a text field, and has no effect on what the **Format
Date action** outputs. The action keeps its own default and emits locale Short
style. The field that matters is behind the action's own disclosure arrow,
labelled **Format String**, sitting between **Date Format** and **Locale**.

Symptom: every stamp looks like `7/28/26, 12:00 PM`.

**Use `ZZZZZ`, not `Z`.** In ICU patterns a single `Z` renders the offset as
`-0400` with no colon; `STAMP_RE` requires `-04:00`. Shortcuts' own default
custom format — `EEE, dd MMM yyyy HH:mm:ss Z` — is wrong on both the layout and
the offset, so accepting the default fails twice over.

**A `Current Date` variable restricted to the Date component truncates the time
to noon.** If every stamp reads `12:00:00`, the variable has `Date` selected
instead of the full value. Clear the variable and re-insert it without choosing a
component.

**Do not rely on a menu-result variable to carry a branch's text.** A
`Choose from Menu` block feeding `Menu Result` into downstream actions did not
reliably deliver the chosen branch's output; it produced a stray timestamp and a
line break inside what should have been plain capture text. Set an explicit
variable in each branch (`Set Variable` → `Capture`) and consume that.

## Why This Matters

Every one of these failures is **silent at the capture boundary**. The Shortcut
reports success, the line reaches `Atoms System/Inbox.md`, and nothing surfaces
until the plugin's parser rejects it. The user's only signal is opening the inbox
note by hand and reading it closely enough to notice the stamp is a locale short
date rather than ISO.

It got worse than that in practice. The malformed captures produced lines that
were neither a bullet, a continuation, nor a marker — so the parser skipped them
entirely and they were not even counted as unreadable (issue #177). The health
indicator in Atoms home under-reported while text sat in the note going nowhere.
A bug filed as theoretical that morning was demonstrated by the first real user
that afternoon.

The transferable rule: **when a contract depends on an external tool emitting an
exact string, "unverified on device" is not a caveat, it is a blocker.** Prose can
describe a UI accurately and still be unfollowable, because the failure lives in
which of two identically-named fields you happen to tap. Verify the
format-producing step on the real device before publishing the recipe that tells
users to build it.

## When to Apply

- Before changing `STAMP_RE` (`src/pipeline/inbox.ts:44`) or the daily-note line
  shape, since both ends of the wire move together.
- Before publishing or editing the recipe in `docs/capture-shortcut.md`. Bump
  `CAPTURE_SHORTCUT_VERSION` (`src/settings/captureShortcut.ts:9`) so installed
  shortcuts prompt to update.
- Any time a feature's correctness depends on an external tool — Shortcuts,
  a webhook sender, a CLI wrapper — producing a byte-exact format we parse.

## Examples

Broken — custom format set on the variable rather than the action, and a
menu-result variable carrying junk:

```
- 7/28/26, 12:00 PM
7/28/26, 9:38 AM Test capture
```

Line 1 has an unparseable stamp; line 2 is not a bullet at all, so it is skipped
and uncounted.

Correct, verified on device 2026-07-28:

```
- 2026-07-28T17:23:34-04:00 Test
```

Which the drain files into that day's daily as a rapid-log bullet, with the
timestamp stripped from the atom body by `parse.ts`:

```
- 17:23:34 Test
```

## Related

- Issue #56 — iOS capture inbox and drain; PR #167.
- Issue #177 — lines that are neither bullet, continuation, nor marker vanish
  uncounted. Demonstrated by exactly this misconfiguration.
- `docs/qa/2026-07-28-ios-capture-inbox-drain-world-class-qa.md` — the QA report
  that flagged these two details as unverified before they bit.
