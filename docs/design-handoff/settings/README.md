# Settings — investigation and redesign direction

**Status:** draft direction, not implemented. No code changed.

**Mocks**
- **[`overhaul.html`](overhaul.html) — the current proposal.** Brand-new-user pass: grouped into the
  product's own three legs (Capture · File + link · Resurface), mobile-first, inset groups with one
  explanation per group, 52px rows, drill-downs and sheets. Includes the annotated "what a new user
  cannot know" pass over today's screen.
- **[`account.html`](account.html) — the Atoms Plus screen, all nine states.** `AccountState` is a
  sealed union of six kinds and `periodEnded` carries three lapse variants, so nine screens render
  here. Includes the state matrix read from `deriveAccountState` / `renderSignedInAccount`, and a
  state switcher.
- [`redesign.html`](redesign.html) — the first pass. Same information architecture, but kept
  Obsidian's stock row chrome. Superseded by `overhaul.html`; retained because its before/after
  columns are the clearest statement of the IA argument.

**Evidence:** live DOM of the rendered settings tab, plugin **0.7.11**, Obsidian 1.13.6,
`test vault`, signed out. Phone figures measured by cloning that DOM into a 390px container in the
running app.

---

## What I actually looked at

I did not reason from the source alone. I opened the real settings tab in the running app and
dumped every rendered row and paragraph. What follows is that screen, not a reconstruction.

A signed-out install — which is what a new user sees — renders **7 headings and 18 rows**:

```
## Atoms                                  Version 0.7.11 · Capture with your shortcut…
## Atoms Plus                             Set up automatic filing
## Capture                                Capture Atom shortcut · Custom shortcut link
## Filing                                 Atom folder · List atoms on hub notes ·
                                          Refresh hub lists · Tag vocabulary — 8 active
## Ask (Claude + ChatGPT)                 (2 paragraphs) · What Ask stores and shares [Review]
                                          · Vault write acknowledgment [Review]
## Automatic filing (this device)         File automatically… · What Atoms sends [Review]
                                          · Sync when you return · Sync everything now
                                          · Last auto-run day · Last catch-up
## Your API key (optional)                Anthropic API key · Device-local key fallback
   Advanced →
```

## This is not the problem #304 solved

[#304](https://github.com/taihartman/obsidian-atoms/issues/304) took the same complaint — *"all
very confusing and hard to understand right now"* — and fixed it as a **density and grammar**
problem: ~90 rendered rows down to 15, four row kinds, four right edges. That work was correct and
it holds. Every row on the screen today declares whether it is a preference, an action, a
destination, or a record.

The complaint has changed shape. *"It's hard for them to know how to do things"* is not about
telling a toggle from a button. It is about **not knowing which of eight headings owns the thing
you came here to do** — and, underneath that, **not knowing what state you are in**.

You cannot fix that by removing more rows. The screen has few enough rows already.

## The single biggest problem

**The screen never tells you whether Atoms is working.**

A signed-out install with no API key cannot file anything. It is, functionally, inert. And it
renders almost identically to a fully-configured, happily-filing install — same eight headings,
same order, a handful of rows different. There is no status, no sense of progress, no next step.

Everything else is downstream of that. If the screen told you *"Atoms isn't filing yet — one
thing left"* and named the thing, most of the other complaints would stop mattering, because you
would no longer be scanning eight headings trying to infer your own state from the presence of
controls.

This is a **Don't Make Me Think** failure in the strict Krug sense: the answer to "is this set up?"
is not obvious, it is *solvable* — by reading nineteen row descriptions and deducing it.

## Eight findings, all verified on the live screen

**F1 — Two headings are named nearly the same thing and own unrelated things.**
`Filing` holds the atom folder, hub lists, and tag vocabulary. `Automatic filing (this device)`
holds the auto-run toggle, resume sync, the egress consent record, and two diagnostics. Asked
"where do I set up filing," the honest answer is "both, and neither is about the other." This is
the clearest single navigation bug on the screen.

**F2 — The one required decision is presented as two optional ones, five headings apart.**
Atoms cannot file without an engine. The two engines are `Atoms Plus` (heading 2) and
`Your API key (optional)` (heading 7). Nothing anywhere says *pick one*. One of them is explicitly
labelled optional; the other opens with a sales line. A user reading top to bottom has no way to
learn that this is a fork, let alone that it is mandatory.

**F3 — Dead sections render at full weight.**
Signed out, `Ask (Claude + ChatGPT)` spends a heading, two paragraphs, and two full-width accent
`Review` buttons on a feature that is entirely unavailable. Roughly a fifth of the first-run screen
is devoted to something the reader cannot use and has not asked about.

**F4 — Records outshout the controls that grant them.** (Open as [#364](https://github.com/taihartman/obsidian-atoms/issues/364) C2.)
Three `Acknowledged … [Review]` rows carry full-bleed accent buttons. The gestures that actually
grant and revoke those consents are 52×30 toggles. The loudest things on the privacy surface are
the passive audit trail; the quietest are the live grants.

**F5 — Diagnostics sit among settings.**
`Last auto-run day (this device) — 2026-08-11` and `Last catch-up — just now: caught up` are
read-only telemetry occupying prime space inside the automatic-filing group.

**F6 — A setup procedure is hidden in row subtext.**
The Capture Atom shortcut row's description is a six-step iOS procedure:
*"After Add Shortcut: Shortcuts → Capture Atom → edit → Append to Bookmark → Atoms Inbox (not Ask
Each Time) → Done. Open Obsidian with Atoms once first so that bookmark exists."* That is a wizard
compressed into a caption, in the one place a user is least likely to read carefully.

**F7 — Implementation vocabulary leaks into user copy.**
*"Run drain → outbox → mirror → filing now (ignores resume cooldowns)"*, *"not synced via
data.json"*, *"after layout + metadata are ready"*, *"SecretStorage"*. These name internal stages,
internal files, and Obsidian lifecycle events. [#314](https://github.com/taihartman/obsidian-atoms/issues/314)
rewrote the remaining row descriptions in plain language; these are what survived, and they cluster
in exactly the section a first-run user needs most.

**F8 — Device scope is marked three different ways.**
Sometimes in a heading (`Automatic filing (this device)`), sometimes in a row name
(`Last auto-run day (this device)`), sometimes only in prose (*"Device-local only"*). On a product
whose pitch is desktop and phone together, *"does this follow me to my phone?"* is a question the
screen answers inconsistently.

## What is working, and must survive the redesign

- **The row grammar from #304.** Four kinds, four right edges. Keep it exactly.
- **Consent as a sheet at enable time**, with a durable record afterwards. The mechanism is right;
  only the volume of the record is wrong.
- **Destinations over one long scroll.** Vocabulary, Connect, Account, and Advanced are correctly
  pushed off the main screen.
- **The non-negotiable that every money, egress, and vault-write gate stays on the main screen.**
  The redesign moves records, never gates.

---

## Direction — "Is it filing?"

**One sentence:** settings answers *is Atoms working, and if not, what is the one next thing* before
it offers a single knob, and everything below that is grouped by the three questions the pipeline
actually asks.

Three directions were considered:

| Direction | The bet | Why not chosen alone |
|---|---|---|
| **Is it filing?** | The user's real question is always "is this working." Lead with state. | Fixes the header, not the eight-heading middle. |
| **Three questions** | Regroup as *where thoughts come in → who files them → who else can read them*. | Fixes the middle, but a fresh install still reads as a wall of knobs. |
| **Set up once, then quiet** | Setup is a different job from settings; run it as a flow, leave settings for steady state. | Right about the shortcut procedure; wrong as the whole answer, because Obsidian users go to Settings by reflex and a wizard they dismissed is unreachable. |

The mock is **Is it filing?** and **Three questions** synthesized, with the third applied narrowly
to the one genuine procedure on the screen (phone capture).

### The moves

1. **A status card is the first thing on the screen.** Not a heading, not a CTA — a sentence about
   the current install. *"Atoms is filing automatically · 12 atoms this week"* with a green dot, or
   *"Atoms isn't filing yet"* with the single next step attached as the only primary action on the
   screen. When set up, it collapses to one quiet line and stops taking space. This is the One
   Primary Action Per Screen rule applied to a surface that currently has none.

2. **The engine becomes one segmented row.** `Who files your captures — [ Atoms Plus | My own key ]`.
   The fork is now visible, mandatory-looking, and made in one place. Whichever side is chosen
   reveals its own two or three rows underneath it; the other side collapses to nothing. This kills
   F2 outright and removes an entire heading.

3. **`Filing` and `Automatic filing (this device)` merge into one group.** One heading, three
   sub-areas in one place: who files, when it runs, where atoms land. Kills F1.

4. **Ask collapses to a single row when it is unavailable.** Signed out, the whole cluster is one
   destination row: *Ask — Claude & ChatGPT · Needs Atoms Plus ›*. Nothing is deleted; it is
   deferred until it can do something. Kills F3.

5. **All three consent records gather under `Privacy & data`, quiet.** Record rows lose their accent
   buttons and become a muted date with a text `Review` link. The toggles that grant consent stay
   exactly where the feature lives. Records stop competing with grants. Kills F4, and closes #364 C2.

6. **Diagnostics move to Advanced.** `Last auto-run day`, `Last catch-up`, model id, service URL
   override. Kills F5.

7. **Phone capture becomes a sheet.** One row, `Capture on your phone`, with a real status
   (`Not set up` / `Capture Atom v2.2.0`) and a three-step sheet behind it. The six-step procedure
   leaves the caption. Kills F6.

8. **One device chip, used consistently.** A small `this device` chip on the right edge of every
   device-scoped row, and nowhere else. Never in a heading, never in prose. Kills F8.

F7 (vocabulary) is a copy pass over the rows the restructure keeps — it does not need its own
structural move, and the mock writes the replacement copy inline.

### What the fresh-install screen becomes

Seven headings and eighteen rows become **one status card, four headings and ten rows**. On a
fully-configured Plus install it is one collapsed status line and twelve rows, against today's
twenty-one:

```
Atoms isn't filing yet — 2 things left
  → Choose who files your captures     [ Atoms Plus | My own key ]

Where thoughts come in
  Daily notes                          ✓ On
  Capture on your phone                Not set up  ›

Who files them
  Who files your captures              Not chosen
  File automatically                   ○           this device
  Atoms land in                        Atoms/

Who else can read them
  Ask — Claude & ChatGPT               Needs Atoms Plus  ›

Privacy & data                         ›
Advanced                               ›
```

### States the mock covers

- **Fresh install** — nothing chosen; the status card carries the only primary action.
- **Half set up** — engine chosen, Daily Notes off; the card names the one remaining blocker.
- **Running on Plus** — card collapsed to a line; Ask cluster live; filing meter visible.
- **Running on your own key** — same card, engine row shows the key state, Ask stays a single
  deferred row.

### What makes it more than a reshuffle

The status card is the only element on the screen that knows what the *other* rows add up to. Today
every row reports itself and nothing reports the whole. That is why a user can read all nineteen
rows and still not know whether the plugin works. One sentence that reads the install and names the
next step is worth more than any amount of further row reduction — and it is the piece that has
never existed on this screen in any version.

---

---

## The overhaul — mobile-first (supersedes the above visual direction)

The IA findings above stand. What changed is the **canvas**: Atoms is a mobile-first plugin, and the
first pass mocked the desktop settings modal wearing Obsidian's stock row chrome. Re-measured on the
phone, the problem is worse and its cause is different.

### The measurement that reframes it

Cloning the real settings DOM into a 390px container in the running app:

| | |
|---|---|
| Today's screen at 390px | **3,444px — 4.1 phone screens** |
| Tallest single row (`Anthropic API key`) | **211px** — one setting, a quarter of the phone |
| Rows over 144px | **6** — `Anthropic API key`, `Capture Atom shortcut`, `Sync everything now`, `Sync when you return`, `Set up automatic filing`, `Custom shortcut link` |
| Proposed root screen | **1,081px — 1.3 phone screens** |
| Proposed standard row | **52px** |

### The cause

**Every row owns its own explanation, so explanation is what sets row height.** A two-line desktop
description becomes five lines at 390px. Six rows are individually taller than a sixth of the phone.
Row count was never the problem on mobile — row *height* is, and row height is copy.

### The grouping — the product's own three legs

`docs/architecture.md` § North star already names what the plugin does, and the settings screen
should not invent its own vocabulary alongside it:

| Leg | Who does it | Settings it owns |
|---|---|---|
| **1 · Capture** | You. Deliberately external — the plugin owns none of it. | 2 — daily notes, phone shortcut |
| **2 · File + link** | Atoms. | ~9 — engine, when it runs, where atoms land, tags, hub lists |
| **3 · Resurface** | Automatic, on Atoms home. | **0** |

**The tension is real and should not be tidied away.** Leg 2 owns almost the whole screen; leg 3
owns nothing, because `LinkerSettings` has no resurface fields at all. So leg 3's group is
**orientation, not control** — it names the payoff and points at where it happens. For a brand-new
user that is arguably the most valuable block on the screen, since "what do I actually get out of
this?" is currently unanswered anywhere in settings.

**Ask is not a leg**, but from a new user's point of view it answers the same question leg 3 does —
*how do my thoughts come back to me?* — just outside Obsidian. It sits under Resurface as the second
of two ways your past reaches you. This is a judgment call and the easiest thing in the mock to veto.

### The brand-new-user lens

Six things a four-minute-old user does not know, each verified against the constitution, each either
absent from settings or buried in a row description:

1. **"Where's the capture button?"** There isn't one, ever — capture is external by design. The most
   surprising fact about the product, and settings never says it.
2. **"Why does it want an API key?"** Atoms needs a model and you supply it. Mandatory, and currently
   presented as two unrelated sections five headings apart, one labelled *optional*.
3. **"I set it up and nothing happened."** Correct and intended — filing never touches today, and
   automatic filing starts with tomorrow. Nothing warns them, so intended silence reads as broken.
4. **"What is an atom?"** Never defined, though the word appears in six row labels.
5. **"Will it rewrite my journal?"** No — new files and one marker line. The biggest trust question a
   new user has, and the answer is buried in a paragraph about API keys.
6. **"What do I get out of this?"** Resurfacing. The entire payoff, zero settings, therefore invisible.

Measured on the live screen: **30 distinct terms** a new user cannot know, nine of them before the
first control they could confidently touch.

### The five sentences doing the most work

None of these exist on the screen today, and together they cost about forty words:

1. *"Atoms reads thoughts you already wrote and files each one as its own note."* — what it is
2. *"Atoms never captures for you."* — kills the missing-capture-button confusion at the source
3. *"Your notes are never rewritten."* — the biggest trust question, answered where it is asked
4. *"All set — first atoms arrive tomorrow."* — turns intended silence into a promise, not a bug
5. *"Nothing to set up."* — leg 3 having no settings, said out loud as a feature

### The move that makes it fit

**Explanation leaves the row and goes under the group**, written once for the four or five rows it
covers. This is the native iOS Settings grammar, which every phone user can already read, and it is
what turns a 180px row into a 52px one. Everything else in the overhaul follows from it:

1. **Inset rounded groups** — `--background-secondary`, hairline separators, 14px radius.
2. **A row is icon + name + control.** 52px, one line, 44pt touch target. No paragraphs.
3. **A muted footer under each group** carries the explanation, and is the only prose on the screen.
4. **Anything wordy or deep drills down** — the engine fork, tags, connected apps, privacy records.
5. **Procedures become sheets.** The six-step iOS shortcut setup gets three numbered steps with room,
   instead of a caption.
6. **Status hero at the top**, collapsing to one green line once the install is healthy.
7. **Desktop is the same screen, wider.** No rail, no second layout, no desktop-only affordances.

### Directions considered

| Direction | Bet | Verdict |
|---|---|---|
| **Inset groups** | Native grammar; kill row height at its source. | **Recommended.** Theme-safe, identical logic phone and desktop. |
| **Table of contents** | Root holds only the hero and five drill rows; every control one level down. | Shortest root, but buries one-tap things like `File automatically`, and Obsidian users expect toggles in settings. |
| **Three stages** | A `Capture · File · Ask` segmented control swaps the pane below; no long scroll. | **Advised against.** A segmented control pinned to the top of a phone is the worst place for the thumb, and it fights the back-navigation the plugin already has. |

### Token compliance (the "this looks AI" pass)

The first two mocks read as generic AI-designed dark UI. The cause was not taste, it was that they
ignored [`docs/design-handoff/tokens/README.md`](../tokens/README.md) — which had already diagnosed
this exact failure in its v2 revision: *"the v1 system read as generic AI-designed iOS-dark."*

Five rules were being broken, all now fixed and verified in the rendered page:

| Was | Token rule | Verified |
|---|---|---|
| Amber-tinted status card with amber border | Flat cards. No accent-tinted fills, no accent borders. Soft fill is for **transient** status only (waiting, progress, done, error) — setup state is not transient | All groups render one neutral `#1c1c1e`; group border-width `0px` |
| Coloured icon chips on every row (green/amber/purple squares) | Chips are functional wayfinding, must map to a stable classifier output. Person orange and work cyan only, ≤5 categories app-wide | `0` icon chips remain |
| Purple `#7f6df2` as the accent | Tint is `#0a84ff`. Purple is `#bf5af2`, means mind-change, and is **typographic only** — it never fills anything | Primary button computes `rgb(10,132,255)` |
| Decorative pipeline diagram (three tinted bubbles) | Accents are semantic; colour never decorates | Removed. The three legs are uppercase eyebrow headers, which is where a grouped list already carries structure |
| Em dashes throughout app copy | No em dashes anywhere in app copy. Periods and colons | `0` in every proposed screen; the 5 remaining are inside the verbatim "today" transcript |

Also brought to spec: rows are **59px** (token floor is 58px for a plain group), radius 14 on list
groups, eyebrow headers at 0.7rem/600/+0.13em caps, row titles at 0.98rem/500.

**Colour now appears in four places, each stating one thing and none filling a card:** tint on back
chevrons and the single primary button; person orange on setup hints only (`Required`, `Not set up`,
`Not chosen` — orange for setup hints is already in the token map, so no new meaning was invented);
green on a live switch, which is the system control; red on one destructive row.

What carries hierarchy instead: position (the group that needs you is first), type scale, whitespace
between groups, and the right-aligned value — which is how a grouped list has always stated status
without drawing a box around it.

### Coverage audit — nothing dropped

Every row that exists today, walked live in the running app (main screen plus all four
destinations), mapped to where it lands. **34 rows in, 34 rows accounted for, 0 settings removed.**

> **Reconciled against source at U11 (2026-08-14).** Three entries below record where the shipped
> home differs from the one this table first proposed, and why. Nothing was dropped: the main
> screen now holds 13 rows signed in and 11 signed out, and every other row is behind one of the
> six destinations or the capture sheet. `test/settings.test.ts` pins both lists and every
> destination's contents.

**1 · Capture**

| Today | New home |
|---|---|
| Capture Atom shortcut | Root → `Capture on your phone`, with the procedure as a sheet. **Shipped as three steps, not six** — the original six were four instructions and two asides |
| Custom shortcut link | **Advanced → Escape hatches.** Only relevant if you forked the recipe |

**2 · File**

| Today | New home |
|---|---|
| Set up automatic filing / Atoms Plus account row | Root → `Who does the filing ›` |
| Anthropic API key | `Who does the filing ›` → *My own Anthropic key* |
| Atom folder | Root → `Atoms land in` |
| Tag vocabulary (Active / Add custom / Proposed / Found in vault) | Root → `Tags it may use ›`. Destination contents unchanged |
| List atoms on hub notes | Root → `List atoms on people notes` |
| Refresh hub lists | Root, revealed directly under that toggle when it is on |
| File automatically when Obsidian opens | Root → `File automatically` |
| Sync when you return to Obsidian | **Advanced → Sync** |
| Sync everything now | **Advanced → Sync** |
| Last auto-run day (this device) | **Advanced → This device**, as `Last filing run` |
| Last catch-up | **Advanced → This device**. Kept as `Last catch-up`: `LAST_CATCHUP_LABEL` is single-sourced with Atoms home, which prints the same line |
| Device-local key fallback | ~~Advanced → Escape hatches~~ → **shipped on `Who does the filing ›`**, beside the key field. `getApiKey()` falls back to that key, so the pair is a complete credential path that enables Anthropic spend on its own, and the toggle is also the only thing that deletes the stored key. Filing it under Advanced as plumbing would have put a spend gate on the one screen that holds none (U4) |
| Device-local API key (conditional) | Same place, revealed under that toggle |

**3 · Resurface** — two groups, not one. Atoms home and Ask answer the same user question (*how do
my thoughts come back?*) but are independent features with independent state, and one footer could
not honestly serve both.

| Today | New home |
|---|---|
| Ask mirror | Root → `Ask in Claude and ChatGPT` |
| Allow filing from Claude or ChatGPT | Root → `Let Claude file new atoms` |
| Connect Claude or ChatGPT (destination) | Root → `Connected apps ›` |
| MCP connector URL | `Connected apps ›` |
| Link Claude / ChatGPT (pairing code) | `Connected apps ›` |
| Sync now | `Connected apps ›` |
| Cloud mirror status | `Connected apps ›`, and as `Mirrored atoms` on Privacy |

**Ask does not require a paid subscription, and the copy must not say it does.** Per
[`docs/ask-self-host.md`](../../ask-self-host.md), Ask requires a **`plus-service` session**, which
comes from either the hosted service (Stripe trial or paid) or **your own instance** running with a
local dogfood grant. Hosted Plus is the easy path, not the only one.

An earlier draft of this mock said `Needs Plus` on the Ask row. That was wrong. The row now reads
`Off`, and its footer names both routes: *"Atoms Plus hosts that copy for you. You can also run it
yourself, from Advanced."*

The self-host controls live under **Advanced → Run Ask yourself** (`Ask server`, `Self-host guide`),
which is where the DIY guide already points. Its footer carries the two constraints the guide is
emphatic about and that are easy to lose: the URL must be set **before you sign in**, so the plugin
never touches production, and the server needs a **public HTTPS** address, because Claude and ChatGPT
call it from their cloud rather than from the user's machine.

**Your data**

| Today | New home |
|---|---|
| What Atoms sends to Anthropic (record) | Privacy and consents |
| What Ask stores and shares (record) | Privacy and consents |
| Vault write acknowledgment (record) | Privacy and consents |
| Wipe cloud copy | Privacy and consents → `Delete cloud copy` |
| Model | Advanced → `Model` |
| Plus service URL override | Advanced → `Run Ask yourself`, as `Plus service URL` |
| DIY Ask guide | Advanced → `Run Ask yourself`, as `Self-host guide` |
| Advanced: paste session | **Advanced → Escape hatches**, as `Paste a session`. The `Advanced:` prefix was an address; the row now lives at the address |

**Account** — all of these sit behind `Who does the filing ›` → *Atoms Plus*. Mocked in full across
all nine states in [`account.html`](account.html).

| Today | New home |
|---|---|
| Skip the API key / See plans | Folded into the signed-out screen's `What Plus does` group |
| Email / Send sign-in link | Signed-out screen, as the one primary action |
| Advanced: paste session | **Advanced → Escape hatches**, with the other one-case-only controls. Landed in U7; listed again under *Your data* above |
| Status · Signed in as · Plan | One group per state. The state names the group; the rows carry facts |
| Refresh status | A quiet row, not a full-width button |
| Manage subscription | Quiet row, still gated on `lapseKind === "subscription"` |
| Sign out | Its own group, one red row |
| Sign out all devices | Footer link under Sign out, so one red row reads as one |
| Finish trial setup · Finish Plus checkout · Subscribe · Get more filings | Each is its state's single primary button |

**The promo-code path is locked and inherited unchanged.** Decided 2026-08-13 in
[`docs/design-handoff/plus-promo-redeem/`](../plus-promo-redeem/README.md), planned in
[`2026-08-13-1146-feat-plus-have-a-code-plan.md`](../../plans/2026-08-13-1146-feat-plus-have-a-code-plan.md),
shipped in 0.7.10. The locked decisions this redesign restyles but does not touch:

- Stripe owns the code string, so there is **no code field in the plugin**.
- **Use promo code** opens monthly Subscribe checkout, never Start trial.
- The trial button stays. **One email field** serves sign-in, trial and promo code.
- The wording is **"Use promo code"**, matching Stripe. Not "gift", not "Have a code".

An earlier draft of `account.html` drew the signed-out screen with a single `Send sign-in link`
button. That was wrong: the three-action email cluster is a deliberate locked frame, not an accident,
and the redesign renders it as one field with one primary (`Start free trial`, which is `accent: true`
in the shipped code) and two secondary buttons.

**A promo start must never be offered a trial.** An unfinished `subscribeIncomplete` resumes
`Finish Plus checkout`. Offering `Finish trial setup` there would push a gift recipient down the
card-for-trial path instead of applying their code, which is why `setupKind` is carried on the
session at all. Verified in the mock: that state renders exactly one button and it is not the trial.

### Buying without a trial

**The finding.** The buy-now route already exists and is mislabelled. The service takes
`start_trial`, `subscribe_monthly` and `subscribe_yearly`; the plugin's **Use promo code** button
calls `subscribe_monthly`. A promo code is only something you may additionally type on Stripe's page.
Separately, **`subscribe_yearly` is unreachable from the plugin**, though `plus-pricing.json` prices
it at $60 with "save two months".

**Recommendation: do not add a Buy button.** For a new email the trial strictly dominates
subscribing — both take a card, both cost $6 after, and the trial adds 14 free days. There is no
reason for a new user to choose Subscribe, so offering both puts a dominated option on the most
crowded screen in the flow.

The person who genuinely cannot take a trial is someone who **already used it**, and today they tap
**Start free trial** and get a 409 (`"Free trial already used. Subscribe or sign in with a magic
link."`). That is the real defect, and it is not a missing button — it is the screen asking a
question the user cannot answer.

**The principle:** keep a button for what the user knows about themselves; remove the button for what
only the server knows.

| Question | Who knows | Verdict |
|---|---|---|
| I have a promo code | The user | Keep the button. Also locked, correctly |
| I already have an account | The user | Keep the button |
| Have I used my trial? | **Only the server** | Stop asking. Make the trial button handle it |

**So `Start free trial` gets smarter rather than joined by a sibling.** `trialUsed` is a durable
per-account flag and `accountHasUsedTrial` reads only it, never `plan === "trial"`. Eligibility rides
back on the account-start response beside the `needsMagicLink` the plugin already reads — no new
endpoint, and no unauthenticated lookup (which would be an account-enumeration oracle; that
constraint is a feature). A spent trial becomes a reroute with one line, not an error.

**Yearly gets a plan sheet on the Subscribe path, not on the sign-up screen.** It then appears only
once someone has decided to pay, which is exactly when comparing $6 and $60 is welcome rather than
friction. This is also the only change that makes `subscribe_yearly` reachable at all.

**Nothing locked is contradicted.** The 2026-08-13 cluster keeps `Send sign-in link`,
`Start free trial` and `Use promo code`, with those exact words; Stripe still owns the code string and
there is still no code field in the plugin. **This is a behavioural change, not a visual one**, and a
far smaller piece of work than anything else in this folder.

**Rejected:** a `Subscribe` button beside the trial. It reads as offering choice while presenting a
strictly worse deal to everyone eligible for the trial, and puts a fourth button on the screen this
redesign exists to calm down.

**Open judgment call:** is `Start free trial` dishonest as a label when it may reroute to checkout?
The reroute is graceful, and the alternative (`Continue`) throws away the strongest word on the screen
for a new visitor. That is a funnel decision, not a design one.

**The one guard that must survive the visual pass.** A trial that ended without converting has no
Stripe customer, so `Manage subscription` is hidden for `periodEnded · trial` and
`periodEnded · unknown` — offering it sends the user to an error instead of a card form (#442). The
check is positive proof (`lapseKind === "subscription"`), not absence of proof, so an unknown plan is
treated as unproven rather than assumed. The mock's state matrix carries this column explicitly
because it is exactly the kind of thing a redesign quietly drops.

**Two things genuinely change meaning, both deliberate:**

- **`Sync everything now` and `Sync when you return` move to Advanced.** They are manual overrides for
  a pipeline that is meant to run on its own, and their current copy (`drain → outbox → mirror →
  filing`) is the worst offender in the jargon count. Demoting them is a real decision, not a
  filing tidy, and it is the one item here most worth arguing about.
- **`Last auto-run day` and `Last catch-up` stop being settings.** They are diagnostics and now read
  as such under Advanced → This device.

**Not settings, so not in the table:** `hubProjectionListDisclosureSeen` (one-shot Notice flag) and
the ack version fields, which are read by the records rather than rendered as rows.

### Theme safety

Every surface colour maps to an Obsidian variable, never a literal: `--background-secondary`,
`--background-modifier-border`, `--text-normal` / `--text-muted` / `--text-faint`,
`--interactive-accent`. Green and amber are the only added hues and carry state only. A user on a
light or custom theme gets their theme, in this shape.

### What this costs

This is **not `new Setting()` with more CSS.** Groups, footers and 52px rows need a small builder —
`group(containerEl, { header, footer, rows })` — alongside the row grammar that already lives in
[`src/settings/rows.ts`](../../../src/settings/rows.ts). Roughly: a new builder, a restructure of
`renderMainScreen` and its eight section renderers, two new destinations (engine, privacy), one new
sheet, and a copy pass that rewrites every current row description into ~8 group footers. It should
be scoped as a plan before anyone starts, and it wants `ce-doc-review` given it touches consent
surfaces.

---

## Open questions for the owner

1. **Does the status card duplicate Atoms home's first-day wall?** Home already owns *"Turn on
   Daily Notes"* and *"Write one bullet today"* (`firstDaySetupCopy`). Two surfaces would be giving
   setup guidance. My read: they should share one source of truth for "what's unfinished," rendered
   twice — home as a card, settings as a line. That is a real implementation decision, not a mock
   detail.
2. **Does the segmented engine row survive a user who wants both?** Today a user can hold a Plus
   session *and* an API key. The mock presents one active engine with the other collapsed. Worth
   confirming that the collapsed side stays reachable rather than merely hidden.
3. **Scope.** This is a restructure of the main screen only. Destinations (Account, Vocabulary,
   Connect, Advanced) keep their current contents; only what routes into them changes.
