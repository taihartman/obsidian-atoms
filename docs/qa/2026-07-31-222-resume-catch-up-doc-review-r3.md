# Doc review r3 — Catch up on resume (#222)

**Document.** `docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md` (1879 lines)
**Classification.** `unified-plan` (`ce-unified-plan/v1`, `implementation-ready`)
**Origin.** `product_contract_source:ce-plan-bootstrap` — greenfield; premise was not validated upstream, so premise-level scrutiny is in scope.
**Settled decisions.** none (no `session-settled:` annotations on any KTD)
**Mode.** headless · round 3 (no decision primer carried; prior rounds' decisions are not machine-suppressed here)

**Result.** 30 findings. 3 applied silently. **2 P0**, 15 P1, 7 P2, 3 FYI remain for your decision.

---

## Coverage

| Lens | Dispatched | Findings |
|---|---|---|
| coherence | yes (re-run, see note) | 3 |
| feasibility | yes | 9 |
| product-lens | yes — greenfield Product Contract with challengeable framing/prioritization | 5 |
| design-lens | yes — modal, kill switch, home banner, command, passive surface | 4 |
| security-lens | yes — automatic API egress on resume, cloud deletion gate, quarantine storage | 5 |
| scope-guardian | yes — 14 live units / 4 phases / 2 cut / 5 open questions | 2 |
| adversarial | yes — greenfield premise + deletion domain + explicit Alternatives section | 6 |

**Coherence was run twice.** The first pass (cheapest tier, per the skill's model tiering) returned zero findings on an 1879-line document that had already absorbed two rounds of fixes. That null was treated as under-effort rather than as evidence, and a confirmation pass was dispatched with the six traceability chains named explicitly. It found 3. **The zero-finding return is discarded and is not counted as a corroborating reviewer.**

**Cross-model pass: not run — host decision, not a failure.** The judgment trio (adversarial, product-lens, security-lens) activated, which normally also routes each lens plus a whole-document sweep through an external provider. `codex` is installed and would have resolved as the target, meaning the full 133 KB plan would egress to OpenAI. Headless mode provides no sanctioned way to disclose that third-party egress before it happens, so the pass was skipped in favour of the disclosure rule. **What this costs:** the trio lenses are still covered by their in-process reviewers, but the *whole-doc broad read from a different model family* has no in-process twin and is simply absent from this round. Re-run with the cross-model pass enabled if you want that coverage.

**Independence.** All seven lenses ran in separately dispatched contexts, so agreement between them is genuine corroboration and the five converged findings below are promoted on that basis.

---

## Applied silently (3 — `safe_auto`)

| # | Section | Change |
|---|---|---|
| A1 | KTD4, cooldowns table | `it and its three siblings` → `four siblings`. The block lists five constants; the table's own last row already said "all four thresholds". |
| A2 | Q7 touch-point note (after U14's strings) | Was `both strings are touch points`. Now names all **four** literal occurrences of "Sync everything now": R5's refusal status line, R5's escalation notice, and U14's two strings. A rename following the old note would have left two stale strings in the plan's most important data-safety copy. |
| A3 | Dependencies lines of U7, U10, U13, U15 | Each now marks U5 (and U4, on U7) as *gating only*, pointing at U0's disposition table. Under a negative spike U0 drops U5 but keeps these four units; an implementer sequencing off the Dependencies lines would have read them as blocked on a dropped unit. |

---

## P0 — 2

### P0-1. Resume chain gated on Ask-enabled kills R1 on default installs
*feasibility · anchor 100 · `gated_auto` · KTD7 / U5 / trigger-to-chain diagram*

**On a default install the feature does nothing at all.** `askEnabled` defaults to `false` (`src/shared/types.ts:195`), and KTD7's gate order — `coalescing → kill switch → Ask enabled and privacy acknowledged → probe → vaultIndexReady → decision` — drops the *entire* pass when Ask is off. Drain, filing, and outbox all die with it, so R1 is unmet for every user who never enabled the cloud mirror. Neither the drain nor the filing stage depends on Ask today: `maybeAutoRun` gates only on `enabled` + `egressAcked` (`src/plugin/main.ts:698-716`), and `syncAskMirror` already refuses on its own (`:1217-1219`). Only the connectivity probe and the mirror push need the Ask precondition.

**Fix.** Move the Ask condition off the chain-wide gate and onto the probe and mirror-push stage only. New order: `coalescing → kill switch → vaultIndexReady → decision → chain`, with the probe and stage 4 each carrying the cloud-feature precondition. Update KTD7's ordering, U5 step 2, the `AE` node in the mermaid diagram, and U5's test scenario so it asserts zero *probe/mirror* requests on an Ask-disabled device rather than zero passes.

### P0-2. Completeness floor is vacuous on a device with no prior high-water mark
*security-lens · anchor 75 · `gated_auto` · U1 Approach step 2 + Named constants*

The headline data-safety guard **can pass while doing nothing on exactly the case it was built for.** The floor is `max(5, highWaterMark × 0.8)`, but U1 never says what the high-water mark holds on first evaluation — and the natural implementation (seed from the current scan) makes the ratio self-referential. A 300-of-400 device seeds `highWater=300`, computes a floor of 240, passes, and deletes 100 atoms that had merely not downloaded yet.

**The declared test scenarios do not catch this.** The 3-of-400 case passes through the `max(5, …)` arm (scan 3 < 5) regardless of which denominator the implementer chose, so the suite goes green with the guard defeated for any vault above ~6 atoms. Step 2's first correction says the denominator is "this device's own evidence size"; the constant and step 2's third correction say the high-water mark. The two readings are never reconciled.

**Fix.** State the seeding rule in U1 step 2: the floor is evaluated against `max(5, max(highWaterMark, hashEvidenceSize) × 0.8)`, and on a device with no recorded `atoms-mirror-scan-highwater-v1` the hash-evidence size is the baseline — **the high-water mark is never initialized from the scan being judged.** Add the missing scenario: 400 in evidence, 300 in scan, no prior high-water mark → deletes refused.

---

## P1 — 15

### Converged findings (multiple independent reviewers)

### P1-1. Constants block has two contradictory homes ⟡ *feasibility + adversarial*
*anchor 100 · `gated_auto` · U1 Named constants / U3 / U13 / KTD4*

U1 claims all five constants live in one exported block in `askMirror.ts`, while U13's file list puts `BACKLOG_GATE_THRESHOLD` in `src/platform/resume.ts` and U3 says the KTD4 block is exported from there. `CONNECTIVITY_PROBE_MIN_INTERVAL` is claimed by both. **U1 ships in the accelerated Phase A PR**, so following it literally exports a backlog threshold and a quarantine expiry from the Ask-mirror module long before either consumer exists — and under a negative U0 spike `resume.ts` is dropped while U13 is kept, leaving its threshold homeless.

**Fix.** Split ownership by consumer; make U1's table cross-reference rather than claim. Keep only `MIRROR_COMPLETENESS_FLOOR` and `MIRROR_HIGHWATER_DECAY_DAYS` in `askMirror.ts`. Put the KTD4 timing/spend knobs incl. `CONNECTIVITY_PROBE_MIN_INTERVAL` and `BACKLOG_GATE_THRESHOLD` in `src/platform/resume.ts`; put `QUARANTINE_EXPIRY_DAYS` in `src/platform/autorun.ts` per U10's file list. Reword U1's "All of these live in one exported block" to name each constant's owning module, and drop KTD4's "it and its four siblings live in U1's named constants block".

### P1-2. U14's file list omits both the disclosure surface and the paid-stage gate ⟡ *feasibility + design-lens*
*anchor 100 · `gated_auto` · U14*

U14 **cannot be implemented from its own file list.** It specifies a persistent per-device upgrade notice with a `[Got it]` button, `atoms-egress-notice-v1` persistence, and a block on the resume path's paid stage — but Files names only `src/settings/settings.ts` plus an unnamed `test/`, and Dependencies is "None". Neither the notice surface nor the gate has an owner, and the scenario "no classify request until acknowledged" cannot be written against a file the unit does not list.

Because the location is unspecified, the likely implementation puts the notice **in Settings only** — and the plan argues elsewhere, about a sibling surface, that "Settings → Atoms is not a surface a phone user opens routinely, so a Settings-only refusal is indistinguishable from silence." A phone user who never opens Settings would leave paid filing silently blocked forever. That is precisely the invisible-failure mode KTD16 rejects a re-ack gate for.

**Fix.** Extend U14's Files to `src/settings/settings.ts` (ack copy at `:756`), `src/home/atomsHomeView.ts` (the persistent notice, in the status region U1 and U15 share, reusing U13's banner mechanism), `src/plugin/catchUp.ts` (the paid-stage block keyed on `atoms-egress-notice-v1`), and `test/catchUp.test.ts`. Change Dependencies to "U9 (creates `src/plugin/catchUp.ts`); must land with or before U5". Add the notice to System-Wide Impact's "Surfaces added" with its precedence against U1's refusal, U13's banner, and U15's passive line.

### P1-3. Q10's orphan connectivity probe ships inside the accelerated Phase A PR ⟡ *scope-guardian + product-lens + adversarial*
*anchor 100 · `manual` · Q10 / KTD7 / U1 Named constants*

The plan calls the connectivity-restore push an orphan in its own words — "No requirement mentions it" — leans toward cutting it (option b), and then leaves it standing in an artifact marked implementation-ready. **The consequence is concrete:** `CONNECTIVITY_PROBE_MIN_INTERVAL` sits in U1's constants table, and U1 is the accelerated PR that ships first. So unrequested scope, including a recurring outbound beacon on every network transition, gets baked into the fast-tracked data-safety PR before the question of whether it should exist is answered. The plan set its own precedent by cutting U11 for implementing zero requirements.

**Fix.** Resolve Q10 **before U1 merges**, not after. If taking the plan's own lean (b): remove `CONNECTIVITY_PROBE_MIN_INTERVAL` from U1's table now, strip KTD7's probe-build steps from U5's approach, and move the item to Deferred to Follow-Up Work with the pointer to `ask-mirror-parity.md` KTD4 — rather than building the probe and deleting it later.

> Note the interaction: adversarial observes that KTD7's justification is self-cancelling — "free because the same listener set already carries the signal" versus "needs a new probe" and "its own file". And feasibility notes the probe's target has no matching route in `src/platform/plusClient.ts` (every exported endpoint requires a `sessionToken`), though a bare GET likely needs no service change since `probeHttpsBaseline` treats 4xx as reachability.

### P1-4. Goal Capsule's full-lane rationale predates the Phase A split ⟡ *scope-guardian + adversarial*
*anchor 100 · `gated_auto` · Goal Capsule*

The Goal Capsule still says the full-lane classification comes from the three data-loss paths — but those ship in a separate accelerated PR (Q3, closed), and the plan's own round-2 correction under Q3 **explicitly retracts that framing**. Anyone scoping review or implementation effort off the summary alone underestimates what the actual feature PR contains.

**Fix.** Rewrite "Shape of the work" to the current justification: full-lane holds independently of the three hazards, which now ship ahead of this feature; the remainder is full-lane on its own scope — `main.ts` changes, two new modules, settings, home UI, a quarantine subsystem, docs and a version bump.

### P1-5. U15's "spend today" cannot be sourced from a 60-minute window ⟡ *feasibility + design-lens*
*anchor 100 · `gated_auto` · U15 Approach step 2 / KTD3 / R16 / Q5*

`atoms-filing-budget-v1` holds "Rolling 60-minute filing timestamps" per KTD3 — it can report the last hour and has no record of the rest of the day. Either the displayed number is wrong, or U15 adds a daily counter, which contradicts its own claim that it "adds no new instrumentation". Separately, every rendered example and test scenario stops at `Last caught up 4m ago · 3 filed`, so the spend figure is the one piece of required user-facing content in this plan left for the implementer to invent — every other string is given verbatim.

**Fix.** Change U15 step 2 to report what the paid stage filed **in the last rolling hour**, labelled as such, sourced directly from `atoms-filing-budget-v1`; drop "spent today" from U15, R16, and Q5's closed answer. Extend the literal example string to include the figure and add a test scenario asserting it renders.

### Single-reviewer P1

### P1-6. Accelerated Phase A PR has no version bump; U8's target is already stale
*feasibility · anchor 100 · `gated_auto` · U8 / Phase A note / Risks*

Phase A ships user-visible changes — a refusal line on Atoms home, a confirmation modal on Settings' Sync now, changed button reporting — with no `manifest.json` bump, because U8 owns versioning and sits in Phase D. `CLAUDE.md` makes the bump non-negotiable on any user-visible change, precisely so a phone user can tell a stale build from a fresh one; and the mixed-version risk row's "update every device" release note is unactionable without a version to point at. If Phase A *does* bump correctly, U8's stated `0.6.59 → 0.6.60` is wrong before this plan's units start.

**Fix.** Add a version-bump line to the Phase A note (bump `manifest.json`, `package.json`, `versions.json` to 0.6.60 and carry the "update every device" release note itself), and restate U8's bump as `0.6.60 → 0.6.61`.

### P1-7. Persist-until-answered banner cannot ride the awaited confirm seam
*feasibility · anchor 75 · `gated_auto` · KTD15 / U13*

Two incompatible contracts. KTD15's host method is `confirm(request) → confirmed | declined | dismissed`, an **awaited verdict**; U13's banner is explicitly allowed to go unanswered across navigation, backgrounding, and restarts. Awaiting that verdict inside the chain parks the pass on a promise that may never settle — the exact wedged-pass state KTD6 and U4 exist to reclaim — and U4's 10-minute liveness ceiling would then kill a pass that is legitimately waiting on the user. KTD15 asserts the modal→banner change "did not change this seam", but persistence is what changed.

**Fix.** Split the seam. Keep awaited `confirm(request)` for U1's deletion modal. Give U13 a **non-blocking** gate: the chain reads pending/answered from `atoms-backlog-gate-v1`, returns a `gated` outcome immediately without starting stages, and the banner's Preview/Proceed actions write the answer and re-invoke the chain. State in U13 and KTD15 that a gated return is a *settled* pass, so liveness reclaim never sees it as wedged.

### P1-8. No unit closes the `data.json` hash-evidence route the plan names as the enabler
*security-lens · anchor 75 · `gated_auto` · Problem Frame hazard 1 / KTD3 / U1*

The plan identifies `settings.askMirrorHashes` syncing through `data.json` as the concrete route by which a fresh phone inherits a desktop's 400-path deletion evidence — then assigns **no unit to remove it**. So after this plan ships, the guard permanently defends against poisoned input instead of the input being cleaned. Verified in source: `src/plugin/main.ts:1292` still reads the synced value as a fallback and `askMirrorHashes` is still a settings field (`src/shared/types.ts:163`), contradicting CLAUDE.md non-negotiable 12 and the plan's own KTD3.

**Fix.** Add a U1 step: drop the `settings.askMirrorHashes` fallback argument from the `readAskMirrorHashes` call at `main.ts:1292` and retire the field from `types.ts:163`. Add a scenario asserting a device with empty local evidence and a populated synced value plans zero deletes and performs an upsert-only pass. (Dropping the fallback fails safe.)

### P1-9. Egress disclosure gates the resume path but not the manual action
*security-lens · anchor 75 · `gated_auto` · U14 / U7 / KTD11*

On an upgraded device a user can tap "Sync everything now" and ship capture bodies to the Anthropic API **before the disclosure describing that egress has ever been shown** — U14 blocks only the resume path's paid stage, and KTD16's carried-forward ack still reads "when Obsidian opens". That is the failure U14 exists to prevent, on the path the unit itself calls the case most likely to be omitted, and the one that spends even for a user who disabled automatic filing to stop spending.

**Fix.** Extend U14's block to every unattended-or-new paid path: the manual action's filing stage is also refused until `atoms-egress-notice-v1` is acknowledged, and it names the outstanding disclosure as the reason rather than failing silently (KTD11's honesty rule). Add the scenario to U14 and U7.

### P1-10. Phase A's refusal copy names a Phase C action
*product-lens · anchor 75 · `gated_auto` · R5 / Scope Boundaries*

A phone user whose mirror sync is refused is told to run an action their build does not have: the refusal line (`… · Sync everything now to retry`) and the escalation notice both name U7, which is **Phase C**, while the guard that raises them (U1) ships in the accelerated **Phase A** PR. That reproduces the exact trap the plan says it closed by pulling U1's confirmation modal forward — "a guard whose escape hatch lands in Phase C is a trap". It also hardcodes into shipped user-facing copy a name that Q7 calls the plan's weakest decision.

**Fix.** Reword Phase A's refusal and escalation strings to name only what that PR ships (the deletion-confirmation modal and the existing Settings "Sync now"), and move Q7 out of the non-blocking list so the final action name is chosen before U1's copy ships.

### P1-11. First post-upgrade foreground stacks two blocking consent gates
*product-lens · anchor 75 · `gated_auto` · Acceptance Examples / R5 / R14*

The first foreground after upgrade — the moment the fix has to prove itself — files nothing until the user clears **two** separate gates: U14's egress acknowledgment and U13's backlog banner. The plan never sequences them or acknowledges that the users with the largest stranded backlog are exactly the complaint population, so the headline acceptance example ("no force-quit and no notice") is false on the run that matters most. A user who misses the banner sees nothing file and force-quits again.

**Fix.** Add an Acceptance Example for the first post-upgrade foreground naming both gates and their order — egress acknowledgment first, then the backlog banner — and scope the silent "no notice" example to the second foreground onward.

> Design-lens raises the follow-on that this fix creates: once U14's notice gets a home surface (P1-2), what is its stacking order against U13's banner and U15's passive line in the shared status region?

### P1-12. Paid filing on a disabled-filing device is settled by default, not by decision
*product-lens · anchor 75 · `manual` · Acceptance Examples / Q9*

A user who turned automatic filing off to control spend gets billed by a button whose name promises *syncing*. The Acceptance Examples already commit to that behaviour while Q9 — whether to ask first — is listed open and non-blocking. Implementers and QA treat the table as the contract, so **a money-affecting default ships by omission rather than by a recorded decision.** This is the one stage in the chain where a wrong default costs real money.

**Fix.** Resolve Q9 before U7 lands: run the free stages immediately and ask once per session before the paid stage when automatic filing is off; update the acceptance example to match.

### P1-13. The interval drain plus the manual action is never priced as a combined alternative
*adversarial · anchor 75 · `manual` · Alternatives Considered / R1 / R6*

The team commits to a 15-unit, four-phase build without ever pricing the cheapest option that satisfies the plan's own diagnosis. The plan rejects the interval drain because R1 demands filing start "without the user doing anything" — but **R6 already ships a one-tap "Sync everything now"**, and Q5 diagnoses the complaint as a *trust* problem ("the user force-quits because they cannot tell whether filing happened"), which U7 plus U15's passive line answers directly and a silent trigger by design does not. Verified: the hourly interval at `src/plugin/main.ts:633` calls only `maybeAutoRun`, so adding `drainInboxOnce()` there plus U7 and U15 covers both the zero-touch backstop and the trust signal — needing none of U0's unverified mobile-visibility assumption, U3, U4, or U5. Alternatives Considered evaluates the interval drain *alone* and never this combination, so the choice reads path-dependent rather than deliberate.

**Fix.** Add an Alternatives Considered entry evaluating interval-drain + U7 + U15, and state the specific observable outcome that combination fails to deliver which U3/U4/U5 do.

### P1-14. U2's `Vault.process` migration retains no surviving justification
*adversarial · anchor 75 · `gated_auto` · Problem Frame hazard 3 / KTD5 / U2*

An implementer will migrate the drain's two `vault.modify` calls — writes on the **verbatim-capture path** — for a reason the plan retracts twice. The Problem Frame says the migration's only job is to enable retiring the promise-join in U4; KTD5 then revises U4 to keep the single-flight lock and drop only the result-share, and returning a tri-state requires no change to how the drain writes. KTD5's remaining claim that U2 covers "the out-of-band Sync case" is the case the Problem Frame says `Vault.process` explicitly does *not* address. U0's negative-spike table then drops U4 and files U2 under "already shipped", leaving the migration steps with no owner in either branch.

**Fix.** Cut U2 steps 1, 2 and 4 into the existing "Migrating the other 11 `vault.modify` call sites" follow-up item; remove U2 from U4's dependency list; keep only step 3 (marker-time re-verification) in the accelerated Phase A PR.

### P1-15. iOS webview reclamation may already cold-start the drain
*adversarial · anchor 75 · `gated_auto` · Problem Frame / KTD4 / U0*

Two claims that cannot both be broadly true. KTD4 justifies persisting the filing budget because iOS "reclaims webview memory routinely" and "an in-memory budget resets to empty on every process reload" — but **a process reload re-runs `onLayoutReady`, which already drains the inbox** (`src/plugin/main.ts:210`, verified). If reclamation is as routine as KTD4 needs, the population the resume trigger serves is only the app-stayed-resident case, which nobody has measured. U0 spikes whether the signal *fires*, not whether the population it serves justifies Phase C — so a green spike still leaves the premise untested.

**Fix.** Extend U0's spike to record, per platform, whether the plugin re-initializes (`onLayoutReady` re-fires) after realistic background durations, and add that measurement to U0's branch table so Phase C is gated on the resident-background case actually being common.

### P1-16. The new-work waiver lets the paid stage run once per foreground
*adversarial · anchor 75 · `gated_auto` · KTD4 / U3*

A phone receiving captures through the day pays for many small classify batches instead of a few large ones. The plan's "so R3 holds" defends only the case where nothing new drains. With a 30 s minimum between resume passes, up to 120 passes an hour can each carry newly drained work and each earn a waiver; the rolling budget caps **captures** at 15/hour, not **passes**, so 15 one-capture batches replace one 15-capture batch. Because context is all-titles per request, that multiplies request-side cost — exactly the spend R3 exists to bound, and exactly the failure KTD5 used to reject the dirty/epoch re-run.

**Fix.** Add a per-rolling-60-minute cap on *waived* filing passes to KTD4's knobs table and the named-constants block, and add a U3 scenario asserting a stream of foregrounds each carrying one new capture stops earning waivers once the cap is reached.

---

## P2 — 7

| # | Finding | Lens · anchor · class |
|---|---|---|
| P2-1 | **U15 and U1 assert rendered UI strings the node test env cannot produce.** `test/catchUp.test.ts` and `test/askMirror.test.ts` cannot render `atomsHomeView.ts` or the Settings status line under `environment: "node"` with no jsdom, so those scenarios silently become no-ops. The plan already applies the fix pattern twice ("Extraction is a precondition, not a refactor") but never to the string formatting or shared-slot precedence logic. **Fix:** extract the "last caught up" formatter and the status-region precedence resolver into a pure function in `catchUp.ts`; assert the pure function; move on-screen render to the CLI/device rows of the Verification Contract. | feasibility · 100 · `gated_auto` |
| P2-2 | **Persisted filing budget has no clock-jump handling or scenario.** The only durable bound on resume-triggered spend is a wall-clock rolling window; one forward clock correction empties it. KTD3 rejects persisted `Date.now()` comparisons for the *cooldown* on exactly this reasoning and U3 ships a backwards-jump scenario — but the budget, the knob that governs money, inherits neither. **Fix:** state in KTD4 that budget timestamps are clamped on read (an entry stamped later than now is treated as now; entries retire only by forward progress from the newest stamp) and add a U3 forward-jump scenario. | security-lens · 75 · `gated_auto` |
| P2-3 | **Mixed-version risk row understates un-updated device exposure.** The row reads as though an old device only wipes the mirror if the user taps a button, making "update every device" look like advice. The Problem Frame contradicts it: `onLayoutReady` calls `syncAskMirror({force:false})` unconditionally (`main.ts:229`), so an old build issues the delta wipe on **every cold start** with no user action. This is the row a release-note author works from. **Fix:** rewrite the row to say so. | security-lens · 75 · `gated_auto` |
| P2-4 | **R10 listed "Met" under the negative-spike fallback though its only units are dropped.** The disposition table drops U3 and U4 — the only two units whose Requirements field names R10 (a wedged pass must not permanently disable catch-up) — yet the fallback paragraph claims "Met: R3, R5–R16". Nothing else in the fallback implements KTD6's liveness/generation reset, so a webview-suspended pass can still wedge filing forever. **Fix:** remove R10 from the Met range and treat it explicitly, as R1 and R2 already are. | coherence · 75 · `gated_auto` |
| P2-5 | **Negative-spike fallback picks the hourly tick over a short one.** If U0 returns negative, the plan falls back to an hourly drain and knowingly ships an R1 gap of up to an hour — when a short tick on a cadence the plugin already runs (the existing 60 s outbox interval) shrinks that to about a minute for the same few lines. Alternatives Considered only evaluates the hourly variant. Naming the short-interval variant also prices what the resume trigger actually buys — seconds instead of ~a minute — across the four units it costs. **Fix:** make the fallback a short drain tick on the 60 s cadence and state the resulting R1 gap in U0's branch. | product-lens · 75 · `gated_auto` |
| P2-6 | **Confirm-host contract has no owning module across the layer boundary.** U1 needs `confirm` on the host it injects into `platform/askMirror.ts`, but KTD15 declares the host interface as belonging to `plugin/catchUp.ts` — so the implementer must import a `plugin/` type from `platform/`, inverting the module map's "wire-up only in `plugin/`" role (`docs/architecture.md:65`), or duplicate the contract and let it drift. **Fix:** declare `ConfirmRequest`, the verdict union, and the `DeletionConfirmation` token in `src/shared/`; have both sides import it. | feasibility · 75 · `gated_auto` |
| P2-7 | **R1's few-seconds bound holds only for locally-written captures.** QA verifying R1 gets opposite results depending on how the test capture arrived. A capture the iOS Shortcut wrote locally is on disk at foreground; a capture arriving through Obsidian Sync only starts downloading once the app is open, so it systematically misses the pass that just fired — the norm for anyone capturing on one device and opening on another. **Fix:** qualify R1 to the on-local-disk-at-foreground case and add an acceptance row for the cross-device capture. | adversarial · 50 · `gated_auto` |

---

## FYI — 3 (advisory; nothing breaks)

- **U13's banner omits the busy-guard its sibling names.** U7's more-menu item explicitly commits to "respecting the view-level `busy` guard"; U13's Preview/Proceed buttons don't. U4's single-flight lock still prevents duplicate chain work underneath, so a double-tap is harmless in the common case. *(design-lens · 50)*
- **`F25` is cited in Q10 but never defined anywhere in the document.** A reader hitting it cold cannot tell whether it's a prior review finding, a code comment, or something else. Suggest replacing with a plain descriptive reference (e.g. "the gate ordering established in KTD7"). *(coherence · 50)*
- **Phase B+C+D is implied to ship as one large PR** by the Definition of Done's "before this feature's units began" language, but never stated as explicitly as the Phase A split is. Consistent with the full-lane framing, so not an error — worth an explicit confirmation. *(scope-guardian · residual)*

---

## Notable residual risks (not findings)

- **Line references are accurate.** Feasibility spot-checked ~40 of the plan's `file:line` citations against source and found them accurate to within a line or two throughout, along with the 13-`vault.modify`/zero-`vault.process` count, `PER_LAUNCH_CAP = 15`, `Vault.process` in the 1.13.1 typings against `minAppVersion` 1.11.4, `registerDomEvent`'s overloads, the node vitest env with no jsdom, the empty `Plugin` stub, and "no test imports main.ts". Adversarial independently re-verified the `main.ts:633` interval, the `:294` promise-join, the delete loop sitting outside `if (force)`, and the `readAskMirrorHashes` fallback.
- **R1's "few seconds" is the author's own answer to Q4**, not a user-sourced threshold — and it is the single criterion that rejects the cheap interval baseline and justifies four units of trigger machinery. If real user tolerance is a minute, the cost/benefit of Phase B flips.
- **The premise rests on one reported complaint** plus source-verified lifecycle gaps. The gaps are real; there is no evidence in the document about how many users force-quit or how often, so the sizing of the response cannot be checked against demand.
- **`BACKLOG_GATE_THRESHOLD = 50` and the 0.8 completeness ratio are set by intuition** ("below ~50 the spend is pennies") with no per-capture cost figure or vault-shrinkage data to check against. A legitimate large prune on a small vault could wedge a device for `MIRROR_HIGHWATER_DECAY_DAYS = 30`.
- **U15's passive line is the objective's only observable signal** for both user and QA, and it sits in Phase C. If Phase C slips or the spike fails, the accelerated Phase A PR ships with no way for a user to tell anything changed.
- **The deletion refusal is client-side only** for the life of this plan; the server-side proportional-delete refusal is follow-up. Until it lands, any client without U1's floor can still issue the mass delete, and the Definition of Done treats the release note as the only compensating control.
- **U1's escalation-notice scenario needs a `Notice` channel** on the injected host, which is listed as vault scan, request fn, localStorage and confirm — no notice channel. Likely absorbed at implementation time, but unstated.
- **The manual forced pass bypasses `vaultIndexReady`** in the trigger diagram (R12 is worded as scoped to resume), and U7 states no disposition for `ensureInboxNote`, so a tap before the index warms could create a duplicate inbox note.

## Deferred questions raised by reviewers

1. What fraction of real mobile foregrounds are process reloads (already covered by `onLayoutReady`) versus resident-background resumes? This sizes the population Phase C serves. *(adversarial)*
2. If U0 returns negative and U4 is dropped, do U2 steps 1, 2 and 4 still ship, and under what justification? *(adversarial)*
3. Does the accelerated Phase A PR need its own version bump and BRAT release note? *(adversarial — now answered affirmatively by P1-6)*
4. Where does `atoms-filing-budget-v1` actually get written? KTD3 names U3 as owner, but U3's files are the pure module plus its test, and no unit names the call site supplying the host. *(feasibility)*
5. Is the Plus base URL that KTD7's probe targets a fixed constant or user-configurable? If configurable, the recurring beacon can be pointed at an arbitrary host, which changes U5's "carries no credential headers" analysis. *(security-lens)*
6. Once U14's notice gets a home surface, what is its stacking order against U13's banner and U15's passive line? *(design-lens)*
