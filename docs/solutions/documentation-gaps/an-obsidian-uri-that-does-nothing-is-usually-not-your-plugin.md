---
title: "An obsidian:// URI that does nothing is usually not your plugin — 1.13's trust prompt, a stale Launch Services record, and an unknown vault= name"
date: 2026-08-05
category: documentation-gaps
module: src/plugin/main.ts (registerObsidianProtocolHandler), docs/qa
problem_type: environment_failure_mistaken_for_product_bug
component: desktop
symptoms:
  - "Deep link fires, plugin handler never runs, nothing on screen, no error"
  - "The same link worked ten minutes earlier in the same session"
  - "obsidian CLI hangs on every command, including `obsidian version`"
  - "A core obsidian://open URI also does nothing, with no plugin involved"
root_cause: three_independent_app_level_gates_between_the_url_and_the_handler
resolution_type: diagnostic_order_and_recorded_device_results
---

## Problem

During #240's live smoke (Obsidian 1.13.4, installer 1.12.7, macOS), `obsidian://atoms-signin`
stopped reaching the plugin. The handler was registered, the plugin was loaded, the right vault was
active, and the same URL had worked minutes before. Roughly an hour went into suspecting the
KTD8 cold-open registration, which was never the problem.

## Root cause — three gates, none of them ours

1. **Obsidian 1.13+ gates every external link.** A URI arriving at a *running* app raises
   **"Run action from external link?"** (Allow once / Always allow / Cancel) before the plugin sees
   it. It is answered once per action per app session and is **not** persisted to vault config, so
   every restart re-arms it. Unanswered, it **queues** later URIs — so the second, third and fourth
   attempts silently pile up behind the first, which looks exactly like a dead handler. A URI that
   *launches* a cold app was not gated at all.
2. **An unknown `vault=` name wedges the app.** `obsidian://open?vault=NoSuchVaultXYZ` — no plugin
   involved — left Obsidian unresponsive to the CLI until force-restart. Attributing this to the
   plugin is the natural mistake, because the plugin's own deep link also carries `vault=`. It does
   not reach the plugin: Obsidian resolves that parameter first.
3. **Launch Services goes stale after an auto-update.** Obsidian updated itself mid-session; every
   `obsidian://` URI was then dropped without a trace until
   `lsregister -f /Applications/Obsidian.app` plus a restart.

## Diagnostic order (cheapest first)

1. Fire a **core** URI with an observable effect: `obsidian://open?vault=<real vault>&file=<note>`.
   Nothing happens → the problem is delivery (gate 1 or 3), not your handler. Stop suspecting your
   code.
2. Look for an open modal before anything else:
   `obsidian vault="…" eval 'code=[...document.querySelectorAll(".modal")].map(m=>m.innerText)'`.
   The trust prompt is a normal in-app modal and is clickable from `eval`.
3. `obsidian version` hangs → the app is blocked by a dialog, not busy. Force-restart is the only
   remedy without accessibility permissions (`osascript` needs assistive access this machine does
   not grant).
4. Only then re-register: `lsregister -f`, restart, retest.

## Consequences for the product, not just for QA

- The plugin's copy — "Open it on this device and Obsidian signs itself in" — does not mention that
  1.13+ asks for permission first. One extra tap the user was not told about.
- **Never fire a URI at a vault name that might not exist on the device.** That is a user-reachable
  app wedge from any web page, upstream and unfixable from here.
- A test asserting "the handler is registered above `onload`'s first `await`" (source-level, as
  #240 U9 ships) proves the registration *site* and nothing about whether the app ever dispatches.
  Only a live fire, ideally from a fully quit app, covers that.

Device results are recorded in [`docs/qa/testing-fixtures.md`](../../qa/testing-fixtures.md) and the
smoke evidence in
[`docs/qa/2026-08-05-240-magic-link-handoff-world-class-qa.md`](../../qa/2026-08-05-240-magic-link-handoff-world-class-qa.md).
