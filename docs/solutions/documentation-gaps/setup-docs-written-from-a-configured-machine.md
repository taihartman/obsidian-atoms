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
- **A default asserted rather than read.** The draft told readers to *turn on* BRAT's
  **Auto-update plugins at startup**; it ships on (`updateAtStartup: true`). It also said to leave
  the version dropdown on **Latest version**, which is not where it starts —
  `selectLatestPluginVersionByDefault` is `false`, so the control opens on "Select a version" and
  the reader must actually choose. Telling someone to enable what is already enabled, or to leave
  alone what they must change, both read as "this author did not run it."
- **A warning invented to sound helpful.** The draft claimed a full GitHub URL was "the usual thing
  to get wrong" in BRAT's repository field. BRAT's own placeholder is
  `Repository (example: https://GitHub.com/githubusername/repository-name)` — it models the URL and
  accepts it. A confident caution about a non-problem is worse than no caution: it costs the
  reader trust in everything around it.

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
- **Read the DOM to get the words right; open the image to check the frame. They are different
  questions.** Reading pane text through `eval` is what turns "I think it says X" into a quotable
  string, and it is cheap. It says nothing about what the camera caught. On the first pass here
  every DOM read was correct and **three of five screenshots were still wrong** — a CTA sliced off
  the bottom edge, a settings drawer overlaying the content pane mid-transition, and one frame that
  captured Obsidian's empty "New tab" view because the modal was still animating in. All three
  would have shipped under captions describing something the reader could not see.

  So: assert the target's geometry before capturing (`getBoundingClientRect()` inside the viewport,
  the tab list *not* present, an explicit `scrollTop`), give the UI a real settle delay after any
  action that reloads or animates, and then **look at the file**. The cost of opening a PNG is
  bounded and one-time; a wrong screenshot in a setup guide is unbounded and lands on every reader.

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
