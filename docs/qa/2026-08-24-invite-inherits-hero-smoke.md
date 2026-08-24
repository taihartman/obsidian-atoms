# Smoke: invite inherits the hero (#594) — 2026-08-24

**Verdict:** Occupancy holds live. Wait card yielded. Invite is the question. Buttons stack and no longer paint into each other at 195px.

## Charter

Home with leftover captures plus a Show list invite. Authority: mock `docs/design-handoff/atoms-view/invite-inherits-hero.html`. Fixture-plumbing UI chrome (existing Show list + Frieren/Cowboy atoms). Not a Process dogfood loop.

## Live

- Installed **0.8.18** to `test_vault/test vault`. Fingerprint: `atoms-home-quiet-process` in `main.js`. `hasKey` `enabled` `egress` all true (`auto_on`).
- 22 unprocessed. Show list snooze cleared (Not now from 17 Aug still had `list:show list`).
- Eval innerText: no `Captures Waiting`; quiet `Process when you are ready.` + `Process now`; `Add to Show list?`
- Sidebar width **195px** (narrower than the 300px mock).

## Frames

| File | What it proves |
|---|---|
| `docs/qa/screenshots/invite-inherits-hero/home-side-panel.png` | Subtitle `22 thoughts ready to file`. Quiet Process. Lists kicker. Wait card gone. Last-catchup Sync everything still overlaps at this width (pre-existing row, stacked in this pass). |
| `docs/qa/screenshots/invite-inherits-hero/invite-actions.png` | After button `height: auto`: Add to Show list / Choose different note… / Not now stacked, no overlap. |

## Button boxes (eval)

Add to Show list 86×56. Choose different note… 86×74. Not now 86×44. `clip: false`. First live frame at min-height 44 overflowed wrapped labels into the next control; growing the box fixed it.

## Not tested

Need-key / limit / enable-auto still occupying. Loop-close then Track My car sequence. Adversarial edit/delete. Phone WebView (this is desktop `is-phone` at 195px).

## Learnings

Appended the three-identical-hash stale-frame trap.
