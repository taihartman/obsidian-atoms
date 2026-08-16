# Filing clarity and promo code — UI mock

**Status:** locked 2026-08-16. Row is a noun. One `Redeem code`, never hidden.
**Open:** `index.html`
**Plan:** `docs/plans/2026-08-16-001-feat-filing-clarity-promo-redemption-plan.md`
**Claim:** [#530](https://github.com/taihartman/obsidian-atoms/issues/530) · PR [#531](https://github.com/taihartman/obsidian-atoms/pull/531)

## Locked so far

- A settings row is a **noun with its state as the answer**, never a question. `Filing`, not
  `Who does the filing`. The word is defined once, in the File group footer.
- Atoms Plus and the user's own key are **not peers**: `Recommended`, then `Instead`.
- The credential form leaves the decision screen. All eight undefined terms move with it.
- **One** `Redeem code` row, in the Plus group and on the main screen, **never hidden**.
  Destination branches on whether a live Stripe subscription exists.
- Stripe owns the code string. No field in the plugin.
- Codes redeem through Subscribe, never Start trial.

## Frames

| # | Job |
|---|---|
| Today | Shipped copy with the eight undefined terms marked. |
| The Apple read | Four moves: two taken, two refused. |
| The row | `Filing` plus a state, in every account condition. |
| Plus first | `Recommended` / `Instead`, and the key screen behind it. |
| Redeem code | One permanent row, and the Stripe handoff. |
| Signed in | Six account states, two destinations, one former dead end. |

## Refused, deliberately

- **Silence about the vendor.** Apple would cut "runs on AI built by a company called Anthropic".
  Pillar three is the honest middle.
- **Privacy behind a link.** `What gets sent` previews a versioned, acknowledged disclosure.

## Gate

Locked. Implement per the plan. The portal half of `Redeem code` is blocked on verifying the
Stripe portal's promotion-code configuration in the Dashboard.
