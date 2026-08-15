# One em-dash guard for the whole plugin — plan (#495)

**Claim:** [#495](https://github.com/taihartman/obsidian-atoms/issues/495)
**Branch:** `chore/plugin-wide-em-dash-guard`, stacked on `claude/settings-ux-redesign-69acd6` (PR #494)
**Origin:** finding **F5** in `docs/qa/2026-08-14-493-settings-three-leg-overhaul-world-class-qa.md`

**Lane:** light
**Why:** WHAT is settled — `docs/voice.md:54` already states the rule. No model surface, auth, or
security widens. The blast radius is wide but it is copy, not logic, and the two places where it
*would* become logic (vault filenames, prompt-cache prefixes) are handled by exempting them rather
than changing them. Sweeping either escalates this to the full lane.
**Doc-review:** light (headless coherence + feasibility). No product or design lens: no surface
moves, only the words on it.
**Done when:** one guard covers `src/**`, `npm test` is green, the guard has been *seen to fail* on a
reintroduced em dash in a brand-new file, and a live vault smoke shows the reworded Process,
backfill, and mirror Notices.

---

## Why the base is #494 and not master

On `master` the settings tab still holds 25 em dashes, because the sweep that removed them is PR
#494 and it has not merged. A default-deny guard built on `master` would need a 25-line,
settings-shaped hole in it — three partial guards replaced by two, which is not the goal.

On the #494 branch `src/settings/` is already clean except `consent.ts`, so the guard can cover the
whole tree the day it lands. Stated cost: **this cannot merge until #494 does.**

## The counts, and what they actually are

131 non-comment lines in `src/**` carry an em dash on this base: 102 in scope, 27 in `classify.ts`,
2 in `consent.ts`. The 102 are not all copy:

| Cat | What | N | Disposition |
|---|---|---|---|
| A | User-visible copy — Notices, buttons, status lines, empty states | 81 | **Sweep** |
| B | Written into the user's vault | 10 | **Sweep 7, exempt 3** (KTD2) |
| C | Console / devLog only | 4 | Sweep, so the guard stays flat |
| D | Model-facing prompt | 3 | **Exempt** (KTD3) |
| E | Mechanical — a regex, a spike fixture | 2 | **Exempt 1, sweep 1** |
| F | Unreachable message | 1 | Sweep |

`classify.ts` splits three ways: 24 prompt lines (exempt), 2 trailing code comments (not copy), and
**one user-facing Notice at line 881** that a whole-file "it's all prompt" exemption would have
missed.

> A file-level scan counts 102 where a categorized pass counts 101. The difference is trailing `//`
> comments, which the current `stripComments` does not remove — it only strips *full-line* comments.
> U1 fixes that and reconciles the count before any copy changes.

---

## Key technical decisions

### KTD1 — Default-deny across `src/**`, with one central exemption table

`test/settingsCopyVoice.test.ts` uses an **allowlist** of five files. That does not scale to thirty
and, worse, a new file with copy in it is silently uncovered — a rule nobody can fail is a rule that
decays, which is the reasoning that test already carries in its own header. The widened guard
inverts it: every `src/**/*.ts` is covered unless the exemption table names it.

Three exemption shapes, one table, one file:

- `EXEMPT_FILES` — whole file, with a reason. Today only `src/settings/consent.ts`.
- `EXEMPT_REGIONS` — `{file, startMarker, endMarker, reason}` for the two prompt blocks. A region
  rather than 24 exact strings, because the point is that the block is frozen wholesale.
- `EXEMPT_LINES` — `{file, exact trimmed line, reason}` for the one-offs. Keyed on the **exact
  string, not `path:line`**, so an exemption survives edits above it and can never drift onto a
  different line and start excusing something else.

Every exemption is itself asserted to still match something. A stale exemption fails the suite and
gets deleted — the property `settingsCopyVoice.test.ts` already has for `consent.ts`, and the reason
it is the right pattern to extend rather than replace.

**Why a table and not an inline `// voice:allow-em-dash` pragma:** a pragma lets an author silence
the guard from inside the file they are already editing. The table forces the exemption into a diff
a reviewer is looking at, next to every other exemption and its stated reason.

### KTD2 — `continueParent`'s three strings are exempt: they are filenames, not copy

`` `${parent} — continued` `` and its `(n)` / `(Date.now())` collision variants become an atom
**title, and therefore a filename on disk**. Rewording is not typography: it changes what future
continued atoms are named, splits them from every atom already filed under the old suffix, and
reaches into the collision ladder that generates the variants. `test/continueParent.test.ts` pins
all three.

Exempt, reason recorded. A rename needs a dedup and migration story and gets its own issue.

The other seven B strings are link reasons and one note template — plugin-authored prose written
into atom bodies, plainly covered by the rule, affecting future writes only. Swept. **Body sacred is
not in tension:** these are reasons the plugin authors, never capture text.

### KTD3 — Both prompt blocks are exempt; the Notices beside them are not

`classify.ts`'s `SYSTEM_PROMPT` and `context.ts`'s `buildContextPrefixBlock` are model-facing, so the
product voice rule does not reach them. Two independent facts make editing them a different job:

1. `"people[] — who is named, and how"` is in `CLASSIFICATION_PARITY_PHRASES`, frozen byte-for-byte
   against plus-service `classifyTemplate.mjs`. Changing it is a coordinated repo + Fly deploy.
2. `buildContextPrefixBlock` feeds the Anthropic **prompt-cache stable prefix**. Any edit
   invalidates every cached prefix and costs real money on the next run for no user benefit.

What is *not* exempt is user copy that happens to share the file: `classify.ts:881` is a Notice a
user reads, and it is swept.

**Filed as a follow-up, not fixed here:** the prompt teaches the model an em-dashed atom title as a
*good* example — `Good: "same product thread — settlement timing after split ([[Expense app — final
settlement]])"`. Those titles land in the vault where users read them, so the prompt is actively
generating copy the rule bans. Fixing it is a classification-contract change with a parity freeze
and a deploy attached.

### KTD4 — Verify the ack-pinned surfaces before rewording, not after

`atomsHomeView.ts:942` sits on the egress catch-up card, next to the `EGRESS_ACK_VERSION`-gated
disclosure. It reads as *adjacent* to the frozen text rather than part of it — which is exactly the
shape of the `consent.ts` hazard and cannot be taken on trust. Before it is touched, check it
against `test/egressConsentParity.test.ts` and `test/askConsentVersion.test.ts`. If it is part of a
frozen disclosure it joins the exemption table and is **not** reworded without a version bump.

Same check on the `ASK_PRIVACY_ACK_VERSION` surfaces before any `askMirror.ts` string moves, and
against `test/wwwSetupLabels.test.ts` for the `docs/ask-self-host.md` / `www/src/setup.html.tmpl`
lockstep (KTD10) before any control *name* changes. Rewording a description is safe; renaming a
control is not.

### KTD5 — Separator versus prose

- Prose → period, colon, or comma, per `docs/voice.md:54`.
  *"Nothing written yet — this is what Process would do."* becomes
  *"Nothing written yet. This is what Process would do."*
- Status-line separator → `·`, already the house separator in the mirror status lines and the
  settings version row, and what the settings sweep chose for `Tag vocabulary · N active`.
- `ASK_MIRROR_COUNT_UNKNOWN = "—"` is a **glyph, not prose** — an em dash standing for "no value",
  the convention a table uses for an empty cell. Kept and exempted. Rewriting a placeholder changes
  two rendered surfaces (home and settings) for no voice gain.

### KTD6 — Keep the runtime-output assertions; retire only the source re-scan

"Three partial guards" is really two different properties:

- **Source scans.** `atomsHomeData.test.ts:678` asserts a source constant carries no em dash. The
  central guard subsumes this exactly. Delete it.
- **Composed-output assertions.** `entityInvite.test.ts:96` and `atomsHomeData.test.ts:989/1001/1036`
  assert a *composed* string carries none. That is a different property — composition can introduce
  one that no single source line contains. Keep them.

`wwwPricing.test.ts` guards built HTML under `www/dist`, a different surface from `src/**`. Out of
scope, left alone, and named in the new guard's header so the next reader knows why two remain.

Deleting a test needs justifying, not tidying. Only the one exact-duplicate source scan goes.

---

## Units

| U | Work | Gate |
|---|---|---|
| U1 | Widen the guard: `test/settingsCopyVoice.test.ts` → `test/copyVoice.test.ts`, inverted to default-deny over `src/**`, three exemption shapes plus their staleness assertions, and `stripComments` extended to trailing `//` without eating `https://`. Lands **red**. | Fails with a readable offender list; count reconciles to the file scan |
| U2 | KTD4 verification pass over every candidate against `egressConsentParity`, `askConsentVersion`, `wwwSetupLabels`. Anything pinned moves to the exemption table. | A written finding per pinned string, or an explicit "none found" |
| U3 | Sweep A (81). Update the byte-pinned tests (`askMirror`, `atomsHomeData`) in the same commit. | Guard green for those files; `npm test` green |
| U4 | Sweep B-minus-`continueParent` (7), C (4), the E fixture (1), F (1). Add exemptions for `continueParent` (3), the `askMirror` regex, `ASK_MIRROR_COUNT_UNKNOWN`, and the two prompt regions. | Guard green across `src/**` |
| U5 | Sweep `classify.ts:881`; retire the one duplicated source scan (KTD6). | Guard green including `classify.ts` |
| U6 | **Mutation check.** Reintroduce an em dash in three files including a brand-new one, and confirm the guard fails each time. A guard never seen to fail is not a guard. | Three recorded failures, then reverted |
| U7 | Shipping tail: `ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa`, with a live vault smoke of the reworded Process, backfill, and mirror Notices. | PR evidence table with real screenshots |

## Risks

- **A pinned string slips past U2** and a reworded disclosure rides on an old consent. Mitigated by
  running U2 *before* U3 and exempting on any doubt. This is the failure mode `consent.ts` already
  documents: a data-integrity bug wearing a typography fix.
- **A reworded Notice breaks an assertion nobody found.** `npm test` is the net, and U3 updates
  pinned tests in the same commit. Loosening a byte-for-byte assertion to a regex so a copy edit can
  pass would destroy the thing that makes the assertion worth having.
- **#494 never merges**, stranding this branch. Accepted; it is why the base was settled before any
  code was written.

## Follow-ups to file

- The classify prompt teaches em-dashed atom titles (KTD3) — parity change plus Fly deploy.
- The ` — continued` filename suffix (KTD2) — needs a dedup and collision story.
