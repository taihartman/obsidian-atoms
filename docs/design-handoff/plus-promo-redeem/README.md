# Plus code — UI mock

**Status:** locked 2026-08-13. Unified Email cluster. Button **Use promo code**.  
**Open:** `index.html`  
**Plan:** `docs/plans/2026-08-13-1146-feat-plus-have-a-code-plan.md`

## Locked so far

- Stripe owns the code string. No plugin field.
- **Use Plus code** opens monthly Subscribe checkout, not Start trial.
- Trial button stays.
- One email field for sign-in, trial, and Plus code. Paste session stays its own form row.
- Copy: **Use promo code**. Matches Stripe. Not “gift.” Not only “Have a code.”

## Frames

| # | Job |
|---|---|
| 0 | Today. Three separate email-shaped rows. Rejected as sloppy. |
| Unified | One Email field. Send sign-in link, Start free trial, Use Plus code. |
| C | Unfinished Plus-code start. Not Finish trial setup. |
| D | Period ended. Existing Subscribe, one added sentence. |
| E | Notice + Checkout. **Add promotion code** is the Stripe tap. |

## Draft copy

| Surface | Name | Desc | Buttons |
|---|---|---|---|
| Email cluster | Email | Sign in, start a trial, or use a promo code. On checkout, tap Add promotion code. | Send sign-in link · Start free trial · Use promo code |
| Unfinished | Finish Plus checkout | Complete subscription checkout. On the next page, tap Add promotion code. | Finish Plus checkout |
| Period ended | Subscribe | *(existing.)* Have a promo code? Enter it at checkout. | Subscribe |
| Notice | — | Complete checkout in the browser. On the next page, tap Add promotion code. | — |

## Gate

Locked. Implement the unified cluster. Seventh row kind: one field, several commits.
