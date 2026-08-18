---
title: "An external side-effect is not vault resolution — park, don't close"
date: 2026-08-18
category: conventions
module: ask-mcp
problem_type: convention
component: assistant
severity: medium
applies_when:
  - "An Ask agent creates a reminder, calendar entry, or other outside-the-vault side-effect for an open loop"
  - "Writing ASK_MCP_INSTRUCTIONS or a scheduled-routine prompt that follows a loop"
  - "Choosing between continue_atom (continues vs redeems) and set_loop(resolved_elsewhere)"
tags:
  - ask
  - open-loops
  - reminder
  - redeems
  - resolved-elsewhere
  - mcp-instructions
---

# An external side-effect is not vault resolution — park, don't close

## Context

Ask already had a close path: substance close is `continue_atom` with relation `redeems`; corrections go through `set_loop` after the user confirms. `resolved_elsewhere` is a real terminal — it means the *thing itself* happened outside the vault. What it did not say is what to write when the agent only created a parking brake (a reminder, a calendar entry) and the thing has not happened.

The two wrong-but-plausible follow-ups both close the loop on every surface (`open_now` drops): `set_loop(resolved_elsewhere)` because "I handled it," or `continue_atom` with `redeems`. Either one makes the vault lie.

## Guidance

A reminder or calendar entry for a loop is a park, not a close.

- Record it as an **ordinary continue child** (`continue_atom` with relation `continues`, body like "Set a Thursday reminder to …").
- Never relation `redeems` for that park.
- Never `set_loop(resolved_elsewhere)` for that park.
- The loop stays open until the thing itself happens. The child shows up on the parent's `continued_by`, which is how a later session sees "already parked."

`resolved_elsewhere` stays available when the user confirms the *thing* happened outside the vault. The reminder is not that confirmation.

## Why This Matters

`open_now` is derived: intention mark present and no redeeming child. Ordinary continues never close it; `redeems` and the terminal loop states do. Closing on a side-effect drops the loop from every list/search/fetch that filters `open_now`, so future sessions stop offering it while the commitment is still live.

## When to Apply

- An agent (Claude, ChatGPT, or a scheduled routine) just created an external reminder or calendar item for an open loop and must write something back.
- Drafting or amending `ASK_MCP_INSTRUCTIONS` so every host inherits the same rule (instructions are the product surface; a runbook prompt is not enough).
- Reviewing a write that used `redeems` or `resolved_elsewhere` immediately after a reminder was set.

## Examples

**Park (correct).** Loop still `open_now`. Child is an ordinary continue; later `fetch_atom` on the parent lists it under `continued_by`.

**Close on the reminder (wrong).** `continue_atom` + `redeems`, or `set_loop(resolved_elsewhere)`. Parent drops out of `open_now`. The Thursday reminder will fire; the vault already says the loop is done.

**Close after the thing happens (correct).** User confirms they sent the email / had the conversation / paid the bill. Then substance `redeems`, or `set_loop(resolved_elsewhere)` if it happened entirely outside the vault.

## Related

- Issue #574 (reminder is not a close; unmerged as of this writing)
- `plus-service/src/mcp/instructions.mjs` — Open loops bullet
- CONCEPTS.md — Open loop
- `docs/plans/2026-08-12-002-feat-ask-agent-stance-plan.md` — instructions are the product surface; point up, do not duplicate law
