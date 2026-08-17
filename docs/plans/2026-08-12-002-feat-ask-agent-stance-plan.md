---
title: Ask agent stance - Plan
type: feat
date: 2026-08-12
origin: user — stop having to say "check my atoms"; agent connection is the differentiator
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
product_contract_preservation: "Product Contract unchanged; planning adds HOW only"
---

# Ask agent stance - Plan

## Goal Capsule

**Objective.** Claude/ChatGPT reach for the Ask mirror when the user’s life might already be in Atoms — without the user saying “check my atoms.” Stay quiet when they’re just talking. No always-search, no auto-file, no unprompted “you already wrote this.”

**Product authority.** Constitution: second brain not task app; judgment in conversation; false positives cost more than misses. Open loops + set_loop already shipped. This is posture for *all* Ask tools, not a new tool.

**Open blockers.** None. Live hosts cache instructions — new chat or reconnect after Fly deploy.

---

## Product Contract

### Summary

Add an opening **stance** to MCP instructions so the default is “this person’s notes exist; look once if a colleague would,” not “I am a chatbot that can optionally search.” Feature rules (create, continue, set_loop, redeems, return phrasing) sit under that stance. No new tools. No Home. No capture change.

### Problem Frame

Ask only fires when the user sounds like a librarian. Everyday talk about their people, routines, and past notes gets a generic answer. They compensate with “check my atoms.” The product thesis is the opposite: the vault is already the filter; the agent should look when the topic is *theirs*.

### Requirements

- R1. **Default reach:** If the utterance is about the user’s own past, people, projects, intentions, or something they may have captured, call `search_atoms` (then `fetch_atom` before quoting) **once** before answering from model memory. Do not wait for “search / check my atoms / look in the vault.”
- R2. **Stay quiet:** Thinking out loud, advice that isn’t about their notes, or a topic with no personal hook → no search, no create.
- R3. **One look:** Empty or weak search → say you don’t see it in this mirror. Do not loop tools. Do not claim the vault has nothing forever.
- R4. **No auto-file:** Create/continue only when they want it kept (dictate, “save this,” “add that to the note”). Chat is not capture.
- R5. **Judgment still asks:** set_loop only after they confirm. Substance close stays redeems.
- R6. **Return phrasing** (same stance, stronger row): “didn’t I write / I thought I captured / I know I have something” → search as return (widen, don’t narrow), show their words verbatim, if `open_now` offer close. Still not unprompted push.
- R7. **No system narration:** Don’t recite tool names, outbox ids, or “first time we’ve used this feature” unless they ask how it works.
- R8. **Instructions-only.** First lines of `ASK_MCP_INSTRUCTIONS` carry the stance; existing write/read rules stay, tightened to point up at the stance. Tests lock the required sentences. plus-service + Fly. No plugin bump unless copy in the plugin changes (it should not).

### Key Decisions

- KD1. **Job is “don’t make me say check my atoms.”** (session-settled: user-directed)
- KD2. **Colleague glance, not always-search.** (session-settled: user-approved — chosen over search-every-turn)
- KD3. **No unprompted push.** (session-settled: user-directed — Part 2 pull only)
- KD4. **No auto-file from chat.** (session-settled: user-directed — capture stays dump)
- KD5. **Return detection is one row in this stance, not a second initiative.** (session-settled: user-approved)
- KD6. **MCP instructions are the product surface** so Claude and ChatGPT both get it. Not a Claude-only custom instruction.

### Scope Boundaries

**In:** `ASK_MCP_INSTRUCTIONS` opening stance + alignment of write/open-loop bullets; instruction parity tests; Fly deploy.

**Deferred:** Retrieval (recency/people); unprompted “you already wrote this”; plugin UI; new tools.

**Out of identity:** Task-app nag; filing every thought; “I searched your brain” theater.

### Success Criteria

- SC1. Instructions open with the stance (vault-first when personal; quiet otherwise; no “check my atoms” required). Fixture test fails if those sentences are missing.
- SC2. Return-phrasing row present (verbatim + offer close if open_now).
- SC3. Auto-file forbidden; set_loop still ask-then-act; outbox_id still not recited.
- SC4. Dogfood: a turn about a known personal topic searches without the user saying check/search/atoms. A turn that is generic advice does not search. (Human + live host after Fly; new chat.)

### Key Flows

**F1.** “I was thinking about that cowork routine…” → search → fetch → their words / open loop label. No “check my atoms.”

**F2.** “How should I structure a newsletter?” (no personal hook) → answer; no search.

**F3.** “Didn’t I write something about the climbing gym?” → return search → verbatim → offer act.

**F4.** “Save this: …” → create. “Yeah mark that loop” → set_loop. Thinking aloud → nothing.

### Actors

- A1. Vault owner in Claude/ChatGPT
- A2. Host model following MCP instructions

### Assumptions

- Fly deploy required; hosts cache instructions until new chat/reconnect.
- Stance cannot *force* tool calls; it changes default bias. SC4 is dogfood, not CI.

### Outstanding Questions

- None blocking. Exact prose is a planning KTD (short, concrete, no catalog).

---

## Planning Contract

### Technical Design

Single file: `plus-service/src/mcp/instructions.mjs`. Prepend a **Stance** block (≤8 lines) before the tool catalog. Do not duplicate existing write/open-loop law — add one upward pointer (“stance first”). Keep quiet-pending / outbox_id rules.

**Stance copy (frozen for implementers):**

```
Stance:
Their notes live in this Ask mirror. If they talk about their own past, people, projects, intentions, or something they may have written down, search_atoms once and fetch_atom before quoting. They should not have to say "check my atoms" or "search."
Thinking out loud or generic advice with no personal hook: do not search and do not create.
One look. Empty search means you don't see it in this mirror — say that. Do not keep calling tools.
Do not file chat unless they want it kept. Do not set_loop unless they confirm. Do not recite tool names or outbox_id.
Return ("didn't I write" / "I thought I captured" / "I know I have something"): search wider, show their words verbatim, if open_now offer closing. Never unprompted "you already wrote this."
```

### Key Technical Decisions

- KTD1. Instructions-only; no new MCP tool.
- KTD2. Stance is the first body lines after the one-line role sentence (or replaces the role sentence’s second half). Tool list follows.
- KTD3. Tests in `plus-service/test/mcp-ask-write.test.mjs` (and unmisreadable if it freezes instruction prefixes) lock: `check my atoms`, `One look`, `thinking out loud` / `generic advice`, return phrases, `Never unprompted`.
- KTD4. No plugin version bump. Fly deploy for live hosts. New chat/reconnect to pick up cache.
- KTD5. Execution: test-first on instruction assertions.

### Sequencing

U1 tests → U2 copy → U3 Fly.

### Risks

| Risk | Mitigation |
|---|---|
| Model still ignores stance | Opening position + dogfood SC4; cannot CI-force tool calls |
| Over-search | Quiet row + one look |
| Host cache | Release notes: new chat |

---

## Implementation Units

### U1. Instruction parity tests

**Files.** `plus-service/test/mcp-ask-write.test.mjs`

**Test scenarios.** Required substrings above; existing pending/set_loop/invent asserts still pass.

### U2. Write stance

**Files.** `plus-service/src/mcp/instructions.mjs`

**Approach.** Insert frozen copy. Point open-loop/write bullets at stance; do not rewrite the whole file.

### U3. Claim + Fly

Issue, branch, STATUS, PR. Deploy `atoms-plus` after merge or from branch for dogfood.

---

## Verification Contract

```bash
cd plus-service && node --test test/mcp-ask-write.test.mjs test/mcp-unmisreadable-shape.test.mjs
```

## Definition of Done

- [ ] SC1–SC3 tests green
- [ ] Fly deployed; human SC4 in a **new** Claude chat
- [ ] No plugin bump
