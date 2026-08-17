---
title: A right-edge floor that saves one button does not save three
date: 2026-08-13
category: ui-bugs
module: settings
problem_type: layout
component: form-actions-row
severity: medium
status: solved
tags:
  - settings
  - form-actions
  - obsidian-css
  - account
  - yield
applies_when: "A settings row puts more than one commit beside a field, and the name column is the thing that yields."
resolution_type: code_fix
---

# A right-edge floor that saves one button does not save three

## Problem

Settings → Account (signed out) crushed **Email** to `E..` and wrapped its description two or three characters per line. The field and three buttons still fit.

## Symptoms

- Name and desc occupy a ~20px sliver on the left of the Email card
- `Advanced: paste session` (one field, one button) looks normal
- Phone wrapping of the three buttons does not fire; this is desktop / tablet

## What Didn't Work

`#349` gave the field a 164px floor and let the name column yield. That is the right tradeoff for `formRow`. `formActionsRow` reused the same yield with three commits. The floor still held. The name column ran out of width.

## Solution

Stack `atoms-setting-form-actions` only: info takes the first line, the field takes the next, the commits sit under the field. `formRow` stays inline. Phone still stacks the buttons via the existing `is-phone` rule.

Authority: `docs/design-handoff/plus-promo-redeem/` — name + desc full width, field on its own line, buttons under it.

## Prevention

A min-width on the field does not budget the rest of the right edge. When a kind grows a second or third commit, restack that kind. Do not raise the floor and squeeze the name harder.

## Related

- [#486](https://github.com/taihartman/obsidian-atoms/issues/486)
- [#349](https://github.com/taihartman/obsidian-atoms/pull/349) (the 164px floor)
- `docs/design-handoff/plus-promo-redeem/`
