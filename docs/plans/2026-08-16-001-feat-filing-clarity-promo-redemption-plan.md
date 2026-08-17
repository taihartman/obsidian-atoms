---
title: "Filing clarity and promo redemption - Plan"
type: feat
date: 2026-08-16
artifact_contract: ce-unified-plan/v1
artifact_readiness: draft-pending-doc-review
product_contract_source: ce-plan
execution: code
---

# Filing clarity and promo redemption - Plan

## Goal Capsule

**Objective.** Make the one decision Atoms cannot make for anybody legible to somebody who does not
know what an API key is, and give a person holding a promo code somewhere to spend it. Two asks, one
screen apart, both copy-and-placement rather than new capability.

**Authority.** `docs/voice.md` and the **`atoms-voice`** skill govern every string here. `CLAUDE.md`
non-negotiables outrank everything. The #493 group grammar (`src/settings/rows.ts:17-45`, one footer
per group, prose only, never an action) governs structure. `docs/design-handoff/plus-promo-redeem/README.md`
is **locked** and constrains the promo half. Mock for this plan: published artifact, reviewed and
approved by the owner 2026-08-16; committed to `docs/design-handoff/filing-clarity-promo/` in U0.

**Stop when.** The File row is a noun carrying its state; the decision screen carries no term it does
not define; the API key field, the device-local fallback and the secret-id naming rule sit behind the
option that needs them; a `Redeem code` row renders in all six account states and reaches a working
destination in each; the main screen carries an `Atoms Plus` group; `npm test`, `npm run lint` and
`npm run build` pass; `test/copyVoice.test.ts` is green with no new exemption; `www/dist` is
regenerated and committed; phone and tablet evidence captured on a live vault.

**Out of scope.** Any change to how the key is stored, read, or transmitted (U2 relocates rows, not
credentials). Any new Stripe route, coupon logic, or `/v1/promo` wiring. Re-shaping the locked
email cluster. Pricing values. **No longer out of scope:** the billing-portal promotion-code
configuration, pulled in by KD6 because it is the only thing that gives a trialing user a route.

**Execution profile.** U1 to U5 each mutate the shared `expectedRows()` fixture and therefore land
**sequentially, not in parallel**, the same constraint KTD12 of the three-leg plan recorded. U6 closes
copy lockstep and version.

**Lane: full.** Escalated from light, deliberately. `docs/workflow-lanes.md` auto-escalates anything
that "touches security / auth / API keys / secret storage", and U2 moves the Anthropic API key row
to a new screen. It is a relocation with no change to storage or transmission, which is exactly the
reasoning the rule exists to refuse. **Doc-review: full** (coherence, feasibility, product, design).
If the owner drops KD3, the remaining work is copy plus two rows and the lane drops to light.

**Hard-claim prerequisite.** No issue covers this. Per `docs/collab.md`: create and assign a GitHub
Issue, add a `STATUS.md` row, open a **draft** PR, and only then implement. Branch is
`claude/filing-clarity-promo-redemption-ih1220`.

---

## Product Contract

### Summary

Rewrite the engine screen so it defines filing before it asks who pays for it, move every technical
term behind the option that needs it, and surface the promo-code path that already works but cannot
be found.

### Problem Frame

**Half one.** The engine screen (`src/settings/settings.ts:565-598`) holds the only decision Atoms
cannot make for a user, and states it in eight terms a first-week user cannot define: *Anthropic*,
*API key* (three times), *Device-local*, *fallback*, *SecretStorage*, *TLS*, `sk-ant-…`, and a
charset spec for a secret-id name sitting in the group footer underneath the pricing. Nothing on the
screen is wrong. It is precise, and it is aimed at a reader who has already made the decision it is
asking for.

Two structural faults sit under the vocabulary. The screen never defines **filing**, the product's
own core verb, so the question "Who does the filing" is opaque before the reader taps and stays
opaque after. And the screen is two things at once: a decision, and a credential form. A person
choosing who pays is shown a text field for a key they may never own.

**Half two.** The promo path is already built end to end. `plus-service/src/stripe.mjs:208-210` sends
`allow_promotion_codes: "true"` unconditionally, pinned by `plus-service/test/stripe-checkout-promos.test.mjs`,
and Settings → Account → Email → **Use promo code** (`settings.ts:2545-2549`) opens the subscribe
Checkout where Stripe's own code field lives. It cannot be found: it is two screens deep, it is the
third button of a three-button row, and it does nothing until an email is typed into a field the row
shares with sign-in and trial. A person holding a code has no reason to look there.

A copy-only intervention on the engine screen is rejected for the same reason a copy-only pass was
rejected in the three-leg plan: shortening the paragraphs recovers height but leaves the credential
form on the decision screen, which is the fault that produces the vocabulary in the first place.

### Key Decisions

- **KD1. The row is a noun with state on the right: `Filing`.** (session-settled: user-directed, after
  an explicit "how would Apple handle this" read.) An iOS Settings row never asks a question; it names
  a thing and puts its condition in the value slot (*Wi-Fi › Home*, *Screen Time › On*). All three
  candidates this plan first carried were questions in a row label: *Who does the filing* (shipped),
  *Who pays for filing*, *Who files your captures*. The debate was about which phrasing of a question
  is clearest, which is downstream of a premise a settings row should reject. `Filing › Not set up` is
  shorter than all three and teaches the word through the value rather than the label.

  The word itself gets defined once, in the **File group footer** on the main screen, which is exactly
  the job the #493 grammar gives group footers. `SETUP_STEP_NAMES.filing_owner`
  (`src/home/atomsHomeData.ts:906`) keeps its verb form ("Choose who files your captures") and no
  longer needs reconciling: a *step* is an instruction, a *row* is a noun. Two shapes, each right for
  its slot. Governs R1, R2.

- **KD2. Atoms Plus is the screen; the user's own key is the alternative underneath it.** (session-settled:
  user-directed.) The first draft gave both a peer row inside *Pick one*. A recommended path and an
  escape hatch are never peers: Plus becomes a group of its own and the key route becomes a second
  group beneath it. `Pick one` is retired.

  The two headers are **`Recommended`** and **`Instead`**. An unheadered primary group would be the
  purer iOS shape, but `SettingGroupSpec.header` is a required `string` (`rows.ts:50`) and widening it
  is rejected in KTD10. `Recommended` turns out to be the better answer anyway: for the reader this
  plan exists to serve, being told which one to pick is the most useful sentence on the screen.

  Paired with the relocation below, this takes **all eight** terms off the decision screen rather than
  seven. What it must not do is bury BYOK: `docs/ask-self-host.md` documents self-hosting as a
  supported route, so the alternative is visually demoted and **not** moved under Advanced. An honest
  option must not be styled like an unsupported one. Governs R3.

- **KD3. The credential form leaves the decision screen.** The API key field, the device-local fallback
  toggle and the secret-id naming rule move behind a new *Use your own Anthropic key* destination. No
  word is deleted from the product: every one still renders, in front of the person who chose to deal
  with it. This is the only structural change in the plan and the sole reason for the full lane.
  Governs R4, R5.

- **KD4. Promo entry points route through Subscribe, never Start trial.**
  `.agents/skills/plus-promo/SKILL.md` records why: the trial webhook grants a 14-day `trialing` row
  regardless of coupon duration, so a code redeemed against a trial is silently discarded. Governs R6, R7.

- **KD5. The locked email cluster is not re-shaped.** `docs/design-handoff/plus-promo-redeem/README.md`
  closes with "Locked. Implement the unified cluster." Discovery is fixed by adding entry points
  around it, not by re-opening it. Governs R7.

- **KD6. One permanent `Redeem code` row, with two destinations decided by whether a live
  subscription exists.** (session-settled: user-directed, twice.) Apple's *Redeem Gift Card or Code* is
  instructive for three things it is not: not conditional on state, not near the feature it pays for,
  and not phrased as a question. The first draft had three rows phrased "Have a promo code?", one of
  them on the engine screen. One noun row, one action id, in the group where the money lives.

  **The first draft then hid that row on a live subscription, which was wrong.** `start_trial` Checkout
  creates a real Stripe subscription carrying `subscription_data[trial_period_days]`
  (`plus-service/src/stripe.mjs:213-228`), so a user three days into a fourteen-day trial is `active`
  with `status: "trialing"` — and that is precisely the person most likely to be holding a founding or
  friend code. Hiding the row left them with no route and no explanation. A hidden affordance is worse
  than a dead end because it is an invisible one.

  So the row is **never hidden**, and routes by state (KTD6): no live subscription goes to subscribe
  Checkout; a live subscription goes to the **billing portal**, where the coupon attaches to the
  subscription that already exists instead of starting a second one. Apple's row is unconditional
  because a code credits an account balance; Atoms has no balance, so the branch is the price of the
  same guarantee. Separately, Apple's redeem sheet offers *Use Camera* because typing codes is
  miserable; KD7 forecloses that, and it is a real cost of the constraint rather than a free win.
  Governs R6, R7.

- **KD7. The plugin never renders a promo-code field.** Inherited, not decided here:
  `docs/plans/2026-08-13-1146-feat-plus-have-a-code-plan.md:47` states it and the locked mock repeats
  it. Every entry point this plan adds ends on Stripe's hosted `Add promotion code`. Governs R6.

- **KD8. A fourth group at the bottom of the main screen: `Atoms Plus`, holding Account and Redeem
  code.** (session-settled: user-directed.) `openRoute("account")` has exactly one call site
  (`settings.ts:2287`), the Plus row on the engine screen, so today a user manages their subscription
  by opening a row named after filing. Billing has no presence on the main screen at all.

  A bare `Redeem code` at the bottom would therefore be an orphan: a lone billing action under **Your
  data**, whose footer names privacy and Advanced and nothing else. Two rows instead, so redemption
  sits beside the account it belongs to and the wayfinding fault closes as a side effect.

  **This deviates from R1 of the three-leg overhaul**, which says the main screen is a status group,
  the three legs, and utility, and that nothing else is a section. That design was doc-reviewed on
  2026-08-14, so the deviation is named here rather than discovered in review, and the design lens
  should be asked to confirm it. Apple would put the account at the *top* (the Apple ID banner); #493
  gave the top to the status group and this plan does not relitigate that. Governs R10.

### Requirements

- **R1.** The File-group row is a noun carrying its state in the value slot, and that value answers it
  in every account state (`engineAnswer`, `settings.ts:2253-2257`). No account state renders a blank value.
- **R2.** The word "filing" is defined where it first appears, in the File group footer, before any
  reader has to tap anything to find out what it means.
- **R3.** The decision screen presents one recommendation and one alternative, each with its price and
  its consequence, and holds no credential control.
- **R4.** A new destination holds the key field, the fallback toggle and the naming rule, with a lead
  that says what the reader is about to need.
- **R5.** No term renders on the decision screen without being defined on that screen. `TLS` is stated
  as the promise it was making rather than as an acronym.
- **R6.** One permanent `Redeem code` row in the Plus group reaches Stripe's `Add promotion code`, and
  names that tap before handing off. It renders in **every** account state.
- **R7.** The row's destination is decided by whether a live Stripe subscription exists: subscribe
  Checkout when it does not, billing portal when it does. No state opens a second subscription, and no
  state renders a button that cannot work (KTD11).
- **R8.** A signed-in user with no live subscription reaches Checkout with no email round-trip.
- **R9.** The spent-meter state says that a code works on the top-up purchase too, which it already
  does.
- **R10.** The main screen carries an `Atoms Plus` group holding Account and Redeem code.
- **R11.** `www/src/setup.html.tmpl` and the regenerated `www/dist` describe the screen that ships.
- **R12.** No string added by this plan contains an em dash, and no exemption is added to
  `test/copyVoice.test.ts`.

### Scope Boundaries

#### Deferred to Follow-Up Work

- Option M, a promo row on the main settings screen. Withdrawn rather than deferred; see the closed
  questions at the end of this plan for the reasoning and the one row that restores it.
- The billing portal's promotion-code configuration, which is Dashboard state, not code.
- `POST /v1/promo` and `ATOMS_PLUS_PROMOS`: a **different, non-Stripe** system that grants
  `plan: "promo"` with no Stripe customer. Deliberately left unwired, see KTD7.

#### Outside this product's identity

Collecting a promo code in the plugin. Any second subscription path. Folder intelligence, capture UI.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. Copy in this plan is em-dash-free by construction, not by sweep.** `test/copyVoice.test.ts`
  is **default-deny over all of `src/**`** (`:14-15`) with per-file, per-region exemptions that each
  have to say what would let them be removed. The mock's approved copy used em dashes in three
  strings ("Atoms Plus — we pay", the egress line, the option rows). All three are rewritten before
  implementation, and the rewrite is an improvement rather than a tax: `Atoms Plus` as a row name with
  "We pay for the AI" in its description reads better than the em-dashed compound it replaces.

- **KTD2. One new route joins `SettingsRoute`.** The union (`settings.ts:421-428`) is switched with
  `const _exhaustive: never` (`:768`), pinned by a `@ts-expect-error` at `test/settingsRows.test.ts:1068`.
  Adding `engineKey` requires four coordinated edits or the build breaks: the union member, a
  `DESTINATION_TITLES` entry (`:778-785`), a dispatch branch (`:1199-1201`), and a row in the
  **order-sensitive** `DESTINATIONS` table (`test/settingsRows.test.ts:989`). Precedent: KTD9 of the
  three-leg plan, which paid this exact cost twice.

- **KTD3. `DIRECT_SETTING_BUDGET` has zero headroom and U2 must not spend any.** The guard
  (`test/settingsRows.test.ts:1091`, currently 5) counts `new Setting(` occurrences in
  `src/settings/settings.ts` with comments stripped. `renderKeyRows` holds one raw construction
  (`:2906-2927`) because a `SecretComponent` is outside the `SettingControl` union. **Moving** that
  call site keeps the count at 5. **Re-creating** it on the new screen instead of moving it makes the
  count 6 and the guard fails. The new destination reuses `renderKeyRows` wholesale.

- **KTD4. The www setup guide is wrong the moment either half of this lands, and must ship in the
  same PR.** `www/src/setup.html.tmpl:161-163` reads: *"On that screen, tap **Who does the filing**.
  That is where you add your own Anthropic API key…"*. KD1 breaks the first sentence and KD2 breaks
  the second, independently. KTD10 of the three-leg plan already made this a rule: any label renamed
  **or moved to another screen** needs its `www` edit in the same PR, because `test/wwwSetupLabels.test.ts`
  pins plugin labels against that template. `pretest` runs `build:www` and regenerates tracked
  `www/dist`, so the rebuilt page is committed alongside the template edit or the
  `git diff --exit-code` gate fails.

- **KTD5. One promo entry point means one stable `action` id: `plus:redeem-code`.** `InFlightActions`
  (`src/settings/rows.ts:198-226`, rationale for money paths at `:187-197`) keys the double-press guard
  by action id, so the first draft's three entry points needed three ids or one in-flight tap would
  have silently disabled the other two, invisibly: the button simply does nothing. KD6 collapses the
  entry points, which retires the hazard rather than managing it. Do not reuse `plus:promo-subscribe`;
  that id belongs to the locked cluster's third submit, which stays.

- **KTD6. The `Redeem code` row is never hidden; its destination is a function of state.**
  `deriveAccountState` (`settings.ts:215-238`) returns six kinds, and "signed in" spans five of them.
  Four have **no** live Stripe subscription and take subscribe Checkout: `signedOut`,
  `trialIncomplete` (its checkout never completed), `subscribeIncomplete`, `periodEnded`. Two **do**
  and take the portal: `active` (both `status: "trialing"` and paying) and `exhausted`.

  Two notes the implementation must not lose. `exhausted` is the spent-meter state that #442 split
  from an ended period, and its existing **Get more** button already opens `topup_50` Checkout, where
  `allow_promotion_codes` is set unconditionally in payment mode too (`stripe.mjs:208-210`) — so a code
  already works there and only the sentence saying so is new (R9). And `subscribeIncomplete` already
  carries promo-aware copy in `accountRowDescriptor` ("On the next page, tap Add promotion code",
  `settings.ts:263`), so confirm the new row reads as a second route rather than a contradiction.

- **KTD7. `/v1/promo` stays unwired.** `plus-service/src/server.mjs:859-877` implements an
  env-configured promo system (`ATOMS_PLUS_PROMOS`, empty in production) that grants `plan: "promo"`
  with **no Stripe customer**. The portal row is deliberately gated on `portalHasSubject`
  (`settings.ts:2467-2468`), so an account minted this way has no route to manage its own billing.
  Wiring a button to it would manufacture exactly that account. The name collision with this plan's
  subject is the whole hazard; recorded so the next reader does not "finish the job".

- **KTD8. Three test surfaces move in lockstep with every row change.** `expectedRows()`
  (`test/settings.test.ts:1943`) and its `toHaveLength` assertions; the engine-answer and group-header
  assertions at `:4096-4170`; and the `DESTINATIONS` walk. Note the specific breakage KD2 causes:
  `["Pick one", "What gets sent"]` is pinned at `:4150`, and the new set is
  `["Recommended", "Instead", "What gets sent"]` — three headers where there were two, so both the
  contents and the length of that assertion move.

- **KTD9. Pricing stays a function.** `ENGINE_SCREEN.pickOne.footer` is a function precisely because
  `plus-pricing.json` is the SSOT and `src/shared/plusPricing.ts` is the only formatter. The option
  rows this plan adds each carry a price and must take it the same way. A number typed into
  `settings.ts` is a copy that goes stale in silence.

- **KTD10. `SettingGroupSpec.header` stays required.** `group()` (`rows.ts:73-81`) takes
  `header: string` and always emits the `h3`; only `footer` is optional. The purer iOS shape for KD2
  is an unheadered primary group, and getting it means widening the shared primitive to
  `header?: string`, adding a branch in `group()`, and re-checking `.atoms-setting-group-header`
  spacing plus the group's top corner treatment (`styles.css:1975`, `:1997`) for a group with nothing
  above it. That is a change to the primitive every group on the tab renders through, bought for a
  cosmetic gain on one screen. Rejected: `Recommended` is a real header carrying real information.

- **KTD11. The portal route has two preconditions, and neither is code in this repo.** First, the
  promotion-code option must be enabled in the Stripe **portal configuration**: `createPortalSession`
  (`stripe.mjs:308-312`) sends no `configuration` param, so the account runs on the Dashboard default,
  and nothing in this repo sets it. It has to be turned on and **seen working** before the route can be
  promised — treat an unverified Dashboard setting as a blocker, not an assumption. Second,
  `portalHasSubject` (`settings.ts:2467-2468`) gates portal access on a real Stripe customer, so an
  account without one has no portal at all; that state must say so rather than render a button that
  fails. `createPortalSessionForAccount` (`stripe.mjs:337-368`) already self-heals a stale or missing
  customer id by falling back to subscribe Checkout, which is the wrong answer for a live
  subscription — check whether that fallback needs suppressing on this path.

### High-Level Technical Design

```
Main screen
└─ 2 · File
   ├─ [KD1] "Filing"          value: engineAnswer()   "Not set up" / "Atoms Plus" / …  → route: engine
   ├─ File automatically when Obsidian opens                                             (unchanged)
   └─ footer  [R2] defines "filing" once, where the word first appears
                                                                             │
      Filing screen ─────────────────────────────────────────────────────────┘
      ├─ lead  defines filing, names Anthropic as a company, states the cost, then "us, or you"
      ├─ "Recommended"  [KD2, KTD10]
      │  └─ "Atoms Plus"   value: 14 days free   desc: we pay for the AI      → route: account
      │     footer: price after trial
      ├─ "Instead"  [KD2]
      │  └─ "Use your own Anthropic key"   desc: Anthropic bills you          → route: engineKey  [KTD2, new]
      │     footer: same atoms, same links; only the bill differs
      └─ "What gets sent"  [R5]  three promises, inline, no acronyms   (Apple's linked-sheet move refused)

      engineKey screen  [KD3, KTD3 - renderKeyRows moved, not recreated]
      ├─ lead: what you are about to need
      ├─ Anthropic API key        (SecretComponent, the one raw `new Setting(`)
      ├─ Device-local key fallback
      └─ footer: the secret-id naming rule

Account screen
└─ Atoms Plus group
   ├─ [locked, untouched] Email cluster: Send sign-in link · Start free trial · Use promo code
   ├─ [KD6, new] "Redeem code"    one row, one action id, never hidden        [KTD6]
   │     ├─ no live subscription  → subscribe Checkout → Stripe "Add promotion code"   [KD7, KD4]
   │     └─ live subscription     → billing portal     → coupon on the existing sub    [KTD11]
   └─ footer: the code is typed on the checkout page, and applies to a subscription not a trial

Main screen, bottom  [KD8, deviates from #493 R1]
└─ "Atoms Plus"
   ├─ Account        value: the signed-in email        → route: account   (today: reachable from
   └─ "Redeem code"                                                        the engine screen only)
```

### Assumptions

1. The owner's "this is good" approves the mock's **direction**; the four decisions it closes with
   were revisited against iOS Settings patterns in the same session, which closed two of them
   outright. OQ1 gates U2; everything else is safe to build under the recorded decisions.
2. `allow_promotion_codes` needs no server change. Verified in source and in
   `plus-service/test/stripe-checkout-promos.test.mjs`; **not** re-verified against live Stripe.
3. No live-vault evidence can be produced in this container: the Obsidian CLI is absent and
   `test_vault/` does not exist here. See Risks.

### Sources

| Source | What it settles |
|---|---|
| `src/settings/settings.ts:565-598`, `:2273-2302`, `:2905-2981` | The screen as shipped |
| `src/settings/rows.ts:17-45`, `:198-226` | Row grammar; in-flight guard |
| `src/home/atomsHomeData.ts:906` | The phrasing KD1 converges on |
| `www/src/setup.html.tmpl:161-163` | KTD4 |
| `test/copyVoice.test.ts:14-15` | KTD1 |
| `test/settingsRows.test.ts:989`, `:1068`, `:1091` | KTD2, KTD3 |
| `plus-service/src/stripe.mjs:208-210`; `server.mjs:859-877` | Promo works; `/v1/promo` is a different system |
| `.agents/skills/plus-promo/SKILL.md` | KD4 |
| `docs/design-handoff/plus-promo-redeem/README.md` | KD5, the lock |
| `docs/plans/2026-08-14-001-...-plan.md` KTD9, KTD10, KTD12 | Precedent this plan reuses |

---

## Implementation Units

| U | Title | Key files | Depends on |
|---|---|---|---|
| U0 | Commit the mock as handoff | `docs/design-handoff/filing-clarity-promo/` | — |
| U1 | Decision screen: `Recommended` and `Instead` | `settings.ts`, `settings.test.ts` | U0 |
| U2 | `engineKey` destination | `settings.ts`, `settingsRows.test.ts`, `settings.test.ts` | U1 |
| U3 | Row becomes a noun, and www lockstep | `settings.ts`, `setup.html.tmpl`, `www/dist/`, `wwwSetupLabels.test.ts` | U2 |
| U4 | `Redeem code`, six states, two destinations | `settings.ts`, `settings.test.ts` | U3 |
| U5 | Main-screen `Atoms Plus` group | `settings.ts`, `settings.test.ts` | U4 |
| U6 | Stale pointer, voice pass, version | `settings.ts`, manifests, `versions.json` | U1-U5 |

### U0. Commit the mock as handoff

Port the approved artifact into `docs/design-handoff/filing-clarity-promo/index.html` plus a
`README.md` in the house shape (status, frames table, draft copy, gate), matching
`plus-promo-redeem/`. Strip the em dashes from the draft copy table so the handoff and the shipped
strings agree (KTD1). **Done:** the mock is in the repo and its copy table is the U1/U2 source.

### U1. Decision screen: `Recommended` and `Instead`

Rewrite `ENGINE_SCREEN` (`settings.ts:565-598`). The lead gains the definition of filing, the
introduction of Anthropic as a company, and the cost, before "us, or you". `Pick one` retires: one
`Recommended` group holding the Plus `destinationRow` (value `14 days free`, footer carrying the price
after trial), then an `Instead` group holding the key route. The Plus row stops borrowing
`accountRowDescriptor`'s signed-out pitch for its name. The `Instead` footer keeps the difference that
survives: "Same atoms, same links, same speed. The only difference is who gets the bill." The naming
rule is removed here and lands in U2. Egress line 1 drops `TLS` for the promise it was making. Prices
via `src/shared/plusPricing.ts` only (KTD9). Update `:4150` to
`["Recommended", "Instead", "What gets sent"]` (KTD8). **Done:** one recommendation, one alternative,
no credential control on the decision screen.

### U2. `engineKey` destination

Four coordinated edits per KTD2. `renderKeyRows` (`:2905-2981`) is **called from** the new branch
rather than re-implemented, so the raw `new Setting(` moves and `DIRECT_SETTING_BUDGET` stays at 5
(KTD3). New lead names what the reader needs; the secret-id naming rule lands as this group's footer.
Seed the `DESTINATIONS` fixture in the same change. **Done:** every one of the eight terms renders on
`engineKey` or not at all; budget unchanged; `@ts-expect-error` still errors.

### U3. Row becomes a noun, and www lockstep

`DESTINATION_TITLES.engine` becomes `Filing` (:779), which retitles both the entry row and the back
row. `engineAnswer`'s signed-out branch returns `Not set up` rather than `Not chosen`; every other
state already returns a noun phrase and is untouched (KD1, R1). The definition of filing joins the
**File group footer** (`FILE_GROUP`, `:531-535`) ahead of the existing sentence, which is unchanged.
`SETUP_STEP_NAMES.filing_owner` keeps its verb form and is **not** edited: a step is an instruction, a
row is a noun.

Edit `www/src/setup.html.tmpl:161-163` for **both** the new name and the moved key field, run
`build:www`, commit `www/dist` (KTD4). **Done:** `wwwSetupLabels.test.ts` green; `git diff --exit-code`
clean after `npm test`.

### U4. `Redeem code`, six states, two destinations

One `destinationRow` in the Plus group, one action id `plus:redeem-code` (KTD5), rendered in **every**
account state (KD6, R6). Behind it a screen whose whole job is naming the tap on the next page: the
email field only when there is no session, and a group footer carrying the two facts the locked
cluster cannot state, that the code is typed on the checkout page and applies to a subscription rather
than a trial (KD4).

Destination branches on whether a live Stripe subscription exists (KTD6): four states to
`subscribe_monthly` Checkout, two to the billing portal. The trialing copy is the one that has to be
right, because that reader has a code and a subscription at the same time: *"You are on a trial. Add
your code now and it applies when the trial becomes a subscription."* Add the top-up sentence to
`exhausted` (R9). The locked email cluster and its `plus:promo-subscribe` submit are untouched (KD5).

**Blocked until** the portal's promotion-code option is verified in the Stripe Dashboard (KTD11).
**Done:** every state reaches a working destination; no state opens a second subscription; no state
renders a button that cannot work.

### U5. Main-screen `Atoms Plus` group

A fourth group at the bottom of the main screen holding an `Account` destination row (valued with the
signed-in email, or unvalued when signed out) and `Redeem code` (KD8, R10). Deviates from #493's R1;
named in KD8 so the design lens can confirm it rather than discover it. Mutates `expectedRows()` and
the main-screen group-header assertions.

### U6. Stale pointer, voice pass, version

Fix `settings.ts:2358` ("add it under **API Key**" names a row that has not existed since #493, and
after U2 and U3 the address is wrong twice over). Run every new or changed string through the
**`atoms-voice`** skill, including OQ2's question of whether "We pay for the AI" is too blunt for the
product's voice. Bump `manifest.json`, `package.json`, `versions.json`. **Done:** voice pass recorded;
`test/copyVoice.test.ts` green with no new exemption (R12).

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Types, tests | `npm test` | All units |
| Community lint | `npm run lint` | All units touching `src/**` |
| Production build | `npm run build` | All units |
| Em-dash guard, no new exemption | `npm test` + inspect `test/copyVoice.test.ts` diff | U1-U6 |
| No test-time mutation | `git diff --exit-code` after `npm test` | U3 especially (`www/dist`) |
| Setting budget unchanged at 5 | `test/settingsRows.test.ts` | U2 |
| Route exhaustiveness | `@ts-expect-error` at `settingsRows.test.ts:1068` still errors | U2 |
| Live vault smoke | `./scripts/install-to-vault.sh` then `./scripts/verify.sh` | U1-U5 |
| Phone evidence | `dev:screenshot` 390×844 | U1, U2, U3, U4, U5 |
| Tablet evidence | `dev:screenshot` 768×1024 | U1, U2 |
| Promo reaches Stripe | Manual, **per state**: four states land on hosted Checkout showing `Add promotion code`; `active` and `exhausted` land on a portal that accepts one | U4 |
| Redeem renders in every state | Fixture per account state, all six | U4 |
| No second subscription | Manual: `active` never reaches a subscribe Checkout | U4 |

**Vault lock.** `install-to-vault.sh` takes the lock itself and exits 3 when another worktree holds
it (#516). Do not work around it.

---

## Definition of Done

Simplify, code-review, compound, and world-class-qa (including the adversarial half) have run; the PR
body carries `Closes #<issue>`, distilled core user stories, edge cases, and an Evidence table whose
Test plan boxes are checked only against evidence that exists; UI screenshots are committed under
`docs/qa/screenshots/filing-clarity-promo/` and linked with absolute
`https://raw.githubusercontent.com/...` URLs; `STATUS.md` cleared after merge.

---

## Risks

- **R-1. No live evidence in this container.** The Obsidian CLI is absent and `test_vault/` does not
  exist here, so every gate below `npm test` needs a machine with the QA vault. Per `CLAUDE.md`, a
  code-read must not be labelled world-class QA. This plan is implementation-ready for unit-level
  work and **blocked at the evidence gate** until the vault is reachable. Decide before implementing
  whether this branch is built here and verified elsewhere, or built where the vault lives.
- **R-2. Fixture churn is the likely source of wasted passes.** Four units mutate the same three test
  surfaces (KTD8). Sequential landing is not a preference.
- **R-3. The promo half is unverifiable without live Stripe.** Source and unit tests prove the flag is
  sent; only a real Checkout proves the field renders. Record it as a gap rather than closing it
  silently, the way #433's `maxCaptures` ceiling was recorded.
- **R-5. KD6 puts a Stripe Dashboard dependency on a plan that had none.** The portal route cannot be
  unit-tested into existence: if the portal configuration lacks promotion codes, `active` users get a
  portal with no code field and the row is a polished dead end. Verify first, build second (KTD11).
- **R-4. KD1 is one string with a wide blast radius.** Rename touches settings, home, the public setup
  guide and `www/dist`. Cheap to reverse in code, not cheap to reverse after a release.

---

## Open Questions

- **OQ1 (blocks U2, and the lane). Split the key screen?** Recommendation: yes. It is what clears the
  decision screen, and it is the only reason this is a full-lane change. If declined, U2 drops, KD2
  survives on its own, and the lane falls back to light.
- **OQ2 (U6). "We pay for the AI".** Plain, possibly too plain; the alternative is Apple's own word,
  *Included*. Settled by the `atoms-voice` skill during U6 unless the owner rules first.

- **OQ3 (blocks U4, ops not code). Is the Stripe portal's promotion-code option on?** Owner or ops to
  confirm in the Dashboard. Until then U4's portal half is written but unproven (KTD11, R-5).

**Closed in session**, recorded so the reasoning is not relitigated:

- ~~Row name, three-way~~. Closed by KD1: a settings row is a noun, so none of the three questions
  ship. The row is `Filing` and the value carries the answer.
- ~~Option M, a promo row *inside the Get started group*~~. Withdrawn: it fights R18, which makes that
  group deliberately one required step. **Superseded by KD8**, which puts redemption at the bottom of
  the main screen instead, next to the Account row it belongs beside.
- ~~Hide `Redeem code` on a live subscription~~. Reversed by KD6: it took the row away from a trialing
  user, who is the likeliest holder of a code.
