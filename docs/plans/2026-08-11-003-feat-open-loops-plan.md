---
title: Open loops - Plan
type: feat
status: active
date: 2026-08-11
origin: docs/handoffs/2026-08-11-retrieval-sufficiency-and-note-substance.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Open loops - Plan

## Goal Capsule

**Objective.** Notes that record an intention are first-class **open loops**: marked at write time, carried in vault frontmatter, returned on every list/search surface so agents never treat them as finished assets, and closable on return via a **redeeming** linked child — never an in-place rewrite and never an ordinary continue.

**Product authority.** Constitution: body sacred; second brain not a task app; resurface is a stream not a guilt queue (`CLAUDE.md`, `docs/architecture.md`). Origin failure: MCP session treated an Aug 5 intention note (“I will share my routine…”) as a ready asset though the full body was already in the snippet.

**Open blockers.** None product-blocking. Three agent surface-cases remain dogfood bar (SC1–SC2), not ship blockers.

**Product Contract preservation.** Unchanged in substance from post-doc-review walkthrough (P0/P1). ce-plan adds Planning Contract + units only; no product-scope rewrite.

---

## Product Contract

### Summary

Ship **open loops** as a product property of notes (not an agent-only affordance and not a Home unfinished shelf). Classify intention-shaped captures silently at write; store revisable frontmatter with sticky human overrides; expose open-now wherever notes are listed or searched; on deliberate return, open a close path that starts with “what would closing this look like?” and, when substance is produced, a **redeeming** child (not ordinary continue). Whether a note is still open is **computed** (active intention mark ∧ no redeeming child) — close never patches the parent. One command: Browse (open-now) vs Review (ephemeral proposals). Keep snippet completeness out of this initiative.

### Problem Frame

Fast capture correctly files intentions for later. Those notes pass every structural check and look like assets in search and agent results. When the user returns at the moment of highest cost, an agent (or any consumer) can pitch the intention as finished content. The vault worked; the missing distinction is intention vs substance. Completeness metadata does not fix this — the live failure had nearly the whole body already returned.

### Requirements

**Identity and data**

- R1. An **open loop** is a note that records an intention or open commitment, not the finished substance. It is a legitimate kind of memory, not a defect, stub, or demotion.
- R2. Vault note **frontmatter is source of truth**. Mirror and MCP project it; they never own a second loop state that can drift.
- R3. Frontmatter carries at least: loop classification / terminal state needed for open-now and sticky source; `loop_source` of `inferred` or `user`. Exact key names are a planning choice. **No `loop_kind` field in v1.**
- R4. **`loop_source: user` is sticky.** Automated classifiers must not overwrite a human-set (or human-accepted) value, including terminal user states below.
- R5. **Open-now is pure derived — one mechanism, no parent writes on redeeming close.** Frontmatter records loop classification + `loop_source`. **Open-now** ⇔ FM says the note is still an active open intention **and** no **redeeming** child exists. Redeeming close creates a child with a distinct **redeems** signal (dedicated relation and/or child flag — planning picks the wire shape). Ordinary `continues` / `adds_detail` (Home Continue, continue_atom default, classify topical links) **must never** make open-now false. Do not store a separate `closed: true` that can disagree with redeems. Do not patch parent FM solely to “clear open” when redeeming — open-now is computed at every reader (plugin, mirror, MCP).
- R5b. **User terminal states (no redeeming child required), kept distinct** — all set `loop_source: user` and make open-now false; classifier never re-opens:
  - **not_a_loop** — classifier was wrong; this was never an intention.
  - **resolved_elsewhere** — was a real loop; closed outside the vault (offline, shipped, no child).
  - **abandoned** — was a real loop; user no longer cares (not resolution).
  Misclassification must stay separate from resolved/abandoned so classifier quality remains measurable. FM hand-edit that sets these (or equivalent) counts as user.
- R6. Body text stays **verbatim**. Loop classification is metadata only. Redeeming conversion never edits the parent body.

**Write path**

- R7. **New captures:** at write time, classify open-loop-ness **silently** (`loop_source: inferred`). No blocking prompt and no review gate. Frictionless capture holds. Silent means no UX interrupt — not that inferred is indistinguishable from user downstream.
- R8. Classification is **conservative**. When unsure, leave unmarked. False open loops are worse than misses — a wrongly marked real asset loses trust. Missed loops remain readable as intention in the body; false opens burn trust in the flag.
- R9. **Ask `create_atom` / agent-written atoms** get open-loop marking without a metered classify call: **conservative free heuristics** on apply and/or an **optional agent-supplied** intention flag (treated as `loop_source: user` when the agent asserts it). No second class of permanently unmarked intention notes.
- R10. **Four kind names** (content / reference / experiment / social) stay design notes only in v1 — no FM/MCP field. When the user answers the close entry question, **capture that answer on the redeeming child** (or close evidence) so later kind modeling can use real words, not classifier guesses.

**Retrieval and agent**

- R11. Every surface that lists or searches notes for consumers returns **open-now** plus **loop_source** when known (inferred vs user must stay distinguishable) and enough to tell terminal vs active intention vs substance — at least MCP `search_atoms`, `list_atoms`, `fetch_atom`, and neighbors payloads that identify notes. Behavior follows open-now, not verb-tense inference.
- R12. **Never characterize an open loop as a finished asset.** Correct: intention / left for later. Incorrect: “you have a note about your cowork routine” when the note only wants to write about it.
- R13. **Never fabricate substance.** Closing asks the user (or opens the external reference); the agent does not invent the missing content.
- R14. Agent surface context (working contract, dogfood before freezing):
  - **Target** — user searched for it or it is the only real hit: open the loop, show past words **verbatim**, state it is intention not the thing, start close path.
  - **Among candidates** — one-line label (“still an open loop”); do not derail into closing unless chosen.
  - **Incidental** — mention at most once; do not nag or interrupt unrelated work.
- R15. **Close path entry:** default first move is one open question — **“what would closing this look like?”** — not an interview. Interview (or structured Q&A) runs only when the answer is content-in-head. Other answers route differently (e.g. open a URL, prompt later for experiment result, wait on reality for social). Unknown kind uses this same entry question.
- R16. **Conversion** produces a **child atom** with an explicit **redeems** signal (not bare `continues` / `adds_detail`). Parent remains the unchanged record of when the intention was captured. Optional external landing pointer may live on the child (or close evidence), not as a parent FM patch.

**Intentional browse and backlog**

- R17. **One command, two modes** — not a standing Home shelf. **Browse mode:** open-now notes from vault FM only (no unaccepted proposals). Calm “notes left for later” language; **no counts in command title or chrome**. **Review mode:** classifier proposals for existing notes — accept / skip. User picks mode at the one entry point; they must not collapse into one undifferentiated list.
- R18. **Proposals are ephemeral.** Regenerate on demand; store nothing durable as a proposal ledger (no second SSOT). Accept writes FM with `loop_source: user` (active intention). **Durable skip** writes a sticky user terminal (`not_a_loop` by default for “not this”) so the same path does not resurface as a fresh proposal on every re-run. Unreviewed candidates have zero footprint until accept/skip.
- R19. Browse never shows unaccepted proposals. Review never pretends proposals are already open loops.

**Home and voice**

- R20. **Nothing on Atoms Home in v1:** no open-loops filter, no counts, no guilt card, no For-you cue that pressures closing loops. North star: stream not guilt queue; second brain not task app. Intentional browse is not a process-inbox.
- R21. Copy and agent wording stay free of task-app / backlog-guilt language (`docs/voice.md`). No completion %, age urgency, or “N left” chrome on the command.

### Key Decisions

- KD1. **Open loop, not stub.** (session-settled: user-directed — chosen over stub/defect/warning framing: these are intentional captures for future-self; demotion/hide is wrong.)
- KD2. **Root cause is substance distinction, not snippet completeness.** (session-settled: user-directed — chosen over retrieval completeness fields as the fix: live failure had full intention text in the snippet.)
- KD3. **Primary consumer is the MCP / AI agent**; vault FM makes it a product property. (session-settled: user-approved — agent-first over Home-first.)
- KD4. **Approach B:** flag + return-path convert, not flag-only. (session-settled: user-directed — chosen over A flag-only and C full four-kind product.)
- KD12. **Ship bar vs dogfood bar** for agent behavior; Ask create uses free heuristics + optional agent flag, not metered classify. (session-settled: user-directed.)
- KD5. **Frontmatter SSOT** with `loop_source` sticky against classifier overwrite. (session-settled: user-directed — chosen over mirror-only or tag-only.)
- KD6. **Open-now = FM intention mark ∧ no redeeming child.** Pure derived; no parent FM clear on close; ordinary continue never redeems. (session-settled: user-directed — chosen over dual FM+graph truth and over any-continue-closes; covers false-close, dual SSOT, and continue_atom parent-patch gap together.)
- KD6b. **Distinct redeems signal** on the child (relation and/or flag). (session-settled: user-directed — chosen over reusing continues/adds_detail for close.)
- KD6c. **Three user terminals without child:** not_a_loop | resolved_elsewhere | abandoned — distinct; all sticky user; all open-now false. (session-settled: user-directed — not collapsed into one dismissed value.)
- KD7. **New = silent inferred (no gate); backlog = ephemeral proposal Review; inferred ≠ user in payloads.** (session-settled: user-directed — gates on capture rejected; measure false-open via not_a_loop flips before adding gates.)
- KD8. **Nothing ambient on Home; one command with Browse (FM open-now) vs Review (ephemeral proposals).** (session-settled: user-directed — two modes one entry; no counts; proposals not stored; durable skip.)
- KD9. **Close entry is “what would closing this look like?”** not default interview. (session-settled: user-directed — interview only when answer is content-in-head.)
- KD10. **loop_kind out of v1 FM/MCP.** Four names stay design notes; close answers logged on redeeming child for a data-driven v2. (session-settled: user-directed — YAGNI vs shipping unused schema.)
- KD11. **Conversion is a redeeming child**, not ordinary continue/detail; agent does not generate substance from the intention alone.

### Scope Boundaries

**In scope**

- Open-loop classification at write (Process + Ask create paths)
- FM model + sticky source + optional kind
- MCP/list/search/fetch projection of the flag
- Agent contract (R12–R16) and instruction/tool honesty
- One command: Browse (open-now) + Review (ephemeral proposals)
- Close path: entry question → redeeming child when substance exists → open-now false by derivation; log close answer on child; optional external pointer on child
- User terminals: not_a_loop | resolved_elsewhere | abandoned

**Deferred**

- Four full kind-specific productized close UIs and any `loop_kind` FM/MCP field
- For-you / resurface cues about open loops
- Standing Home filter or counts
- Snippet `is_complete` / `coverage_ratio` / semantic snippet truncation (separate honesty class; not this bug)
- Stale-but-once-substantive notes (third family; do not harden the model around it yet)
- Large-vault sampled backfill UX (full review OK at ~tens–low hundreds)
- Freezing R14 three surface-cases as hard agent law before dogfood

**Out of product identity**

- Task-app unfinished queue, due dates, streak pressure
- In-place rewrite of intention bodies
- Agent-authored “finished” content for the missing substance
- Hiding open loops from search by default

### Success Criteria

**Ship bar** (system properties — CI / fixture / vault proof; release may not skip these)

- SC3. Human correction of loop FM survives a later classifier/process pass (`loop_source: user` sticky), including not_a_loop / resolved_elsewhere / abandoned.
- SC4. Proposals are regenerated, never a durable ledger; accept writes FM; durable skip does not reappear as a new proposal.
- SC5. Browse mode shows only open-now from FM; no proposals mixed in; no counts in chrome; no Home surface.
- SC6. Home gains no open-loop filter, count, or nag card.
- SC7. After redeeming convert, parent body and parent loop FM are unchanged; substance lives on the redeeming child; open-now is false.
- SC8. An ordinary `continues` / `adds_detail` child does **not** make open-now false.
- SC9. User terminals make open-now false and stay sticky against classifiers.
- SC10. MCP list/search/fetch/neighbors note payloads expose **open-now** and **loop_source** when known; fixture tests fail if omitted for known open loops.
- SC11. Tool descriptions / MCP instructions state open-loop honesty rules in forceable payload terms (not only soft prose); regression fixtures lock required fields.
- SC12. Process write + Ask create (heuristics and/or agent-supplied flag) can produce intention marks; create_atom is not permanently exempt.

**Dogfood bar** (real check before calling the initiative done; non-blocking for merge of plumbing, **blocking for “feature done”**)

- SC1. Reproduce the origin shape: search returns an open-now intention among substance hits; the agent **labels** it and does not pitch it as a finished asset. If it fails, treat as a **bug in payload shape or tool description**, not only “the model was dumb” — fix and re-run.
- SC2. Target that loop: verbatim past words, no invented substance, close entry question, redeeming child when substance is produced.

### Key Flows

1. **Capture intention** → Process/Ask write → silent inferred open loop on FM → mirror/MCP show flag.
2. **Search among hits** → open loop labeled one line → user picks or skips; no auto-close.
3. **Return to target loop** → verbatim intention → “what would closing this look like?” → branch; when substance is produced, redeeming child → open-now false by derivation (parent FM untouched). Non-substance branches may leave open-now true.
4. **Command → Browse** open-now from FM, or **Review** → regenerate proposals → accept (`user` intention) / durable skip → no leftover proposal store.

### Non-negotiable constitution touchpoints

- Body sacred (R6)
- Second brain not task app; no guilt queue on Home (R20)
- Ask mirror remains vault→cloud projection of vault SSOT (R2)
- Body and parent FM unchanged on close; redeeming child is the only close write (R5, R6, R16)

### Outstanding Questions (for planning, not product forks)

- OQ1. Exact frontmatter key names and whether open is presence-of-field vs enum.
- OQ2. Wire shape for **redeems** (new relation string vs child FM flag vs both) and how mirror/MCP expose open-now = intention-mark ∧ ¬redeeming-child.
- OQ3. Resolved for product: proposals ephemeral / regenerate; no durable proposal store. Planning may still choose in-memory vs session cache that dies with the view.
- OQ4. Process-path classifier: pure heuristics vs model field on classify schema vs both (conservative union). Ask path: heuristics + optional agent flag (product-settled).
- OQ5. Resolved: Browse = open-now FM only; Review = proposals only.

### Dependencies / Assumptions

- Ask write path can mint a child with a **redeems** signal (extend relation allowlist / outbox; not bare continue default).
- Mirror already parses and syncs frontmatter fields used on public atom rows (extend, not replace).
- User will dogfood three surface-cases before treating them as frozen agent law.

### Origin and rejected framing

- Handoff: `docs/handoffs/2026-08-11-retrieval-sufficiency-and-note-substance.md` (Problem 2 retained and reframed; Problem 1 retrieval completeness **out of scope** for this plan).
- Rejected: stub/warning/demote; completeness flags as the fix; standing Home unfinished list; default interview on every close; mirror-only state.

---

## Planning Contract

### Technical Design

**Domain model (pure)**

| Concept | Representation |
|---|---|
| Intention mark | Frontmatter on the atom. Planning keys (frozen for implementers): `atoms-loop: active \| not_a_loop \| resolved_elsewhere \| abandoned` and `atoms-loop-source: inferred \| user`. Absent `atoms-loop` = not in the loop system. |
| Open-now | Pure function: `atoms-loop === "active"` **and** no redeeming inbound edge. Readers never invent a stored `closed`. |
| Redeems | New relation `redeems` on the **child** (link reason / outbox relation), added to `OUTBOX_RELATIONS`, `ContinueRelation` / relationReason prose, and MCP zod enum in lockstep. Inverse for readers: parent has redeeming child. |
| Close answer log | Free text on the redeeming child FM optional `atoms-loop-close-answer:` (or body prefix — prefer FM) for future kind research. |
| loop_source sticky | Classifier/heuristics may write only when current source is absent or `inferred` and state is `active`/absent. Never overwrite `user`. Terminals are always `user`. |

**Open-now formula (single home)**

```
openNow(note) =
  fm.atoms-loop === "active"
  && !hasRedeemingChild(note)
```

`hasRedeemingChild` = any inbound link/edge with relation `redeems` (mirror inverse map, same pattern as `continues` → `continued_by`).

**Write paths**

| Path | Behavior |
|---|---|
| Process `buildAtomMarkdown` | After classify/heuristics, emit `atoms-loop` + `atoms-loop-source` when active inferred. |
| Update notes / polish | `parseImmutableFrontmatter` + rebuilds **must preserve** loop keys (extend preserve set). |
| Ask `create_atom` | Heuristics on body/title at apply (`buildAskAtomMarkdown`) and/or optional outbox field `loop: active` → `user`. No metered classify. |
| Redeem close | New or extended write: child with `relation: redeems` (+ optional close-answer). Prefer extending `continue_atom` with relation enum including `redeems`, or a thin `redeem_loop` alias that enqueues the same continue-shaped outbox with forced relation. Parent FM untouched. |
| User terminals | Plugin command UI and/or documented FM edit sets `atoms-loop` + `source: user`. |

**Mirror / MCP projection**

- Parse loop FM in `splitAtomMarkdown`; include in mirror payload (prefer `meta_json` or two nullable columns — planning default: **`loop_json` TEXT** nullable on `atom_mirror` via ALTER pattern used for `created`/`expand_enc`, storing `{ state, source }` to avoid dual columns drift).
- Hash must include loop fields so mark changes re-upsert.
- `shapeMirrorListItem`, `buildSearchHits`, `shapeFetchAtom`, neighbor note rows: add `open_now: boolean`, `loop: null \| { state, source }` (or flat fields). Compute `open_now` server-side from stored loop + links inverse `redeems`.
- Instructions + tool descriptions: open-now honesty (R12–R16); SC11 fixtures lock field presence.

**Plugin command**

- `atoms:open-loops` (or similar) in `registerAtomsCommands`.
- Modal/view: mode switch **Browse** | **Review**. No counts in title. Browse = vault scan open-now. Review = regenerate proposals (heuristic over atoms folder), accept → FM user active; skip → `not_a_loop` + user (default durable skip). Ephemeral list only.

**Classifier (Process)**

- Conservative pure heuristics first (future-tense / pointer phrases / short IOU shapes). Optional classify-schema field later (OQ4) — v1 default **heuristics only** on Process + Ask to avoid dual-template cost; if model field added, keep `classify.ts` + `classifyTemplate.mjs` in sync.
- Unsure → omit mark.

### Key Technical Decisions

- KTD1. FM keys `atoms-loop` + `atoms-loop-source` (plugin-prefixed; Obsidian-visible).
- KTD2. Relation `redeems` as redeeming signal; ordinary continues never close (R5/SC8).
- KTD3. open-now computed at every reader; no parent FM clear on redeem.
- KTD4. Mirror stores loop snapshot in `loop_json`; open_now derived at shape time from loop_json + links.
- KTD5. Ask create: free heuristics + optional agent `loop` on create payload; no filing meter.
- KTD6. Process v1: heuristics only (model field deferred unless heuristics fail dogfood).
- KTD7. One command, two modes; proposals regenerated; durable skip → `not_a_loop`.
- KTD8. Ship bar SC3–SC12 vs dogfood SC1–SC2.

### Assumptions

- Extending `OUTBOX_RELATIONS` with `redeems` is acceptable product graph vocabulary (not a constitution violation).
- Agents can call continue-shaped tools with `relation: redeems` once enum allows it.
- Vault owners who hand-edit FM are a supported correction path.

### Dependencies and sequencing

1. U1 pure model + tests (unblocks all)
2. U2 Process write + preserve paths
3. U3 Ask create heuristics + optional flag
4. U4 redeems on outbox/MCP write
5. U5 mirror parse + store + shapes + instructions
6. U6 plugin command Browse/Review + terminals
7. U7 dogfood fixtures / instruction hardening (SC11) can parallel U5–U6

### Risks

| Risk | Mitigation |
|---|---|
| Heuristics miss Aug-5 class | Dogfood; optional agent flag; conservative under-mark |
| Heuristics false open | Sticky not_a_loop; loop_source visible; measure flips |
| Host ignores open_now | SC11 payload + instructions; SC1 dogfood treats as our bug |
| Dual relation enums drift | Single test that OUTBOX_RELATIONS ≡ zod ≡ relationReason |
| Refresh strips FM | U2 tests mutation: polish drops keys without preserve |

---

## Implementation Units

### U1. Open-loop pure model

**Goal.** One module owns parse/serialize FM, sticky write rules, open-now, and redeeming-child detection from link lists.

**Files.** Create `src/shared/openLoop.ts` (+ `test/openLoop.test.ts`). Types only if needed in `src/shared/types.ts`.

**Approach.** Export: `OpenLoopState`, `parseOpenLoopFm`, `formatOpenLoopFm`, `canClassifierWrite`, `openNow({ state, hasRedeemingChild })`, `linksIncludeRedeems(links)`. No Obsidian imports.

**Test scenarios.**
- openNow true only for active ∧ ¬redeems
- terminals → openNow false
- classifier cannot overwrite user
- classifier may upgrade absent → active inferred
- parse missing keys → unset

**Requirements.** R3–R5b, SC3, SC7–SC9

---

### U2. Process write + FM preserve

**Goal.** New Process atoms can get silent inferred marks; Update/polish never strip loop FM.

**Files.** `src/pipeline/render.ts` (`buildAtomMarkdown`), `src/pipeline/write.ts` (wire heuristic), `src/pipeline/refreshAtoms.ts` (parseImmutable + both rebuilds), `src/pipeline/openLoopHeuristic.ts` (or colocate in shared), tests: `test/render.test.ts`, `test/refreshAtoms.test.ts`, heuristic unit tests.

**Approach.** Heuristic on capture body/title after verdict atom. Emit FM via U1 helpers. Extend immutable preserve set for loop keys on all rebuild paths.

**Test scenarios.**
- atom markdown includes atoms-loop when heuristic hits
- unsure body omits keys
- polish/refresh round-trip keeps user terminal and inferred active
- mutation: remove preserve → test fails

**Requirements.** R7–R8, SC3, SC12

---

### U3. Ask create mark path

**Goal.** create_atom apply can mark intentions without metered classify.

**Files.** `plus-service/src/mcp/tools.mjs` (optional input), `plus-service/src/store/askHelpers.mjs` (payload), `src/platform/askOutbox.ts` (`buildAskAtomMarkdown`, plan/apply), `test/askOutbox.test.ts`, `plus-service/test/mcp-ask-write.test.mjs`.

**Approach.** Optional `open_loop: true` on create → `atoms-loop: active`, `source: user`. Else run same heuristic on body. No `/v1/classify`.

**Test scenarios.**
- agent flag → user source
- heuristic hit → inferred
- no hit → no keys
- continue without redeems unchanged

**Requirements.** R9, SC12

---

### U4. Redeems write path

**Goal.** Agent/plugin can create a redeeming child; ordinary continue does not redeem.

**Files.** `src/shared/relationReason.ts`, `plus-service/src/store/askHelpers.mjs` (`OUTBOX_RELATIONS`, validate), `plus-service/src/mcp/tools.mjs` (continue_atom enum + description; optional close-answer field), `src/platform/askOutbox.ts` (prose for redeems), tests: relation + mcp-ask-write + askOutbox.

**Approach.** Add `redeems` everywhere relations are enumerated. Tool description: use redeems only to close an open loop; continues never closes. Optional `close_answer` string → child FM.

**Test scenarios.**
- enqueue continue with redeems accepted
- continues still default for ordinary continue_atom
- child markdown contains redeems reason prose + parent link
- lockstep enum test three sites

**Requirements.** R5, R16, SC7–SC8, KD6b

---

### U5. Mirror + MCP open-now projection

**Goal.** List/search/fetch/neighbors expose open_now + loop source; instructions honesty.

**Files.** `src/platform/askMirror.ts` (split + payload + hash), `plus-service/src/store/askSqliteMethods.mjs` + `askPostgresMethods.mjs` + migrations, `plus-service/src/store/askHelpers.mjs` (shapes, inverse redeems), `plus-service/src/mcp/tools.mjs` (descriptions), `plus-service/src/mcp/instructions.mjs`, tests: `test/askMirror.test.ts`, `plus-service/test/mcp-unmisreadable-shape.test.mjs`, list/search tests.

**Approach.** Parse loop FM; store `loop_json`; on shape, compute open_now from state + any inbound redeems (extend `INVERSE_RELATION` / revision helper). Fixtures assert fields present for active open and false when redeemed or terminal.

**Test scenarios.**
- active no child → open_now true, source inferred|user
- active + redeems child → open_now false
- continues child only → still open_now true
- terminal → open_now false
- instructions mention open loops / never pitch as finished asset
- SC11 field-omission mutation fails

**Requirements.** R2, R11–R14 (payload half), SC10–SC11

**Execution note.** Test-first on shape contracts (characterization of existing shapes + new fields).

---

### U6. Browse / Review command + terminals

**Goal.** Intentional surface without Home guilt chrome.

**Files.** `src/plugin/commands.ts`, new `src/home/openLoopsModal.ts` or `src/plugin/openLoopsCommand.ts` (prefer non-home folder if not home chrome — e.g. `src/plugin/`), styles if needed, tests for pure list builders.

**Approach.** Command opens modal: Browse lists open-now atoms (vault scan using U1 + link graph or body wikilinks for redeems — prefer parsing atom links same as home data helpers). Review runs heuristic over Atoms folder, shows candidates not already user-set; accept/skip write FM via vault adapter. No counts in title. Voice: `docs/voice.md` / atoms-voice for copy.

**Test scenarios.**
- browse builder excludes terminals and redeemed
- review skip writes not_a_loop user
- accept writes active user
- regenerate does not re-show skipped
- no Home filter wiring

**Requirements.** R17–R21, SC4–SC6, SC9

---

### U7. Agent honesty copy + dogfood harness

**Goal.** SC11 ship fixtures + documented dogfood script for SC1–SC2.

**Files.** `instructions.mjs`, tool description strings, `docs/qa/` short open-loops dogfood checklist, optional fixture note under `docs/media/demo-vault` or test fixtures only (not personal vault).

**Approach.** Strengthen instructions with open_now rules and three surface-cases as working guidance. Dogfood checklist: seed intention among substance hits; run MCP search; record agent behavior; if pitch-as-asset, fix payload/instructions first.

**Test scenarios.**
- instructions string contains open_now / intention wording (parity tests like list_atoms-created)
- dogfood checklist committed

**Requirements.** R12–R16, SC1–SC2, SC11

---

## Verification Contract

```bash
npm test
npm run build
npm run lint
# plus-service
cd plus-service && npm test
```

Plugin CLI (throwaway vault only): after U2/U6, process a fixture intention capture; confirm FM; command Browse lists it; redeem via MCP/test outbox; open_now false on fetch.

**Ship gate:** SC3–SC12 green. **Done gate:** SC1–SC2 dogfood recorded in QA note.

## Definition of Done

- [ ] All units merged with tests above
- [ ] No Home open-loops chrome
- [ ] continue does not false-close (SC8 fixture)
- [ ] Fly deploy plus-service when MCP shapes change (human/ops)
- [ ] Version bump plugin if user-visible command ships
- [ ] Dogfood SC1–SC2 written under `docs/qa/`
- [ ] CONCEPTS Open loop stays accurate
- [ ] Hard claim Issue + STATUS + draft PR before code (`docs/collab.md`)

## System-Wide Impact

- **Graph vocabulary:** new `redeems` relation — document in CONCEPTS / agent instructions.
- **Mirror schema:** `loop_json` migration on sqlite + postgres.
- **Refresh/polish:** preserve set expansion — any future FM rebuild must include loop keys.
- **Out of scope still:** snippet completeness, Home filters, loop_kind field, For-you cues.
