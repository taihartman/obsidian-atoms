---
title: Even G2 Atoms companion design
date: 2026-09-08
type: design
status: user-approved
branch: feat/even-g2-atoms
---

# Even G2 Atoms companion design

**Lane:** full feature

**Doc review:** full before implementation

**Product decision:** Atoms Plus is required for v1

## Goal

Build an Even Hub app for the Even Realities G2 that lets an Atoms Plus subscriber:

1. Dictate and create a real atom.
2. Ask a grounded question across mirrored atoms.
3. Browse recent atoms and read their verbatim bodies.

Obsidian remains home and the vault remains the source of truth. The glasses provide a quiet capture and recall surface, not a second notes system.

## V1 product contract

### Root actions

The glasses app opens to three actions, in this order:

1. **New atom**
2. **Ask atoms**
3. **Recent atoms**

### Create a real atom

The user records a thought with the G2 microphones. Speech-to-text produces the atom body. Atoms Plus generates only the title, tags, and reason-bearing links. It never rewrites the transcript.

The confirmation names the proposed note:

> **Create “The G2 app confirms atom creation”?**

Pressing create queues the structured atom through the existing Ask outbox. The Obsidian plugin creates the file under `Atoms/`, then mirrors it back to Atoms Plus. The glasses distinguish the two states:

- **Queued** means Atoms Plus holds the creation request.
- **Saved to Atoms** means the vault accepted the atom and the mirror confirmed it.

If Obsidian is closed, the request stays queued. The glasses never claim the atom is saved before the vault confirms it.

### Ask atoms

The user dictates one question. Atoms Plus searches the Ask mirror, fetches the authoritative bodies for the strongest matches, and generates a short answer from that evidence.

Every answer includes source atom titles. Selecting a source opens its verbatim body. If the mirror does not contain enough evidence, the app says so and shows the closest matches instead of filling the gap with model knowledge.

V1 questions are one-shot. The app does not preserve a conversation or infer context from earlier questions.

### Recent atoms

The app lists recently created mirrored atoms. Selecting an atom opens its body. Swiping moves through longer bodies in readable pages and returns to the same list position.

## Scope boundaries

V1 includes:

- Atoms Plus pairing and revocation
- G2 microphone capture
- Speech-to-text through a server-managed provider
- Atom preparation, confirmation, and outbox delivery
- Grounded question answering with visible source titles
- Recent-atom browsing and verbatim reading
- Local recovery for a completed recording that has not reached Atoms Plus
- Simulator, private build, and physical G2 testing

V1 excludes:

- Local-only vault access
- Always-listening or background recording
- General-purpose AI chat
- Conversation history
- Editing or deleting existing atoms
- Continuing, revising, or contradicting an existing atom from the glasses
- Hub creation or hub-list modification
- Images, camera input, notifications, and audio answers
- A public Even Hub release before private hardware testing passes

## Alternatives considered

### Recommended: Even Hub app through Atoms Plus

The Even Hub WebView sends audio and requests to Atoms Plus. The service handles transcription, retrieval, synthesis, authentication, and outbox delivery. This route works while Obsidian is closed and keeps provider secrets off the phone.

### Rejected for v1: capture to `Atoms System/Inbox.md`

A raw capture queue would reuse the existing filing pipeline, but it would not fulfill the primary promise: create a real atom from the glasses. The user would finish dictating without a title, an atom, or a clear creation result.

### Rejected for v1: direct MCP client

The Ask MCP tools expect an AI client to construct titles, tags, links, and tool calls. They also use an OAuth redirect flow shaped for Claude, ChatGPT, Grok, and local Codex clients. Making the G2 app impersonate that layer would complicate setup and expose agent-oriented response shapes on a small display.

### Rejected: local Obsidian bridge

Even Hub apps have no filesystem access. A LAN bridge would require Obsidian to remain open and reachable, would behave differently across iOS and Android, and would make local network and TLS setup part of capture.

## System architecture

```text
Even G2
  display, touch input, four microphones
        |
        | Bluetooth through the Even Realities App
        v
Even Hub WebView on the phone
  companion UI, local recovery, scoped device grant
        |
        | HTTPS and WebSocket
        v
Atoms Plus
  G2 auth, speech-to-text, atom preparation,
  grounded query, mirror reads, outbox writes
        |
        | existing Ask mirror and outbox
        v
Obsidian Atoms plugin
  creates the atom under Atoms/, then mirrors it
        |
        v
Obsidian vault, source of truth
```

The G2 app belongs under `companion/even-g2/`, alongside the existing Android and iOS companions. It is a separate Vite and TypeScript package built with the Even Hub SDK.

Atoms Plus owns the remote G2 surface under `plus-service/src/g2/`. The implementation should reuse Ask mirror retrieval and Ask outbox validation rather than fork their rules.

## Device and display contract

The initial build pins the documented current toolchain as of 2026-09-08:

- `@evenrealities/even_hub_sdk` `0.0.14`
- `@evenrealities/evenhub-cli` `0.1.14`
- `@evenrealities/evenhub-simulator` `0.9.3`

The display is a 576 by 288 pixel monochrome canvas. A full text container holds roughly 400 to 500 characters. Native lists hold up to 20 items with 64 characters per item. V1 therefore uses short lists, short answers, and paginated bodies.

The root page follows the Even Hub exit convention and always uses the system exit confirmation. Frequent transcript and status updates use in-place text updates to avoid hardware flicker.

## Pairing and authorization

The G2 app does not depend on a browser redirect or a pasted API key.

1. Obsidian Settings offers **Connect G2** for a verified Atoms Plus session.
2. Atoms Plus mints a short-lived, single-use pairing code.
3. The user enters that code in the phone-side companion UI hosted by the Even Realities App.
4. Atoms Plus exchanges the code for a G2 device grant bound to the same Plus account.
5. The app stores a rotating refresh credential in its sandboxed phone storage and uses short-lived access tokens for requests.

The G2 token family is distinct from `sess_` and `mcp_` credentials. Suggested scopes:

- `g2:read` for recent atoms and source bodies
- `g2:query` for grounded answers
- `g2:create` for atom preparation, commit, and delivery status

Obsidian Settings shows the connected device and offers **Disconnect G2**. Revocation invalidates access and refresh credentials without wiping the Ask mirror or changing other connected AI clients.

Pair codes follow the existing Ask protections: short expiry, one active code per account, hash at rest, consume once, rate-limit mint and redeem, and never log plaintext.

## Atom creation flow

### Record

The app starts microphone capture only after a deliberate New atom action. The G2 SDK supplies PCM audio at 16 kHz, signed 16-bit little-endian, mono. The app streams audio to a server-managed speech provider through Atoms Plus and renders interim text on the glasses.

The app keeps only one active recording. It stops the microphone on cancel, exit, permission loss, abnormal lifecycle events, or successful finalization.

### Prepare

When recording ends, the app sends the final transcript to the atom preparation endpoint. Atoms Plus uses the same product rules as existing atom creation:

- Body equals the final speech-to-text transcript.
- The model may generate a declarative title.
- The model may propose retrieval tags.
- The model may propose links only to known mirrored titles and must state a reason.
- The model cannot add claims to the title or body.

The response includes a proposed title and the structured fields needed by the Ask outbox. The glasses show the title for confirmation. Tags and links remain out of the tiny confirmation surface in v1, but the phone-side companion view may show them for diagnosis during private testing.

### Confirm and commit

Pressing create sends the prepared atom with a client-generated idempotency key. Atoms Plus validates it and enqueues a normal create-atom outbox item. Retrying the same request returns the original item rather than creating a duplicate.

Choosing **Try again** discards the prepared result and starts a fresh recording. Leaving the confirmation screen creates nothing.

V1 does not offer undo after commit. The app therefore keeps the single confirmation before creating the outbox item.

### Delivery status

The G2 app can poll the committed outbox item by its opaque id. Status mapping:

| Server state | Glasses copy |
|---|---|
| accepted, pending, or claimed | **Queued** |
| applied and mirror receipt confirmed | **Saved to Atoms** |
| rejected because the title already exists | **That title already exists** |
| revoked grant | **Connect G2 again** |
| network unavailable before commit | **Waiting for a connection** |

The service never exposes another account's outbox ids, atom bodies, or status.

## Grounded query flow

1. The user opens Ask atoms and records a question.
2. Speech-to-text returns the question without adding meaning.
3. The service searches the existing Ask mirror using the same lexical and expansion behavior as `search_atoms`.
4. The service fetches the full bodies of a small, bounded source set.
5. One synthesis call produces an answer of about 250 to 350 characters from those bodies alone.
6. The response carries the answer, source titles, confidence, and an evidence-sufficient flag.
7. The glasses show the answer first and the source titles next. Selecting a title opens the verbatim body.

The synthesis prompt forbids outside facts and unsupported reconciliation. Conflicting atoms remain visible as disagreement. When evidence is insufficient, the service returns no synthesized answer and supplies the closest matches.

The answer is a convenience layer. The source atom body remains authoritative.

## Recent and reading flow

Recent atoms come from the mirror, ordered by note creation date descending. V1 requests at most 20 items and keeps the list position locally.

Opening an atom fetches the authoritative mirrored body. The client paginates without changing the text. Missing or stale atoms return to the list with a plain explanation rather than a blank display.

## Local recovery and lifecycle

Even Hub apps run in a phone WebView. Android may reclaim in-memory state when backgrounded, and background network work cannot be trusted on either platform. The app persists every state needed to resume.

A completed recording that has not reached Atoms Plus is stored in a bounded local IndexedDB queue. The app retries when it next runs in the foreground. It deletes local audio only after transcription succeeds or the user discards it. It never silently drops the oldest recording to make room; if the local limit is full, the app refuses a new recording before capture begins and explains why on the phone.

Prepared but uncommitted atoms remain local and return to their confirmation screen after a cold start. Committed items keep only their outbox id and status metadata locally.

Open sockets are disposable. The app reconnects explicitly after foregrounding and never assumes a microphone or transcription stream survived suspension.

## Server surface

The implementation plan may combine endpoints, but the product needs these operations:

| Operation | Purpose |
|---|---|
| Pair redeem | Exchange a short code for a scoped G2 grant |
| Token refresh and revoke | Rotate or invalidate the device grant |
| Transcription session | Stream G2 PCM and return interim and final text |
| Prepare atom | Generate title, tags, and reason-bearing links without writing |
| Commit atom | Validate and enqueue one idempotent Ask outbox item |
| Delivery status | Report queued, applied, or rejected for one owned item |
| Query | Retrieve bodies and return a grounded answer with sources |
| Recent | List recent mirrored atoms |
| Fetch | Return one authoritative mirrored atom body |

All routes require an allowlisted origin, bearer authorization, account-scoped lookup, request limits, and `Cache-Control: no-store`. The released Even Hub manifest whitelists only the Atoms Plus HTTPS and WebSocket origins it uses.

## Privacy and security contract

The first-run disclosure states that:

- G2 microphone audio goes to Atoms Plus and its named speech provider for transcription.
- The transcript becomes the proposed atom body and is not rewritten.
- Questions and selected mirrored atom bodies go to the model that prepares grounded answers.
- Obsidian remains the source of truth and may need to open before a queued atom is saved.

The implementation must also satisfy these rules:

- Never bundle provider keys or service secrets in the `.ehpk`.
- Never log audio, transcripts, questions, atom bodies, authorization headers, or raw tokens.
- Keep access tokens short-lived and rotate refresh credentials.
- Scope every lookup by the token's Plus account.
- Rate-limit transcription, preparation, query, pairing, and status polling.
- Set a strict Content Security Policy for the phone-side WebView.
- Declare only `network` and `g2-microphone` permissions unless implementation proves another permission necessary.
- Make revocation available from Obsidian Settings.

## Error behavior

The glasses always render a useful state. They never show a blank page while setup or recovery is required.

| Condition | Response |
|---|---|
| Microphone permission denied | Explain on the glasses; offer setup detail on the phone |
| Connection drops during recording | Preserve completed audio locally and retry in foreground |
| Transcription fails | Keep the recording and offer retry or discard |
| Atom preparation fails | Keep the transcript and offer retry |
| Commit times out | Retry with the same idempotency key |
| Obsidian is closed | Keep **Queued**; do not describe it as saved |
| Mirror is empty or stale | Explain that Ask reads the last mirror; point to Sync now |
| Query evidence is weak | Show closest matches without a synthesized claim |
| Device grant is revoked | Show **Connect G2 again** and stop content requests |

## Acceptance examples

1. A paired subscriber opens New atom, dictates a thought, confirms its generated title, and sees **Queued**.
2. Obsidian opens, applies the outbox item, mirrors it, and the glasses later show **Saved to Atoms**.
3. The written atom body equals the final transcript byte-for-byte apart from the existing terminal-newline convention.
4. Generated title, tags, and links satisfy existing Ask atom validation and link-reason rules.
5. Retrying a timed-out commit with the same idempotency key creates one outbox item and one vault file.
6. Canceling from the confirmation screen creates no outbox item.
7. A network interruption after recording preserves the audio across an Android WebView restart.
8. A voice question returns a short answer and source titles derived from fetched atom bodies.
9. Weak or conflicting evidence produces an honest fallback instead of a confident unsupported answer.
10. Selecting a source or recent atom shows the verbatim body across readable pages.
11. Revoking the G2 grant stops reads, questions, transcription, and creation without affecting Claude, ChatGPT, Grok, or the mirror.
12. No content leaves the app before the microphone and Atoms Plus disclosures are accepted.

## Verification strategy

### Pure and server tests

- Navigation and lifecycle state reducer
- Recording recovery and bounded local queue
- Transcript-to-body invariant
- Atom preparation schema and title/body claim checks
- Idempotent commit and account-scoped status
- Pair-code expiry, single use, hashing, rate limits, and revocation
- Query retrieval bounds, authoritative-body use, citation coverage, and weak-evidence fallback
- CORS, CSP, permission manifest, and secret scans
- Existing Ask mirror and outbox regression suites

### Simulator tests

- Root navigation
- Record, prepare, confirm, queued, and saved states
- Query answer, sources, fallback, recent list, and paginated body
- First-run, revoked, offline, and empty-mirror states
- Screenshot evidence at 576 by 288

### Physical G2 tests

- G2 microphone audio quality and latency
- Temple and R1 gestures
- Text readability, list selection, scroll behavior, and flicker
- Phone lock and five-minute resume on iOS and Android
- Connection loss during recording, commit, and query
- Root exit confirmation and abnormal exit cleanup

Vault-writing proof uses the throwaway test vault. Agents do not install into or mutate the personal Remote Vault. Human dogfood may use the personal vault after a private `.ehpk` build passes the test-vault loop.

## Rollout

1. Build against the Even Hub simulator.
2. QR sideload to the owner's G2 for microphone and interaction spikes.
3. Upload a private `.ehpk` through the developer portal.
4. Run the full create, save, query, and source-reading loop against the throwaway vault.
5. Run the repository shipping tail and attach hardware evidence to the PR.
6. Submit for public Even Hub review only after private hardware behavior is stable.

## Implementation gate

This design approves the product shape, not implementation. Before code:

1. Create and assign a GitHub Issue.
2. Add the claim to `STATUS.md` with honest hot files.
3. Push `feat/even-g2-atoms` and open a draft PR.
4. Create the implementation plan with `ce-plan`.
5. Run a full document review because the feature adds auth, microphone egress, model output, and cloud-to-vault writes.

## References

- [Even Hub architecture](https://hub.evenrealities.com/docs/get-started/architecture)
- [Even Hub quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/index)
- [Even Hub display and UI system](https://hub.evenrealities.com/docs/build/display)
- [Even Hub device APIs](https://hub.evenrealities.com/docs/build/device-apis)
- [Even Hub networking](https://hub.evenrealities.com/docs/build/networking)
- [Even Hub background and lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle)
- [Even Hub packaging](https://hub.evenrealities.com/docs/ship/packaging)
- [Even Hub submission and QA](https://hub.evenrealities.com/docs/ship/app-submission)
- [Official ASR starter](https://github.com/even-realities/evenhub-templates/tree/main/asr)
- `docs/architecture.md` Ask mirror sync
- `docs/plans/2026-08-04-002-feat-ask-mcp-pairing-plan.md`
- `docs/plans/2026-08-07-001-feat-android-companion-capture-poc-plan.md`
