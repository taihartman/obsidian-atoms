# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Product surfaces

### Field notes
The public marketing email list on tryatoms.app (user-facing name). Occasional maker notes on a second brain in real life - not a changelog drip. Voice and promise: `docs/voice.md`. Ops: `docs/runbooks/atoms-notes-list.md`. Engineering env keys may still say `ATOMS_NOTES_*`; Resend segment may still be named “Atoms Notes.”

### Field notes archive
Public tryatoms.app pages at `/notes/` listing full past Field notes (same substance as email). SSOT: `docs/field-notes/published/`. Send = publish JSON; live after master Pages deploy. Plan: `docs/plans/2026-08-06-003-feat-field-notes-archive-plan.md`.

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

### Capture inbox
`Atoms System/Inbox.md` — the single append-target for external capture (iOS Shortcut today). Each line is a top-level bullet opening with an ISO 8601 stamp carrying its own offset, so a capture belongs to the day and time it was made, not the day it drains. The plugin creates the note and bookmarks it on load; it never deletes or rewrites a line.

### Capture stamp
The ISO 8601 local datetime an external capture tool writes at the head of each [Capture inbox](#capture-inbox) line, carrying its own UTC offset (`2026-07-28T17:23:34-04:00`). It is the wire contract between that tool and the plugin: it decides which day's daily a capture files into, and its seconds are the dedupe key that keeps two captures made in the same minute distinct. Byte-exactness is load-bearing — an offset without a colon, or a locale short date, parses as nothing and the capture sits unfiled.

### Drain
Move every pending inbox capture into **its own day's** daily as a `- HH:MM body` bullet, then mark it filed. Append-only and idempotent: a capture already present in its daily is re-marked, not duplicated; future-dated and unparseable lines are held and counted, never guessed at. Runs on layout-ready and via `atoms:drain-inbox`; concurrent callers join one in-flight pass.

### Filed marker
`<!--atoms:filed-->` after an inbox capture's extent — the inbox's own sentinel, distinct from daily `<!--linker:*-->` markers and unknown to `parse.ts`. Presence is a **region** property (scan to the next top-level bullet), so drifted whitespace never re-files a capture.

### Held / unparseable
Drain outcomes that are neither filed nor failed. **Held** = stamped ahead of the clock, so no daily exists to file into yet. **Unparseable** = no readable stamp. Both stay in place, counted and surfaced on home rather than dropped or guessed at.

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

### Row grammar (settings)
The rule that every settings row visibly declares what kind of thing it is, through its right edge. Five kinds: **setting** (toggle or input — the only kind that may carry a toggle), **destination** (chevron), **action** (accent button), **destructive** (warning button), **status** (muted text, no control). No row wears two kinds. A section-intro paragraph is prose, not a row, and is exempt.

### Destination (settings)
A settings sub-screen reached from a chevron row and left by a back row. A re-render of the same settings surface under a route value — not a new Obsidian view, and not a modal used as navigation. Leaving and reopening settings always returns to the main screen.

### Consent sheet
The disclosure a gated feature presents **at the moment it is enabled**, replacing a permanent acknowledgment row. Only an explicit accept records the acknowledgment; Escape, clicking outside, and closing the settings tab all count as declining and leave the feature off. Each granted acknowledgment stays inspectable and revocable afterwards from a Review row, whether or not the feature it gates is currently on, and whether or not the wording it was granted against is still current — for as long as that acknowledgment still permits anything. The egress, Ask-privacy, and vault-write consents are three separate sheets and never authorize one another.

### Egress permission
The device-local permission to send capture text to the paid classification API. It is satisfied by **either** of two independent acknowledgments — the egress consent sheet, or the catch-up notice — so the notice alone keeps the catch-up path open even when the consent-sheet grant has lapsed.

Because it is a union, revoking it is not the mirror of granting it. Enabling a gated feature may demand the strictest, current-wording grant; the Review row that revokes must appear while **any** grant still permits, and withdrawing clears all of them at once. A revocation surface keyed to one member of the union is a live grant with nothing on screen to take it back.

### Catch-up notice
The egress grant carried by the run that files a backlog on demand (Sync everything now). It is a separate record with its own disclosure — not the same acknowledgment the consent sheet writes — and it is not wording-versioned. It permits **any** catch-up pass, including the unattended one that runs when you return to Obsidian, so it is not the manual-only grant its name suggests. It outlives turning automatic filing off, and only an explicit withdrawal clears it.

### Acknowledgment wording version
A consent record that stores the wording it was granted against, not merely that it was granted. Rewriting a disclosure retires every acknowledgment stamped against the old text, so the feature it gates stops counting as consented and asks again.

A retired acknowledgment stops permitting on its own, so nothing is stranded by retiring it. But where a retired grant sits alongside a still-live one, the Review row must remain — labelled as being against earlier wording — so the user is never told they agreed to text they did not read.

## People (linking)

### Person hub
A vault note treated as a person entity for linking. Matching and link repair prefer hub titles and match keys over free-form model inventiveness. Identity lives in the hub note, not in name-tags.

### Person hub invite
Calm Atoms home card (**Add {Name}?**) after Process/Update when a high-confidence person has no hub. Human accept creates a minimal person note; never silent auto-create. Soft `[[People]]` is fallback only until accept or a real hub exists.

### Peer link (pre-hub)
Plugin link-prose between generated atoms that share the same high-confidence missing person (or later project) label before a hub note exists. On invite accept, peers and soft bucket links **upgrade** to the new hub. Soft buckets are never identity peers.

### Managed hub block
Plugin-owned region at the end of a **person hub** note, delimited by `<!-- atoms:generated v=1 -->` … `<!-- /atoms:generated -->`. Lists hard-linked atoms under H2 headings the user already wrote (or **Unsorted**). Human prose outside the delimiters is never rewritten. Membership comes from atom link-prose hard links to the hub, not a separate `hub:` field. Optional atom frontmatter `hub-section` places an atom under a matching H2 when that heading exists on that hub; invalid/missing → Unsorted. Opt-in via Settings (**List atoms in person notes**, default off). Not Home citator chrome. If Ask mirror is enabled, updated hub bodies sync vault→cloud like other linked hubs.

## Ask (pull recall + optional write)

### Atoms Ask
Product name for **pull recall** (and optional **write-via-outbox**) via remote MCP: the user chats in Claude or ChatGPT; Atoms exposes tools over an optional cloud mirror of `Atoms/`. Not an in-plugin chat UI. Distinct from Local REST / dev MCP agent tooling.

### Atom mirror
Hosted, opt-in copy of flat `Atoms/*.md` (title, tags, link reasons, verbatim body) used for Ask search/fetch. Vault remains source of truth; sync is vault→cloud only. User can wipe. Not full-vault backup; not dailies. See **Ask mirror parity**.

### Ask mirror parity (hybrid C)
Architecture that keeps Claude’s copy current while Obsidian is open online: **vault events** (2s debounce) + **delta reconcile** (local hash evidence only) + **Sync now** full orphan cleanup. No background mirror interval. Evidence map is **device-local** (`localStorage`), not synced `data.json`. Detail: `docs/architecture.md` § Ask mirror sync; learning: `docs/solutions/architecture-patterns/ask-mirror-parity.md`.

### Hash evidence map
Per-device map of vault paths this device last successfully mirrored (`atoms-ask-mirror-hashes-v1`). Background deletes only remove paths present in this map but missing from the vault — so a half-synced second device cannot wipe the cloud. Force/Sync now does not rely on this alone; it sends full `keepPaths`.

### Delta reconcile
Normal `syncAskMirror({ force: false })`: upsert dirty atoms + `mirror/delete` for hash-evidence orphans. Used on vault events, layout-ready, Process/Update, outbox land. Never full remote inventory delete.

### Force reconcile / Sync now
`syncAskMirror({ force: true })`: upsert dirty + `mirror/reconcile` with complete vault `keepPaths` (chunked accumulate if >500; empty set requires `confirmEmpty`). Removes server paths this device never hashed. Settings copy must warn multi-device incomplete vaults.

### Mirror deletion gate
The check that stands between a sync pass and removing anything from the cloud copy. It compares the evidence that would survive this pass against a floor derived from what this device has mirrored before, and refuses the deletion — while still letting the uploads through — when the vault looks too incomplete to be trusted. A refusal is never silent: it is recorded, surfaced in Settings, and cleared by the next pass that converges.

Only a **deletion confirmation** overrides a refusal, and only on a user-forced sync. The gate poses a dialog naming the concrete counts, and treats anything other than an explicit confirmation — declining, dismissing, or walking away — as "leave the cloud untouched." A confirmation is bound to the pass that asked for it: once that pass stops waiting, the dialog is withdrawn rather than left on screen, because a prompt authorising an irreversible delete must never be clickable after the delete it authorises can no longer happen.

### Ask outbox
Cloud queue of create/continue intents from Claude. Plugin pulls with Plus `sess_`, creates new files under `Atoms/` (`generated-by: ask-mcp`), mirrors them, then acks. Pending ≠ filed. Requires **Allow filing** in Settings.

### Ask write / continue
MCP tools `create_atom` and `continue_atom`. Continue = new child atom + relation link (same spirit as #16); parent body never modified. Ask-origin atoms are first-class in Library (`linker` \| `ask-mcp`).

### Home Continue
From an open atom on home, **Continue** sets a **device-local pending parent** and opens today’s daily. The next **today** capture that successfully files (Process / Process today / auto on that day) gets parent in classify context and a reason-bearing link on the **new** child atom. Parent body never modified. Pending is one-shot and same-device (not synced). Preview injects parent for dry-run but does not clear.

### Remote MCP (Ask)
Public Streamable HTTP MCP endpoint (Plus host) that **Claude and ChatGPT** connectors call (same `{plusBase}/mcp` URL). Read tools plus optional write-via-outbox. Connector auth is MCP OAuth bound to Plus identity, not the plugin’s device-local `sess_` token as the connector credential. OAuth redirect allowlist includes Claude callback + ChatGPT `chatgpt.com/connector/oauth/*` (and legacy ChatGPT redirect). Self-host the same stack: [`docs/ask-self-host.md`](docs/ask-self-host.md).

### Ask MCP pairing code
Short-lived, single-use code minted from a verified Plus plugin session so connector OAuth can bind `mcp_` tokens to the **Plus account email** without opening that inbox in the OAuth browser. Parallel to email + magic link on the authorize page. Does not create secondary emails or share the mirror with a second tenant. Requirements: `docs/plans/2026-08-04-002-feat-ask-mcp-pairing-plan.md`.

## Plus (billing + entitlement)

### Stripe incident
A durable row in `stripe_incidents` recording one way the entitlement grant failed — deduped on `(kind, day bucket, Stripe id)` so a flood collapses to one row per kind per day. The record; the ops email is the **interrupt**. Kinds are frozen strings in `store/shared.mjs`; values are persisted and never renamed.

### Incident class (A / B / C)
Split by what an operator must do. **A** — unauthenticated garbage, no verified signature and so no Stripe id (`webhook_reject`). **B** — we processed the event and could not act (missing/mismatched email, unknown price, unattributable cancellation). **C** — Stripe delivered it and we never processed it (`missing_webhook`); invisible in-process, findable only by the sweep.

### Reconciliation sweep (Stripe)
Offline pass over Stripe's own event list asking `hasProcessedEvent` — "Stripe considered it delivered, we have no record." The oracle is our processing log, never account entitlement, which has other legitimate causes in both directions. Report-only by default; `--repair` is opt-in, restores entitlement only, and reports `repaired` only where a grant actually happened. Unrelated to Ask's **Delta reconcile**. Learning: `docs/solutions/architecture-patterns/a-signal-nobody-receives-is-not-a-signal.md`.

### Post-checkout resume poll
Device-local poll that runs after Stripe Checkout until entitlement appears, then announces readiness once. Armed by the **awaiting-checkout** flag and driven by four deliberately uncoordinated triggers — load, a 5s interval, `visibilitychange`, and `focus`. The redundancy is the point: no request carries a timeout, so independent retries are what survive a cold-started backend. Two invariants pull opposite ways — announcing is *atomic* (one notice per checkout), reaching the backend is *redundant* (never one shared attempt). Silence is its worst failure, not duplication: this is the only thing that tells a paying user their entitlement landed. Learning: `docs/solutions/logic-errors/a-shared-promise-dedupes-the-retries-too.md`.

### Awaiting checkout
Device-local flag marking "this device opened Checkout and has not yet seen entitlement." Set only when checkout returned a URL, and cleared by whichever poll first observes an entitled status. Device-local, not account state — a checkout completed on another device never clears it here, which is why the **post-checkout resume poll** alone cannot rescue a cross-device signup.

## Flagged ambiguities

- “Linker” remains in some marker HTML comments (`<!--linker-->`) from early naming; product name is **Atoms**.
- “Processed” means “has a plugin sentinel,” not “became an atom.”
- Dev “Obsidian MCP” (Local REST) is agent tooling only — not Atoms Ask.
