# Spec Amendments — Obsidian AI Linker Plugin

These are corrections to the handoff spec, ordered by how much they matter. Each one
either closes a gap in something load-bearing, resolves an internal contradiction, or
tightens wording that will otherwise be misread. Fold them into the handoff before build.

The three under "Blocking" change correctness or the safety model — do these. The
"Minor" ones are one-line clarifications.

---

## Blocking

### A. Define the processed-marker format precisely (amends Constraint #5, `parseCaptures()`)

**Problem.** Constraint #5 ("the backlink IS the processed marker") is the load-bearing
idea behind idempotency and self-healing, but the rule as written — *"a capture already
followed by an atom link is already processed — skip it"* — is ambiguous and collides
with user-authored links. People put wikilinks inside their own captures
(`"reminded me of [[that sleep idea]]"`). A parser that keys off "capture contains/is
followed by any wikilink" will mark those captures processed forever, and they silently
never become atoms.

**Decision.** The marker is a **plugin-owned continuation line** written directly beneath
the capture, not "any nearby wikilink." It has a fixed, machine-recognizable shape that
user prose does not naturally produce:

```markdown
- 14:32 sleep debt seems to plateau, not accumulate forever
	↳ [[Sleep debt doesn't accumulate linearly]] <!--linker-->
```

- The marker line is the capture's own line's indentation **+ one level**, starts with
  `↳ `, contains the atom wikilink, and ends with the HTML comment sentinel
  `<!--linker-->`.
- `parseCaptures()` treats a capture as **processed iff the immediately following line
  matches `^\s*↳ .*\[\[.*\]\].*<!--linker-->\s*$`**. Wikilinks *inside the capture text
  itself* are ignored for marker purposes — they're user content.
- The `<!--linker-->` sentinel is the actual key. `↳` is for human readability; the
  comment is what makes the match unambiguous and impossible to author by accident.

**Why this shape.** It's per-capture (preserves the self-healing property — a capture
added to an already-processed day just has no marker line yet and gets picked up next
run), it renders as a clean indented backlink under the thought, and it can't be
confused with anything a person types.

**Append note.** When a capture yields multiple atoms (rare, but possible if you ever
split one capture), write one `↳ … <!--linker-->` line per atom. Presence of *at least
one* marks the capture processed.

**Critical: the marker must cover ALL verdicts, not just `atom`.** Only atoms produce a
backlink, but `task` and `noise` captures still need a marker or they are *reprocessed on
every run forever* (see [Gap H1](#h1-non-atom-captures-must-still-be-marked)). For a
non-atom verdict, write a sentinel-only line with no link:

```markdown
- 14:32 buy oat milk
	<!--linker:task-->
```

`parseCaptures()` treats a capture as processed iff the following line matches the atom
marker **or** `^\s*<!--linker:(task|noise)-->\s*$`. This freezes the verdict at first
classification (a manual reclassify = delete the marker line). Without it, Constraint #5
only covers ~20% of captures and the idempotency story is false for the other 80%.

---

### B. Cut the `append` verdict from v1 (amends the classification contract, Constraints #1/#2/#4)

**Problem.** The entire safety model is: *the only things we ever write are (1) new files
in `Atoms/` and (2) a backlink line appended to daily notes.* Constraints #1, #2, and #4
all reinforce "never write into the user's hand-authored notes." The `append` verdict
breaks exactly that — it writes model-chosen text into an arbitrary existing user note
(`append_target`), at an unspecified location, with unspecified content. It's the single
riskiest write in the system and the least specified one.

**Decision.** Remove `append` and `append_target` from v1.

- The verdict enum becomes: `"atom" | "task" | "noise"`.
- A capture that "belongs with" an existing note becomes an **atom that links into that
  note** via the normal `links` mechanism (`{note, reason}`). You lose nothing — the
  connection still exists in the graph, with a reason — and the blast radius stays
  exactly two write types.

**Why.** "Where in the target note does this go?" is genuinely ambiguous (top? under a
heading? end?), and appending generated prose into notes the user wrote by hand is the
one move the rest of the spec spends three constraints forbidding. If `append` earns its
place later, it comes back with the same paranoia budget (explicit anchor, verbatim-only,
dry-run preview of the exact insertion) — not as a bare enum value.

---

### C. "Structured outputs guarantee parsing" ≠ "no error handling" (amends Wiring the model)

**Problem.** The spec says structured outputs are grammar-constrained and "guaranteed to
parse — do not write defensive regex, parse-retry loops, or try/catch around
JSON.parse." True for the *completion content once you have a 200 with a completion*. But
the same section also mandates retry-with-backoff on 429/5xx — which *is* error handling.
Someone will read "don't write try/catch" as "don't handle failures" and skip the
request-level path that the mobile silent-fail-and-retry-next-launch behavior depends on.

**Decision.** Split the two explicitly in the spec:

- **Parse layer:** trust the schema. No regex, no parse-retry, no try/catch around
  `JSON.parse` of the completion. ✅ as written.
- **Request layer:** full error handling required. `requestUrl` can throw (offline),
  return a non-2xx envelope (429/5xx/auth), or return an error body where you expected a
  message. Wrap the *call*, inspect status, retry 429/5xx with exponential backoff, and
  on final failure **fail silently and retry next launch** (this is the stated mobile
  behavior — it only works if the request layer is defended).

These are different layers; the "no defense" rule applies only to the first.

---

## Minor (one-line clarifications)

### D. Decide behavior for a link target that doesn't resolve

The model returns `{note: "Exact Existing Title", reason}`. It will occasionally return a
title that doesn't exactly match a real note (near-miss, stale, or lightly hallucinated).
**Decision: render the link anyway.** Unresolved `[[wikilinks]]` are first-class in
Obsidian — they show in the graph as unresolved and self-heal the moment a matching note
exists — so a slightly-off target is a soft failure, not a data problem. Do **not** drop
links or block on exact resolution. (This is consistent with "nothing is ever destroyed"
and "intelligence lives in links.")

### E. Verify SecretStorage on iOS at step 0, not late

The primary product path (enter key on phone → auto-run on phone) depends entirely on
`app.secretStorage` being backed on iOS. The spec flags "verify `getTags()` exists" but
not the mobile keychain path, which matters far more. **Confirm SecretStorage read/write
works in the iOS plugin sandbox during the spike (step 0)** — if it doesn't, the marquee
flow is broken and you want to know before building six steps on top of it.

### F. Acknowledge the concurrent-write dup race (don't fix it)

The claim "whichever runs first marks the capture, the other skips" holds only for
*serialized* writes. Two devices that both read an unmarked capture before either writes
will both create an atom. Probability is low (auto-run defaults off, single device) and
the cost is a duplicate atom in a quarantine folder — not data loss. **Leave it; just
state it as a known, acceptable edge** rather than claiming full idempotency across
concurrent devices.

### G. Rename `getUnprocessedDailyNotes()` to reflect capture-level scanning

The name plus a "last-run day" invites the day-level shortcut Constraint #5 explicitly
forbids. Correctness requires scanning **all past days for unmarked captures** on every
run; the last-run timestamp is only an auto-run *trigger* optimization, never a
correctness gate. Suggest `getPastDailyNotesWithUnmarkedCaptures()` (or just
`getPastDailyNotes()` and let `parseCaptures` do the skipping) so the name can't be read
as "days we've already finished."

---

## Additional gaps (second pass)

Found after the first review. H1 is load-bearing (fold into the marker design in §A); the
rest are concrete write-path and disclosure gaps.

### H1. Non-atom captures must still be marked

The big one. Constraint #5's "the backlink IS the processed marker" only holds for atoms —
`task` and `noise` produce no backlink, so they stay unmarked and get **re-classified on
every run, forever**. Since only ~1 in 5 captures is an atom, that's ~80% of a two-year
vault re-sent to the API every morning: a cost bomb, and a correctness break (model
variance can flip a `noise` to `atom` on re-run and spawn a stray atom). It can't be
dodged with a "skip old days" optimization because captures can be added to old days (that
is exactly what amendment G protects). **Fix: sentinel-only markers for non-atom verdicts**
— specified inline in §A. This is the single most important item in this second pass.

### H2. Title → filename: collisions and illegal characters

The `title` field is filename, display title, and wikilink target at once. Two problems the
spec never resolves:

- **Collisions.** Flat `Atoms/` requires unique filenames; the model *will* produce the
  same declarative claim twice (a recurring thought). Define the policy — do not fall into
  a silent `Title 1.md`. A same-title collision is the **consolidation signal** from the
  Knowledge-rot section: prefer routing it to a supersession/append-to-existing decision
  over minting a near-duplicate fossil.
- **Illegal characters.** Claims contain `:`, `?`, `/`, `"`; `/` breaks Obsidian paths.
  Sanitize the *filename* while keeping the full claim linkable — which likely requires an
  `aliases:` frontmatter entry so `[[full claim with a colon]]` still resolves. This
  **collides with "exactly these four frontmatter fields"** — resolve the tension
  explicitly (either allow `aliases` when sanitization changes the title, or forbid
  punctuation in titles at the prompt level).

### H3. `proposed_tags` has no surfacing mechanism

The model fills `proposed_tags` and the contract says "never auto-applied" — but nothing
says *where the user approves them*. With no surface, the field is inert. Collect proposed
tags across runs and surface them in the vocabulary settings pane ("12 captures proposed
`#health` — add to Active?"), reusing the existing checkbox UI.

### H4. Caching cost is mis-stated for daily-once usage

The 5-minute TTL means each morning's run starts **cold**: you pay a full cache *write* of
the entire vault context every day, never a cross-day read. Caching only amortizes *within*
a single morning's batch (1 write + N−1 reads across that day's captures). Fine at 500
notes; a growing recurring cost at 5k. Correct the spec's "break-even on the second hit" to
"within a run" and note that the daily cold-write cost scales with `buildContext()` size —
another reason the seam matters.

### H5. Undo (`rm -rf Atoms/`) orphans markers

Deleting `Atoms/` leaves every `↳ [[deleted atom]] <!--linker-->` marker in the daily
notes: captures marked-processed but pointing at nothing, so they never reprocess *and* the
links are dead. Either undo must strip markers too, or — cleaner — reprocessing detects
**"marked-as-atom but target missing → reprocess."** Ties directly to the H1 marker model.

### H6. Privacy disclosure (settings line, not code)

Every run ships the **entire title-graph plus each capture** to the API. For a vault of
personal thoughts, the user should explicitly know their whole idea-graph leaves the device
on each run. State it in settings next to the API-key field; it's a consent/disclosure gap,
not a technical one.

### H7. Preconditions and launch-load cap

- **Daily Notes core plugin** must be enabled (both the capture Shortcut and
  `obsidian-daily-notes-interface` depend on it). Detect and fail with a clear message
  rather than silently no-op'ing.
- **Cap per-launch work.** A month away shouldn't fire ~150 sequential calls at app-open.
  Process oldest-first with a ceiling; retry-next-launch drains the remainder.

---

## Knowledge rot: what v1 defends, what v2 must own

"Knowledge rot on recall" is the sharpest long-term risk to this system, and it's really
three distinct failure modes. The design **defends** one, is **neutral** on the second,
and structurally **amplifies** the third. Naming them tells the builder where the real
work is — and pulls exactly one cheap countermeasure into v1.

### The three rots

1. **Context rot — "I recall the words but not what I meant." → Defended.**
   Constraint #1 (verbatim, sacred body) keeps the original phrasing, hedges, and
   half-formedness. `source` (a wikilink) + the chronological daily-note spine give every
   atom a recovery path back to the day it was thought and everything around it. This is
   why `source` must stay a wikilink, not a string — it's the rot-recovery tool.
   **Usage rule to document for the user: on recall, trust the body, not the title.**

2. **Retrieval-quality rot — "recall gets noisier as the vault grows." → Neutral.**
   This is the `buildContext()` scaling seam, already punted correctly to a one-file swap.
   Not the pressing worry.

3. **Epistemic rot — "the vault fossilizes beliefs I've outgrown and hands them back with
   equal confidence." → Amplified. This is the one to design against.** Four compounding
   mechanisms:
   - **Declarative titles launder uncertainty into confidence.** The title-as-claim design
     is the product's strength *and* its rot amplifier: a 14:32 hunch becomes a permanent,
     confident-sounding claim, recalled months later as established fact.
   - **No consolidation.** Atomic-per-capture means a recurring thought becomes ~12 atoms a
     year, none canonical — recall yields *sediment, not synthesis*. The vault accretes and
     never distills.
   - **Append-only + nothing-destroyed means superseded beliefs stay equally live.** A
     changed mind writes a *new* atom; the old one still looks current. Nothing marks a
     claim as retired.
   - **AI-generated links are a false-edge vector a hand-built vault lacks.** A wrong
     "contradicts X" edge is trusted on recall. The `reason` being human-readable is the
     only defense — so it must actually be read critically, not trusted because written.

### The core insight

Epistemic rot is a **rehearsal** problem, not a retrieval one — and rehearsal is exactly
what **resurfacing** provides. So the rot worry and the "unbuilt third leg" (retrieval)
are the same problem from two ends: a capture-only system *maximizes* cognitive offloading
— you stop rehearsing because it's "safe" in the vault, and memory + note rot in parallel.

Critical distinction so this doesn't trip the spec's (correct) allergy to review queues: a
**resurfacing stream** (re-shows already-filed atoms; nothing accumulates) is not a
**review queue** (a growing backlog that rots and generates guilt). The stream sidesteps
the failure the spec fears while curing the rot the spec creates. **v2's defining question
is "how do we fight fossilization on recall," and the answer is a stream, not a queue.**

### The one anti-rot move that belongs in v1

**Make `classify()` hunt for supersession, not just relation.** An append-only vault's
only way to record a changed mind is a link from the new atom to the old one, tagged as a
revision. The classify prompt must explicitly ask: *"Does this update, revise, or
contradict an existing note's claim?"* and, when so, emit a link whose `reason` names the
relationship (*"revises [[old claim]]"*, *"contradicts [[old claim]]"*). This keeps belief
evolution visible in the graph instead of leaving two equally-live fossils. It's a prompt
change only — no new field, no queue, no body rewrite — so it's cheap enough to ship now.

### Deferred to v2 (document the boundary; don't build yet)

- **Age-on-recall:** surface "N months old, nothing has linked here since" using the
  existing `created` — flags rot candidates with no new field and no queue.
- **Consolidation pass that links, never rewrites:** cluster atoms making the same claim,
  generate a map-of-content note that *links* them (bodies untouched, #1 intact). This is
  the missing sediment → synthesis step, and it stays inside the safety model.
- **Resurfacing stream:** "on this day" / "atoms you haven't touched that connect to what
  you've been writing lately." Rehearsal without a backlog — the actual antidote.

---

## Net effect on the contract

The classification JSON shrinks to:

```jsonc
{
  "verdict": "atom" | "task" | "noise",
  "title": "Declarative claim, not a topic",       // required iff verdict == "atom"
  "tags": ["only-from-provided-vocabulary"],
  "proposed_tags": ["new-tag-needing-approval"],   // never auto-applied
  "links": [
    // reason must name the relationship, including supersession — see Knowledge rot §
    { "note": "Existing Title (rendered even if unresolved)", "reason": "revises [[…]] / contradicts [[…]] / relates because …" }
  ]
}
```

Two write types, one marker shape, three verdicts. The safety model is airtight once
`append` is gone and the marker is a sentinel rather than "any wikilink." The one addition
pulled forward for rot: `links[].reason` must name supersession when it applies, so an
append-only vault can still show a belief changing instead of fossilizing both versions.
