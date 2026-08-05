---
title: "Capturing guide screenshots — the frame can lie twice, and so can the viewer"
date: 2026-08-05
category: documentation-gaps
module: www
problem_type: documentation_gap
component: setup-guide
severity: medium
applies_when:
  - "Capturing Obsidian screenshots for www/src/*.tmpl via `obsidian dev:screenshot`"
  - "Verifying a rendered www page before attaching PR evidence"
  - "Documenting an install flow the dev machine already completed"
tags: [screenshots, obsidian-cli, qa-evidence, webp, setup-guide]
---

# Capturing guide screenshots — the frame can lie twice, and so can the viewer

`19c486f` already established that reading a screen's DOM is not proof of what the
image contains: three of five frames were wrong while every DOM read was correct.
De-BRATting `/setup` (#299) hit three more failure modes that DOM-reading cannot
catch, all of which would have shipped a confidently wrong page.

## 1 · The first `dev:screenshot` after a state change captures the old frame

The Community-plugins Browse modal was open and asserted open by `eval` both
immediately before and immediately after the capture. The PNG still came back
showing Obsidian's empty **New tab** view — the same symptom `19c486f` attributed
to "the modal was still animating in", which is why waiting longer looks like the
fix and is not.

Issuing the identical `dev:screenshot` a second time, with no further waiting and
no DOM change, produced the correct frame.

**Do this:** capture twice and use the second file, or assert the frame's own mean
colour / dimensions before trusting it. Do not conclude the modal failed to open
because the first frame is wrong — check the DOM, then re-shoot.

## 2 · The dev machine is already installed, so it cannot show the install

The vault used for the walkthrough had Atoms installed, so the store listing
rendered an `INSTALLED` badge and no **Install** button — a frame that shows the
reader a state they will never be in. The fix is to uninstall in the throwaway
vault, capture the newcomer state, then reinstall *through the flow the guide
describes*. That is not extra work; it is the only pass that dogfoods the
instructions, and here it verified two claims the copy depended on:

- **Install** turns into **Enable** in place — installing does not switch it on.
- Searching `Atoms` returns **two** results and **Bonds by Zak ranks first**, so
  "search Atoms and install it" is not a safe instruction. The guide has to name
  the author.

Neither is visible from a machine that already has the plugin.

## 3 · The in-app preview pane silently fails to decode WebP

Verifying the built page in the Claude preview pane reported `naturalWidth === 0`
for **all four** shipped `.webp` frames, including ones that have been live for
days. `curl` returned `200 image/webp` with the right byte count, and Playwright
against the same server decoded all four. The pane is not a valid renderer for
this site's evidence.

**Do this:** serve `www/dist` (`python3 -m http.server --directory`, backgrounded)
and screenshot with Playwright. A file:// load is also useless here — the build
emits absolute `/a/…` asset paths that resolve to the filesystem root.

## Cost of getting it wrong

Each of these ships a page that is internally consistent, passes its tests, and
tells a new user to do something they cannot do. `/setup` is the first surface a
community-directory install reaches; a wrong frame there reads as an abandoned
product.
