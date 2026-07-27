# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Capture pipeline

### Capture
A single top-level daily-note bullet (plus indented continuations) that may be classified into an atom, task, or noise. Capture **body** is sacred: the model does not rewrite it into the atom file beyond trivial whitespace.

### Marker (sentinel)
A plugin-owned line **after** a capture’s extent that proves the capture was processed. Atom markers use a ↳ wikilink plus an HTML comment; task and noise use comment-only forms. Wikilinks *inside* capture text are not markers.

### Atom
A flat note in the configured atom folder: declarative title, reason-bearing links, tags, and a verbatim capture body. Placement is never folder-intelligent in v1.

### Daily note (past vs today)
Past dailies are the normal process surface; **today is excluded by default** so in-progress capture is not classified mid-day. Manual “include today” / Preview today / Process today is an explicit force for testing.

### Unprocessed
A capture with no marker after its extent and non-empty body. Empty bullets (e.g. lone `- `) are not work items.

## Classification

### Verdict
One of **atom**, **task**, or **noise**. Every verdict still gets a marker so the capture never re-enters the queue. Product stance: **atom** for memory-worthy dumps (including list/media items); **noise** for pure logistics; **task** is soft-retired (legacy markers still mean processed; classify should rarely emit task).

### Dry-run (Preview)
Classify without writing atoms or markers. Results may open in a card modal; vault stays unchanged.

### Process (write path)
Classify, create atoms when warranted, append markers for all three verdicts. Multi-capture runs must tolerate line drift (bottom-up order, re-locate, already-has-marker).

### Auto-run
Device-local gated background process of past captures. Must stay silent—no per-item progress UI or toast spam. Stamps last-run day only after past work is drained (not on failed attempts); same-day re-entry allowed while past unprocessed remain. Never includes today's daily.

### Automatic filing
Product name for opt-in auto-run when surfaced on home (one-tap enable + status). Same device-local flags and privacy ack as Auto-run.

## Product UI

### Atoms home
Mobile-first `ItemView` leaf: library, wait/setup cards, and the primary surface for Preview/Process controls and **live run progress**.

### Run progress
In-home feedback during a long Preview/Process: phase, `N of M`, capture snippet, bar, then a done/error summary. Broadcast from the plugin to open home leaves; not driven by auto-run.

### List dump
A capture that is keepable list/media/preference material (e.g. show or movie to watch). First-ship product intent: one **atom per dump**, not append-into a Movies note and not a task marker.

### Resurfacing (stream)
Zero-guilt home card that re-shows filed atoms for rehearsal (retrieval practice). Cue priority: **on-this-day** (calendar) → **connected** (shared links with recent atoms) → **quiet** (older / less touched). Open / Next; soft throttle; never a review queue.

### Soft throttle
Device-local “already shown recently” map so the same atom is not re-picked for several days after Open or Next.

### Mind-change (belief rehearsal)
A For you cue when a hard supersession pair exists (`revises` / `contradicts` in link reasons). Hero shows the older atom’s body snippet first and a quiet “later you wrote…” line to the newer claim. Highest priority when eligible; at most one hero per day; no due queue. Soft death (hiding superseded claims) is separate and deferred.

### Citator ribbon
One-line subsequent-history chips on Atoms home when an open atom participates in hard supersession edges. Home product chrome only — not injected into the Obsidian editor.

## People (linking)

### Person hub
A vault note treated as a person entity for linking. Matching and link repair prefer hub titles and match keys over free-form model inventiveness. Identity lives in the hub note, not in name-tags.

### Person hub invite
Calm Atoms home card (**Add {Name}?**) after Process/Update when a high-confidence person has no hub. Human accept creates a minimal person note; never silent auto-create. Soft `[[People]]` is fallback only until accept or a real hub exists.

### Peer link (pre-hub)
Plugin link-prose between generated atoms that share the same high-confidence missing person (or later project) label before a hub note exists. On invite accept, peers and soft bucket links **upgrade** to the new hub. Soft buckets are never identity peers.

## Flagged ambiguities

- “Linker” remains in some marker HTML comments (`<!--linker-->`) from early naming; product name is **Atoms**.
- “Processed” means “has a plugin sentinel,” not “became an atom.”
