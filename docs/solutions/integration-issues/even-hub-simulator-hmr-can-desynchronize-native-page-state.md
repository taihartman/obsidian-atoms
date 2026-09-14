---
title: Even Hub simulator HMR can desynchronize native page state
date: 2026-09-09
category: integration-issues
module: companion/even-g2
problem_type: integration_issue
component: testing_framework
symptoms:
  - "The simulator automation API reports a new page while the glasses framebuffer still shows the previous page"
  - "A renderer change appears broken after Vite hot reload but works after a full simulator restart"
root_cause: async_timing
resolution_type: workflow_improvement
severity: medium
tags: [even-g2, even-hub, simulator, hmr, qa-evidence, framebuffer]
---

# Even Hub simulator HMR can desynchronize native page state

## Problem

During the local Even G2 walkthrough for pending PR #623, Vite hot reload updated
the companion JavaScript without reliably resetting the simulator's native page
state. The automation API and browser-side state could advance while the glasses
framebuffer retained the previous page, making a correct renderer change look
broken.

## Symptoms

- A click changes the reported page but the framebuffer keeps the earlier screen.
- Repeating the same flow after a full simulator restart paints the expected page.
- Browser or DOM state alone disagrees with the pixels shown as glasses evidence.

## What Didn't Work

- Repeated clicks after hot reload. They acted on a mixed native and JavaScript
  state instead of establishing a clean starting point.
- Changing production rendering code to match the stale framebuffer. A clean
  restart showed that the renderer was already correct.

## Solution

Restart the pinned Even Hub simulator after companion code changes and before a
clean evidence run. Then drive the flow from the root screen and verify both the
automation state and the framebuffer at each important transition.

For this branch, the trusted sequence was:

1. Start the loopback harness with `npm run simulator`.
2. Let the real pairing and disclosure handlers complete.
3. Drive Create, Ask, and Recent from a fresh root screen.
4. Confirm the expected automation state and capture the corresponding
   framebuffer.

## Why This Works

A full restart makes the simulator's native navigation state and the newly loaded
JavaScript start from the same lifecycle boundary. Checking state and pixels
together prevents a stale native page or a misleading image viewer from becoming
evidence about production behavior.

## Prevention

- Treat hot reload as an iteration aid, not as a clean simulator-test boundary.
- Restart before final evidence or when automation state and pixels disagree.
- Require both state assertions and framebuffer inspection for important flows.

## Related Issues

- `docs/solutions/documentation-gaps/screenshot-capture-races-and-viewer-lies.md`
- Draft PR #623
