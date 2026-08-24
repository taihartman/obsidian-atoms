# Smoke: invite inherits the hero (#594) — 2026-08-24

**Verdict:** Occupancy holds live after the Apple cut and the review fixes. Wait card yields. Process lives in More. Loop-close is first; Keep it open then Track My car, with Show list unsnoozed.

## Charter

Home with leftover captures plus a car loop-close pair and a Show list invite. Authority: Apple-cut mock `docs/design-handoff/atoms-view/apple-home-chrome.html` (one question, then the library; Process in More). Fixture-plumbing UI chrome (existing Show list + Frieren/Cowboy atoms, planted 73042/73089 pair). Not a Process dogfood loop.

## Live

- Installed **0.8.18** to `test_vault/test vault`. Bundle sha `02bdab21` then reinstalled after the told-pair ranking fix. `atoms-home-quiet-process` absent from `main.js`. `hasKey` `enabled` `egress` all true (`auto_on`).
- 22 unprocessed. Show list snooze cleared (`atoms-entity-invite-snooze` `{}`).
- Eval: no `Captures Waiting`; no `Process when you are ready.`; no `Process now` on Home. Subtitle `22 thoughts ready to file`. **Does this close a loop?** Hub invite held as `My car` (`measured`) while the loop card shows.
- More menu: `Process (22)` / `Preview (22)` / `Sync everything`.
- Sidebar **390×844** (phone-width leaf in the root split).

## Frames

| File | What it proves |
|---|---|
| `docs/qa/screenshots/invite-inherits-hero/home-side-panel.png` | Subtitle `22 thoughts ready to file`. Wait card gone. No quiet Process row. Loop-close is the question. |
| `docs/qa/screenshots/invite-inherits-hero/loop-close.png` | Same occupancy; **Does this close a loop?** with both captures. |
| `docs/qa/screenshots/invite-inherits-hero/track-my-car.png` | After Keep it open, **Track My car?** (Series kicker). Show list still unsnoozed. |
| `docs/qa/screenshots/invite-inherits-hero/invite-actions.png` | Track My car / Already have it… / Not now stacked, 44px targets. |

Hashes: loop-close `058813c9588c` (paired). Track My car `d9e10717a975` (paired, distinct from loop).

## Car pair (#594)

Fixture-plumbing: two generated atoms matching the #589 unit pair (73042 open loop, 73089 reading). Show list **not** snoozed.

1. Home with 22 waiting: wait card gone, no quiet Process, **Does this close a loop?** with both captures verbatim. `pickHomeHubInvite` already holds Track My car.
2. **Keep it open** on the visible leaf. Loop card gone. **Track My car?** paints. A following `refresh()` still shows Track My car (told-pair overlap), not Add to Show list.

## Review-fix checks

- `shouldOfferProcessInMore`: auto_on offers Process in More; need_key / plus_limit do not (unit).
- Occupancy render: auto_on + leftovers + loop-close -> no `.atoms-home-wait-card`, loop card present (`test/atomsHomeView.test.ts`).

## Not tested

Need-key / limit / enable-auto occupying live. Close it (redeem) path. Real phone WebView. world-class-qa / adversarial-qa.

## Learnings

Keep-it-open on every `atoms-home` leaf, then a 400ms vault refresh, used to fall through to Show list because ranking only saw the live loop-close offer. Prefer told-pair overlap too. Click Keep only on the visible leaf when capturing.
