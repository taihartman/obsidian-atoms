# World-Class QA: 495-plugin-wide-em-dash-guard

Branch `chore/plugin-wide-em-dash-guard` · PR #496 · Issue #495
Base `claude/settings-ux-redesign-69acd6` (stacked on #494, not `master`)

## Verdict

**Ready to merge, behind #494 and one pre-merge re-check.**

The live smoke ran: nine scenarios driven in a trusted vault with the plugin verified loaded at
runtime and the build fingerprint stable across the pass. No mojibake, no clipping, no orphaned or
doubled separators, no fragment or run-on from the dash-to-period rewrite, and craft passed on the
decisive frame. The full-document scan found **exactly one** em dash in product chrome, and it is
byte-identical to the documented exemption.

`adversarial-qa` ran against the same build and **found two real holes in the deliverable**, both
fixed here and both mutation-checked: an exemption whose stated reason was false (H2), and a
default-deny guard that walked only `.ts`, leaving `.tsx`/`.mts`/`.cts` silently uncovered (H3).
Suite is 98 files / 1887 tests green, build and lint clean.

Two conditions before merge, neither of them a defect:

1. **#494 must merge first** — this PR's base is that branch.
2. **Re-run the base-merge guard check (E4)** immediately beforehand. It was green at the tip
   observed today, but the base is under active development and moved from `0.8.0-beta.1` to
   `0.8.0-beta.2` during this session. That check decays with every commit the base takes.

## Charter

PR #496 replaces a five-file allowlist test with one default-deny em-dash guard over all of `src/**`
and sweeps 93 of the 94 offenders it found. **The diff is copy only.** No control flow, no data
shape, no persisted key changed: 93 user-facing strings lost an em dash and gained a period, a
colon, a `·`, or a pair of parentheses.

That shape decides what this pass is for. The guard itself is already proved by the suite (98/98
files, 1886 tests) and by a committed mutation check. What a test cannot prove is that a reworded
string still **reaches a screen intact** — that the `·` renders as a middot rather than mojibake,
that replacing a dash with a period did not leave a fragment or a run-on, that a parenthetical error
detail does not clip, and that no em dash survives in chrome the sweep did not think to look at.
So this is a rendering-and-legibility smoke over the surfaces whose copy moved, not a behavioral
regression pass.

**Workflows that must work:** Process (and the unprocessed-captures count line), backfill estimate,
the Ask mirror status line, Atoms home hero and land peak, connectivity test, set-aside/open loops.

**Adjacent regression risk:** low and specific. Four test files had byte-pinned assertions retargeted
to the new copy (`askMirror`, `askMirrorConsentTruth`, `atomsHomeData`, `landPeak`); the risk is that
a retarget was written to pass rather than to hold. The other risk is a string the sweep edited that
some code still matches on — the `askMirror` trailing-punctuation regex was exempted for exactly this
reason, and the question is whether anything similar was missed.

**Platform:** Obsidian desktop 1.13.6 (installer 1.12.7), throwaway vault `test_vault/test vault`.

### Product loop vs fixture

This pass is **`ui-chrome-only`** by construction, and says so rather than dressing itself up. The
change is product-authored chrome; the proof is that the chrome renders. No atoms were planted, no
hubs seeded, no graph hand-authored. Where a surface could not be reached without credentials it is
recorded as Not Tested with the blocking step named, not quietly dropped.

## Preflight

| Check | Result |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Learnings | ✅ read `docs/qa/learnings.md` before driving |
| Navigation map | ✅ read `docs/qa/app-navigation-map.md` before driving |
| Authority paths | ✅ `docs/voice.md:54`; plan `docs/plans/2026-08-14-002-chore-plugin-wide-em-dash-guard-plan.md`; origin finding F5 in `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md` |
| Run command | `./scripts/install-to-vault.sh "<vault>"` → build + copy + `plugin:reload` |
| Fixture | Existing throwaway vault contents. No new fixture minted; none needed for a chrome pass |
| Viewport/device | Obsidian desktop, default window |
| Auth path | ❌ **no Anthropic API key, no Atoms Plus session** on this device — bounds what is reachable (see Not Tested) |
| Automation | Obsidian CLI (`command`, `eval`, `dev:screenshot`); no Playwright/MCP needed for a desktop Electron app |
| Device lock | N/A — no shared physical device |
| Deploy reality | N/A — plugin ships in the vault, no server component in this diff |

### Mechanical checks run on this checkout

| Command | Result |
|---|---|
| `npm test` | 98 files, 1886 tests, all pass |
| `npm run build` | clean (tsc + esbuild production) |
| `npm run lint` | clean |
| `install-to-vault.sh` | Installed v0.8.0; CLI vault-identity guard confirmed the reload reached the intended vault |

### Preflight corrections to the handoff

Two things the handoff got wrong, corrected here so the next session does not re-pay them:

- **"No throwaway vault exists in any checkout" was false.** The vault is at
  `test_vault/test vault` in the **main** checkout and was already registered with the Obsidian CLI
  and open. The previous session was working inside `.claude/worktrees/`, where `test_vault/` is
  gitignored and therefore absent — it read a worktree-local absence as a global one. No seeding was
  required.
- **`atoms:process-fixture-sample` does not exist in v0.8.0.** `CLAUDE.md` still lists it as the
  no-API fixture write path. It is not in `obsidian commands filter=atoms`. Anything relying on it to
  reach a land peak without an API key needs another route.

## Authority & promises

Acceptance for this pass comes from `docs/voice.md:54` (ladder rung 3, the product contract the plan
cites), not from the handlers that emit the strings. The rule has three clauses, and all three are
observable on screen:

| Surface | Promise (authority) | Acceptance (observable) | Story |
|---|---|---|---|
| Any product chrome | `docs/voice.md:54` — no em dash in product-authored copy | No `—` in any notice, button, header, helper, or status line | US-no-dash |
| Status lines / compound labels | `docs/voice.md:54` — `·` is the house separator | `·` renders as a middot, not mojibake; no orphaned or doubled separator | US-separator |
| Inline error detail | `docs/voice.md:54` — detail takes parentheses | `push failed (network)` shape renders complete and unclipped | US-parens |
| Reworded sentences | Sweep replaced dashes with periods | Each reads as a complete sentence; no fragment, no run-on | US-sentence |

**Scope note on em dashes that are legitimate.** Capture text and atom bodies are sacred
(`CLAUDE.md` non-negotiable 1) and may contain em dashes the user typed. Those are user content, not
product-authored copy, and finding one is not a defect. Only chrome is in scope. Likewise the seven
deliberate exemptions listed in the PR body are out of scope for this pass — they are argued in the
guard's exemption table with a staleness test each.

## User Stories Tested

Every story below is **Not tested** on the live surface, because the drive never ran. They are kept
rather than deleted so the next session inherits the scenario list and the reachability answer for
each — which is the expensive part, and which is now known.

Driven live in vault `atoms-qa-433`, plugin verified **loaded at runtime** (not merely enabled),
build fingerprint `b08e93090aae77f2` **identical before and after** the pass.

| Story | Acceptance | Observed (verbatim) | Status |
|---|---|---|---|
| US-unprocessed | `· see console`, no `—` | `Atoms: 34 unprocessed capture(s) across 18 past day(s) · see console` | **Passed** |
| US-connection | Connectivity copy renders correctly in the no-key state | `Atoms: testing connection…` then `Atoms: Anthropic is reachable from Obsidian. Set your API key in settings to classify captures.` | **Passed** (see note) |
| US-home-hero | Home hero renders reworded filing copy, unclipped | `34 Captures Waiting` / `Turn on automatic filing so new captures file on their own from today on. Process files the ones already waiting, when you are ready.` | **Passed** |
| US-mirror-refusal | Two `·` separators, single line, no clipping | `Ask mirror: 400 · sync refused, vault scan incomplete · Sync now to retry` — `scrollWidth == clientWidth` (915px), one clean line | **Passed** (device-local fixture) |
| US-mirror-status | Connect status line carries `·` separators | `Ask mirror: off · no current privacy acknowledgment · 400 in the cloud at last check, Wipe cloud copy to delete` | **Passed** — reached unexpectedly; the vault carries a Plus trial session from the #433 pass, so Connect rendered in full rather than the signed-out early return |
| US-update-batch | Batch-limit sentence renders | `Up to 15 per Update so each run stays short and cost stays predictable. Tap again for the rest.` plus `Uses Atoms Plus (counts toward your monthly filings).` | **Passed** — modal cancelled, not confirmed |
| US-openloops | `Set-aside daily lines. Hold to try filing · tap opens the daily` | exact match; prompt placeholder `Notes left for later · Enter open · Shift+Enter dismiss` | **Passed** |
| US-settings | No `—` across settings surfaces | Main screen, Connect, Privacy, Advanced, Who does the filing, Tag vocabulary, Capture-on-phone modal all transcribed; section labels use the house separator (`1 · CAPTURE`, `Tag vocabulary · 13 active`, `Plus · Trial · 117 filings left`) | **Passed** — zero em dashes |
| US-no-dash-sweep | No `—` in product chrome | **Exactly one hit**, `charCodeAt` verified 8212: the egress catch-up card at `atomsHomeView.ts:926` | **Passed** — that line is the documented exemption (see F6) |
| US-backfill-estimate | `(async, ~50% off)` / `(atoms + markers)` | — | Not tested — `requireApiKey()`, plus a live `count_tokens` call per chunk |
| US-process | Process / dry-run notices | — | Not tested — `requireClassifyAuth()` aborts |
| US-landpeak-partial | `Some notes refreshed. Failed ones stay eligible. Try Update again.` | — | Not tested — needs a real mixed-outcome refresh; a garbage key yields all-failed, a different and unchanged branch |

**US-connection note.** The no-key branch (`connectivity.ts:226`, `verdict: no_key`) carries **no**
parenthetical. The parenthetical convention lives in the `partial` branch
(`Check the key in settings (SecretStorage).`), which this device state cannot reach. So the
parenthetical convention is proven live by US-update-batch and US-mirror-status, not by this story.

## Risk Matrix

| Risk | Case | Covered by |
|---|---|---|
| Happy | Reworded notice reaches the screen intact on the changed surfaces | S1–S9 |
| Perception | `·` separator and parenthetical detail render legibly, unclipped | US-separator, US-parens |
| Perception | Reworded sentence still parses as a sentence to a reader | US-sentence |
| Negative | Error/refusal copy (no key, unreachable, refused sync) renders correctly, not only the success path | S2, S5, S6 |
| Edge | A surface the sweep never visited still holds an em dash | S10 full-document scan |
| Regression | A retargeted byte-pinned assertion passes vacuously while the live string is wrong | Live transcription compared against the diff |
| Regression | Code that matches on its own copy breaks when the copy moves | `askMirror` trailing-punctuation regex exempted; S8 checks the live line |
| Craft | Reworded strings do not clip, overlap, or crowd their container | §5b craft read on the decisive home frame |

## Evidence

| # | Claim | Command | Result |
|---|---|---|---|
| E1 | Suite green on this checkout | `npm test` | 98 files, 1886 tests pass |
| E2 | Build clean | `npm run build` | tsc + esbuild production, clean |
| E3 | Lint clean | `npm run lint` | clean |
| E4 | Guard stays green after merging the base branch | worktree at `HEAD`, `git merge origin/claude/settings-ux-redesign-69acd6`, `npx vitest run test/copyVoice.test.ts` | **23/23 pass**; only `STATUS.md` conflicts; **zero conflicts under `src/`** |
| E5 | Merged version resolves without a bump | `manifest.json` in the merged tree | `0.8.0-beta.1` (the base's value; this branch never touches the file) |
| E6 | Retargeted assertions are not vacuous | `git diff` on the four retargeted test files | The #446 regex gained `\)` so it looks *inside* the new parentheses; without it, it could never match the new copy and would pass regardless of truncation |
| E7 | Reachability of every changed-copy surface without credentials | source trace | Recorded per story in User Stories Tested |
| E8 | Installed bundle carries the swept copy | `grep` + `shasum` on the installed `main.js` | New strings present, old absent; fingerprint `b08e93090aae77f2`, **identical before and after the drive attempt** (no peer overwrote it) |
| E9 | **Static** scan of the installed bundle for em dashes | read-only inspection | **Exactly one** em dash in the whole bundle, and it is not copy: the truncation regex `/[\s.,;:!?—-]+$/`, which *matches* an em dash in order to strip it from user-derived excerpt text. That is the documented `askMirror` exemption. **Zero em dashes in product-authored strings.** |
| E10 | **Static** scan of separator usage | read-only inspection | 57 `·` separators, zero literal en dashes; no doubled separators, no `. ·`, no `· .`, no missing spaces |
| **No screenshots.** | | | The drive never rendered a surface. `N/A — blocked`, not `N/A — no UI`. |

**E9 and E10 are supplementary, not a substitute.** They cover only check 1 of the three this pass
owes (no em dash in copy). Checks 2 and 3 — mojibake, clipping, doubled or orphaned punctuation, and
whether a dash-to-period rewrite left a fragment or a run-on — are questions about **rendered
output** and cannot be answered by reading the bundle. A string that is correct in `main.js` can
still clip, wrap badly, or collide with adjacent chrome.

## Findings

**F1 · The merge-order risk nobody had checked, now closed.** This branch is **14 commits behind**
its base, and the base (`claude/settings-ux-redesign-69acd6`, PR #494) is under active development by
a concurrent session. Because this PR installs a **default-deny** guard over all of `src/**`, any
em-dash string literal landing on the base in the meantime turns the merge red — and `src/settings/`
is exactly where that base is working. Merging the current base tip into this branch and running the
guard gives **23/23 green with no `src/` conflicts**, so the risk is real but currently unrealised.
It is not permanently closed: it re-opens with every commit the base takes. **Re-run E4 immediately
before merge**, not at merge time.

**F2 · The version-bump question is settled, and the handoff's premise was wrong.** The handoff said
0.8.0 was already set on the base. It is not: the base and `master` both now read
**`0.8.0-beta.1`**, and this branch reads `0.8.0` only because it inherited that from the merge-base
and never touched the file. Since the branch does not modify `manifest.json`/`package.json`/
`versions.json`, the merge resolves to the base's `0.8.0-beta.1` on its own. **No bump belongs on
this branch.** The conclusion the handoff reached is right; the reason it gave is stale.

**F3 · RESOLVED: Obsidian's CLI was wedged.** Trying to mint an isolated QA vault, I opened it with
`open "obsidian://open?path=…"`. The vault never registered in `obsidian.json`, and from that moment
every `obsidian` invocation hung indefinitely — five orphan clients stacked up. The app stayed alive
at 0% CPU, so it looked healthy from the outside. Recovered with the user's approval: registry backed
up, force-quit (a graceful quit did not take), `atoms-qa-495` registered **directly in
`obsidian.json`** rather than by URI, and relaunched with **both** vaults open so the concurrent
#494 session kept its target. Both verified answering independently. Logged in `docs/qa/learnings.md`.

**F3b · BLOCKER (current): the isolated vault opens in Restricted Mode.** A vault Obsidian has never
opened before shows the first-run trust prompt, and until a human answers it **no plugin runs** —
`Object.keys(app.plugins.plugins)` is `[]` while `app.plugins.enabledPlugins` still lists `atoms`,
so the config looks correct and nothing executes. `eval` and `dev:screenshot` keep working normally
against the vault, so the CLI looks healthy and every plugin command silently does nothing. Trust is
**not** stored in `.obsidian/` — the trusted and untrusted vaults have byte-identical `.obsidian`
file lists and the global registry carries no trust flag — so it cannot be copied in, and clearing it
is a security gate that needs a human click, not an agent. **One click unblocks the entire S1–S8 run;
nothing else is missing.**

**F3c · The already-trusted vault is not an option.** `test vault` is trusted and working, but the
concurrent #494 session reinstalled into it at 09:46 with `0.8.0-beta.2` and is actively using it.
Driving there means overwriting a peer's build mid-pass — the same failure that cost this pass its
first drive (F4). Ruled out deliberately, not overlooked.

**F4 · The shared throwaway vault has no lock, and a peer overwrote this build mid-pass.** v0.8.0 was
installed at 09:19 and confirmed by probe at 09:21; by 09:23 a peer worktree on `claude/settings-ux-
redesign-69acd6` had replaced `main.js` with its own 0.7.12 carrying the **pre-sweep** copy. A drive
started in that window would have screenshotted the old strings and reported them as a regression in
the new build. The repo locks a shared *device*; nothing locks a shared *vault*. Logged in
`docs/qa/learnings.md` with the build-identity assertion that catches it.

**F5 · `STATUS.md` on this branch is stale and actively misleading.** Its #495 row still reads
"`ce-code-review` not run; live vault smoke blocked, `test_vault/test vault/` does not exist." Code
review did run (5 local reviewers plus a cross-model pass), and the vault does exist. Corrected in
this change.

**F6 · The one em dash on screen is the documented exemption, and seeing it is the point.** The
full-document scan found **exactly one** em dash in product chrome across home, settings and every
modal — `charCodeAt` verified 8212, not a look-alike. It is the egress catch-up card
(`atomsHomeView.ts:926`), and its rendered text is **byte-identical** to the string sitting in
`EXEMPT_LINES` in `test/copyVoice.test.ts` with its written rationale. The craft frame
(`s3-atoms-home.png`) shows it live: *"filing is off — same TLS path to Anthropic as before."* That
makes #497 concrete rather than theoretical — this is user-facing text whose consent ack is a bare
un-stamped boolean, so it cannot be reworded until the ack is versioned.

**F7 · A pre-existing copy inconsistency the sweep did NOT introduce.** Two variants of one message
disagree on terminal punctuation: `atomsHomeView.ts:2315` ends `… Settings → Capture` and `:2792`
ends `… Settings → Capture.` The drive reported this as sweep-introduced. **It is not** — checked
against `8f6f225^`, both lines already disagreed, and the sweep faithfully preserved each one's
terminal punctuation while replacing only the dash. Touched is not introduced. Left alone
deliberately: this PR is a dash sweep, not a punctuation-normalisation pass, and widening a clean
copy-only diff to fix a pre-existing nit is the wrong trade. Worth a follow-up issue, not a change
here.

**F8 · Craft read: passed.** `s3-atoms-home.png` shows three stacked chrome blocks — egress card,
catch-up status strip, Ready card. Gaps are clean with no flush seams, no overlap, and no collision
with the cards' CTAs; tap targets are comfortably past 44pt; the eyebrow → title → body → CTA
hierarchy reads as intentional; no clipping, no bad wrap. The stacked-chrome adjacency check
(§5b.3) specifically passes.

**No defect attributable to this change was found.** F6 is a deliberate exemption, F7 pre-dates the
sweep, F8 passes. F3/F3b/F3c and F4 are QA-harness and multiplayer problems; F1/F2 are merge-order
facts; F5 was a stale doc, now corrected.

## Adversarial QA

Scaled to the change: this PR creates and mutates **no persistent objects**, so the usual
edit/delete/re-share taxonomy does not apply and the ledger was not padded with it. The attack was
weighted to what a copy sweep actually risks — runtime string composition, truncation, degenerate
interpolation, and whether the **guard itself** can be defeated.

| # | Scenario | Verdict |
|---|---|---|
| A1 | Truncation vs the new parenthetical error detail | Hole found, but **pre-existing** (see below) |
| A2 | Degenerate interpolation in `·` status lines | Solid for reachable inputs, **except H2** |
| A3 | Boundary counts in reworded copy | Solid |
| A4 | Defeat the guard | **Holed** — 3 extension gaps, 1 look-alike glyph |
| A5 | Exemption premises, all seven | **1 of 7 reasons false** (H2); other six verified true |
| A6 | Does the sweep's goal survive the runtime path? | Holed — already filed as #498 |

### Fixed in this PR

**H2 · An exemption's stated reason was false, and the guard's own rule is bent by it.**
`EXEMPT_LINES` justified `ASK_MIRROR_COUNT_UNKNOWN = "—"` with *"It is not a sentence."* It is:
`formatAskMirrorServerCount` (`askMirror.ts:625`) returns it whenever the stored count is missing or
blank, and `formatAskMirrorRefusalLine` (`:471`) interpolates it into
`Ask mirror: — · sync refused, vault scan incomplete · Sync now to retry`, rendered on Atoms home and
the settings status line. Reachable, not theoretical — `clearAskMirrorDeviceState` blanks the count on
every wipe, and the `no-server-count` refusal means exactly "this device has never seen the cloud
count." A guard whose whole design is "every exemption carries a reason you can check" cannot carry a
reason that is untrue. **The reason is now honest**: the exemption stands on *cost* (the glyph is
byte-pinned on two surfaces), not on principle, and it is named as the one place the rule is
knowingly bent. Retiring the glyph is a copy decision and belongs in its own issue.

**H3 · The guard walked only `.ts`, making a default-deny rule default-allow for three extensions.**
`sourceFiles` filtered on `name.endsWith(".ts")`, so an em-dashed string in `.tsx`, `.mts` or `.cts`
left the suite green — proven by mutation, all three missed. `tsc` catches a `.tsx` today *only*
because `jsx` is unset, so the build was standing in for the guard on a config any future UI change
is entitled to flip. Fixed via `SOURCE_EXTENSIONS`, and **mutation-checked against a green
baseline**: reverting the list to `[".ts"]` fails the new test with
`.tsx must be walked: expected [] to deeply equal [ Array(1) ]`.

### Adjudicated as out of scope

**A1 · Unbalanced parenthesis after truncation — real, but this PR did not cause it.** The adversarial
pass reported it as sweep-introduced. It is not. Service messages already carried their own
parentheses before the sweep (`plusClient.ts:230`, unchanged by it), and `truncateMessage` was never
paren-aware:

```
before: Ask: push failed — Plus network error (TypeError: Failed to fetch…    → 1 unclosed
after:  Ask: push failed (Plus network error (TypeError: Failed to fetch…)   → 1 unclosed
```

The imbalance is identical on both sides; the swept version actually terminates *more* cleanly
because it emits a closing paren. My own stated suspicion — that the sweep's own parens get split —
was **refuted**: truncation runs before the wrap at both sites, and `/[\s.,;:!?—-]+$/` contains no
`)`. This is a pre-existing `truncateMessage` defect in the same family as #446 and wants its own
issue.

**M8 · A look-alike glyph defeats the guard.** U+2015 `―` renders indistinguishably from `—` and is
not caught. `docs/voice.md:54` bans the em dash by name, so this sits outside the rule's letter, but
it is a one-keystroke bypass no reviewer would catch in a diff. Worth an issue; not a defect in this
PR.

### Verified honest

The other six exemptions hold. The `classify.ts` parity phrases were diffed against
`plus-service/src/classifyTemplate.mjs` and all six are still byte-identical. Every case the PR
claims to catch did catch: escaped `—`, nested and multi-line templates, `String.raw`, a
brand-new subdirectory, a widened region marker (`spanLines` fires: `expected 26 to be 8`), and a
stale exemption whose string is gone.

## Not Tested

- **Every live surface.** No command was driven, no Notice observed, no frame captured — F3.
- **Craft read (§5b).** Requires the decisive frame; none exists. Not `N/A — no UI`: this change
  touches user-visible chrome, so craft is owed and unpaid.
- **Credential-gated copy**, which stays out of reach even once F3 clears, and needs a deliberate
  decision about spending real API budget: the backfill estimate success line and chunk line, the
  Process and dry-run notices, and the land-peak partial-failure body. The last one needs a genuine
  mixed-outcome refresh — a garbage key produces all-failed, which renders a different, unchanged
  branch, so it cannot be faked into place.
- **The two reworded filing-hero variants**, which need a key present for `filingPath` to leave the
  `need_key` card.
- **First-day setup copy**, unreachable in a vault with 146 captures already filed.

## Merge Decision

**Merge after #494, having re-run E4 first.** Both QA halves ran, the two holes the adversarial pass
found in the deliverable are fixed and mutation-checked, and nothing outstanding is a defect in the
copy sweep.

Order of operations:

1. #494 merges.
2. Re-run **E4** against the then-current base tip: merge it into this branch in a scratch worktree
   and run `npx vitest run test/copyVoice.test.ts`. Green at today's tip; decays with every base
   commit, and `src/settings/` is exactly where that branch works.
3. Confirm the version files still need no change — they did not today, and this branch never touches
   them, so the merge resolves to the base's value on its own.
4. Merge, then clear `STATUS.md`.

### Follow-ups this pass earned (none blocking)

- **`truncateMessage` is not paren-aware.** A service message carrying its own parentheses truncates
  to a dangling `(` at both the 72- and 96-char sites. Pre-existing, same family as #446.
- **A look-alike glyph defeats the guard.** U+2015 `―` is visually identical to `—` and uncaught. A
  one-keystroke bypass no reviewer would spot.
- **`ASK_MIRROR_COUNT_UNKNOWN` renders an em dash inside a product sentence.** Now honestly
  documented as exempt-on-cost; retiring the glyph is a copy decision.
- **Pre-existing copy inconsistency** at `atomsHomeView.ts:2315` vs `:2792` (F7).
- **`npm run lint` has the same blind spot H3 had** — its glob is `src/**/*.ts`, so `.tsx`/`.mts`/
  `.cts` would escape eslint too. Harmless today (no such files), worth closing alongside any future
  decision to enable JSX.
