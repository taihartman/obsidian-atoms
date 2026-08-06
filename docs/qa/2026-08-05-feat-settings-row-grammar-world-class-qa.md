# World-class QA — `feat/settings-row-grammar` (#304)

**Date:** 2026-08-05 · **Branch:** `feat/settings-row-grammar` · **Build under test:** Atoms **v0.6.79**
**Vault:** `test_vault/test vault` (throwaway). Remote Vault never touched.

## Verdict

**Ready with fixes — all fixes applied and re-verified.**

The pass began as **Not ready**: the constructive half found a P0 renderer freeze, and the adversarial
half then proved five more holes including a money bug. Every one is fixed, each with a regression
test that was observed red first. Final state: **1140 tests passing across 68 files**, `npm run build`
clean, live repros re-driven clean.

Two things stay open and are recorded honestly below: the **signed-in Plus screens were never
reachable** in the throwaway vault, and a **cross-device consent divergence** is suspected but
unproven.

## Charter

The settings screen was restructured onto a five-kind row grammar (setting · destination · action ·
destructive · status), three row clusters moved behind sub-screen destinations, three permanent
consent-acknowledgment rows became consent sheets shown at enable time, and three persisted settings
were deleted. 48 rows → 15.

**Proof kind:** `user-loop` for every consent and vocabulary story — acknowledgments were granted,
withdrawn, and re-granted through the real UI, and tags were activated and added by typing into the
real field. No hub, graph, or acknowledgment was pre-planted to force a green frame. The one
`fixture-plumbing` story is US-6 (pipeline regression), which is explicitly a plumbing check.

## Preflight

| Check | Result |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Authority paths | ✅ `docs/plans/2026-08-05-003-feat-settings-row-grammar-plan.md` (+ its 2026-08-05 amendment), R1–R11, KTD1–KTD8 |
| Navigation map | 🔧 **healed** — it described the flat pre-restructure screen; rewritten for the four destinations, and its KNOWN DEFECT re-verified live and marked resolved |
| Dev/run command | ✅ `./scripts/install-to-vault.sh "<throwaway vault>"` |
| Viewport/device | ✅ Obsidian 1.13.4 desktop, installer 1.12.7 |
| Auth path | ⚠️ **no Atoms Plus session available** — signed-out only |
| Fixtures | ✅ vault's own 13-tag vocabulary reused; seeded tag floods removed afterwards |
| Automation | ✅ Obsidian CLI + `dev:screenshot` + CDP; vitest |
| Deploy reality | N/A — client plugin, no deploy component |

## Authority & promises

| Surface | Promise | Acceptance | Story |
|---|---|---|---|
| Main screen | R1, plan §Resulting main screen (as amended) | 15 rows signed in / 12 signed out, each declaring one kind | US-1 |
| Four destinations | KTD2, R3, R4 | `containerEl` re-render + back row; reopening lands on main | US-2 |
| Advanced | R5 | Exactly two rows, none moving a money/egress/vault-write gate | US-2 |
| Consent toggles | KTD4, KTD7, R6, R7 | Only an explicit accept writes an ack; three acks stay independent | US-3 |
| Review row | KTD4 | Every granted ack is withdrawable, cascading downstream | US-4 |
| Tag vocabulary | R4 | One main row, `N` matching the destination's Active count | US-5 |

**Amendment applied:** the plan's original 14/11 figures were superseded on 2026-08-05 when the
device-local key rows moved to the main screen — they are a credential path enabling Anthropic spend,
which R5 keeps off Advanced.

## User stories

| Story | Status | Evidence |
|---|---|---|
| **US-1** Main screen row count and grammar | **Passed** | 12 rows measured **signed out, no acks, key-fallback off**. `08-main-clean-signed-out-12-rows.png` |
| **US-2** Destinations round-trip | **Passed (3 of 4)** | Account, Tag vocabulary, Advanced open with back row first and return. Advanced holds exactly 2 rows. Reopening Settings lands on main. **Connect not reachable — needs a Plus session.** `06`, `07`, `09` |
| **US-3** Consent sheet, all four exits | **Passed** | Accept → ON + Review row. Decline, **Escape**, **click-outside** → OFF, nothing written. `04`, `05` |
| **US-4** Withdraw | **Passed** | Egress withdraw cleared the ack, forced auto-run off, cleared the notice ack. Ask-privacy withdraw cascaded to `askWriteAckAt` and `askEnabled`. `03` |
| **US-5** Tag vocabulary | **Passed after fix** | Initially **Failed** — Activate hung the app (F1). Fixed; count tracked 13 → 32 exactly. `09` |
| **US-6** Capture pipeline regression | **Passed** | `atoms:list-unprocessed-captures` → 39 captures across 23 days. Presentation-only change confirmed. |

**Row-count formula discovered live:** `12 + (acks on record)` signed out. Each granted acknowledgment
adds its own Review row, which the plan's table never covered — it counts the no-consent baseline.

## Findings — all fixed

| # | Sev | Finding | Fix |
|---|---|---|---|
| **F1** | **P0** | **Renderer froze at 100% CPU, force-quit only.** Every Obsidian component is a thenable (`BaseComponent.then(cb)` runs `cb(this)` and returns `this`). The in-flight guard released its button with `() => btn.setDisabled(false)`, whose implicit return is that component, so `.finally()` resolved with a thenable and the machinery re-adopted it forever. Fired on any action row returning a promise. | `67aa9c9` — release is a statement; mock gained the `then()` it lacked, which is why 1091 tests stayed green over an app-freezing bug |
| **F2** | **P1** | **Money bug.** The in-flight guard was per-button-instance; a re-render minted a fresh enabled one. This branch made bypassing it one click (press → back → re-enter → press). *Get more filings* → two Stripe Checkout Sessions, no idempotency key → **pay twice**. Also two sign-in emails, two pairing secrets. | `693233f` — guard moved to a tab-level registry keyed by action identity |
| **F3** | **P1** | `Found in your vault` sliced to 30 rows **before** filtering active tags, so 30 active tags emptied the list while claiming every tag was already active. Default vocabulary is 13 and grows one tap at a time. | `693233f` — filter, then slice |
| **F4** | **P1** | Empty-state guard tested `ranked.length` but rows were filtered later, so an all-active vault showed a heading over nothing. | earlier commit — gates on what actually renders, and distinguishes the two real empty states |
| **F5** | **P2** | Auto-run toggle trusted a render-time snapshot of the egress ack where its Ask twin read live — the forgot-the-twin asymmetry this work exists to remove. | `693233f` |
| **F6** | **P2** | `openRoute` left an open consent sheet alive; `hide()` settles it. | `693233f` |
| **F7** | **P2** | *Add to Active* silently swallowed unusable input and accepted a 300-character tag into the **classify prompt**. | `693233f` — 48-char cap, charset gate, Notice on refusal |
| **F8** | **P2** | iCloud shortcut link input clipped to 54px, placeholder rendering as "Usi". | earlier commit — name column yields to the field |
| **F9** | **P3** | Status facts rendered as loose paragraphs; the secret-id tip split the API key row from its toggle. | earlier commit |

## Craft read

**No cramped, clipped, or colliding pairs** after F8. Vertical rhythm measured and consistent: 24px
above headings, 16px heading→first child, 8px between sibling rows, 13px around paragraphs. Smallest
row 60px, most 89–105px — all above the 44pt floor.

Two honest notes: interleaved prose loosens the 8px sibling rhythm to 13/13, and in the Account
destination three field+button pairs render as six rows because the grammar allows one right edge
each — correct by rule, but the button no longer visually belongs to the field above it.

## Adversarial pass

Fourteen scenarios, weighted to destructive and re-entry. Ledger folded in so it compounds:

| Scenario | Verdict |
|---|---|
| Grant → withdraw → grant → withdraw (all three acks) | solid — cycle 2 byte-identical |
| Re-open Review and accept whatever it offers | solid — re-grant structurally impossible |
| Consent toggle on→off→on without the sheet settling | solid |
| Sheet open → destination → back → close Settings | **holed** (F6) |
| Dismiss sheet A, immediately open sheet B | solid — verdict closures are per-sheet |
| Async action + route change mid-flight | **holed** (F2) |
| Three messy actions in ~2s | solid |
| Zero tags / 50+ tags | **holed** (F3) |
| Emoji / 300-char / normalizes-to-empty tag | **holed** (F7) |
| Withdraw an ack while its feature is off, and on | solid |
| Main row count vs destination's real Active count | solid |
| Clear the ack storage key under a Review row | solid — the row vanishes; never claims a consent that is gone |
| Accept a consent sheet offline | solid — ack written (consent ≠ connectivity), no egress follows |
| API key row offline verdict, then reopen | solid — honest "could not reach", re-asks next visit |

**The four cardinal consent invariants held under all of it.** No ack could be written without an
explicit accept; no sheet could write another's ack; no ack could be re-granted from a Review
surface; no ack could be stranded unwithdrawable, including after sign-out and across two full
grant/withdraw cycles.

## Outcome check

The four failure modes the project exists to fix, re-posed against the shipped screen:

1. **Too many?** **No.** 12 rows fits about a screen and a half; master measured 40 in the same state.
2. **Can you tell which ones matter?** **Yes** — the mechanism does the work. After three screens you
   stop reading right edges to know what a row will do, which is the entire point.
3. **Jargon?** **Mostly fixed, two holdouts.** "File automatically when Obsidian opens", "Sync when
   you return to Obsidian", "List atoms in person notes" are real improvements. But **"Data egress
   acknowledgment"** and **"Ask privacy acknowledgment"** remain the most jargon-heavy strings on the
   screen and carry the most consequence. The sheet bodies underneath are plain first-person and
   good; the row labels have not caught up.
4. **Scared to change them?** **No longer** — the consent sheets are why. Deliberate attempts to
   provoke an accidental grant all failed, and every ack has a visible Withdraw that cascades. That
   converts "scared to change them" into "you can undo this."

**Verdict for the deferred copy pass (#314): still needed, but narrow.** Do not re-review the screen —
rewrite the two acknowledgment row labels to match the voice already used inside their own sheets.

## Not tested

- **Connect Claude or ChatGPT destination** — requires a Plus session. Not reachable in the throwaway
  vault; no pass claimed.
- **Signed-in Plus row count (15)** — same reason. Only the signed-out 12 is measured live.
- **Account async rows driven live** — *Start free trial*, *Send sign-in link*, *Save session* send
  real email and hit billing. Covered by the primitive-level regression test, which is where F2
  actually lived.
- **Escape / click-outside** were driven through Obsidian's real keymap and modal-bg handlers via
  synthetic DOM events, not physical keystrokes. The modal closing proves the real handler ran; one
  manual confirmation before release is still worth it.
- **Cross-device consent divergence — suspected, unproven.** The Ask acks live in `data.json`, which
  Obsidian Sync replicates, while `plugin.settings` is read once at load. Withdrawing on a phone
  while the desktop is open may leave the desktop rendering the ack row and `askMirrorPermitted()`
  returning true against a consent that is gone on disk — i.e. still pushing bodies. No two-device
  rig was built. **This is the highest-value open risk in this report.**

## Merge decision

**Ready.** Every proven hole is fixed with a regression test that failed first. The residual risks are
the signed-in surfaces (untestable without credentials) and the suspected cross-device divergence,
both recorded above rather than implied covered.
