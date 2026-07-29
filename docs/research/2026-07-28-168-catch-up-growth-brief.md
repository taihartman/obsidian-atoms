# Retention Brief — #168 vault catch-up as the activation event

**Written:** 2026-07-28 · **Lens:** growth / retention / monetization · **Status:** input to the
#168 brainstorm, not a decision

Ground truth for every code claim below: `/tmp/compound-engineering-502/ce-brainstorm/168-plus-catchup/grounding.md`
(verified against master, 2026-07-28). Every price cited is from `plus-pricing.json`.

---

## 1. The reframe

Issue #168 treats catch-up as a **feature to monetize**. It is not. It is the **activation event**,
and it is currently gated behind the worst possible friction.

Sean Ellis's rule: until activation is solid, retention work is rearranging deck chairs. So define
it. **Atoms' activation event is the first time a user sees their own past thought come back as a
titled, linked atom they did not write the title for.** Not install. Not the API key. Not the
subscription.

For a user with an empty vault, that moment is days-to-weeks away — they have to accumulate
captures first. For a user with three years of daily notes, it is **twenty minutes away** — and
today we tell them to go get an Anthropic API key first.

Run B = MAP (Fogg) on that moment:

| | State at install, 3-year vault |
|---|---|
| **Motivation** | Peak. Highest it will ever be. They just installed, they are staring at the backlog. |
| **Prompt** | Present. The plugin can count the backlog already (`getPastDailyNotesWithUnmarkedCaptures`, `src/pipeline/daily.ts:58`). |
| **Ability** | **Zero.** `runBackfillFlow` calls `requireApiKey()` (`src/plugin/main.ts:851`). |

Two of three legs are as good as they will ever get and the third is a wall. That is the entire
bug, and it is an activation bug, not a pricing bug.

**The cost of inaction, named:** a user who installs Atoms with three years of dailies, is told to
go get an API key, and closes the tab, does not get a second brain. They get a plugin they
uninstalled. The harm-avoidance read on aggressive monetization is "we might overcharge them." The
retention read is "they never came back, so they got nothing, and we got nothing." The dropout is
not neutral.

---

## 2. The finding that changes the plan

**The free half of catch-up needs no new backend at all.**

The trial already grants 150 filings (`trialDays: 14`, `includedFilingsPerPeriod: 150`). For a new
user those 150 are close to dormant — they trickle out over two weeks against captures the user
has not written yet. Pointed *backwards* at the existing backlog, the same 150 filings become the
activation event.

That path already exists end to end:

- `requireClassifyAuth()` / `resolveClassifyAuth()` (`src/plugin/main.ts:1449-1456`) — the
  Plus-aware auth resolver, already used by Process / Preview / Update. Backfill simply does not
  call it.
- `POST /v1/classify` (`plus-service/src/server.mjs:571`) — metered, idempotent, with
  `tryConsumeFiling` / `refundFiling` and a 402-on-exhausted contract already shipped.
- `planWrite` / `applyWrite` (`src/pipeline/render.ts:466,543`) — unchanged write path, so body
  stays verbatim and collision policy holds.

No Batches API. No job runner. No new Stripe SKU. No new pricing field. It is a client-side loop
over past captures calling the endpoint that already works, capped by the filings the user already
has.

Contrast that with what the *paid* half genuinely requires, all of it verified absent today:
no Batches API usage anywhere in `plus-service`, no cron, no worker, no job runner, and an
`ask_outbox` capped at `OUTBOX_MAX_OPEN = 50` (`plus-service/src/store/askHelpers.mjs:640`)
against a catch-up of 3,000.

**So #168 is two features wearing one issue number**, and they are separable:

| | Ships | Delivers | Needs |
|---|---|---|---|
| **Activation half** | days | the magic moment, at peak intent, for free | one auth-resolver swap + a cap |
| **Revenue half** | weeks | catch-up for thousands of captures, paid | server-side batch ownership, new SKU, new pricing field, result custody |

Shipping the activation half first is not a compromise. It is how you find out whether the revenue
half is worth building — because the signal you want ("people who got 150 filed came back and
asked for the rest") is unobtainable until the first half exists.

---

## 3. The hook chain

| Link | Today | With activation half |
|---|---|---|
| **Trigger** | External: user installs, sees backlog | Same, plus an internal one — "the rest of my vault is still dark" |
| **Action** | Blocked (API key wall) | One click, no key |
| **Variable reward** | — | **Strong and genuine.** The user cannot predict which of their own forgotten thoughts comes back titled. This is the best kind of variable reward: the variance is in *their own life*, not in a slot machine. |
| **Investment** | — | A partially-filed vault they now own. Endowment effect, unforced. |

The variable-reward link is the one worth dwelling on. Most products have to manufacture variance.
Atoms does not — a user scrolling atoms built from their own three-year-old notes is a curiosity
gap that refills itself. Spotify Wrapped is the closest precedent, and it is the most-shared
feature in consumer software. The mechanic here is the same shape and it fires on day one instead
of once a year.

---

## 4. Pricing the revenue half

### Meter parity is the wrong instrument

`plus-pricing.json` sets a firm anchor: a filing is 4¢ (both $6/150 included and $2/50 marginal).
Applied to a backlog that anchor collapses:

| Backlog | At 4¢/filing | vs. annual ($60) |
|---|---|---|
| 500 | $20 | — |
| 1,000 | $40 | — |
| 2,000 | $80 | **more than a year of the product** |
| 5,000 | $200 | absurd |

Catch-up cannot be sold as filings. It has to be sold as a **product with its own price**, which
is exactly why it needs its own SSOT field rather than reusing `topUpFilings`.

### Proposed ladder

Worst-case COGS uses the issue's own $0.0021/capture (batch Haiku at 50%, no cache credit).

| Band | Price | Worst-case COGS | Margin |
|---|---|---|---|
| ≤ 500 captures | $9 | $1.05 | 8.6× |
| ≤ 2,000 | $19 | $4.20 | 4.5× |
| ≤ 5,000 | $39 | $10.50 | 3.7× |
| > 5,000 | annual only, or capped per purchase | — | — |

Every band clears the ~3× the monthly meter already runs at. Every band sits **below $60**, which
is the point.

### Annual is the actual product

Include catch-up with annual. Then the offer a 2,500-capture user sees is:

> Catch up 2,500 captures — **$39**. Or **$60/yr**, catch-up included, plus twelve months.

$21 more for a year of the product. That decision makes itself. This is a decoy structure
(Ariely's classic *Economist* subscription case): the standalone price exists primarily to make
annual obviously correct, and it earns real revenue from the people who genuinely only want the
one-time job.

**Annual conversion is where the money is, not the catch-up SKU.** An annual customer is $60
upfront, roughly double the realized LTV of a monthly cohort at consumer churn rates, and — more
valuable than the cash — it removes eleven monthly churn decisions. If catch-up moves even a third
of paid conversions from monthly to annual, that dwarfs catch-up revenue itself. Price the
standalone SKU to serve the annual decision, not to maximize its own line.

**Estimated, not measured.** I would expect the activation half to move trial→paid conversion
several points for the backlog-owning segment, and the annual-inclusion framing to move
monthly→annual mix by 20–40% of paid conversions. Those are priors from analogous consumer
onboarding, not readings off your funnel — see §7.

---

## 5. Billing shape: grant an entitlement, don't run a refund flow

The issue lists "failure/refund" and "resumed run must not double-charge" as open questions. They
close themselves if catch-up is modeled the way top-up already is.

`stripe.mjs:310-318` already handles the one-time path: `mode: "payment"` → webhook →
`store.addTopUp(email, config.topUpFilings)`, wrapped in `hasProcessedEvent`, a price allowlist,
`payment_status` checks, and `claimOrDuplicate` **before** the grant. That machinery is shipped and
battle-tested.

So: **charge once, grant a catch-up entitlement measured in captures.** Then

- a resumed run **consumes remaining entitlement** — it cannot double-charge, because charging and
  filing are separate events;
- partial batch failure leaves unconsumed entitlement, and the user simply re-runs;
- markers already make re-entry non-lossy, so entitlement + markers cover each other;
- **no refund flow is needed at all.**

The honesty rule improves too. Today the gate must say "estimate is a range, not a quote"
(`estimateBatchCost`, `creditsCacheReads: false`). A fixed banded price is *more* honest to the
user, not less — we absorb the variance instead of narrating it at them. The range disclosure moves
from being the user's problem to being ours.

---

## 6. The risk that outranks pricing

**A bad catch-up is worse than no catch-up.** Three thousand mediocre atoms landing in a personal
vault at once, at the exact moment of maximum trust, is close to unrecoverable — and it is a
trust event, not a cleanup event. Markers make it non-lossy in the technical sense; that is not the
same as making it undoable in the felt sense.

The mitigation is the same mechanic as the activation half: **file a small batch first, show the
real output, then continue.** Sample-then-proceed is simultaneously a trust gate, an activation
event, and a conversion mechanic. That the free taste and the safety gate turn out to be the same
thing is the strongest argument for the phasing in §2.

Two honesty constraints on it:

1. **Show the whole number before starting, not after.** "We found 2,997 unfiled captures. We'll
   file your most recent 150 now." Springing the remainder afterwards is a bait-and-switch and it
   reads as one.
2. **Recent, not oldest.** Recent captures are the most recognizable, so they carry the most
   magic per filing. Oldest-first would spend the free allowance on the material the user is least
   able to evaluate.

---

## 7. You cannot currently measure any of this

The Cloudflare Web Analytics beacon on tryatoms.app is blocked by our own CSP — it errors on every
load and collects nothing. That is filed as housekeeping in the handoff. It is not housekeeping:
this brief proposes a pricing and packaging bet, and there is currently **no instrumentation to
tell whether it worked.** Resolve the beacon decision before, not after, shipping the pricing
change — or accept explicitly that the ladder ships on judgment alone and will not be tunable.

---

## 8. Net call

1. **Split #168.** Activation half (free, uses the existing metered classify path, no new backend)
   ships first and alone. Revenue half follows on evidence.
2. **Point the trial's existing 150 filings at the backlog.** No new free tier, no new entitlement
   concept, no new COGS beyond what a trial already budgets — a dormant allowance made useful.
3. **Price the revenue half as a product, not as filings** — banded $9 / $19 / $39, all under $60.
4. **Include it with annual**, and let the standalone price do its work as the anchor.
5. **Grant an entitlement rather than building a refund flow** — reuses the shipped `addTopUp`
   shape and closes two of the issue's open questions.
6. **Sample-then-proceed is mandatory**, on trust grounds before conversion grounds.

### Where I'd push back on myself

- The free 150 could satisfy the user *enough* that they never buy the rest — the tease converts
  worse than no tease. Real risk. The counter is that 150 recent captures out of 3,000 leaves the
  backlog visibly dark, and the counter to *that* is that some users genuinely only care about
  recent notes. Only shipping it tells you which.
- The ladder assumes willingness-to-pay scales with backlog size. It may instead scale with how
  much the user already trusts the output — in which case the sample gate matters more than the
  bands, and the bands could flatten to a single price.
- "Annual includes catch-up" gives away the highest-margin item to the customers who need the
  least convincing. That is the standard cost of a decoy structure and I think it is worth paying,
  but it is a real cost and not a free lunch.
