# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Product surfaces

### Field notes
The public marketing email list on tryatoms.app (user-facing name). Occasional maker notes on a second brain in real life - not a changelog drip. Voice and promise: `docs/voice.md`. Ops: `docs/runbooks/atoms-notes-list.md`. Engineering env keys may still say `ATOMS_NOTES_*`; Resend segment may still be named “Atoms Notes.”

### Field notes archive
Public tryatoms.app pages at `/notes/` listing full past Field notes (same substance as email). SSOT: `docs/field-notes/published/`. Send = publish JSON; live after master Pages deploy. Plan: `docs/plans/2026-08-06-003-feat-field-notes-archive-plan.md`.

### Short version
The quiet summary box on a Field note (`tldr` block). Always **leads** the letter, in email and on the archive: the renderer hoists it above the story, so draft order cannot place it at the end. There is no jump link to it - mail clients strip in-message anchors, and a summary that comes after the thing it summarises is decoration.

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

### Vault link
How the Android companion holds onto a vault: a persisted SAF tree URI plus a relative path. Play will not grant all-files access to a capture app, so there is no silent whole-phone scan. The user picks the vault folder, or a parent such as Documents, and the app lists vaults under that grant. A leftover absolute path from an older all-files install is ignored, so it reads as unlinked rather than as a link that silently fails.

### Held / unparseable
Drain outcomes that are neither filed nor failed. **Held** = stamped ahead of the clock, so no daily exists to file into yet. **Unparseable** = no readable stamp. Both stay in place, counted and surfaced on home rather than dropped or guessed at.

## Classification

### Verdict
One of **atom**, **task**, or **noise**. Every verdict still gets a marker so the capture never re-enters the queue. Product stance: **atom** for memory-worthy dumps (including list/media items); **noise** for pure logistics; **task** is soft-retired (legacy markers still mean processed; classify should rarely emit task).

### Open loop
A note that records an **intention** (or open commitment), not the finished substance — captured on purpose for future-self. Frontmatter marks it as intention-shaped (`loop_source` inferred or user; user is sticky). **Open-now** is derived: intention mark present and no **redeeming** child. Ordinary continue/detail never closes it. Not a defect, stub, or Home unfinished queue. Parent body and FM stay put on close; substance lives on the redeeming child. Agents must never pitch an open-now loop as a finished asset. Requirements: `docs/plans/2026-08-11-003-feat-open-loops-plan.md`.

An external reminder or calendar entry is a park, not a close: record it as an ordinary continue child. `resolved_elsewhere` means the thing itself happened outside the vault, not that a reminder was set.

### Dry-run (Preview)
Classify without writing atoms or markers. Results may open in a card modal; vault stays unchanged.

### Process (write path)
Classify, create atoms when warranted, append markers for all three verdicts. Multi-capture runs must tolerate line drift (bottom-up order, re-locate, already-has-marker).

### Auto-run
Device-local gated background process of captures inside the filing window. Must stay silent—no per-item progress UI or toast spam. Stamps last-run day only after past work in the window is drained (not on failed attempts); same-day re-entry allowed while unprocessed work remains inside the window. Never includes today's daily.

### Automatic filing
Product name for opt-in auto-run when surfaced on home (one-tap enable + status). Same device-local flags and privacy ack as Auto-run.

### Filing window
The bound every unattended and catch-up filing pass is scoped to: from the day the device stamped automatic filing enabled, forward, never including today. Fails closed — an absent, malformed, or tampered stamp resolves to today rather than to "no bound," which would be the full-history sweep the window exists to end. The stamp only moves forward and only persists on a device that actually enabled filing; disabling preserves it, and a read-only surface (home's refresh, a status command) must read the bound without stamping it. History outside the window is reachable only through the priced backfill offer, never through an unattended pass.

### Backfill
The attended, priced pass that files past captures from *outside* the filing window — the only route to history, since no unattended pass will ever reach there. It is offered rather than simply run: the user sees how many captures it covers and what they cost before anything is sent, and the offer is bounded so one tap cannot spend a whole period's allowance. Two engines sit behind one gate — a metered per-capture path for a managed subscription, and a batched path for a user's own API key — and both stop at the window's edge, so a capture is never filed twice at two different prices. The count quoted at the gate is a ceiling the run will not exceed, even if new captures land while the gate sits open; the overflow is spillover for a later run, not a silent overspend.

Backfill, Process, Update notes, and Auto-run are mutually exclusive: each claims a shared in-flight state for its whole duration and refuses to start while another holds it. Claiming, not merely checking, is what makes this symmetric — a pass that checks without claiming is protected from the others but invisible to them, leaving the reverse order unguarded. A backfill's claim spans its confirm gate as well as its writes, so a gate left unanswered blocks the other passes until it is answered or dismissed.

## Product UI

### Atoms home
Mobile-first `ItemView` leaf: library, wait/setup cards, and the primary surface for Preview/Process controls and **live run progress**.

### Run progress
In-home feedback during a long Preview/Process: phase, `N of M`, capture snippet, bar, then a done/error summary. Broadcast from the plugin to open home leaves; not driven by auto-run.

### List dump
A capture that is keepable list/media/preference material (e.g. show or movie to watch). First-ship product intent: one **atom per dump**, not append-into a Movies note and not a task marker.

### Resurfacing (stream)
Zero-guilt home card that re-shows filed atoms for rehearsal (retrieval practice). Cue priority: **on-this-day** (calendar) → **connected** (shared links with recent atoms) → **quiet** (older / less touched). Open / Next; soft throttle; never a review queue.

### Together news
Calm Home card when an **accepted hub** gained a hard-linked member the user has not been told about. Names the new atom and the hub. Open goes to the hub note. Open and **Not now** both consume that join. Not a directory of the sibling set, and not a standing card merely because an orbit exists. Person hubs are in scope. First-time missing hubs stay **hub association invite**. Catalog of members lives in the **managed hub block**. Listing stays default-off; the on-ramp is one first-run **hub list preview** on calm Home. Outranks the resurface stream, including **mind-change**, while a join is waiting. Plan: `docs/plans/2026-08-20-1043-feat-together-news-hub-catalog-plan.md`.

### Soft throttle
Device-local “already shown recently” map so the same atom is not re-picked for several days after Open or Next.

### Mind-change (belief rehearsal)
A For you cue when a hard supersession pair exists (`revises` / `contradicts` in link reasons). Hero shows the older atom’s body snippet first and a quiet “later you wrote…” line to the newer claim. Highest For-you cue when **Together news** is not waiting; at most one hero per day; no due queue. Soft death (hiding superseded claims) is separate and deferred.

### Citator ribbon
One-line subsequent-history chips on Atoms home when an open atom participates in hard supersession edges. Home product chrome only — not injected into the Obsidian editor.

### Row grammar (settings)
The rule that every settings row visibly declares what kind of thing it is, through its right edge. It governs the row; a **setting group** governs the block a run of rows is composed into. Seven kinds: **setting** (toggle or input — the only kind that may carry a toggle), **destination** (chevron), **action** (accent button), **destructive** (warning button), **form** (an input plus the one button that commits it), **form-actions** (an input plus several buttons that each commit it), **status** (muted text, no control). No row wears two kinds. A section-intro paragraph is prose, not a row, and is exempt. A **confirm sheet** is not a kind at all — it is what a destructive row may open, and it lives beside the row primitives rather than in the screen that calls it.

A **form** row is the exception that proves the rule rather than a hole in it: its field and its button are one grammar — "type this, then commit it" — the way a destination row's name and chevron are one, so the button may only submit the field beside it and can never be an independent action. It exists as its own kind because the alternative, an optional button on the setting row, is one PR away from a button on a toggle row. That is also how the grammar grows: when the rule keeps forcing an awkward shape at one kind of call site — here, two cards where a field and its commit button belonged in one ([#347](https://github.com/taihartman/obsidian-atoms/issues/347)) — it is missing a kind, not too strict.

**form-actions** is that same growth for one email and three commits (sign-in, trial, promo code). Three form rows would be three email boxes. Each button still only submits the field beside it.

The rule governs how a row is drawn, not whether the surface is really a settings screen. Applied mechanically to a list of inbox items, it produced one row per item plus a second row per item carrying nothing but its own button label — the shape [#342](https://github.com/taihartman/obsidian-atoms/issues/342) removed. When a section is a queue rather than a set of settings, give the section one control instead of giving every item two rows.

### Setting group
The block a run of settings rows is composed into: a header above it, one inset surface holding the rows, and an optional footer under it. The footer says what is behind the rows rather than repeating them, which makes it a claim about the group's contents — a footer that names a row the group did not render is a defect, not a wording choice, and a group whose rows are conditional needs a footer that is conditional too.

The block owns the fill, the corners and the hairlines between rows; its rows are flush rows inside it, not cards. That inversion is against Obsidian's grain, which styles each row as its own floating card on mobile, so composing rows into a group means un-styling the child chrome rather than only styling the parent.

Groups are how the main screen states the product's three **legs** — Capture, File, Resurface — in the product's own order, numbered in their headers. A group is not a **destination**: it is a division of one screen, reached by scrolling rather than by navigating.

### Destination (settings)
A settings sub-screen reached from a chevron row and left by a back row. A re-render of the same settings surface under a route value — not a new Obsidian view, and not a modal used as navigation. Leaving and reopening settings always returns to the main screen.

### Setup step
The single unfinished thing standing between this vault and filing — Daily Notes not turned on, or nobody chosen to do the filing — or nothing, once neither is outstanding. One computation, rendered twice: as Atoms home's first-day card and as the settings screen's status line, so the two surfaces cannot name different next steps.

It is ordered, not a set: Daily Notes comes first because there is nothing to file until captures have somewhere to land. It is also not the negation of **automatic filing** — a device can hold an outstanding setup step while already filing, since switching the Daily Notes core plugin off leaves an earned filing window and a live egress grant untouched. A surface that reads "setup unfinished" as "has never filed" will describe a silence window the device already spent.

### Confirm sheet
The question a destructive row asks before it acts — the destructive row's other half: the row declares the kind, the sheet asks the question. Distinct from a **consent sheet**, which authorizes an ongoing capability; a confirm sheet authorizes one act and records nothing. It names what will be destroyed and how much of it, and it holds its row for the whole exchange, so a double-tap cannot stack two questions. Cancel, Escape, and clicking outside are all the same answer: no.

Not every destructive row gets one. The line is reversibility: a recoverable act (signing out) goes straight through, an act whose result cannot be got back (wiping the cloud copy, dismissing the proposed queue) asks first — and that judgment is made about the act at its real size, not about the smaller act it may have replaced.

### Proposed tag
A tag a classify run suggested but that is not yet in the active vocabulary. Inert: it is never applied to an atom until approved, so a queue of them changes nothing on its own. It is an inbox item, not a setting — which is why the settings row grammar governs how it is *drawn* but not what its section is *for*.

Dismissal is close to permanent even though nothing is destroyed in the vault: a processed capture carries a marker and is never classified twice, so a dismissed tag returns only if some capture not yet written proposes it again.

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
Calm Atoms home card (**Add {Name}?**) after Process/Update when a high-confidence person has no hub. Human accept creates a minimal person note; never silent auto-create. Soft `[[People]]` is fallback only until accept or a real hub exists. The person beat of **hub association invite**.

### Hub association invite
One Home card after Process/Update whenever a high-confidence atom↔hub pairing is noticed and not yet established — person, list, watch list, or later kinds. Existing vault note first (**Add to Show list?**); create only if none (**Add {Name}?** / **Make {label}?**). Pick a different note when the guess is wrong. **Not now** dismisses. Accept writes the atom into the **managed hub block**; never silent auto-create. After that hub is accepted, later matching atoms land with no ask. Not a Settings roster. Plan: `docs/plans/2026-08-17-1540-feat-hub-association-invite-plan.md`. **Watchlist membership** (Movie list / Show list) is a named work the user means to watch; family follows the work, not the word `movie` in the sentence. `#movie` on a snack or outing is not membership. Plan: `docs/plans/2026-08-17-2132-fix-watchlist-hub-membership-plan.md`.

### Peer link (pre-hub)
Plugin link-prose between generated atoms that share the same high-confidence missing person (or later project) label before a hub note exists. On invite accept, peers and soft bucket links **upgrade** to the new hub. Soft buckets are never identity peers.

### Qualifying hub
A vault note that may receive a **managed hub block** when Hub projection is on: a **person hub**, a named list hub (Show list / Movie list / Watch list, even with no `##`), or another non-person note outside the list-path safety denylist that is hard-linked from atom link-prose, has ≥1 `##`, and meets the non-person write brake (≥2 members, matching `hub-section`, or existing managed delimiters). Hand-authored list notes (e.g. Movies) need no marker field. Dailies, `Atoms/`, templates/archive never qualify. Classify may see a broader set of headed notes for first-link formation; that set is not the same as write targets.

### Managed hub block
Plugin-owned region at the end of a **qualifying hub** note, delimited by `<!-- atoms:generated v=1 -->` … `<!-- /atoms:generated -->`. Lists hard-linked atoms under H2 headings the user already wrote (or **Unsorted**). Human prose outside the delimiters is never rewritten. Membership comes from atom link-prose hard links to the hub, not a separate `hub:` field. Optional atom frontmatter `hub-section` (schema `hub_section`) places under a matching H2 **per linked hub**; invalid/missing → Unsorted on that hub. Opt-in via Settings (**List atoms on hub notes**, default off). Existing vaults get one first-run **hub list preview** on calm Home that turns listing on. Soft entity keys still do not alone light Also about orbits; a real titled hub note can still be hard-linked and projected. Not Home citator chrome. If Ask mirror is enabled, updated hub bodies sync vault→cloud like other linked hubs.

### Hub list preview
Calm modal before a bulk hub-list write (first calm Home on-ramp, turning the setting on, or **Refresh hub lists**). Dry-run of which hubs would change and counts by heading; **Include Unsorted** is pass-only. **Update lists** writes; **Not now** skips the bulk fill but leaves the setting on so Process still projects. First-run **Not now** also marks current members told so they are not **Together news**. Refresh **Not now** does not. Everyday Process/Update does not open the preview.

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
Public Streamable HTTP MCP endpoint (Plus host) that **Claude and ChatGPT** connectors call (same `{plusBase}/mcp` URL). Read tools plus optional write-via-outbox. Connector auth is MCP OAuth bound to Plus identity, not the plugin’s device-local `sess_` token as the connector credential. OAuth redirect allowlist includes Claude callback + ChatGPT `chatgpt.com/connector/oauth/*` (and legacy ChatGPT redirect). Self-host the same stack: [`docs/ask-self-host.md`](docs/ask-self-host.md). `{plusBase}` is a constrained trust boundary, not free text: it is the hosted default when unset, `https://` on any host, or `http://` **only** on loopback — every Plus call attaches the device session token to it, so anything else is refused rather than swapped for the hosted default, and a refused base publishes no MCP URL at all.

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

### Ended period vs spent meter
Two unrelated situations the service reports with the same exhausted status: the billing or trial **period ended** (no allotment is coming back without a new subscription), and this period's **filing allotment is spent** (it refills on the next billing date). One status name, opposite remedies — Subscribe against a lapse, wait or top up against a spent meter.
*Avoid:* treating "exhausted" as a single state.

The distinction is not recoverable from the status alone; it takes the status **and** the period end date together, and only a service-confirmed status may be read as a lapse. A period end date alone cannot decide it, because on a recurring plan that date is a *renewal* — a device that has not refreshed through one holds a past date for a perfectly current subscriber. Learning: `docs/solutions/logic-errors/a-device-may-not-assert-an-entitlement-the-server-has-not-confirmed.md`.

The **service** holds both halves at once, so it can simply decide: `subscriptionLive` (`plus-service/src/store/shared.mjs`) is the one home for the split, and every Ask/MCP gate asks it. A spent meter revokes nothing — reading a brain that is already mirrored and already paid for has nothing to do with the filing meter — while an ended period still revokes. Only `/v1/classify` charges the meter, which is why an atom Claude creates through the Ask outbox is not a filing.

### Entitlement snapshot
The device's stored copy of what the service last said about the account — status, allotment remaining, period end, plan — stamped with when it was confirmed. Every entitlement surface reads this, not the network.

Its age is load-bearing, because expiry is the one entitlement change nothing announces: no push, no webhook, and the **post-checkout resume poll** is armed only while a checkout is in flight. A snapshot confirmed *before* its own period end therefore cannot say what happened at that boundary — the period may have lapsed, renewed, or converted from a trial — and the honest response is to refresh rather than infer. A device may narrow what it claims on stale evidence; it may never assert an entitlement verdict the service has not given.

### Issuing base / issued base
The Plus server a session was actually acquired from, stamped onto the session at sign-in and never rewritten. It is a *branded* type minted only by the helper that made the acquisition round trip, so a base read from settings is not assignable to it — presence and provenance both fail at build time rather than at runtime. Absent means **unknown**, never the hosted default: the plugin does not guess where a session came from.
*Avoid:* treating "the configured base" and "the base that issued this session" as the same value. They are equal on almost every device and the whole gate exists for the case where they are not.

### Verified base
The base most recently *proven* to hold a given session — the mutable half of the pair whose immutable half is the **issued base**. Two fields rather than one, because a single mutable stamp erases its own evidence: after one tunnel rotation nothing on disk would record that the session began at a private host. The issuer gate compares against this; audit and warning copy read the issued base.

### Issuer gate
The check that runs before anything carrying vault content leaves the device: is the base we are about to talk to the one that holds this session? A match against the stamp answers it for free. A mismatch asks the resolved base to name the account (`GET /v1/me`) and re-stamps only if the address matches. Refused and unreachable both **fail closed** — "I could not check" is not "go ahead".
*Avoid:* calling it authentication of the host. An email address is not a secret, so it stops a host that accepts every token without knowing the account, not a targeted host that knows it. Learning: `docs/solutions/security/a-2xx-is-not-proof-that-this-server-issued-your-session.md`; the remaining gap is issue #529.

### Content-bearing vs content-free (Plus calls)
The axis that decides whether the **issuer gate** applies. Content-bearing calls carry something from the vault — capture text, atom bodies, vault paths, or free text like an outbox ack's `plan.reason` — and are gated at the call site and backstopped again where the request is built. Content-free calls carry the session token and nothing else; they are out of scope and still reach whatever base resolves, as does the gate's own probe, because a check cannot verify the host it is asking.
*Avoid:* sorting a call by how its payload *looks*. An id-and-status ack that also carries a reason string is content-bearing, and a screen that publishes an origin for a third party to authenticate against is egress with extra steps. Sorting on the wrong axis is what both #500 misses had in common.

Content-free is also not the same as harmless: such a call is ungated, so if it *writes* local state the gate later reads, it is inside the trust boundary regardless of what it sends.

## Flagged ambiguities

- “Linker” remains in some marker HTML comments (`<!--linker-->`) from early naming; product name is **Atoms**.
- “Processed” means “has a plugin sentinel,” not “became an atom.”
- Dev “Obsidian MCP” (Local REST) is agent tooling only — not Atoms Ask.
- “I handled it” after setting a reminder is not `resolved_elsewhere` — that state means the thing itself happened outside the vault.
