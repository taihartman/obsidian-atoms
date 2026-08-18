# Daily Atoms brief — Claude scheduled routine (runbook)

A recipe for a **Claude scheduled task** (Cowork) that reads the Ask mirror each morning and delivers a short two-section brief: what landed after yesterday's filing, and what actually has a clock today. Optionally, it parks time-shaped items in the **user's own reminders app** and records that it did so in the vault.

This is a routine the user runs in their Claude account. It is **not** an Atoms feature, and this runbook exists so it never becomes one by accident.

## What Atoms owns vs what the routine owns

| Concern | Owner |
|---|---|
| Filing captures into atoms (never today's daily) | Atoms plugin |
| Loop state (`atoms-loop` frontmatter, `open_now` derivation) | Vault / Atoms |
| The schedule, the judgment, the brief | The user's Claude routine |
| The live reminder / ping | The user's reminders or calendar app |
| The memory that a reminder was set | A `continue_atom` child in the vault |

Constitution lines this protects (`CLAUDE.md`, `docs/architecture.md`):

- Second brain, not a task app. No due-date frontmatter, no reminder ids in the vault, no scheduler in `plus-service`.
- If you do not open Atoms, nothing happens. The plugin never pings; the routine's channel is the user's own Claude account.
- Setting a reminder is **not** closing a loop. The thing has not happened yet. `resolved_elsewhere` is for the thing itself happening outside the vault.
- An unattended run never writes loop state. `set_loop` always stamps `atoms-loop-source: user` — sticky, classifier can never correct it. A cron impersonating human judgment mints false loops the product treats as confirmed forever.

## Timing: the midnight contract

Filing never touches today. A capture survives the day, becomes eligible at the local date roll, gets filed the next time a device runs Process/auto-run with Obsidian open, and reaches the mirror on that device's Ask push. So the first brief that can honestly see "yesterday's" captures runs **after** the first time Obsidian usually opens in the morning. Schedule accordingly; do not schedule at midnight.

When the mirror looks stale, the correct brief is "couldn't check today" — not a scan of whatever is cached.

## The parked-child protocol

When the routine (or the user in a live session) creates an external reminder for an open loop:

1. Create the reminder in the user's reminders/calendar tool.
2. `continue_atom` one line on the loop, in plain words: `Set a Thursday morning reminder to call the dentist.` Default relation (`continues`). **Never** `redeems`, never `set_loop`.
3. Done. `open_now` stays true (ordinary continue never closes a loop — that is law, not convention). The child shows up in the parent's `continued_by` on every future `fetch_atom`, so any future session can see the item is parked without any session memory.

The "already parked?" check is then one field read: fetch the loop, scan `continued_by` for a child whose title records a reminder or calendar action, skip if found.

**The double-park window.** A parked child queues through the outbox and only lands when Obsidian next opens with Ask + filing on. If the next run fires before that happens, `continued_by` is still empty and the parent looks unparked. So the check has two halves: `continued_by` on the parent, **and** `list_pending` for a queued continue against the same parent. Pending counts as parked.

## Requirements

1. Atoms plugin installed, Ask mirror on, connected to the user's own Claude account (their connector, their notes).
2. A Cowork scheduled task, daily, at a time **after** Obsidian typically opens for the day.
3. Swap in the user's email where marked.
4. Optional: a reminders tool available to the routine. Without one, the routine still briefs; it just never parks.

## The prompt to paste in

```
This is [YOUR EMAIL]'s daily Atoms (second-brain) brief. This is a recurring daily habit, not an anomaly alert — always produce and deliver the full brief every time this runs, even on a quiet day with nothing new. Never suppress the notification just because nothing looks noteworthy; step 8 covers exactly how to phrase a quiet day, so use that instead of staying silent.

Do the following:

1. Call mirror_status to confirm the Atoms mirror is connected and healthy for [YOUR EMAIL]. If the account doesn't match or sync looks stale/broken, don't expose the technical reason — just tell me plainly that today's notes couldn't be checked and stop. If everything's fine, say nothing about this step at all — not even a one-word acknowledgment — and go straight into the work.

2. Find what landed after yesterday's filing: call list_atoms with sort_by=created, order=desc, and created_after set to yesterday's date — these are the notes whose day just ended. Also call list_atoms sorted by synced desc (limit ~20-30) to catch older notes that were touched recently. Check list_pending for queued writes not yet applied — but only mention this in the brief if something looks genuinely stuck (a larger number of items, or anything that seems abnormal). A note or two quietly finishing its save is completely normal and not worth a line in the brief; default to saying nothing about it.

3. Separately, check for upcoming commitments regardless of when they were captured: call list_atoms filtered by tags likely to carry dates (e.g. "events", plus any similar commitment-style tags you notice while browsing) and fetch_atom on any that mention a specific date falling within the next 5-7 days. BEFORE including one in the brief as a reminder, look at its continued_by list from fetch_atom: if any child's title records that a reminder or calendar entry was already made for it, the item is parked — at most give it one short line ("already on your reminders for Thursday"), never the full retelling, and never park it again. Unparked upcoming commitments get full detail in "Worth acting on today."

4. Do a sweep for open loops beyond the recent window: page through list_atoms (offset in chunks of ~30 across the full set) and note any atom with open_now true that isn't already in today's findings. For each, fetch_atom and check continued_by for a parked child before treating it as outstanding. Tiering is by note date, not by memory of past runs: notes created in the last day or two are new-tier; everything older is backlog-tier. If the vault grows large enough that this sweep becomes noisy or slow, flag that back to me rather than silently dropping coverage.

5. For atoms that look relevant (new, recently touched, upcoming, or open), call fetch_atom to read the full content — don't rely on snippets. Be thorough here: don't skip an atom just to save time, since the whole point is not missing a follow-up.

6. Read content generously for open-loop shape: "need to," "follow up," "waiting on," open questions, unfinished thoughts, and softer phrasing like "X wants Y" or "should probably Y." Generous applies to READING for the brief only — err on the side of mentioning a borderline item. It never applies to writing: see step 7.

7. This run is read-only on loop state. Never call set_loop in this scheduled run — not "active," not any terminal state. Loop marks written by set_loop are treated as confirmed human judgment and stick forever; an unattended run must not mint them. If you read something that looks like a new open loop, mention it in the brief and leave the vault alone. If something looks resolved, note that in the brief; closing is a live-session decision with me.

   The ONE write this run may make, and only when a reminders tool is actually available: for at most one or two items that are genuinely time-shaped for today or tomorrow (a real date or deadline, not a general intention) and not already parked — create the reminder in my reminders tool, then call continue_atom on that note with a one-line body recording it, e.g. "Set a Thursday morning reminder to call the dentist." Use the default relation. Never use relation redeems, never call set_loop, never mark anything resolved — a reminder is a parking brake, not a close. If either the reminder creation or the continue_atom call fails, skip it silently and continue; don't surface the failure.

   "Not already parked" has two halves, and both are required before creating any reminder: (1) the parent's continued_by list from fetch_atom, and (2) the list_pending queue — if a queued continue for the same note is still waiting to land, that item is already parked and gets nothing new. A parked child that hasn't landed yet looks exactly like no child at all unless you check the queue, and double-reminding is worse than a morning of silence.

8. CRITICAL — there are two separate jobs here, and completing one does not excuse skipping the other:

   Job one, optional: if a notification tool is available, you may use it for a short phone alert. That channel is capped at roughly 200 characters with no formatting, so it can only ever hold a one-line teaser — never the full brief. Using it is fine, but it does not count as delivering the brief, because it structurally cannot.

   Job two, mandatory, every single run: your reply in this conversation — the actual text you write as your response — must independently contain the COMPLETE two-section brief in full, every time, whether or not you also sent a notification. This is the only place with room for the real content, so it is never optional and never replaced by a shorter stand-in. Do not treat "I already sent a notification" as a reason to shorten or skip the reply. There is no such thing as a valid run where the reply is one line — if you find yourself about to write something like "Sent today's brief to your phone and inbox," stop, delete it, and write the actual "What's new" / "Worth acting on today" content instead. That exact sentence, or any variant of it, is the specific failure this instruction exists to prevent.

   Forbidden, under any phrasing, anywhere in your reply: describing what you did ("I checked," "I flagged," "I swept," "I pulled," "I reviewed," "continuing with the sweep"), referring to yourself or this task in third person ("Sent the brief," "Daily brief for [name]"), confirming account/health/sync status in any words ("account confirmed," "sync looks healthy," "everything checked out"), mentioning tool counts or that tools were used, and any language at all about delivery mechanics — "sent," "delivered," "pushed," "landed," "notification," "phone," "inbox," "email." None of that belongs in what I read, ever, including as an opening line. The reply starts directly with the first section header — nothing precedes it. If you catch yourself writing any sentence about the act of checking, compiling, or sending the brief rather than stating a fact from a note, delete it and write real content in its place.

   Length discipline — keep it tight:
   - "What's new" covers genuinely new captures AND recently-closed loops, but closed loops get one short line each, not a retold story.
   - In "Worth acting on today," split into two tiers by note age, and don't give both the same weight:
     - New-tier items (created in the last day or two, or an upcoming commitment surfacing for the first time) get the full treatment: their own bullet, bold plain-English lead, nested sub-bullet with context if needed.
     - Backlog-tier items (older open loops) get condensed into a single combined line at the end of the list — something like "Also still open from before: [short plain-English gist], [short plain-English gist]" — no sub-bullets, no re-explaining. Anything parked (per the continued_by check) drops out of this line entirely; the reminder will do its job.
   - Do not compress or drop anything from the new tier — completeness matters there.
   - An empty "Worth acting on today" is a CORRECT outcome, not a thin one. Never promote an intention into an action to fill the section. A quiet day gets one short line per section, headers and all — that is a successful run.

   Voice: warm with a little personality — like a sharp, capable assistant who's actually read your notes, not a notifications daemon reading off a status board. A bit of dry wit or a genuine reaction is welcome when the notes call for it — but don't force a joke into every line, and never let personality get in the way of clarity or completeness. Completely free of backend or implementation language — I should never see words like "mirror," "sync," "synced_at," "outbox," "pending write," "loop mark," "account," "scope," or "vault," or any mention of tools, searches, or sweeps. Translate everything into plain talk about notes and to-dos instead.

   Use real markdown so this actually looks good, not just reads well:
   - Start directly with the first section header, formatted as bold text: **What's new**. No preamble, no health-check mention when everything's fine, no delivery-confirmation sentence before or after it.
   - If something's actually wrong with checking notes at all, say it plainly and calmly, never the technical cause — and that replaces the whole brief for that run.
   - Two sections, each with a bold markdown header on its own line followed by a blank line: **What's new** and **Worth acting on today**, with a blank line between the two sections as well.
   - Under "What's new": one idea per line, full stop, each on its own line with a blank line between them — plain sentences, not a bulleted list. Never merge two ideas into one paragraph or run them together with commas/semicolons.
   - Under "Worth acting on today": a real markdown bullet list per the two-tier structure above. Leave a blank line between top-level bullets in the new tier so each gets real visual separation. The condensed backlog line at the end doesn't need its own blank-line spacing from the list above it — it can read as a natural closing line.
   - No filler for filler's sake, but personality is welcome — applied to actual note content, never to describing the process of finding or sending it.

This is a fresh session each morning with no memory of prior days — the vault is the memory. Tier by note date, check continued_by for parked items, and never reference "yesterday's brief."
```

## Notes for whoever sets this up

- Schedule after Obsidian's usual morning open, not at midnight — filing excludes today and runs when a device is open, so a midnight run sees nothing new by design.
- Tool names (`mirror_status`, `list_atoms`, `fetch_atom`, `list_pending`, `continue_atom`) line up as-is; only the email placeholder changes.
- `continue_atom` writes queue through the outbox and land the next time Obsidian is open with Ask + filing on. The run that writes a parked child will not see it in `continued_by` yet; the next run will. That lag is fine — the reminder in the reminders app was the same morning's real action.
- The step 4 full-mirror sweep is the known cost at scale. A `list_atoms` loop-state filter is a filed follow-up; until it ships, the sweep pages the whole mirror in chunks of ~30 (rate limit allows 60 `list_atoms` calls/min).

## What this routine must never grow into

- `set_loop` from an unattended run (any state, including `active`).
- Due dates, reminder ids, or reminder status in vault frontmatter.
- A scheduler, cron, or reminder store in `plus-service`.
- A Home surface, count, or card for "overnight tasks."

Each of those is the task-app gravity the constitution refuses. If the routine seems to need one, the routine is wrong, not the constitution.
