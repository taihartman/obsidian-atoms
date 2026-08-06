# `ce-doc-review` — consent wording parity plan (#315 + #314)

**Document:** `docs/plans/2026-08-06-001-fix-consent-wording-parity-plan.md`
**Mode:** non-interactive (headless). **Classification:** `plan` (legacy shape). Origin: `none`.
**Date:** 2026-08-06. **Branch:** `fix/consent-wording-parity`.

**Verdict: do not implement as written.** The plan's factual research is sound — every version
number, the `onClose` decline behavior, and the import-graph cleanliness were independently
re-verified and hold. What does not hold is **U5, the unit the plan itself calls the one that
matters**: its central assertion could never have caught the bug it exists to prevent, and it has
no seam in this repo to be written against. Fix U5 and U3 before writing code.

---

## Applied already (`safe_auto`, 4 corrections)

All four were factually wrong as written and were verified directly against the code before applying.

| Fix | Was | Now |
|---|---|---|
| KTD2 constant count | "the four `*_DISCLOSURE` / `*_TITLE` constants" | **six** — verified at `settings.ts:294/295, 298/299, 302/303` |
| KTD2 sheet count | "the three other sheets (Ask privacy, vault write)" | **two** — the parenthetical already named only two |
| KTD2 comment citation | `settings.ts:290` | **`settings.ts:292`**, where "each sheet writes exactly its own field" actually appears |
| Home modal citation | `atomsHomeView.ts:2638` | **`:2640`** — 2638 is the previous method's closing brace |

Also folded into the same KTD2 sentence: `ConsentVerdict` (`settings.ts:2159`) must travel with the
modal, and the six constants must move **together** — moving four would strand the vault-write pair
in `settings.ts` while the modal all three sheets render through moves out, recreating exactly the
cross-file coupling KTD2 exists to remove. And the conflict-range claim ("Nothing above 295 or below
574 is touched by either") was contradicted by the plan's own hunk table, which lists #322 touching
lines 31 and 60; rewritten to a claim the table actually supports.

---

## P1 — resolve before implementation

### 1. U5's write-key assertion is vacuous — it could never have caught #315
*feasibility · confidence 100 · `gated_auto`*

Both surfaces **already write the same ack key on master**. The drift #315 describes was in *wording*,
not in which key got written, so "both paths write the same key" would have passed green throughout
the entire bug. Only the disclosure-identity half of U5 is a real guard.

Worse, the assertion is not even accurate. `enableAutomaticFiling()` (`autorun.ts:111-116`, verified)
writes **two** keys — `LS_AUTO_RUN_EGRESS_ACK` *and* `LS_AUTO_RUN_ENABLED` — while the settings
egress sheet writes only the ack. So "home accept writes the same key settings writes" either passes
trivially or fails on the extra write, depending on how the implementer reads it.

**Fix:** restate U5 and the Test plan as — home accept writes the egress ack *and* the auto-run-enabled
flag, settings' sheet writes only the ack, home decline writes neither, and the drift guard is that
the home sheet's rendered disclosure **is** `EGRESS_DISCLOSURE` itself rather than an equal-looking
literal.

### 2. U5 has no test seam in this repo
*feasibility · confidence 100 · `gated_auto`*

As written U5 is not buildable. No test imports `src/home/atomsHomeView.ts` (every home test targets
the pure `atomsHomeData.ts`), `confirmEnableAutomaticFiling()` is a private method on a 2671-line
`ItemView`, and observing what it renders would mean standing up a first-of-its-kind `AtomsHomeView`
harness with a full `AtomsPlugin` stub. Modal-level precedent exists — `captureObsidianUi` in
`test/mocks/obsidian.ts`, used by `test/plusSignInConfirmModal.test.ts` — but only for modals a test
constructs directly.

**Fix:** amend U3 to export an `egressConsentSpec(onVerdict)` factory from `src/settings/consent.ts`
that both call sites build their `ConsentSheetModal` from; U5 then asserts both sites go through the
factory and that a modal opened from it renders `EGRESS_DISCLOSURE`, using the existing
`captureObsidianUi` harness instead of a view harness.

### 3. U3 silently changes home's title and CTA — the exact failure KTD1 warns about
*feasibility (75) + design-lens (50), independent agreement · `manual`*

KTD1's whole thesis is that a naive swap loses content. It audited the **disclosure string** and
stopped there. The modal's other UI was never audited, and the swap changes it:

| | Home today (`atomsHomeView.ts:2640-2657`) | Shared `ConsentSheetModal` |
|---|---|---|
| Title | "Automatic filing" | `EGRESS_ACK_TITLE` (`settings.ts:2196`, in-body `<h2>`) |
| CTA | **"Enable"** | **"I understand"** (hardcoded, `settings.ts:2219`) |
| Body prefix | none | `I understand: ${disclosure}` |

`ConsentSheetSpec` exposes only `title` / `disclosure` / `granted` / `onVerdict`, so the implementer
must either accept the copy change or widen the spec — a scope decision U3 should **make**, not
discover mid-unit, on the surface #315 says new users hit first.

**Fix:** state in U3 that home adopts the shared title and the shared "I understand" / "Cancel"
buttons unchanged, that `ConsentSheetSpec` is not widened, and that `enableAutomaticFilingFromHome()`
fires only on the `accepted` verdict.

### 4. U4 red-lines the existing suite and no unit owns the update
*feasibility · confidence 100 · `gated_auto`*

`test/settings.test.ts` hardcodes both ack titles at ~8 sites (lines 697-698, 785-786, 793-794,
822-823, 834, 860) as row names and as `press(tab, "Data egress acknowledgment", "Review")` targets.
U1's gate says "existing tests green" and the Test plan lists only *new* tests, so an implementer
reaching U4 hits a red suite with nothing telling them the breakage is expected.

**Fix:** add to U4 — update the hardcoded ack row names in `test/settings.test.ts` (the
`ASK_PRIVACY_ACK_ROW` constant plus the literal title assertions) in the same commit.

### 5. U4 never names the replacement strings — and nobody else will either
*product-lens (75) + design-lens (75), independent agreement · `gated_auto`*

The two labels are the entire user-visible deliverable of #314, and as scoped **no one ever reviews
them**: the plan gives a direction ("plain first-person voice") but no strings, and cites #304's QA
line as grounds not to look at the screen again. That QA note scoped a **row-grammar layout** pass,
not new consent copy. So implementation authors final consent-row wording with neither a plan-time
nor a QA-time check — on a surface the plan's own lane rationale says auto-escalates *because* it is
a consent surface.

Design-lens adds a constraint the plan doesn't state: each title renders in **two** places at once —
the Settings row name (`settings.ts:1684`) and the modal heading (`settings.ts:2196`) — so the text
has to work as both a scannable list row and a heading.

**Fix:** write the two literal replacement strings into KTD3 so this review round covers them, and
add one line clarifying that #304's "do not re-review the screen" scoped layout, not new consent copy.

### 6. Acks already on disk keep recording consent to wording nobody saw
*product-lens · confidence 75 · `gated_auto`*

The harm #315 names **survives the fix** for the users who already have it. Any device that accepted
through the home modal keeps the boolean set, and Settings goes on showing an acknowledged row for
wording that user never saw. Then U2 rewrites the disclosure, which re-creates the same mismatch for
everyone who acknowledged in *Settings*. The plan fixes the wording half and leaves the
consent-record half unaddressed — it scopes out `readEgressPermitted` but never decides the fate of
existing acks.

The codebase already carries the resolution: `writeShortcutAck` version-stamps its acknowledgment and
there is a generic `readAckVersion` helper (**`src/settings/captureShortcut.ts:141`** — note the
reviewer cited `src/platform/`, which is the wrong path; the precedent itself is real and verified),
while `writeEgressAck` (`autorun.ts:85-90`) stores a bare boolean, making staleness undetectable.

**Fix:** add a KTD deciding this — version-stamp the egress ack, treat a missing or older stamp as
unacknowledged so the next automatic-filing attempt re-prompts once with the union text, and record
the one-time re-prompt as expected release behavior.

### 7. KTD1 optimizes completeness over consent comprehension
*product-lens · confidence 75 · `manual`*

KTD1's only stated acceptance bar is "nothing dropped", so neither U2's implementer nor its reviewer
has grounds to reject a 90-word run-on sentence. Two of the four clauses are *reassurances* (today is
never touched, stays on this device) that soften the risk the sheet exists to convey. The existing
`ASK_PRIVACY_DISCLOSURE` (`settings.ts:299`) already solved this exact shape — six clauses as an
explicit numbered list rather than one sentence.

**Fix:** give U2 an acceptance bar — discrete numbered clauses following the `ASK_PRIVACY_DISCLOSURE`
pattern, the two risk clauses ahead of the two scope-limit clauses, with the drafted text written
into the plan so this round covers the words.

**Related, from feasibility's residual risks and worth folding into U2:** `ConsentSheetModal` renders
the body as `I understand: ${disclosure}`, so the union must be authored in **first person**. Home's
current literal is second person ("When you open Obsidian…") — concatenating the two strings rather
than rewriting produces a mixed-voice sentence.

---

## P2

- **The `DIRECT_SETTING_BUDGET` ratchet buys back a free slot.** *(feasibility, 100)*
  `test/settingsRows.test.ts:784` guards `settings.ts` at 6 direct `new Setting()` sites, and the
  file sits at exactly 6 today — one of which is `ConsentSheetModal`'s at `settings.ts:2205`. Moving
  it out drops the file to 5 while the budget stays 6. The guard stays green, so nothing signals it;
  the ratchet's own comment records this happening once before. **Add to U1: lower it to 5.**

---

## FYI (advisory, no decision needed)

- **U2 and U4 are string-only edits with no hard dependency on U1's extraction** *(product-lens, 50)* —
  so they could land and ship first if the post-#330 rebase delays U1. Worth noting given the plan's
  stated urgency that #315 gets worse with every install.

---

## Deferred questions raised

1. Does the **settings review/withdraw sheet** (`settings.ts:1690`) want the full unioned disclosure,
   or only the enable-time sheet? Both share `EGRESS_DISCLOSURE`, so U2 changes the withdrawal
   surface's copy too — unstated in the plan.
2. Once home's modal becomes a `ConsentSheetModal`, should its confirm button read as consent
   ("I understand") or as feature-enable ("Enable")? The two framings imply different things about
   what the press authorizes.
3. Do the new U4 labels need a matching update to the row-name inventory in
   `docs/qa/2026-08-05-feat-settings-row-grammar-world-class-qa.md`?
4. `EGRESS_ACK_TITLE` is interpolated into an in-flight action id at `settings.ts:1683`
   (`ack:review:${EGRESS_ACK_TITLE}`). U4's rename changes that id. Nothing outside `settings.ts`
   reads it, so it looks harmless — worth a glance during U4.

---

## Verified and NOT flagged (the plan got these right)

- `ConsentSheetModal.onClose` (`settings.ts:2225-2229`) calls `answer("declined")` behind an
  `answered` guard — U3's premise holds; Escape / click-outside / accepted-close all resolve correctly.
- **Every version fact in KTD2 is exactly right.** `origin/master` at `19bc489`, manifest `0.6.79`,
  `versions.json` carrying `0.6.77` / `0.6.78-beta.1` / `0.6.79` with no stable `0.6.78`.
- **U1's import graph is clean.** The consent block depends only on `Modal`/`Setting` from obsidian
  and `markDestructive` from a sibling module — not on `settings.ts`. No file outside `settings.ts`
  imports `ConsentSheetModal` / `ConsentSheetSpec` / `ConsentVerdict` today, so `atomsHomeView.ts`
  importing the new module creates no cycle.
- **Mobile overflow on the longer disclosure is not a new risk.** The union renders through the same
  single-`<p>` mechanism that already carries the six-clause `ASK_PRIVACY_DISCLOSURE` without
  reported issues — a pre-existing property of the shared component, not something this plan introduces.

One caveat on KTD2's conflict analysis: #322's hunk positions are **branch-side** line numbers
measured against a merge-base predating #304, so they are not directly comparable to master's. The
no-conflict conclusion still looks right, but the adjacency the plan flags near line 301 lands in the
disclosure-constant neighborhood on the branch side.

---

## Coverage

| Reviewer | Result |
|---|---|
| coherence | 3 findings (1 P1, 1 P2, 1 P3-FYI) |
| feasibility | 6 findings (4 P1, 2 P2) — 4 at confidence 100 |
| product-lens | 4 findings (3 P1, 1 P2-FYI) |
| design-lens | 2 findings (1 P1, 1 P2) |
| **cross-model product-lens (grok-4.5)** | **degraded — no usable coverage** |
| **cross-model whole-doc (grok-4.5)** | **degraded — no usable coverage** |

**Cross-model pass failed silently and its corroboration is lost.** Both legs returned well-formed,
`independence_verified: true` artifacts with **zero findings** — but the `whole-doc` leg reported why:
its prompt was truncated mid-contract, the full prompt had been offloaded to a file, and the grok
sandbox denies read tools, so it never saw the document. In its own words, it *"cannot claim
whole-document coverage."* The `product-lens` leg returned empty with no residual risks at all, which
on the same route reads as the same failure, silently. The cause is deterministic, not flaky, so a
same-route retry was not attempted (one-strike rule). **Do not read the empty grok returns as
agreement or as a clean bill of health.**

**Lenses not run:** `security-lens` and `adversarial`, both of which this skill's own signals would
have activated on a consent / access-control surface (`security-lens` on the data-handling and
trust-boundary signals; `adversarial` on the high-stakes-privacy-domain and no-upstream-provenance
triggers). They were scoped out by the invocation's explicit lens list. Given finding #6 — the
consent-record half of #315 surviving the fix — an adversarial pass is the one most likely to have
found more. Worth considering before this ships.
