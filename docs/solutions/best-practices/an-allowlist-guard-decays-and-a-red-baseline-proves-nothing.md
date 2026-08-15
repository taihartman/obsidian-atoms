---
title: "An allowlist guard decays, and a mutation check against a red baseline proves nothing"
date: 2026-08-14
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

## Prevention

- Guards default-deny. An allowlist only ever describes the past.
- Every exemption states the condition that would retire it, and is tested to still apply.
- Before rewording anything a user consented to, find the version that pins it. If nothing pins it,
  ask why not — that is a bug, not a licence.
- Ask what a string *is* before treating it as copy: a filename, a prompt, a cache key and a regex
  all read like prose in a diff.
- Prefer the real parser to a hand-rolled scanner when one is already a dependency.

## Related

- `test/copyVoice.test.ts` — the guard and its exemption tables
- `docs/voice.md` — the rule, plus the `·` separator and parenthetical conventions it leans on
- #497 unstamped egress ack · #498 prompt teaches em-dashed titles · #499 ` — continued` filename
