---
title: "A setup doc written from a configured machine cannot see the first wall — install steps dead-ended at Restricted Mode twice"
date: 2026-08-04
category: documentation-gaps
module: www/setup
problem_type: unexecuted_instructions
component: docs
symptoms:
  - "Install steps said 'install BRAT from Obsidian's community plugins' while community plugins were off"
  - "A step existed that the tooling performs for you (Enable Atoms), and had been copied into two places"
  - "A newcomer on-ramp pass already shipped (#206/#207) and the flow still dead-ended"
  - "Nothing failed: build green, tests green, copy read fine to everyone who already had it working"
root_cause: instructions_authored_from_an_already_configured_state_never_meet_the_first_run_defaults
resolution_type: process_change
severity: high
tags:
  - onboarding
  - install
  - brat
  - documentation
  - verification
---

# A setup doc written from a configured machine cannot see the first wall

## The class, not the instance

The site told new users to install BRAT from Obsidian's community plugins. A brand-new vault has
community plugins **off** — Obsidian ships Restricted Mode on by default, and
`community-plugins.json` does not exist until you leave it. So the instruction's very first action
was impossible, and the page never mentioned the button that unblocks it.

The specific fix is one paragraph of copy. The interesting part is why it survived two passes,
including [#206/#207](https://github.com/taihartman/obsidian-atoms/pull/207), which existed
*specifically* to help newcomers.

**Every author already had it working.** Once a vault has left Restricted Mode it never returns, so
the wall is invisible from every machine that could have caught it. The docs were not sloppy; they
were written from a state the reader does not have. That is a systematic blind spot, not an
oversight, and it recurs in the same shape:

- **A step that is impossible from the default state** (Restricted Mode) — invisible because the
  author's state is not default.
- **A step that does not exist** — the docs said "Enable Atoms" in two places, but BRAT's
  `enableAfterInstall` defaults to `true` and its add-plugin dialog carries its own **Enable after
  installing the plugin** checkbox. Nobody had watched it happen; they had reasoned about what
  installing a plugin *ought* to require.
- **A string quoted from memory** — this page's first draft said the palette command was
  "BRAT: Add a beta plugin for testing". It is actually "BRAT: Plugins: Add a beta plugin for
  testing (with or without version)". Caught only by asking the running app.

The unifying property: **none of these can fail a build, and none can be caught by reading.** Tests
were green throughout. Review cannot catch them either, because a reviewer is also someone who
already has it working.

## What to do instead

Produce setup instructions by **executing them against a genuinely clean state**, and quote the UI
from the UI rather than from recall.

For this repo that is concrete and cheap. A throwaway vault plus the Obsidian CLI walks the whole
flow, and `eval` reads the actual labels out of the DOM:

```bash
obsidian vault="<throwaway>" plugins:restrict          # -> "on" for a fresh vault
obsidian vault="<throwaway>" plugins:restrict off
obsidian vault="<throwaway>" plugin:install id=obsidian42-brat enable
obsidian vault="<throwaway>" eval code='JSON.stringify(app.commands.commands["obsidian42-brat:AddBetaPlugin"]?.name)'
```

Two mechanical notes that cost time here:

- **A vault can only be created through the GUI.** Verified four ways —
  `obsidian://open?path=`, `open -a Obsidian <folder>`, the same after seeding a `.obsidian/`
  directory, and injecting the entry straight into `obsidian.json` (the entry persists, but a
  running Obsidian holds its vault list in memory). Budget one human click, or reuse a vault.
- **Screenshot the DOM's text, not the picture.** Reading pane contents through `eval` confirms
  which screen a capture actually shows, at a fraction of the cost of opening the PNG — and it is
  what turns "I think this says X" into a quotable string.

Full observed walkthrough: `docs/qa/2026-08-04-setup-walkthrough-findings.md`.

## The test that now holds the line

Coverage had the same blind spot as the prose: `test/wwwPricing.test.ts` enforced its structural
guarantees against **three hardcoded page arrays**, so a newly added page inherited none of them.
`/setup` would have shipped with no token, CSP, or inline-style checks at all.

The lists now derive from the build's own `PAGES` export, which makes the guarantees structural
rather than per-page. Plus assertions on the facts that made the old copy wrong — Restricted Mode
named, the repo given as `owner/repo`, Android's absence stated plainly, and every referenced
screenshot proven to exist in `dist`.

Related: when the on-ramp moved off the landing page, its existing test was **rewritten to follow
the content to `/setup`**, not deleted. A guarantee that relocates is still a guarantee; deleting
the test because the string moved is how the second regression gets written.
