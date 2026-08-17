---
title: "A one-time migration state is a first-run experience, so \"bounded and self-clearing\" is not a reason to weigh it lightly"
date: 2026-08-17
last_updated: 2026-08-17
category: ui-patterns
module: settings
problem_type: design_error
component: plus-base-gate
symptoms:
  - "Every existing Atoms Plus subscriber upgraded into a stop: Process, Preview, Update notes, auto-run, mirror push and outbox ack all refused"
  - "A gate asked a paying hosted user to confirm an address they had never chosen and that was already the implicit default"
  - "The offered way out wrote a literal into a synced setting, permanently overriding a value the user would otherwise have inherited"
  - "A plan reviewed by four lenses shipped the state anyway, because the state was described as an edge case rather than as everyone's first run"
root_cause: wrong_abstraction
resolution_type: design_change
---

# A one-time migration state is a first-run experience

## The problem as reported

The owner, on 0.8.3-beta.1:

> "It said we did, like, confirm the Plus URL in the settings or something. That was pretty stupid.
> I feel like we shouldn't have to do that. If the user has Plus, they wanna use Plus. And if they
> wanna override it, then they could just override it. There's no need to confirm."

That was `Confirm the Plus address`, and behind it `PLUS_BASE_NEEDS_ADDRESS_MESSAGE`: *"Atoms Plus
needs its address before your notes are sent. Open Settings to confirm it."*

## What actually happened

#508 made a Plus session record the base that issued it, so content-bearing calls could refuse a
base that did not. Sessions minted before that carry no stamp. KTD1 decided, correctly, that an
absent stamp means *unknown* rather than *production* — the plugin should not guess where a session
came from.

Then it added a carve-out. An unknown stamp **plus an empty `plusBaseUrl`** would refuse without
probing at all, because an empty field resolves to the hosted default, and probing it would hand a
self-hoster-who-cleared-their-field's token to `plus.tryatoms.app` — the exact user #508 existed to
protect.

The condition is `!stamp && !configuredBase.trim()`. The plan called that population "the upgrade
cohort" and argued it was safe to stop them because the state is *bounded, one-time and
self-clearing*. All three adjectives are true. The plan even wrote down, in defence of the carve-out,
that `plusBaseUrl` ships as `""` so empty is the normal state for every hosted user.

Both facts were on the page and were never multiplied together. **No stamp + empty field is not a
sliver of the install base. It is all of it.** Every hosted subscriber upgrades in exactly that
state, because a pre-#508 session has no stamp and a hosted user's field is empty *because empty is
what hosted means*.

## Why the reasoning failed

Two specific moves, both reusable as warnings.

**"One-time" was read as "small."** A state every existing user passes through exactly once is not
an edge case; it is the first thing the entire install base sees after updating. Frequency per user
and share of users are different numbers, and a migration state maximises the second one. The right
question is never "how often does this fire" but "who is standing in front of it."

**The trade was scored against the wrong baseline.** The carve-out was compared to *no protection*,
where it looks like it converts a leak into nothing. The alternative it should have been compared to
is *probing anyway*, and the plan already contained everything needed to see the difference:

| | Hosted upgrade cohort | Pre-#508 self-hoster with a cleared field |
|---|---|---|
| 0.8.2 (before the gate) | fine | token **and capture bodies**, on every call, forever |
| Carve-out (0.8.3-beta.1) | **all filing stops until they confirm an address** | nothing leaves |
| Probe (0.8.3-beta.2) | fine | one content-free `/v1/me` carrying the token, refused on arrival, **no bodies** |

The probe recovers almost all of the protection because `getEntitlement` sends no note text and
because a host that did not mint the session cannot name the account, so nothing stamps and the
refusal is recorded. The carve-out's marginal gain over probing is *one token, once*. It spent the
entire install base's first run to buy it.

## The fix

Delete the carve-out. An unstamped session with an empty field resolves to the hosted default and
probes it like any other base — **the probe is the proof.** KTD1 row 1 stands; only the refusal in
front of it is gone. Deliberately *not* row 2 ("unknown = production"), which never probes at all and
would grandfather the leak in permanently.

Three smaller things fell out of it, each worth keeping:

- **A recovery control must change something.** The retired row's button wrote
  `DEFAULT_PLUS_BASE_URL` into the field. When the refusal was already *at* the hosted address that
  changed the stored value without changing the address it resolves to — a tap that visibly does
  nothing. The surviving row only renders a button when there is an override to drop, and it
  **clears** rather than writes: empty is how every other part of this plugin spells "use the hosted
  service", and writing the literal pinned it into `data.json`, which Sync then carried to every
  device.
- **A missing stamp is not a refusal.** The Ask connect screen withheld the MCP URL on any stamp
  mismatch, which caught the unstamped cohort too and told them their sign-in could not be confirmed
  "at this address" — about an address they never chose, before anything had been tried. It now
  blocks only on a stamp that *disagrees*.
- **A parameter whose only reader is deleted goes with it.** `configuredBase` existed solely for the
  carve-out. Left in place it is a fail-open waiting for the next author to trust it, so it came out
  of `PlusBaseVerifyInput` and both call sites.

## The rule this produced

The owner's read of it, which is the more useful statement of the principle:

> "Ease is the entire basis of the Plus service. It takes something confusing and makes it easy,
> and that's the product."

That is now constitutional — `CLAUDE.md` non-negotiable **13** and `docs/architecture.md` design
principle **8**, *Plus absorbs complexity; it never hands it back*. It was written down *because* of
this bug: nothing in the constitution forbade a Plus surface from asking the user to supply a value
Plus is responsible for knowing, so the carve-out cleared review on its security merits alone and
nobody had a rule to weigh the other side with.

## How to catch this next time

- When a guard's condition includes "and this setting is at its default", work out what share of
  users are at the default **before** deciding who the condition describes. Here the answer was
  written three paragraphs away from the decision.
- Score a safety measure against the *next-best measure*, not against nothing. "Compared to no
  gate" makes every gate look free.
- A migration state deserves the same scrutiny as onboarding copy, because that is what it is. If a
  release note would have to say "after updating, everyone must do X once", X is a first-run step
  and needs a first-run design review — not a KTD footnote.
- Neuter the guard and watch the test fail. All four tests pinning this reversal were
  mutation-checked; the carve-out's own tests passed throughout, because they asserted the branch
  that was chosen rather than who was standing in it.
