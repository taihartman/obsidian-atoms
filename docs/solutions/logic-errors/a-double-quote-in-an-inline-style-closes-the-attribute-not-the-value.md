---
title: A double quote in an inline style closes the attribute, not the value
date: 2026-08-07
category: logic-errors
module: www/field-notes
problem_type: logic_error
component: email_processing
symptoms:
  - "Every email renders in Times New Roman instead of the system sans-serif stack"
  - "The generated HTML looks correct on casual inspection; the font-family value is visibly present in the source"
  - "No error, no warning, no failing test"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [email, html, inline-style, font-stack, string-interpolation, silent-failure]
---

# A double quote in an inline style closes the attribute, not the value

## Problem

`EMAIL_THEME.font` in `www/functions/_lib/fieldNotesEmail.mjs` held a font stack containing double-quoted family names. It is interpolated into `style="..."` attributes, so the first inner `"` closed the attribute early and browsers dropped the whole `font-family` declaration as malformed. Every Field notes email — including the signup welcome, live for the entire life of the mailing list — rendered in the browser default serif.

## Symptoms

- Body copy renders in Times rather than SF / Helvetica
- The emitted HTML contains the full font stack, so grepping for it finds nothing wrong
- Nothing fails: no console error, no test failure, no lint warning

## What Didn't Work

Nothing was tried, which is the point — the bug was invisible to every check in place. It surfaced only when a rendered screenshot of the letter was examined for layout and the body text was noticed to have serifs. Reading the generated HTML would not have caught it either; the value *is* in the string.

## Solution

Use single quotes for family names in any CSS value destined for an attribute:

```js
// before - the `"` closes style="..." and font-family is discarded
font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif',

// after
font: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif",
```

Guarded in `test/fieldNotesEmail.test.ts`, which asserts on the theme constants and on the emitted `<body>` tag, so the check survives a future refactor of the interpolation:

```ts
expect(EMAIL_THEME.font).not.toContain('"');
expect(EMAIL_THEME.serif).not.toContain('"');
const bodyTag = html.match(/<body[^>]*>/)?.[0] ?? "";
expect(bodyTag).toContain("sans-serif;");
```

## Why This Works

`style="margin:0;font-family:-apple-system, "SF Pro Text", ...;"` parses as `style="margin:0;font-family:-apple-system, "` followed by garbage attributes. The surviving declaration is `font-family:-apple-system,` — a trailing comma with no final family, which is invalid, so the parser discards the declaration entirely and the element inherits the default serif.

Single quotes are legal inside a double-quoted HTML attribute and are equally legal as CSS string delimiters, so the same stack works with no escaping.

The reason this shipped undetected is worth keeping: **the failure mode of a broken inline style is a silent fallback to a plausible default.** There is no error state to observe. Type is exactly the kind of property where "looks a bit off" does not trip an alarm, especially in email where the design is already unusual.

## Prevention

- Any string interpolated into an HTML attribute must not contain that attribute's quote character. Font stacks are the common offender because the canonical form ships with double quotes.
- Assert on the *rendered output*, not just the constant. The test checks both, so replacing the theme object does not silently remove the protection.
- **Look at rendered output, not just generated markup.** This bug was reachable only by rendering the HTML and looking at it. A preview path exists for exactly this: `node scripts/field-notes-send.mjs preview --draft <file> --out letter.html`.
- The general rule for this codebase's email layer: prefer single quotes in every CSS value in `EMAIL_THEME`, not only in `font`.

## Related Issues

- `docs/field-notes-email.md` — Resend Broadcast checklist includes a serif-not-sans check
- `.agents/skills/field-notes/SKILL.md` — recorded under **Do not**
