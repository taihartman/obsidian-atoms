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

**Stop when.** The engine screen carries no term it does not define; the API key field, the
device-local fallback and the secret-id naming rule sit behind the option that needs them; three
promo entry points reach Stripe's own `Add promotion code`; `npm test`, `npm run lint` and
`npm run build` pass; `test/copyVoice.test.ts` is green with no new exemption; `www/dist` is
regenerated and committed; phone and tablet evidence captured on a live vault.

**Out of scope.** Any change to how the key is stored, read, or transmitted (U2 relocates rows, not
credentials). Any new Stripe route, coupon logic, or `/v1/promo` wiring. Re-shaping the locked
email cluster. The billing-portal promotion-code toggle. Pricing values.

**Execution profile.** U1 to U4 each mutate the shared `expectedRows()` fixture and therefore land
**sequentially, not in parallel**, the same constraint KTD12 of the three-leg plan recorded. U5 is
severable by owner call. U6 closes copy lockstep and version.

**Lane: full.** Escalated from light, deliberately. `docs/workflow-lanes.md` auto-escalates anything
that "touches security / auth / API keys / secret storage", and U2 moves the Anthropic API key row
to a new screen. It is a relocation with no change to storage or transmission, which is exactly the
reasoning the rule exists to refuse. **Doc-review: full** (coherence, feasibility, product, design).
If the owner drops KD2, the remaining work is copy plus three rows and the lane drops to light.

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

- **KD1. The row is renamed to the words the product already uses elsewhere: `Who files your captures`.**
  Chosen over two alternatives the mock put in front of the owner. **Direction A** (keep *Who does
  the filing*, define filing in the lead) leaves the main screen opaque, which is the reported
  complaint. **Direction B** (*Who pays for filing*) is clear but frames the row as a paywall on the
  main settings screen, which is false for a BYOK user who pays Anthropic and not us. The recommended
  third reading costs no more than B and converges two surfaces instead of adding a third phrasing:
  `SETUP_STEP_NAMES.filing_owner` (`src/home/atomsHomeData.ts:906`) **already reads "Choose who files
  your captures"**, and today the Get started step and the File row name the same decision two
  different ways. *Pending owner confirmation, see OQ1 - this is one string and reverses cheaply.*
  Governs R1, R2.

- **KD2. The credential form leaves the decision screen.** The API key field, the device-local
  fallback toggle and the secret-id naming rule move behind a new *Your own Anthropic account*
  destination. This single relocation takes seven of the eight terms off the decision screen with no
  word deleted from the product: every one still renders, in front of the person who chose to deal
  with it. It is also the only structural change in this plan and the sole reason for the full lane.
  Governs R3, R4.

- **KD3. The plugin never renders a promo-code field.** Inherited, not decided here:
  `docs/plans/2026-08-13-1146-feat-plus-have-a-code-plan.md:47` states it and the locked mock repeats
  it. Every entry point this plan adds ends on Stripe's hosted `Add promotion code`. Governs R6.

- **KD4. Promo entry points route through Subscribe, never Start trial.**
  `.agents/skills/plus-promo/SKILL.md` records why: the trial webhook grants a 14-day `trialing` row
  regardless of coupon duration, so a code redeemed against a trial is silently discarded. Governs R6, R7.

- **KD5. The locked email cluster is not re-shaped.** `docs/design-handoff/plus-promo-redeem/README.md`
  closes with "Locked. Implement the unified cluster." Discovery is fixed by adding entry points
  around it, not by re-opening it. Governs R7.

### Requirements

- **R1.** The File-group row names the decision in words that survive a reader who has never heard
  the word "filing", and its subtitle answers it in every account state (`engineAnswer`, `settings.ts:2253-2257`).
- **R2.** The engine screen defines filing, names Anthropic as a company, and states that filing
  costs money, before it asks who pays.
- **R3.** *Pick one* holds exactly two options, each with its price and its consequence, and no
  credential control.
- **R4.** A new destination holds the key field, the fallback toggle and the naming rule, with a lead
  that says what the reader is about to need.
- **R5.** No term renders on the engine screen without being defined on that screen. `TLS` is stated
  as a promise rather than an acronym.
- **R6.** A person holding a promo code finds an entry point from the engine screen and from the Plus
  group, and each reaches Stripe's `Add promotion code`.
- **R7.** A signed-in user with no live subscription reaches Checkout in one tap, with no email
  round-trip. A user with a live subscription is **not** offered one, because a second subscribe is
  not a redemption.
- **R8.** `www/src/setup.html.tmpl` and the regenerated `www/dist` describe the screen that ships.
- **R9.** No string added by this plan contains an em dash, and no exemption is added to
  `test/copyVoice.test.ts`.

### Scope Boundaries

#### Deferred to Follow-Up Work

- Option M, the main-screen promo row (U5) if the owner declines it: see OQ3.
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

- **KTD5. Every new button needs its own stable `action` id.** `InFlightActions`
  (`src/settings/rows.ts:198-226`, rationale for money paths at `:187-197`) keys the double-press
  guard by action id. Three promo entry points sharing `plus:promo-subscribe` would let one in-flight
  tap silently disable the others, and the failure is invisible: the button simply does nothing.
  New ids: `plus:promo-from-engine`, `plus:promo-from-account`, `plus:promo-signed-in`.

- **KTD6. The signed-in promo button is gated on the absence of a live subscription, not on the
  presence of a session.** `AccountState`'s kinds (`settings.ts:249-303`) already distinguish them;
  the switch at `:2401-2441` is exhaustive with no catch-all and is exhaustive-checked at `:2442`, so
  a new affordance must name the states it appears in. Offering "Have a promo code?" to an `active`
  subscriber sends them into a **second** subscription, which is a billing incident, not a bad label.

- **KTD7. `/v1/promo` stays unwired.** `plus-service/src/server.mjs:859-877` implements an
  env-configured promo system (`ATOMS_PLUS_PROMOS`, empty in production) that grants `plan: "promo"`
  with **no Stripe customer**. The portal row is deliberately gated on `portalHasSubject`
  (`settings.ts:2467-2468`), so an account minted this way has no route to manage its own billing.
  Wiring a button to it would manufacture exactly that account. The name collision with this plan's
  subject is the whole hazard; recorded so the next reader does not "finish the job".

- **KTD8. Three test surfaces move in lockstep with every row change.** `expectedRows()`
  (`test/settings.test.ts:1943`) and its `toHaveLength` assertions; the engine-answer and group-header
  assertions at `:4096-4170`, where `["Pick one", "What gets sent"]` is pinned at `:4150`; and the
  `DESTINATIONS` walk. U1 changes group contents, U2 changes the group set, U3 changes a name that
  three fixtures spell out.

- **KTD9. Pricing stays a function.** `ENGINE_SCREEN.pickOne.footer` is a function precisely because
  `plus-pricing.json` is the SSOT and `src/shared/plusPricing.ts` is the only formatter. The option
  rows this plan adds each carry a price and must take it the same way. A number typed into
  `settings.ts` is a copy that goes stale in silence.

### High-Level Technical Design

```
Main screen
└─ 2 · File
   └─ [KD1] "Who files your captures"  ·  answer: engineAnswer()          → route: engine
                                                                             │
      engine screen ─────────────────────────────────────────────────────────┘
      ├─ lead        [R2] defines filing, names Anthropic, states the cost
      ├─ Pick one    [R3]
      │  ├─ "Atoms Plus"                    price + consequence          → route: account
      │  ├─ "Your own Anthropic account"    price + consequence          → route: engineKey   [KTD2, new]
      │  └─ "Have a promo code?"            [R6]  plus:promo-from-engine → account / Checkout
      └─ What gets sent  [R5]  three promises, no acronyms

      engineKey screen  [KD2, KTD3 - renderKeyRows moved, not recreated]
      ├─ lead: what you are about to need
      ├─ Anthropic API key        (SecretComponent, the one raw `new Setting(`)
      ├─ Device-local key fallback
      └─ footer: the secret-id naming rule

Account screen
└─ Atoms Plus group
   ├─ [locked, untouched] Email cluster: Send sign-in link · Start free trial · Use promo code
   ├─ [R6, new] "Have a promo code?" explanatory row      plus:promo-from-account
   └─ [R7, new] signed-in button, gated by KTD6           plus:promo-signed-in  → subscribe Checkout
                                                                                   └→ Stripe "Add promotion code"  [KD3]
```

### Assumptions

1. The owner's "this is good" approves the mock's **direction**; the four decisions it closes with
   are open until answered (OQ1 to OQ4). U1 and U2 are safe to build under the recommendations;
   U3 and U5 are not, and are sequenced accordingly.
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
| U1 | Engine screen copy and *Pick one* | `settings.ts`, `settings.test.ts` | U0 |
| U2 | `engineKey` destination | `settings.ts`, `settingsRows.test.ts`, `settings.test.ts` | U1 |
| U3 | Row rename and www lockstep | `settings.ts`, `atomsHomeData.ts`, `setup.html.tmpl`, `www/dist/`, `wwwSetupLabels.test.ts` | U2, **OQ1** |
| U4 | Promo entry points | `settings.ts`, `settings.test.ts` | U3 |
| U5 | Option M, main-screen promo row | `settings.ts`, `settings.test.ts` | U4, **OQ3** |
| U6 | Stale pointer, voice pass, version | `settings.ts`, manifests, `versions.json` | U1-U5 |

### U0. Commit the mock as handoff

Port the approved artifact into `docs/design-handoff/filing-clarity-promo/index.html` plus a
`README.md` in the house shape (status, frames table, draft copy, gate), matching
`plus-promo-redeem/`. Strip the em dashes from the draft copy table so the handoff and the shipped
strings agree (KTD1). **Done:** the mock is in the repo and its copy table is the U1/U2 source.

### U1. Engine screen copy and *Pick one*

Rewrite `ENGINE_SCREEN` (`settings.ts:565-598`): the lead gains the definition of filing, the
introduction of Anthropic as a company, and the cost, before "us, or you". *Pick one* becomes two
`destinationRow`s, each with a price and a consequence in its description; the Plus row stops
borrowing `accountRowDescriptor`'s signed-out pitch for its name. Footer collapses to the difference
that survives ("Same atoms, same links, same speed. The only difference is who gets the bill.") with
the naming rule removed, held for U2. Egress line 1 drops `TLS` for a promise. Prices via
`src/shared/plusPricing.ts` only (KTD9). Update the group-header and answer assertions at
`test/settings.test.ts:4096-4170`. **Done:** the engine screen renders two option rows and no
credential control; `["Pick one", "What gets sent"]` still holds.

### U2. `engineKey` destination

Four coordinated edits per KTD2. `renderKeyRows` (`:2905-2981`) is **called from** the new branch
rather than re-implemented, so the raw `new Setting(` moves and `DIRECT_SETTING_BUDGET` stays at 5
(KTD3). New lead names what the reader needs; the secret-id naming rule lands as this group's footer.
Seed the `DESTINATIONS` fixture in the same change. **Done:** every one of the eight terms renders on
`engineKey` or not at all; budget unchanged; `@ts-expect-error` still errors.

### U3. Row rename and www lockstep

**Gated on OQ1.** Rename per KD1 across `DESTINATION_TITLES.engine` (:779), the back row it also
titles, and the three fixtures that spell it. Reconcile with `SETUP_STEP_NAMES.filing_owner`
(`atomsHomeData.ts:906`) so the Get started step and the File row say one thing. Subtitle
`Not chosen` becomes an answer that reads as one. Edit `www/src/setup.html.tmpl:161-163` for **both**
the new name and the moved key field, run `build:www`, commit `www/dist` (KTD4). **Done:**
`wwwSetupLabels.test.ts` green; `git diff --exit-code` clean after `npm test`.

### U4. Promo entry points

Three rows, three action ids (KTD5). Engine-screen row routes to Account when signed out and straight
to subscribe Checkout when signed in. Account row is prose above the locked cluster, naming the
email-first order the three-button row cannot express. Signed-in button added only to the states
KTD6 permits, inside the exhaustive switch at `:2401-2441`. All land on `subscribe_monthly` (KD4).
**Done:** each entry point reaches Stripe's `Add promotion code`; no route from an `active` state.

### U5. Option M, main-screen promo row

**Gated on OQ3, severable.** A quiet row in the Get started group. Carries a real cost: R18 of the
three-leg plan makes that group deliberately one required step, and a second row competes with the
one thing the group exists to say.

### U6. Stale pointer, voice pass, version

Fix `settings.ts:2358` ("add it under **API Key**" names a row that has not existed since #493, and
after U2 the address is wrong twice over). Run every new or changed string through the **`atoms-voice`**
skill, including the OQ4 question of whether "we pay / you pay" is too blunt for the product's voice.
Bump `manifest.json`, `package.json`, `versions.json`. **Done:** voice pass recorded;
`test/copyVoice.test.ts` green with no new exemption (R9).

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
| Promo reaches Stripe | Manual: each entry point lands on hosted Checkout showing `Add promotion code` | U4, U5 |
| No promo route from `active` | Fixture per account state | U4 |

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
- **R-4. KD1 is one string with a wide blast radius.** Rename touches settings, home, the public setup
  guide and `www/dist`. Cheap to reverse in code, not cheap to reverse after a release.

---

## Open Questions

- **OQ1 (blocks U3). Row name.** Recommendation: `Who files your captures`, converging with the
  Get started step that already says it (KD1). Alternatives the mock showed: keep *Who does the
  filing* (A), or *Who pays for filing* (B).
- **OQ2 (blocks U2, and the lane). Split the key screen?** Recommendation: yes. It is what removes
  seven of eight terms, and it is the only reason this is a full-lane change.
- **OQ3 (blocks U5). Option M on the main screen?** Recommendation: no. The engine screen is one tap
  from the File group and does not fight R18. Requested by the owner with "maybe", so it is built as
  a severable unit rather than dropped.
- **OQ4 (U6). "We pay" / "you pay".** Blunt by design. Settled by the `atoms-voice` skill during U6
  unless the owner rules first.
