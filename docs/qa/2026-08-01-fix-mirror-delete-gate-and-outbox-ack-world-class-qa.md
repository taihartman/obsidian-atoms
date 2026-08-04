# World-Class QA: fix-mirror-delete-gate-and-outbox-ack

PR [#226](https://github.com/taihartman/obsidian-atoms/pull/226) · Issue [#225](https://github.com/taihartman/obsidian-atoms/issues/225) · branch `fix/mirror-delete-gate-and-outbox-ack` @ `dcd7c87` · v0.6.60

## Verdict

**Not ready — two P0 data-loss holes proven live, both in the guard this PR exists to add.**

> **Superseded 2026-08-02 by the re-run below.** H1, H2 and F2 are fixed at `732ca20`, the parked
> repro is landed in `test/`, and adversarial classes C and D were re-run green — H2 live against
> the shipped bundle. The desktop verdict is now **ready**; the two device boxes stay human-only.
> The original verdict is kept verbatim, because a QA report that quietly rewrites its own history
> stops being evidence. See [§ Re-run 2026-08-02](#re-run-2026-08-02).

The four desktop stories the PR test plan asks for all **passed**, with authoritative evidence:
the headline 3-of-491 delta issued **zero** deletes. But the required adversarial pass then broke
the same guard two other ways, and in both repros the cloud mirror lost 400 rows for real. One
of the two (**H2**) is a regression this PR introduces.

The constructive claims are true. The guard is not yet safe to ship.

## Charter

Phase A of the resume catch-up plan: three data-loss paths, split ahead of the feature (plan Q3),
all live on `master` today. This pass had to prove the six unchecked boxes in the PR test plan —
CLI smoke, the 3-of-400 delta refusal, the refusal reaching both surfaces, the Sync-now
confirmation valve, the Ask-disabled default install, and iOS/Android device passes.

Adjacent regression risk: Ask mirror sync, the capture-inbox drain, and the outbox ack path.

**Product loop vs fixture:** this is a **plumbing / data-safety** guard, not a product-magic
claim. Atom seeding is labelled `fixture-plumbing` throughout and no story here claims day-one
product proof. Per `docs/qa/README.md` § Product dogfood honesty, that labelling is the
requirement — the anti-seed rule targets planted hubs used to force a green *product* screenshot,
which this pass does not do.

## Preflight

- **Run command:** `./scripts/install-to-vault.sh`, `./scripts/verify.sh` (from the worktree)
- **Fixture:** throwaway vault `test_vault/test vault` (reused, not recreated, per catalog). 400
  synthetic atoms seeded into `Atoms/` as `fixture-plumbing`; catalog has no named bulk-atom
  fixture, so this was built ad hoc.
- **Navigation map:** ✅ read, 🔧 **healed** — the `Settings → Atoms` row was stale (no Ask /
  Sync now / mirror-status entries, and `Source:` pointed at `src/settings.ts`, which no longer
  exists). Healed in this PR.
- **Viewport/device:** Obsidian desktop 1.12.7, macOS. Mobile **not** covered — see Not Tested.
- **Auth path:** local `plus-service` on `127.0.0.1:8790`, sqlite store, `DOGFOOD_AUTO_GRANT=1`;
  magic-link → `/v1/auth/exchange` → session `trialing` (entitled).
- **Automation available:** Obsidian CLI (`obsidian eval` / `command` / `dev:screenshot`),
  vitest. No physical iOS/Android device.
- **Product dogfood honesty:** ✅ present in `docs/qa/README.md:35`.
- **Deploy reality:** N/A — plugin-side change; the Plus service is unmodified by this PR.

### Evidence instrumentation (why the counts below are trustworthy)

A logging reverse proxy was placed at `127.0.0.1:8792` forwarding to the Plus service on `:8790`,
and the plugin was pointed at the **proxy**. Every request the plugin made is therefore a logged
line. "Zero deletes" below is a **grep over that log**, not an inference from a return value.
No `plus-service` source was modified.

## Authority & promises

Authority read: PR #226 body (supersedes, names the contract for each fix), `docs/architecture.md`
§ Ask mirror sync (invariants 3 and 7, rewritten by this PR), and on-screen copy.

| Surface | Promise (authority) | Acceptance (observable) | Story |
|---|---|---|---|
| Non-forced delta sync | PR: "a device holding 3 of 400 atoms issued 397 deletes on every relaunch" — now gated | Zero `POST /v1/ask/mirror/delete` in the request log | US-delta-zero |
| Atoms home + Settings status line | PR: "the refusal string reaches Atoms home" | `Ask mirror: {N} · sync refused — vault scan incomplete · Sync now to retry` rendered on both | US-refusal-surfaces |
| Settings → Sync now | PR: "a legitimate bulk prune still works… confirmation modal naming the concrete counts" | Modal names **the correct one of four** reasons; confirming reconciles | US-confirm-valve |
| Default install | PR: "drains and files with zero mirror requests" | Zero `/v1/ask/mirror/*` requests | US-ask-disabled |
| Outbox | PR: "only a confirmed push acks" | Refused pass leaves the item pending | US-outbox-no-false-ack |

## User Stories Tested

### US-delta-zero — a partially-synced device stops deleting the cloud brain — **Passed**
> As someone whose phone has only partly downloaded the vault, I want a relaunch to delete nothing
> from my cloud mirror, so that a slow sync cannot destroy my second brain.

**Acceptance:** zero server deletes. **Authority:** PR #226 core story 1.
**Evidence:** baseline forced sync uploaded 491 (484 atoms + 7 hubs); vault reduced to 3 files;
non-forced `syncAskMirror({force:false})` returned `{"kind":"refused","reason":"scan-incomplete"}`.
Request log for the window `19:50:41 → 19:53:39`: **3 × status, 1 × upsert, 0 × delete, 0 ×
reconcile**. The single upsert correctly precedes the gate (`askMirror.ts:1004-1015`).
Proof kind: `fixture-plumbing`. **Status: Passed.**

*Self-authenticating:* the pre-fix v0.6.52 build cannot emit `kind:"refused"` or the refusal
string at all, so the observed output could only have come from the build under test.

### US-refusal-surfaces — the refusal reaches the user — **Passed**
**Acceptance:** the string renders on Atoms home **and** the Settings mirror status line.
**Evidence:** both render **character-exact** with `askMirror.ts:438`:
`Ask mirror: 491 · sync refused — vault scan incomplete · Sync now to retry`
Home: `.atoms-home-ask-mirror-refusal`. Settings: `.setting-item-description atoms-ask-mirror-error`.
Screenshots `03-home-refusal.png`, `04-settings-status-line.png`. **Status: Passed.**

This is the box no unit test in the repo could ever cover — `vitest` runs in node with no DOM.

### US-confirm-valve — Sync now → modal → confirmed prune — **Passed**
**Acceptance:** modal names the correct reason (not hard-coded); confirming reconciles.
**Evidence:** clicked the **real** Settings "Sync now" button. Modal heading
**"Vault scan looks incomplete"** — the correct one of four. Body opened
`Atoms did not delete anything from your cloud mirror.` with accurate counts (synced before 491 /
found now 3 / cloud 491). Buttons "Wait for sync" / "Delete from cloud". Confirming issued
5 deletes + 1 reconcile; evidence, stored count and high-water all settled to 3, consistent with
the vault. **Status: Passed** — with caveat F2 below (one of the four reasons is unreachable).

### US-ask-disabled — default install files with zero mirror requests — **Passed (narrowed)**
**Acceptance:** zero `/v1/ask/mirror/*` requests. **Evidence:** with `askEnabled=false`, the drain
moved 3 inbox lines into `Daily/2026-07-30.md` (×2) and `Daily/2026-07-31.md` (×1), each stamped
`<!--atoms:filed-->`. **Mirror requests after marker: 0.** **Status: Passed for the stated claim.**

**Narrowing, stated plainly:** this was *not* a virgin default install — `plusBaseUrl` and the Plus
session were deliberately left configured so that any leak *would* be logged. 13 × `POST
/v1/classify` (all 503) fired in the window from auto-run (`main.ts:224`), unrelated to the drain.
The mirror claim holds; "a clean-machine default install" was not exercised.

### US-outbox-no-false-ack — a refused pass does not ack — **Passed**
**Evidence:** `catchUp.ts:216`; covered by `acks nothing when the mirror refused to converge`.
Re-pull is safe via `applied_idempotent`. **Status: Passed.**

## Risk Matrix

| Risk | Check | Status |
|---|---|---|
| Happy | Delta refusal issues zero deletes | Passed |
| Happy | Confirmed prune reconciles | Passed |
| Negative | Corrupt high-water (`"0"`, `"-5"`, `"abc"`, `""`, huge) | Passed — all fail closed |
| Negative | Stored server count `0` / negative / non-numeric | Passed — refuses |
| Negative | Bodyless 2xx from `status()` (captive portal) | Passed — live-proven refusal |
| Edge | Vaults of 0 / 1 / 3 atoms; the `max(5,…)` clamp | Passed — no permanent wedge |
| Edge | Refusal escalation fires at exactly 3 passes, once | Passed |
| Regression | Inbox drain + marker re-verify | Passed |
| Regression | Two identical same-second captures both file | Passed |
| **Race** | **Concurrent forced + non-forced sync** | **HOLED — H2** |
| **Staleness** | **Forced reconcile against a stale stored count** | **HOLED — H1** |
| Perception | Refusal string on both surfaces | Passed |
| Craft | Decisive frame density/hierarchy | Passed, one note |

## Evidence

| Check | Result |
|---|---|
| `npm test` | 815 passed (suite green with the repro file outside the vitest glob) |
| `npm run build` | Clean (`tsc -noEmit` + esbuild) |
| `./scripts/verify.sh` | OK, exit 0 — see caveat F3 |
| Delta-refusal delete count | **0** — grep over `mirror-requests.log`, window `19:50:41→19:53:39` |
| Confirmed-prune delete count | 5 deletes + 1 reconcile at `19:53:39` (expected) |
| Ask-disabled mirror requests | **0** |
| Refusal strings | Character-exact on both surfaces |
| Device screenshots | **Not captured** — iOS/Android outstanding |

Screenshots (`docs/qa/screenshots/fix-mirror-delete-gate/`):
`03-home-refusal.png` · `04-settings-status-line.png` · `05-confirm-modal.png`

## Craft read (§5b)

Decisive frame read in-thread: the Settings → Atoms tab carrying the refusal line.

- **Passed.** Card padding, row rhythm, hierarchy and tap targets read as intentional. No
  stacked-chrome collision: the status line ↔ "Sync now" card gap is clean.
- **Note (polish):** the refusal line is visually orphaned — bare red text floating between two
  cards with no container, so its "Sync now to retry" instruction is not visually tied to the
  "Sync now" row it refers to.
- **Naming defect:** `05-confirm-modal.png` does **not** show the confirmation modal; it shows the
  Settings tab. The modal copy in US-confirm-valve is evidenced by a verbatim DOM read, not by a
  captured image. Recapture before merge if an image of the modal is wanted in the PR body.

## Findings

### H1 (P0) — a stale server count defeats the reconcile tripwire entirely
`src/platform/askMirror.ts:842-845`

```ts
let decision = judge();               // judged against the STALE stored count
if (decision.allowed || !force) {
  return { decision, confirmation: null, serverCountRefreshed: false };
}
const st = await host.status();       // reached ONLY when the stale count already refused
```

The comment directly above that `status()` call states the stored count "is old by definition on
exactly the device at risk… another device pushing 395 atoms since is invisible to it." The code
nevertheless trusts it whenever it **permits**. The refresh only happens on the refuse-then-ask
path; the allow path never refreshes.

**Inputs → outcome:** vault 91, evidence 91, high-water 91, stored count 91 (correct when written),
cloud actually 491 after another device pushed. Floor `min(91, max(5,73))`=73 ✓, tripwire
`ceil(91×0.8)`=73 ✓ → allowed. The true tripwire against 491 would be 393.

**Live repro:** cloud `491 → 91`. **400 rows hard-deleted, no modal shown**, and the outcome
reported `{kind:"worked", uploaded:0, deleted:0}` → the Settings toast read "Ask mirror
reconciled". Reconcile deletions are not counted in `deleted`, so even the count is silent.

**Why the suite is green:** `decideMirrorDeletion` (the pure judge) *is* tested with a present
stored count (`test/askMirror.test.ts:502,673,742`). What is untested is the **wrapper's refresh
ordering** — that `resolveMirrorDeletionGate` never refreshes on the allow path. The fresh-phone
case the tripwire was written for survives only because a fresh phone has no stored count.

This is the same shape as the bug the branch exists to kill: *a guard reading a value the
situation it guards against has already corrupted.*

### H2 (P0, regression introduced by this PR) — the force flag leaks into a background delta
`src/plugin/main.ts:1204-1213`

`askMirrorForceFollowUp` is consumed at the top of the `do` loop, but a **concurrent**
`syncAskMirror({force:true})` re-sets it during the `await` (`:1189-1191`). The `failed` and
`refused` early returns then exit the loop **without consuming it**, and `finally` clears only
`askMirrorInFlight`. A later plain `syncAskMirror({force:false})` computes
`runForce = false || true` → a full keepPaths reconcile with no user gesture.

**Live repro:** (1) dirty an atom, start `{force:false}` against a dead port, immediately
`{force:true}` → `{kind:"joined"}`; the first pass fails, leaving the flag set. (2) restore the URL
and call plain `{force:false}` → `{kind:"worked", uploaded:1, deleted:0}` and **cloud `491 → 91`**.

The file watcher calls `syncAskMirror({force:false})` at `main.ts:238, 400, 598, 1511`, so this
arms on any vault edit. It also breaks the invariant stated at `askMirror.ts:875` — a forced
reconcile must follow "an explicit gesture the user is already attending to ('Sync now'), **never
a silent delta pass**". Chained with H1 it deletes without any dialog at all.

**Realistic trigger:** double-tap Sync now on a flaky connection, or dismiss the confirm modal
while a second Sync now has joined.

No test covers it — nothing in the repo imports `main.ts`.

### F1 (P1, pre-existing — not a regression) — Settings → Atoms crashes partway and truncates
`src/settings/settings.ts:1225` and `:1239` call `ButtonComponent.setDestructive()`, which is
declared in `obsidian.d.ts` but **is not a function at runtime on Obsidian 1.12.7**. Opening the
tab throws `…setDestructive is not a function`; rendering stops after "Wipe cloud copy", so
**"Self-host Ask" (`:1280`) and "Plus service URL override" (`:1303`) never render**.

Confirmed pre-existing: present on `origin/master` at `settings.ts:1210/1224`. Visible in
`04-settings-status-line.png` / `05-confirm-modal.png`, where the tab simply ends.

**This PR's own surfaces are unaffected** — the status line (`:1160-1168`) and the Sync now button
(`:1179-1195`) both render before the throw. Worth filing separately; it sits directly beneath the
UI this PR ships.

### F2 (low) — the `no-server-count` modal reason is unreachable
`mirrorRefusalTitle("no-server-count")` / `mirrorRefusalBody` are unit-tested, but the `!st.ok`
branch at `askMirror.ts:849-859` returns **before** `host.confirm`, so that reason can never render
in the modal — only in the status line. The PR's "names which threshold refused" claim is true for
three of the four.

### F3 (low, QA tooling) — `verify.sh` silently splits across two vaults when run from a worktree
Its filesystem ground-truth half parses `<worktree>/test_vault/test vault`, while its CLI half
drives **whatever vault Obsidian currently has open**. In the first run of this pass those were
different directories (ground truth saw 25 daily files, the live scan saw 36), and the script still
reported OK. It can therefore pass while asserting against a build that is not installed in the
vault under test.

### F4 (low) — `clearAskMirrorDeviceState` documents an SSOT it does not own
`askMirror.ts:603` says the reset lives centrally "so the reset and the readers cannot drift", but
it has no callers outside its own tests; the live Wipe button (`settings.ts:1253-1270`) hand-inlines
all six clears. They agree today — the guarantee is fictional and the live path untested.

### F5 (low) — refusal streak not cleared by a confirmed prune
After a successful confirmed delete, `atoms-ask-mirror-refusal-v1` stayed `{"count":2}`; the reset
at `askMirror.ts:1131` is gated on `scannedCount >= floor`, which the confirming pass fails by
construction. Self-heals next pass and 2 < 3 so no spurious escalation. The comment at `:1122-1130`
shows the tradeoff was deliberate.

### Suspected, unproven
- **An outbox entry may ack after a pass that made zero network calls.** `runAskMirrorSync` returns
  `worked` when there is nothing to upsert or delete, and the tail `status()` failure is swallowed
  (`askMirror.ts:1147-1150`). If `getMarkdownFiles()` has not yet indexed the file
  `applyOutboxItemToVault` just created, the push is a no-op that `mirrorConfirmedReceipt` reads as
  confirmed. Likely unreachable if `vault.create` registers before resolving — but it is the R15
  failure this branch exists to close, reached through another door, and nothing guards it.
- **No `askMirrorStatus` test exists at all** (`grep -c askMirrorStatus test/plusClient.test.ts` = 0).
  The bodyless-2xx fix at `plusClient.ts:550` is correct and was proven live, but is
  regression-unprotected.

## Adversarial QA

Full ledger — 39 scenarios across corrupt inputs, boundaries, sequences, network, promises, race.

**Class A (corrupt gate inputs):** A1 solid · A2 solid · A3 solid · A4 solid (`"1e3"`→1000, cosmetic)
· **A5 holed** (corrupt hashes + absent mark ⇒ `mirrorCompletenessFloor(0,0)===0`, completeness arm
disabled; delta still safe, but only the tripwire remains — which H1 defeats) · A6 solid (Wipe
stores `""`, not `"0"`).

**Class B (boundaries):** B1–B5 all solid. Floor table verified 0→0, 5→5, 6→5, 7→6, 5000→4000. No
wedge for small vaults; the `max(5,…)` clamp behaves as the PR claims.

**Class C (sequences):** C1 solid (single-flight holds; 2nd call → `joined`) *but feeds H2* ·
C2 solid (`onClose`→dismissed, lock released in `finally`) · C3 solid mechanically, *feeds H2* ·
C4 solid · C5 solid (escalation counts across 6 passes = `[0,0,1,1,1,1]`) ·
**C6 blocked** — could not observe post-reload partial state; the `eval` context is torn down with
the plugin instance, so the probe raced itself.

**Class D (network):** **D1 holed** → H1 · **D2 not run** (same fail-closed branch as D1; skipped
for budget, not blocked) · D3 solid, live-proven with a fake bodyless-2xx server ·
D4 solid analytically.

**Class E (this PR's promises):** E1 solid · E2 solid with caveat F2 · E3 solid
(`inbox.test.ts:1412/1431/1456`) · E4 solid (`inbox.test.ts:1515/1532/1560`).

**Class F (race):** F1 solid — `rec-<ms>-<8 base36>`; two same-millisecond hosts produce different ids.

**Proven holes:** H1, H2 (both P0, both above), A5 (folded into H1).

**Repro:** `docs/qa/repro/2026-08-01-225-mirror-gate-adversarial-repro.test.ts` — 39 tests, 36 pass,
**3 fail on purpose**, all H1:
- `H1 stale server count defeats the reconcile tripwire > a forced reconcile wipes 400 rows another device pushed since`
- `> blast radius: 84 keepPaths committed against a 484-row cloud`
- `A: corrupt gate inputs > corrupt evidence map + absent high-water zeroes the completeness floor`

It is parked **outside** the `test/**/*.test.ts` glob deliberately, so the suite stays honest while
the holes are open. Move it into `test/` as the regression guard when H1 is fixed. H2 needs an
injectable host around `main.ts` before it can be unit-tested at all.

## Not Tested

- **iOS device via BRAT** — requires a physical device and a GitHub Release. Agents do not cut
  releases or install into personal vaults (`CLAUDE.md` vault lanes). **Human-only.**
- **Android device via BRAT** — same. The `AtomsMobileQA` emulator fixture exists and could cover
  part of this, but not the BRAT install path or Obsidian Sync behaviour.
- **A genuinely virgin default install** — US-ask-disabled kept Plus configured on purpose so a
  leak would be logged. The zero-mirror-request claim holds; a clean-machine install does not.
- **C6** — plugin reload mid-sync (technique named above).
- **D2** — server killed mid-sync.
- **Real Obsidian Sync** — every "incomplete vault" here was simulated by deleting files. The
  actual partial-download behaviour of Obsidian Sync was not exercised.
- **Production `plus-service`** — all evidence is against a local sqlite instance.

## Merge Decision

**Do not merge. Keep in draft.**

Four of the six PR test-plan boxes now have real evidence and can be checked; the two device boxes
cannot be checked by an agent and stay open for a human.

Blocking before merge:
1. **Fix H2** — a regression this PR introduces, and the more dangerous of the two: it needs no
   second device, arms on any vault edit, and can fire the irreversible-delete modal out of context
   or (with H1) skip it entirely.
2. **Fix H1** — refresh the server count on the **allow** path too, or stop treating a stored count
   as sufficient authority to permit deletion. Land the parked repro tests in `test/` with the fix.
3. Decide on F2 (unreachable modal reason) — small, but it makes one of the PR's stated claims
   untrue as written.

Non-blocking, file separately: F1 (pre-existing settings crash), F3 (verify.sh vault split),
F4, F5, and both unproven suspicions.

The three original fixes do what the PR says they do. The gate simply has two more doors, and this
pass walked through both.

---

## Re-run 2026-08-02

Branch `fix/mirror-delete-gate-and-outbox-ack` @ `732ca20` · v0.6.60 (v0.6.63 after merging master). Scope as the merge decision
set it: fix H2, fix H1, land the parked repro, decide F2, re-run adversarial classes **C** and
**D** only. Everything else in the ledger is untouched by these fixes and was not re-run.

### H2 — fixed, and now testable at all

`askMirrorForceFollowUp` is consumed on every exit, not just the loop-continue path. The
single-flight state machine moved out of `main.ts` into `runMirrorSingleFlight` (`plugin/catchUp.ts`)
against a `MirrorSingleFlightState` the plugin owns but never mutates by hand — the same extraction
U1 and U9 each had to make first, because nothing in the repo imports `main.ts`.

**Live proof, against the shipped 0.6.60 bundle** (`obsidian eval`, real `syncAskMirror`, only the
one network pass faked; `askEnabled` flipped in memory and restored, never saved):

```json
{"forces":[false,false],"joined":{"kind":"joined"},"midFlag":true,"afterFlag":false,
 "first":{"kind":"failed","message":"probe"},"next":{"kind":"failed","message":"probe"},
 "flight":{"inFlight":false,"followUp":false,"forceFollowUp":false}}
```

Read it in order: the concurrent forced call is absorbed (`joined`), it really does arm the flag
mid-`await` (`midFlag: true` — the leak's precondition is present, not designed away), the run
exits through the `failed` early return that used to skip consumption, the flag is gone
(`afterFlag: false`), and **the next background push ran unforced** — `forces: [false, false]`.
Pre-fix that second entry is `true`, which is the full keepPaths reconcile with no user gesture.

**Unit:** 4 scenarios in `test/catchUp.test.ts`. 3 go red against the pre-fix `finally` (verified by
reverting it); the 4th — "still honours a joined force when the run keeps looping" — is green both
ways on purpose, because a fix that merely disarms the flag would cost the feature its reason to
exist.

### H1 — fixed

The count is refreshed **before** the verdict on every reconcile, not only after a stale count has
already refused. An unreachable `status()` on a forced pass now fails closed.

This flips one previously-green adversarial scenario, deliberately: *"unreachable status() does NOT
stop an already-allowed forced reconcile"* (evidence 84, scanned 84, stored 84) now expects a
refusal. That test was characterising the bug's benign face. The scenario is **locally
indistinguishable** from the catastrophe — the phone holding 3 of 400 atoms also scans 100% of its
own evidence, and its stored count also matches that scan. No local signal separates them; only
this moment's server count does. So the test was rewritten to the new contract and renamed for H1.

### F2 — decided: make the claim true, not softer

`no-server-count` was unreachable in the modal because a run without a count refuses before asking.
That is correct behaviour — never pose an irreversible question whose answer cannot be informed —
so it is now in the type rather than in a comment: `ConfirmRequest` carries
`MirrorDeletionAskReason` (`Exclude<…, "no-server-count">`) and a non-null `lastKnownServerCount`.
The PR's claim that the modal names which threshold refused is now true of all reasons it can
carry. Modal copy follows: "Cloud count right now: N" — it was never a *last known* number on this
path, and the `?? "unknown"` fallback is gone with the nullable type.

### Class C (sequences) — re-run

C1 and C3 were the two that *fed* H2; both are now covered by the live probe above (C1's `joined`
absorb is the first assertion in it) and by the unit scenarios. C2, C4, C5 are untouched by these
fixes — the escalation-count and lock-release paths did not move — and were not re-run. **C6 stays
blocked** for the original reason: the `eval` context is torn down with the plugin instance, so a
post-reload partial-state probe still races itself. Unchanged by this work.

### Class D (network) — re-run

**D1 → green.** The stale-count scenarios that were red are green, driving the real
`runAskMirrorSync` through the fake host. **D2 is now actually run** rather than skipped for budget
— it is the rewritten "fails closed even when the stored count would allow" scenario. D3 (bodyless
2xx) stays green. D4 remains analytic.

**A5 closes as a consequence.** It was "corrupt hashes + absent mark zeroes the completeness floor,
leaving only the tripwire — which H1 defeats". The tripwire now judges a fresh count, so the
remaining arm holds. Its scenario was one of the three parked reds and is green.

### Suite

822 green (52 files) — 779 before, plus the 39 landed from the repro and 4 new single-flight tests.
`npm run build` clean. The repro file is now `test/askMirrorGate.adversarial.test.ts`, inside the
glob; `docs/qa/repro/` is empty.

### Still not done

- **iOS and Android device boxes** — human-only (physical device + a GitHub Release via BRAT).
  Unchanged.
- **F1 is fixed on `master`**, not by this PR — `markDestructive` replaced the `setDestructive`
  call that truncated Settings → Atoms. Picked up here by merging `origin/master` in.
- **F3, F4, F5** and both unproven suspicions — still open, still non-blocking, still want
  their own issues.
- **F3 bit this re-run**, exactly as written: the running Obsidian has the *main repo's*
  `test_vault/test vault` open, not the worktree's. The live probe therefore required installing
  this branch's build into that shared vault explicitly — so that vault now carries **0.6.60 from
  this branch**, not master's 0.6.61. Any other session using it should reinstall from its own
  branch.

### Re-run verdict

**Desktop: ready.** The three original fixes still do what the PR says, and the two doors this
pass's predecessor walked through are shut — one of them proven shut in the running plugin, not
just in a unit test. PR #226 can leave draft. Merge still waits on nothing but the two human device
checks, which the PR body should keep unchecked and honest.
