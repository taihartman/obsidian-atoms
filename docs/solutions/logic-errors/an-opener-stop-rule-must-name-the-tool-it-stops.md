---
title: "An opener stop-rule must name the tool it stops"
date: 2026-08-12
category: logic-errors
module: ask-mcp-instructions
problem_type: logic_error
component: plus-service
symptoms:
  - "Opening stance says do not keep calling tools"
  - "Later bullets still require mirror_status, list_tags, and fetch_atom"
  - "Hosts that obey the first screen skip the required follow-ups"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - ask
  - mcp
  - instructions
  - one-look
  - search_atoms
related:
  - docs/solutions/features/ask-search-silent-empty-and-index-expand.md
  - docs/solutions/security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md
  - docs/plans/2026-08-12-002-feat-ask-agent-stance-plan.md
---

# An opener stop-rule must name the tool it stops

## Problem

An opening MCP stance told hosts “One look… Do not keep calling tools.” The rest of the same string still required `mirror_status` early, `list_tags` after a tags miss, and `fetch_atom` before quoting. Hosts read the first screen first.

## Symptoms

- Empty `search_atoms` should still allow `list_tags` / `mirror_status`.
- A hit should still `fetch_atom` before a body claim.
- The unscoped stop made those later bullets look optional.

## What Didn't Work

- Adding a “Stance first” pointer under Read rules. It explained honesty (“this mirror,” not “no notes”) but left “do not keep calling tools” as the stronger, earlier command.
- Locking only the words `One look`. The suite stayed green while the stop contradicted live follow-up rules.

## Solution

Name the tool the stop applies to, and name the follow-ups that still apply:

```text
One look. Empty search means you don't see it in this mirror — say that.
Do not retry search_atoms. fetch_atom, list_tags, and mirror_status still apply.
```

Return phrasing is a **new query**, not a second look at the same one. Assert the unscoped phrase is **absent** (`doesNotMatch(/Do not keep calling tools/)`).

## Why This Works

Host models overweight the first block. A stop that names `search_atoms` cannot be read as a ban on the health and quote tools the file already requires. A pointer below cannot beat an earlier unscoped ban.

## Prevention

- When adding an opener to `ASK_MCP_INSTRUCTIONS`, grep the rest of the string for required tool calls and carve them out in the opener.
- Pair every new stop with a `doesNotMatch` on the unscoped wording, not only a `match` on the replacement.
- Frozen-sentence tests still do not prove the host will call the tools. Live SC4 after Fly remains the other half.

## Related Issues

- #471 / #472
- `docs/solutions/features/ask-search-silent-empty-and-index-expand.md` — empty search is mirror-only absence
- `docs/solutions/security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md` — substring locks are necessary and insufficient
