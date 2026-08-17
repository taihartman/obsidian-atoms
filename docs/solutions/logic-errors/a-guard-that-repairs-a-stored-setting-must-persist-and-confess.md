---
title: "A guard that repairs a stored setting must persist the repair and confess it"
date: 2026-08-14
category: logic-errors
module: pipeline-render
problem_type: logic_error
component: settings
symptoms:
  - "Atoms filed into a folder starting with a dot and none of them appeared in the explorer, in search or in the graph"
  - "The ↳ [[title]] marker in the daily note pointed at an atom Obsidian could not resolve"
  - "A 300-character atom folder made every write throw ENAMETOOLONG and filing quietly stopped producing atoms"
  - "After the guard shipped, the setting read Atoms while data.json still held .hidden"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags:
  - atom-folder
  - clamp
  - settings
  - migration
  - cross-platform
  - notice
---

# A guard that repairs a stored setting must persist the repair and confess it

## Problem

`clampAtomFolder` decides the folder every filed atom is written into. It rejected `..`, absolute
paths and multi-segment paths, and accepted two inputs that break filing in silence:

- **A leading dot.** A dotfile is not a traversal, and every existing guard had been written for
  traversal. `.hidden` persisted, and Obsidian does not index a folder starting with a dot: the
  file lands on disk, then `getAbstractFileByPath` returns null, `getMarkdownFiles()` under it
  returns 0, and `metadataCache.getFirstLinkpathDest` returns null. Every atom filed there is
  missing from the explorer, from search and from the graph, and the marker line the pipeline
  appends to the daily note is a link that can never resolve. `.obsidian` was accepted too, which
  aims atoms at the config directory.
- **Any length at all.** 255 bytes is the per-component limit, so a 300-character name made
  `createFolder` and `create` throw `ENAMETOOLONG` and Obsidian's own scanner log
  `{"errno":-63,"code":"ENAMETOOLONG","syscall":"scandir"}`.

Both were found by an adversarial QA pass, not by the tests, and both were reproduced live before
anything was changed.

## What Didn't Work

- **Capping the folder at a tidy 64 bytes.** This was the first draft and it is a worse bug than
  the one it fixes. `applyLoadedSettings` clamps the **stored** value at load, so any rule stricter
  than the filesystem silently relocates a working vault's folder on upgrade and strands every
  atom already filed under it. A long name is not a broken one. The cap belongs exactly at the
  limit that actually throws.
- **Repairing the value in memory only.** `applyLoadedSettings` clamped and then returned only
  whether the legacy hash strip had dirtied the file, so `loadSettings` never saved. `data.json`
  syncs: every other device kept receiving the broken name, and this one re-clamped it from
  scratch on every load forever. The unit tests passed because they asserted `plugin.settings`,
  which is exactly the half that was right.
- **Fixing the write path and leaving the read paths alone.** Writes clamp through
  `atomPathForTitle`, but roughly a dozen call sites in home, the graph and the Ask mirror read
  `settings.atomFolder` raw. The load-time clamp is the only thing holding those two in agreement.
- **Claiming parity in a comment.** The comment and a test title said the folder now matched
  `sanitizeFilename`. It did not: the trailing dot, the reserved device names and the trailing
  space the slash strip hands back were all still missing.

## Solution

Reject exactly what the filesystem refuses, then make the repair durable and visible.

1. **Guard at the real limit.** `seg.startsWith(".")`, and a **byte** cap at 255 — bytes because
   sixty-four 4-byte emoji are 256 bytes and sail through a character count.
2. **Take the parity all the way.** Trailing dot, `RESERVED` device names, and a re-trim of the
   segment. All three are legal on macOS and refused by Windows, and a vault syncs, so the
   cross-platform rule is the real one. `sanitizeFilename` already refuses them in every title.
3. **Persist the repair.** `applyLoadedSettings` compares the stored value with the clamped one and
   returns `stripped || folderRepaired`, so the load path writes it once instead of forever.
4. **Say it happened.** A one-time Notice names the folder that was given up. The atoms already
   written under it stay where they are — non-negotiable 2 forbids moving files — and their daily
   markers still claim those captures, so Process will not rebuild them either. A user who is
   never told cannot go and look. Persisting the repair is what keeps the Notice to one showing.
5. **Pin the constant, not just the boundary.** Every boundary test derived its expectation from
   `FOLDER_MAX_BYTES`, so editing 255 down to 64 would have kept the whole suite green while being
   the one harmful edit.

## Prevention

- **A validator that runs over stored state is a migration.** Ask what happens to a config that was
  legal yesterday. If the answer is "it changes under the user", the rule has to be exactly as
  strict as the thing it is standing in for, and no stricter.
- **A repair that lives in memory is not a repair.** When the file syncs, the stored value is the
  shared truth; leaving it broken means every other device re-learns the bug. Assert the **disk**
  value in the test, not only the in-memory setting.
- **Silent correction of user configuration needs a Notice**, especially when the correction leaves
  content stranded somewhere the product no longer looks.
- **When one half of a path is validated, check the other half.** `sanitizeFilename` had four rules
  the folder beside it lacked. Two of them were live bugs.
- **A test that derives its expectation from the constant under test cannot catch a change to that
  constant.** Pin the value where the value is the decision.

## Related

- `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md` § Adversarial pass — H2 and H3, where these were found and live-reproduced.
- `docs/solutions/logic-errors/a-bound-resolved-once-must-reach-both-consumers-by-construction.md` — the same read/write-split shape one level up.
