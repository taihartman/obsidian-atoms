---
title: "A two-device Sync test must outwait Sync before it can blame the code"
date: 2026-08-06
category: workflow-issues
module: workflow/qa
problem_type: workflow_issue
component: tooling
applies_when: "Testing any behavior that depends on Obsidian Sync replicating .obsidian/plugins/<id>/data.json to a second device, especially onExternalSettingsChange."
resolution_type: process_change
severity: medium
tags:
  - obsidian-sync
  - onExternalSettingsChange
  - two-device-qa
  - false-negative
  - "#323"
---

# A two-device Sync test must outwait Sync before it can blame the code

## The problem

The #323 dogfood looked like a clean failure. On `0.6.81-beta.1`, with both devices confirmed
on that build, a consent withdrawn on the phone did not reach an already-running desktop.
Restarting the desktop showed the withdrawal applied. The obvious reading: `data.json`
replicates fine, so the new `Plugin.onExternalSettingsChange()` hook must be broken.

That reading was wrong, or at least unearned. The test could not distinguish a hook that
never fires from a file that had not arrived yet, because **every step ran inside about a
minute** — withdraw on the phone, glance at the desktop, kill the desktop. `.obsidian/`
config files do not replicate on the same cadence as notes, and nothing in the test waited
for or observed the file itself.

## Why the debugging pass could not settle it either

A full `ce-debug` ruled out every code-side cause it could reach, and all of them are worth
recording because each is a plausible first guess:

- **Did the hook ship?** Yes. Downloading the released `main.js` from the tag and grepping it
  is a two-command check, and it kills the "the build didn't include it" theory outright.
- **Folder name vs manifest `id`.** The known killer of this callback is a plugin directory
  whose name differs from the manifest `id` — Obsidian's dispatch looks the plugin up by
  folder name. Ours is `atoms` and the repo is `obsidian-atoms`, which *looks* like the bug.
  It is not: BRAT writes to `plugins/${betaPluginId}`, the manifest id, not the repo name.
  Worth checking in any repo whose name differs from its plugin id, and worth checking by
  reading BRAT's source rather than assuming.
- **Sync's community-plugin-settings toggle.** Off by default, and if off, `data.json` never
  crosses devices at all — a silent no-callback indistinguishable from a broken callback.
  Already disproven here by the withdrawal reaching the desktop's disk at all.
- **Could the UI layer swallow it?** No. Settings are applied *before* the `settingTab`
  null-check, so the egress gate closes with the screen shut, and `redisplay()` has no
  debounce.

Obsidian staff closed the "Sync doesn't hot-reload plugin settings" forum bug by pointing at
this exact callback (API 1.5.7). No source claims Sync fails to fire it.

## The lesson

**A negative result from a live sync test is only evidence if the test outlasted the sync.**
Otherwise it is a false negative dressed as a root cause, and it is expensive: it nearly sent
a correct change back for redesign.

Before concluding that a sync-driven hook is broken:

1. **Observe the file, not the UI.** The question is whether `data.json` changed on disk while
   the app was running. Check its content or mtime on the receiving device *before* restarting
   anything — a restart destroys the only evidence that separates the two explanations.
2. **Take the transport out of the test.** Hand-edit `data.json` on the running device with a
   text editor. If the app reacts, the hook works and the variable is Sync. If it does not,
   the wiring is broken. This is the one-minute experiment that should run *first*, because it
   is fully local and fully deterministic — no second device, no network, no cadence.
3. **Only then run the two-device leg**, and give it minutes, not seconds.

Generalizes past Obsidian: any test whose failure mode includes "the thing under test never
received the input" needs a step that confirms the input arrived. Otherwise the test cannot
tell you which half failed, and the more interesting half will get the blame.

## Sequel

The branch merged with `Closes #323` as the repo owner's explicit call, with the unproven
cross-device leg recorded plainly in [PR #330](https://github.com/taihartman/obsidian-atoms/pull/330)'s
Evidence table rather than quietly checked off. The local holes the same branch closes — a
follow-up mirror pass that crossed no gate, a blank `data.json` read wiping every setting, a
race that could resurrect a revoked consent — never depended on the hook firing, which is why
merging was defensible even with the headline claim open.

See [consent-gate-must-be-checked-at-egress-not-at-entry](../security/consent-gate-must-be-checked-at-egress-not-at-entry.md)
for the substantive learning from the same work.
