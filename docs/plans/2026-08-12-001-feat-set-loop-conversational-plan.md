---
title: set_loop conversational mark - Plan
type: feat
date: 2026-08-12
origin: user brief 2026-08-12 (Part 1); open loops plan docs/plans/2026-08-11-003-feat-open-loops-plan.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
product_contract_preservation: "Product Contract unchanged from requirements-only; planning adds HOW only"
---

# set_loop conversational mark - Plan

## Goal Capsule

**Objective.** Mark open-loop state on **existing** atoms from conversation with the agent (`loop_source: user`), so notes captured before open loops shipped — and any note that comes up in chat — never require hand-editing frontmatter in Obsidian.

**Product authority.** Constitution: body sacred; second brain not task app; stream not guilt queue (`CLAUDE.md`). Open loops Product Contract R4–R5b, R11–R16 (`docs/plans/2026-08-11-003-feat-open-loops-plan.md`). Thesis: filing runs in the plugin; judgment runs in the conversation.

**Open blockers.** None product-blocking. Part 2 (return detection) is deferred until Part 1 is dogfooded.

---

## Product Contract

### Summary

Ship one conversational write: the agent can set loop classification on an existing mirrored atom after the user decides in chat. All four loop states, always sticky user source. Body never changes. No Home shelf, no capture prompt, no queue. Substance close stays redeeming child. Stop after this for dogfood; do not build return detection yet.

### Problem Frame

Open loops work at create and close: `create_atom` can set `open_loop`, `continue_atom` with `redeems` closes. Nothing **opens or corrects** an existing note from the agent. Every pre-ship intention — including the note that motivated the feature — is only markable by editing YAML in Obsidian. Obsidian is fine for dump and raw text; it is a bad place for “is this still open?” Judgment belongs where the note actually comes up: in conversation.

### Requirements

**Identity**

- R1. Conversational mark targets an **existing** atom the user and agent are already talking about (mirrored title). It does not create a note and does not rewrite body.
- R2. Mark writes vault frontmatter only: `atoms-loop` + `atoms-loop-source: user`. Frontmatter remains SSOT; mirror/MCP project it after apply + push.
- R3. Allowed states match the shipped model: `active | not_a_loop | resolved_elsewhere | abandoned`. All four ship in Part 1 (session-settled: user-approved — chosen over active-only: conversation judgment includes open, never-a-loop, done-outside, abandoned).
- R4. `loop_source` is always `user` on this path. Sticky against later classifier overwrite (existing R4).

**Agent behavior**

- R5. The agent **raises** loop judgment when relevant (“this reads as an intention you left yourself — still open?”) and **acts on the user’s answer in the same turn**. No silent marks. False positives cost more than misses (session-settled: user-directed).
- R6. Tool descriptions and MCP instructions carry this honesty: prefer ask-then-act; do not invent marks; distinguish intention vs substance; no backlog/queue language.
- R7. Closing **with substance** remains redeeming child (`continue_atom` + `relation: redeems`, optional close_answer). `set_loop` does not create children and does not replace redeems for “I wrote the thing.”
- R8. Terminals via `set_loop` cover: classifier wrong (`not_a_loop`); closed outside the vault (`resolved_elsewhere`); no longer care (`abandoned`). Open-now becomes false without a child.

**Write path**

- R9. Write goes through the existing Ask outbox (pending until Obsidian applies with Ask + Allow filing). Same honesty as create/continue: never claim filed until fetch shows the mark (or user confirms land).
- R10. Target must exist as a mirrored **atom** (not hub). Missing title fails closed.
- R11. Apply is FM-only patch on the existing file. Body bytes unchanged. Idempotent when FM already matches.

**Surfaces and non-goals**

- R12. No Atoms Home filter, count, badge, or guilt card. No capture-time prompt. Capture stays instant dump.
- R13. Plugin Browse/Review remains valid offline path; conversation mark is the primary product path for judgment.
- R14. Part 2 (return-detection phrasing, fuzzy recall path, unprompted “you already wrote this”) is **out**. Build pull first; push earns its way later (session-settled: user-directed).

**Integrity (discovered during grounding)**

- R15. Shipped open-loop create/redeem fields must actually reach the vault on outbox apply. Today apply rebuilds a narrow payload and drops `open_loop`, `parent_title`, `relation`, and `close_answer`. Fixing that is in Part 1 scope so dogfood of the loop model is honest (session-settled: user-approved as same-PR integrity).

### Key Decisions

- KD1. **Part 1 only; stop for dogfood.** (session-settled: user-directed — Part 2 depends on whether conversational marking feels right.)
- KD2. **All four states on the conversational tool.** (session-settled: user-approved — chosen over active-only first.)
- KD3. **Ask then act; never silent mark.** (session-settled: user-directed — false positives cost more than true positives gain.)
- KD4. **Judgment in conversation, not Obsidian YAML.** (session-settled: user-directed — differentiator is agent connection.)
- KD5. **Terminals vs redeems stay distinct.** Substance close = redeeming child; conversational terminals = set_loop without child.
- KD6. **No queue / Home / capture gate.** (session-settled: user-directed — constitution + brief non-negotiables.)
- KD7. **Outbox apply passthrough fix ships with the tool.** (session-settled: user-approved — required for honest dogfood of already-shipped open loops.)

### Scope Boundaries

**In scope**

- Conversational mark tool + agent instructions
- Outbox enqueue/apply for FM-only patch on existing atom
- All four loop states, source user
- R15 apply payload integrity
- Tests and dogfood stop

**Deferred**

- Part 2 return detection (“didn’t I write something about X”)
- Unprompted agent surfacing of past notes
- Fuzzy / recency / person-link retrieval changes
- Home or For-you loop cues
- Capture-time loop prompts

**Outside product identity**

- Task-app unfinished queue, due dates, counts, badges
- In-place rewrite of intention bodies
- Agent-authored finished substance for missing content

### Success Criteria

**Ship bar**

- SC1. Existing unmarked atom can be marked `active` + `user` from the agent path; after apply + mirror, list/search/fetch show `open_now: true` and `loop.source: user`.
- SC2. Body content is byte-identical before and after mark apply.
- SC3. Each terminal state makes `open_now` false with `source: user` and stays sticky against inferred overwrite.
- SC4. Missing title / hub fails closed; no vault write.
- SC5. Agent-facing instructions/tool text require ask-then-act and forbid pitching open loops as finished assets (extend SC11 from open loops).
- SC6. create_atom `open_loop` and continue_atom `redeems` + `close_answer` survive outbox apply into vault FM (R15).

**Dogfood bar (blocking for “feature done,” not for merge of plumbing)**

- SC7. Real conversation: note comes up → agent offers mark → user answers → mark lands without opening Obsidian FM.
- SC8. At least one pre-ship intention from personal vault history can be marked this way (human lane; agent uses throwaway vault for automated proof).

### Key Flows

**F1. Mark open in conversation**

1. User and agent discuss a mirrored note that is intention-shaped or unmarked.
2. Agent asks if it should be an open loop.
3. User says yes → agent queues mark active/user.
4. Obsidian applies → FM updated → mirror push → fetch shows open_now.

**F2. Correct or resolve without substance**

1. Agent or user judges: never a loop / done outside / abandoned.
2. Agent queues corresponding terminal.
3. open_now false; parent body unchanged.

**F3. Close with substance (unchanged)**

1. User produces the missing content.
2. `continue_atom` relation redeems (+ optional close_answer).
3. open_now false by derivation; parent FM loop keys unchanged.

### Actors

- **A1. Vault owner** — judges loop state in chat; must have Obsidian open for apply.
- **A2. MCP host agent** (Claude/ChatGPT) — raises judgment, calls tools, never silent-marks.
- **A3. Plugin outbox apply** — sole writer of vault FM for this path.

### Assumptions

- Ask mirror + Allow filing already work for create/continue; set_loop rides the same consent.
- Fly deploy of plus-service is required for live host dogfood after merge (same as other MCP tools).
- Personal Remote Vault dogfood is human-only; agents prove on test/demo vault.

### Outstanding Questions

- None blocking. Naming of the tool (`set_loop` vs alternatives) is a planning KTD, not a product fork.

---

## Planning Contract

### Technical Design

**Shape.** New outbox kind `set_loop` + MCP tool of the same name. Server validates and enqueues; plugin apply patches FM on an existing `Atoms/` file via `applyOpenLoopFm` (already used by Browse/Review). Mirror stays vault→cloud: after modify, existing outbox R15 path (`syncMirror` then ack applied) pushes `loop_json`.

**Grounding (verified).**

| Fact | Where |
|---|---|
| FM apply pure helper | `src/plugin/openLoops.ts` `applyOpenLoopFm` |
| UI local modify | `src/plugin/openLoopsUi.ts` `writeLoop` → `vault.modify` |
| Outbox create-only plan | `src/platform/askOutbox.ts` `planAskOutboxApply` — no modify action |
| Vault port create-only | `src/plugin/catchUp.ts` `OutboxVaultPort` |
| Payload strip bug | `runAskOutboxApply` rebuilds `{ title, body, tags?, links? }` only — drops `open_loop`, `parent_title`, `relation`, `close_answer` |
| Pull returns `kind` | `publicOutboxRow` + `plusClient.AskOutboxItem` already include `kind`; `catchUp.AskOutboxItem` is a second narrower type and must gain `kind` |
| plusClient payload type incomplete | `plusClient.AskOutboxItem.payload` omits `open_loop`, `close_answer`, `state` — widen so R15 fields are not typed away at the boundary |
| set_loop would fail body check | `if (!payload?.title \|\| payload.body == null)` rejects body-less payloads |
| list_pending collapses unknown kinds | non-continue → `create_atom` |
| validate requires body | `validateOutboxPayload` always requires non-empty body for create/continue |

**Wire protocol.**

```
set_loop tool → validateOutboxPayload("set_loop") → outboxEnqueue kind=set_loop
  payload: { title, state, client_request_id? }   // no body
plugin pull → kind set_loop → read file → applyOpenLoopFm({state, source:"user"})
  → vault.modify → mirror push → ack applied
```

**Idempotent apply.** If parsed FM already equals `{ state, source: user }`, treat as applied (no write required, or write no-op) so retries ack cleanly.

**Notice.** Prefer one line that covers create landings and loop updates without task-app counts in chrome titles. e.g. extend `formatAskOutboxNotice` only if set_loop-only passes would otherwise say nothing useful — keep calm.

### Key Technical Decisions

- KTD1. Tool + outbox kind name: **`set_loop`**.
- KTD2. Payload: `{ title, state, client_request_id? }` — no body. `state` enum matches `OpenLoopState`.
- KTD3. Plugin branches on **`item.kind`** from pull (already on wire via plusClient). Align `catchUp.AskOutboxItem` with plusClient (`kind` required on pulled rows). Widen plusClient payload optional fields: `open_loop`, `close_answer`, `state`.
- KTD4. First outbox **modify** path: add `modify(path, content)` to `OutboxVaultPort`; coordinator wires `vault.modify` on `TFile` (same pattern as `openLoopsUi.writeLoop`).
- KTD5. Pure planner `planSetLoopApply(existingContent, title, state, folder)` in `askOutbox.ts` (or thin export next to openLoops): modify | applied_idempotent | reject missing.
- KTD6. Server: target must `mirrorFetch` as atom (not hub); error key **`atom_not_found`** (do not reuse `parent_not_found` — wrong noun confuses hosts).
- KTD7. `list_pending` kind map: explicit `set_loop` → `set_loop` (do not collapse to create_atom).
- KTD8. R15 fix: pass full payload object into `applyToVault` (no strip-rebuild). create/continue keep requiring body; set_loop does not. Also pass fields through `planAskOutboxApply` for create/continue.
- KTD9. Plugin version bump **0.7.6** (user-visible apply behavior). plus-service deploy required for live MCP; no separate service version scheme beyond Fly.
- KTD10. Execution direction: **test-first** on pure plan + catchUp branching; plus-service tests mirror create_atom patterns.
- KTD11. **Redeemed + set_loop(active):** open-now stays false while a redeeming child exists (derived rule unchanged). Tool description + instructions: marking `active` does not reopen a redeemed loop; substance already lives on the child. Do not clear redeems from set_loop.
- KTD12. **Deploy order:** plugin 0.7.6 alone cannot serve set_loop until plus-service is on Fly; PR/release notes state **deploy service before dogfood**. Old clients ignore unknown outbox kinds only if they never pull them — new kind is only enqueued by new tool, so old plugins never see set_loop rows.

### Assumptions

- Outbox DB stores arbitrary kind strings already (create/continue); no migration for a new kind string.
- Mirror upsert already parses loop FM on next push (open loops U5 shipped).
- `applyOpenLoopFm` on content without FM creates a FM block — acceptable for rare malformed atoms.

### Dependencies and sequencing

1. U0 R15 payload passthrough (unblocks honest create open_loop / redeems)
2. U1 Server validate + tool + instructions + list_pending
3. U2 Plugin plan/apply modify + port + catchUp kind branch
4. U3 Version bump + STATUS/PR
5. U4 Stop — human dogfood; Fly deploy note

U0 and U1 can parallel after shared payload types are clear; U2 depends on U0 kind threading.

### Risks

| Risk | Mitigation |
|---|---|
| First modify-via-outbox corrupts body | Body equality tests; only `applyOpenLoopFm`; reject missing file |
| set_loop rejected as invalid_payload (body null) | Kind-aware validation in catchUp (U0/U2) |
| list_pending lies (shows create_atom) | Explicit map (KTD7) + test |
| Agent silent-marks | Tool description + instructions (R5–R6); dogfood SC7 |
| Mirror lag after modify | Same pending honesty; fetch after land |
| R15 ack before loop_json visible | Existing rule: ack only after mirror confirmed receipt — modify still changes file hash so push should include atom |
| Dual AskOutboxItem types drift | KTD3: catchUp + plusClient stay field-aligned; one test imports payload with open_loop through pull mock |
| set_loop(active) on already-redeemed | KTD11: open_now stays false; document in tool text so agent does not promise “reopened” |
| Service/plugin skew | KTD12: deploy Fly before live dogfood; old plugin never pulls set_loop |

### Product Contract preservation

Product Contract unchanged. Planning does not alter R/SC IDs.

---

## Implementation Units

### U0. Outbox apply payload + kind integrity

**Goal.** create/continue loop fields reach the vault; pull exposes kind for branching; body check is kind-aware.

**Files.** `src/plugin/catchUp.ts`, `src/plugin/askCoordinator.ts` (only if apply signature changes), `test/catchUp.test.ts`

**Approach.**

- Align `catchUp.AskOutboxItem` with pull shape (`kind` + full payload).
- Widen `plusClient.AskOutboxItem.payload` optional: `open_loop?`, `close_answer?`, `state?`.
- `runAskOutboxApply`: pass `payload` through (do not rebuild a strip-list). Validate: create/continue (default) require title + body; `set_loop` requires title + state; body absent OK for set_loop.
- Apply entry: full payload + kind.

**Test scenarios.**

- Pull item with `open_loop: true` → `applyToVault` receives `open_loop: true` (mutation: strip list fails test).
- Pull continue with `relation: redeems`, `close_answer` → both present on apply.
- Item kind `set_loop` without body is not rejected as `invalid_payload`; missing state is rejected.
- create without body still rejected.

**Requirements.** R15, SC6

---

### U1. Server set_loop tool

**Goal.** MCP can enqueue FM mark for a mirrored atom.

**Files.** `plus-service/src/store/askHelpers.mjs` (`validateOutboxPayload`), `plus-service/src/mcp/tools.mjs`, `plus-service/src/mcp/handler.mjs` (`WRITE_TOOL_NAMES`), `plus-service/src/mcp/instructions.mjs`, `plus-service/test/mcp-ask-write.test.mjs`, `plus-service/test/mcp-write-scope.test.mjs`, modern-era/list tests if they freeze tool names

**Approach.**

- `validateOutboxPayload("set_loop", raw)` → title + state enum; no body; optional client_request_id.
- Register `set_loop`: destructiveHint true; description encodes ask-then-act, four states, source user, not for substance close; **active does not reopen a redeemed loop** (KTD11).
- mirrorFetch required; hub → error; missing → `atom_not_found` + absence meta.
- instructions: Write tools list includes set_loop; open-loop bullet: mark existing with set_loop after user confirms; terminals listed; redeems unchanged for substance; redeemed+active note.
- list_pending: map `set_loop` → `set_loop`.

**Test scenarios.**

- happy enqueue pending + kind set_loop
- invalid state rejected
- missing title rejected
- hub rejected
- not in mirror → atom_not_found
- insufficient_scope without write
- list_pending kind label set_loop
- tools/list includes set_loop under write scope
- instructions string contains set_loop + ask/confirm wording + redeems-not-reopen

**Requirements.** R1–R6, R9–R10, SC4–SC5

---

### U2. Plugin set_loop apply (FM modify)

**Goal.** Outbox apply patches existing atom FM; body unchanged.

**Files.** `src/platform/askOutbox.ts` (payload type + `planSetLoopApply`), `src/plugin/catchUp.ts` (`OutboxVaultPort.modify`, `applyOutboxItemToVault` branch), `src/plugin/askCoordinator.ts` (wire modify), `test/askOutbox.test.ts`, `test/catchUp.test.ts` (and/or `test/openLoopsCommand.test.ts` if plan lives with applyOpenLoopFm)

**Approach.**

- Widen `AskOutboxPayload` with optional `state` for set_loop (or separate type union by kind).
- `planSetLoopApply`: missing content → reject; else `applyOpenLoopFm(content, { state, source: "user" })`; if equal → applied_idempotent; else modify.
- `applyOutboxItemToVault(vault, folder, payload, kind)`: set_loop branch uses modify; create/continue keep create path and pass open_loop/parent/relation/close_answer into `planAskOutboxApply`.
- Coordinator: `modify: async (path, content) => { const f = getAbstract…; if TFile modify }`.

**Test scenarios.**

- unmarked → active user; openNow true
- terminal each of three; openNow false
- body after FM identical pre/post
- idempotent second apply
- missing file → rejected
- create path still lands open_loop user FM when flag set (U0+U2 integration)
- continue redeems + close_answer lines present in child markdown after plan
- (optional unit) openNow false when hasRedeemingChild even if FM active after set_loop — documents KTD11 derivation; no apply change required

**Requirements.** R1–R4, R11, SC1–SC3, SC6

**Execution note.** Test-first on `planSetLoopApply` and catchUp kind branch.

---

### U3. Version + claim plumbing

**Goal.** Identifiable plugin build; multiplayer claim complete.

**Files.** `package.json`, `manifest.json`, `versions.json` → **0.7.6**; GitHub Issue; `STATUS.md`; draft PR

**Approach.** Standard bump. PR body `Closes #N`. Note Fly deploy for plus-service before live Claude dogfood.

**Test scenarios.** n/a (manifest consistency only)

**Requirements.** shipping / collab

---

### U4. Dogfood stop (not code)

**Goal.** Human SC7–SC8 after merge+deploy. No Part 2 in this PR.

**Checklist.** See Product Contract dogfood bar + open loops residual SC1–SC2 still open independently.

---

## Verification Contract

```bash
npm test
npm run build
npm run lint
cd plus-service && npm test
```

Optional after install to throwaway vault: outbox apply smoke via CLI if Ask test harness available; otherwise unit + plus-service is ship bar.

Agents: do not write personal Remote Vault.

## Definition of Done

- [ ] U0–U3 merged with tests green
- [ ] Product SC1–SC6 evidenced by automated tests
- [ ] Shipping tail: simplify → code-review → compound (learning if durable) → scoped QA on throwaway path
- [ ] PR `Closes #<issue>`; STATUS cleared on merge
- [ ] plus-service deployed to Fly before claiming live MCP dogfood
- [ ] Stop — no Part 2 until human dogfood of conversational mark
