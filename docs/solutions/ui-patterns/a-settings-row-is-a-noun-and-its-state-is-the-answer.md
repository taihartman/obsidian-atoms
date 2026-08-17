---
title: "A settings row is a noun and its state is the answer, so a row that asks a question has no phrasing that fixes it"
date: 2026-08-16
last_updated: 2026-08-16
category: ui-patterns
module: settings
problem_type: ui_bug
component: settings-tab
symptoms:
  - "Non-technical users could not tell what the `Who does the filing` row was asking them"
  - "Eight terms a first-week user cannot define rendered on the one screen holding the one decision Atoms cannot make for them"
  - "A design debate cycled between three phrasings of the same question without converging"
  - "A promo-code path that worked end to end could not be found by anyone holding a code"
root_cause: wrong_abstraction
resolution_type: design_change
---

# A settings row is a noun and its state is the answer

## The problem as reported

Two asks: make `Who does the filing` legible to a non-technical reader, and add a button for
redeeming a Stripe promo code.

## What the first three attempts had in common

The row was renamed three times before anyone noticed the shape was wrong:

1. Keep `Who does the filing`, define "filing" on the screen behind it.
2. `Who pays for filing`, so the main screen says what kind of decision it is.
3. `Who files your captures`, converging with `SETUP_STEP_NAMES.filing_owner`, which already
   said exactly that.

Each is a better question than the last. **All three are questions in a row label**, and that is
the defect. An iOS Settings row never asks anything: it names a thing and puts its condition in
the value slot. `Wi-Fi › Home`. `Screen Time › On`. The reader learns the vocabulary from the
answer, not the label.

`Filing › Not set up` is shorter than all three candidates and teaches the word through the
answer. The debate had been about which phrasing of a question is clearest, which is downstream
of a premise the row should have rejected.

**The transferable part:** when successive rewrites of a label all feel like improvements and none
feels finished, check whether the *form* is wrong before rewriting the words again.

## Where the definition goes

"Filing" is this product's coinage, so a bare noun needs the word taught somewhere the reader
meets without tapping. The #493 grammar already gives every group exactly one footer whose job is
explaining the group. The definition went there, ahead of the existing safety sentence. No new
row, no paragraph on the decision screen.

## The corollary that did the real work

The engine screen was two things at once: a decision, and a credential form. Moving the API key
field, the device-local fallback and the secret-id naming rule behind the option that needs them
took **all eight** undefined terms off the decision screen without deleting a word from the
product. Every one still renders, in front of the one reader who chose to meet it.

A recommended path and an escape hatch must also not be peers. `Pick one` holding both at equal
weight left the reader to work out which was which. `Recommended` then `Instead` says it.

## Where borrowing iOS stopped

Two Apple patterns were **refused**, and the refusals matter more than the adoptions:

- **Silence about the vendor.** Apple would delete "runs on AI built by a company called
  Anthropic, and every capture costs a few cents." The vendor and the unit economics are the
  vendor's problem. Pillar three of this product is *the honest middle*, and consent to send is
  gated on saying what gets sent. Reticence cannot be borrowed here.
- **Privacy behind a linked sheet.** *About Siri & Privacy* is the right placement pattern in
  general. `What gets sent` previews a **versioned, acknowledged** disclosure, and relocating a
  consent surface to win a layout argument is how a device ends up filing under a grant nobody
  read.

## The hidden-affordance bug this produced on the way

The promo row was first specified as "hidden on a live subscription", to stop a tap from opening a
second one. That reasoning is sound and the conclusion was wrong.

`start_trial` Checkout creates a **real Stripe subscription** carrying
`subscription_data[trial_period_days]`, so a user three days into a fourteen-day trial is `active`
with `status: "trialing"` — and that is precisely the person most likely to be holding a founding
or friend code. Hiding the row left them with no route and nothing on screen explaining why.

**A hidden affordance is worse than a dead end, because it is an invisible one.** The branch
belonged on the destination, not on whether the row renders: no live subscription goes to
Checkout, a live one goes to the billing portal where the coupon attaches to the subscription that
already exists.

`hasLiveSubscription` in `src/settings/settings.ts` is the one home for that distinction, named so
the next reader does not re-derive it from `AccountState`'s six kinds.

## Two things found only by reading the code the design assumed

- `SettingGroupSpec.header` is a **required** `string`; only `footer` is optional. The purer
  unheadered primary group would mean widening the primitive every group on the tab renders
  through. Rejected. `Recommended` carries real information anyway.
- `destinationRow` has **no value slot** — the chevron is the right edge — so the answer rides in
  the description. That non-uniformity is already on the books as **F10 (P3)** in the #493 QA
  report. Widening the shared primitive to fix it is its own claim, not a ride-along.

## Related

- `docs/plans/2026-08-16-001-feat-filing-clarity-promo-redemption-plan.md`
- `docs/design-handoff/filing-clarity-promo/`
- `docs/solutions/architecture-patterns/a-rule-that-keeps-producing-an-ugly-shape-is-missing-a-kind.md`
