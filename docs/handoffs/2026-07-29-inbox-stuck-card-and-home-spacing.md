# Handoff — Inbox "needs a fix" card, home spacing, and the missing iOS capture

**Date:** 2026-07-29
**Repo:** `~/StudioProjects/obsidian_plugin` (Atoms Obsidian plugin)
**Origin default branch:** `master`
**Repo state at handoff:** clean, on `feat/ask-mcp-2026-07-28`
**Reported from:** iOS, Obsidian mobile, Atoms home sidebar + daily note

> Written from a session that was mistakenly running in the Aploma
> `expense_tracker` worktree. No code was changed anywhere. Everything below is
> read-only investigation, verified against live source and the live vault.

---

## What the user reported

Three things, in their words:

1. The Inbox card says **"4 captures need a fix"** and they have no idea what
   that means or why it is saying it. It also said **"1 waiting to file"**.
2. The **Atoms header is cramped** — the "Atoms / Your second brain" title sits
   too tight against the ⋯ / ◎ / ⚙ buttons — and the gap **between the Inbox
   card and the "Also about Nichita" card** is too small, so the two read as one
   block instead of two distinct things.
3. They used the **iOS capture shortcut yesterday and the note never appeared in
   the daily note**. Today the same shortcut worked.

Issues 1 and 3 turned out to be the same bug. See below.

---

## ROOT CAUSE (verified) — issues 1 and 3 are one bug

The capture shortcut wrote four inbox lines in shapes the parser cannot read.
They are still sitting in the vault right now.

### The four stuck captures

Live from `~/Documents/Remote Vault/Atoms System/Inbox.md` (tail):

```
- 7/28/26, 12:00 PM
7/28/26, 9:38 AM Test capture
- 7/28/26, 12:00 PM
7/28/26, 9:50 AM Test again
- 2026-07-28T12:00:00-04:00
2026-07-28T19:32:00-04:00 New test
-  Test
```

That is exactly 4 unparseable bullets, which is exactly the "4 captures need a
fix" the user saw. Not a counting bug — the count is honest.

### Why each one fails

The stamp regex is ISO-8601-only and **requires whitespace plus trailing text**
(`src/pipeline/inbox.ts:44-45`):

```js
/^((\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2}))\s+(.*)$/
```

| Bullet | Why it fails |
|---|---|
| `- 7/28/26, 12:00 PM` (×2) | US-locale short date, not ISO 8601. No regex match at all. |
| `- 2026-07-28T12:00:00-04:00` | Valid ISO stamp but **nothing after it** — the trailing `\s+(.*)` never matches, so a bare stamp is unparseable. |
| `-  Test` | No stamp at all. |

`parseStamp` returns `null` → `unparseable: true` (`src/pipeline/inbox.ts:206`)
→ the drain skips it → **it never reaches the daily note**.

### The second failure shape: content on its own unindented line

Look at the structure. The shortcut wrote a **bullet holding only a timestamp**,
then the real timestamp + content on a **following unindented line**:

```
- 2026-07-28T12:00:00-04:00
2026-07-28T19:32:00-04:00 New test
```

`isContinuationLine` requires indentation, so line 2 is not folded into the
capture. It does not start with a bullet either, so `parseInboxCaptures` skips
it entirely (`src/pipeline/inbox.ts:170-175`). **The user's actual text is
invisible to the pipeline.** That is the note that "never appeared."

### Why it worked today

Today's captures are well-formed ISO with inline text and filed cleanly:

```
- 2026-07-29T10:59:47-04:00 Bring both underpants wallet thingys
	<!--atoms:filed-->
```

So the shortcut is emitting the right shape *now*. **Open question for the next
session:** was the shortcut edited/reinstalled between yesterday and today, or
are there two shortcut versions on the device, or does the date formatter fall
back to locale-short under some condition (fresh install, locale change, a
Shortcuts app update, running from Lock Screen vs Share Sheet)? Start at
`docs/capture-shortcut.md` and compare the shipped recipe to what is on the
device. Do not close this as "transient" — a silently-dropped capture is the
worst possible failure for a capture tool.

### "1 waiting to file"

Pending, not broken. `pending` is a capture that parsed fine but had not been
routed yet; it clears itself on the next drain (see the doc comment at
`src/home/atomsHomeData.ts:452-457`). By the time the vault was read for this
handoff, everything but the four unparseable ones carried
`<!--atoms:filed-->`. Almost certainly self-resolved. Low priority, but worth a
glance at whether the drain runs eagerly enough that a user ever sees this line
in normal use — if it is always transient, showing it may be pure noise.

---

## Issue 1 (the card) — what is actually wrong with it

Two separable problems. Don't conflate them.

**a) The copy describes an internal parser state.** "Needs a fix" is the
`unparseable` count, surfaced at `src/home/atomsHomeData.ts:470-475`. It tells a
user nothing about what to do. It is technically accurate and practically
useless.

**b) The card is a dead end.** Verified at
`src/home/atomsHomeView.ts:1863-1876`: the card is a `flatCard` containing two
`<p>` elements — an "Inbox" eyebrow and the summary text. **There is no click
handler and no link.** So the product tells you four things are broken, does not
say which, and gives you nowhere to go. That is the whole of the user's
complaint: it only creates anxiety.

Note the design intent in the comment just above it (`atomsHomeView.ts:1862`):
"a capture the drain could not route stays invisible until someone opens the
inbox note — surface it here instead." The intent is right. The execution stops
one step short — it surfaces the *number* without surfacing the *captures*.

**Suggested direction (not decided — brainstorm it):** make the card tappable
straight into `Atoms System/Inbox.md` (`INBOX_NOTE_PATH`,
`src/pipeline/inbox.ts:25`) scrolled to the first unparseable line, and rewrite
the copy in terms of what happened to the user rather than what the parser did.
Something closer to "4 captures could not be filed — tap to see them." Run the
copy through the `voice-designer` skill and the interaction through
`design-critic` before writing code.

**Also worth considering:** several of these are recoverable without a human.
`7/28/26, 12:00 PM` is a perfectly readable date — the parser just does not
accept that format. Widening `STAMP_RE` to accept locale-short stamps, or adding
a repair pass that rewrites them to ISO, would drop the count from 4 to 1 on the
user's real data. Decide whether "needs a fix" should mean "needs a *human*" or
whether the drain should try harder first. This is the higher-leverage fix and
it is a real design decision, not a copy tweak.

---

## Issue 2 (spacing) — untouched, standalone

Not yet investigated. Two gaps from the screenshot:

- Header: "Atoms" / "Your second brain" vs the ⋯ / ◎ / ⚙ button row above it.
- Between the Inbox card and the "Also about Nichita" card.

Rendering lives in `src/home/atomsHomeView.ts`; the stuck card carries
`atoms-home-inbox-stuck` (+ `is-repair` when `needsRepair`) at
`atomsHomeView.ts:1866-1869`. Find the matching CSS and check the card stack's
vertical rhythm. Smallest and most independent of the three — safe to do first
if you want a quick win, but it does not need to block the bug work.

---

## Suggested order

1. **The shortcut / drop bug (issue 3).** Highest stakes: captures are being
   silently lost. Figure out why the shortcut emitted two bad shapes.
2. **Recovery for the 4 stuck captures.** The user's real content
   (`New test`, `Test capture`, `Test again`) is stranded. Decide: widen the
   parser, add a repair pass, or give the card a manual fix affordance.
3. **The card copy + drill-in (issue 1).** Falls out of #2 — once you know
   whether these are auto-recoverable, you know what the card should say.
4. **Spacing (issue 2).** Independent, do whenever.

---

## Verified file references

| What | Where |
|---|---|
| Stamp regex (ISO-only, requires trailing text) | `src/pipeline/inbox.ts:44-45` |
| `parseStamp` | `src/pipeline/inbox.ts:135-156` |
| `parseInboxCaptures` (skips unindented non-bullet lines) | `src/pipeline/inbox.ts:165-215` |
| `unparseable: parsed === null` | `src/pipeline/inbox.ts:206` |
| `INBOX_NOTE_PATH` | `src/pipeline/inbox.ts:25` |
| Banner copy / counts | `src/home/atomsHomeData.ts:459-487` |
| Card render (no click handler) | `src/home/atomsHomeView.ts:1862-1876` |
| Existing tests for the summary copy | `test/atomsHomeData.test.ts:522-553` |
| Shortcut recipe doc | `docs/capture-shortcut.md` |
| Prior QA in this exact area | `docs/qa/2026-07-28-ios-capture-inbox-drain-world-class-qa.md` |
| Live inbox (user's vault) | `~/Documents/Remote Vault/Atoms System/Inbox.md` |

## Caveats on what was verified

- Only the **tail** of `Inbox.md` was read. There may be older unparseable
  captures above; the count of 4 matched the tail exactly, so probably not, but
  confirm before claiming the file is otherwise clean.
- The four failure explanations are read off `STAMP_RE` and `parseInboxCaptures`
  by inspection. Nothing was executed. **Write a failing test against those four
  literal strings first** — it both proves the diagnosis and becomes the
  regression test.
- Whether the shortcut still misbehaves is **unknown**. Today's captures are
  well-formed; that is one data point, not a fix.
