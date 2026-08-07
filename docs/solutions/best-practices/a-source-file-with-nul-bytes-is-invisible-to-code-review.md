---
title: "A source file containing NUL bytes is invisible to code review"
date: 2026-08-07
category: best-practices
module: plus-service/ask/expandSearch
problem_type: best_practice
component: plus-service
applies_when: "You build a dedup or cache key by joining fields in a template literal and reach for a raw separator instead of an escape sequence — or more generally, any time a source file could contain a literal control byte."
resolution_type: process_change
severity: high
tags:
  - code-review
  - git
  - grep
  - binary-files
  - dedup-key
  - egress
  - tooling-gap
---

# A source file containing NUL bytes is invisible to code review

## The problem

`plus-service/src/ask/expandSearch.mjs:296` built the dedup key for a queued expansion job by
joining three fields in a template literal, with a literal null byte sitting between each field as
the separator — an actual control character embedded in the source, not a written-out escape
sequence describing one. Byte-for-byte that is still a legal JS string — V8 does not care — so the
file ran fine and its tests passed fine. What it broke was every tool a human uses to *see* the
file.

Commit `0526ff3` fixed it by replacing each raw control byte with the standard four-hex-digit
Unicode escape for the null character, spelled out as ordinary source characters instead of an
actual control byte:

```js
function expandKey(job) {
  return `${job.email}<NUL-ESCAPE>${job.path}<NUL-ESCAPE>${job.contentHash}`;
}
```

(`<NUL-ESCAPE>` above stands in for that escape — deliberately not spelled out literally here,
because typing the real escape sequence into a markdown file is exactly the kind of thing that can
silently round-trip into a real control byte again, which is worth knowing on its own.) Same
runtime string, same dedup behavior — the fix is purely about what the source bytes are, not what
the program does.

## What the NUL bytes actually did

Two tools, two different silent failures:

- **`git diff` stopped diffing it.** Git's binary-file heuristic looks for a NUL byte in the first
  chunk of a blob. Once found, every diff against that file — including the one in the PR that
  fixed it — collapses to `Bin 10441 -> 14354 bytes`, `0 insertions(+), 0 deletions(-)`. Verified on
  this repo: `git diff 0526ff3~1 0526ff3 -- plus-service/src/ask/expandSearch.mjs` prints exactly
  that. A reviewer scrolling a PR sees a binary-diff placeholder where 300+ lines of JavaScript used
  to render, and nothing about that placeholder says "one byte away from being text."
- **`grep` returned nothing, not an error.** On this machine's BSD `grep`, running
  `grep -n "function" expandSearch.mjs` against the NUL-carrying blob printed **no output and no
  "binary file matches" notice** — exit code 1, same as a clean non-match. `strings` and `grep -a`
  both find the same text instantly. The failure mode is not "grep tells you it skipped a binary
  file"; it is "grep tells you nothing was there."

Both of these are silent. Nothing errors, nothing warns, no linter flags it — the file just quietly
stops being reviewable by the two tools reviewers reach for first.

## Why this file, specifically, made it expensive

`expandSearch.mjs` was not a peripheral file. Per the commit that fixed it, it held the Anthropic
egress call (`bodySlice`, first 4000 chars of note body, POSTed at `expandSearch.mjs:114-131`), the
job worker pool, and the rate limiter — the single most security-relevant file on the branch. It
had already passed through one full review round while carrying the NUL bytes, and defects that a
line-by-line read would normally catch survived that round inside it:

- **A plan-mandated grounding guard (KTD6) was never implemented.** `parseExpandResponse` accepted
  `tags` and `bodySlice` in its context argument and never read them, so an ungrounded model phrase
  could enter the search index unfiltered. The fix added the `>=4`-char token-overlap check at
  `expandSearch.mjs:107-131`.
- **A queue kept sending note bodies after the user wiped their data.** The wipe route deleted the
  stored rows and returned, but an already-queued expansion job closed over the plaintext body in
  memory and never re-read the store, so the egress happened anyway — after the user had explicitly
  asked for it to stop.

Neither defect is subtle once you can see the code. Both survived a round of human review because
the file the reviewers needed to read rendered as `Bin 10441 -> 14354 bytes` in their diff tool.

## The rule

**Never embed a raw control byte in source when an escape sequence produces the identical runtime
value.** There is no case where the raw byte buys anything — the escaped and raw forms compile to
the same bytes the interpreter sees, and only the escaped form stays legible to every tool
downstream of the file: `git diff`, `grep`, a PR viewer, a reviewer's editor.

The detection is cheap and worth doing proactively, not just after the fact:

- Add `*.mjs text` (or the equivalent glob for your source extensions) to `.gitattributes`. This
  forces git to diff the file as text regardless of its binary heuristic, so a stray control byte
  shows up as a real diff instead of a `Bin` placeholder — the review surfaces the problem instead
  of hiding it.
- A pre-commit hook that scans staged text-extension files for a raw NUL byte catches it at
  authoring time, before it ever reaches a PR.

## Why this is worth naming on its own

The asymmetry is the whole lesson: this is not a bug that produces a wrong answer, a crash, or a
failing test — the runtime behavior was correct throughout. It is a bug that removes a file from the
set of things a human reviewer can actually read, without telling anyone it did that. A security
review process built entirely on "read the diff" and "grep for the pattern" has a blind spot exactly
the shape of this failure, and the file it blinded here was the one holding the external API call.

## How it probably got in — and how it nearly got in again

Nobody types a raw control byte on purpose, so "don't do that" is useless advice unless you know how it
happens. We found out by accident: while writing *this doc*, an agent tried to quote the escape
sequence literally and the file landed on disk containing a **real NUL byte** instead. `file` reported
`data`, not text. It took two rewrites and a byte-level count to get a clean doc, and the fix was to
describe the escape rather than type it.

That is almost certainly the original mechanism. An escape sequence written through a JSON-encoded tool
pipeline can decode on the way to disk, so an author who *meant* to write the escape gets the byte it
denotes. The author sees correct-looking source in their editor and correct runtime behavior; only the
bytes on disk differ.

Two things to carry forward:

1. **Any agent-authored file that mentions a control-character escape is a candidate.** Check the bytes,
   not the rendering. `file <path>` reporting `data` on something you know is source is the fastest tell.
2. **The verification has to be byte-level, and the obvious shell check is a trap.** `grep -c $'\x00' <file>`
   looks authoritative and is worthless: the shell truncates NUL inside an argument, so the pattern
   degrades to the empty string and matches every line. We ran exactly that during this work and it
   returned the file's line count — which reads as alarming confirmation and means nothing. Use
   `perl -0777 -ne 'print scalar(() = /\x00/g)' <file>`, a Python byte count, or `file`.

## See also

- [`a-golden-value-in-the-same-file-is-defended-only-by-a-comment`](a-golden-value-in-the-same-file-is-defended-only-by-a-comment.md)
  — a different way a guard turns out weaker than the team believes it to be; same family of "the
  mechanism looked like enforcement but wasn't."
- PR #340, commit `0526ff3`.
