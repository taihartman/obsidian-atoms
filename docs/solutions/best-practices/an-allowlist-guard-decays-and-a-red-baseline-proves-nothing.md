---
title: "An allowlist guard decays, and a mutation check against a red baseline proves nothing"
date: 2026-08-14
updated: 2026-08-15
category: best-practices
module: testing
problem_type: design_error
component: copy-voice-guard
severity: medium
status: solved
tags:
  - guard
  - allowlist
  - mutation-testing
  - voice
  - exemptions
  - typescript-parser
---

## Problem

`docs/voice.md` bans em dashes in product-authored copy. Three partial guards enforced slices of
that rule and the rest of the plugin was uncovered: 131 non-comment lines in `src/**` carried one.

The settings guard (`test/settingsCopyVoice.test.ts`) worked by **allowlisting five files**. That
shape cannot scale past the tab it was written for, and its real defect is quieter: a new file with
copy in it is covered by nothing. A rule nobody can fail is a rule that decays.

## What was wrong beyond the obvious

**Most of what looked like copy was not copy.** Of 102 candidate lines, only 81 were user-visible.
Ten were written into the vault, and three of those became atom **titles, and therefore filenames on
disk**. Three more fed the Anthropic prompt-cache stable prefix. One was a character class in a
trailing-punctuation regex, where the em dash is behavior. One was a placeholder glyph meaning "no
value". A blanket sweep would have edited every one of them.

`src/pipeline/classify.ts` looked exemptable as a whole ("it is all prompt"). It is not: line 881 is
a `Notice` a user reads. Meanwhile three of its em dashes sit outside `SYSTEM_PROMPT` entirely, in
`CLASSIFICATION_PARITY_PHRASES` — the constant that must match plus-service `classifyTemplate.mjs`
byte-for-byte — and in `CLASSIFICATION_SCHEMA` descriptions. File-level reasoning was wrong in both
directions at once.

## Solution

**Default-deny with a self-validating exemption table.** `test/copyVoice.test.ts` covers every
`src/**/*.ts` unless one of three tables names it: whole file, region between markers, or exact
trimmed line. Exact line rather than `path:line`, so an exemption cannot drift onto a neighbour when
the file above it changes.

Every exemption is asserted to **still match something**. A stale exemption fails the suite and gets
deleted rather than sitting unread. Each carries a reason naming what would let it be removed.

A central table beats an inline `// voice:allow-em-dash` pragma: a pragma lets an author silence the
guard from inside the file they are already editing, while the table forces the exemption into a
diff a reviewer is looking at, beside every other exemption.

**Let the parser decide what is copy.** The first implementation hand-rolled a comment stripper and
was wrong within a day. `/^created:\s*["']?…/` in `src/resurface/resurface.ts` carries a quote
inside a character class; a string-aware scanner reads it as an unterminated string, and every block
comment after it survives and is reported as copy. Telling a regex literal from a division needs
real parser state, not a token-lookback heuristic. `typescript` was already a devDependency. Review
later found a second latent bug in the same scanner — nested template literals — which the parser
version had already fixed for free.

The rule also flipped from subtractive to positive: a line counts if its em dash sits in a string,
template or regex literal. Comments are then out of scope **by construction** rather than by removal.

## Two process lessons worth more than the guard

**A mutation check against a red baseline proves nothing.** One line was deliberately left unswept,
so the suite was already failing when the mutation check ran. All four mutations "failed" and every
one of them was vacuous. The baseline has to be green first — that meant temporarily exempting the
held line — and the check needs a **negative** case too: a comment-only em dash must *not* fire, or
a guard that flags everything passes the same four tests.

**Verify the freeze before rewording, not after.** A dedicated pass checked all 94 candidates
against `EGRESS_ACK_VERSION`, `ASK_PRIVACY_ACK_VERSION` and the `wwwSetupLabels` doc lockstep before
a single string changed. It found no pin among them — but it found something better: the Atoms home
egress catch-up card is a disclosure that grants paid egress and records consent as a **bare
un-stamped boolean**. Nothing freezes its wording, so rewording it turns no test red. That is the
#315 failure class with the detector missing (#497), and it is the reason that one line is exempt
rather than swept.

## Postscript, 2026-08-15: the guard caught its first live offender, and two holes of its own

The QA pass before merge is where the argument above stopped being theoretical.

**The default-deny claim was proved by something no test could have staged.** QA finished, and
forty minutes later the pre-merge check turned the suite red on a string that did not exist when the
pass ran:

```
src/platform/plusClient.ts:186
"Plus service URL must start with https:// — http:// is allowed only for localhost. …"
```

`PLUS_BASE_URL_INVALID_MESSAGE` shipped with #500, written by someone who had never seen this guard,
in a file the sweep never touched. The deleted five-file allowlist would have said nothing. **That is
the whole thesis, demonstrated on live code rather than in a mutation harness** — and it arrived
within the hour, which is a fair estimate of how fast an allowlist rots.

**A check that decays must run at merge time, not at QA time.** The pass recorded "re-run this
against the then-current base tip" as a merge step precisely because the base was under active
development. It decayed exactly as predicted. A verification result is only as fresh as the tree it
ran against, and QA-time green is not merge-time green on a busy branch. Write the decay into the
merge checklist, not into a report nobody re-reads.

**Adversarial QA found two holes in the guard itself, which is where it should have been pointed all
along.** The break-it pass was aimed at the deliverable rather than the copy:

- `sourceFiles` filtered on `name.endsWith(".ts")`, making a default-deny guard **default-allow**
  for `.tsx`, `.mts` and `.cts`. An em-dashed string went past in all three. `tsc` catches a `.tsx`
  today *only* because `jsx` is unset — the build was silently standing in for the guard on a config
  a future UI change is entitled to flip. A guard that delegates its coverage to an unrelated
  compiler flag has a gap with no owner.
- One exemption's stated reason was **false**. `ASK_MIRROR_COUNT_UNKNOWN = "—"` was justified as
  "not a sentence"; it is interpolated straight into `Ask mirror: — · sync refused …` on two
  surfaces, reachable whenever the stored count is blank. The design principle here is that every
  exemption carries a reason a reader can check — so an exemption whose reason is untrue is worse
  than no exemption, because it launders the bend as considered. It now stands on cost and says so.

The corollary for the rule above: *every exemption states the condition that would retire it* is not
enough. **The stated condition must also be true**, and nothing in the suite checks that — a
staleness test proves the string still exists, not that the sentence explaining it is accurate. That
gap is closed by review, not by tooling.

## Prevention

- Guards default-deny. An allowlist only ever describes the past.
- A default-deny guard owns its **whole** surface. Enumerate extensions and paths deliberately;
  never let a build flag or an unrelated linter be the thing that happens to catch the gap.
- Re-run any decaying pre-merge check **at merge**, against the tree being merged. QA-time green on
  a moving base is a claim about a tree that no longer exists.
- Point the adversarial pass at the **deliverable**, not only at what the deliverable changed. On a
  tooling PR the tool is the risk surface.
- An exemption's reason is a claim. Check it like one.
- Every exemption states the condition that would retire it, and is tested to still apply.
- Before rewording anything a user consented to, find the version that pins it. If nothing pins it,
  ask why not — that is a bug, not a licence.
- Ask what a string *is* before treating it as copy: a filename, a prompt, a cache key and a regex
  all read like prose in a diff.
- Prefer the real parser to a hand-rolled scanner when one is already a dependency.

## Related

- `test/copyVoice.test.ts` — the guard and its exemption tables
- `docs/voice.md` — the rule, plus the `·` separator and parenthetical conventions it leans on
- `docs/qa/2026-08-15-495-plugin-wide-em-dash-guard-world-class-qa.md` — the pre-merge pass the
  postscript comes from: nine live scenarios, the adversarial ledger, and the decayed check firing
- `docs/qa/learnings.md` — nine QA-harness traps this pass paid for, including the unlocked shared
  vault that let a peer replace the build mid-pass
- #497 unstamped egress ack · #498 prompt teaches em-dashed titles · #499 ` — continued` filename
