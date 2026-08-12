# World-Class QA: Ask agent stance (#471 / #472)

Date: 2026-08-12  
Branch: `feat/ask-agent-stance`  
PR: [#472](https://github.com/taihartman/obsidian-atoms/pull/472) · Issue #471  
Surface: plus-service `ASK_MCP_INSTRUCTIONS` only. No plugin bump.

## Verdict

**Ready for merge of instructions** — SC1–SC3 locked by fixture tests; U2 pointers land under the frozen stance.

**Not Ready for “feature done”** until Fly deploys `atoms-plus` and a human runs SC4 in a **new** Claude/ChatGPT chat (hosts cache instructions).

## Charter

- **Change:** Opening MCP stance so hosts search the Ask mirror when the user’s life might already be there, without “check my atoms.” Quiet if no personal hook. One look. No auto-file. Return phrasing is one row.
- **Workflows:** Claude/ChatGPT conversation → optional `search_atoms` / `fetch_atom` → answer. Write tools unchanged except stance forbids silent create/set_loop.
- **Risks:** Over-search; under-search still needing the librarian phrase; “one look” suppressing `mirror_status` / `list_tags` / `fetch_atom`; stance implying vault-global absence; live path needs Fly.
- **Platforms:** plus-service tests. No Home UI. No phone.
- **Product loop vs fixture:** Fixture/plumbing for instruction parity. Live MCP user-loop **Not tested** (Fly not deployed this pass).
- **Authority:** `docs/plans/2026-08-12-002-feat-ask-agent-stance-plan.md` R1–R8, SC1–SC4, KD1–KD6.

**Product dogfood honesty:** ✅ present in `docs/qa/README.md`.  
**Learnings:** ✅ read `docs/qa/learnings.md` — no trap matches this MCP-instruction surface.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ |
| Authority paths | ✅ plan 2026-08-12-002 |
| Nav map | N/A — no plugin chrome |
| Dev/run | ✅ `cd plus-service && node --test test/mcp-ask-write.test.mjs test/mcp-unmisreadable-shape.test.mjs` |
| Viewport | N/A |
| Auth | Live MCP needs Plus + Ask. Not exercised. |
| Fixtures | ✅ instruction string + existing write-path tests |
| Deploy reality | ⚠️ **plus-service must deploy to Fly**; new chat/reconnect to pick up cache |

## Authority & promises

| Surface | Promise | Acceptance | Story |
|---|---|---|---|
| Opening stance | Search once on personal topics; no “check my atoms” required | Instructions open with Stance; tests lock the sentences | US1 |
| Quiet | Thinking out loud / generic advice → no search, no create | Locked `thinking out loud` + `generic advice` | US2 |
| One look | Empty search = not in this mirror; do not loop tools | Locked `One look`; pointer: never “you have no notes” | US3 |
| No auto-file | File only when they want it kept; set_loop only after confirm | Stance + write-rules pointer | US4 |
| Return phrasing | “didn’t I write” etc. → wider search, verbatim, offer close if open_now | Three return phrases locked | US5 |
| Live dogfood | Personal topic searches; generic advice does not | New chat after Fly | US6 **Not tested** |

## Product loop vs fixture

| Primary story | Proof kind | Notes |
|---|---|---|
| US1–US5 instruction contract | fixture-plumbing | substring locks + existing write tests |
| US6 colleague-glance dogfood | user-loop | **Blocked** — Fly + live host |

## User Stories

**US1** As a vault owner talking to Claude, I want the agent to look in my notes when I talk about my people or past, so I do not have to say “check my atoms.”  
Acceptance: stance present; `check my atoms` + `One look` locked.  
Evidence: `mcp-ask-write` “instructions cover pending and compose rules”. **Passed** (plumbing).

**US2** Generic advice with no personal hook stays quiet.  
Acceptance: `thinking out loud` and `generic advice` in the string.  
Evidence: same test. **Passed** (plumbing).

**US3** One empty search is spoken as “not in this mirror,” not “you have no notes.”  
Acceptance: stance “this mirror” + Read-rules pointer.  
Evidence: source + `/Stance first/` lock. **Passed** (plumbing).

**US4** Chat is not capture.  
Acceptance: “Do not file chat unless they want it kept”; write header points at stance.  
Evidence: source. **Passed** (plumbing).

**US5** Return phrasing is one row.  
Acceptance: three phrases present.  
Evidence: `/didn't I write/`, `/I thought I captured/`, `/I know I have something/`. **Passed** (plumbing).

**US6** Live turn about a known personal topic searches without the user saying check/search/atoms; a generic-advice turn does not.  
**Not tested** — needs Fly deploy + new chat. Blocker for “feature done,” not for instruction merge.

## Risk Matrix

| Class | Check | Status |
|---|---|---|
| Happy | Stance sentences present | Passed (test) |
| Negative | Generic advice / thinking out loud present | Passed (test) |
| Edge | Return phrases all three | Passed (test) |
| Regression | Existing pending / set_loop / invent / outbox_id / unmisreadable asserts | Passed (30 tests) |
| Perception | “this mirror” vs “no notes” | Passed at source; unproven on a host |
| Promise | Stance cannot force tool calls | Residual — plan Assumption |

## Evidence

```text
cd plus-service && node --test test/mcp-ask-write.test.mjs test/mcp-unmisreadable-shape.test.mjs
# tests 30, pass 30, fail 0
```

N/A — no plugin UI. No screenshots.

## Findings

**P1 applied:** “Do not keep calling tools” vs required `mirror_status` / `list_tags` / `fetch_atom`. Narrowed to `Do not retry search_atoms` plus named follow-ups. Return row is a new query. Locked with `doesNotMatch(/Do not keep calling tools/)`. See `docs/solutions/logic-errors/an-opener-stop-rule-must-name-the-tool-it-stops.md`.

Residual: polarity of other substring locks (an inverted sentence that still contains the tokens would pass). Known KTD3 shape; same class as `docs/solutions/security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md`.

Deferred (settled copy, not applied): drop “thinking out loud” (R2); delete “something they may have written down”; rewrite open-loop redeems to restate keep-intent.

## Adversarial QA

Attack surface is instruction-prose (hosts follow it after Fly). Live host attack **blocked: Fly + new chat**. Analytical ledger:

| Scenario | Trace | Test | Status |
|---|---|---|---|
| Over-search on “how should I structure a newsletter?” | Quiet row names generic advice + no personal hook | `/generic advice/` | solid (prose); live blocked |
| Under-search still needing “check my atoms” | Stance forbids waiting for that phrase | `/check my atoms/` | solid (prose); live blocked |
| One look skips `fetch_atom` before quoting | Stance says search once **and** fetch before quoting | no fetch lock | suspected, unproven |
| One look skips required `mirror_status` | Identity+health still requires early call; “Do not keep calling tools” is broader | none | suspected, unproven |
| Auto-file from “I was thinking…” | Quiet row + “do not create” + write pointer | `/thinking out loud/` | solid (prose); live blocked |
| Unprompted “you already wrote this” | Return row: Never unprompted | `/Never unprompted/` | solid (prose) |
| Return vs one-look (second utterance) | Return is a new turn; “search wider” | three phrases | solid (prose) |
| Invert polarity of a locked token | `assert.match` still passes | polarity not locked | suspected — residual of KTD3 |
| Edit stance later, drop “this mirror” | Honesty contract in Read rules + solutions doc | `/Stance first/` | solid if pointer stays |

Proven holes: none (no failing test, no live repro).

Fixes: added the two extra return-phrase locks KTD3 named. Deferred: live SC4; tightening “Do not keep calling tools” if correctness/adversarial confirm a P1.

## Not Tested

- Fly deploy of this instruction text
- New Claude chat SC4 (personal topic searches; generic advice does not)
- ChatGPT connector cache pickup
- `fetch_atom` / `mirror_status` still firing after stance (host behavior)
- Plugin UI (none)

## Learnings

Consulted: `docs/qa/learnings.md` (no matching trap).  
Consulted solutions: ask-search silent-empty; consent-parity frozen words; ask-mirror parity.

No new `docs/qa/learnings.md` row — the next MCP-instruction pass already has the frozen-words trap in `docs/solutions/security/`.

## Merge Decision

Merge the instruction PR after shipping-tail docs land. Deploy `atoms-plus`, then a human opens a **new** chat for SC4. Do not call the product shipped until that chat.
