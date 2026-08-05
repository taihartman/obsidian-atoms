# Doc review — resume catch-up plan (round 2)

**Document:** [`docs/plans/2026-07-31-001-feat-resume-catch-up-plan.md`](../plans/2026-07-31-001-feat-resume-catch-up-plan.md)
**Issue:** [#222](https://github.com/taihartman/obsidian-atoms/issues/222) · **PR:** [#223](https://github.com/taihartman/obsidian-atoms/pull/223)
**Classification:** `unified-plan`, implementation-ready, greenfield premise (`ce-plan-bootstrap`)
**Date:** 2026-07-31 · **Reviewers:** 7, dispatched in independent contexts

Applied 4 fixes. 30 items need attention (17 errors, 13 omissions). 3 FYI observations.

---

## Coverage

| Reviewer | Findings | Applied | Proposed fixes | Decisions | FYI |
|---|---|---|---|---|---|
| coherence | 7 | 4 | 3 | 0 | 0 |
| feasibility | 8 | 0 | 7 | 0 | 1 |
| adversarial | 6 | 0 | 6 | 0 | 0 |
| product-lens | 5 | 0 | 4 | 0 | 1 |
| design-lens | 4 | 0 | 2 | 2 | 0 |
| scope-guardian | 4 | 0 | 3 | 0 | 1 |
| security-lens | 3 | 0 | 3 | 0 | 0 |
| **Total** | **37** | **4** | **28** | **2** | **3** |

Restated: 22 (residual/deferred items suppressed as duplicates of actionable findings)
Cross-model peer pass: **not run** (declined — plan content stays on this machine). No different-serving-family corroboration in this set; all agreement is between independently-dispatched Claude contexts.

**Feasibility verified the plan's factual base and it holds.** Every `src/plugin/main.ts` line citation resolves to the described code (`:210`, `:229`, `:233`, `:352`, `:633`, `:750`, `:1385`, `:1397`), as do the cited lines in the capture-drain module, the connectivity probes, the mirror planner, and the auto-run state reader. `Vault.process` is present in the installed typings with a synchronous callback, and the manifest's minimum app version is low enough to use it. The "13 `vault.modify`, zero `vault.process`" count and "no test imports the plugin shell" claims are both confirmed. No finding below disputes a fact the plan asserts about the codebase — they are about values the plan never states and units it never wires together.

---

## Applied fixes

1. **Outstanding Questions, Q2** — the note claimed the first-run backlog gate carries no pointer back to its own open question, so a reader judging how exposed an implementer is would think the gap is still open. The pointer was added in the prior round; the note now says so. *(coherence, scope-guardian)*
2. **Outstanding Questions, Q3** — the argument for keeping this a full-lane change counted three new modules; the unit file lists contain two. Corrected to two. *(coherence)*
3. **U4 (re-runnable chain)** — its dependency line named only the two units it reads from, not the unit that creates the orchestration file it edits, so nothing forced that unit to land first. Added, with the same parenthetical the settings-toggle unit already uses. *(coherence)*
4. **U13 (first-run backlog gate)** — described itself as the sole exception to the per-foreground silence contract, while the requirement it cites names two. Reworded to name the other one. *(coherence)*

---

## Proposed fixes

Concrete fix exists; you confirm before it lands.

### P0

**F1. A user who legitimately deletes many atoms gets a permanently divergent cloud mirror with no way out.** *(adversarial + security-lens + feasibility, confidence 100 — +1 anchor)*
- **Recommendation:** Apply
- **Consequence if unchanged:** Between the deletion guard shipping and the manual sync action shipping — and permanently if the guard ships as its own PR, which the plan currently leans toward — nothing in the product can produce the confirmation the guard requires. The refusal has no release valve.
- **Change:** Move the deletion-confirmation modal out of the manual-sync unit into the guard's own unit, wired behind the existing Settings sync button so it exists the moment the guard does; the manual action then reuses it.
- **Basis:** U1's guard refuses deletion unless the user explicitly confirmed, and assigns that gesture to U7 in a later phase. The plan already applied exactly this reasoning to the egress-consent copy — it was pulled out of the docs unit for the same "permanently, if the phases ship separately" hazard — and did not apply it here.

**F2. If the device spike comes back negative, five units have a cancelled prerequisite and no stated disposition.** *(adversarial + feasibility + coherence, confidence 100 — +1 anchor)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The fallback drops the trigger units, but the manual sync action, the quarantine, the kill switch, the backlog gate and the egress copy all declare the dropped trigger unit as a dependency. The manual action is a headline objective that does not need the resume signal at all, yet it dies by dependency chain rather than by decision — so the plan's own escape hatch disappears in exactly the scenario where the automatic trigger fails.
- **Change:** Extend the spike's negative branch to enumerate every dependent unit's disposition and record which requirements the fallback does and does not meet, matching the specificity of its positive branch.
- **Basis:** The negative branch names only "drop U3–U6 and U11"; U7, U10, U12, U13 and U14 each depend on U5.

### P1 — errors

**F3. Frontmatter says the plan is ready to implement while the plan says it is not.** *(coherence, 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** A tool or reader that trusts the metadata dispatches implementation on a plan whose own opening forbids it until three questions close.
- **Change:** Set the readiness field to a blocked value until the three blocking questions are answered, then flip it back.
- **Basis:** `artifact_readiness: implementation-ready` versus the Goal Capsule's "must be closed before `ce-work` runs".

**F4. The tri-state migration breaks three live callers it never lists.** *(feasibility, 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** Settings' own sync button branches on the numeric return value to choose between "reconciled" and "uploaded N atoms". Under the new tri-state that comparison silently misreports, and no test catches it because the settings file is not in the unit's file list.
- **Change:** Add the three settings call sites to the caller inventory and the unit's file list, plus a scenario asserting the button reports reconciled, uploaded and joined distinctly.
- **Basis:** The caller inventory for both migrated functions lists only the plugin shell.

**F5. One of the guard's declared test scenarios cannot be written against the interface the same unit specifies.** *(feasibility, 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The confirmation input is defined as a boolean, and a boolean has no origin — so no assertion can prove a confirmation came from the modal rather than being improvised from a force flag. The implementer deletes the scenario or invents a type the plan never named.
- **Change:** Make the confirmation a provenance-carrying token with a single constructor the modal calls, and restate the scenario as: the guard refuses without the token, and no other path can construct one.
- **Basis:** Step 1 takes "whether the user explicitly confirmed"; the scenario asserts nothing except the modal may set it.

**F6. The egress disclosure can arrive after capture text has already left the device.** *(design-lens + security-lens, confidence 100 — +1 anchor)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The notice is specified as showing once, with no acknowledgment gate and no ordering constraint. A phone user who backgrounds the app mid-notice never learns the trigger set widened — and because the first resume pass is silent by contract, filing can bill and upload before the notice is ever seen.
- **Change:** Make the disclosure persist until acknowledged, and require it before that device's first resume-triggered filing pass, with a scenario asserting no classify request is issued until it has been acknowledged.
- **Basis:** The backlog-gate unit already rejects transient notices for exactly this failure shape — "once means once *answered*, not once *shown*" — and uses a persisted modal instead. The disclosure unit is the same shape and did not inherit the reasoning.

**F7. The completion criteria assume a unit the plan is actively deciding whether to cut.** *(scope-guardian, 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** "The gate fires once" is an unconditional done criterion and the gate is also the named mitigation for the stranded-backlog risk. If the blocking question resolves toward cutting it — which is its stated lean — the criterion is unsatisfiable and the risk loses half its coverage silently.
- **Change:** Make both the done criterion and the risk mitigation conditional on that question's outcome, naming the release-note disclosure as the sole remaining cover if the gate is cut.
- **Basis:** Q2 is listed among the three that must close before implementation, and leans toward cutting.

**F8. The requirement is written as the mechanism, so the requirements cannot decide the question that governs most of the plan.** *(product-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** Nobody can adjudicate the latency question from this document, because R1 already assumes its answer — it names the foreground trigger rather than the user-visible need, so the cheap alternative fails by construction rather than on merit. The stated objective does not discriminate either: adding the drain to the hourly tick also means no force-quit.
- **Change:** Restate R1 as an outcome with an explicit latency bound and leave the bound as the value Q4 supplies; move the trigger mechanism into the technical decisions where it already lives.
- **Basis:** R1 reads "when Obsidian returns to the foreground, the plugin runs the catch-up chain".

**F9. The argument for cutting the backlog gate compares two different populations.** *(product-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** A blocking scope decision rests on an equivalence that does not hold, and getting it wrong means the first foreground after upgrade silently spends API allowance filing months of captures the user never consented to. Auto-run's backlog counter enumerates daily notes — so the behaviour "users already live with" is captures *already in dailies*. The gate protects undrained inbox captures, a population auto-run has never been able to reach and which only becomes filable because this plan adds the drain trigger.
- **Change:** Correct Q2's framing to say so, and change its lean from "cut the gate" to "keep it, scoped to the inbox-stranded backlog only".
- **Basis:** The counter's scan path enumerates all daily notes, not the capture inbox.

**F10. The cooldown exemption that closed a question is a no-op on the platform this feature targets.** *(adversarial, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The plugin does not run while backgrounded, so the last filing pass always precedes the absence — an absence longer than the cooldown implies the cooldown was already satisfied. The rule can never change an outcome. Meanwhile the case that actually breaks the headline acceptance example, a short background right after a filing pass, is explicitly excluded. The exemption also takes an absence-duration input that nothing produces, since cooldown state may not be persisted.
- **Change:** Replace the absence-keyed exemption with a work-keyed one — waive the filing cooldown on any resume pass whose drain produced a capture the previous filing pass did not see, capped at one waiver per resume signal — and reopen Q6 to record that the absence rule was a no-op.
- **Basis:** KTD4's exemption row keys on "absence > filing cooldown"; U3 takes backgrounded duration as an input.

**F11. Either the mid-session capture guarantee or the alt-tab acceptance example must give, and the plan does not say which.** *(adversarial, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The trigger diagram routes a re-run straight back into the chain, bypassing the decision gate. Read literally, the paid filing stage runs twice inside a minute and the alt-tab example fails. Read the other way, a capture arriving 20 seconds after foreground is drained but sits unfiled for the rest of the 10-minute cooldown, so R4's "filed in that session" fails. The unit that owns the watch window describes only marking the chain dirty.
- **Change:** State that a dirty re-run re-enters through the decision gate, that a re-run inside the post-resume watch window carries the same cooldown waiver as the pass that opened it, redraw the diagram edge to match, and add a scenario asserting a capture delivered at +20s is filed, not merely drained.
- **Basis:** R4 promises same-session filing; the filing-stage cooldown is 10 minutes.

**F12. The quarantine record will persist verbatim capture text, failing the test the same unit asserts.** *(security-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The redaction helper the unit reuses strips only key-shaped prefixes and then truncates — it has no mechanism to remove echoed request-body content, and classify failures routinely carry input echoes. Up to 160 characters of the user's capture text lands in device-local plaintext, against both the body-is-sacred rule and the log-safety rule.
- **Change:** Store an enumerated failure code plus HTTP status from a closed set and nothing else from the error; keep the existing helper for the transient dev-log path only.
- **Basis:** The unit's own scenario asserts a body-echoing error leaves no capture body in the record.

### P1 — omissions

**F13. The objective has no signal the user or QA can observe, and the question that would fix it is not blocking.** *(product-lens + design-lens, confidence 100 — +1 anchor)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The feature exists to stop a trust habit — the user force-quits because they cannot tell whether filing happened — and then makes the fix invisible by contract. Shipping without a passive surface means the habit may persist unchanged even after the trigger works. Q5's resolution also adds a Phase C unit, which is the exact criterion used to mark the other three questions blocking.
- **Change:** Promote Q5 to blocking and add it to the Goal Capsule's list, naming the "last caught up" line on Atoms home and Settings as its concrete shape, sourced from the report data the sync units already produce.
- **Basis:** The plan states there is no way to confirm a resume pass ran without triggering one.

**F14. A unit implementing zero requirements rides into the plan by default.** *(scope-guardian, 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The checkout-poll migration is tagged "Requirements: none" and the plan concedes a regression there is invisible to this feature's QA — yet its question is non-blocking, so an implementer following the blocking list literally builds it. The backlog gate, with the same soft-value profile, was escalated to blocking.
- **Change:** Cut it from this plan's units and file it as its own issue, per that question's own lean.
- **Basis:** Q8 already concludes "split it out"; Q2 uses the same bar to block.

**F15. The plan's self-declared most important decision never states its threshold.** *(feasibility + security-lens + adversarial, confidence 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The implementer must invent the completeness floor, and whatever they pick is untestable against the plan — the only concrete formula in the text appears as an example of the *wrong* denominator, and could easily be lifted. Too loose reopens the mass-delete; too tight permanently wedges a user who genuinely pruned. The high-water mark's release condition is left the same way: "after a stated expiry" is never stated. Three sibling thresholds are equally unstated — the backlog threshold, the quarantine expiry, and the probe interval.
- **Change:** Add a named constants block to U1: refuse when scanned paths fall below `max(5, highWaterMark × 0.8)`, with the mark decaying to the current scanned count after 30 days without a refusal; state the sibling thresholds in the same block and point the decisions table at it instead of "see U1".
- **Basis:** The constants table defers the floor to the unit, and the unit describes only its shape. Reviewers split on the ratio — two proposed 0.8, one 0.9; the fix takes 0.8 and the number is yours to set.

**F16. The unit owning the refusal surface does not list either file that renders it.** *(feasibility, 100)*
- **Recommendation:** Apply
- **Consequence if unchanged:** An implementer builds from the file list and ships a refusal nothing renders — the mass-delete is silently skipped with no user signal, which is the invisibility the refusal carve-out exists to prevent. The Atoms home surface does not exist at all today; it is net-new, not an edit.
- **Change:** Add the settings status line and the home view to the unit's file list, and note the home surface is net-new.
- **Basis:** Step 4 says the unit owns the copy and both surfaces.

**F17. The most important data-safety alert in the product has no copy and no test.** *(design-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The escalation after three consecutive refusals is one of only two exceptions to the silence contract and the only one tied to actual data-integrity failure, yet no unit's scenarios exercise it and no text is given. It can ship untested with implementer-invented wording.
- **Change:** Add a scenario covering the three-consecutive-refusal escalation and script its literal text beside the already-scripted status-line string.
- **Basis:** The threshold is fixed at 3 in the constants table; the unit's scenarios stop at the passive status line.

**F18. Four units may be deleted by the highest-leverage open question, and none says so.** *(adversarial, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** An implementer builds the resume decision module, the chain, the trigger wiring and the watch window as committed scope while Q4 may delete all four. The plan diagnosed this exact failure for the backlog gate and fixed it with an inline pointer; these four got neither.
- **Change:** Add the same pointer blockquote to the head of U3, U4, U5 and U6, and add a Q4 row to the verification gate so it is answered alongside the spike.
- **Basis:** Q4's own note says Phases B and C collapse into a timer that already runs if the answer is "within the hour". Verified: the hourly tick calls only the auto-run entry point, so the drain really is the one missing stage.

**F19. The atomic-write unit defers where its own load-bearing step runs, and it cannot be atomic.** *(feasibility, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The framework's file-process callback is single-file and synchronous, so re-reading the daily to verify the bullet must happen outside it — which reopens the read-then-write window the step exists to close. The plan calls re-verification "the only thing that catches that", so an implementer will believe the hazard is closed when it is narrowed.
- **Change:** Specify that the daily is re-read immediately before entering the callback and the verified capture set passed in, and state plainly that this narrows rather than eliminates the out-of-band merge window, naming the unmatched-capture fallback as the recovery path.
- **Basis:** The unit itself flags that the callback must be synchronous and side-effect-free, then says "state where it runs".

**F20. The unit under a test-first merge gate never tells its implementer to write the test first.** *(coherence, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The verification contract requires three units each to ship a test observed failing against pre-fix code. Two spell this out in their own execution notes; the third does not, so the gate is undiscoverable from the unit an implementer is actually reading.
- **Change:** Add a sentence to U9's execution note parallel to the other two: write the acknowledge-on-deferred regression test first, confirm a concurrent push gets acknowledged at zero, then fix.
- **Basis:** The regression-proof row names all three units.

**F21. The only control that stops unattended spending has no stated storage, and the default would sync it across devices.** *(security-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** If the toggle lands in plugin settings it becomes vault-global, because that file syncs. A user cannot mute a misbehaving phone without disabling resume everywhere, and toggling it on at a desktop silently enables the trigger on devices they never intended.
- **Change:** State that the toggle persists device-locally alongside the existing auto-run device state, with only its UI in settings, and replace the "survives reload" scenario with one asserting the value is absent from the synced settings file and that two devices hold independent values.
- **Basis:** The repo already stores exactly this class of gate device-locally — the auto-run enable and egress-acknowledgment flags — while keeping their UI in settings.

**F22. The trigger unit's dependency line omits an ordering constraint the done criteria enforce.** *(coherence, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** "Egress copy landed with or before the trigger" is a required completion criterion, and the copy unit states it too, but the trigger unit's own dependency line does not — which is how every other ordering constraint in the document is expressed. Sequencing off that line lands the trigger first and fails the gate.
- **Change:** Add the constraint to U5's dependency line.
- **Basis:** The done criteria and U14 both carry it; U5 does not.

### P2

**F23. The device-local key rule is contradicted by four keys the plan later adds.** *(feasibility + coherence, confidence 100 — +1 anchor)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The decision states quarantine is the single exception and gets one key, then four more pieces of persisted device-local state accrete — the rolling filing budget, the scan high-water mark, the pending gate flag, and the disclosure-shown flag. None has a name, so an implementer invents four, and one unit says it shares the quarantine key when it should not. These keys must never reach the synced settings file, which makes naming load-bearing.
- **Change:** Replace the single-exception wording with a table naming every device-local key this plan adds, and correct the gate unit to name its own key.
- **Basis:** KTD3's "the stated exception" is withdrawn by KTD4 one decision later.

**F24. The scope argument for taking unrequested work is retracted by the decision that implements it.** *(product-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** Connectivity-restore mirror push is admitted as "not requested" and defended as free because the listener set already answers it — then the same decision states it needs a new probe and its own file. No requirement mentions it, so it is an orphan unit that also adds a recurring outbound beacon on every network transition.
- **Change:** Drop the network-restore listener and its probe from this plan, move it to follow-up work with a pointer to the mirror-parity plan that deferred it, and narrow the decision to a note that the resume listener set makes it cheap to add later.
- **Basis:** The plan's own precedent is Q8, which splits requirement-less work out.

**F25. A device that never enabled the cloud features would still beacon the vendor on every network change.** *(security-lens + adversarial, confidence 100 — +1 anchor)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The probe discloses IP and app-usage timing to a service the user is not a customer of — the identical objection the plan uses to reject a third-party baseline probe, applied to its own backend but never gated. The mirror push it protects already refuses on such a device, but the probe sits upstream of that check.
- **Change:** Add an Ask-enabled-and-privacy-acknowledged condition to the gate ordering, immediately after the kill switch and before the probe, plus a scenario asserting zero probe requests on a device with the cloud features off.
- **Basis:** The mirror sync function already enforces exactly this precondition and returns early without it.

**F26. Two confirmations the plan says must happen before the guard ships have no owning gate.** *(adversarial, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The guard's dependency line reads "None. Land first", and neither the verification contract nor the done criteria mention either confirmation — so it ships without them. Both change the design, not just the risk write-up: whether the server tombstones or hard-deletes sets the refusal severity, and the reconcile-session semantics decide a branch the chunked-path scenario has to assert on.
- **Change:** Change U1's dependencies to name both service-side confirmations, add them as verification rows, and add a done criterion recording the answers before merge.
- **Basis:** Assumptions and Risks each say "confirm before U1"; nothing enforces it.

**F27. The accelerated split-out PR silently leaves behind a data-loss fix with the same urgency.** *(scope-guardian, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** Q3 pulls the mirror guard and the tri-state forward on the grounds that their hazard already fires today independent of the trigger. The drain's marker-time re-verification is the same shape — it fires on every cold start — and the plan itself isolates that piece from its non-urgent migration half. It has no dependencies, so nothing blocks including it, and the question never asks.
- **Change:** Extend Q3 to name the marker-time re-verification for the same accelerated PR, leaving only the file-process migration behind as the precondition for retiring the chain's promise-join.
- **Basis:** U2's dependencies read "None (parallel with U1)".

**F28. Two units place modal scenarios in a test harness that cannot drive a modal.** *(feasibility, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The shared Obsidian mock stubs the modal class with no children, no buttons and no event wiring, and no test in the repo exercises one. The implementer either extends the shared mock — unscoped in both units — or the scenarios quietly become no-ops, leaving the dismissal-stall fix and the confirmation gate untested.
- **Change:** Put the modal presenter on the injected host interface as a confirm method returning confirmed/declined/dismissed, so both units' scenarios drive a fake host, and state that the concrete modal subclass is verified via the CLI device gate rather than the unit test run.
- **Basis:** The test config runs in a node environment with no DOM implementation in devDependencies.

---

## Decisions

Judgment calls — no single right answer.

**F29. The new action's name is one word from an existing button that does much less, and the extra word does not signal spending.** *(design-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** Settings' "Sync now" does a mirror-only delta reconcile. "Sync everything now" runs the full chain, forces a reconcile, and can spend on paid classify even with automatic filing disabled. A user familiar with the first may tap the second expecting mirror sync and get a bill. The deletion path stays safe behind the completeness guard; the spend surprise does not.
- **Change:** When resolving the naming question, address the same-plugin scope difference as well as the Obsidian Sync collision — either name the action for what it adds, or state in KTD10 why the near-synonym is safe.
- **Basis:** KTD10 separates the two only by which screen they sit on. Q7 covers only the collision with Obsidian's own Sync feature.

**F30. The product's only recorded egress-consent artifact has no scripted words.** *(design-lens, 75)*
- **Recommendation:** Apply
- **Consequence if unchanged:** The unit says to rewrite the acknowledgment to "name the actual trigger set" and to surface a one-time notice, without giving either a literal string — unlike the refusal copy, which is scripted to the character, and the backlog modal, which names both button labels. An implementer authoring consent copy with no brief is likely to under- or over-state the trigger set, and nothing is reviewable until the unit lands.
- **Change:** Put the literal acknowledgment sentence and the literal upgrade-notice copy directly in the unit, at the specificity the refusal copy already uses.
- **Basis:** The trigger set now includes a manual action that spends even with automatic filing off — the case most likely to be omitted.

---

## FYI observations

No decision required.

- **The problem has no stated magnitude.** Two blocking questions turn on how bad it actually is, and the Problem Frame gives no force-quits-per-week, no typical stranded-capture count, no observed wait. This is a single-user plugin, so those numbers are obtainable rather than hypothetical. *(product-lens)*
- **The new probe names no endpoint and no success criterion.** The decision spends most of its length on what the probe must not call, leaving the target as "the Plus base URL" and never saying whether a 401 or 404 counts as reachable — the trick the existing Anthropic probe already relies on. *(feasibility)*
- **The docs unit tags itself "supports R1–R15".** Every other unit names specific requirements, which is what let this review confirm no requirement is orphaned; this is the one unit whose coverage cannot be checked by inspection. *(scope-guardian)*

---

## Residual concerns

- **The cheap alternative may not work on mobile at all.** A backgrounded iOS webview suspends timers, so the existing hourly tick may not fire until well after foreground — meaning the interval-drain baseline could close the desktop complaint but not the mobile one the plan was written for. Unverified, and it should be checked before Q4 is answered toward the interval. *(product-lens)*
- **The spike may be partly answerable without cutting a device build.** The Plus checkout return path already ships a production `visibilitychange` listener on mobile, so whether that has ever worked on someone's phone is a cheaper first move than a BRAT install. *(adversarial)*
- **The spike's install method may not be available to an agent.** It calls for BRAT installs on real iOS and Android devices, but BRAT pulls from GitHub Release assets and cutting a Release requires explicit user request — a manual sideload may be needed instead. No unit names who runs the spike, or what happens if only iOS can be tested. *(feasibility, adversarial)*
- **The stated reason for the phase ordering has been withdrawn.** The Goal Capsule justifies Phase A landing first because the trigger converts those hazards from rare to routine; the Problem Frame's own correction says the trigger is not what makes them routine. The ordering may still be right, but its stated basis no longer holds and Q3 now leans the other way. *(adversarial)*
- **The watch window is sized on a single anecdote.** 60 seconds comes from one forum report of ~30s Sync lag. If real mobile delivery is slower on large vaults, the same-session guarantee is bounded by an unvalidated constant. *(adversarial)*
- **Clearing a large backlog takes about a day of foregrounding.** At 15 filings per hour, a 400-capture stranded backlog needs roughly 27 hours. This matches today's throughput so it is not introduced here, but it makes the gate's "Proceed" promise weaker than it reads. *(adversarial)*
- **The drain has no bound on repeated re-append.** If Sync repeatedly drops the daily bullet, every resume pass re-appends and re-attempts, and the quarantine keys off classify failures rather than drain failures. Unbounded repeat spend on a Sync-hostile daily is not covered by any listed scenario. *(security-lens)*
- **No unit owns an abort for an interrupted chunked reconcile.** The risk is named with a preference for aborting over leaving the session open, but the chunked scenario covers only the empty-confirmation flag. If the server completes an abandoned session from a partial keep-list, that is a deletion path the client-side floor cannot see. *(security-lens)*
- **Mixed-version fleets stay exposed and the plan is right that it cannot fix that in-product.** An un-updated device retains the pre-guard wipe path and can delete atoms an updated device just protected. A server-side proportional-delete refusal remains the only durable backstop. *(security-lens)*
- **The refusal copy hardcodes a name that is still under question.** The scripted status-line string uses "Sync everything now"; if the naming question resolves differently, this string is a touch point the document does not list. *(design-lens)*
- **The trigger count could not be verified.** "Nine triggers now exist" yields either 9 or 11 depending on whether the three DOM resume signals count as one converged gate or three. *(coherence)*
- **The checkout-poll migration may end up as a second path through the gate.** It is routed onto the shared trigger and then exempted from the resume cooldown so it fires immediately; the plan does not say whether the exemption is a gate input or a bypass. *(feasibility)*
- **The kill-switch check has two workable homes and the plan names neither.** Its file list edits the orchestration module for a gate a different unit builds, while the pure decision module belongs to a third. *(feasibility)*
- **If Phase A splits out, the single-PR framing does not carry.** The done criteria assume one PR body, one issue-closing line, and one screenshots directory. *(scope-guardian)*
- **Product identity checks out.** Filing is not resurfacing, no due-date or checklist gravity is added, gated auto-run already writes unattended under the existing non-negotiable, and the silence requirement reasons explicitly about where interruption is allowed. The trigger changes when existing behaviour runs, not what the product is. *(product-lens)*
- **Key storage is untouched and slightly strengthened.** No unit moves the API key out of SecretStorage, and KTD7 actively forbids the new probe from reusing the key-bearing Anthropic probe. *(security-lens)*
- **The success-report copy has a strong existing precedent.** The current process-unprocessed path already establishes a notice-plus-home-summary shape an implementer can extend without guessing. *(design-lens)*

---

## Deferred questions

- Does the existing hourly tick actually fire on a backgrounded mobile webview, or only after foreground? Q4 cannot be answered honestly for mobile until this is known.
- If Q4 resolves to "within the hour", does the manual sync action still ship, and against which drain implementation — the retained promise-join or the new dirty/epoch chain?
- Who executes the device spike on a real Android device, and what is the decision if only iOS can be tested?
- Should the resume trigger's device-local enablement default to on for devices that have never run a filing pass, or only for devices that already acknowledged egress? Default-on plus a synced settings file is what creates the "enabled on a device the user did not intend" shape.
- If Phase A splits out, do the done criteria and verification contract apply once per resulting PR, or only to the remaining one?
