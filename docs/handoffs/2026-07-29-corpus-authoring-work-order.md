---
work_order_date: 2026-07-29
branch: claude/catch-up-cost-study
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
tracking: https://github.com/taihartman/obsidian-atoms/issues/168
audience: external authoring agent (OpenCode / xai/grok-4.5)
status: dispatched
---

# Work order — author the life-story corpus

You are writing a fiction corpus: **three years of one person's phone captures**, as JSON. This is
research data for a retrieval experiment. No plugin code is involved and you must not touch any.

## Read these first, in order

1. `scripts/fixtures/README-chrono-corpus-schema.md` — **the brief.** Read it completely. It is the
   spec; this file only adds the mechanics. Where they differ, the brief wins.
2. `scripts/validate-corpus.mjs` — the gate you must pass. Read it so you know exactly what is
   measured. Do not modify it.
3. `scripts/fixtures/chrono-corpus-a.json` — the previous corpus, for register only. Its captures
   read correctly; its *structure* has four holes the brief exists to fix (0% deixis-only captures,
   short captures always noise, 77% hub-mediated pairs, no near-duplicates). Do not copy its
   content, its threads, or its cast.

## Scope — do exactly these two deliverables, in order

### Deliverable 1: the story bible

Write `scripts/fixtures/chrono-corpus-bible.md` per brief §5. It contains:

- **Cast** — 10–20 recurring people, places and projects, each with the exact title string used in
  `linksToExisting`. These strings are reused byte-for-byte by every capture file.
- **Alias table** — for each cast member subject to vocabulary drift (brief §4A), the sequence of
  names it is called by and the approximate date each takes over. This is the most important table
  in the document: it is what makes the same referent unfindable by keyword six months later.
- **Timeline skeleton** — 24 threads, each with start / quiet / resume / end dates and its owning
  file (E, F, G, H — six threads each). At least four threads go dark 8+ months and resume; at
  least two end and are never mentioned again; one or two run all three years at low frequency.
- **Collision list** — the shared-vocabulary pairs from brief §4C: which word, which two threads,
  and a note that captures across that pair must NOT be linked.

Invent a specific person with a specific life. Not a persona sketch — a life with particular jobs,
particular rooms, particular arguments. Generic lives produce generic captures.

**Stop after the bible and commit it.** Do not start Deliverable 2 in the same run.

### Deliverable 2: the capture files

Only on a second, separate instruction. Four files, one per agent prefix:

| File | Prefix | Captures |
|---|---|---|
| `scripts/fixtures/chrono-corpus-e.json` | `E` | ~375 |
| `scripts/fixtures/chrono-corpus-f.json` | `F` | ~375 |
| `scripts/fixtures/chrono-corpus-g.json` | `G` | ~375 |
| `scripts/fixtures/chrono-corpus-h.json` | `H` | ~375 |

~1,500 captures total, ~1,200 of them `atom` and ~300 `noise`. Each file covers the full
2023–2025 span — **do not divide the story by time period**, that destroys the interleaving.

Write each file in **monthly chunks**, appending as you go, so no single write is enormous. Keep
ids and dates ascending within the file.

## Hard rules

- **`linksToEarlier` is the answer key and you are the only one who knows it.** Declare a link when
  two captures genuinely belong together — one continues, contradicts, or refers back to the other.
  Never add a link because the words match; never withhold one because they do not. Getting this
  field honest is the entire value of the job.
- **Links stay inside your own file.** You cannot reference another file's ids. Cross-file structure
  comes from shared `linksToExisting` hub titles only.
- **Hit the §4 quotas.** They are not suggestions; the gate enforces most of them and rejects the
  corpus otherwise.
- Never `git reset`, `git checkout -f`, `git rebase`, or force-push.
- Never overwrite an existing file to start clean — extend it.
- **No AI attribution in commit messages.** No `Co-Authored-By`, no "Generated with". This is a hard
  project rule.
- Do not push to `master`. Commit on the current branch only.
- Do not modify anything under `src/`, `docs/plans/`, `STATUS.md`, or `scripts/validate-corpus.mjs`.
- Do not invoke, load, or run any skill, slash command, or plugin. This is a plain authoring run:
  read with your read tool, write with your write tool.
- Do not stop to check in or describe what you will do next. You are running headlessly and there is
  no human to hand back to.

## Tripwires — stop and report instead of proceeding

- Anything that would change files under `src/`.
- The validator failing in a way you would need to edit the validator to fix.
- Needing to break the brief's quotas to make the story work.

## Verification gate — run this yourself before reporting

```bash
node scripts/validate-corpus.mjs scripts/fixtures/chrono-corpus-e.json \
  scripts/fixtures/chrono-corpus-f.json scripts/fixtures/chrono-corpus-g.json \
  scripts/fixtures/chrono-corpus-h.json
```

Zero FAILs required. WARNs are approximations — report them, do not contort the story to game them.
For the bible run, the gate does not apply; instead confirm every alias-table entry has at least two
names and a date, and every thread has an owning file.

## Required completion report

Append a `## Completion report` section to **this file** and commit it. It must state:

- the commits you made (SHA + subject)
- the exact commands you ran and their output
- the final validator line (`N captures · N pairs · N FAIL · N WARN`)
- anything you could not finish, and why
- any tripwire you hit
- **every place you interpreted the brief rather than followed it**

Do not report success without the validator output pasted in.
