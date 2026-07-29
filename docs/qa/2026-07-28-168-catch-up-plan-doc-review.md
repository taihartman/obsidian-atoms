# Doc review — #168 vault catch-up requirements plan

**Date:** 2026-07-28 · **Document:** `docs/plans/2026-07-28-003-feat-plus-vault-catch-up-plan.md`
**Reviewers:** coherence · feasibility · product-lens · security-lens · scope-guardian · adversarial · design-lens
**Not run:** the cross-model peer pass (no external route configured). All seven reviewers are the
same model family, so "seven agreed" is weaker evidence than it sounds.

**Verdict: the plan is not ready to build from.** Two claims it makes confidently are wrong, and
the pricing it locks in rests on a cost figure that is probably several times too low.

---

## Already applied (mechanical, no meaning changed)

- KD3 cross-referenced KD8 for cost numbers; KD8 has none. Now points at KD4.
- Goal Capsule said three open questions against four listed, and called them all non-shaping.
  Corrected, and question 1 (delivery) is now marked as shaping the work.

---

## P0 — must resolve before planning

### 1. The cost figure is wrong, and everything is priced off it
*feasibility · adversarial · product-lens · security-lens — four reviewers*

Three independent errors, all biased the same way:

- **The prompt grows as the run proceeds.** Every classify request embeds the whole vault title
  list, and catch-up is the operation that drives that list from ~0 to 3,000. Back-solving the
  stated 0.63¢ implies ~2,950 input tokens per request; a 3,000-title context is 26K–38K. That puts
  worst case at **4–6¢ per capture**, not 0.63¢.
- **Reasoning output is not counted.** `ASSUMED_OUTPUT_TOKENS = 250` was calibrated for Haiku.
  `plus-service` deliberately omits `output_config.effort`, so Sonnet keeps its default of high, and
  reasoning bills as output.
- **The best case is unreachable.** The 0.2¢ figure assumes the 1-hour prompt cache holds for the
  whole run. The Batches API only guarantees completion within 24 hours, so a long batch outlives
  its own cache.

**Consequence:** KD4's "$18 of headroom at 3,000" does not survive. At 2× cost the $10-per-1,000
block sells near or below cost after Stripe fees; at the yearly free allowance the plan may go
negative. The prices are also public commitments once sold, and KD5 removes the refund path.

**Fix:** measure before pricing. One real batch of ≥200 captures, at Plus model quality, against a
~3,000-title vault context, spanning longer than the cache TTL. Record the measured number in the
plan and re-derive the ladder from it. Add a stated minimum margin below which the block price is
revised. Pin an explicit effort level rather than inheriting the default.

### 2. A catch-up purchase would grant the wrong thing
*security-lens, confidence 100, code-verified*

The shipped webhook ends with a catch-all: any session where `obj.mode === "payment"` falls into
the top-up branch and calls `store.addTopUp(email, config.topUpFilings)`. A new one-time catch-up
price is payment-mode, so **every catch-up purchase would silently grant 50 monthly filings
instead of catch-up notes** — and because the handler claims the event before granting, the
correct grant can never be retried. This also breaks R5's promise not to touch the filing meter.

Related, same severity: the shipped grant is safe partly because the amount is a **server-side
constant**. Catch-up's amount varies per purchase. If it is read from checkout metadata, a user can
mint unlimited notes for one block's price. The grant must be derived server-side from the paid
line item, never from anything the client supplied.

### 3. "Debited only for notes actually filed" cannot be implemented as written
*adversarial · security-lens · feasibility — three reviewers*

KD8 and R4 require debiting on a successful vault write. But KD10 puts the batch on the server, and
the server only ever learns that it *delivered* results — `applyWrite` succeeding is knowledge that
lives in the plugin. The meter this claims to mirror debits *before* the model call and has no
vault-to-service confirmation channel at all. So either the service debits on delivery (violating
R4) or a per-note acknowledgement protocol has to be specified. "Without new machinery" is false.

There is also no bound on classified-but-never-filed work: the service can pay for a full batch and
collect nothing if the user never reopens the vault.

### 4. The free allowance has no stated lifetime
*security-lens · adversarial · coherence — three reviewers*

Nothing says whether the allowance is once per account or renews. If it renews, a monthly
subscriber gets 1,200 free notes a year rather than 100, and KD4's whole margin argument is wrong.
Worse, a yearly subscriber who cancels and re-subscribes could farm 3,000 free notes each time
(~$19–$60 of cost) with nothing bounding it, since R5 keeps catch-up off the monthly meter.

**Fix:** once per account, for the life of the subscription. Renewal, re-subscription, and plan
changes never restore consumed allowance; monthly→yearly credits only the difference.

---

## P1 — resolve before or during planning

### 5. Three reviewers say R7 is what forces the entire backend
*scope-guardian (P0) · product-lens · adversarial*

"Survives Obsidian being closed" is the only requirement that demands server-owned jobs, and KD10
calls that the largest piece of work. Nothing in the plan justifies it. The shipped BYOK path
already requires Obsidian to stay open and R12 preserves that as acceptable. Drop or defer R7 and
the credential fix — the thing that actually removes the onboarding cliff — ships far sooner.

**Reviewers disagree here, and it matters.** Feasibility argues R7 is *cheaper* than KD10 claims:
the Batches API accepts up to 100,000 requests per batch, completes within 24 hours, and **retains
results for 29 days** — so Anthropic is itself the durable store, and the service needs submission,
polling and custody rather than a job runner. It also notes `plus-service` already owns the classify
prompt server-side. Against that, adversarial notes the Fly host is a single 512MB machine with
`auto_stop_machines = "stop"` and no scheduler. Both are right about different halves; this needs a
deliberate call, not a default.

### 6. The sample is undefined, and as specified it is unrepresentative
*coherence · design-lens (P0) · product-lens · adversarial — four reviewers*

KD6 says "a small batch"; the monthly flow says the sample is the entire free 100; the yearly flow
implies a sample then 2,400 more. Three incompatible readings. Worse, KD9 files most-recent-first
*because* recent notes are the ones the user recognises — which is exactly what makes them the
easiest to classify well and the worst predictor of a 2019 note. **The user approves 2,900 notes on
the strength of the 100 least like them.**

**Fix:** fix the sample at a stated number (10 was proposed) independent of plan; draw it from both
the newest and oldest ends; add a second checkpoint partway through the paid portion where the run
can be stopped with unspent entitlement intact.

### 7. Two ordinary sequences still charge twice
*adversarial · security-lens*

R6's guarantee holds only inside one resumed run. It does not cover: (a) a user whose vault grew
since a partial run, re-quoted against the current unfiled count without netting out unspent
entitlement; (b) desktop and phone both open, each showing the same overflow, each opening a
checkout. And the inverse failure exists too — the inherited handler prefers *under*-granting on a
crash, which is fine at $2 and bad at $30 with no refund flow.

### 8. Nothing caps the size of a run, a purchase, or a single capture
*product-lens · adversarial · security-lens*

Issue #168 explicitly asked for a cap; the plan answers only the free allowance. Overflow is
unbounded, so a 40,000-capture vault quotes $400, non-refundable, as one batch. Separately there is
no per-capture size limit: the service's 2MB body cap alone permits a single "note" worth roughly
$1.50 of input, while consuming one unit of a note-denominated allowance.

### 9. The allowance is written in "notes"; the system bills per capture
*feasibility, confidence 100*

One daily note holds several captures. `enumerateBackfillWork` makes one request per capture and
`getPastDailyNotesWithUnmarkedCaptures` returns a capture sum. The plan uses both words for the same
number, so an implementer can build the counter against either unit and be wrong by the vault's
captures-per-note ratio. **Denominate everything in captures.**

### 10. Catch-up atoms cannot link to each other
*feasibility*

One batch carries one title context stamped into every request, and classify only permits links to
titles already in that list. So a single batch over an empty vault produces thousands of atoms that
are structurally unable to reference one another — the opposite of the deep, linked vault the
feature exists to create. Needs sequential batches with the context refreshed between them.

### 11. Server-side capture storage contradicts the privacy page
*security-lens · feasibility*

Moving the job server-side means thousands of daily-note bodies sit at rest in `plus-service`. The
published privacy page says daily notes are not mirrored. There is a shipped pattern to follow
(`mirror/crypto.mjs`, `ATOMS_ASK_MIRROR_KEY`), but the plan commits to no retention window,
deletion trigger, or encryption posture. Note this page was just edited today for the analytics
change — it would need editing again in the same PR.

### 12. Other P1s, stated briefly

- **No entry point.** Every flow starts with "the user opens catch-up." Nothing says where they find
  it. A command-palette-only entry satisfies the plan while missing the install moment it is for.
- **No run states.** R7 promises a run that outlives the app, but nothing names queued / filing /
  paused / failed / complete, and today's progress state is in-memory and resets on reload.
- **The morning after.** 3,000 atoms landing at once hits a home view built for ordinary runs, and
  the resurface stream leans on date cues a whole-vault backfill flattens. Risks producing exactly
  the guilt pile the product's identity rejects.
- **Trial contradiction.** KD2's table gives trial no overflow path; the acceptance table quotes a
  trial user $10. The underlying decision — can someone who has paid nothing transact? — is unmade.
- **No yearly comparison at the quote.** R2 lists four things to show and the yearly upgrade is not
  among them, though the flows section says the pull "must be legible, not hidden."
- **Premise unvalidated.** The onboarding-cliff claim is asserted in the plan and in #168 with no
  ticket, install count, or instrumentation behind it, and no success signal is defined. The
  do-nothing baseline is strong: BYOK backfill already works and is free.
- **Session revoke cannot stop spend.** Once the job is server-side, revoking a leaked session no
  longer halts spending under our key — there is no further authenticated request to reject.
- **Ask outbox would widen consent.** Routing results through it puts daily-note-derived content in
  a surface the privacy page says is opt-in and atoms-only.
- **R13 missing.** The landing-page copy and `test/wwwPricing.test.ts` change is committed to in
  prose but is not a requirement, so a PR could satisfy the contract and still leave the test red.

---

## Worth knowing (no action needed now)

- Every `file:line` citation in the plan was independently verified correct by two reviewers, as
  were the "no `BackfillGateModal`" correction and the meter arithmetic (4¢ a filing).
- KD10 is accurate about what is absent: no Batches usage, no cron, no worker, no scheduler
  dependency, single long-lived `node src/server.mjs`.
- Trial abuse is already partly throttled: `start_trial` is a subscription-mode checkout that
  collects a payment method.
- The monthly $10-per-1,000 SKU may be commercially near-dead — at the plan's own example, anyone
  who does the arithmetic upgrades to yearly instead. Its main population is users who didn't compare.
- The Batches API is unavailable on Bedrock, Vertex, and Foundry. If `plus-service` ever moves off
  the first-party API, KD10's approach has no equivalent.
